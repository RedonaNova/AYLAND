"""Offers as the orchestrator's tools see them: only what the merchant catalog really has open (§5.4 rule 1)."""

from typing import Any

from pymongo.asynchronous.database import AsyncDatabase

from ayland import clock
from ayland.mcp_servers.merchant.catalog import SlotOut, open_slots

HIDDEN = {"embedding": 0}  # vectors are for search, not for cards or the model


class OfferError(ValueError):
    """The model referred to an offer or slot the catalog doesn't have open; the message tells it what to use."""


async def find(db: AsyncDatabase, offer_ids: list[str]) -> dict[str, dict[str, Any]]:
    return {o["_id"]: o for o in await db.offers.find({"_id": {"$in": offer_ids}}, HIDDEN).to_list()}


def open_slot(offer: dict[str, Any], slot_start: str, party_size: int) -> SlotOut:
    """The slot the model picked, if search_offers could have listed it: not past, not started, with room for
    the whole party. Matched as a time, so any offset, Z or a bare "HH:MM" for today works."""
    wanted = clock.parse_local(str(slot_start))
    day = wanted.date().isoformat() if wanted else ""
    today = clock.today()
    not_before = clock.now_iso() if day == today else None
    fits = open_slots(offer, day, party_size, None, not_before) if day >= today else []
    slot = next((s for s in fits if clock.parse_local(s.start) == wanted), None)
    if slot is None:
        raise OfferError(
            f"{offer['_id']} has no open slot for {party_size} at {slot_start}; use one that search_offers listed."
        )
    return slot
