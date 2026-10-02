"""M3-A1 and M3-B1 offline: plan change sets and the budget, on the seeded demo day (no MongoDB)."""

import pytest

from ayland import budget
from ayland.demo.seed import load_seed, materialize
from ayland.orchestrator.plan import PlanError, apply

TODAY = "2026-10-05"
TOMORROW = "2026-10-06"
DAY_5 = "2026-10-07"
NOW = f"{TODAY}T10:30:00+07:00"
CAFE = {"name": "Café Giảng", "lon": 105.8541, "lat": 21.0339}


def trip() -> dict:
    return materialize(load_seed(), TODAY).trip


def items(days: list[dict], date: str) -> dict[str, dict]:
    return {i["item_id"]: i for day in days if day["date"] == date for i in day["items"]}


def test_cancelling_the_rained_out_items_frees_their_cost() -> None:
    before = trip()
    plan = apply(before, [{"op": "cancel", "item_id": "d3-4"}, {"op": "cancel", "item_id": "d3-5"}], TODAY, NOW)
    today = items(plan.days, TODAY)
    assert today["d3-4"]["status"] == today["d3-5"]["status"] == "cancelled"
    assert plan.changed == ["d3-4", "d3-5"]
    assert budget.day({**before, "days": plan.days}, TODAY)["remaining"] == 140  # the $40 cyclo tour is freed
    assert items(before["days"], TODAY)["d3-4"]["status"] == "planned"  # the stored plan is untouched


def test_an_item_moves_within_the_day_and_to_another_day() -> None:
    moved = apply(trip(), [{"op": "move", "item_id": "d3-5", "start": "18:00", "end": "18:45"}], TODAY, NOW)
    assert items(moved.days, TODAY)["d3-5"]["start"] == f"{TODAY}T18:00:00+07:00"
    later = apply(
        trip(), [{"op": "move", "item_id": "d3-5", "date": DAY_5, "start": "13:00", "end": "14:00"}], TODAY, NOW
    )
    assert "d3-5" not in items(later.days, TODAY)
    assert items(later.days, DAY_5)["d3-5"]["end"] == f"{DAY_5}T14:00:00+07:00"


def test_adding_and_replacing_items() -> None:
    coffee = {
        "title": "Өндөгтэй кофе",
        "kind": "meal",
        "start": "16:30",
        "end": "17:15",
        "place": CAFE,
        "indoor": True,
        "cost": {"amount": 2, "per": "person"},
    }
    plan = apply(trip(), [{"op": "replace", "item_id": "d3-5", "item": coffee}], TODAY, NOW)
    today = items(plan.days, TODAY)
    added = today[plan.changed[1]]
    assert today["d3-5"]["status"] == "cancelled"
    assert (added["status"], added["source"], added["cost"]["amount"]) == ("planned", "agent", 2)
    assert [i["start"][11:16] for i in plan.days[2]["items"]] == sorted(
        i["start"][11:16] for i in plan.days[2]["items"]
    )


@pytest.mark.parametrize(
    ("change", "message"),
    [
        ({"op": "cancel", "item_id": "d3-1"}, "only planned items"),  # breakfast is done
        ({"op": "cancel", "item_id": "d4-1"}, "only planned items"),  # Ha Long is booked: consent gate
        ({"op": "cancel", "item_id": "nope"}, "No item"),
        ({"op": "move", "item_id": "d3-6", "start": "08:00", "end": "09:00"}, "in the past"),
        ({"op": "move", "item_id": "d3-6", "start": "15:00", "end": "16:00"}, "clashes with"),  # the cyclo tour
        ({"op": "move", "item_id": "d3-6", "start": "21:00", "end": "20:00"}, "end must come after"),
        (
            {
                "op": "add",
                "item": {
                    "title": "x",
                    "start": "13:00",
                    "end": "14:00",
                    "place": CAFE,
                    "indoor": True,
                    "offer_id": "off_puppet",
                },
            },
            "propose_booking",
        ),
        (
            {
                "op": "add",
                "date": TOMORROW,
                "item": {"title": "x", "start": "12:00", "end": "13:00", "place": CAFE, "indoor": True},
            },
            "clashes with",
        ),  # on the Ha Long boat
        (
            {
                "op": "add",
                "item": {
                    "title": "Хоол",
                    "start": "21:00",
                    "end": "22:00",
                    "place": CAFE,
                    "indoor": True,
                    "cost": {"amount": 30, "per": "person"},
                },
            },
            "over its",
        ),  # $120 > $100 left
        ({"op": "teleport"}, "Unknown op"),
    ],
)
def test_changes_the_plan_cant_take_are_refused_with_a_reason(change: dict, message: str) -> None:
    with pytest.raises(PlanError, match=message):
        apply(trip(), [change], TODAY, NOW)


def test_a_freed_budget_allows_the_new_item() -> None:
    dinner = {
        "title": "Хоол",
        "start": "21:00",
        "end": "22:00",
        "place": CAFE,
        "indoor": True,
        "cost": {"amount": 30, "per": "person"},
    }
    plan = apply(trip(), [{"op": "cancel", "item_id": "d3-4"}, {"op": "add", "item": dinner}], TODAY, NOW)
    assert budget.day({**trip(), "days": plan.days}, TODAY)["remaining"] == 20


def test_the_trip_budget() -> None:
    assert budget.whole_trip(trip()) == {"total": 2400, "spent": 1236, "remaining": 1164}
