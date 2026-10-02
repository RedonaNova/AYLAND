"""`get_route`: walking and driving times on OpenStreetMap roads (OSRM, free), with an offline estimate as fallback."""

from typing import Literal

import httpx
from pydantic import BaseModel

from ayland.db.models import Money

from ..common import Point, TTLCache, distance_m, http

Mode = Literal["walk", "drive"]
# FOSSGIS runs separate OSRM instances per profile (the project-osrm.org demo only routes cars).
OSRM: dict[Mode, str] = {
    "walk": "https://routing.openstreetmap.de/routed-foot/route/v1/driving",
    "drive": "https://routing.openstreetmap.de/routed-car/route/v1/driving",
}
TRAFFIC = 1.4  # OSRM assumes free-flowing roads; Hanoi's centre by car is slower
SPEED_KMH: dict[Mode, float] = {"walk": 4.5, "drive": 15}  # for the estimate, already traffic-adjusted
DETOUR = 1.3  # streets vs. a straight line, for the estimate
_routes = TTLCache(ttl_s=3600)


class Route(BaseModel):
    summary: str
    mode: Mode
    distance_m: int
    duration_min: int
    cost: Money | None = None  # a ride-hailing car for the whole group, when driving
    source: Literal["osrm", "estimate"]


def taxi_fare(meters: float) -> float:
    """A Grab-style 4-seat car in Hanoi: about $1 to start plus $0.55/km, at least $2, to the nearest $0.50."""
    return max(2.0, round((1.0 + 0.55 * meters / 1000) * 2) / 2)


def make(mode: Mode, meters: float, minutes: float, source: Literal["osrm", "estimate"]) -> Route:
    minutes = max(1, round(minutes))
    cost: Money | None = None
    how = "алхана"
    if mode == "drive":
        cost = Money(amount=taxi_fare(meters), per="group")
        how = f"машинаар · ~${cost.amount:g}"
    return Route(
        summary=f"{minutes} мин {how}",
        mode=mode,
        distance_m=round(meters),
        duration_min=minutes,
        cost=cost,
        source=source,
    )


def estimate(origin: Point, destination: Point, mode: Mode) -> Route:
    meters = distance_m(origin, destination) * DETOUR
    return make(mode, meters, meters / 1000 / SPEED_KMH[mode] * 60, "estimate")


async def route(origin: Point, destination: Point, mode: Mode) -> Route:
    key = (round(origin.lon, 5), round(origin.lat, 5), round(destination.lon, 5), round(destination.lat, 5), mode)
    if cached := _routes.get(key):
        return cached
    url = f"{OSRM[mode]}/{origin.lon},{origin.lat};{destination.lon},{destination.lat}"
    try:
        async with http(timeout_s=6) as client:
            response = await client.get(url, params={"overview": "false"})
            response.raise_for_status()
        best = response.json()["routes"][0]
    except (httpx.HTTPError, KeyError, IndexError, ValueError):
        return estimate(origin, destination, mode)  # not cached: OSRM may be back next time
    factor = TRAFFIC if mode == "drive" else 1.0
    return _routes.put(key, make(mode, best["distance"], best["duration"] / 60 * factor, "osrm"))
