"""The AYLAND agent loop: Claude through the Claude Code CLI login, streaming §8.4 events.

One ClaudeSDKClient per trip stays connected, so a turn doesn't pay the CLI start-up again and the
conversation history stays append-only (required on claude-opus-5-5).
"""

import asyncio
import json
import tempfile
import time
from collections import defaultdict
from collections.abc import AsyncIterator
from typing import Any

from claude_agent_sdk import (
    AssistantMessage,
    ClaudeAgentOptions,
    ClaudeSDKClient,
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


def _summary(content: Any) -> str:
    text = _result_text(content)
    try:
        return str(json.loads(text).get("summary", ""))[:120]
    except (json.JSONDecodeError, AttributeError):
        return text[:120]


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
        """One chat turn as §8.4 events. A turn cut short (client gone, error) discards the session,
        because unread messages would otherwise leak into the next turn."""
        async with self._turns[trip_id]:
            client = await self._session(trip_id)
            tools.shown.pop(trip_id, None)  # cards from a turn that died before emitting them
            finished = False
            try:
                await client.query(message)
                async for item in self._turn(client, trip_id, run_id):
                    yield item
                finished = True
            finally:
                # Only this turn's own session: a reset may already have replaced it with a fresh one.
                if not finished and self._sessions.get(trip_id) is client:
                    await self.close(trip_id)

    async def _turn(self, client: ClaudeSDKClient, trip_id: str, run_id: str) -> AsyncIterator[Event]:
        started: dict[str, tuple[float, str]] = {}
        streamed = False  # the AssistantMessage then repeats text already sent as deltas
        text_so_far = ""
        async for message in client.receive_response():
            if isinstance(message, StreamEvent):
                raw = message.event
                if raw.get("type") == "content_block_start" and raw.get("content_block", {}).get("type") == "text":
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
                        started[block.id] = (time.perf_counter(), name)
                        yield event("tool.start", run_id=run_id, call_id=block.id, name=name, input=block.input)
                    elif isinstance(block, TextBlock) and not streamed:
                        text_so_far += block.text
                        yield event("message.delta", text=block.text)
                streamed = False
            elif isinstance(message, UserMessage) and isinstance(message.content, list):
                for block in message.content:
                    if isinstance(block, ToolResultBlock) and block.tool_use_id in started:
                        t0, name = started.pop(block.tool_use_id)
                        yield event(
                            "tool.end",
                            run_id=run_id,
                            call_id=block.tool_use_id,
                            name=name,
                            ok=not block.is_error,
                            summary=_summary(block.content),
                            ms=round((time.perf_counter() - t0) * 1000),
                        )
                        if name == "present_options" and (options := tools.shown.pop(trip_id, None)):
                            yield event("options", run_id=run_id, options=options)
            elif isinstance(message, ResultMessage):
                if message.is_error:
                    yield event("error", message=message.result or message.subtype)
                yield event("message.done", message_id=run_id)


agent = Agent()
