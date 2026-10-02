"""Budget service (HANDBOOK M3-B1): what today and the whole trip have spent, committed and left, in USD.

One formula for everyone: the agent's get_budget_status, the plan and proposal checks, and the web app's
budget meter (frontend/src/lib/format.ts `dayBudget`, which must stay the same).
"""

from typing import Any, TypedDict


class DayBudget(TypedDict):
    limit: float
    spent: float  # done items
    booked: float  # booked items, paid or committed
    planned: float  # planned items, expected
    remaining: float  # free to spend today


class TripBudget(TypedDict):
    total: float
    spent: float
    remaining: float


def group_amount(money: dict[str, Any], party_size: int) -> float:
    """A price for the whole party, whichever way it is quoted."""
    return money["amount"] * party_size if money["per"] == "person" else money["amount"]


def day_items(trip: dict[str, Any], date: str) -> list[dict[str, Any]]:
    return next((day["items"] for day in trip["days"] if day["date"] == date), [])


def day(trip: dict[str, Any], date: str) -> DayBudget:
    """Cancelled items cost nothing; remaining is the daily limit minus everything else on the day."""
    items = day_items(trip, date)

    def total(status: str) -> float:
        return round(sum(group_amount(i["cost"], trip["party_size"]) for i in items if i["status"] == status), 2)

    spent, booked, planned = total("done"), total("booked"), total("planned")
    limit = trip["budget"]["daily_limit"]
    return {
        "limit": limit,
        "spent": spent,
        "booked": booked,
        "planned": planned,
        "remaining": round(limit - spent - booked - planned, 2),
    }


def whole_trip(trip: dict[str, Any]) -> TripBudget:
    budget = trip["budget"]
    return {
        "total": budget["total"],
        "spent": budget["spent"],
        "remaining": round(budget["total"] - budget["spent"], 2),
    }
