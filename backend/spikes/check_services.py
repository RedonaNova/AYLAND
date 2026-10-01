"""M0 smoke test: is every service AYLAND depends on reachable?

uv run python -m spikes.check_services
"""

import asyncio
from collections.abc import Awaitable, Callable

from ayland.config import get_settings
from ayland.db.client import ping
from ayland.llm import claude, oyu
from ayland.voice import oyu as voice

from .common import DEMO_LINES, cer, seconds, short, wav_seconds

GREETING = "Сайн байна уу? Нэг өгүүлбэрээр, монголоор хариулаарай."


async def mongodb() -> str:
    return f"ping {await ping():.0f} ms · db '{get_settings().mongodb_db}'"


async def claude_cli() -> str:
    reply = await claude.ask(GREETING, effort="low")
    return f"{reply.ms:.0f} ms · {short(reply.text, 70)}"


async def oyullm() -> str:
    reply = await oyu.chat([{"role": "user", "content": GREETING}])
    return f"{reply.ms:.0f} ms · {short(reply.text, 70)}"


async def voice_round_trip() -> str:
    line = DEMO_LINES[1]
    speech = await voice.speak(line)
    heard = await voice.transcribe(speech.wav)
    return (
        f"tsuurAI {speech.ms:.0f} ms for {seconds(wav_seconds(speech.wav))}s audio · "
        f"Anir {heard.ms:.0f} ms · CER {cer(line, heard.text):.0%} · “{short(heard.text, 50)}”"
    )


CHECKS: list[tuple[str, Callable[[], Awaitable[str]]]] = [
    ("MongoDB Atlas", mongodb),
    ("Claude (CLI)", claude_cli),
    ("OyuLLM", oyullm),
    ("tsuurAI→Anir", voice_round_trip),
]


async def main() -> int:
    failures = 0
    for name, check in CHECKS:
        try:
            print(f"  ok    {name:<14} {await check()}", flush=True)
        except Exception as err:  # noqa: BLE001 - a smoke test reports every failure and moves on
            failures += 1
            print(f"  FAIL  {name:<14} {type(err).__name__}: {short(str(err), 160)}", flush=True)
    return failures


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
