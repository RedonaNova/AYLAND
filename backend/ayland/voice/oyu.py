"""Anir (Mongolian speech-to-text) and tsuurAI (Mongolian text-to-speech) on api.oyu.so (D4)."""

import asyncio
import time
from dataclasses import dataclass
from typing import Any

import httpx

from ayland.config import get_settings
from ayland.llm.oyu import api_key

TTS_MAX_CHARS = 800  # per request, from the API spec
RETRIES = 3  # the per-key rate limit trips after a quick burst (429s seen in the M0-4 spike)


@dataclass
class Transcript:
    text: str
    ms: float


@dataclass
class Speech:
    wav: bytes
    ms: float


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        base_url=get_settings().oyu_base_url,
        headers={"Authorization": f"Bearer {api_key()}"},
        timeout=httpx.Timeout(60.0),
    )


def _retry_after(response: httpx.Response, attempt: int) -> float:
    """Seconds to wait: the server's Retry-After if it sent one, else 1 s, 2 s, 4 s."""
    try:
        return float(response.headers["retry-after"])
    except (KeyError, ValueError):
        return float(2**attempt)


async def _post(path: str, **request: Any) -> httpx.Response:
    async with _client() as client:
        for attempt in range(RETRIES + 1):
            response = await client.post(path, **request)
            if response.status_code != 429 or attempt == RETRIES:
                response.raise_for_status()
                return response
            await asyncio.sleep(_retry_after(response, attempt))
    raise AssertionError("unreachable")


async def transcribe(audio: bytes, filename: str = "speech.wav") -> Transcript:
    """Anir batch transcription. WAV, MP3 or OGG; long audio should use the WebSocket stream instead."""
    started = time.perf_counter()
    response = await _post(
        "/audio/transcriptions", files={"file": (filename, audio)}, data={"model": get_settings().oyu_stt_model}
    )
    return Transcript(text=response.json()["text"].strip(), ms=(time.perf_counter() - started) * 1000)


async def speak(text: str, voice: str | None = None) -> Speech:
    """tsuurAI synthesis to WAV. Callers split anything longer than TTS_MAX_CHARS."""
    if len(text) > TTS_MAX_CHARS:
        raise ValueError(f"tsuurAI accepts at most {TTS_MAX_CHARS} characters per request")
    started = time.perf_counter()
    response = await _post("/audio/speech", json={"text": text, "voice": voice or get_settings().oyu_tts_voice})
    return Speech(wav=response.content, ms=(time.perf_counter() - started) * 1000)
