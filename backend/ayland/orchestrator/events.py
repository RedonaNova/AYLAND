"""Per-trip event bus behind GET /api/trips/{id}/events: nudges and plan changes pushed to the UI (§8.4)."""

import asyncio
from collections import defaultdict
from typing import Any


class TripEvents:
    """In-process fan-out: one orchestrator process serves the demo, so no broker is needed."""

    def __init__(self) -> None:
        self._subscribers: defaultdict[str, set[asyncio.Queue[dict[str, Any]]]] = defaultdict(set)

    def subscribe(self, trip_id: str) -> asyncio.Queue[dict[str, Any]]:
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=100)
        self._subscribers[trip_id].add(queue)
        return queue

    def unsubscribe(self, trip_id: str, queue: asyncio.Queue[dict[str, Any]]) -> None:
        self._subscribers[trip_id].discard(queue)

    def publish(self, trip_id: str, event: dict[str, Any]) -> None:
        for queue in list(self._subscribers[trip_id]):
            if not queue.full():
                queue.put_nowait(event)


trip_events = TripEvents()
