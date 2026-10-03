"""The Interpreter Agent over A2A (Orchu stubbed) and the agent loop's §8.4 events (Claude stubbed). Offline."""

from collections.abc import AsyncIterator
from typing import Any

import httpx
import pytest
from claude_agent_sdk import AssistantMessage, ResultMessage, StreamEvent, ToolResultBlock, ToolUseBlock, UserMessage

from ayland import clock
from ayland.a2a_agents.interpreter import server as interpreter
from ayland.llm.orchu import Translation
from ayland.orchestrator import a2a, tools
from ayland.orchestrator.agent import Agent

BASE = "http://interpreter.test"


@pytest.fixture
async def http(monkeypatch: pytest.MonkeyPatch) -> AsyncIterator[httpx.AsyncClient]:
    async def fake_orchu(text: str, source: str, target: str) -> Translation:
        return Translation(text={"Сайн байна уу": "Hello"}.get(text, f"<{text}>"), ms=12.0)

    monkeypatch.setattr(interpreter.orchu, "translate", fake_orchu)
    transport = httpx.ASGITransport(app=interpreter.agent.app(BASE))
    async with httpx.AsyncClient(transport=transport, base_url=BASE) as client:
        yield client


async def test_translate_round_trip_over_a2a(http: httpx.AsyncClient) -> None:
    inputs = {"text": "Сайн байна уу", "source_lang": "mn", "target_lang": "en"}
    reply = await a2a.call_skill(BASE, "translate", inputs, http=http)
    assert reply.data == {"text": "Hello", "ms": 12}


async def test_translate_refuses_bad_requests_with_a_reason(http: httpx.AsyncClient) -> None:
    empty = await a2a.call_skill(BASE, "translate", {"text": " ", "source_lang": "mn", "target_lang": "en"}, http=http)
    assert "empty" in empty.data["error"]
    french = await a2a.call_skill(
        BASE, "translate", {"text": "Bonjour", "source_lang": "fr", "target_lang": "mn"}, http=http
    )
    assert "mn, en" in french.data["error"]


async def test_every_agent_answers_ping_and_lists_its_skills(http: httpx.AsyncClient) -> None:
    assert (await a2a.ping(BASE, http=http)).data["agent"] == interpreter.NAME
    card = (await http.get("/.well-known/agent-card.json")).json()
    assert [skill["id"] for skill in card["skills"]] == ["ping", "translate"]


def test_tool_names_drop_the_mcp_prefix() -> None:
    assert tools.display_name("mcp__merchant__search_offers") == "search_offers"
    assert tools.display_name("mcp__travel-data__get_route") == "get_route"
    assert tools.display_name("mcp__ayland__present_options") == "present_options"
    assert "mcp__travel-data__get_weather" in tools.ALLOWED and len(tools.ALLOWED) == 13
    assert "mcp__ayland__remember" in tools.ALLOWED


class FakeClient:
    """Replays one scripted turn the way ClaudeSDKClient.receive_response() delivers it."""

    def __init__(self, messages: list[Any]) -> None:
        self.messages = messages

    async def receive_response(self) -> AsyncIterator[Any]:
        for message in self.messages:
            yield message


def _delta(text: str) -> StreamEvent:
    return StreamEvent(
        uuid="u", session_id="s", event={"type": "content_block_delta", "delta": {"type": "text_delta", "text": text}}
    )


def _text_start() -> StreamEvent:
    return StreamEvent(
        uuid="u", session_id="s", event={"type": "content_block_start", "content_block": {"type": "text"}}
    )


async def test_a_turn_becomes_section_8_4_events_with_option_cards() -> None:
    card = {"rank": 1, "offer": {"_id": "off_puppet"}, "slot_start": "2026-10-05T15:00:00+07:00"}
    script = [
        _text_start(),
        _delta("Гурван хувилбар байна."),
        AssistantMessage(content=[ToolUseBlock("call_1", "mcp__ayland__present_options", {"options": []})], model="m"),
        UserMessage(content=[ToolResultBlock("call_1", [{"type": "text", "text": '{"summary": "1 хувилбар"}'}])]),
        _text_start(),
        _delta("Алийг нь захиалах вэ?"),
        ResultMessage("success", 1, 1, False, 3, "s"),
    ]
    tools.emit("trip_x", "options", run_id="run_1", options=[card])  # what present_options leaves for the loop
    events = [e async for e in Agent()._turn(FakeClient(script), "trip_x", "run_1")]
    kinds = [e["type"] for e in events]
    assert kinds == [
        "message.delta",
        "tool.start",
        "tool.end",
        "options",
        "message.delta",
        "message.delta",
        "message.done",
    ]
    assert events[2]["data"]["name"] == "present_options" and events[2]["data"]["summary"] == "1 хувилбар"
    assert events[3]["data"] == {"run_id": "run_1", "options": [card]}
    assert events[4]["data"]["text"] == "\n\n"  # the closing sentence is its own paragraph
    assert "trip_x" not in tools.outbox


def test_the_cli_session_is_isolated_from_the_developers_account() -> None:
    """The account's claude.ai connectors (Gmail, Drive...) and auto memory must never reach the travel agent."""
    from ayland.orchestrator.agent import CLI_ENV

    assert CLI_ENV["ENABLE_CLAUDEAI_MCP_SERVERS"] == "false"
    assert CLI_ENV["CLAUDE_CODE_DISABLE_AUTO_MEMORY"] == "1"
    assert CLI_ENV["ENABLE_TOOL_SEARCH"] == "false"


def test_a_slot_is_matched_as_a_time_not_as_a_string() -> None:
    hanoi = clock.parse_local("2026-10-05T15:00:00+07:00")
    assert clock.parse_local("2026-10-05T08:00:00Z") == hanoi  # the same moment in UTC
    assert clock.parse_local("2026-10-05T15:00+07:00") == hanoi  # no seconds
    assert clock.parse_local("after lunch") is None
