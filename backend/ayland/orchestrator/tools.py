"""The agent's tools (HANDBOOK §8.2). Local tools read our own MongoDB state, so they run in-process; the
travel-data and merchant tools live in their own MCP servers (D6), which the Claude CLI reaches over HTTP.

Each tool returns JSON with a short `summary` for the trace panel.
"""

import json
import re
from datetime import datetime
from typing import Any

from claude_agent_sdk import McpSdkServerConfig, SdkMcpTool, create_sdk_mcp_server, tool

from ayland import clock
from ayland.config import get_settings
from ayland.db import repo
from ayland.db.client import get_db
from ayland.mcp_servers.merchant.catalog import group_total, open_slots

SERVER = "ayland"
LOCAL = ("get_trip", "get_budget_status", "present_options")
REMOTE = {
    "travel-data": ("get_weather", "search_places", "get_route"),
    "merchant": ("search_offers", "get_offer", "check_availability"),
}
ALLOWED = [f"mcp__{SERVER}__{name}" for name in LOCAL] + [
    f"mcp__{server}__{name}" for server, names in REMOTE.items() for name in names
]
MAX_OPTIONS = 3

# Option cards built by present_options, waiting for the agent loop to emit them as the `options` event.
# One turn per trip runs at a time (Agent._turns), so one slot per trip is enough.
shown: dict[str, list[dict[str, Any]]] = {}


def mcp_servers(trip_id: str) -> dict[str, Any]:
    settings = get_settings()
    return {
        SERVER: build_server(trip_id),
        "travel-data": {"type": "http", "url": settings.mcp_travel_data_url},
        "merchant": {"type": "http", "url": settings.mcp_merchant_url},
    }


def _result(payload: dict[str, Any], error: bool = False) -> dict[str, Any]:
    content = [{"type": "text", "text": json.dumps(payload, ensure_ascii=False)}]
    return {"content": content, "is_error": True} if error else {"content": content}


def _lonlat(place: dict[str, Any]) -> dict[str, float]:
    lon, lat = place["location"]["coordinates"]
    return {"lon": lon, "lat": lat}


async def trip_snapshot(trip_id: str) -> dict[str, Any]:
    trip = await repo.get_trip(get_db(), trip_id)
    now = clock.now_iso()
    today = now[:10]
    items = repo.day_items(trip, today)
    later = [i for i in items if clock.minutes(i["start"]) >= clock.minutes(now) and i["status"] != "cancelled"]
    day_number = next((n for n, day in enumerate(trip["days"], 1) if day["date"] == today), None)
    return {
        "summary": f"{day_number}-р өдөр · {len(later)} хөтөлбөр үлдсэн" if day_number else "Өнөөдөр аяллын өдөр биш",
        "city": trip["destination"]["city"],
        "date": today,
        "day": f"{day_number} of {len(trip['days'])}" if day_number else "not a trip day (reseed the demo)",
        "now": clock.hhmm(now),
        "party_size": trip["party_size"],
        "hotel": {"name": trip["hotel"]["name"], **_lonlat(trip["hotel"])},
        "travelers": [{"name": t["name"], "interests": t["interests"]} for t in trip["travelers"]],
        "today": [
            {
                "item_id": i["item_id"],
                "time": f"{clock.hhmm(i['start'])}–{clock.hhmm(i['end'])}",
                "title": i["title"],
                "place": {"name": i["place"]["name"], **_lonlat(i["place"])},
                "indoor": i["indoor"],
                "status": i["status"],
                "cost_group_usd": repo.group_amount(i["cost"], trip["party_size"]),
            }
            for i in items
        ],
    }


async def budget_snapshot(trip_id: str) -> dict[str, Any]:
    trip = await repo.get_trip(get_db(), trip_id)
    budget = repo.day_budget(trip, clock.now_iso()[:10])
    return {
        "summary": f"Үлдэгдэл ${budget['remaining']:.0f}",
        "currency": "USD",
        "party_size": trip["party_size"],
        **budget,
    }


class OptionError(ValueError):
    """An option the model asked to show doesn't match the catalog (unknown offer, slot not offered)."""


def _slot_time(text: str) -> datetime | None:
    """The slot the model meant, as a local datetime: the ISO `start` from search_offers in any offset (or Z),
    or a bare "HH:MM" for today. None if it isn't a time at all."""
    bare = text.strip()
    if re.fullmatch(r"\d{1,2}:\d{2}", bare):
        text = clock.at(clock.today(), bare.zfill(5))
    try:
        moment = datetime.fromisoformat(text)
    except ValueError:
        return None
    return moment.astimezone(clock.HANOI) if moment.tzinfo else moment.replace(tzinfo=clock.HANOI)


