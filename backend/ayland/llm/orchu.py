"""Orchu (Novelsoft) machine translation, Mongolian ⇄ English: the interpreter's translator (D4)."""

import time
from dataclasses import dataclass
from typing import Literal

from ayland.novelsoft import post

OrchuLang = Literal["mn", "en"]


@dataclass
class Translation:
    text: str
    ms: float


async def translate(text: str, source: OrchuLang, target: OrchuLang) -> Translation:
    started = time.perf_counter()
    response = await post("/translations", json={"text": text, "source": source, "target": target})
    return Translation(text=response.json()["translation"].strip(), ms=(time.perf_counter() - started) * 1000)
