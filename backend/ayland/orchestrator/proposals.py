"""Proposals (HANDBOOK M3-A2, §5.4 rule 2): the agent can only prepare a booking; the travelers approve it.

A proposal holds the offer, an open slot, the party and the total from the catalog. At most one is open per
trip: a new one expires the others, so a later "yes" can never approve a card the travelers no longer see.
Approving (M4) is the only path that books, and it is not a tool.
"""

import uuid
from typing import Any

from ayland import budget, clock
from ayland.db import models, repo
from ayland.db.client import get_db
from ayland.mcp_servers.merchant.catalog import group_total

from . import offers
from .audit import audit


async def propose(trip_id: str, offer_id: str, slot_start: str, party_size: int | None, run_id: str) -> dict[str, Any]:
    db = get_db()
    trip = await repo.get_trip(db, trip_id)
    offer = (await offers.find(db, [offer_id])).get(offer_id)
    if offer is None:
        raise offers.OfferError(f"No offer {offer_id!r}; use offer_id values from search_offers.")
    party = party_size or trip["party_size"]
    slot = offers.open_slot(offer, slot_start, party)
    total = group_total(offer["price"], party)
    proposal = models.Proposal.model_validate(
        {
            "_id": f"prp_{uuid.uuid4().hex[:8]}",
            "trip_id": trip_id,
            "offer_id": offer_id,
            "slot_start": slot.start,
            "party_size": party,
            "total": {"amount": total, "currency": "USD", "per": "group"},
            "status": "proposed",
            "created_at": clock.now_iso(),
        }
    ).to_mongo()
    await db.proposals.update_many({"trip_id": trip_id, "status": "proposed"}, {"$set": {"status": "expired"}})
    await db.proposals.insert_one(dict(proposal))
    remaining = budget.day(trip, slot.start[:10])["remaining"]
    summary = f"{offer['title_mn']} {clock.hhmm(slot.start)} · ${total:g} · зөвшөөрөл хүлээж байна"
    await audit(
        trip_id,
        run_id,
        type="booking",
        name="propose_booking",
        input={"offer_id": offer_id, "slot_start": slot.start, "party_size": party},
        output_summary=summary,
    )
    return {
        "summary": summary,
        "proposal": proposal,
        "offer": offer,
        "fits_budget": total <= remaining,
        "remaining_after_usd": round(remaining - total, 2),
    }


async def reject(proposal_id: str) -> dict[str, Any] | None:
    """Close an open proposal; None if it is unknown or already decided (approved, rejected or expired)."""
    proposal = await get_db().proposals.find_one_and_update(
        {"_id": proposal_id, "status": "proposed"}, {"$set": {"status": "rejected"}}, return_document=True
    )
    if proposal is not None:
        await audit(proposal["trip_id"], "consent", type="booking", name="reject_proposal", output_summary=proposal_id)
    return proposal
