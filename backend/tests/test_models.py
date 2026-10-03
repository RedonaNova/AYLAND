from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from ayland.db import models
from ayland.demo.seed import load_seed, materialize

TODAY = "2026-10-05"


def test_the_seed_satisfies_the_contract() -> None:
    materialize(load_seed(), TODAY).validated()


def test_the_seed_is_a_complete_demo_world() -> None:
    """M1-B2: the demo user, the merchants, and 25 to 30 offers with a good share of rainy-day options."""
    data = materialize(load_seed(), TODAY)
    assert data.user["_id"] == data.trip["owner_id"]
    assert 25 <= len(data.offers) <= 30
    assert {o["merchant_id"] for o in data.offers} == {m["_id"] for m in data.merchants}
    assert sum("rainy-day" in o["tags"] for o in data.offers) >= len(data.offers) // 2
    assert all(o["description"] and o["opening_hours"] for o in data.offers)


def test_offer_slots_repeat_on_each_slot_day() -> None:
    puppet = next(o for o in materialize(load_seed(), TODAY).offers if o["_id"] == "off_puppet")
    assert [s["start"][:10] for s in puppet["slots"]][::3] == ["2026-10-05", "2026-10-06", "2026-10-07"]


def test_to_mongo_keeps_the_section_8_formats() -> None:
    doc = models.Trip.model_validate(materialize(load_seed(), TODAY).trip).to_mongo()
    assert doc["_id"] == "trip_hanoi_demo"
    item = doc["days"][2]["items"][2]
    assert item["start"] == "2026-10-05T12:00:00+07:00"
    assert doc["days"][2]["date"] == TODAY
    assert doc["hotel"]["location"]["coordinates"] == [105.8522, 21.0341]  # lon, lat
    assert "offer_id" not in item  # unset optionals are left out


def test_unknown_fields_are_a_contract_change() -> None:
    with pytest.raises(ValidationError):
        models.Money(amount=10, per="person", currncy="USD")  # type: ignore[call-arg]


def test_money_needs_per_and_rejects_negative_amounts() -> None:
    with pytest.raises(ValidationError):
        models.Money(amount=10)  # type: ignore[call-arg]
    with pytest.raises(ValidationError):
        models.Money(amount=-1, per="group")


def test_plan_item_times_need_an_offset() -> None:
    trip = materialize(load_seed(), TODAY).trip
    item = dict(trip["days"][2]["items"][0], start="2026-10-05T08:00:00")
    with pytest.raises(ValidationError):
        models.PlanItem.model_validate(item)


def test_message_keeps_a_bson_datetime_for_sorting() -> None:
    ts = datetime(2026, 10, 5, 3, 30, tzinfo=UTC)
    doc = models.Message(trip_id="t", role="user", content="Сайн уу", ts=ts).to_mongo()
    assert doc["ts"] is ts
    assert "run_id" not in doc
