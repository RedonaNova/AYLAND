# Welcome flow and traveler memory: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A one-time, seven-step welcome flow whose answers become the visitor's long-term memory in MongoDB, which Claude reads on every chat turn, with an OyuLLM-written summary and starter suggestions.

**Architecture:** The backend gets a `Profile` contract, Mongolian memory sentences (`orchestrator/prompts/profile.py`), a small memory store (`orchestrator/memory.py`), an OyuLLM write-up (`orchestrator/onboarding.py`), `POST /api/profile`, a per-turn profile block in `Agent.run`, and a `remember` tool. The frontend gets `lib/profile.ts` (browser copy, visitor id, templates, submit), an overlay (`components/onboarding/`) mounted by `AppShell`, a personalised `Welcome`, a replay control, and `user_id` on chat requests.

**Tech Stack:** FastAPI, pydantic v2, PyMongo async, OpenAI-compatible OyuLLM client, pytest; Next.js 16, React 19, Tailwind v4, motion, Playwright.

**Spec:** [docs/superpowers/specs/2026-10-03-welcome-onboarding-design.md](../specs/2026-10-03-welcome-onboarding-design.md)

## Global Constraints

- User-facing Mongolian text lives only in `frontend/src/i18n/mn.ts` (web) and `backend/ayland/orchestrator/prompts/` (agent).
- Visitor ids match `^v_[0-9a-f-]{36}$`; the API refuses any other id, including `user_bat`.
- Every `Answers` field is optional; `extra="forbid"` on the pydantic model.
- OyuLLM: `onboarding_llm: "oyu" | "off"` (default `"oyu"`), `onboarding_llm_daily_cap` (default 200), 8 s timeout; any failure → `summary: null` and the frontend templates.
- Headings and the summary type at about 35 characters a second; instant with reduced motion.
- Only `backend/ayland/config.py` reads environment variables.
- Offline tests only (no MongoDB, Claude or Novelsoft in CI).

## Review Focus

- Storage blocked (private window): the flow must still complete and the app must not crash → covered by the guarded reads in `lib/profile.ts` (Task 5).
- A visitor double-clicks **Дуусгах**: only one submit and one done screen → `next()` moves past the last step before submitting (Task 6).
- Re-running the flow (replay) must replace onboarding memories but keep chat memories → `test_saving_again_replaces_only_the_onboarding_memories` (Task 2).
- Claude must never see a block for an empty profile (no "[Аялагчийн хөрөг]" with nothing under it) → `test_no_block_without_anything_to_say` (Task 2).
- The OyuLLM reply wrapped in a code fence or with extra text must still be read → `test_a_fenced_reply_is_read` (Task 3).

---

### Task 1: Profile contract and Mongolian memory sentences

**Files:**
- Modify: `backend/ayland/db/models.py` (add `Profile`; extend `User`, `Memory`)
- Create: `backend/ayland/orchestrator/prompts/profile.py`
- Test: `backend/tests/test_profile_text.py`

**Interfaces:**
- Produces: `models.Profile`; `User.profile`, `User.updated_at`; `Memory.source`, `Memory.to_mongo()` with a BSON `created_at`; `profile.sentences(Profile) -> list[str]`, `profile.preference_sentences(Preferences) -> list[str]`, `profile.preferences(Profile) -> Preferences`, `profile.block(name, lines, memories) -> str`, `profile.TRAVELER`.

- [ ] **Step 1: Write the failing test** (`backend/tests/test_profile_text.py`)

```python
from ayland.db.models import Preferences, Profile
from ayland.orchestrator.prompts import profile as text

FULL = Profile(
    name="Сарнай",
    party="family",
    party_size=4,
    kids=True,
    budget="mid",
    splurge=["food", "stay"],
    pace="relaxed",
    diet=["halal", "no_seafood"],
    misses_mongolian_food=True,
    interests=["history", "photo"],
    english="some",
    notes="  Ээж маань хол алхаж чаддаггүй ",
)


def test_one_sentence_per_answered_topic() -> None:
    assert text.sentences(FULL) == [
        "Гэр бүлээрээ, 4 хүн аялдаг, хүүхэдтэй.",
        "Төсөв: дунд зэрэг. Илүү зарцуулахад бэлэн: хоол, байр.",
        "Тайван хэмнэлээр аялах дуртай (өдөрт 2–3 газар).",
        "Хоолны хязгаарлалт: халал, далайн хоол идэхгүй.",
        "Гадаадад монгол хоол санадаг.",
        "Сонирхол: түүх ба соёл, гэрэл зураг.",
        "Англиар бага зэрэг ярьдаг; орон нутгийнхантай ярихад орчуулагч хэрэг болно.",
        "Тэмдэглэл: Ээж маань хол алхаж чаддаггүй",
    ]


def test_skipped_questions_say_nothing() -> None:
    assert text.sentences(Profile()) == []
    assert text.sentences(Profile(party="solo")) == ["Ганцаараа аялдаг."]


def test_preferences_are_derived_for_older_readers() -> None:
    prefs = text.preferences(FULL)
    assert prefs.interests == ["түүх ба соёл", "гэрэл зураг"]
    assert prefs.food == ["халал", "далайн хоол идэхгүй"]
    assert prefs.pace == "relaxed" and prefs.notes == "Ээж маань хол алхаж чаддаггүй"
    assert text.preferences(Profile()).pace == "normal"


def test_the_seed_users_preferences_read_as_sentences() -> None:
    prefs = Preferences(interests=["түүх", "хоол"], food=["далайн хоол идэхгүй (Номин)"], pace="relaxed", notes="4 найз")
    assert text.preference_sentences(prefs) == [
        "Сонирхол: түүх, хоол.",
        "Хоол: далайн хоол идэхгүй (Номин).",
        "Тайван хэмнэлээр аялах дуртай (өдөрт 2–3 газар).",
        "Тэмдэглэл: 4 найз",
    ]


def test_the_block_names_the_traveler_and_lists_memories_after_the_profile() -> None:
    block = text.block("", ["Ганцаараа аялдаг."], ["Ээж нь хол алхаж чаддаггүй."])
    assert block == "[Аялагчийн хөрөг: Аялагч]\n- Ганцаараа аялдаг.\n[Санах ой]\n- Ээж нь хол алхаж чаддаггүй."
    assert text.block("Бат", [], []) == ""


def test_unknown_answers_are_refused() -> None:
    import pytest
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        Profile.model_validate({"diet": ["gluten_free"]})
    with pytest.raises(ValidationError):
        Profile.model_validate({"name": "x" * 41})
```

