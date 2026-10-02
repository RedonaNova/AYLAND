"""Offline A2A round trip: the Booking Agent runs in-process behind an ASGI transport (no network)."""

from collections.abc import AsyncIterator

import httpx
import pytest

from ayland.a2a_agents.booking.server import NAME, build_app
from ayland.orchestrator import a2a

BASE = "http://booking.test"


@pytest.fixture
async def http() -> AsyncIterator[httpx.AsyncClient]:
    transport = httpx.ASGITransport(app=build_app(BASE))
    async with httpx.AsyncClient(transport=transport, base_url=BASE) as client:
        yield client


async def test_agent_card_is_served_at_the_well_known_path(http: httpx.AsyncClient) -> None:
    response = await http.get("/.well-known/agent-card.json")
    assert response.status_code == 200
    card = response.json()
    assert card["name"] == NAME
    assert [skill["id"] for skill in card["skills"]] == ["ping"]


async def test_ping_round_trip(http: httpx.AsyncClient) -> None:
    reply = await a2a.ping(BASE, http=http)
    assert reply.data["pong"] is True
    assert reply.data["agent"] == NAME


async def test_unknown_skill_is_reported_not_guessed(http: httpx.AsyncClient) -> None:
    reply = await a2a.call_skill(BASE, "confirm_booking", {"proposal_id": "prp_x"}, http=http)
    assert "Unknown skill 'confirm_booking'" in reply.data["error"]
