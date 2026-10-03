"""Pydantic models for the HANDBOOK §8.1 collections: the contract every MongoDB write goes through.

Field names stay snake_case and `_id` stays `_id` in documents (§8 general rules); times are ISO 8601
with an offset, locations GeoJSON with longitude first.
"""

from datetime import date
from typing import Any, Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field


class Doc(BaseModel):
    # Unknown fields are a contract change (§8): fail loudly instead of storing them silently.
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    def to_mongo(self) -> dict[str, Any]:
        """The document as stored: `_id` by alias, times as ISO strings, unset optionals left out."""
        return self.model_dump(mode="json", by_alias=True, exclude_none=True)


class Money(Doc):
    amount: float = Field(ge=0)
    currency: Literal["USD"] = "USD"
    per: Literal["person", "group"]


class GeoPoint(Doc):
    type: Literal["Point"] = "Point"
    coordinates: tuple[float, float]  # (lon, lat)


class Place(Doc):
    name: str
    address: str
    location: GeoPoint


class PlanItem(Doc):
    item_id: str
    start: AwareDatetime
    end: AwareDatetime
    kind: Literal["activity", "meal", "transport", "stay", "free"]
    title: str
    place: Place
    cost: Money
    indoor: bool
    status: Literal["planned", "proposed", "booked", "cancelled", "done"]
    offer_id: str | None = None
    booking_id: str | None = None
    source: Literal["seed", "agent", "user"]


class TripDay(Doc):
    date: date
    items: list[PlanItem]


class Traveler(Doc):
    name: str
    interests: list[str] = []


class Destination(Doc):
    city: str
    country: str
    timezone: str
    location: GeoPoint


class Budget(Doc):
    currency: Literal["USD"] = "USD"
    total: float
    daily_limit: float
    spent: float


class Trip(Doc):
    id: str = Field(alias="_id")
    owner_id: str
    title: str
    destination: Destination
    travelers: list[Traveler]
    party_size: int = Field(ge=1)
    budget: Budget
    hotel: Place
    days: list[TripDay]
    version: int = Field(ge=0)
    updated_at: AwareDatetime


class Preferences(Doc):
    interests: list[str] = []
    food: list[str] = []
    pace: Literal["relaxed", "normal", "packed"] = "normal"
    notes: str = ""


class User(Doc):
    id: str = Field(alias="_id")
    name: str
    language: Literal["mn"] = "mn"
    preferences: Preferences = Preferences()


class Merchant(Doc):
    id: str = Field(alias="_id")
    name: str
    kind: str
    city: str
    contact: str = ""


class Slot(Doc):
    start: AwareDatetime
    capacity_left: int = Field(ge=0)


class Offer(Doc):
    id: str = Field(alias="_id")
    merchant_id: str
    city: str
    title: str
    title_mn: str
    description: str = ""
    category: Literal["activity", "food", "culture", "wellness", "transport"]
    tags: list[str] = []
    price: Money
    duration_min: int = Field(gt=0)
    location: GeoPoint
    address: str
    rating: float = Field(ge=0, le=5)
    opening_hours: str | None = None
    slots: list[Slot] = []
    cancellation_policy: str
    embedding: list[float] | None = None


class Proposal(Doc):
    id: str = Field(alias="_id")
    trip_id: str
    offer_id: str
    slot_start: AwareDatetime
    party_size: int = Field(ge=1)
    total: Money
    status: Literal["proposed", "approved", "rejected", "expired"]
    created_at: AwareDatetime


class Consent(Doc):
    approved_at: AwareDatetime
    method: Literal["tap", "voice"]


class Booking(Doc):
    id: str = Field(alias="_id")
    trip_id: str
    proposal_id: str
    offer_id: str
    status: Literal["held", "confirmed", "cancelled"]
    confirmation_code: str
    total: Money
    consent: Consent
    created_at: AwareDatetime


class Memory(Doc):
    user_id: str
    trip_id: str | None = None
    kind: Literal["preference", "fact", "feedback"]
    text: str
    embedding: list[float] | None = None
    created_at: AwareDatetime


class Message(Doc):
    trip_id: str
    role: Literal["user", "assistant"]
    content: str
    run_id: str | None = None
    ts: AwareDatetime

    def to_mongo(self) -> dict[str, Any]:
        # BSON dates (not strings) so the (trip_id, ts) index sorts chronologically.
        return {**super().to_mongo(), "ts": self.ts}


class AgentEvent(Doc):
    trip_id: str
    run_id: str
    type: Literal["tool", "a2a", "plan", "booking", "llm"]
    name: str
    input: dict[str, Any] | None = None
    output_summary: str = ""
    ok: bool = True
    ms: int | None = None
    ts: AwareDatetime

    def to_mongo(self) -> dict[str, Any]:
        # BSON date for the (trip_id, ts) index, as in Message.
        return {**super().to_mongo(), "ts": self.ts}