- [ ] **Step 2: Run it to see it fail**

Run: `uv --directory backend run pytest tests/test_profile_text.py -q`
Expected: FAIL, `ImportError: cannot import name 'Profile'`.

- [ ] **Step 3: Add the contract** (`backend/ayland/db/models.py`, after `Preferences`)

```python
class Profile(Doc):
    """The welcome flow's answers (users.profile). Every field is optional: each step can be skipped."""

    name: str = Field("", max_length=40)
    party: Literal["solo", "couple", "family", "friends"] | None = None
    party_size: int | None = Field(None, ge=1, le=12)
    kids: bool | None = None
    budget: Literal["thrifty", "mid", "comfort"] | None = None
    splurge: list[Literal["stay", "food", "experiences", "shopping"]] = Field([], max_length=4)
    pace: Literal["relaxed", "normal", "packed"] | None = None
    diet: list[Literal["halal", "vegetarian", "no_seafood", "mild_spice", "dairy_free"]] = Field([], max_length=5)
    misses_mongolian_food: bool | None = None
    interests: list[
        Literal["history", "food", "nature", "art", "shopping", "nightlife", "photo", "spa", "kids"]
    ] = Field([], max_length=9)
    english: Literal["fluent", "some", "none"] | None = None
    notes: str = Field("", max_length=500)
```

Extend `User` and `Memory`:

```python
class User(Doc):
    id: str = Field(alias="_id")
    name: str
    language: Literal["mn"] = "mn"
    preferences: Preferences = Preferences()
    profile: Profile | None = None
    updated_at: AwareDatetime | None = None


class Memory(Doc):
    user_id: str
    trip_id: str | None = None
    kind: Literal["preference", "fact", "feedback"]
    source: Literal["onboarding", "chat", "seed"] = "chat"
    text: str
    embedding: list[float] | None = None
    created_at: AwareDatetime

    def to_mongo(self) -> dict[str, Any]:
        # BSON date, so "the latest memories" sort chronologically.
        return {**super().to_mongo(), "created_at": self.created_at}
```

- [ ] **Step 4: Write the sentences** (`backend/ayland/orchestrator/prompts/profile.py`)

```python
"""What AYLAND knows about a traveler, in Mongolian: one sentence per answered welcome-flow topic (stored as
onboarding memories), and the block that starts every chat turn (welcome-flow spec, "Agent")."""

from ayland.db.models import Preferences, Profile

TRAVELER = "Аялагч"
PARTY = {"solo": "Ганцаараа", "couple": "Хосоороо", "family": "Гэр бүлээрээ", "friends": "Найзуудтайгаа"}
GROUPS = ("family", "friends")
BUDGET = {"thrifty": "хэмнэлттэй", "mid": "дунд зэрэг", "comfort": "тансаг"}
SPLURGE = {"stay": "байр", "food": "хоол", "experiences": "үзвэр ба туршлага", "shopping": "дэлгүүр"}
PACE = {
    "relaxed": "Тайван хэмнэлээр аялах дуртай (өдөрт 2–3 газар).",
    "normal": "Тэнцвэртэй хэмнэлээр аялдаг (өдөрт 3–4 газар).",
    "packed": "Идэвхтэй аялах дуртай, аль болох ихийг үзнэ.",
}
DIET = {
    "halal": "халал",
    "vegetarian": "цагаан хоолтон",
    "no_seafood": "далайн хоол идэхгүй",
    "mild_spice": "халуун ногоо бага",
    "dairy_free": "сүүн бүтээгдэхүүнгүй",
}
INTERESTS = {
    "history": "түүх ба соёл",
    "food": "хоол амтлах",
    "nature": "байгаль ба гадаа",
    "art": "урлаг ба музей",
    "shopping": "дэлгүүр",
    "nightlife": "шөнийн амьдрал",
    "photo": "гэрэл зураг",
    "spa": "спа ба амралт",
    "kids": "хүүхдэд ээлтэй газар",
}
ENGLISH = {
    "fluent": "Англиар чөлөөтэй ярьдаг.",
    "some": "Англиар бага зэрэг ярьдаг; орон нутгийнхантай ярихад орчуулагч хэрэг болно.",
    "none": "Англиар ярьдаггүй; орон нутгийнхантай ярихад орчуулагч хэрэгтэй.",
}


def sentences(profile: Profile) -> list[str]:
    """One sentence per answered topic; a skipped topic says nothing."""
    out: list[str] = []
    if profile.party:
        line = PARTY[profile.party]
        if profile.party in GROUPS and profile.party_size:
            line += f", {profile.party_size} хүн"
        line += " аялдаг"
        if profile.party in GROUPS and profile.kids:
            line += ", хүүхэдтэй"
        out.append(line + ".")
    if profile.budget:
        line = f"Төсөв: {BUDGET[profile.budget]}."
        if profile.splurge:
            line += f" Илүү зарцуулахад бэлэн: {', '.join(SPLURGE[s] for s in profile.splurge)}."
        out.append(line)
    if profile.pace:
        out.append(PACE[profile.pace])
    if profile.diet:
        out.append(f"Хоолны хязгаарлалт: {', '.join(DIET[d] for d in profile.diet)}.")
    if profile.misses_mongolian_food:
        out.append("Гадаадад монгол хоол санадаг.")
    if profile.interests:
        out.append(f"Сонирхол: {', '.join(INTERESTS[i] for i in profile.interests)}.")
    if profile.english:
        out.append(ENGLISH[profile.english])
    if profile.notes.strip():
        out.append(f"Тэмдэглэл: {profile.notes.strip()}")
    return out


def preference_sentences(prefs: Preferences) -> list[str]:
    """The seed user's older `preferences` (Bat), read the same way."""
    out: list[str] = []
    if prefs.interests:
        out.append(f"Сонирхол: {', '.join(prefs.interests)}.")
    if prefs.food:
        out.append(f"Хоол: {', '.join(prefs.food)}.")
    out.append(PACE[prefs.pace])
    if prefs.notes.strip():
        out.append(f"Тэмдэглэл: {prefs.notes.strip()}")
    return out


def preferences(profile: Profile) -> Preferences:
    """`users.preferences` derived from the answers, so readers of the older shape keep working."""
    return Preferences(
        interests=[INTERESTS[i] for i in profile.interests],
        food=[DIET[d] for d in profile.diet],
        pace=profile.pace or "normal",
        notes=profile.notes.strip(),
    )


def block(name: str, lines: list[str], memories: list[str]) -> str:
    """What Claude reads before the traveler's message; '' when there is nothing to say."""
    if not lines and not memories:
        return ""
    parts = [f"[Аялагчийн хөрөг: {name or TRAVELER}]", *(f"- {line}" for line in lines)]
    if memories:
        parts += ["[Санах ой]", *(f"- {memory}" for memory in memories)]
    return "\n".join(parts)
```

