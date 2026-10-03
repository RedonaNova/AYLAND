import asyncio
import json
from typing import Any

import pytest

from ayland.config import Settings
from ayland.db.models import Profile
from ayland.llm.oyu import OyuReply
from ayland.orchestrator import onboarding

GOOD = {"summary": "Сарнай, таныг ойлголоо.", "suggestions": ["Нэг", "Хоёр", "Гурав"]}


def settings(**overrides: Any) -> Settings:
    return Settings(_env_file=None, **overrides)


@pytest.fixture(autouse=True)
def fresh_cap(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(onboarding, "cap", onboarding.DailyCap())


def test_a_fenced_reply_is_read() -> None:
    written = onboarding.parse(f"Энэ байна:\n```json\n{json.dumps(GOOD, ensure_ascii=False)}\n```")
    assert written == onboarding.Welcome("Сарнай, таныг ойлголоо.", ["Нэг", "Хоёр", "Гурав"])


@pytest.mark.parametrize(
    "raw",
    ["", "not json", '{"summary": "", "suggestions": ["a", "b", "c"]}', '{"summary": "a", "suggestions": ["a"]}'],
)
def test_anything_else_is_a_failure(raw: str) -> None:
    assert onboarding.parse(raw) is None


async def test_oyu_writes_once_per_visitor_within_the_daily_cap(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[list[dict[str, Any]]] = []

    async def chat(messages: list[dict[str, Any]], **_: Any) -> OyuReply:
        calls.append(messages)
        return OyuReply(text=json.dumps(GOOD, ensure_ascii=False), ms=5)

    monkeypatch.setattr(onboarding.oyu, "chat", chat)
    monkeypatch.setattr(onboarding, "get_settings", lambda: settings(onboarding_llm_daily_cap=1))
    first = await onboarding.write(Profile(name="Сарнай", diet=["halal"]))
    assert first is not None and first.suggestions == ["Нэг", "Хоёр", "Гурав"]
    assert "Хоолны хязгаарлалт: халал." in calls[0][1]["content"]
    assert await onboarding.write(Profile(name="Бат")) is None  # over the cap: no second call
    assert len(calls) == 1


async def test_off_failing_or_slow_oyu_falls_back(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(onboarding, "get_settings", lambda: settings(onboarding_llm="off"))
    assert await onboarding.write(Profile()) is None

    async def broken(*_: Any, **__: Any) -> OyuReply:
        raise RuntimeError("503")

    async def slow(*_: Any, **__: Any) -> OyuReply:
        await asyncio.sleep(1)
        return OyuReply(text=json.dumps(GOOD), ms=1000)

    monkeypatch.setattr(onboarding, "get_settings", lambda: settings())
    monkeypatch.setattr(onboarding.oyu, "chat", broken)
    assert await onboarding.write(Profile()) is None
    monkeypatch.setattr(onboarding, "TIMEOUT_S", 0.01)
    monkeypatch.setattr(onboarding.oyu, "chat", slow)
    assert await onboarding.write(Profile()) is None
