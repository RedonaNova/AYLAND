"""Weather for `get_weather` and the trip view: Open-Meteo (free, no key), or the DEMO_MODE scenario (HANDBOOK §3).

In DEMO_MODE the demo city's weather comes from data/scenarios/<DEMO_SCENARIO>.json, switched between clear and
rain by the demo controls, so the story is the same on stage whatever the sky over Hanoi does.
"""

import json
from datetime import UTC, datetime, timedelta
from functools import lru_cache
from typing import Any, Literal

import httpx
from pydantic import BaseModel

from ayland import clock
from ayland.config import REPO_ROOT, get_settings
from ayland.db import repo
from ayland.db.client import get_db

from ..common import Point, ToolError, TTLCache, distance_m, http

Condition = Literal["clear", "clouds", "rain"]
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search"
_forecasts = TTLCache(ttl_s=600)
_places = TTLCache(ttl_s=86_400)
_last_good: dict[tuple[float, float], dict[str, Any]] = {}  # served when Open-Meteo is briefly down

CONDITION_MN: dict[Condition, str] = {"clear": "Цэлмэг", "clouds": "Үүлшинэ", "rain": "Бороо"}


class Hour(BaseModel):
    time: str  # local "HH:MM"
    condition: Condition
    precip_prob: int
    temp_c: float


class Report(BaseModel):
    summary: str
    city: str
    condition: Condition
    temp_c: float
    precip_prob: int
    until: str | None = None  # local "HH:MM" when the current rain is expected to stop
    hourly: list[Hour]
    scenario: bool  # true while a DEMO_MODE override is active
    source: Literal["scenario", "open-meteo"]

    def view(self) -> dict[str, Any]:
        """The trip view's `weather` (frontend `Weather`)."""
        return self.model_dump(include={"condition", "temp_c", "precip_prob", "until", "scenario"}, exclude_none=True)


def wmo_condition(code: int) -> Condition:
    """WMO weather code (Open-Meteo `weather_code`) to our three conditions."""
    if code <= 1:
        return "clear"
    if code in (2, 3, 45, 48):
        return "clouds"
    return "rain"  # drizzle, rain, showers, thunderstorms (and snow, which Hanoi doesn't get)


def summarize(hours: list[Hour], hours_ahead: int, **fields: Any) -> Report:
    """`hours` start with the hour we're in. Reports it, the next `hours_ahead` hours, and when rain should stop."""
    now = hours[0]
    until = None
    if now.condition == "rain":
        until = next((h.time for h in hours[1:] if h.condition != "rain"), None)
    summary = f"{CONDITION_MN[now.condition]} {now.precip_prob}% · {now.temp_c:.0f}°C"
    if until:
        summary += f" · {until} хүртэл"
    return Report(
        summary=summary,
        condition=now.condition,
        temp_c=now.temp_c,
        precip_prob=now.precip_prob,
        until=until,
        hourly=hours[: 1 + hours_ahead],
        **fields,
    )


@lru_cache
def load_scenario(name: str) -> dict[str, Any]:
    return json.loads((REPO_ROOT / "data" / "scenarios" / f"{name}.json").read_text(encoding="utf-8"))


def scenario_report(name: str, weather: repo.Weather, hours_ahead: int) -> Report:
    data = load_scenario(name)
    hours = [Hour(time=t, condition=c, precip_prob=p, temp_c=temp) for t, c, p, temp in data[weather]]
    now = clock.hhmm(clock.now_iso())
    current = max((i for i, h in enumerate(hours) if h.time <= now), default=0)
    return summarize(hours[current:], hours_ahead, city=data["city"], scenario=True, source="scenario")


def parse_forecast(payload: dict[str, Any], now_utc: datetime | None = None) -> list[Hour]:
    """Open-Meteo's hourly arrays from the current local hour on (times are local with timezone=auto).

    "Now" comes from the clock, not from the payload: a cached or last-good forecast must not report an hour
    that has already passed as the current one."""
    local_now = (now_utc or datetime.now(UTC)) + timedelta(seconds=payload["utc_offset_seconds"])
    this_hour = local_now.strftime("%Y-%m-%dT%H")
    hourly = payload["hourly"]
    rows = zip(
        hourly["time"],
        hourly["weather_code"],
        hourly["precipitation_probability"],
        hourly["temperature_2m"],
        strict=True,
    )
    return [
        Hour(time=t[11:16], condition=wmo_condition(code), precip_prob=round(prob or 0), temp_c=temp)
        for t, code, prob, temp in rows
        if t[:13] >= this_hour
    ]


async def coordinates(city: str) -> tuple[float, float, str]:
    """(lat, lon, name) for a city, from Open-Meteo's free geocoder."""
    if hit := _places.get(city.lower()):
        return hit
    async with http() as client:
        response = await client.get(GEOCODE_URL, params={"name": city, "count": 1, "language": "en"})
        response.raise_for_status()
    results = response.json().get("results") or []
    if not results:
        raise ToolError(f"Unknown city {city!r}; pass lat and lon instead.")
    top = results[0]
    return _places.put(city.lower(), (top["latitude"], top["longitude"], top["name"]))


async def open_meteo(lat: float, lon: float, city: str, hours_ahead: int) -> Report:
    key = (round(lat, 2), round(lon, 2))
    payload = _forecasts.get(key)
    if payload is None:
        params = {
            "latitude": lat,
            "longitude": lon,
            "current": "temperature_2m,weather_code",
            "hourly": "temperature_2m,precipitation_probability,weather_code",
            "timezone": "auto",
            "forecast_days": 2,  # so "the next hours" also works late in the evening
        }
        try:
            async with http() as client:
                response = await client.get(FORECAST_URL, params=params)
                response.raise_for_status()
            payload = _last_good[key] = _forecasts.put(key, response.json())
        except httpx.HTTPError:
            if key not in _last_good:
                raise
            payload = _last_good[key]
    hours = parse_forecast(payload)
    if not hours:  # only a last-good forecast that is more than two days old
        raise ToolError("The weather forecast is out of date and Open-Meteo is unavailable right now.")
    return summarize(hours, hours_ahead, city=city, scenario=False, source="open-meteo")


def in_scenario(
    scenario: dict[str, Any], city: str | None = None, lat: float | None = None, lon: float | None = None
) -> bool:
    """Is this the demo city? By any of its names, or by being within its radius, so a question asked with the
    hotel's coordinates (or "Ханой") still gets the stage weather."""
    if lat is not None and lon is not None:
        center = Point(lon=scenario["location"][0], lat=scenario["location"][1])
        return distance_m(Point(lon=lon, lat=lat), center) <= scenario["radius_km"] * 1000
    wanted = (city or "").lower()
    return any(name.lower() in wanted for name in scenario["names"])


async def report(
    city: str = "Hanoi", lat: float | None = None, lon: float | None = None, hours_ahead: int = 8
) -> Report:
    settings = get_settings()
    scenario = load_scenario(settings.demo_scenario) if settings.demo_mode else None
    try:
        if scenario and in_scenario(scenario, city, lat, lon):
            return scenario_report(settings.demo_scenario, await repo.get_weather(get_db()), hours_ahead)
        if lat is None or lon is None:
            lat, lon, city = await coordinates(city)
            if scenario and in_scenario(scenario, lat=lat, lon=lon):  # e.g. "Hanoi, Vietnam"
                return scenario_report(settings.demo_scenario, await repo.get_weather(get_db()), hours_ahead)
        return await open_meteo(lat, lon, city, hours_ahead)
    except httpx.HTTPError as err:
        raise ToolError(f"The weather service (Open-Meteo) is unavailable right now ({type(err).__name__}).") from err
