"""The agent's tools (HANDBOOK §8.2). Local tools read and change our own MongoDB state, so they run in-process;
the travel-data and merchant tools live in their own MCP servers (D6), which the Claude CLI reaches over HTTP.

Each tool returns JSON with a short `summary` for the trace panel. Tools that show something in the app
(option cards, an approval card) put the event in the trip's outbox; the agent loop sends it right after the
tool's result, so it lands in the turn that caused it.
"""

import json
from typing import Any

from claude_agent_sdk import McpSdkServerConfig, SdkMcpTool, create_sdk_mcp_server, tool

from ayland import budget, clock
from ayland.config import get_settings
from ayland.db import repo
from ayland.db.client import get_db
from ayland.mcp_servers.merchant.catalog import group_total

from . import memory, offers, plan, proposals

SERVER = "ayland"
LOCAL = (
    "get_trip",
    "get_budget_status",
    "present_options",
    "update_trip_plan",
    "undo_plan_change",
    "propose_booking",
    "remember",
)
REMOTE = {
    "travel-data": ("get_weather", "search_places", "get_route"),
    "merchant": ("search_offers", "get_offer", "check_availability"),
}
ALLOWED = [f"mcp__{SERVER}__{name}" for name in LOCAL] + [
    f"mcp__{server}__{name}" for server, names in REMOTE.items() for name in names
]
MAX_OPTIONS = 3
Event = dict[str, Any]

# Events waiting for the agent loop. One turn per trip runs at a time (Agent._turns), so per-trip lists suffice.
outbox: dict[str, list[Event]] = {}
# The run id of each trip's current turn, for agent_events written by the tools (set by Agent.run).
turn_runs: dict[str, str] = {}
# The user each trip's current turn speaks for (a welcome-flow visitor, or the trip owner), for `remember`.
turn_users: dict[str, str] = {}
MEMORY_MAX = 200


def emit(trip_id: str, kind: str, **data: Any) -> None:
    outbox.setdefault(trip_id, []).append({"type": kind, "data": data})


def mcp_servers(trip_id: str) -> dict[str, Any]:
    settings = get_settings()
    return {
        SERVER: build_server(trip_id),
        "travel-data": {"type": "http", "url": settings.mcp_travel_data_url},
        "merchant": {"type": "http", "url": settings.mcp_merchant_url},
    }


def _result(payload: dict[str, Any], error: bool = False) -> dict[str, Any]:
    content = [{"type": "text", "text": json.dumps(payload, ensure_ascii=False, default=str)}]
    return {"content": content, "is_error": True} if error else {"content": content}


def _refused(err: Exception) -> dict[str, Any]:
    """A change the tool won't make: a Mongolian line for the trace, the reason (English) for the model."""
    return _result({"summary": "Боломжгүй", "error": str(err)}, error=True)


def _lonlat(place: dict[str, Any]) -> dict[str, float]:
    lon, lat = place["location"]["coordinates"]
    return {"lon": lon, "lat": lat}


def _item(item: dict[str, Any], party_size: int) -> dict[str, Any]:
    return {
        "item_id": item["item_id"],
        "time": f"{clock.hhmm(item['start'])}–{clock.hhmm(item['end'])}",
        "title": item["title"],
        "kind": item["kind"],
        "place": {"name": item["place"]["name"], **_lonlat(item["place"])},
        "indoor": item["indoor"],
        "status": item["status"],
        "cost_group_usd": budget.group_amount(item["cost"], party_size),
    }


async def trip_snapshot(trip_id: str) -> dict[str, Any]:
    db = get_db()
    trip = await repo.get_trip(db, trip_id)
    now = clock.now_iso()
    today = now[:10]
    items = budget.day_items(trip, today)
    later = [i for i in items if clock.minutes(i["start"]) >= clock.minutes(now) and i["status"] != "cancelled"]
    day_number = next((n for n, day in enumerate(trip["days"], 1) if day["date"] == today), None)
    upcoming = [day for day in trip["days"] if day["date"] > today]
    open_proposal = await db.proposals.find_one({"trip_id": trip_id, "status": "proposed"})
    return {
        "summary": f"{day_number}-р өдөр · {len(later)} хөтөлбөр үлдсэн" if day_number else "Өнөөдөр аяллын өдөр биш",
        "city": trip["destination"]["city"],
        "date": today,
        "day": f"{day_number} of {len(trip['days'])}" if day_number else "not a trip day (reseed the demo)",
        "now": clock.hhmm(now),
        "plan_version": trip["version"],
        "party_size": trip["party_size"],
        "hotel": {"name": trip["hotel"]["name"], **_lonlat(trip["hotel"])},
        "travelers": [{"name": t["name"], "interests": t["interests"]} for t in trip["travelers"]],
        "today": [_item(i, trip["party_size"]) for i in items],
        "next_days": [
            {"date": day["date"], "items": [_item(i, trip["party_size"]) for i in day["items"]]} for day in upcoming
        ],
        "open_proposal": (
            {k: open_proposal[k] for k in ("_id", "offer_id", "slot_start", "party_size", "total")}
            if open_proposal
            else None
        ),
    }


