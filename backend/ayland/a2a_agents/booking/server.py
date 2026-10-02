"""AYLAND Booking Agent as an A2A server (HANDBOOK §8.3, M1-D1).

    uv run uvicorn ayland.a2a_agents.booking.server:app --port 8301

M1 serves the Agent Card and a `ping` skill. M4 adds hold_booking, confirm_booking and cancel_booking,
where confirm refuses any proposal that is not `approved` in MongoDB (the second consent check, §5.4).
"""

from datetime import UTC, datetime

from a2a.helpers.proto_helpers import new_data_message
from a2a.server.agent_execution.agent_executor import AgentExecutor
from a2a.server.agent_execution.context import RequestContext
from a2a.server.events.event_queue import EventQueue
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.routes import add_a2a_routes_to_fastapi, create_agent_card_routes, create_jsonrpc_routes
from a2a.server.tasks.inmemory_task_store import InMemoryTaskStore
from a2a.types import AgentCapabilities, AgentCard, AgentInterface, AgentProvider, AgentSkill
from fastapi import FastAPI

from ayland.config import get_settings

from ..skills import parse_request

JSONRPC_PATH = "/a2a/jsonrpc"
NAME = "AYLAND Booking Agent"


def agent_card(base_url: str) -> AgentCard:
    return AgentCard(
        name=NAME,
        description="Holds, confirms and cancels bookings for AYLAND trips, only with the traveler's consent.",
        provider=AgentProvider(organization="Team Morgensonne (AYLAND)", url="https://github.com/RedonaNova/AYLAND"),
        version="0.1.0",
        capabilities=AgentCapabilities(streaming=False, push_notifications=False),
        default_input_modes=["application/json"],
        default_output_modes=["application/json"],
        skills=[
            AgentSkill(
                id="ping",
                name="Ping",
                description='Health check. Send {"skill": "ping"}; the reply is {"pong": true, ...}.',
                tags=["health"],
                examples=['{"skill": "ping"}'],
            )
        ],
        supported_interfaces=[
            AgentInterface(protocol_binding="JSONRPC", protocol_version="1.0", url=f"{base_url}{JSONRPC_PATH}")
        ],
    )


class BookingExecutor(AgentExecutor):
    """Answers with a single data Message (the A2A "immediate response" workflow)."""

    async def execute(self, context: RequestContext, event_queue: EventQueue) -> None:
        request = parse_request(context.message)
        if request and request.skill == "ping":
            reply = {"pong": True, "agent": NAME, "at": datetime.now(UTC).isoformat()}
        else:
            skill = request.skill if request else ""
            reply = {"error": f"Unknown skill {skill!r}. This agent offers: ping (booking skills arrive in M4)."}
        await event_queue.enqueue_event(new_data_message(reply, context_id=context.context_id, task_id=context.task_id))

    async def cancel(self, context: RequestContext, event_queue: EventQueue) -> None:
        """Nothing runs long enough to cancel yet."""


def build_app(base_url: str) -> FastAPI:
    card = agent_card(base_url)
    handler = DefaultRequestHandler(agent_executor=BookingExecutor(), task_store=InMemoryTaskStore(), agent_card=card)
    app = FastAPI(title=NAME, version=card.version)
    add_a2a_routes_to_fastapi(
        app,
        agent_card_routes=create_agent_card_routes(agent_card=card),
        jsonrpc_routes=create_jsonrpc_routes(request_handler=handler, rpc_url=JSONRPC_PATH),
    )
    return app


app = build_app(get_settings().a2a_booking_url)
