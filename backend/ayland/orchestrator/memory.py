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
    docs = [
        Memory(user_id=visitor_id, kind="preference", source="onboarding", text=line, created_at=now).to_mongo()
        for line in text.sentences(profile)
    ]
    if docs:
        await db.memories.insert_many(docs)


async def remember(
    db: Any, user_id: str, sentence: str, kind: Literal["preference", "fact"], trip_id: str | None
) -> None:
    doc = Memory(
        user_id=user_id, trip_id=trip_id, kind=kind, source="chat", text=sentence, created_at=datetime.now(UTC)
    )
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
    cursor = (
        db.memories.find({"user_id": user_id, "source": {"$ne": "onboarding"}}).sort("created_at", -1).limit(RECENT)
    )
    recent = [m["text"] for m in await cursor.to_list()]
    return text.block(name, lines, recent[::-1])
