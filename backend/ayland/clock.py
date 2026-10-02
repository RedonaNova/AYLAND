"""Trip-local dates and times. Hanoi is UTC+7 all year, so a fixed offset is exact (and needs no tz database)."""

import re
from datetime import date, datetime, timedelta, timezone

from ayland.config import get_settings

HANOI = timezone(timedelta(hours=7))


def today() -> str:
    return datetime.now(HANOI).date().isoformat()


def add_days(day: str, days: int) -> str:
    return (date.fromisoformat(day) + timedelta(days=days)).isoformat()


def at(day: str, hhmm: str) -> str:
    """ISO 8601 with offset, the §8 time format."""
    return f"{day}T{hhmm}:00+07:00"


def now_iso() -> str:
    """DEMO_NOW in demo mode so the story always happens mid-morning; real Hanoi time otherwise."""
    settings = get_settings()
    hhmm = settings.demo_now if settings.demo_mode else datetime.now(HANOI).strftime("%H:%M")
    return at(today(), hhmm)


def hhmm(iso: str) -> str:
    return iso[11:16]


def parse_local(text: str) -> datetime | None:
    """A moment as Hanoi time: ISO 8601 in any offset (or Z), or a bare "HH:MM" meaning today. None if it isn't
    a time at all. For times the model hands back (a slot it picked), which can come in any of these forms."""
    text = text.strip()
    if re.fullmatch(r"\d{1,2}:\d{2}", text):
        text = at(today(), text.zfill(5))
    try:
        moment = datetime.fromisoformat(text)
    except ValueError:
        return None
    return moment.astimezone(HANOI) if moment.tzinfo else moment.replace(tzinfo=HANOI)


def minutes(iso: str) -> int:
    return int(iso[11:13]) * 60 + int(iso[14:16])
