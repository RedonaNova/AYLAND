"""Versioned, reversible plan changes (HANDBOOK M3-A1, §5.4 rule 2).

Plan edits that spend no money need no approval because every version is kept: a change set is applied to a
copy of the plan, checked (times, overlaps, each touched day's budget), written as the next `version`, and the previous
days are stored in `trip_versions`. `revert` brings the previous version back as a new version, so an undo
can itself be undone. Booked items are out of reach here: a booking changes only through the consent gate.
"""

import copy
import uuid
from datetime import UTC, datetime
from typing import Any

from pydantic import ValidationError

from ayland import budget, clock
from ayland.db import models, repo
from ayland.db.client import get_db

from .audit import audit
from .events import trip_events

EDITABLE = {"planned"}  # what the agent may cancel, move or replace
BUSY = {"planned", "booked", "proposed"}  # what occupies time on the timeline
KINDS = {"activity", "meal", "transport", "stay", "free"}


class PlanError(ValueError):
    """A change the plan can't take; the message tells the model what to fix."""


def _minutes(hhmm: str) -> int:
    try:
        hours, minutes = (int(part) for part in hhmm.split(":"))
    except ValueError:
        raise PlanError(f"Times are HH:MM, got {hhmm!r}.") from None
    if not (0 <= hours < 24 and 0 <= minutes < 60):
        raise PlanError(f"Times are HH:MM, got {hhmm!r}.")
    return hours * 60 + minutes


def _times(date: str, start: str, end: str) -> tuple[str, str]:
    if _minutes(end) <= _minutes(start):
        raise PlanError(f"{start}–{end}: the end must come after the start.")
    return clock.at(date, start.zfill(5)), clock.at(date, end.zfill(5))


def _new_item(spec: dict[str, Any], date: str) -> dict[str, Any]:
    """A plan item the agent adds: always `planned`, never linked to an offer (offers go through propose_booking)."""
    if spec.get("offer_id"):
        raise PlanError("Offers from search_offers are added by booking them: use propose_booking.")
    kind = spec.get("kind", "activity")
    if kind not in KINDS:
        raise PlanError(f"kind must be one of {', '.join(sorted(KINDS))}.")
    place = spec.get("place") or {}
    if "lon" not in place or "lat" not in place:
        raise PlanError("A new item needs place.lon and place.lat (from get_trip, search_places or search_offers).")
    start, end = _times(date, spec["start"], spec["end"])
    cost = spec.get("cost") or {"amount": 0, "per": "group"}
    return {
        "item_id": f"itm_{uuid.uuid4().hex[:6]}",
        "start": start,
        "end": end,
        "kind": kind,
        "title": spec["title"],
        "place": {
            "name": place.get("name", spec["title"]),
            "address": place.get("address", ""),
            "location": {"type": "Point", "coordinates": [place["lon"], place["lat"]]},
        },
        "cost": {"amount": float(cost.get("amount", 0)), "currency": "USD", "per": cost.get("per", "group")},
        "indoor": bool(spec.get("indoor", True)),
        "status": "planned",
        "source": "agent",
    }


class _Plan:
    """A working copy of the trip's days that change sets are applied to."""

    def __init__(self, trip: dict[str, Any]) -> None:
        self.trip = trip
        self.days = copy.deepcopy(trip["days"])
        self.changed: list[str] = []
        self.placed: list[tuple[str, dict[str, Any]]] = []  # (date, item) added or moved: checked for clashes

    def day(self, date: str) -> list[dict[str, Any]]:
        for day in self.days:
            if day["date"] == date:
                return day["items"]
        raise PlanError(f"{date} is not a day of this trip.")

    def take(self, item_id: str) -> tuple[str, dict[str, Any]]:
        """The editable item and its date."""
        for day in self.days:
            for item in day["items"]:
                if item["item_id"] == item_id:
                    if item["status"] not in EDITABLE:
                        raise PlanError(
                            f"{item_id} is {item['status']}; only planned items can be changed here"
                            " (a booking changes only with the travelers' approval)."
                        )
                    return day["date"], item
        raise PlanError(f"No item {item_id!r}; use item_id values from get_trip.")

    def add(self, date: str, item: dict[str, Any]) -> None:
        self.day(date).append(item)
        self.placed.append((date, item))
        self.changed.append(item["item_id"])

    def cancel(self, item_id: str) -> str:
        """Cancel an editable item; returns its date (where a replacement goes by default)."""
        date, item = self.take(item_id)
        item["status"] = "cancelled"
        self.changed.append(item["item_id"])
        return date

    def move(self, item_id: str, to_date: str | None, start: str, end: str) -> None:
        """New times for an editable item, on its own day unless `to_date` names another trip day."""
        date, item = self.take(item_id)
        to_date = to_date or date
        item["start"], item["end"] = _times(to_date, start, end)
        if to_date != date:
            self.day(date).remove(item)
            self.day(to_date).append(item)
        self.placed.append((to_date, item))
        self.changed.append(item_id)

    def apply(self, change: dict[str, Any], default_date: str) -> None:
        op = change.get("op")
        if op == "cancel":
            self.cancel(change["item_id"])
        elif op == "move":
            self.move(change["item_id"], change.get("date"), change["start"], change["end"])
        elif op == "add":
            date = change.get("date") or default_date
            self.add(date, _new_item(change["item"], date))
        elif op == "replace":
            date = self.cancel(change["item_id"])
            new_date = change.get("date") or date
            self.add(new_date, _new_item(change["item"], new_date))
        else:
            raise PlanError(f"Unknown op {op!r}; use cancel, move, add or replace.")

    def check(self, now_iso: str) -> None:
        """New and moved items: not in the past, not clashing with anything still on the timeline."""
        now = clock.parse_local(now_iso)
        for date, item in self.placed:
            if item["status"] == "cancelled":  # placed, then cancelled later in the same change set
                continue
            if clock.parse_local(item["start"]) < now:
                raise PlanError(f"{item['title']} would start in the past ({clock.hhmm(item['start'])}).")
            for other in self.day(date):
                if other is item or other["status"] not in BUSY:
                    continue
                if other["start"] < item["end"] and item["start"] < other["end"]:
                    raise PlanError(
                        f"{item['title']} ({clock.hhmm(item['start'])}–{clock.hhmm(item['end'])}) clashes with"
                        f" {other['title']} ({clock.hhmm(other['start'])}–{clock.hhmm(other['end'])});"
                        " move or cancel it."
                    )

    def check_budget(self) -> None:
        """No day that gets a new or moved item may end up over its limit, or further over it than before."""
        after = {**self.trip, "days": self.days}
        for date in {date for date, _ in self.placed}:
            before, left = budget.day(self.trip, date)["remaining"], budget.day(after, date)["remaining"]
            if left < 0 and left < before:
                raise PlanError(f"That puts {date} ${-left:.2f} over its ${after['budget']['daily_limit']:g} limit.")


