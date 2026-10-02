"""AYLAND Interpreter Agent as an A2A server (HANDBOOK §8.3, M2-D1): Mongolian ⇄ English with Orchu (Novelsoft).

    uv run uvicorn ayland.a2a_agents.interpreter.server:app --port 8302

Other languages arrive later, when the target follows the trip's destination (M5-D1).
"""

from typing import Any

import httpx

from ayland.config import get_settings
from ayland.llm import orchu
from ayland.novelsoft import OyuNotConfigured

from ..base import Agent, Reply, Skill, SkillError

NAME = "AYLAND Interpreter Agent"
LANGS = ("mn", "en")


async def translate(inputs: dict[str, Any]) -> Reply:
    text = str(inputs.get("text", "")).strip()
    source, target = inputs.get("source_lang"), inputs.get("target_lang")
    if not text:
        raise SkillError("Nothing to translate: `text` is empty.")
    if source not in LANGS or target not in LANGS:
        raise SkillError(f"source_lang and target_lang must each be one of {', '.join(LANGS)}.")
    if source == target:
        return {"text": text, "ms": 0}
    try:
        result = await orchu.translate(text, source, target)
    except OyuNotConfigured as err:
        raise SkillError(str(err)) from err
    except httpx.HTTPError as err:
        raise SkillError(f"Orchu translation failed ({type(err).__name__}).") from err
    return {"text": result.text, "ms": round(result.ms)}


agent = Agent(
    name=NAME,
    description="Translates between Mongolian and English for travelers and the locals they meet.",
    version="0.1.0",
    skills=[
        Skill(
            "translate",
            "Translate",
            'Mongolian ⇄ English. Send {"skill": "translate", "text", "source_lang", "target_lang"} (mn or en); '
            'the reply is {"text": ...}.',
            translate,
            tags=["translation", "mongolian", "english"],
            examples=['{"skill": "translate", "text": "Сайн байна уу", "source_lang": "mn", "target_lang": "en"}'],
        )
    ],
)

app = agent.app(get_settings().a2a_interpreter_url)
