"""Shapes and helpers both MCP servers use."""

import math
import time
from typing import Annotated, Any

import httpx
from mcp.server.mcpserver.exceptions import ToolError
from pydantic import BaseModel, Field

__all__ = ["USER_AGENT", "Point", "TTLCache", "ToolError", "distance_m", "http"]  # ToolError: text the model sees

USER_AGENT = "AYLAND/0.1 (hackathon demo; https://github.com/RedonaNova/AYLAND)"


class Point(BaseModel):
    """A tool input location. Plain lon/lat rather than GeoJSON, so the model can't swap the order."""

    lon: Annotated[float, Field(ge=-180, le=180, description="Longitude")]
    lat: Annotated[float, Field(ge=-90, le=90, description="Latitude")]

    def geojson(self) -> dict[str, Any]:
        return {"type": "Point", "coordinates": [self.lon, self.lat]}


def distance_m(a: Point, b: Point) -> float:
    """Great-circle (haversine) distance in metres."""
    lat1, lat2 = math.radians(a.lat), math.radians(b.lat)
    dlat, dlon = lat2 - lat1, math.radians(b.lon - a.lon)
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * 6_371_000 * math.asin(math.sqrt(h))


def http(timeout_s: float = 10.0) -> httpx.AsyncClient:
    """Free public APIs (Open-Meteo, Overpass, OSRM) ask callers to identify themselves."""
    return httpx.AsyncClient(timeout=timeout_s, headers={"User-Agent": USER_AGENT})


class TTLCache:
    """In-process cache for free APIs that rate-limit (HANDBOOK §14): the demo asks the same things repeatedly."""

    def __init__(self, ttl_s: float) -> None:
        self.ttl_s = ttl_s
        self._items: dict[Any, tuple[float, Any]] = {}

    def get(self, key: Any) -> Any | None:
        hit = self._items.get(key)
        if hit is None or time.monotonic() - hit[0] > self.ttl_s:
            return None
        return hit[1]

    def put(self, key: Any, value: Any) -> Any:
        self._items[key] = (time.monotonic(), value)
        return value
