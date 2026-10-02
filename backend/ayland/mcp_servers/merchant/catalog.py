"""The merchant catalog's matching and ranking, kept free of I/O so it is testable offline (M2-B2).

MongoDB narrows the catalog (city, required tags, a 2dsphere "near" query); everything here runs on the result.
"""

import re
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from pydantic import BaseModel

from ayland import clock
from ayland.db.models import Money

# Mongolian (and English) words the travelers use, mapped to catalog tags. Stems, so "дотор" also matches
# "доторх". Semantic search (Atlas Vector Search, M3-B2) replaces this table later.
SYNONYMS: dict[str, tuple[str, ...]] = {
    "дотор": ("indoor",),
    "бороо": ("rainy-day", "indoor"),
    "хямд": ("budget",),
    "хоол": ("food",),
    "кофе": ("coffee",),
    "урлаг": ("art",),
    "зураг": ("art", "photography"),
    "түүх": ("history",),
    "музей": ("history", "culture"),
    "соёл": ("culture",),
    "уламжлал": ("culture",),
    "спорт": ("sport",),
    "адал": ("adventure",),
    "гэр бүл": ("family",),
    "хүүхэд": ("family",),
    "иллэг": ("wellness",),
    "массаж": ("wellness",),
    "амрах": ("wellness",),
    "тоглолт": ("show",),
    "театр": ("show", "culture"),
    "хөгжим": ("music",),
    "орой": ("evening",),
    "гадаа": ("outdoor",),
    "нисэх": ("airport", "transport"),
    "машин": ("transport",),
    "rain": ("rainy-day", "indoor"),
    "indoor": ("indoor",),
    "cheap": ("budget",),
}
WINDOW = re.compile(r"^\s*(\d{1,2}):(\d{2})\s*[-–—]\s*(\d{1,2}):(\d{2})\s*$")


@dataclass(frozen=True)
class Window:
    """A local time window in minutes after midnight; a slot fits when it starts and ends inside it."""

    start: int
    end: int

    @classmethod
    def parse(cls, text: str | None) -> "Window | None":
        if not text:
            return None
        match = WINDOW.match(text)
        if not match:
            raise ValueError(f"time_window {text!r} should look like 13:00-19:00")
        h1, m1, h2, m2 = (int(g) for g in match.groups())
        return cls(h1 * 60 + m1, h2 * 60 + m2)


class SlotOut(BaseModel):
    start: str
    end: str
    capacity_left: int


class OfferHit(BaseModel):
    offer_id: str
    title: str
    title_mn: str
    description: str
    category: str
    tags: list[str]
    price: Money
    price_per_person: float
    price_total: Money  # for the whole party
    rating: float
    address: str
    location: dict[str, Any]
    distance_m: int | None = None
    duration_min: int
    cancellation_policy: str
    slots: list[SlotOut]  # only the ones that fit the date, the window and the party


def per_person(price: dict[str, Any], party_size: int) -> float:
    return price["amount"] if price["per"] == "person" else price["amount"] / party_size


def group_total(price: dict[str, Any], party_size: int) -> float:
    return round(price["amount"] * party_size if price["per"] == "person" else price["amount"], 2)


def slot_end(start: str, duration_min: int) -> str:
    """ISO end time with the slot's offset; datetime arithmetic, so a late slot ends on the next day."""
    return (datetime.fromisoformat(start) + timedelta(minutes=duration_min)).isoformat()


def open_slots(
    offer: dict[str, Any], date: str, party_size: int, window: Window | None, not_before: str | None
) -> list[SlotOut]:
    """Slots on `date` with room for the party, inside the window, not already started."""
    fits = []
    for slot in offer.get("slots", []):
        start: str = slot["start"]
        if start[:10] != date or slot["capacity_left"] < party_size:
            continue
        begin = clock.minutes(start)
        end = begin + offer["duration_min"]
        if not_before and begin < clock.minutes(not_before):
            continue
        if window and not (window.start <= begin and end <= window.end):
            continue
        fits.append(
            SlotOut(start=start, end=slot_end(start, offer["duration_min"]), capacity_left=slot["capacity_left"])
        )
    return fits


def wanted_tags(query: str) -> set[str]:
    text = query.lower()
    return {tag for word, tags in SYNONYMS.items() if word in text for tag in tags}


def text_score(offer: dict[str, Any], query: str) -> float:
    """How well the offer matches the free text: tags implied by the words, plus words found in its text."""
    if not query.strip():
        return 0.0
    tags = set(offer.get("tags", []))
    implied = wanted_tags(query)
    haystack = " ".join((offer["title"], offer["title_mn"], offer.get("description", ""), *tags)).lower()
    words = [w for w in re.findall(r"\w{3,}", query.lower()) if w in haystack]
    return 1.5 * len(implied & tags) + len(words)


def rank(
    offers: list[dict[str, Any]],
    *,
    query: str = "",
    max_price_per_person: float | None = None,
    party_size: int = 1,
    date: str,
    window: Window | None = None,
    not_before: str | None = None,
    radius_m: int | None = None,
    limit: int = 5,
) -> list[OfferHit]:
    """Filter by price and availability, then rank by text match, rating and distance."""
    scored = []
    for offer in offers:
        price_pp = per_person(offer["price"], party_size)
        if max_price_per_person is not None and price_pp > max_price_per_person:
            continue
        slots = open_slots(offer, date, party_size, window, not_before)
        if not slots:
            continue
        distance = offer.get("distance_m")
        closeness = 1 - min(distance / radius_m, 1) if distance is not None and radius_m else 0
        score = text_score(offer, query) + offer["rating"] + closeness
        scored.append((score, offer, price_pp, slots, distance))
    scored.sort(key=lambda row: row[0], reverse=True)
    return [
        OfferHit(
            offer_id=offer["_id"],
            title=offer["title"],
            title_mn=offer["title_mn"],
            description=offer.get("description", ""),
            category=offer["category"],
            tags=offer.get("tags", []),
            price=Money.model_validate(offer["price"]),
            price_per_person=round(price_pp, 2),
            price_total=Money(amount=group_total(offer["price"], party_size), per="group"),
            rating=offer["rating"],
            address=offer["address"],
            location=offer["location"],
            distance_m=round(distance) if distance is not None else None,
            duration_min=offer["duration_min"],
            cancellation_policy=offer["cancellation_policy"],
            slots=slots,
        )
        for _, offer, price_pp, slots, distance in scored[:limit]
    ]
