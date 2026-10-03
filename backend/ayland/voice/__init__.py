"""Voice adapters (M1-D2): `transcribe(audio, lang)` and `speak(text, lang)`, one provider per language (D4).

Mongolian goes to Novelsoft (Anir STT, tsuurAI TTS). English is handled in the browser (Web Speech API),
so the server refuses it with a clear reason instead of guessing.
"""

from typing import Literal

from . import oyu
from .oyu import Speech, Transcript

Lang = Literal["mn", "en"]


class VoiceRequestError(ValueError):
    """A request no voice adapter can serve: a language without a server-side provider, or empty text."""


def _mongolian_only(lang: Lang, what: str, browser_api: str) -> None:
    if lang != "mn":
        raise VoiceRequestError(f"Only Mongolian is {what} here; English uses the browser's {browser_api}.")


async def transcribe(audio: bytes, lang: Lang, filename: str = "speech.wav") -> Transcript:
    _mongolian_only(lang, "transcribed", "speech recognition")
    return await oyu.transcribe(audio, filename=filename)


async def speak(text: str, lang: Lang) -> Speech:
    """Any length: long replies are chunked under the tsuurAI limit and joined into one WAV."""
    _mongolian_only(lang, "synthesized", "speech synthesis")
    if not text.strip():
        raise VoiceRequestError("Nothing to say: the text is empty.")
    return await oyu.speak_long(text)
