"""The orchestrator's A2A client (M1-D1): call a skill on a specialist agent by its Agent Card."""

import time
from dataclasses import dataclass
from typing import Any

import httpx
from a2a.client import A2ACardResolver, ClientConfig, create_client
from a2a.helpers.proto_helpers import get_data_parts, new_data_message
from a2a.types import Role, SendMessageRequest

TIMEOUT_S = 30.0


class A2AReplyMissing(RuntimeError):
    """The agent answered without the data part our skills promise."""


@dataclass
class SkillReply:
    data: dict[str, Any]
    ms: float


async def call_skill(
    base_url: str, skill: str, inputs: dict[str, Any] | None = None, *, http: httpx.AsyncClient | None = None
) -> SkillReply:
    """Resolve the agent's card, send {"skill": skill, ...inputs} as a data part, return its data reply.

    `http` lets tests (or a shared pool) supply the transport; otherwise a client is opened per call.
    """
    inputs = inputs or {}
    started = time.perf_counter()
    if http is None:
        async with httpx.AsyncClient(timeout=TIMEOUT_S) as owned:
            data = await _call(owned, base_url, skill, inputs)
    else:
        data = await _call(http, base_url, skill, inputs)
    return SkillReply(data=data, ms=(time.perf_counter() - started) * 1000)


async def _call(http: httpx.AsyncClient, base_url: str, skill: str, inputs: dict[str, Any]) -> dict[str, Any]:
    card = await A2ACardResolver(http, base_url).get_agent_card()
    client = await create_client(card, client_config=ClientConfig(streaming=False, httpx_client=http))
    request = SendMessageRequest(message=new_data_message({"skill": skill, **inputs}, role=Role.ROLE_USER))
    async for response in client.send_message(request):
        if response.HasField("message"):
            for data in get_data_parts(response.message.parts):
                if isinstance(data, dict):
                    return data
    raise A2AReplyMissing(f"{card.name} sent no data reply to {skill!r}")


async def ping(base_url: str, *, http: httpx.AsyncClient | None = None) -> SkillReply:
    return await call_skill(base_url, "ping", http=http)
