"""The AYLAND agent loop: Claude through the Claude Code CLI login, streaming §8.4 events.

One ClaudeSDKClient per trip stays connected, so a turn doesn't pay the CLI start-up again and the
conversation history stays append-only (required on claude-opus-5-5).
"""

import asyncio
import json
import logging
import tempfile
import time
from collections import defaultdict
from collections.abc import AsyncIterator
from typing import Any

from claude_agent_sdk import (
    AssistantMessage,
    ClaudeAgentOptions,
    ClaudeSDKClient,
    ClaudeSDKError,
    ResultMessage,
    StreamEvent,
    TextBlock,
    ToolResultBlock,
    ToolUseBlock,
    UserMessage,
)

from ayland import clock
from ayland.config import get_settings
from ayland.llm.claude import ISOLATED_ENV, find_cli

from . import prompts, tools

Event = dict[str, Any]
logger = logging.getLogger("ayland.agent")
# Tool search defers MCP tool definitions until the model searches for them: an extra round trip on every
# first use. Our tool list is small, so load it whole. Non-blocking off: the session starts with the MCP
# servers connected (the warm-up pays for that, not the first question).
CLI_ENV = {**ISOLATED_ENV, "ENABLE_TOOL_SEARCH": "false", "MCP_CONNECTION_NONBLOCKING": "0"}


def event(kind: str, **data: Any) -> Event:
    return {"type": kind, "data": data}


def _result_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(part.get("text", "") for part in content if isinstance(part, dict))
    return ""


def _summary(content: Any, is_error: bool = False) -> tuple[str, str]:
    """(the trace's Mongolian summary, the raw text for agent_events). Our tools put a `summary` in their JSON;
    tool errors (an MCP ToolError, bad arguments) are English text, so the trace shows a fixed Mongolian line."""
    text = _result_text(content)
    try:
        summary = str(json.loads(text).get("summary", ""))
    except (json.JSONDecodeError, AttributeError):
        summary = ""
    if not summary:
        summary = prompts.TOOL_FAILED if is_error else text
    return summary[:120], text[:300]


