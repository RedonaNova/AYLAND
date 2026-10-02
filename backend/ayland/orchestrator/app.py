"""Orchestrator HTTP API (HANDBOOK §8.4)."""

import asyncio
import json
import logging
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from typing import Annotated, Any, Literal

import httpx
from claude_agent_sdk import ClaudeSDKError
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.encoders import jsonable_encoder
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response, StreamingResponse
from pydantic import BaseModel, Field
from pymongo.errors import PyMongoError

from ayland import clock
from ayland.config import get_settings
from ayland.db import repo
from ayland.db.client import MongoNotConfigured, explain, get_db, ping
from ayland.demo import seed
from ayland.llm import orchu
from ayland.llm.claude import ClaudeCliNotFound, find_cli
from ayland.novelsoft import OyuNotConfigured
from ayland.voice import oyu as voice

from . import prompts
from .agent import Event, agent
from .events import trip_events

logger = logging.getLogger("ayland.orchestrator")
SSE_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
NUDGE_DELAY_S = 1.4
HEARTBEAT_S = 15


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    yield
    await agent.close()


app = FastAPI(title="AYLAND Orchestrator", version="0.2.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[get_settings().web_origin],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(httpx.HTTPStatusError)
async def upstream_error(_: Request, err: httpx.HTTPStatusError) -> JSONResponse:
    """A Novelsoft call failed: say which service and why, instead of a bare 500."""
    return JSONResponse(
        {"detail": f"{err.request.url.path} returned {err.response.status_code}: {err.response.text[:200]}"}, 502
    )


@app.exception_handler(PyMongoError)
async def mongo_error(_: Request, err: PyMongoError) -> JSONResponse:
    return JSONResponse({"detail": explain(err)}, 503)


@app.exception_handler(MongoNotConfigured)
@app.exception_handler(OyuNotConfigured)
async def not_configured(_: Request, err: RuntimeError) -> JSONResponse:
    return JSONResponse({"detail": str(err)}, 503)


def sse(item: Event) -> str:
    return f"event: {item['type']}\ndata: {json.dumps(jsonable_encoder(item['data']), ensure_ascii=False)}\n\n"


def stream(events: AsyncIterator[str]) -> StreamingResponse:
    return StreamingResponse(events, media_type="text/event-stream", headers=SSE_HEADERS)


_background: set[asyncio.Task[None]] = set()  # strong references, so pending tasks aren't garbage-collected


def _later(delay: float, job: Callable[[], Awaitable[None]]) -> None:
    async def run() -> None:
        await asyncio.sleep(delay)
        await job()

    task = asyncio.create_task(run())
    _background.add(task)
    task.add_done_callback(_background.discard)


@app.get("/api/health")
async def health() -> dict[str, object]:
    """What is wired up. Cheap: no LLM or voice calls (those live in `spikes/check_services.py`)."""
    settings = get_settings()
    checks: dict[str, object] = {}
    try:
        checks["mongodb"] = {"ok": True, "ping_ms": round(await ping(), 1), "db": settings.mongodb_db}
    except MongoNotConfigured as err:
        checks["mongodb"] = {"ok": False, "error": str(err)}
    except PyMongoError as err:
        checks["mongodb"] = {"ok": False, "error": explain(err)}
    try:
        checks["claude_cli"] = {"ok": True, "path": find_cli(), "model": settings.claude_model}
    except ClaudeCliNotFound as err:
        checks["claude_cli"] = {"ok": False, "error": str(err)}
    checks["oyu"] = {"ok": settings.oyu_api_key is not None, "base_url": settings.oyu_base_url}
    checks["demo_mode"] = settings.demo_mode
    return checks


@app.get("/api/trips/{trip_id}")
async def get_trip(trip_id: str) -> dict[str, Any]:
    """The UI loads this first, so it is also the moment to start Claude's session in the background."""
    try:
        view = jsonable_encoder(await repo.trip_view(get_db(), trip_id))
    except repo.TripNotFound as err:
        raise HTTPException(404, str(err)) from err

    async def warm() -> None:
        try:
            await agent.warm(trip_id)
        except (ClaudeCliNotFound, ClaudeSDKError) as err:
            logger.warning("Claude session warm-up failed: %s", err)

    _later(0, warm)
    return view


@app.get("/api/trips/{trip_id}/events")
async def trip_event_stream(trip_id: str) -> StreamingResponse:
    """Nudges and plan changes pushed to the UI. Comments keep tunnels and proxies from idling out."""
    queue = trip_events.subscribe(trip_id)

    async def events() -> AsyncIterator[str]:
        try:
            yield ": connected\n\n"
            while True:
                try:
                    item = await asyncio.wait_for(queue.get(), timeout=HEARTBEAT_S)
                except TimeoutError:
                    yield ": ping\n\n"
                    continue
                yield sse(item)
        finally:
            trip_events.unsubscribe(trip_id, queue)

    return stream(events())


class ChatRequest(BaseModel):
    trip_id: str
    message: str = Field(min_length=1, max_length=2000)


@app.post("/api/chat")
async def chat(body: ChatRequest) -> StreamingResponse:
    """One agent turn as SSE. Turns are stored in `messages`, tool calls in `agent_events`."""
    db = get_db()
    try:
        await repo.get_trip(db, body.trip_id)  # only real trips get a Claude session
    except repo.TripNotFound as err:
        raise HTTPException(404, str(err)) from err
    run_id = f"run_{uuid.uuid4().hex[:10]}"
    await repo.save_message(db, body.trip_id, "user", body.message, run_id)

    async def events() -> AsyncIterator[str]:
        reply = ""
        try:
            async for item in agent.run(body.trip_id, body.message, run_id):
                data = item["data"]
                if item["type"] == "message.delta":
                    reply += data["text"]
                elif item["type"] == "tool.end":
                    await repo.log_event(
                        db,
                        body.trip_id,
                        run_id,
                        type="tool",
                        name=data["name"],
                        output_summary=data["summary"],
                        ok=data["ok"],
                        ms=data["ms"],
                    )
                yield sse(item)
        except Exception as err:  # noqa: BLE001 - the stream must end with a readable error, not a cut connection
            yield sse({"type": "error", "data": {"message": f"{type(err).__name__}: {err}"}})
        if reply:
            await repo.save_message(db, body.trip_id, "assistant", reply, run_id)

    return stream(events())


Lang = Literal["mn", "en"]


class InterpretRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    source_lang: Lang
    target_lang: Lang


@app.post("/api/interpret")
async def interpret(body: InterpretRequest) -> dict[str, Any]:
    """Orchu (Novelsoft) mn ⇄ en. Becomes the A2A Interpreter Agent's skill in M2-D1."""
    if body.source_lang == body.target_lang:
        return {"text": body.text}
    result = await orchu.translate(body.text, body.source_lang, body.target_lang)
    try:
        await repo.log_event(
            get_db(),
            repo.TRIP_ID,
            "interpreter",
            type="tool",
            name="orchu.translate",
            output_summary=f"{body.source_lang} → {body.target_lang}",
            ok=True,
            ms=round(result.ms),
        )
    except PyMongoError as err:  # the audit log must not block a translation
        logger.warning("agent_events write failed: %s", explain(err))
    return {"text": result.text}


@app.post("/api/voice/transcribe")
async def transcribe(file: Annotated[UploadFile, File()], lang: Annotated[Lang, Form()] = "mn") -> dict[str, str]:
    """Anir speech-to-text (Mongolian). English speech is recognized in the browser."""
    if lang != "mn":
        raise HTTPException(400, "Only Mongolian is transcribed here; English uses the browser's speech recognition.")
    heard = await voice.transcribe(await file.read(), filename=file.filename or "speech.wav")
    return {"text": heard.text}


class SpeakRequest(BaseModel):
    text: str = Field(min_length=1, max_length=4000)
    lang: Lang = "mn"


@app.post("/api/voice/speak")
async def speak(body: SpeakRequest) -> Response:
    """tsuurAI text-to-speech (Mongolian) as WAV. English speech is synthesized in the browser."""
    if body.lang != "mn":
        raise HTTPException(400, "Only Mongolian is synthesized here; English uses the browser's speech synthesis.")
    if not body.text.strip():
        raise HTTPException(400, "Nothing to say: the text is empty.")
    speech = await voice.speak_long(body.text)
    return Response(content=speech.wav, media_type="audio/wav")


@app.post("/api/demo/reset")
async def demo_reset() -> dict[str, str]:
    db = get_db()
    trip_id = await seed.reset(db)
    await agent.close(trip_id)
    trip = await repo.get_trip(db, trip_id)
    trip_events.publish(
        trip_id,
        {"type": "plan.updated", "data": {"trip_id": trip_id, "version": trip["version"], "changed_item_ids": []}},
    )
    return {"trip_id": trip_id}


class ScenarioRequest(BaseModel):
    weather: repo.Weather


@app.post("/api/demo/scenario")
async def demo_scenario(body: ScenarioRequest) -> dict[str, str]:
    """Switch the DEMO_MODE weather. Rain triggers the Act 1 nudge on the trip event stream."""
    db = get_db()
    await repo.set_weather(db, body.weather)
    if body.weather == "rain":

        async def nudge() -> None:
            trip = await repo.get_trip(db, repo.TRIP_ID)
            affected = repo.upcoming_outdoor(trip, clock.now_iso())
            if affected:
                pairs = [(clock.hhmm(i["start"]), i["title"]) for i in affected]
                trip_events.publish(repo.TRIP_ID, {"type": "nudge", "data": prompts.rain_nudge(pairs)})

        _later(NUDGE_DELAY_S, nudge)
    return {"weather": body.weather}
