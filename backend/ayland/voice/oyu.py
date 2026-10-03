"""Anir (Mongolian speech-to-text) and tsuurAI (Mongolian text-to-speech) on api.oyu.so (D4)."""

import io
import re
import time
import wave
from dataclasses import dataclass

from ayland.config import get_settings
from ayland.novelsoft import post

TTS_MAX_CHARS = 800  # per request, from the API spec


@dataclass
class Transcript:
    text: str
    ms: float


@dataclass
class Speech:
    wav: bytes
    ms: float


async def transcribe(audio: bytes, filename: str = "speech.wav") -> Transcript:
    """Anir batch transcription. WAV, MP3 or OGG; long audio should use the WebSocket stream instead."""
    started = time.perf_counter()
    response = await post(
        "/audio/transcriptions", files={"file": (filename, audio)}, data={"model": get_settings().oyu_stt_model}
    )
    return Transcript(text=response.json()["text"].strip(), ms=(time.perf_counter() - started) * 1000)


async def speak(text: str, voice: str | None = None) -> Speech:
    """tsuurAI synthesis to WAV for one chunk of at most TTS_MAX_CHARS characters."""
    if len(text) > TTS_MAX_CHARS:
        raise ValueError(f"tsuurAI accepts at most {TTS_MAX_CHARS} characters per request")
    started = time.perf_counter()
    response = await post("/audio/speech", json={"text": text, "voice": voice or get_settings().oyu_tts_voice})
    return Speech(wav=response.content, ms=(time.perf_counter() - started) * 1000)


def split_for_tts(text: str, limit: int = TTS_MAX_CHARS) -> list[str]:
    """Sentence-sized chunks under the tsuurAI limit (a single overlong sentence is cut hard)."""
    chunks: list[str] = []
    current = ""
    for sentence in re.split(r"(?<=[.!?…])\s+", " ".join(text.split())):
        while len(sentence) > limit:
            if current:  # flush what came before, so the speech stays in order
                chunks.append(current)
                current = ""
            chunks.append(sentence[:limit])
            sentence = sentence[limit:]
        if current and len(current) + 1 + len(sentence) > limit:
            chunks.append(current)
            current = sentence
        else:
            current = f"{current} {sentence}".strip()
    if current:
        chunks.append(current)
    return chunks


def join_wavs(parts: list[bytes]) -> bytes:
    """Concatenate WAV clips that share one format into a single WAV."""
    out = io.BytesIO()
    with wave.open(out, "wb") as joined:
        for i, part in enumerate(parts):
            with wave.open(io.BytesIO(part)) as clip:
                if i == 0:
                    joined.setparams(clip.getparams())
                joined.writeframes(clip.readframes(clip.getnframes()))
    return out.getvalue()


async def speak_long(text: str, voice: str | None = None) -> Speech:
    """tsuurAI for any length: chunked under the limit and joined into one WAV."""
    chunks = split_for_tts(text)
    if not chunks:
        raise ValueError("Nothing to say: the text is empty")
    started = time.perf_counter()
    parts = [(await speak(chunk, voice)).wav for chunk in chunks]
    return Speech(wav=join_wavs(parts), ms=(time.perf_counter() - started) * 1000)
