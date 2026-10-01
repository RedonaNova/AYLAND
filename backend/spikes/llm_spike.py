"""M0-5 LLM spike: Mongolian quality, latency and tool calling for OyuLLM and Claude (decision D1).

    uv run python -m spikes.llm_spike            # writes docs/spikes/m0-5-llm.md
    uv run python -m spikes.llm_spike --skip-claude

Claude runs through the Claude Code CLI (one process per call here), so its numbers include
CLI start-up; the orchestrator will keep one session open instead.
"""

import argparse
import asyncio
import json
import math
from collections.abc import Awaitable, Callable
from statistics import median

from ayland.llm import claude, oyu

from .common import short, write_report

SYSTEM = (
    "Чи бол AYLAND — бие даан аялагч монголчуудад туслах аяллын анд. Монголоор, богино, ярихад хялбар "
    "өгүүлбэрээр хариул. Үнийг нийт болон нэг хүнд ногдохоор USD-ээр хэл. Хариултаа дараагийн алхмын саналаар төгсгө."
)

PROMPTS = [
    ("rain", "Бид 4-үүлээ Ханойд байна, бороо орчихлоо, өнөөдөр 100$ дотор юу хийж болох вэ?"),
    ("plan", "Ханойд 3 хоног байна. Хоолонд дуртай 4 найздаа маргаашийн хөтөлбөр гаргаад өгөөч, нэг хүнд өдөрт 50$."),
    ("route", "Ной Бай нисэх онгоцны буудлаас Хуучин хороолол руу хамгийн хямд, аюулгүй яаж очих вэ?"),
    (
        "nudge",
        "Бороо орж байна. Өнөөдөр 14:00-д цикло аялал, 16:30-д Лонг Биен гүүрээр алхах төлөвлөгөөтэй. Аялагчдад богинохон анхааруулга бич.",
    ),
    (
        "translate",
        "Энэ өгүүлбэрийг вьетнам хэл рүү орчуулаад, дуудлагыг нь кирилээр бич: «Бидний нэг нь газрын самрын харшилтай.»",
    ),
]

# OpenAI-format tools for the OyuLLM tool-calling check (same shapes as HANDBOOK §8.2).
TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "Тухайн хотын одоогийн болон ойрын цагуудын цаг агаар.",
            "parameters": {
                "type": "object",
                "properties": {"city": {"type": "string"}, "hours_ahead": {"type": "integer"}},
                "required": ["city"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_offers",
            "description": "Мерчантуудын санал (үйл ажиллагаа, хоол, соёл) хайх. Үнэ USD.",
            "parameters": {
                "type": "object",
                "properties": {
                    "city": {"type": "string"},
                    "query": {"type": "string"},
                    "tags": {"type": "array", "items": {"type": "string"}},
                    "max_price_per_person": {"type": "number"},
                    "party_size": {"type": "integer"},
                },
                "required": ["city", "query"],
            },
        },
    },
]


async def run_oyu(prompt: str) -> tuple[float, str]:
    reply = await oyu.chat([{"role": "system", "content": SYSTEM}, {"role": "user", "content": prompt}])
    return reply.ms, reply.text


async def run_claude(prompt: str, effort: str) -> tuple[float, str]:
    reply = await claude.ask(prompt, system=SYSTEM, effort=effort)
    return reply.ms, reply.text


async def oyu_tool_check() -> list[str]:
    """Does OyuLLM pick the right tools with sensible arguments from a Mongolian request?"""
    reply = await oyu.chat(
        [
            {"role": "system", "content": SYSTEM + " Цаг агаар, саналыг ЗААВАЛ хэрэгслээр шалга; өөрөө бүү зохио."},
            {"role": "user", "content": PROMPTS[0][1]},
        ],
        tools=TOOLS,
    )
    lines = [
        f"Latency {reply.ms:.0f} ms. Expected: `get_weather(city≈Hanoi)` and `search_offers(..., max_price_per_person≈25, party_size=4)`.",
        "",
    ]
    if not reply.tool_calls:
        lines.append(f"**No tool call.** Text instead: {short(reply.text, 300)}")
    for call in reply.tool_calls:
        try:
            args = json.dumps(json.loads(call["arguments"]), ensure_ascii=False)
        except json.JSONDecodeError:
            args = f"(invalid JSON) {call['arguments']}"
        lines.append(f"- `{call['name']}` {args}")
    return lines


async def main(skip_claude: bool) -> None:
    engines: list[tuple[str, Callable[[str], Awaitable[tuple[float, str]]]]] = [("OyuLLM", run_oyu)]
    if not skip_claude:
        engines += [
            ("Claude effort=low", lambda p: run_claude(p, "low")),
            ("Claude effort=medium", lambda p: run_claude(p, "medium")),
        ]

    rows: list[tuple[str, str, float, str]] = []
    for key, prompt in PROMPTS:
        for name, run in engines:
            try:
                ms, text = await run(prompt)
            except Exception as err:  # noqa: BLE001 - record the failure in the report and keep measuring
                ms, text = float("nan"), f"ERROR {type(err).__name__}: {err}"
            rows.append((key, name, ms, text))
            print(f"{key:<10} {name:<22} {ms:>8.0f} ms  {short(text, 80)}", flush=True)

    lines = ["## Latency (ms)", "", "| Engine | median | per prompt |", "|---|---|---|"]
    for name, _ in engines:
        times = [ms for _, engine, ms, _ in rows if engine == name and not math.isnan(ms)]
        if times:
            lines.append(f"| {name} | {median(times):.0f} | {' · '.join(f'{t:.0f}' for t in times)} |")
        else:
            lines.append(f"| {name} | – | all failed |")
    try:
        tool_lines = await oyu_tool_check()
    except Exception as err:  # noqa: BLE001 - keep the measurements already taken
        tool_lines = [f"ERROR {type(err).__name__}: {short(str(err), 300)}"]
    lines += ["", "## OyuLLM tool calling", "", *tool_lines]
    lines += ["", "## Answers (rate Mongolian quality 1–5 in the last column)", ""]
    for key, prompt in PROMPTS:
        lines += [f"### `{key}` — {prompt}", "", "| Engine | ms | Answer | Quality |", "|---|---|---|---|"]
        for row_key, name, ms, text in rows:
            if row_key == key:
                lines.append(f"| {name} | {ms:.0f} | {' '.join(text.split()).replace('|', '/')} | |")
        lines.append("")
    print("report:", write_report("m0-5-llm", "M0-5 LLM spike: OyuLLM vs Claude (Mongolian)", "llm_spike.py", lines))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--skip-claude", action="store_true")
    asyncio.run(main(parser.parse_args().skip_claude))
