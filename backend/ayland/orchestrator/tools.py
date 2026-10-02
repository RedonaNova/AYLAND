"""Orchestrator local tools (HANDBOOK §8.2): they read our own MongoDB state, so they run in-process.

Each tool returns JSON with a short `summary` for the trace panel.
"""

import json
from typing import Any

from claude_agent_sdk import McpSdkServerConfig, SdkMcpTool, create_sdk_mcp_server, tool

from ayland import clock
from ayland.db import repo
from ayland.db.client import get_db

SERVER = "ayland"
NAMES = ("get_trip", "get_budget_status")
_PREFIX = f"mcp__{SERVER}__"
ALLOWED = [f"{_PREFIX}{name}" for name in NAMES]


def _result(payload: dict[str, Any]) -> dict[str, Any]:
    return {"content": [{"type": "text", "text": json.dumps(payload, ensure_ascii=False)}]}


async def trip_snapshot(trip_id: str) -> dict[str, Any]:
    db = get_db()
    trip = await repo.get_trip(db, trip_id)
    now = clock.now_iso()
    today = now[:10]
    items = repo.day_items(trip, today)
    later = [i for i in items if clock.minutes(i["start"]) >= clock.minutes(now) and i["status"] != "cancelled"]
    weather = repo.WEATHER_VIEW[await repo.get_weather(db)]
    day_number = next((n for n, day in enumerate(trip["days"], 1) if day["date"] == today), None)
    return {
        "summary": f"{day_number}-р өдөр · {len(later)} хөтөлбөр үлдсэн" if day_number else "Өнөөдөр аяллын өдөр биш",
        "city": trip["destination"]["city"],
        "day": f"{day_number} of {len(trip['days'])}" if day_number else "not a trip day (reseed the demo)",
        "now": clock.hhmm(now),
        "hotel": trip["hotel"]["name"],
        "travelers": [{"name": t["name"], "interests": t["interests"]} for t in trip["travelers"]],
        "weather_now": weather,
        "today": [
            {
                "time": f"{clock.hhmm(i['start'])}–{clock.hhmm(i['end'])}",
                "title": i["title"],
                "place": i["place"]["name"],
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


def build_server(trip_id: str) -> McpSdkServerConfig:
    """The tools are bound to one trip, so the model never has to pass (or guess) its id."""

    @tool("get_trip", "Today's plan, travelers, hotel and current weather for this trip, from MongoDB.", {})
    async def get_trip(_: dict[str, Any]) -> dict[str, Any]:
        return _result(await trip_snapshot(trip_id))

    @tool("get_budget_status", "Today's budget in USD: limit, spent, booked, planned and remaining.", {})
    async def get_budget_status(_: dict[str, Any]) -> dict[str, Any]:
        return _result(await budget_snapshot(trip_id))

    tools: list[SdkMcpTool[Any]] = [get_trip, get_budget_status]
    return create_sdk_mcp_server(SERVER, tools=tools)


def display_name(sdk_name: str) -> str:
    """mcp__ayland__get_trip -> get_trip, the §8.2 name the frontend knows."""
    return sdk_name.removeprefix(_PREFIX)
