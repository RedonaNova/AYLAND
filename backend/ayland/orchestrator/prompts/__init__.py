"""Prompts and Mongolian user-facing text for the orchestrator (HANDBOOK §11: one place per app)."""

from pathlib import Path

_HERE = Path(__file__).parent

NUMBERS_MN = ["тэг", "нэг", "хоёр", "гурван", "дөрвөн", "таван"]
TOOL_FAILED = "Хэрэгсэл хариулсангүй"  # "the tool didn't answer": the trace line for a tool error


def system_prompt(trip_id: str, today: str, now: str) -> str:
    """Static for the life of a session: live state comes from tools, so the prompt never changes mid-chat."""
    template = (_HERE / "system.md").read_text(encoding="utf-8")
    return template.format(trip_id=trip_id, today=today, now=now)


def rain_nudge(affected: list[tuple[str, str]]) -> dict[str, object]:
    """The Act 1 nudge (HANDBOOK §3) for (HH:MM, title) items that rain puts at risk."""
    count = NUMBERS_MN[len(affected)] if len(affected) < len(NUMBERS_MN) else str(len(affected))
    return {
        "text": f"Бороо орж эхэллээ. Өнөөдрийн {count} гадаа хөтөлбөрт нөлөөлөх тул өөрчлөх үү?",
        "detail": " · ".join(f"{time} {title}" for time, title in affected),
        "actions": [
            {
                "label": "Тийм, хувилбар санал болго",
                "kind": "send",
                "message": "Бороо орчихлоо, өнөөдөр 100$ дотор юу хийж болох вэ?",
            },
            {"label": "Одоохондоо хэвээр", "kind": "dismiss"},
        ],
    }
