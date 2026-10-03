"""AYLAND Booking Agent as an A2A server (HANDBOOK §8.3, M1-D1).

    uv run uvicorn ayland.a2a_agents.booking.server:app --port 8301

M1 serves the Agent Card and `ping`. M4 adds hold_booking, confirm_booking and cancel_booking, where confirm
refuses any proposal that is not `approved` in MongoDB (the second consent check, §5.4).
"""

from fastapi import FastAPI

from ayland.config import get_settings

from ..base import Agent

NAME = "AYLAND Booking Agent"

agent = Agent(
    name=NAME,
    description="Holds, confirms and cancels bookings for AYLAND trips, only with the traveler's consent.",
    version="0.1.0",
    skills=[],
)


def build_app(base_url: str) -> FastAPI:
    return agent.app(base_url)


app = build_app(get_settings().a2a_booking_url)