- [ ] **Step 5: Run the tests**

Run: `uv --directory backend run pytest tests/test_profile_text.py tests/test_models.py -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/ayland/db/models.py backend/ayland/orchestrator/prompts/profile.py backend/tests/test_profile_text.py
git commit -m "feat(api): profile contract and Mongolian memory sentences"
```

---

### Task 2: Memory store

**Files:**
- Create: `backend/ayland/orchestrator/memory.py`, `backend/tests/fake_db.py`
- Modify: `backend/ayland/demo/seed.py` (`ensure_indexes`)
- Test: `backend/tests/test_memory.py`

**Interfaces:**
- Consumes: Task 1.
- Produces: `memory.VISITOR_PATTERN: str`, `memory.save_profile(db, visitor_id, profile) -> None`, `memory.remember(db, user_id, text, kind, trip_id) -> None`, `memory.context(db, user_id) -> str`; `tests/fake_db.FakeDb` with `users` and `memories`.

- [ ] **Step 1: Write the fake** (`backend/tests/fake_db.py`)

```python
"""The few MongoDB operations the memory code uses, in memory, for offline tests."""

from typing import Any


def _matches(doc: dict[str, Any], query: dict[str, Any]) -> bool:
    for key, want in query.items():
        have = doc.get(key)
        if isinstance(want, dict) and "$ne" in want:
            if have == want["$ne"]:
                return False
        elif have != want:
            return False
    return True


class FakeCursor:
    def __init__(self, docs: list[dict[str, Any]]) -> None:
        self.docs = docs

    def sort(self, key: str, direction: int) -> "FakeCursor":
        self.docs.sort(key=lambda doc: doc[key], reverse=direction < 0)
        return self

    def limit(self, n: int) -> "FakeCursor":
        self.docs = self.docs[:n]
        return self

    async def to_list(self) -> list[dict[str, Any]]:
        return [dict(doc) for doc in self.docs]


class FakeCollection:
    def __init__(self) -> None:
        self.docs: list[dict[str, Any]] = []

    async def find_one(self, query: dict[str, Any]) -> dict[str, Any] | None:
        return next((dict(doc) for doc in self.docs if _matches(doc, query)), None)

    def find(self, query: dict[str, Any]) -> FakeCursor:
        return FakeCursor([doc for doc in self.docs if _matches(doc, query)])

    async def replace_one(self, query: dict[str, Any], doc: dict[str, Any], upsert: bool = False) -> None:
        for i, existing in enumerate(self.docs):
            if _matches(existing, query):
                self.docs[i] = dict(doc)
                return
        if upsert:
            self.docs.append(dict(doc))

    async def insert_one(self, doc: dict[str, Any]) -> None:
        self.docs.append(dict(doc))

    async def insert_many(self, docs: list[dict[str, Any]]) -> None:
        self.docs.extend(dict(doc) for doc in docs)

    async def delete_many(self, query: dict[str, Any]) -> None:
        self.docs = [doc for doc in self.docs if not _matches(doc, query)]


class FakeDb:
    def __init__(self) -> None:
        self.users = FakeCollection()
        self.memories = FakeCollection()
```

- [ ] **Step 2: Write the failing test** (`backend/tests/test_memory.py`)

