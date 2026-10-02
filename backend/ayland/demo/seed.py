"""Load data/seed/hanoi.json into MongoDB (M1-B2). Idempotent, so it doubles as the demo reset."""

import json
from functools import lru_cache
from typing import Any

from pymongo import ASCENDING, GEOSPHERE
from pymongo.asynchronous.database import AsyncDatabase

from ayland import clock
from ayland.config import REPO_ROOT
from ayland.db import models

SEED_FILE = REPO_ROOT / "data" / "seed" / "hanoi.json"


@lru_cache
def load_seed() -> dict[str, Any]:
    return json.loads(SEED_FILE.read_text(encoding="utf-8"))


def materialize(seed: dict[str, Any], today: str) -> tuple[dict[str, Any], list[dict[str, Any]], list[dict[str, Any]]]:
    """Turn relative days and times into the §8.1 trip, offers and bookings for `today`."""
    raw = seed["trip"]
    trip_id = raw["_id"]
    days = []
    for day in raw["days"]:
        date = clock.add_days(today, day["offset"])
        items = [
            {
                **{k: v for k, v in item.items() if k not in ("from", "to")},
                "start": clock.at(date, item["from"]),
                "end": clock.at(date, item["to"]),
                "source": "seed",
            }
            for item in day["items"]
        ]
        days.append({"date": date, "items": items})
    trip = {**raw, "days": days, "updated_at": clock.at(today, "08:00")}

    offers = [
        {
            **{k: v for k, v in offer.items() if k != "slots"},
            "city": "Hanoi",
            "description": "",
            "slots": [{"start": clock.at(today, time), "capacity_left": left} for time, left in offer["slots"]],
        }
        for offer in seed["offers"]
    ]

    def stamp(rel: list[Any]) -> str:
        return clock.at(clock.add_days(today, rel[0]), rel[1])

    bookings = [
        {
            **{k: v for k, v in booking.items() if k not in ("created", "approved")},
            "trip_id": trip_id,
            "created_at": stamp(booking["created"]),
            "consent": {"approved_at": stamp(booking["approved"]), "method": "tap"},
        }
        for booking in seed["bookings"]
    ]
    return trip, offers, bookings


async def ensure_indexes(db: AsyncDatabase) -> None:
    """HANDBOOK §8.1 indexes."""
    await db.offers.create_index([("location", GEOSPHERE)])
    await db.proposals.create_index([("trip_id", ASCENDING)])
    await db.bookings.create_index([("trip_id", ASCENDING)])
    await db.messages.create_index([("trip_id", ASCENDING), ("ts", ASCENDING)])
    await db.agent_events.create_index([("trip_id", ASCENDING), ("ts", ASCENDING)])


async def reset(db: AsyncDatabase) -> str:
    """Replace the demo trip, its offers and bookings, clear its chat and events, set the weather to clear."""
    raw_trip, raw_offers, raw_bookings = materialize(load_seed(), clock.today())
    # Validate against §8.1 before anything is written, so a bad seed never half-replaces the demo.
    trip = models.Trip.model_validate(raw_trip).to_mongo()
    offers = [models.Offer.model_validate(o).to_mongo() for o in raw_offers]
    bookings = [models.Booking.model_validate(b).to_mongo() for b in raw_bookings]
    trip_id = trip["_id"]
    await db.trips.replace_one({"_id": trip_id}, trip, upsert=True)
    await db.offers.delete_many({"_id": {"$in": [o["_id"] for o in offers]}})
    await db.offers.insert_many(offers)
    await db.bookings.delete_many({"trip_id": trip_id})
    await db.bookings.insert_many(bookings)
    for collection in ("proposals", "messages", "agent_events"):
        await db[collection].delete_many({"trip_id": trip_id})
    await db.demo_state.replace_one({"_id": "demo"}, {"_id": "demo", "weather": "clear"}, upsert=True)
    await ensure_indexes(db)
    return trip_id
