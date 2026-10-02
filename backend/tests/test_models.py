from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from ayland.db import models
from ayland.demo.seed import load_seed, materialize

TODAY = "2026-10-05"


def test_the_seed_satisfies_the_contract() -> None:
    trip, offers, bookings = materialize(load_seed(), TODAY)
    models.Trip.model_validate(trip)
    for offer in offers:
        models.Offer.model_validate(offer)
    for booking in bookings:
        models.Booking.model_validate(booking)


def test_to_mongo_keeps_the_section_8_formats() -> None:
    trip, _, _ = materialize(load_seed(), TODAY)
    doc = models.Trip.model_validate(trip).to_mongo()
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
    trip, _, _ = materialize(load_seed(), TODAY)
    item = dict(trip["days"][2]["items"][0], start="2026-10-05T08:00:00")
    with pytest.raises(ValidationError):
        models.PlanItem.model_validate(item)


def test_message_keeps_a_bson_datetime_for_sorting() -> None:
    ts = datetime(2026, 10, 5, 3, 30, tzinfo=UTC)
    doc = models.Message(trip_id="t", role="user", content="Сайн уу", ts=ts).to_mongo()
    assert doc["ts"] is ts
    assert "run_id" not in doc
