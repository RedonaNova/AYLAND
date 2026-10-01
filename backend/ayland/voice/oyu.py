"""Anir (Mongolian speech-to-text) and tsuurAI (Mongolian text-to-speech) on api.oyu.so (D4)."""

import time
from dataclasses import dataclass

import httpx

from ayland.config import get_settings
from ayland.llm.oyu import api_key

TTS_MAX_CHARS = 800  # per request, from the API spec


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


async def transcribe(audio: bytes, filename: str = "speech.wav") -> Transcript:
    """Anir batch transcription. WAV, MP3 or OGG; long audio should use the WebSocket stream instead."""
    started = time.perf_counter()
    async with _client() as client:
        response = await client.post(
            "/audio/transcriptions",
            files={"file": (filename, audio)},
            data={"model": get_settings().oyu_stt_model},
        )
        response.raise_for_status()
    return Transcript(text=response.json()["text"].strip(), ms=(time.perf_counter() - started) * 1000)


async def speak(text: str, voice: str | None = None) -> Speech:
    """tsuurAI synthesis to WAV. Callers split anything longer than TTS_MAX_CHARS."""
    if len(text) > TTS_MAX_CHARS:
        raise ValueError(f"tsuurAI accepts at most {TTS_MAX_CHARS} characters per request")
    started = time.perf_counter()
    async with _client() as client:
        response = await client.post(
            "/audio/speech", json={"text": text, "voice": voice or get_settings().oyu_tts_voice}
        )
        response.raise_for_status()
    return Speech(wav=response.content, ms=(time.perf_counter() - started) * 1000)
