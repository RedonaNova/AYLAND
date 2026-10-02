"""M2-B3 smoke tests: both MCP servers in-memory, plus the pure parts of their tools. No network, no MongoDB."""

from datetime import UTC, datetime

import pytest
from mcp import Client

from ayland.demo.seed import load_seed, materialize
from ayland.mcp_servers.common import Point
from ayland.mcp_servers.merchant import catalog
from ayland.mcp_servers.merchant.server import mcp as merchant
from ayland.mcp_servers.travel_data import places, routes, weather
from ayland.mcp_servers.travel_data.server import mcp as travel_data

TODAY = "2026-10-05"
HOTEL = Point(lon=105.8522, lat=21.0341)
PUPPETS = Point(lon=105.8532, lat=21.0318)
MUSEUM = Point(lon=105.7985, lat=21.0404)


async def tool_names(server) -> set[str]:
    async with Client(server) as client:
        return {tool.name for tool in (await client.list_tools()).tools}


async def test_both_servers_publish_the_section_8_2_tools() -> None:
    assert await tool_names(travel_data) == {"get_weather", "search_places", "get_route"}
    assert await tool_names(merchant) == {"search_offers", "get_offer", "check_availability"}


async def test_get_route_falls_back_to_an_estimate_without_network(monkeypatch: pytest.MonkeyPatch) -> None:
    def offline(*_: object, **__: object) -> None:
        raise routes.httpx.ConnectError("offline")

    monkeypatch.setattr(routes, "http", offline)
    async with Client(travel_data) as client:
        result = await client.call_tool(
            "get_route", {"origin": HOTEL.model_dump(), "destination": PUPPETS.model_dump()}
        )
    assert not result.is_error
    assert result.structured_content["source"] == "estimate"
    assert result.structured_content["mode"] == "walk"
    assert result.structured_content["duration_min"] <= 10  # about 270 m, a few minutes on foot


def test_driving_estimates_include_a_group_fare() -> None:
    drive = routes.estimate(HOTEL, MUSEUM, "drive")
    assert drive.cost is not None and drive.cost.per == "group"
    assert 15 <= drive.duration_min <= 40  # ~5.8 km across town
    assert routes.taxi_fare(0) == 2.0 and routes.taxi_fare(10_000) == 6.5