class Agent:
    def __init__(self) -> None:
        self._sessions: dict[str, ClaudeSDKClient] = {}
        self._creating = asyncio.Lock()  # a warm-up and a first question must not start two CLIs
        self._turns: defaultdict[str, asyncio.Lock] = defaultdict(asyncio.Lock)  # one turn per trip at a time

    def _options(self, trip_id: str) -> ClaudeAgentOptions:
        settings = get_settings()
        now = clock.now_iso()
        return ClaudeAgentOptions(
            cli_path=find_cli(),
            model=settings.claude_model,
            effort=settings.claude_chat_effort,
            system_prompt=prompts.system_prompt(trip_id, now[:10], clock.hhmm(now)),
            mcp_servers=tools.mcp_servers(trip_id),
            allowed_tools=tools.ALLOWED,
            env=CLI_ENV,
            tools=[],
            setting_sources=[],
            include_partial_messages=True,
            max_turns=12,  # a rain question takes about five: context, search, routes, cards, reply
            cwd=tempfile.gettempdir(),
        )

    async def _session(self, trip_id: str) -> ClaudeSDKClient:
        async with self._creating:
            if trip_id not in self._sessions:
                client = ClaudeSDKClient(self._options(trip_id))
                await client.connect()
                self._sessions[trip_id] = client
            return self._sessions[trip_id]

    async def warm(self, trip_id: str) -> None:
        """Start the CLI session ahead of the first question (saves its start-up on stage)."""
        await self._session(trip_id)

    async def close(self, trip_id: str | None = None) -> None:
        """Drop one trip's session (or all), e.g. on demo reset; the next turn starts fresh."""
        keys = [trip_id] if trip_id else list(self._sessions)
        for key in keys:
            client = self._sessions.pop(key, None)
            if client:
                await client.disconnect()

    async def run(self, trip_id: str, message: str, run_id: str) -> AsyncIterator[Event]:
        """One chat turn as §8.4 events. A turn cut short (cancelled run, error) discards the session,
        because unread messages would otherwise leak into the next turn."""
        async with self._turns[trip_id]:
            client = await self._session(trip_id)
            tools.outbox.pop(trip_id, None)  # events of a turn that died before sending them
            tools.turn_runs[trip_id] = run_id  # so the tools' agent_events carry this turn's id
            finished = False
            try:
                await self._reconnect_mcp(client)
                await client.query(message)
                async for item in self._turn(client, trip_id, run_id):
                    yield item
                finished = True
            finally:
                # Only this turn's own session: a reset may already have replaced it with a fresh one.
                if not finished and self._sessions.get(trip_id) is client:
                    await self.close(trip_id)

    @staticmethod
    async def _reconnect_mcp(client: ClaudeSDKClient) -> None:
        """A session warmed up while the MCP servers were still starting (npm run dev, demo-up) may lack their
        tools; reconnect any that isn't connected before the question, so the turn has them."""
        try:
            status = await client.get_mcp_status()
        except ClaudeSDKError as err:
            logger.warning("MCP status unavailable: %s", err)
            return
        for server in status.get("mcpServers", []):
            if server.get("name") in tools.REMOTE and server.get("status") != "connected":
                try:
                    await client.reconnect_mcp_server(server["name"])
                except Exception as err:  # noqa: BLE001 - the turn still runs, without that server's tools
                    logger.warning("MCP server %s unavailable: %s", server["name"], err)

    async def _turn(self, client: ClaudeSDKClient, trip_id: str, run_id: str) -> AsyncIterator[Event]:
        started: dict[str, tuple[float, str]] = {}
        inputs: dict[str, dict[str, Any]] = {}
        streamed = False  # the AssistantMessage then repeats text already sent as deltas
        text_so_far = ""
        async for message in client.receive_response():
            if isinstance(message, StreamEvent):
                raw = message.event
                block = raw.get("content_block", {})
                if raw.get("type") == "content_block_start" and block.get("type") == "tool_use":
                    # Shown as soon as the model starts writing the call, not once the call is complete
                    # (writing present_options' three reasons takes seconds).
                    name = tools.display_name(block["name"])
                    started[block["id"]] = (time.perf_counter(), name)
                    yield event("tool.start", run_id=run_id, call_id=block["id"], name=name, input={})
                elif raw.get("type") == "content_block_start" and block.get("type") == "text":
                    # Text blocks on either side of a tool call would otherwise run together.
                    if text_so_far and not text_so_far.endswith("\n"):
                        text_so_far += "\n\n"
                        yield event("message.delta", text="\n\n")
                elif raw.get("type") == "content_block_delta" and raw.get("delta", {}).get("type") == "text_delta":
                    streamed = True
                    text = raw["delta"]["text"]
                    text_so_far += text
                    yield event("message.delta", text=text)
            elif isinstance(message, AssistantMessage):
                for block in message.content:
                    if isinstance(block, ToolUseBlock):
                        name = tools.display_name(block.name)
                        inputs[block.id] = block.input
                        first = block.id not in started  # not streamed (partial messages off)
                        started[block.id] = (time.perf_counter(), name)  # the call runs from here: time it
                        if first:
                            yield event("tool.start", run_id=run_id, call_id=block.id, name=name, input=block.input)
                    elif isinstance(block, TextBlock) and not streamed:
                        text_so_far += block.text
                        yield event("message.delta", text=block.text)
                streamed = False
            elif isinstance(message, UserMessage) and isinstance(message.content, list):
                for block in message.content:
                    if isinstance(block, ToolResultBlock) and block.tool_use_id in started:
                        t0, name = started.pop(block.tool_use_id)
                        summary, detail = _summary(block.content, bool(block.is_error))
                        yield event(
                            "tool.end",
                            run_id=run_id,
                            call_id=block.tool_use_id,
                            name=name,
                            ok=not block.is_error,
                            summary=summary,
                            ms=round((time.perf_counter() - t0) * 1000),
                            input=inputs.pop(block.tool_use_id, {}),  # for agent_events (§8.1)
                            detail=detail,
                        )
                        for queued in tools.outbox.pop(trip_id, []):  # option cards, an approval card
                            yield queued
            elif isinstance(message, ResultMessage):
                if message.is_error:
                    yield event("error", message=message.result or message.subtype)
                yield event("message.done", message_id=run_id)


agent = Agent()
