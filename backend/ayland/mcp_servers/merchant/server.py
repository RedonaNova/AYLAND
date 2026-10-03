"""MCP server `merchant` (HANDBOOK §8.2, M2-B2): the offer catalog and its availability, from MongoDB.

    uv run uvicorn ayland.mcp_servers.merchant.server:app --port 8202      (MCP endpoint: /mcp)

Try it in the MCP Inspector: `npx @modelcontextprotocol/inspector`, transport "Streamable HTTP",
URL http://localhost:8202/mcp.
"""

from typing import Annotated, Any

from mcp.server import MCPServer
from pydantic import BaseModel, Field

from ayland import clock
from ayland.db.client import get_db

from ..common import Point, ToolError
from . import catalog

mcp = MCPServer(
    "merchant",
    version="0.1.0",
    instructions="Bookable offers from local merchants (activities, food, culture, wellness, transport). USD.",
)
HIDDEN = {"embedding": 0}  # vectors (M3-B2) are for search, not for the model's context


class OfferSearch(BaseModel):
    summary: str
    date: str
    party_size: int
    offers: list[catalog.OfferHit]


class OfferDetail(BaseModel):
    summary: str
    offer: dict[str, Any]


class Availability(BaseModel):
    summary: str
    offer_id: str
    date: str
    party_size: int
    slots: list[catalog.SlotOut]


def _day(date: str | None) -> tuple[str, str | None]:
    """The date to search, and "now" when it is today (slots that already started are gone)."""
    today = clock.today()
    day = date or today
    return day, (clock.now_iso() if day == today else None)


async def _candidates(city: str, tags: list[str], near: Point | None, radius_m: int) -> list[dict[str, Any]]:
    query: dict[str, Any] = {"city": city}
    if tags:
        query["tags"] = {"$all": tags}
    offers = get_db().offers
    if near is None:
        return await offers.find(query, HIDDEN).to_list()
    geo_near = {"near": near.geojson(), "distanceField": "distance_m", "maxDistance": radius_m, "query": query}
    cursor = await offers.aggregate([{"$geoNear": geo_near}, {"$project": HIDDEN}])
    return await cursor.to_list()


async def _offer(offer_id: str) -> dict[str, Any]:
    offer = await get_db().offers.find_one({"_id": offer_id}, HIDDEN)
    if offer is None:
        raise ToolError(f"No offer {offer_id!r}.")
    return offer


@mcp.tool()
async def search_offers(
    query: Annotated[str, Field(description="Free text in Mongolian or English, e.g. 'бороотой өдөр дотор'")] = "",
    city: str = "Hanoi",
    tags: Annotated[list[str] | None, Field(description="All required, e.g. ['indoor']")] = None,
    max_price_per_person: Annotated[float | None, Field(ge=0, description="USD")] = None,
    party_size: Annotated[int, Field(ge=1, le=20)] = 1,
    near: Annotated[Point | None, Field(description="Rank by distance from here, e.g. the hotel")] = None,
    radius_m: Annotated[int, Field(ge=100, le=50_000)] = 8000,
    time_window: Annotated[str | None, Field(description="Local, e.g. '13:00-19:00'")] = None,
    date: Annotated[str | None, Field(description="YYYY-MM-DD, default today")] = None,
    limit: Annotated[int, Field(ge=1, le=10)] = 5,
) -> OfferSearch:
    """Bookable offers that fit the budget, the party and the time, best first, each with its price for the whole
    party (`price_total`) and the slots still open."""
    try:
        window = catalog.Window.parse(time_window)
    except ValueError as err:
        raise ToolError(str(err)) from err
    day, not_before = _day(date)
    candidates = await _candidates(city, tags or [], near, radius_m)
    hits = catalog.rank(
        candidates,
        query=query,
        max_price_per_person=max_price_per_person,
        party_size=party_size,
        date=day,
        window=window,
        not_before=not_before,
        radius_m=radius_m if near else None,
        limit=limit,
    )
    summary = f"{len(hits)} санал олдлоо" if hits else "Тохирох санал олдсонгүй"
    return OfferSearch(summary=summary, date=day, party_size=party_size, offers=hits)


@mcp.tool()
async def get_offer(offer_id: str) -> OfferDetail:
    """Everything about one offer, including all its slots."""
    offer = await _offer(offer_id)
    return OfferDetail(summary=offer["title_mn"], offer=offer)


@mcp.tool()
async def check_availability(
    offer_id: str,
    date: Annotated[str | None, Field(description="YYYY-MM-DD, default today")] = None,
    party_size: Annotated[int, Field(ge=1, le=20)] = 1,
) -> Availability:
    """The offer's slots on that date that still have room for the whole party."""
    offer = await _offer(offer_id)
    day, not_before = _day(date)
    slots = catalog.open_slots(offer, day, party_size, None, not_before)
    summary = " · ".join(clock.hhmm(s.start) for s in slots) or "Сул суудал алга"
    return Availability(summary=summary, offer_id=offer_id, date=day, party_size=party_size, slots=slots)


app = mcp.streamable_http_app(stateless_http=True, json_response=True)