def apply(trip: dict[str, Any], changes: list[dict[str, Any]], default_date: str, now_iso: str) -> _Plan:
    """The checked change set, not yet saved (pure: offline tests run on the seed)."""
    if not changes:
        raise PlanError("No changes given.")
    plan = _Plan(trip)
    for change in changes:
        plan.apply(change, default_date)
    for day in plan.days:
        day["items"].sort(key=lambda item: item["start"])
    plan.check(now_iso)
    plan.check_budget()
    return plan


async def _save(
    trip: dict[str, Any], days: list[dict[str, Any]], changed: list[str], reason: str, run_id: str, tool: str
) -> dict[str, Any]:
    """Write the next version (only if nobody wrote one meanwhile), keep the previous one, tell the UI."""
    db = get_db()
    version = trip["version"] + 1
    try:
        stored = models.Trip.model_validate({**trip, "days": days, "version": version, "updated_at": clock.now_iso()})
    except ValidationError as err:
        raise PlanError(f"That plan isn't valid: {err.errors()[0]['msg']}.") from err
    doc = stored.to_mongo()
    result = await db.trips.update_one(
        {"_id": trip["_id"], "version": trip["version"]},
        {"$set": {"days": doc["days"], "version": version, "updated_at": doc["updated_at"]}},
    )
    if result.modified_count != 1:
        raise PlanError("The plan changed meanwhile; call get_trip and try again.")
    await db.trip_versions.insert_one(
        {
            "trip_id": trip["_id"],
            "version": trip["version"],
            "days": trip["days"],
            "reason": reason,
            "ts": datetime.now(UTC),
        }
    )
    trip_events.publish(
        trip["_id"],
        {"type": "plan.updated", "data": {"trip_id": trip["_id"], "version": version, "changed_item_ids": changed}},
    )
    summary = f"v{trip['version']} → v{version} · {len(changed)} өөрчлөлт"
    await audit(
        trip["_id"],
        run_id,
        type="plan",
        name=tool,
        input={"reason": reason, "changed": changed},
        output_summary=summary,
    )
    return {
        "summary": summary,
        "version": version,
        "changed_item_ids": changed,
        "budget_today": budget.day(doc, clock.today()),
    }


async def update(
    trip_id: str, changes: list[dict[str, Any]], reason: str, run_id: str, date: str | None = None
) -> dict[str, Any]:
    trip = await repo.get_trip(get_db(), trip_id)
    plan = apply(trip, changes, date or clock.today(), clock.now_iso())
    return await _save(trip, plan.days, plan.changed, reason, run_id, "update_trip_plan")


def _booked(days: list[dict[str, Any]]) -> set[str]:
    return {item["item_id"] for day in days for item in day["items"] if item["status"] == "booked"}


async def revert(trip_id: str, run_id: str) -> dict[str, Any]:
    """Back to the version before the current one (and again, to undo the undo)."""
    db = get_db()
    trip = await repo.get_trip(db, trip_id)
    previous = await db.trip_versions.find_one({"trip_id": trip_id}, sort=[("version", -1)])
    if previous is None:
        raise PlanError("There is no earlier version of the plan to go back to.")
    if _booked(previous["days"]) != _booked(trip["days"]):
        raise PlanError("A booking was made or cancelled since then, so that version can't come back.")
    before = {i["item_id"]: i for day in trip["days"] for i in day["items"]}
    after = {i["item_id"]: i for day in previous["days"] for i in day["items"]}
    changed = sorted(item_id for item_id in before.keys() | after.keys() if before.get(item_id) != after.get(item_id))
    return await _save(trip, previous["days"], changed, f"undo to v{previous['version']}", run_id, "undo_plan_change")
