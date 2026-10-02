"""Per-trip event bus behind the trip event stream: nudges and plan changes pushed to the UI (§8.4).

Two ways to listen: the SSE stream (`subscribe`), and a long poll (`wait`) for networks that buffer streamed
responses, such as Cloudflare quick tunnels (measured 2026-10-02: every stream arrives only when it ends).
"""

import asyncio
import uuid
from collections import defaultdict, deque
from typing import Any

Event = dict[str, Any]
KEEP = 50  # recent events per trip, so a poll that was between requests misses nothing


class TripEvents:
    """In-process fan-out: one orchestrator process serves the demo, so no broker is needed."""

    def __init__(self) -> None:
        self._subscribers: defaultdict[str, set[asyncio.Queue[Event]]] = defaultdict(set)
        self._recent: defaultdict[str, deque[tuple[int, Event]]] = defaultdict(lambda: deque(maxlen=KEEP))
        self._seq = 0
        self.boot = uuid.uuid4().hex[:8]  # a poll cursor from before a restart is recognized as stale

    def subscribe(self, trip_id: str) -> asyncio.Queue[Event]:
        queue: asyncio.Queue[Event] = asyncio.Queue(maxsize=100)
        self._subscribers[trip_id].add(queue)
        return queue

    def unsubscribe(self, trip_id: str, queue: asyncio.Queue[Event]) -> None:
        self._subscribers[trip_id].discard(queue)

    def publish(self, trip_id: str, event: Event) -> None:
        self._seq += 1
        self._recent[trip_id].append((self._seq, event))
        for queue in list(self._subscribers[trip_id]):
            if not queue.full():
                queue.put_nowait(event)

    def cursor(self) -> str:
        return f"{self.boot}:{self._seq}"

    def _after(self, trip_id: str, cursor: str) -> tuple[list[Event], bool]:
        """Events newer than `cursor`, and whether the cursor came from another process (a restart)."""
        boot, _, seq = cursor.partition(":")
        if boot != self.boot or not seq.isdigit():
            return [], True
        return [event for n, event in self._recent[trip_id] if n > int(seq)], False

    async def wait(self, trip_id: str, cursor: str, timeout_s: float) -> dict[str, Any]:
        """Long poll. Without a cursor (or with a stale one), answers at once with a fresh cursor and `reset`
        (re-fetch the trip); otherwise returns the newer events, waiting up to `timeout_s` for the first one."""
        if not cursor:
            return {"events": [], "cursor": self.cursor(), "reset": False}
        events, stale = self._after(trip_id, cursor)
        if stale:
            return {"events": [], "cursor": self.cursor(), "reset": True}
        if not events:
            queue = self.subscribe(trip_id)
            try:
                await asyncio.wait_for(queue.get(), timeout_s)
            except TimeoutError:
                pass
            finally:
                self.unsubscribe(trip_id, queue)
            events, _ = self._after(trip_id, cursor)
        return {"events": events, "cursor": self.cursor(), "reset": False}


trip_events = TripEvents()