```python
from datetime import UTC, datetime, timedelta
from typing import Any, cast

from fake_db import FakeDb

from ayland.db.models import Profile
from ayland.orchestrator import memory

VISITOR = "v_0f8fad5b-d9cb-469f-a165-70867728950e"


def db() -> Any:
    return cast(Any, FakeDb())


async def test_saving_writes_the_user_and_one_memory_per_answer() -> None:
    fake = db()
    await memory.save_profile(fake, VISITOR, Profile(name="Сарнай", party="solo", diet=["halal"]))
    user = fake.users.docs[0]
    assert user["_id"] == VISITOR and user["name"] == "Сарнай"
    assert user["preferences"]["food"] == ["халал"] and user["profile"]["party"] == "solo"
    assert [m["text"] for m in fake.memories.docs] == ["Ганцаараа аялдаг.", "Хоолны хязгаарлалт: халал."]
    assert {m["source"] for m in fake.memories.docs} == {"onboarding"}


async def test_saving_again_replaces_only_the_onboarding_memories() -> None:
    fake = db()
    await memory.save_profile(fake, VISITOR, Profile(party="solo"))
    await memory.remember(fake, VISITOR, "Ээж нь хол алхаж чаддаггүй.", "fact", "trip_hanoi_demo")
    await memory.save_profile(fake, VISITOR, Profile(party="couple"))
    assert len(fake.users.docs) == 1
    assert sorted(m["text"] for m in fake.memories.docs) == ["Ээж нь хол алхаж чаддаггүй.", "Хосоороо аялдаг."]


async def test_context_has_the_profile_then_the_latest_chat_memories_in_order() -> None:
    fake = db()
    await memory.save_profile(fake, VISITOR, Profile(name="Сарнай", diet=["no_seafood"]))
    start = datetime(2026, 10, 3, tzinfo=UTC)
    for n in range(13):
        fake.memories.docs.append(
            {"user_id": VISITOR, "kind": "fact", "source": "chat", "text": f"#{n}", "created_at": start + timedelta(minutes=n)}
        )
    lines = (await memory.context(fake, VISITOR)).splitlines()
    assert lines[:3] == ["[Аялагчийн хөрөг: Сарнай]", "- Хоолны хязгаарлалт: далайн хоол идэхгүй.", "[Санах ой]"]
    assert lines[3:] == [f"- #{n}" for n in range(1, 13)]  # the latest 12, oldest first


async def test_the_seed_user_is_read_from_preferences() -> None:
    fake = db()
    fake.users.docs.append(
        {"_id": "user_bat", "name": "Бат", "language": "mn",
         "preferences": {"interests": ["түүх"], "food": ["далайн хоол идэхгүй (Номин)"], "pace": "relaxed", "notes": ""}}
    )
    block = await memory.context(fake, "user_bat")
    assert block.splitlines()[0] == "[Аялагчийн хөрөг: Бат]"
    assert "- Хоол: далайн хоол идэхгүй (Номин)." in block


async def test_no_block_without_anything_to_say() -> None:
    fake = db()
    assert await memory.context(fake, VISITOR) == ""
    await memory.save_profile(fake, VISITOR, Profile())
    assert await memory.context(fake, VISITOR) == ""
```

- [ ] **Step 3: Run it to see it fail**

Run: `uv --directory backend run pytest tests/test_memory.py -q`
Expected: FAIL, `ImportError: cannot import name 'memory'`.

- [ ] **Step 4: Write the store** (`backend/ayland/orchestrator/memory.py`)

```python
"""Long-term traveler memory (users, memories): the welcome flow's profile, facts learned in chat, and the block
of both that starts every chat turn (welcome-flow spec)."""

from datetime import UTC, datetime
from typing import Any, Literal

from ayland.db.models import Memory, Preferences, Profile, User

from .prompts import profile as text

VISITOR_PATTERN = r"^v_[0-9a-f-]{36}$"  # anonymous visitors only: no one can write into a seeded user
RECENT = 12


async def save_profile(db: Any, visitor_id: str, profile: Profile) -> None:
    """Upsert the visitor and replace their onboarding memories (chat memories stay)."""
    now = datetime.now(UTC)
    user = User(
        _id=visitor_id,
        name=profile.name.strip() or text.TRAVELER,
        preferences=text.preferences(profile),
        profile=profile,
        updated_at=now,
    )
    await db.users.replace_one({"_id": visitor_id}, user.to_mongo(), upsert=True)
    await db.memories.delete_many({"user_id": visitor_id, "source": "onboarding"})
    lines = text.sentences(profile)
    if lines:
        docs = [Memory(user_id=visitor_id, kind="preference", source="onboarding", text=line, created_at=now) for line in lines]
        await db.memories.insert_many([doc.to_mongo() for doc in docs])


async def remember(db: Any, user_id: str, sentence: str, kind: Literal["preference", "fact"], trip_id: str | None) -> None:
    doc = Memory(user_id=user_id, trip_id=trip_id, kind=kind, source="chat", text=sentence, created_at=datetime.now(UTC))
    await db.memories.insert_one(doc.to_mongo())


async def context(db: Any, user_id: str) -> str:
    """The block for one turn: the profile (or a seed user's preferences) and the latest chat memories."""
    user = await db.users.find_one({"_id": user_id})
    name, lines = "", []
    if user:
        name = user.get("name", "")
        if user.get("profile"):
            lines = text.sentences(Profile.model_validate(user["profile"]))
        elif user.get("preferences"):
            lines = text.preference_sentences(Preferences.model_validate(user["preferences"]))
    cursor = db.memories.find({"user_id": user_id, "source": {"$ne": "onboarding"}}).sort("created_at", -1).limit(RECENT)
    recent = [m["text"] for m in await cursor.to_list()]
    return text.block(name, lines, recent[::-1])
```

- [ ] **Step 5: Add the index** (`backend/ayland/demo/seed.py`, `ensure_indexes`, plus `DESCENDING` in the pymongo import)

```python
    await db.memories.create_index([("user_id", ASCENDING), ("created_at", DESCENDING)])
```

- [ ] **Step 6: Run the tests**

