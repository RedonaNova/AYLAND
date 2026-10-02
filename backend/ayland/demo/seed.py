"""Load data/seed/hanoi.json into MongoDB (M1-B2). Idempotent, so it doubles as the demo reset."""

import json
from dataclasses import dataclass
from functools import lru_cache
from typing import Any

from pymongo import ASCENDING, GEOSPHERE
from pymongo.asynchronous.database import AsyncDatabase

from ayland import clock
from ayland.config import REPO_ROOT
from ayland.db import models

SEED_FILE = REPO_ROOT / "data" / "seed" / "hanoi.json"
Doc = dict[str, Any]


@lru_cache
def load_seed() -> dict[str, Any]:
    return json.loads(SEED_FILE.read_text(encoding="utf-8"))


@dataclass
class DemoData:
    """The §8.1 documents for one day of the demo, before validation."""

    user: Doc
    trip: Doc
    merchants: list[Doc]
    offers: list[Doc]
    bookings: list[Doc]

    def validated(self) -> "DemoData":
        """Every document through its §8.1 model, as stored; raises before anything reaches MongoDB."""
        return DemoData(
            user=models.User.model_validate(self.user).to_mongo(),
            trip=models.Trip.model_validate(self.trip).to_mongo(),
            merchants=[models.Merchant.model_validate(m).to_mongo() for m in self.merchants],
            offers=[models.Offer.model_validate(o).to_mongo() for o in self.offers],
            bookings=[models.Booking.model_validate(b).to_mongo() for b in self.bookings],
        )


def materialize(seed: dict[str, Any], today: str) -> DemoData:
    """Turn relative days and times into the §8.1 documents for `today`."""
    raw = seed["trip"]
    trip_id = raw["_id"]
    city = raw["destination"]["city"]
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

    slot_dates = [clock.add_days(today, offset) for offset in seed.get("slot_days", [0])]
    offers = [
        {
            **{k: v for k, v in offer.items() if k != "slots"},
            "city": city,
            "slots": [
                {"start": clock.at(date, time), "capacity_left": left}
                for date in slot_dates
                for time, left in offer["slots"]
            ],
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
    merchants = [{**merchant, "city": city} for merchant in seed["merchants"]]
    return DemoData(user=seed["user"], trip=trip, merchants=merchants, offers=offers, bookings=bookings)


async def ensure_indexes(db: AsyncDatabase) -> None:
    """HANDBOOK §8.1 indexes."""
    await db.offers.create_index([("location", GEOSPHERE)])
    await db.proposals.create_index([("trip_id", ASCENDING)])
    await db.bookings.create_index([("trip_id", ASCENDING)])
    await db.messages.create_index([("trip_id", ASCENDING), ("ts", ASCENDING)])
    await db.agent_events.create_index([("trip_id", ASCENDING), ("ts", ASCENDING)])
    await db.trip_versions.create_index([("trip_id", ASCENDING), ("version", ASCENDING)])


async def _replace_all(db: AsyncDatabase, collection: str, docs: list[Doc]) -> None:
    await db[collection].delete_many({"_id": {"$in": [d["_id"] for d in docs]}})
    await db[collection].insert_many(docs)


async def ensure_current(db: AsyncDatabase, trip_id: str) -> bool:
    """DEMO_MODE: the demo's dates are relative to today, so a missing seed, or one from an earlier day, is
    replayed for today (otherwise "today" stops being a trip day overnight). True if it re-seeded."""
    if trip_id != load_seed()["trip"]["_id"]:
        return False
    trip = await db.trips.find_one({"_id": trip_id}, {"days.date": 1})
    if trip and any(day["date"] == clock.today() for day in trip["days"]):
        return False
    await reset(db)
    return True


async def reset(db: AsyncDatabase) -> str:
    """Replace the demo user, trip, merchants, offers and bookings; clear the trip's chat, proposals and events;
    set the weather to clear. Validated against §8.1 first, so a bad seed never half-replaces the demo."""
    data = materialize(load_seed(), clock.today()).validated()
    trip_id = data.trip["_id"]
    await db.users.replace_one({"_id": data.user["_id"]}, data.user, upsert=True)
    await db.trips.replace_one({"_id": trip_id}, data.trip, upsert=True)
    await _replace_all(db, "merchants", data.merchants)
    await _replace_all(db, "offers", data.offers)
    await db.bookings.delete_many({"trip_id": trip_id})
    await db.bookings.insert_many(data.bookings)
    for collection in ("proposals", "messages", "agent_events", "trip_versions"):
        await db[collection].delete_many({"trip_id": trip_id})
    await db.demo_state.replace_one({"_id": "demo"}, {"_id": "demo", "weather": "clear"}, upsert=True)
    await ensure_indexes(db)
    return trip_id
