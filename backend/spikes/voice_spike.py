"""M0-4 voice spike: tsuurAI TTS and Anir STT on the demo lines (decision D4).

    uv run python -m spikes.voice_spike          # writes docs/spikes/m0-4-voice.md, audio in docs/spikes/audio/

1. tsuurAI speaks every demo line in each voice; we time it and keep the WAVs to listen to.
2. Anir transcribes the tsuurAI audio (round trip) and is scored by character error rate (CER).
3. Real speech: record the lines yourself as backend/spikes/recordings/1.wav … 3.wav (WAV/MP3/OGG,
   same order as DEMO_LINES, ideally in a noisy room). Anir transcribes them too.
"""

import asyncio

from ayland.voice import oyu as voice

from .common import (
    AUDIO_DIR,
    DEMO_LINES,
    RECORDINGS_DIR,
    SPOKEN_LINES,
    cer,
    seconds,
    short,
    wav_seconds,
    write_report,
)

VOICES = ["mbspeech", "baseline", "mn1h"]
AUDIO_TYPES = {".wav", ".mp3", ".ogg"}


async def main() -> None:
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    lines = ["## tsuurAI TTS", "", "| Voice | Line | Synthesis ms | Audio s | File |", "|---|---|---|---|---|"]
    round_trip_rows: list[str] = []

    for name in VOICES:
        for i, text in enumerate(DEMO_LINES, 1):
            try:
                speech = await voice.speak(text, voice=name)
            except Exception as err:  # noqa: BLE001 - one bad voice must not stop the comparison
                lines.append(f"| {name} | {i} | ERROR {type(err).__name__}: {short(str(err), 80)} | | |")
                continue
            path = AUDIO_DIR / f"tts-{name}-{i}.wav"
            path.write_bytes(speech.wav)
            lines.append(f"| {name} | {i} | {speech.ms:.0f} | {seconds(wav_seconds(speech.wav))} | `{path.name}` |")
            print(f"tts {name:<9} line {i}: {speech.ms:.0f} ms", flush=True)
            try:
                heard = await voice.transcribe(speech.wav, filename=path.name)
            except Exception as err:  # noqa: BLE001 - keep measuring the other lines
                round_trip_rows.append(f"| {name} | {i} | ERROR {type(err).__name__}: {short(str(err), 80)} | | |")
                continue
            round_trip_rows.append(
                f"| {name} | {i} | {heard.ms:.0f} | {cer(SPOKEN_LINES[i - 1], heard.text):.0%} | {short(heard.text, 90)} |"
            )

    lines += [
        "",
        "## Anir STT on tsuurAI audio (round trip)",
        "",
        "| Voice | Line | STT ms | CER | Heard |",
        "|---|---|---|---|---|",
        *round_trip_rows,
    ]

    # A missing recordings folder globs to nothing.
    recordings = sorted(p for p in RECORDINGS_DIR.glob("*") if p.suffix.lower() in AUDIO_TYPES)
    lines += ["", "## Anir STT on real recordings", ""]
    if not recordings:
        # The last demo line is AYLAND's own nudge, so travelers record only the ones before it.
        lines.append(
            f"_None yet. Record the lines as `backend/spikes/recordings/1.wav` … `{len(DEMO_LINES) - 1}.wav` and re-run._"
        )
    else:
        lines += ["| File | Expected | STT ms | CER | Heard |", "|---|---|---|---|---|"]
        for path in recordings:
            line_number = int(path.stem) if path.stem.isdigit() else 0
            expected = SPOKEN_LINES[line_number - 1] if 0 < line_number <= len(SPOKEN_LINES) else ""
            try:
                heard = await voice.transcribe(path.read_bytes(), filename=path.name)
            except Exception as err:  # noqa: BLE001 - keep measuring the other recordings
                lines.append(f"| `{path.name}` | {short(expected, 50)} | ERROR {type(err).__name__} | | |")
                continue
            score = f"{cer(expected, heard.text):.0%}" if expected else "–"
            lines.append(
                f"| `{path.name}` | {short(expected, 50)} | {heard.ms:.0f} | {score} | {short(heard.text, 90)} |"
            )
            print(f"stt {path.name}: {heard.ms:.0f} ms {score}", flush=True)

    lines += [
        "",
        "## Not covered by Novelsoft",
        "",
        "Anir and tsuurAI are Mongolian only. The interpreter's Vietnamese side (Act 4) needs another engine: "
        "the browser Web Speech API (vi-VN) is the quickest candidate to try next.",
    ]
    print("report:", write_report("m0-4-voice", "M0-4 voice spike: tsuurAI TTS + Anir STT", "voice_spike.py", lines))


if __name__ == "__main__":
    asyncio.run(main())