Run: `uv --directory backend run pytest tests/test_memory.py -q`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/ayland/orchestrator/memory.py backend/ayland/demo/seed.py backend/tests/fake_db.py backend/tests/test_memory.py
git commit -m "feat(api): traveler memory store for profiles and chat facts"
```

---

### Task 3: OyuLLM writes the summary and starter suggestions

**Files:**
- Modify: `backend/ayland/config.py`, `backend/ayland/orchestrator/prompts/__init__.py`
- Create: `backend/ayland/orchestrator/prompts/onboarding.md`, `backend/ayland/orchestrator/onboarding.py`
- Test: `backend/tests/test_onboarding.py`

**Interfaces:**
- Produces: `Settings.onboarding_llm`, `Settings.onboarding_llm_daily_cap`; `prompts.onboarding_prompt() -> str`; `onboarding.Welcome(summary: str, suggestions: list[str])`, `onboarding.parse(raw) -> Welcome | None`, `onboarding.write(profile) -> Welcome | None`, `onboarding.DailyCap`, module attributes `cap`, `TIMEOUT_S`.

- [ ] **Step 1: Write the failing test** (`backend/tests/test_onboarding.py`)

```python
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


@pytest.mark.parametrize("raw", ["", "not json", '{"summary": "", "suggestions": ["a", "b", "c"]}', '{"summary": "a", "suggestions": ["a"]}'])
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
```

- [ ] **Step 2: Run it to see it fail**

Run: `uv --directory backend run pytest tests/test_onboarding.py -q`
Expected: FAIL, `ImportError: cannot import name 'onboarding'`.

- [ ] **Step 3: Settings** (`backend/ayland/config.py`; add `from typing import Literal`)

```python
    # Welcome flow: OyuLLM writes each visitor's summary and starter suggestions (decision D1), at most this
    # many a day per process, so a burst of public visitors can't drain the shared credit.
    onboarding_llm: Literal["oyu", "off"] = "oyu"
    onboarding_llm_daily_cap: int = 200
```

- [ ] **Step 4: The prompt** (`backend/ayland/orchestrator/prompts/onboarding.md`)

```markdown
Чи AYLAND аяллын туслахын өмнөөс бичнэ. Аялагч танилцах асуултуудад хариулсан. Хариултыг нь уншаад зөвхөн дараах JSON-оор хариул, өөр юу ч бүү бич:
{"summary": "...", "suggestions": ["...", "...", "..."]}

- summary: аялагчид нэрээр нь хандсан, найрсаг хоёр өгүүлбэр. Түүнийг хэрхэн ойлгосноо, цаашид юуг анхаарч санал болгохоо хэл. Хоолны хязгаарлалт байвал заавал дурд.
- suggestions: Ханойд яг одоо аялж буй аялагчийн чатыг эхлүүлэх гурван богино хүсэлт, тус бүр долоон үгээс хэтрэхгүй. Аялагчийн өөрийнх нь өмнөөс бичнэ (жишээ нь «Ойрхон халал хоолны газар хайж өгөөч»). Сонирхол, хэмнэл, хоолны хязгаарлалтад нь тохируул.
- Зөвхөн монгол хэлээр, кирилл үсгээр. Үнэ, цаг, газрын нэр зохиож бүү бич.
```

`backend/ayland/orchestrator/prompts/__init__.py`:

```python
def onboarding_prompt() -> str:
    """OyuLLM's instructions for the welcome flow's summary and starter suggestions."""
    return (_HERE / "onboarding.md").read_text(encoding="utf-8")
```

- [ ] **Step 5: The writer** (`backend/ayland/orchestrator/onboarding.py`)

```python
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
```

- [ ] **Step 6: Run the tests**

Run: `uv --directory backend run pytest tests/test_onboarding.py tests/test_config.py -q`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/ayland/config.py backend/ayland/orchestrator/prompts backend/ayland/orchestrator/onboarding.py backend/tests/test_onboarding.py
git commit -m "feat(api): OyuLLM writes the welcome summary, capped, with fallback"
```

---

### Task 4: API, per-turn profile and the `remember` tool

**Files:**
- Modify: `backend/ayland/orchestrator/app.py` (imports, `ProfileRequest`, `POST /api/profile`, `ChatRequest.user_id`, `chat_turn`, `start_chat`)
- Modify: `backend/ayland/orchestrator/agent.py` (`run(..., user_id)`, `_with_profile`)
- Modify: `backend/ayland/orchestrator/tools.py` (`turn_users`, `remember_fact`, the `remember` tool)
- Modify: `backend/ayland/orchestrator/prompts/system.md` (v3)
- Test: `backend/tests/test_profile_api.py`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: `POST /api/profile {visitor_id, answers} -> {summary: str | None, suggestions: list[str], via: "oyu" | None}`; `ChatRequest.user_id: str | None`; `Agent.run(trip_id, message, run_id, user_id=None)`; `Agent._with_profile(message, user_id) -> str` (static); `tools.turn_users: dict[str, str]`; `tools.remember_fact(trip_id, args) -> dict`.

- [ ] **Step 1: Write the failing test** (`backend/tests/test_profile_api.py`)

```python
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
    response = await api.post("/api/profile", json={"visitor_id": VISITOR, "answers": {"name": "Сарнай", "party": "solo"}})
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
```

- [ ] **Step 2: Run it to see it fail**

Run: `uv --directory backend run pytest tests/test_profile_api.py -q`
Expected: FAIL (404 on `/api/profile`, missing `_with_profile`, missing `remember_fact`).

- [ ] **Step 3: API** (`backend/ayland/orchestrator/app.py`)

Imports: `from ayland.db.models import Profile` and `from . import a2a, memory, onboarding, prompts, proposals`.

Above `ChatRequest`:

