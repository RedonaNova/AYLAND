"""Helpers shared by the spikes: scoring, WAV length and report output."""

import io
import re
import wave
from datetime import datetime
from pathlib import Path

from ayland.config import REPO_ROOT

REPORT_DIR = REPO_ROOT / "docs" / "spikes"
AUDIO_DIR = REPORT_DIR / "audio"  # gitignored: generated and recorded audio stays local
RECORDINGS_DIR = Path(__file__).parent / "recordings"  # gitignored: your own voice

# The Mongolian lines a traveler says in the demo (HANDBOOK §3), plus the rain nudge AYLAND speaks.
DEMO_LINES = [
    "Бид 4-үүлээ Ханойд байна, бороо орчихлоо, өнөөдөр 100$ дотор юу хийж болох вэ?",
    "Хоёр дахь хувилбарыг захиалаад өгөөч.",
    "Тийм, захиал.",
    "Бороо орж эхэллээ. Өнөөдрийн хоёр гадаа хөтөлбөрт нөлөөлөх тул өөрчлөх үү?",
]


def normalize(text: str) -> str:
    without_punctuation = re.sub(r"[^\w\s]", " ", text.lower())
    return " ".join(without_punctuation.split())


def cer(reference: str, hypothesis: str) -> float:
    """Character error rate after normalizing case, punctuation and spacing (0 = perfect)."""
    ref, hyp = normalize(reference), normalize(hypothesis)
    if not ref:
        return 1.0 if hyp else 0.0
    previous = list(range(len(hyp) + 1))
    for i, r in enumerate(ref, 1):
        current = [i]
        for j, h in enumerate(hyp, 1):
            current.append(min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (r != h)))
        previous = current
    return previous[-1] / len(ref)


def wav_seconds(data: bytes) -> float | None:
    """Length of a WAV clip, or None when the bytes are not a WAV we can read."""
    try:
        with wave.open(io.BytesIO(data)) as wav:
            return wav.getnframes() / wav.getframerate()
    except (wave.Error, EOFError):
        return None


def seconds(value: float | None) -> str:
    return "?" if value is None else f"{value:.1f}"


def write_report(name: str, title: str, script: str, lines: list[str]) -> Path:
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    path = REPORT_DIR / f"{name}.md"
    stamp = datetime.now().strftime("%Y-%m-%d %H:%M")
    header = f"# {title}\n\n_Generated {stamp} by `backend/spikes/{script}`._\n\n"
    path.write_text(header + "\n".join(lines) + "\n", encoding="utf-8")
    return path


def short(text: str, limit: int = 140) -> str:
    flat = " ".join(text.split())
    return flat if len(flat) <= limit else flat[: limit - 1] + "…"
