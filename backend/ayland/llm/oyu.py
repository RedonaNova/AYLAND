"""OyuLLM (Novelsoft), the Mongolian LLM required by the hackathon. OpenAI-compatible, tool calling supported."""

import time
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Any

from openai import AsyncOpenAI

from ayland.config import get_settings


class OyuNotConfigured(RuntimeError):
    """OYU_API_KEY is missing from .env."""


def api_key() -> str:
    key = get_settings().oyu_api_key
    if key is None:
        raise OyuNotConfigured("Set OYU_API_KEY in .env (create one at https://oyu.so/account/apikeys).")
    return key.get_secret_value()


@lru_cache
def get_client() -> AsyncOpenAI:
    return AsyncOpenAI(base_url=get_settings().oyu_base_url, api_key=api_key())


@dataclass
class OyuReply:
    text: str
    ms: float
    tool_calls: list[dict[str, Any]] = field(default_factory=list)


async def chat(messages: list[dict[str, Any]], tools: list[dict[str, Any]] | None = None, **kwargs: Any) -> OyuReply:
    started = time.perf_counter()
    tool_options = {"tools": tools, "tool_choice": "auto"} if tools else {}
    response = await get_client().chat.completions.create(
        model=get_settings().oyu_llm_model, messages=messages, **tool_options, **kwargs
    )
    message = response.choices[0].message
    calls = [{"name": call.function.name, "arguments": call.function.arguments} for call in (message.tool_calls or [])]
    return OyuReply(text=(message.content or "").strip(), ms=(time.perf_counter() - started) * 1000, tool_calls=calls)
