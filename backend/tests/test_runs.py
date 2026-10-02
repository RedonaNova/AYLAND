"""Background runs read by long poll or as a stream (no Claude: the turns here are scripted)."""

import asyncio
from collections.abc import AsyncIterator

import httpx

from ayland.orchestrator import app as orchestrator
from ayland.orchestrator.runs import Run, Runs


def scripted(*texts: str, pause_s: float = 0.0) -> object:
    async def turn(_: Run) -> AsyncIterator[dict]:
        for text in texts:
            await asyncio.sleep(pause_s)
            yield {"type": "message.delta", "data": {"text": text}}
        yield {"type": "message.done", "data": {"message_id": "m"}}

    return turn


async def test_a_poll_returns_new_events_then_reports_the_end() -> None:
    run = Runs().start("t", scripted("Сайн", " байна уу", pause_s=0.01))
    page = await run.events_after(0, timeout_s=2)
    assert page["events"] and page["events"][0]["data"]["text"] == "Сайн"
    seen = list(page["events"])
    while not page["done"]:
        page = await run.events_after(page["cursor"], timeout_s=2)
        seen += page["events"]
    assert [e["type"] for e in seen] == ["message.delta", "message.delta", "message.done"]
    assert (await run.events_after(page["cursor"], timeout_s=0.01)) == {"events": [], "cursor": 3, "done": True}


async def test_a_quiet_poll_times_out_empty() -> None:
    run = Runs().start("t", scripted("late", pause_s=1))
    page = await run.events_after(0, timeout_s=0.02)
    assert page == {"events": [], "cursor": 0, "done": False}
    run.task.cancel()


async def test_stream_and_poll_see_the_same_run() -> None:
    run = Runs().start("t", scripted("a", "b", pause_s=0.01))
    streamed = [e async for e in run.stream()]
    assert [e["type"] for e in streamed] == ["message.delta", "message.delta", "message.done"]
    assert (await run.events_after(0, timeout_s=0.01))["events"] == streamed


async def test_cancel_stops_the_turn_and_ends_the_run() -> None:
    registry = Runs()
    run = registry.start("t", scripted("never", pause_s=5))
    await asyncio.sleep(0)
    assert registry.cancel(run.id)
    page = await run.events_after(0, timeout_s=1)
    assert page["done"] and page["events"] == []
    assert not registry.cancel(run.id)  # already over


async def test_unknown_runs_are_404_over_http() -> None:
    transport = httpx.ASGITransport(app=orchestrator.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://api.test") as api:
        assert (await api.get("/api/chat/runs/run_nope/events")).status_code == 404
        assert (await api.delete("/api/chat/runs/run_nope")).json() == {"cancelled": False}


async def test_a_run_cancelled_before_it_starts_still_ends() -> None:
    registry = Runs()
    run = registry.start("t", scripted("never", pause_s=5))
    assert registry.cancel(run.id)  # before the task ran a single step
    page = await run.events_after(0, timeout_s=1)
    assert page["done"]  # a poller is released at once instead of waiting out its timeout


async def test_a_new_question_cancels_the_trips_abandoned_turn() -> None:
    registry = Runs()
    abandoned = registry.start("t", scripted("slow", pause_s=5))
    await asyncio.sleep(0)
    fresh = registry.start("t", scripted("new"))
    other_trip = registry.start("u", scripted("slow", pause_s=5))
    await asyncio.sleep(0.05)
    assert abandoned.done and not other_trip.done
    assert [e["type"] for e in fresh.events][-1] == "message.done"
    registry.cancel_trip("u")


async def test_a_cancelled_turn_cleans_up_before_the_run_ends() -> None:
    cleaned: list[str] = []

    async def turn(_: Run) -> AsyncIterator[dict]:
        try:
            yield {"type": "message.delta", "data": {"text": "a"}}
            await asyncio.sleep(5)
            yield {"type": "message.done", "data": {"message_id": "m"}}
        finally:
            cleaned.append("session dropped, lock released")

    registry = Runs()
    run = registry.start("t", turn)
    await run.events_after(0, timeout_s=1)
    registry.cancel(run.id)
    await asyncio.wait({run.task})
    assert cleaned == ["session dropped, lock released"] and run.done
