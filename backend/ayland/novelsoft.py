"""Shared access to api.oyu.so (Novelsoft): one key, bearer auth, retry on the per-key rate limit."""

import asyncio
from typing import Any

import httpx

from ayland.config import get_settings

RETRIES = 3  # the per-key rate limit trips after a quick burst (429s seen in the M0-4 spike)


class OyuNotConfigured(RuntimeError):
    """OYU_API_KEY is missing from .env."""


def api_key() -> str:
    key = get_settings().oyu_api_key
    if key is None:
        raise OyuNotConfigured("Set OYU_API_KEY in .env (create one at https://oyu.so/account/apikeys).")
    return key.get_secret_value()


def _retry_after(response: httpx.Response, attempt: int) -> float:
    """Seconds to wait: the server's Retry-After if it sent one, else 1 s, 2 s, 4 s."""
    try:
        return float(response.headers["retry-after"])
    except (KeyError, ValueError):
        return float(2**attempt)


async def post(path: str, **request: Any) -> httpx.Response:
    """POST to api.oyu.so/v1, retrying 429s, raising for any other error status."""
    async with httpx.AsyncClient(
        base_url=get_settings().oyu_base_url,
        headers={"Authorization": f"Bearer {api_key()}"},
        timeout=httpx.Timeout(60.0),
    ) as client:
        for attempt in range(RETRIES + 1):
            response = await client.post(path, **request)
            if response.status_code != 429 or attempt == RETRIES:
                response.raise_for_status()
                return response
            await asyncio.sleep(_retry_after(response, attempt))
    raise AssertionError("unreachable")
