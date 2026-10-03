from collections.abc import AsyncIterator
from typing import Any

import httpx
import pytest
from fake_db import FakeDb
from pydantic import ValidationError

import ayland.orchestrator.agent as agent_module
from ayland.config import Settings
from ayland.db.models import Profile
from ayland.orchestrator import app as orchestrator
from ayland.orchestrator import memory, onboarding, tools

VISITOR = "v_0f8fad5b-d9cb-469f-a165-70867728950e"


@pytest.fixture
def fake(monkeypatch: pytest.MonkeyPatch) -> Any:
    db = FakeDb()
    for module in (orchestrator, agent_module, tools):
        monkeypatch.setattr(module, "get_db", lambda: db)
    monkeypatch.setattr(onboarding, "get_settings", lambda: Settings(_env_file=None, onboarding_llm="off"))
    return db


@pytest.fixture
async def api() -> AsyncIterator[httpx.AsyncClient]:
    transport = httpx.ASGITransport(app=orchestrator.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://api.test") as client:
        yield client


@pytest.mark.parametrize("visitor", ["user_bat", "v_123", ""])
async def test_only_anonymous_visitors_can_save_a_profile(api: httpx.AsyncClient, fake: Any, visitor: str) -> None:
    response = await api.post("/api/profile", json={"visitor_id": visitor, "answers": {}})
    assert response.status_code == 422
    assert fake.users.docs == []


async def test_a_profile_is_saved_and_templates_answer_when_oyu_is_off(api: httpx.AsyncClient, fake: Any) -> None:
    answers = {"name": "Сарнай", "party": "solo"}
    response = await api.post("/api/profile", json={"visitor_id": VISITOR, "answers": answers})
    assert response.status_code == 200
    assert response.json() == {"summary": None, "suggestions": [], "via": None}
    assert fake.users.docs[0]["_id"] == VISITOR
    assert [m["text"] for m in fake.memories.docs] == ["Ганцаараа аялдаг."]


async def test_unknown_answers_are_refused(api: httpx.AsyncClient, fake: Any) -> None:
    response = await api.post("/api/profile", json={"visitor_id": VISITOR, "answers": {"diet": ["gluten_free"]}})
    assert response.status_code == 422


def test_chat_accepts_only_a_visitor_id() -> None:
    assert orchestrator.ChatRequest(trip_id="t", message="hi", user_id=VISITOR).user_id == VISITOR
    with pytest.raises(ValidationError):
        orchestrator.ChatRequest(trip_id="t", message="hi", user_id="user_bat")


async def test_a_turn_starts_with_the_travelers_profile(fake: Any) -> None:
    await memory.save_profile(fake, VISITOR, Profile(name="Сарнай", diet=["no_seafood"]))
    sent = await agent_module.Agent._with_profile("Оройн хоол хаана идэх вэ?", VISITOR)
    assert sent.startswith("[Аялагчийн хөрөг: Сарнай]\n- Хоолны хязгаарлалт: далайн хоол идэхгүй.")
    assert sent.endswith("\n\nОройн хоол хаана идэх вэ?")
    assert await agent_module.Agent._with_profile("hi", None) == "hi"
    assert await agent_module.Agent._with_profile("hi", "v_00000000-0000-0000-0000-000000000000") == "hi"


async def test_remember_saves_for_the_traveler_who_is_asking(fake: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setitem(tools.turn_users, "trip_hanoi_demo", VISITOR)
    result = await tools.remember_fact("trip_hanoi_demo", {"text": "Ээж нь хол алхаж чаддаггүй.", "kind": "fact"})
    assert "is_error" not in result
    saved = fake.memories.docs[0]
    assert (saved["user_id"], saved["source"], saved["trip_id"]) == (VISITOR, "chat", "trip_hanoi_demo")
    assert (await tools.remember_fact("trip_hanoi_demo", {"text": "", "kind": "fact"}))["is_error"]
    monkeypatch.setitem(tools.turn_users, "trip_hanoi_demo", "")
    assert (await tools.remember_fact("trip_hanoi_demo", {"text": "x", "kind": "fact"}))["is_error"]
