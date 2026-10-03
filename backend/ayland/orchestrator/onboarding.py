"""OyuLLM writes the welcome flow's summary and three starter suggestions (decision D1). None means the web app
uses its own templates: OyuLLM off, over the daily cap, failing, slow or answering in the wrong shape."""

import asyncio
import json
import logging
import re
from dataclasses import dataclass

from ayland import clock
from ayland.config import get_settings
from ayland.db.models import Profile
from ayland.llm import oyu

from . import prompts
from .prompts import profile as text

TIMEOUT_S = 8.0
logger = logging.getLogger("ayland.onboarding")


@dataclass
class Welcome:
    summary: str
    suggestions: list[str]


class DailyCap:
    """OyuLLM calls per Hanoi day, in process memory."""

    def __init__(self) -> None:
        self.day = ""
        self.used = 0

    def take(self, limit: int) -> bool:
        today = clock.today()
        if today != self.day:
            self.day, self.used = today, 0
        if self.used >= limit:
            return False
        self.used += 1
        return True


cap = DailyCap()


def parse(raw: str) -> Welcome | None:
    """The JSON object in the reply, even inside a code fence or with words around it."""
    found = re.search(r"\{.*\}", raw, re.DOTALL)
    if not found:
        return None
    try:
        data = json.loads(found.group(0))
    except json.JSONDecodeError:
        return None
    if not isinstance(data, dict):
        return None
    summary, suggestions = data.get("summary"), data.get("suggestions")
    if not isinstance(summary, str) or not summary.strip() or not isinstance(suggestions, list):
        return None
    picked = [s.strip() for s in suggestions if isinstance(s, str) and s.strip()][:3]
    if len(picked) < 3:
        return None
    return Welcome(summary.strip()[:400], [s[:80] for s in picked])


async def write(profile: Profile) -> Welcome | None:
    settings = get_settings()
    if settings.onboarding_llm == "off" or not cap.take(settings.onboarding_llm_daily_cap):
        return None
    answers = "\n".join(f"- {line}" for line in text.sentences(profile)) or "- (хариулаагүй)"
    messages = [
        {"role": "system", "content": prompts.onboarding_prompt()},
        {"role": "user", "content": f"Нэр: {profile.name.strip() or text.TRAVELER}\n{answers}"},
    ]
    try:
        reply = await asyncio.wait_for(oyu.chat(messages, temperature=0.4), TIMEOUT_S)
    except Exception as err:  # noqa: BLE001 - any OyuLLM failure falls back to the web app's templates
        logger.warning("OyuLLM welcome write-up failed: %s", err)
        return None
    return parse(reply.text)
