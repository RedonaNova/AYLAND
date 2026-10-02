"""Orchestrator routes that answer before touching MongoDB, Claude or Novelsoft (offline)."""

import asyncio
from collections.abc import AsyncIterator

import httpx
import pytest

from ayland.config import Settings
from ayland.orchestrator import app as orchestrator
from ayland.orchestrator.events import TripEvents


@pytest.fixture
async def api() -> AsyncIterator[httpx.AsyncClient]:
    transport = httpx.ASGITransport(app=orchestrator.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://api.test") as client:
        yield client


async def test_english_speech_is_left_to_the_browser(api: httpx.AsyncClient) -> None:
    response = await api.post("/api/voice/speak", json={"text": "Hello", "lang": "en"})
    assert response.status_code == 400
    assert "browser" in response.json()["detail"]


async def test_blank_speech_is_refused(api: httpx.AsyncClient) -> None:
    response = await api.post("/api/voice/speak", json={"text": "   ", "lang": "mn"})
    assert response.status_code == 400


async def test_english_audio_is_not_sent_to_anir(api: httpx.AsyncClient) -> None:
    files = {"file": ("speech.wav", b"RIFF", "audio/wav")}
    response = await api.post("/api/voice/transcribe", files=files, data={"lang": "en"})
    assert response.status_code == 400


async def test_demo_controls_need_demo_mode(api: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(orchestrator, "get_settings", lambda: Settings(demo_mode=False))
    assert (await api.post("/api/demo/reset")).status_code == 403
    assert (await api.post("/api/demo/scenario", json={"weather": "rain"})).status_code == 403


async def test_heartbeat_fills_pauses_and_keeps_every_frame() -> None:
    async def slow() -> AsyncIterator[str]:
        yield "a"
        await asyncio.sleep(0.05)
        yield "b"

    frames = [frame async for frame in orchestrator.with_heartbeat(slow(), every=0.02)]
    assert frames[0] == "a" and frames[-1] == "b"
    assert ": ping\n\n" in frames


async def test_heartbeat_is_silent_for_a_fast_stream() -> None:
    async def fast() -> AsyncIterator[str]:
        for frame in ("a", "b", "c"):
            yield frame

    assert [frame async for frame in orchestrator.with_heartbeat(fast(), every=1)] == ["a", "b", "c"]


async def test_trip_event_poll_delivers_what_was_published_after_the_cursor() -> None:
    bus = TripEvents()
    first = await bus.wait("t", "", timeout_s=1)
    assert first["events"] == [] and not first["reset"]
    bus.publish("t", {"type": "nudge", "data": {"text": "Бороо"}})
    bus.publish("other", {"type": "nudge", "data": {"text": "not ours"}})
    second = await bus.wait("t", first["cursor"], timeout_s=1)
    assert [e["data"]["text"] for e in second["events"]] == ["Бороо"]
    assert (await bus.wait("t", second["cursor"], timeout_s=0.01))["events"] == []


async def test_trip_event_poll_wakes_on_publish_and_flags_a_restart() -> None:
    bus = TripEvents()
    cursor = (await bus.wait("t", "", timeout_s=1))["cursor"]
    asyncio.get_running_loop().call_later(0.02, bus.publish, "t", {"type": "plan.updated", "data": {}})
    woke = await bus.wait("t", cursor, timeout_s=5)
    assert [e["type"] for e in woke["events"]] == ["plan.updated"]
    assert (await TripEvents().wait("t", cursor, timeout_s=1))["reset"]  # another process: re-fetch the trip