async def budget_snapshot(trip_id: str) -> dict[str, Any]:
    trip = await repo.get_trip(get_db(), trip_id)
    today = budget.day(trip, clock.today())
    return {
        "summary": f"Үлдэгдэл ${today['remaining']:g}",
        "currency": "USD",
        "party_size": trip["party_size"],
        **today,
        "trip": budget.whole_trip(trip),
    }


async def build_options(trip_id: str, picks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """§8.4 `options` from the model's picks: the catalog supplies the offer, the slot and the price, so a card
    can never show a price or time the merchant didn't publish (§5.4 rule 1)."""
    if not 1 <= len(picks) <= MAX_OPTIONS:
        raise offers.OfferError(f"Show 1 to {MAX_OPTIONS} options.")
    ids = [pick["offer_id"] for pick in picks]
    if len(set(ids)) != len(ids):
        raise offers.OfferError("Show each offer once; pick its best slot.")
    db = get_db()
    trip = await repo.get_trip(db, trip_id)
    found = await offers.find(db, ids)
    options = []
    for rank, pick in enumerate(picks, 1):
        offer = found.get(pick["offer_id"])
        if offer is None:
            raise offers.OfferError(f"No offer {pick['offer_id']!r}; use offer_id values from search_offers.")
        slot = offers.open_slot(offer, pick["slot_start"], trip["party_size"])
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

NEW_ITEM = {
    "type": "object",
    "description": "A free or pay-on-site item (offers are booked with propose_booking instead).",
    "properties": {
        "title": {"type": "string", "description": "Mongolian"},
        "kind": {"type": "string", "enum": sorted(plan.KINDS)},
        "start": {"type": "string", "description": "HH:MM local"},
        "end": {"type": "string", "description": "HH:MM local"},
        "place": {
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "address": {"type": "string"},
                "lon": {"type": "number"},
                "lat": {"type": "number"},
            },
            "required": ["name", "lon", "lat"],
        },
        "cost": {
            "type": "object",
            "properties": {"amount": {"type": "number"}, "per": {"type": "string", "enum": ["person", "group"]}},
            "description": "USD; omit for free",
        },
        "indoor": {"type": "boolean"},
    },
    "required": ["title", "start", "end", "place", "indoor"],
}

UPDATE_PLAN_SCHEMA = {
    "type": "object",
    "properties": {
        "date": {"type": "string", "description": "YYYY-MM-DD for `add` without its own date; default today"},
        "reason": {"type": "string", "description": "Why, in a few words (e.g. 'rain')"},
        "changes": {
            "type": "array",
            "minItems": 1,
            "items": {
                "type": "object",
                "properties": {
                    "op": {"type": "string", "enum": ["cancel", "move", "add", "replace"]},
                    "item_id": {"type": "string", "description": "For cancel, move, replace: from get_trip"},
                    "date": {"type": "string", "description": "YYYY-MM-DD, to move or add to another trip day"},
                    "start": {"type": "string", "description": "For move: HH:MM"},
                    "end": {"type": "string", "description": "For move: HH:MM"},
                    "item": NEW_ITEM,
                },
                "required": ["op"],
            },
        },
    },
    "required": ["changes", "reason"],
}

PROPOSE_SCHEMA = {
    "type": "object",
    "properties": {
        "offer_id": {"type": "string", "description": "From search_offers or the option cards"},
        "slot_start": {"type": "string", "description": "The slot `start` the travelers chose, verbatim"},
        "party_size": {"type": "integer", "description": "Default: the whole party"},
    },
    "required": ["offer_id", "slot_start"],
}


REMEMBER_SCHEMA = {
    "type": "object",
    "properties": {
        "text": {"type": "string", "description": "One short Mongolian sentence, e.g. 'Ээж нь хол алхаж чаддаггүй.'"},
        "kind": {"type": "string", "enum": ["preference", "fact"]},
    },
    "required": ["text", "kind"],
}


