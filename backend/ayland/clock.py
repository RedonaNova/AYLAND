"""Trip-local dates and times. Hanoi is UTC+7 all year, so a fixed offset is exact (and needs no tz database)."""

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


def minutes(iso: str) -> int:
    return int(iso[11:13]) * 60 + int(iso[14:16])
