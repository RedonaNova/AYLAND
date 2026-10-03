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
