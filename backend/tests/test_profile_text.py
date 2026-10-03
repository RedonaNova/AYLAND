import pytest
from pydantic import ValidationError

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
    prefs = Preferences(
        interests=["түүх", "хоол"], food=["далайн хоол идэхгүй (Номин)"], pace="relaxed", notes="4 найз"
    )
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
    with pytest.raises(ValidationError):
        Profile.model_validate({"diet": ["gluten_free"]})
    with pytest.raises(ValidationError):
        Profile.model_validate({"name": "x" * 41})
