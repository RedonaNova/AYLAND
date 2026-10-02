"""`search_places` on OpenStreetMap through the Overpass API (free, no key; D5)."""

import re
from typing import Any

import httpx
from pydantic import BaseModel

from ..common import Point, ToolError, TTLCache, distance_m, http

ENDPOINTS = ("https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter")
_results = TTLCache(ttl_s=3600)

# Plain words the model can pass as `kind`, mapped to OpenStreetMap tags.
KINDS: dict[str, tuple[str, str]] = {
    "cafe": ("amenity", "cafe"),
    "restaurant": ("amenity", "restaurant"),
    "bar": ("amenity", "bar"),
    "pharmacy": ("amenity", "pharmacy"),
    "hospital": ("amenity", "hospital"),
    "atm": ("amenity", "atm"),
    "toilets": ("amenity", "toilets"),
    "market": ("amenity", "marketplace"),
    "temple": ("amenity", "place_of_worship"),
    "museum": ("tourism", "museum"),
    "attraction": ("tourism", "attraction"),
    "hotel": ("tourism", "hotel"),
    "park": ("leisure", "park"),
    "convenience": ("shop", "convenience"),
}


class PlaceHit(BaseModel):
    name: str
    name_en: str | None = None
    address: str
    location: dict[str, Any]  # GeoJSON Point
    kind: str | None
    distance_m: int
    source: str = "osm"


class Places(BaseModel):
    summary: str
    places: list[PlaceHit]


def _regex(text: str) -> str:
    """`text` escaped for an Overpass name regex, so it matches literally."""
    return re.sub(r'([\\^$.|?*+()\[\]{}"])', r"\\\1", text)


def overpass_query(near: Point, radius_m: int, kind: str | None, query: str, limit: int) -> str:
    filters = ""
    if kind:
        key, value = KINDS[kind]
        filters += f'["{key}"="{value}"]'
    if query:
        filters += f'["name"~"{_regex(query)}",i]'
    if not filters:
        filters = '["tourism"="attraction"]'
    around = f"(around:{radius_m},{near.lat},{near.lon})"
    return f"[out:json][timeout:10];nwr{filters}[name]{around};out center tags {limit * 4};"


def parse(elements: list[dict[str, Any]], near: Point, kind: str | None, limit: int) -> list[PlaceHit]:
    hits = []
    for element in elements:
        center = element.get("center", {})
        lat = element.get("lat", center.get("lat"))
        lon = element.get("lon", center.get("lon"))
        tags = element.get("tags", {})
        if lat is None or lon is None or "name" not in tags:
            continue
        here = Point(lon=lon, lat=lat)
        street = " ".join(filter(None, (tags.get("addr:housenumber"), tags.get("addr:street"))))
        hits.append(
            PlaceHit(
                name=tags["name"],
                name_en=tags.get("name:en"),
                address=street or tags.get("addr:full", ""),
                location=here.geojson(),
                kind=kind,
                distance_m=round(distance_m(near, here)),
            )
        )
    hits.sort(key=lambda hit: hit.distance_m)
    return hits[:limit]


async def search(query: str, near: Point, radius_m: int, kind: str | None, limit: int) -> Places:
    if kind is not None and kind not in KINDS:
        raise ToolError(f"Unknown kind {kind!r}. Use one of: {', '.join(KINDS)}.")
    overpass = overpass_query(near, radius_m, kind, query.strip(), limit)
    elements = _results.get(overpass)
    if elements is None:
        elements = _results.put(overpass, await _fetch(overpass))
    hits = parse(elements, near, kind, limit)
    summary = f"{len(hits)} газар · хамгийн ойр {hits[0].distance_m} м" if hits else "Ойролцоо олдсонгүй"
    return Places(summary=summary, places=hits)


async def _fetch(overpass: str) -> list[dict[str, Any]]:
    """The first Overpass mirror that answers (the main one is often busy)."""
    last: Exception | None = None
    async with http(timeout_s=7) as client:  # per mirror: a busy Overpass must not stall a turn on stage
        for endpoint in ENDPOINTS:
            try:
                response = await client.post(endpoint, data={"data": overpass})
                response.raise_for_status()
                return response.json().get("elements", [])
            except (httpx.HTTPError, ValueError) as err:
                last = err
    raise ToolError(f"OpenStreetMap search is unavailable right now ({type(last).__name__}).")
