"""What every AYLAND A2A agent shares (HANDBOOK §8.3): an Agent Card, a table of skills, the JSON-RPC app.

An agent is its skills: async functions from the request's inputs to a JSON reply. Each request is answered
with one data message (the A2A "immediate response"). Every agent also answers `ping`, for health checks.
"""

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from a2a.helpers.proto_helpers import new_data_message
from a2a.server.agent_execution.agent_executor import AgentExecutor
from a2a.server.agent_execution.context import RequestContext
from a2a.server.events.event_queue import EventQueue
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.routes import add_a2a_routes_to_fastapi, create_agent_card_routes, create_jsonrpc_routes
from a2a.server.tasks.inmemory_task_store import InMemoryTaskStore
from a2a.types import AgentCapabilities, AgentCard, AgentInterface, AgentProvider, AgentSkill
from fastapi import FastAPI

from .skills import parse_request

JSONRPC_PATH = "/a2a/jsonrpc"
PROVIDER = AgentProvider(organization="Team Morgensonne (AYLAND)", url="https://github.com/RedonaNova/AYLAND")
Reply = dict[str, Any]


class SkillError(Exception):
    """A request the skill can't serve; the message goes back to the caller as {"error": ...}."""


@dataclass
class Skill:
    id: str
    name: str
    description: str
    run: Callable[[dict[str, Any]], Awaitable[Reply]]
    tags: list[str] = field(default_factory=list)
    examples: list[str] = field(default_factory=list)


@dataclass
class Agent:
    name: str
    description: str
    version: str
    skills: list[Skill]

    def __post_init__(self) -> None:
        async def ping(_: dict[str, Any]) -> Reply:
            return {"pong": True, "agent": self.name, "at": datetime.now(UTC).isoformat()}

        health = Skill("ping", "Ping", 'Health check. The reply is {"pong": true, ...}.', ping, ["health"])
        self.skills = [health, *self.skills]
        self.by_id = {skill.id: skill for skill in self.skills}

    def card(self, base_url: str) -> AgentCard:
        return AgentCard(
            name=self.name,
            description=self.description,
            provider=PROVIDER,
            version=self.version,
            capabilities=AgentCapabilities(streaming=False, push_notifications=False),
            default_input_modes=["application/json"],
            default_output_modes=["application/json"],
            skills=[
                AgentSkill(
                    id=s.id,
                    name=s.name,
                    description=s.description,
                    tags=s.tags,
                    examples=s.examples or [f'{{"skill": "{s.id}"}}'],
                )
                for s in self.skills
            ],
            supported_interfaces=[
                AgentInterface(protocol_binding="JSONRPC", protocol_version="1.0", url=f"{base_url}{JSONRPC_PATH}")
            ],
        )

    async def answer(self, message: Any) -> Reply:
        request = parse_request(message)
        skill = self.by_id.get(request.skill) if request else None
        if skill is None:
            asked = request.skill if request else ""
            return {"error": f"Unknown skill {asked!r}. This agent offers: {', '.join(self.by_id)}."}
        try:
            return await skill.run(request.inputs)
        except SkillError as err:
            return {"error": str(err)}

    def app(self, base_url: str) -> FastAPI:
        card = self.card(base_url)
        handler = DefaultRequestHandler(agent_executor=_Executor(self), task_store=InMemoryTaskStore(), agent_card=card)
        app = FastAPI(title=self.name, version=self.version)
        add_a2a_routes_to_fastapi(
            app,
            agent_card_routes=create_agent_card_routes(agent_card=card),
            jsonrpc_routes=create_jsonrpc_routes(request_handler=handler, rpc_url=JSONRPC_PATH),
        )
        return app


class _Executor(AgentExecutor):
    def __init__(self, agent: Agent) -> None:
        self.agent = agent

    async def execute(self, context: RequestContext, event_queue: EventQueue) -> None:
        reply = await self.agent.answer(context.message)
        await event_queue.enqueue_event(new_data_message(reply, context_id=context.context_id, task_id=context.task_id))

    async def cancel(self, context: RequestContext, event_queue: EventQueue) -> None:
        """Skills answer immediately, so there is nothing running to cancel."""