```python
class ProfileRequest(BaseModel):
    visitor_id: str = Field(pattern=memory.VISITOR_PATTERN)
    answers: Profile


@app.post("/api/profile")
async def save_profile(body: ProfileRequest) -> dict[str, Any]:
    """The welcome flow's answers become the visitor's long-term memory. OyuLLM writes the summary and starter
    suggestions; `summary: null` tells the web app to use its templates instead."""
    await memory.save_profile(get_db(), body.visitor_id, body.answers)
    written = await onboarding.write(body.answers)
    if written is None:
        return {"summary": None, "suggestions": [], "via": None}
    return {"summary": written.summary, "suggestions": written.suggestions, "via": "oyu"}
```

`ChatRequest`, `chat_turn`, `start_chat`:

```python
class ChatRequest(BaseModel):
    trip_id: str
    message: str = Field(min_length=1, max_length=2000)
    # A visitor who finished the welcome flow; without it the turn uses the trip owner's profile.
    user_id: str | None = Field(None, pattern=memory.VISITOR_PATTERN)


async def chat_turn(trip_id: str, message: str, run_id: str, user_id: str | None = None) -> AsyncIterator[Event]:
    ...
        async for item in agent.run(trip_id, message, run_id, user_id):


async def start_chat(body: ChatRequest) -> Run:
    db = get_db()
    try:
        trip = await repo.get_trip(db, body.trip_id)  # only real trips get a Claude session
    except repo.TripNotFound as err:
        raise HTTPException(404, str(err)) from err
    run_id = f"run_{uuid.uuid4().hex[:10]}"
    await repo.save_message(db, body.trip_id, "user", body.message, run_id)
    user_id = body.user_id or trip["owner_id"]
    return runs.start(
        body.trip_id, lambda run: chat_turn(body.trip_id, body.message, run.id, user_id), run_id=run_id
    )
```

- [ ] **Step 4: The profile block in each turn** (`backend/ayland/orchestrator/agent.py`)

Imports: `from pymongo.errors import PyMongoError`, `from ayland.db.client import MongoNotConfigured, explain, get_db`, `from . import memory, prompts, tools`.

```python
    async def run(self, trip_id: str, message: str, run_id: str, user_id: str | None = None) -> AsyncIterator[Event]:
        ...
            tools.turn_runs[trip_id] = run_id  # so the tools' agent_events carry this turn's id
            tools.turn_users[trip_id] = user_id or ""  # whom `remember` writes for
            finished = False
            try:
                await self._reconnect_mcp(client)
                await client.query(await self._with_profile(message, user_id))

    @staticmethod
    async def _with_profile(message: str, user_id: str | None) -> str:
        """The traveler's message after the block of what AYLAND knows about them (only Claude sees it; the stored
        message stays as typed). Without MongoDB the turn still runs, without the block."""
        if not user_id:
            return message
        try:
            block = await memory.context(get_db(), user_id)
        except (PyMongoError, MongoNotConfigured) as err:
            logger.warning("Traveler profile not loaded: %s", explain(err))
            return message
        return f"{block}\n\n{message}" if block else message
```

- [ ] **Step 5: The `remember` tool** (`backend/ayland/orchestrator/tools.py`)

```python
LOCAL = (
    "get_trip", "get_budget_status", "present_options", "update_trip_plan", "undo_plan_change", "propose_booking", "remember",
)
...
# The user each trip's current turn speaks for (the welcome flow's visitor, or the trip owner), for `remember`.
turn_users: dict[str, str] = {}
MEMORY_MAX = 200

REMEMBER_SCHEMA = {
    "type": "object",
    "properties": {
        "text": {"type": "string", "description": "One short Mongolian sentence, e.g. 'Ээж нь хол алхаж чаддаггүй.'"},
        "kind": {"type": "string", "enum": ["preference", "fact"]},
    },
    "required": ["text", "kind"],
}


async def remember_fact(trip_id: str, args: dict[str, Any]) -> dict[str, Any]:
    """The `remember` tool: one sentence about the traveler who is asking, kept for later turns and trips."""
    user_id = turn_users.get(trip_id, "")
    sentence = str(args.get("text", "")).strip()
    kind = "preference" if args.get("kind") == "preference" else "fact"
    if not user_id:
        return _refused(ValueError("No traveler to remember this for."))
    if not sentence or len(sentence) > MEMORY_MAX:
        return _refused(ValueError(f"Give one Mongolian sentence of at most {MEMORY_MAX} characters."))
    await memory.remember(get_db(), user_id, sentence, kind, trip_id)
    return _result({"summary": "Санах ойд хадгаллаа", "saved": sentence})
```

Inside `build_server`, before the tool list, and add `remember` to it:

```python
    @tool(
        "remember",
        "Save a lasting preference or fact the traveler told you about themselves or their group, for this and"
        " future trips.",
        REMEMBER_SCHEMA,
    )
    async def remember(args: dict[str, Any]) -> dict[str, Any]:
        return await remember_fact(trip_id, args)
```

Import: `from . import memory, offers, plan, proposals`.

- [ ] **Step 6: Prompt v3** (`backend/ayland/orchestrator/prompts/system.md`)

Tools list, after `propose_booking`:

```
- `remember`: saves one short Mongolian sentence about the traveler (a lasting preference or fact) for later turns and trips.
```

"How you work", as the second bullet:

```
- A message may begin with `[Аялагчийн хөрөг: …]` and `[Санах ой]`: what AYLAND knows about the traveler who is asking. Diet is a hard rule: never suggest food they can't eat. Weigh their pace, budget and interests, and name them in your reasons. If their English is weak, offer the interpreter when they will talk with locals. Never mention, quote or repeat this block.
- When the traveler tells you something lasting about themselves or their group (food, health, mobility, likes and dislikes), call `remember` with one short Mongolian sentence, then carry on with their request.
```