def test_demo_rain_lasts_until_six_and_reads_in_mongolian(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(weather.clock, "now_iso", lambda: f"{TODAY}T10:30:00+07:00")
    rain = weather.scenario_report("hanoi_rain", "rain", hours_ahead=8)
    assert (rain.condition, rain.precip_prob, rain.until, rain.scenario) == ("rain", 90, "18:00", True)
    assert rain.summary == "Бороо 90% · 26°C · 18:00 хүртэл"
    assert [h.time for h in rain.hourly][:2] == ["10:00", "11:00"]
    clear = weather.scenario_report("hanoi_rain", "clear", hours_ahead=2)
    assert clear.view() == {"condition": "clouds", "temp_c": 29, "precip_prob": 10, "scenario": True}


FORECAST = {
    "utc_offset_seconds": 7 * 3600,
    "current": {"time": "2026-10-05T22:15"},  # cached a while ago: the clock decides what "now" is
    "hourly": {
        "time": ["2026-10-05T22:00", "2026-10-05T23:00", "2026-10-06T00:00"],
        "weather_code": [0, 61, 3],
        "precipitation_probability": [0, 80, None],
        "temperature_2m": [25.0, 24.5, 24.0],
    },
}


def test_open_meteo_payload_is_read_from_the_current_hour() -> None:
    hours = weather.parse_forecast(FORECAST, now_utc=datetime(2026, 10, 5, 16, 15, tzinfo=UTC))  # 23:15 local
    assert [(h.time, h.condition, h.precip_prob) for h in hours] == [("23:00", "rain", 80), ("00:00", "clouds", 0)]
    assert weather.summarize(hours, 4, city="Hanoi", scenario=False, source="open-meteo").until == "00:00"
    assert weather.parse_forecast(FORECAST, now_utc=datetime(2026, 10, 7, tzinfo=UTC)) == []  # too old to use


def test_the_demo_city_is_recognized_by_name_or_by_coordinates() -> None:
    scenario = weather.load_scenario("hanoi_rain")
    assert weather.in_scenario(scenario, city="Ханой")
    assert weather.in_scenario(scenario, city="Hanoi, Vietnam")
    assert weather.in_scenario(scenario, lat=HOTEL.lat, lon=HOTEL.lon)  # the hotel, as get_trip gives it
    assert not weather.in_scenario(scenario, city="Ulaanbaatar")
    assert not weather.in_scenario(scenario, lat=47.92, lon=106.92)


def test_a_late_slot_ends_on_the_next_day() -> None:
    assert catalog.slot_end("2026-10-05T23:30:00+07:00", 60) == "2026-10-06T00:30:00+07:00"
    assert catalog.slot_end("2026-10-05T15:00:00+07:00", 50) == "2026-10-05T15:50:00+07:00"


def test_overpass_query_escapes_names_and_parses_nearest_first() -> None:
    query = places.overpass_query(HOTEL, 800, "cafe", 'Giảng (cafe)"', 5)
    assert '["amenity"="cafe"]' in query and r"Giảng \(cafe\)\"" in query and "(around:800,21.0341,105.8522)" in query
    elements = [
        {"type": "way", "center": {"lat": 21.0339, "lon": 105.8541}, "tags": {"name": "Café Giảng"}},
        {"type": "node", "lat": 21.0342, "lon": 105.8523, "tags": {"name": "Next door", "addr:street": "Hàng Bạc"}},
        {"type": "node", "lat": 21.0, "lon": 105.0, "tags": {}},  # unnamed: skipped
    ]
    hits = places.parse(elements, HOTEL, "cafe", 5)
    assert [h.name for h in hits] == ["Next door", "Café Giảng"]
    assert hits[0].address == "Hàng Bạc"


def _offers() -> list[dict]:
    return materialize(load_seed(), TODAY).offers


def test_rainy_day_search_respects_price_party_and_window() -> None:
    hits = catalog.rank(
        [o for o in _offers() if "indoor" in o["tags"]],
        query="бороотой өдөр дотор",
        max_price_per_person=25,
        party_size=4,
        date=TODAY,
        window=catalog.Window.parse("13:00-19:00"),
        not_before=f"{TODAY}T10:30:00+07:00",
        limit=30,
    )
    ids = {h.offer_id for h in hits}
    assert {"off_puppet", "off_cooking", "off_museum"} <= ids
    assert "off_lune_show" not in ids  # $35 per person
    assert "off_escape" not in ids  # one place left, the party is four
    assert "off_catru" not in ids  # starts at 20:00, outside the window
    puppet = next(h for h in hits if h.offer_id == "off_puppet")
    assert puppet.price_total.amount == 32 and puppet.price_total.per == "group"
    assert [s.start[11:16] for s in puppet.slots] == ["15:00", "16:10"]  # 18:30 + 50 min ends after 19:00


def test_group_prices_are_split_per_person() -> None:
    car = next(o for o in _offers() if o["_id"] == "off_airport_car")
    assert catalog.per_person(car["price"], 4) == 4.5
    assert catalog.group_total(car["price"], 4) == 18


def test_slots_that_already_started_are_gone_and_bad_windows_are_refused() -> None:
    puppet = next(o for o in _offers() if o["_id"] == "off_puppet")
    later = catalog.open_slots(puppet, TODAY, 2, None, f"{TODAY}T16:00:00+07:00")
    assert [s.start[11:16] for s in later] == ["16:10", "18:30"]
    with pytest.raises(ValueError):
        catalog.Window.parse("after lunch")


def test_mongolian_words_imply_catalog_tags() -> None:
    assert catalog.wanted_tags("Хямд, дотор урлагийн юм") == {"budget", "indoor", "art"}
    museum = next(o for o in _offers() if o["_id"] == "off_womens_museum")
    kayak = next(o for o in _offers() if o["_id"] == "off_kayak")
    assert catalog.text_score(museum, "бороотой өдөр түүх") > catalog.text_score(kayak, "бороотой өдөр түүх")
