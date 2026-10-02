"""Reads and writes for the orchestrator (HANDBOOK §8.1 collections)."""

from datetime import UTC, datetime
from typing import Any, Literal

from pymongo.asynchronous.database import AsyncDatabase

from ayland import clock
from ayland.db import models

TRIP_ID = "trip_hanoi_demo"
Weather = Literal["clear", "rain"]


class TripNotFound(LookupError):
    """No such trip in MongoDB (run `npm run seed`)."""


async def get_trip(db: AsyncDatabase, trip_id: str) -> dict[str, Any]:
    trip = await db.trips.find_one({"_id": trip_id})
    if trip is None:
        raise TripNotFound(f"Trip {trip_id!r} not found. Run `npm run seed`.")
    return trip


async def get_weather(db: AsyncDatabase) -> Weather:
    state = await db.demo_state.find_one({"_id": "demo"})
    return "rain" if state and state.get("weather") == "rain" else "clear"


async def set_weather(db: AsyncDatabase, weather: Weather) -> None:
    await db.demo_state.update_one({"_id": "demo"}, {"$set": {"weather": weather}}, upsert=True)


async def trip_view(db: AsyncDatabase, trip_id: str) -> dict[str, Any]:
    """GET /api/trips/{trip_id} without `weather`, which the route adds from travel-data (§8.4 v1.1)."""
    trip = await get_trip(db, trip_id)
    bookings = await db.bookings.find({"trip_id": trip_id}).sort("created_at", 1).to_list()
    return {"trip": trip, "bookings": bookings, "now": clock.now_iso()}


def group_amount(money: dict[str, Any], party_size: int) -> float:
    return money["amount"] * party_size if money["per"] == "person" else money["amount"]


def day_items(trip: dict[str, Any], date: str) -> list[dict[str, Any]]:
    return next((day["items"] for day in trip["days"] if day["date"] == date), [])


def day_budget(trip: dict[str, Any], date: str) -> dict[str, float]:
    """Done items are spent, booked are committed, planned are expected; remaining is free to spend."""
    items = day_items(trip, date)

    def total(status: str) -> float:
        return sum(group_amount(i["cost"], trip["party_size"]) for i in items if i["status"] == status)

    spent, booked, planned = total("done"), total("booked"), total("planned")
    limit = trip["budget"]["daily_limit"]
    return {
        "limit": limit,
        "spent": spent,
        "booked": booked,
        "planned": planned,
        "remaining": limit - spent - booked - planned,
    }


def upcoming_outdoor(trip: dict[str, Any], now_iso: str) -> list[dict[str, Any]]:
    """Planned outdoor items from now on: what rain puts at risk."""
    now = clock.minutes(now_iso)
    items = day_items(trip, now_iso[:10])
    return [i for i in items if i["status"] == "planned" and not i["indoor"] and clock.minutes(i["start"]) >= now]


async def save_message(db: AsyncDatabase, trip_id: str, role: str, content: str, run_id: str) -> None:
    message = models.Message(trip_id=trip_id, role=role, content=content, run_id=run_id, ts=datetime.now(UTC))
    await db.messages.insert_one(message.to_mongo())


async def log_event(db: AsyncDatabase, trip_id: str, run_id: str, **fields: Any) -> None:
    """agent_events: every tool, A2A and plan action, for the trace and the judges (§5.4 rule 3)."""
    event = models.AgentEvent(trip_id=trip_id, run_id=run_id, ts=datetime.now(UTC), **fields)
    await db.agent_events.insert_one(event.to_mongo())
