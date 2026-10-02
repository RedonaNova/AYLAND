"""Agent turns as background runs whose events can be read by long poll or as a stream (HANDBOOK §8.4).

A turn no longer lives inside one HTTP response: it runs as a task, and every event it emits is kept on the
run. A client polls `events_after(cursor)`, so live mode works through anything that buffers streamed
responses (Cloudflare quick tunnels, a Vercel proxy). The SSE endpoint reads the same run.
"""

import asyncio
import uuid
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass, field
from typing import Any

Event = dict[str, Any]
COALESCE_S = 0.05  # after the first new event, wait this long so one poll carries a few deltas
KEEP_DONE_S = 600  # finished runs stay readable this long (a client that polled late can still catch up)


@dataclass
class Run:
    id: str
    trip_id: str
    events: list[Event] = field(default_factory=list)
    done: bool = False
    task: asyncio.Task[None] | None = None
    changed: asyncio.Condition = field(default_factory=asyncio.Condition)

    async def add(self, event: Event) -> None:
        async with self.changed:
            self.events.append(event)
            self.changed.notify_all()

    async def finish(self) -> None:
        async with self.changed:
            self.done = True
            self.changed.notify_all()

    async def events_after(self, cursor: int, timeout_s: float) -> dict[str, Any]:
        """The events after `cursor`, waiting up to `timeout_s` for the first one (or for the end)."""
        async with self.changed:
            try:
                await asyncio.wait_for(self.changed.wait_for(lambda: len(self.events) > cursor or self.done), timeout_s)
            except TimeoutError:
                pass
        if len(self.events) > cursor and not self.done:
            await asyncio.sleep(COALESCE_S)
        return {"events": self.events[cursor:], "cursor": len(self.events), "done": self.done}

    async def stream(self) -> AsyncIterator[Event]:
        """Every event of the run, as it happens."""
        cursor = 0
        while True:
            page = await self.events_after(cursor, timeout_s=3600)
            for event in page["events"]:
                yield event
            cursor = page["cursor"]
            if page["done"]:
                return


class Runs:
    def __init__(self) -> None:
        self._runs: dict[str, Run] = {}
        self._finished_at: dict[str, float] = {}

    def start(self, trip_id: str, turn: Callable[[Run], AsyncIterator[Event]], run_id: str | None = None) -> Run:
        """Run `turn(run)` in the background, recording every event it yields."""
        self._prune()
        run = Run(id=run_id or f"run_{uuid.uuid4().hex[:10]}", trip_id=trip_id)

        async def drive() -> None:
            try:
                async for event in turn(run):
                    await run.add(event)
            finally:
                await run.finish()
                self._finished_at[run.id] = asyncio.get_running_loop().time()

        self._runs[run.id] = run
        run.task = asyncio.create_task(drive())
        return run

    def get(self, run_id: str) -> Run | None:
        return self._runs.get(run_id)

    def cancel(self, run_id: str) -> bool:
        run = self._runs.get(run_id)
        if run is None or run.task is None or run.task.done():
            return False
        run.task.cancel()  # ends the agent turn, which drops its Claude session (Agent.run)
        return True

    def _prune(self) -> None:
        now = asyncio.get_running_loop().time()
        for run_id, finished in list(self._finished_at.items()):
            if now - finished > KEEP_DONE_S:
                self._runs.pop(run_id, None)
                del self._finished_at[run_id]


runs = Runs()
