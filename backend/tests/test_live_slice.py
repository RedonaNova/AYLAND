import io
import json
import wave

from ayland import budget
from ayland.db import repo
from ayland.demo.seed import load_seed, materialize
from ayland.orchestrator import prompts
from ayland.orchestrator.agent import _summary
from ayland.orchestrator.app import sse
from ayland.voice.oyu import join_wavs, split_for_tts

TODAY = "2026-10-05"


def _trip() -> dict:
    return materialize(load_seed(), TODAY).trip


def test_seed_puts_day_three_on_today_with_offset_times() -> None:
    data = materialize(load_seed(), TODAY)
    assert [day["date"] for day in data.trip["days"]][2] == TODAY
    lunch = next(i for i in budget.day_items(data.trip, TODAY) if i["item_id"] == "d3-3")
    assert lunch["start"] == "2026-10-05T12:00:00+07:00"
    assert data.offers[0]["slots"][0]["start"].startswith(TODAY)
    assert all(b["trip_id"] == data.trip["_id"] for b in data.bookings)


def test_day_budget_matches_the_demo_story() -> None:
    assert budget.day(_trip(), TODAY) == {"limit": 200, "spent": 20, "booked": 0, "planned": 80, "remaining": 100}


def test_rain_puts_the_two_afternoon_outdoor_items_at_risk() -> None:
    at_risk = repo.upcoming_outdoor(_trip(), f"{TODAY}T10:30:00+07:00")
    assert [i["item_id"] for i in at_risk] == ["d3-4", "d3-5"]


def test_rain_nudge_counts_in_mongolian() -> None:
    nudge = prompts.rain_nudge([("14:00", "Цикло аялал"), ("16:30", "Нар жаргах алхалт")])
    assert "хоёр гадаа хөтөлбөрт" in nudge["text"]
    assert nudge["detail"] == "14:00 Цикло аялал · 16:30 Нар жаргах алхалт"


def test_split_for_tts_respects_the_limit_and_keeps_sentences() -> None:
    text = "Нэг. " * 300
    chunks = split_for_tts(text, limit=100)
    assert all(len(c) <= 100 for c in chunks)
    assert " ".join(chunks).split() == text.split()


def _wav(frames: bytes) -> bytes:
    out = io.BytesIO()
    with wave.open(out, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes(frames)
    return out.getvalue()


def test_join_wavs_concatenates_audio() -> None:
    joined = join_wavs([_wav(b"\x01\x00" * 10), _wav(b"\x02\x00" * 5)])
    with wave.open(io.BytesIO(joined)) as w:
        assert w.getnframes() == 15


def test_sse_frames_an_event() -> None:
    frame = sse({"type": "message.delta", "data": {"text": "Сайн"}})
    assert frame == 'event: message.delta\ndata: {"text": "Сайн"}\n\n'


def test_tool_summary_comes_from_the_json_payload() -> None:
    content = [{"type": "text", "text": json.dumps({"summary": "Үлдэгдэл $100", "remaining": 100})}]
    assert _summary(content)[0] == "Үлдэгдэл $100"
    assert _summary("plain text result") == ("plain text result", "plain text result")
    # A tool error shows a Mongolian line in the trace; the English reason stays for agent_events.
    summary, detail = _summary("Error executing tool search_places: OpenStreetMap is down", is_error=True)
    assert summary == "Хэрэгсэл хариулсангүй" and detail.startswith("Error executing tool")


def test_split_for_tts_keeps_order_around_an_overlong_sentence() -> None:
    chunks = split_for_tts("Short one. " + "x" * 250, limit=100)
    assert chunks[0] == "Short one."
    assert "".join(chunks[1:]) == "x" * 250