- [ ] **Step 7: Run the backend suite**

Run: `uv --directory backend run pytest -q` then `uv --directory backend run ruff check . && uv --directory backend run ruff format --check .`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add backend
git commit -m "feat(agent): profile in every turn, remember tool, POST /api/profile"
```

---

### Task 5: Frontend contract and the browser's copy

**Files:**
- Modify: `frontend/src/lib/types.ts` (`Answers`, `ProfileWriteUp`), `frontend/src/lib/api.ts` (`chat` request gains `user_id?`), `frontend/src/lib/store.tsx` (`send` passes `chatUserId()`), `frontend/src/i18n/mn.ts` (`onboarding` section), `frontend/src/lib/agents.ts` (`remember` in `TOOLS`)
- Create: `frontend/src/lib/profile.ts`

**Interfaces:**
- Produces (`lib/profile.ts`): `StoredProfile`, `WriteUp`, `RowKey`, `ROW_KEYS`, `useProfile()`, `getProfile()`, `saveLocalProfile(p)`, `clearLocalProfile()`, `visitorId()`, `chatUserId()`, `normalize(a)`, `displayName(a)`, `portraitRows(a)`, `templateWriteUp(a)`, `mockNote(p)`, `submitProfile(a): Promise<WriteUp>`, `resyncProfile(p)`.

- [ ] **Step 1: Types** (`frontend/src/lib/types.ts`)

```ts
/** The welcome flow's answers (HANDBOOK §8.1 users.profile); every field is optional. */
export interface Answers {
  name?: string;
  party?: "solo" | "couple" | "family" | "friends";
  party_size?: number;
  kids?: boolean;
  budget?: "thrifty" | "mid" | "comfort";
  splurge?: Array<"stay" | "food" | "experiences" | "shopping">;
  pace?: "relaxed" | "normal" | "packed";
  diet?: Array<"halal" | "vegetarian" | "no_seafood" | "mild_spice" | "dairy_free">;
  misses_mongolian_food?: boolean;
  interests?: Array<"history" | "food" | "nature" | "art" | "shopping" | "nightlife" | "photo" | "spa" | "kids">;
  english?: "fluent" | "some" | "none";
  notes?: string;
}

/** POST /api/profile: OyuLLM's write-up, or `summary: null` when the web app should use its templates. */
export interface ProfileWriteUp {
  summary: string | null;
  suggestions: string[];
  via: "oyu" | null;
}
```

- [ ] **Step 2: Copy** (`frontend/src/i18n/mn.ts`, new `onboarding` section before `agents`) — the full section is in Task 5's commit; its keys are used verbatim by Tasks 6–8: `title, close, next, finish, back, traveler, greeting(name), somethingElse, replay, steps.{name,party,budget,pace,food,interests,last}.{label,heading,reason}, name.placeholder, party.{options,size,fewer,more,people(n),kids}, budget.{options,splurgeQuestion,splurge,splurgeRow(items)}, pace.options.{relaxed,normal,packed}.{title,hint}, food.{diet,none,missQuestion,yes,no,missesRow}, interests.options, last.{englishQuestion,english,notesQuestion,notesPlaceholder}, portrait.{title,subtitle,rows,fresh,count(n,total),pill(n)}, done.{heading(name),writing,start,byOyu}, template.{party,pace,interests(items),understood(name,bits),diet(items),closing,suggest.{diet,mongolianFood,kids,interests,fallback}}, mock.{diet(name,items),interest(name,item)}`. Headings and reasons are the spec's table, verbatim.

- [ ] **Step 3: `lib/profile.ts`** — storage guarded like `lib/mode.ts`; `useSyncExternalStore(subscribe, read, () => undefined)` so the server and hydration render "unknown"; `visitorId()` falls back to `crypto.getRandomValues` where `randomUUID` is missing (plain-HTTP origins); `submitProfile` posts to `/api/profile` with a 12 s timeout and returns the templates (`synced: false`) on any failure; `resyncProfile` retries once and marks the copy synced either way.

- [ ] **Step 4: Wire chat** (`lib/api.ts`, `lib/store.tsx`, `lib/agents.ts`)

```ts
// api.ts
chat(req: { trip_id: string; message: string; user_id?: string }, signal?: AbortSignal): AsyncIterable<AgentEvent>;
// store.tsx, in send()
await run((signal) => api.chat({ trip_id: TRIP_ID, message, user_id: chatUserId() }, signal));
// agents.ts, TOOLS
remember: { label: "Санах ойд хадгалах", node: "mongodb" },
```

- [ ] **Step 5: Check**

Run: `npm --prefix frontend run lint && npm --prefix frontend run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib frontend/src/i18n/mn.ts
git commit -m "feat(web): welcome-flow contract, browser copy and Mongolian copy"
```

---

### Task 6: The welcome flow

**Files:**
- Create: `frontend/src/components/onboarding/Typewriter.tsx`, `Portrait.tsx`, `Steps.tsx`, `Onboarding.tsx`
- Modify: `frontend/src/components/shell/AppShell.tsx` (mount `<Onboarding />`)

**Interfaces:**
- Consumes: Task 5.
- Produces: `<Onboarding />` (renders nothing unless the browser has no finished or skipped flow); `<Typewriter text />` and `typingSeconds(text)`; `<Portrait answers fresh />`, `<PortraitPill answers fresh />`; step bodies `NameStep … LastStep` taking `{ answers, set }` with `set(patch, row)`.

- [ ] **Step 1: `Typewriter`** — interval at 30 ms advancing at 35 chars/s, `key` = text; while typing renders an `sr-only` copy plus an `aria-hidden` partial with a caret; when finished (or reduced motion) renders the plain text once.
- [ ] **Step 2: `Portrait`** — `<section aria-label="Аялагчийн хөрөг">`, counter `n / 7`, the name, seven rows from `portraitRows` (dashed when empty; the latest changed row highlighted with "шинэ"); `PortraitPill` opens it as a bottom sheet below `lg`.
- [ ] **Step 3: `Steps`** — chips are `<button aria-pressed>`; party size stepper 2–12 (default 4 for family and friends) and "Хүүхэдтэй" only for groups; "Хязгаарлалтгүй" sets `diet: []`; notes textarea `maxLength 500`.
- [ ] **Step 4: `Onboarding`** — `role="dialog" aria-modal`, z-60 over the app; heading through `Typewriter`, the step's reason and answers revealed after `typingSeconds(heading)` (0 with reduced motion); seven progress segments; back link with the step name; **Дараах** / **Дуусгах**; Enter advances unless focus is on a button or the textarea; the X saves `status: "skipped"`; finishing moves to the done screen *before* submitting (no double submit), shows "Хөргийг тань бичиж байна…" until `submitProfile` returns, then the streamed summary, **Эхлэх** (saves `status: "done"`) and "OyuLLM бичсэн" when `via === "oyu"`. Resyncs an unsynced copy once per load.
- [ ] **Step 5: Mount** — `AppShell` renders `<Onboarding />` last inside its root.
- [ ] **Step 6: Check** — `npm --prefix frontend run lint && npm --prefix frontend run typecheck`.
- [ ] **Step 7: Commit** — `git commit -m "feat(web): one-time welcome flow with a live traveler portrait"`.

---

### Task 7: Personal chat start, mock, replay

**Files:**
- Modify: `frontend/src/components/chat/Welcome.tsx`, `frontend/src/lib/mock/orchestrator.ts`, `frontend/src/components/shell/DemoControls.tsx`

- [ ] **Step 1: `Welcome`** — when `useProfile()?.status === "done"`: heading `mn.onboarding.greeting(displayName(answers))`, the stored suggestions as chips that `send()` their text, and a dashed "Өөр зүйл" chip that focuses the composer (replacing the intro line). Otherwise unchanged (Bat).
- [ ] **Step 2: Mock** — the options reply's closing sentence gets `mockNote(getProfile())` inserted after "Гурвуулаа төсөвт багтана.".
- [ ] **Step 3: Replay** — a "Танилцуулгыг дахин үзэх" button under Reset calls `clearLocalProfile()`.
- [ ] **Step 4: Check and commit** — lint, typecheck; `git commit -m "feat(web): chat greets the visitor, mock uses the profile, replay control"`.

---

### Task 8: End-to-end tests

**Files:**
- Modify: `frontend/playwright.config.ts` (every spec starts as a visitor who skipped the flow)
- Create: `frontend/e2e/onboarding.spec.ts`

- [ ] **Step 1: Config**

```ts
    // Every spec starts as a returning visitor who skipped the welcome flow; e2e/onboarding.spec.ts starts fresh.
    storageState: {
      cookies: [],
      origins: [
        { origin: "http://localhost:3000", localStorage: [{ name: "ayland.profile", value: JSON.stringify({ version: 1, status: "skipped" }) }] },
      ],
    },