async def build_options(trip_id: str, picks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """§8.4 `options` from the model's picks: the catalog supplies the offer, the slot and the price, so a card
    can never show a price or time the merchant didn't publish (§5.4 rule 1)."""
    if not 1 <= len(picks) <= MAX_OPTIONS:
        raise OptionError(f"Show 1 to {MAX_OPTIONS} options.")
    ids = [pick["offer_id"] for pick in picks]
    if len(set(ids)) != len(ids):
        raise OptionError("Show each offer once; pick its best slot.")
    db = get_db()
    trip = await repo.get_trip(db, trip_id)
    offers = {o["_id"]: o for o in await db.offers.find({"_id": {"$in": ids}}, {"embedding": 0}).to_list()}
    options = []
    for rank, pick in enumerate(picks, 1):
        offer = offers.get(pick["offer_id"])
        if offer is None:
            raise OptionError(f"No offer {pick['offer_id']!r}; use offer_id values from search_offers.")
        wanted = _slot_time(str(pick["slot_start"]))
        # Only a slot search_offers could have listed: not past, not started, with room for the whole party.
        day = wanted.date().isoformat() if wanted else ""
        not_before = clock.now_iso() if day == clock.today() else None
        fits = open_slots(offer, day, trip["party_size"], None, not_before) if day >= clock.today() else []
        slot = next((s for s in fits if datetime.fromisoformat(s.start) == wanted), None)
        if slot is None:
            raise OptionError(
                f"{pick['offer_id']} has no open slot for {trip['party_size']} at {pick['slot_start']}; "
                "use one that search_offers listed."
            )
        travel: dict[str, Any] = {"mode": pick["travel_mode"], "duration_min": int(pick["travel_min"])}
        if pick.get("travel_cost_usd"):
            travel["cost"] = {"amount": float(pick["travel_cost_usd"]), "currency": "USD", "per": "group"}
        options.append(
            {
                "rank": rank,
                "offer": offer,
                "slot_start": slot.start,
                "slot_end": slot.end,
                "price_total": {
                    "amount": group_total(offer["price"], trip["party_size"]),
                    "currency": "USD",
                    "per": "group",
                },
                "travel": travel,
                "reason": pick["reason"],
            }
        )
    return options


PRESENT_OPTIONS_SCHEMA = {
    "type": "object",
    "properties": {
        "options": {
            "type": "array",
            "minItems": 1,
            "maxItems": MAX_OPTIONS,
            "description": "Best first.",
            "items": {
                "type": "object",
                "properties": {
                    "offer_id": {"type": "string", "description": "From search_offers"},
                    "slot_start": {"type": "string", "description": "A slot `start` from search_offers, verbatim"},
                    "reason": {"type": "string", "description": "One short Mongolian sentence: why it fits them"},
                    "travel_mode": {"type": "string", "enum": ["walk", "drive"]},
                    "travel_min": {"type": "integer", "description": "From get_route"},
                    "travel_cost_usd": {"type": "number", "description": "Car fare for the group, from get_route"},
                },
                "required": ["offer_id", "slot_start", "reason", "travel_mode", "travel_min"],
            },
        }
    },
    "required": ["options"],
}


def build_server(trip_id: str) -> McpSdkServerConfig:
    """The tools are bound to one trip, so the model never has to pass (or guess) its id."""

    @tool("get_trip", "Today's plan (item ids, times, places with lon/lat), travelers, party size, the hotel.", {})
    async def get_trip(_: dict[str, Any]) -> dict[str, Any]:
        return _result(await trip_snapshot(trip_id))

    @tool("get_budget_status", "Today's budget in USD: limit, spent, booked, planned and remaining.", {})
    async def get_budget_status(_: dict[str, Any]) -> dict[str, Any]:
        return _result(await budget_snapshot(trip_id))

    @tool(
        "present_options",
        "Show up to three options to the travelers as cards in the app (title, time, travel, total price, reason).",
        PRESENT_OPTIONS_SCHEMA,
    )
    async def present_options(args: dict[str, Any]) -> dict[str, Any]:
        try:
            options = await build_options(trip_id, args.get("options", []))
        except OptionError as err:
            return _result({"summary": "Буруу сонголт", "error": str(err)}, error=True)
        shown[trip_id] = options
        listed = [
            f"{o['rank']}) {o['offer']['title_mn']} {clock.hhmm(o['slot_start'])}, ${o['price_total']['amount']:g}"
            for o in options
        ]
        return _result({"summary": f"{len(options)} хувилбар харууллаа", "shown": listed})

    tools: list[SdkMcpTool[Any]] = [get_trip, get_budget_status, present_options]
    return create_sdk_mcp_server(SERVER, tools=tools)


def display_name(sdk_name: str) -> str:
    """mcp__merchant__search_offers -> search_offers, the §8.2 name the frontend knows."""
    return sdk_name.split("__", 2)[-1] if sdk_name.startswith("mcp__") else sdk_name