async def remember_fact(trip_id: str, args: dict[str, Any]) -> dict[str, Any]:
    """The `remember` tool: one sentence about the traveler who is asking, kept for later turns and trips."""
    user_id = turn_users.get(trip_id, "")
    sentence = str(args.get("text", "")).strip()
    kind = "preference" if args.get("kind") == "preference" else "fact"
    if not user_id:
        return _refused(ValueError("No traveler to remember this for."))
    if not sentence or len(sentence) > MEMORY_MAX:
        return _refused(ValueError(f"Give one Mongolian sentence of at most {MEMORY_MAX} characters."))
    await memory.remember(get_db(), user_id, sentence, kind, trip_id)
    return _result({"summary": "Санах ойд хадгаллаа", "saved": sentence})


def build_server(trip_id: str) -> McpSdkServerConfig:
    """The tools are bound to one trip, so the model never has to pass (or guess) its id. `run_id` for
    agent_events is the trip's current turn, which the agent loop records in `turn_runs`."""

    @tool(
        "get_trip",
        "Today's plan and the next days (item ids, times, places with lon/lat, status), travelers, party size,"
        " the hotel, and an open booking proposal if there is one.",
        {},
    )
    async def get_trip(_: dict[str, Any]) -> dict[str, Any]:
        return _result(await trip_snapshot(trip_id))

    @tool("get_budget_status", "Budget in USD: today's limit, spent, booked, planned, remaining; and the trip's.", {})
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
        except offers.OfferError as err:
            return _refused(err)
        emit(trip_id, "options", run_id=turn_runs.get(trip_id, ""), options=options)
        listed = [
            f"{o['rank']}) {o['offer']['title_mn']} {clock.hhmm(o['slot_start'])}, ${o['price_total']['amount']:g}"
            for o in options
        ]
        return _result({"summary": f"{len(options)} хувилбар харууллаа", "shown": listed})

    @tool(
        "update_trip_plan",
        "Change the plan without spending money: cancel, move, add or replace planned items (never booked ones)."
        " Every change is a new version the travelers can undo.",
        UPDATE_PLAN_SCHEMA,
    )
    async def update_trip_plan(args: dict[str, Any]) -> dict[str, Any]:
        try:
            result = await plan.update(
                trip_id, args.get("changes", []), args.get("reason", ""), turn_runs.get(trip_id, ""), args.get("date")
            )
        except plan.PlanError as err:
            return _refused(err)
        except KeyError as err:
            return _refused(plan.PlanError(f"Missing field {err}"))
        return _result(result)

    @tool("undo_plan_change", "Bring back the plan as it was before the last change (call again to redo).", {})
    async def undo_plan_change(_: dict[str, Any]) -> dict[str, Any]:
        try:
            return _result(await plan.revert(trip_id, turn_runs.get(trip_id, "")))
        except plan.PlanError as err:
            return _refused(err)

    @tool(
        "propose_booking",
        "Prepare a booking for the travelers to approve: shows an approval card. Nothing is booked or paid until"
        " they tap Approve; a new proposal replaces any open one.",
        PROPOSE_SCHEMA,
    )
    async def propose_booking(args: dict[str, Any]) -> dict[str, Any]:
        try:
            result = await proposals.propose(
                trip_id, args["offer_id"], args["slot_start"], args.get("party_size"), turn_runs.get(trip_id, "")
            )
        except offers.OfferError as err:
            return _refused(err)
        # The offer rides along, so the approval card can show it even without option cards in this chat.
        emit(trip_id, "proposal.created", proposal=result["proposal"], offer=result["offer"])
        return _result({k: v for k, v in result.items() if k != "offer"})

    @tool(
        "remember",
        "Save a lasting preference or fact the traveler told you about themselves or their group, for this and"
        " future trips.",
        REMEMBER_SCHEMA,
    )
    async def remember(args: dict[str, Any]) -> dict[str, Any]:
        return await remember_fact(trip_id, args)

    tools: list[SdkMcpTool[Any]] = [
        get_trip,
        get_budget_status,
        present_options,
        update_trip_plan,
        undo_plan_change,
        propose_booking,
        remember,
    ]
    return create_sdk_mcp_server(SERVER, tools=tools)


def display_name(sdk_name: str) -> str:
    """mcp__merchant__search_offers -> search_offers, the §8.2 name the frontend knows."""
    return sdk_name.split("__", 2)[-1] if sdk_name.startswith("mcp__") else sdk_name
