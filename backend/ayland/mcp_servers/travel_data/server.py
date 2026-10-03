"""MCP server `travel-data` (HANDBOOK §8.2, M2-B1): weather, places and routes for any agent.

    uv run uvicorn ayland.mcp_servers.travel_data.server:app --port 8201      (MCP endpoint: /mcp)

Try it by hand in the MCP Inspector: `npx @modelcontextprotocol/inspector`, transport "Streamable HTTP",
URL http://localhost:8201/mcp.
"""

from typing import Annotated

from mcp.server import MCPServer
from pydantic import Field

from ..common import Point
from . import places, routes, weather

mcp = MCPServer(
    "travel-data",
    version="0.1.0",
    instructions="Weather, nearby places and travel times for AYLAND trips. Prices are USD.",
)


@mcp.tool()
async def get_weather(
    city: Annotated[str, Field(description="City name, e.g. Hanoi")] = "Hanoi",
    lat: Annotated[float | None, Field(description="Latitude, instead of a city")] = None,
    lon: Annotated[float | None, Field(description="Longitude, instead of a city")] = None,
    hours_ahead: Annotated[int, Field(ge=0, le=24, description="Hours of forecast after the current one")] = 8,
) -> weather.Report:
    """Current conditions and the hourly forecast (condition, precipitation %, °C), plus `until` when rain is
    expected to stop. `scenario` is true while the demo's weather override is active."""
    return await weather.report(city, lat, lon, hours_ahead)


@mcp.tool()
async def search_places(
    near: Annotated[Point, Field(description="Search around this point, e.g. the hotel")],
    query: Annotated[str, Field(description="Part of the place name, e.g. 'phở'")] = "",
    kind: Annotated[str | None, Field(description=f"One of: {', '.join(places.KINDS)}")] = None,
    radius_m: Annotated[int, Field(ge=50, le=10_000)] = 1000,
    limit: Annotated[int, Field(ge=1, le=20)] = 5,
) -> places.Places:
    """Real places from OpenStreetMap near a point, nearest first, by kind and/or name."""
    return await places.search(query, near, radius_m, kind, limit)


@mcp.tool()
async def get_route(
    origin: Annotated[Point, Field(description="Start, e.g. the hotel")],
    destination: Annotated[Point, Field(description="Where to go")],
    mode: Annotated[routes.Mode, Field(description="walk, or drive (a ride-hailing car)")] = "walk",
) -> routes.Route:
    """Distance and travel time on real streets; driving includes city traffic and a car fare for the group."""
    return await routes.route(origin, destination, mode)


# Stateless JSON responses: every call stands alone, so restarts and retries need no session bookkeeping.
app = mcp.streamable_http_app(stateless_http=True, json_response=True)