```

- [ ] **Step 2: Specs** (`test.use({ storageState: { cookies: [], origins: [] }, reducedMotion: "reduce" })`)
  1. First visit with the backend down: name "Сарнай", family + kids → card shows "Гэр бүлээрээ, 4 хүн, хүүхэдтэй"; budget, pace, "Далайн хоол идэхгүй", "Түүх ба соёл", "Бага зэрэг", **Дуусгах** → "Бэлэн боллоо, Сарнай!", no "OyuLLM бичсэн"; **Эхлэх** → heading "Сайн байна уу, Сарнай! Хаанаас эхлэх вэ?" and the chip "Далайн хоолгүй оройн хоолны газар хайж өгөөч"; after a reload, still personal and no dialog.
  2. OyuLLM path: `/api/profile` answers `{summary, suggestions: ["Нэг","Хоёр","Гурав"], via: "oyu"}` → summary and "OyuLLM бичсэн" shown; the request carries a `v_…` id and `{ name: "Сарнай" }` only; **Эхлэх** → chip "Хоёр".
  3. The X skips for good across a reload (Bat's greeting); "Танилцуулгыг дахин үзэх" brings the dialog back.
  4. Phone (390 × 844): "Хосоороо", then the pill "Аялагчийн хөрөг · 1" opens the card showing it.
- [ ] **Step 3: Run** — `npm --prefix frontend run build && npm --prefix frontend run test:e2e` (Windows without Chromium: `PW_CHANNEL=msedge`). Expected: all specs PASS.
- [ ] **Step 4: Commit** — `git commit -m "test(web): welcome flow e2e; other specs start past it"`.

---

### Task 9: Handbook and delivery

- [ ] **Step 1: HANDBOOK** — §8.1 `users.profile`, `users.updated_at`, `memories.source` and the index; §8.2 `remember`; §8.4 `POST /api/profile` and `user_id` on chat; §9 D1 settled (OyuLLM writes the welcome summary and suggestions); §10 new task **M3-C3** welcome flow (ticked: offline tests pass) and M3-B3 marked partly covered (`remember`; `recall`/vectors still open); status v1.11 and a changelog row.
- [ ] **Step 2: Full check** — `npm test`, `uv --directory backend run ruff check .`, `uv --directory backend run ruff format --check .`, frontend lint, typecheck, build, e2e.
- [ ] **Step 3: Commit, push, PRs** — push `feat/welcome-onboarding`; PR into `dev` (template filled), and a PR into `main` for the VM; merging is the team's.
