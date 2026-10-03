from datetime import UTC, datetime, timedelta
from typing import Any

from fake_db import FakeDb

from ayland.db.models import Profile
from ayland.orchestrator import memory

VISITOR = "v_0f8fad5b-d9cb-469f-a165-70867728950e"


def db() -> Any:
    return FakeDb()


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
    assert {m["text"] for m in fake.memories.docs} == {"Ээж нь хол алхаж чаддаггүй.", "Хосоороо аялдаг."}
    assert len(fake.memories.docs) == 2


async def test_context_has_the_profile_then_the_latest_chat_memories_in_order() -> None:
    fake = db()
    await memory.save_profile(fake, VISITOR, Profile(name="Сарнай", diet=["no_seafood"]))
    start = datetime(2026, 10, 3, tzinfo=UTC)
    for n in range(13):
        fake.memories.docs.append(
            {
                "user_id": VISITOR,
                "kind": "fact",
                "source": "chat",
                "text": f"#{n}",
                "created_at": start + timedelta(minutes=n),
            }
        )
    lines = (await memory.context(fake, VISITOR)).splitlines()
    assert lines[:3] == ["[Аялагчийн хөрөг: Сарнай]", "- Хоолны хязгаарлалт: далайн хоол идэхгүй.", "[Санах ой]"]
    assert lines[3:] == [f"- #{n}" for n in range(1, 13)]  # the latest 12, oldest first


async def test_the_seed_user_is_read_from_preferences() -> None:
    fake = db()
    fake.users.docs.append(
        {
            "_id": "user_bat",
            "name": "Бат",
            "language": "mn",
            "preferences": {
                "interests": ["түүх"],
                "food": ["далайн хоол идэхгүй (Номин)"],
                "pace": "relaxed",
                "notes": "",
            },
        }
    )
    block = await memory.context(fake, "user_bat")
    assert block.splitlines()[0] == "[Аялагчийн хөрөг: Бат]"
    assert "- Хоол: далайн хоол идэхгүй (Номин)." in block


async def test_no_block_without_anything_to_say() -> None:
    fake = db()
    assert await memory.context(fake, VISITOR) == ""
    await memory.save_profile(fake, VISITOR, Profile())
    assert await memory.context(fake, VISITOR) == ""
