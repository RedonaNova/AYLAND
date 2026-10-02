"""Orchestrator HTTP API (HANDBOOK §8.4)."""

import asyncio
import json
import logging
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from typing import Annotated, Any, Literal

import httpx
from a2a.client.errors import A2AClientError, A2AClientTimeoutError, AgentCardResolutionError
from claude_agent_sdk import ClaudeSDKError
from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.encoders import jsonable_encoder
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response, StreamingResponse
from mcp import Client as McpClient
from pydantic import BaseModel, Field
from pymongo.errors import PyMongoError

from ayland import clock, voice
from ayland.config import get_settings
from ayland.db import repo
from ayland.db.client import MongoNotConfigured, explain, get_db, ping
from ayland.demo import seed
from ayland.llm import orchu
from ayland.llm.claude import ClaudeCliNotFound, find_cli
from ayland.mcp_servers.common import ToolError
from ayland.mcp_servers.travel_data import weather
from ayland.novelsoft import OyuNotConfigured

from . import a2a, prompts, proposals
from .agent import Event, agent
from .audit import audit
from .events import trip_events
from .runs import Run, runs

logger = logging.getLogger("ayland.orchestrator")
# no-transform: a compressing proxy (Next's /api rewrite, a tunnel) would otherwise hold events back.
SSE_HEADERS = {"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"}
NUDGE_DELAY_S = 1.4
HEARTBEAT_S = 15
POLL_WAIT_S = 20  # under the proxy and tunnel idle limits
HEALTH_TIMEOUT_S = 2.0


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


@app.exception_handler(voice.VoiceRequestError)
async def voice_request_error(_: Request, err: voice.VoiceRequestError) -> JSONResponse:
    return JSONResponse({"detail": str(err)}, 400)


@app.exception_handler(MongoNotConfigured)
@app.exception_handler(OyuNotConfigured)
async def not_configured(_: Request, err: RuntimeError) -> JSONResponse:
    return JSONResponse({"detail": str(err)}, 503)


def require_demo_mode() -> None:
    """§8.4: the demo controls only exist in DEMO_MODE, so a real deployment can't be reset by a visitor."""
    if not get_settings().demo_mode:
        raise HTTPException(403, "DEMO_MODE is off.")


def sse(item: Event) -> str:
    return f"event: {item['type']}\ndata: {json.dumps(jsonable_encoder(item['data']), ensure_ascii=False)}\n\n"


def stream(events: AsyncIterator[str]) -> StreamingResponse:
    return StreamingResponse(events, media_type="text/event-stream", headers=SSE_HEADERS)


async def with_heartbeat(frames: AsyncIterator[str], every: float = HEARTBEAT_S) -> AsyncIterator[str]:
    """The frames, plus an SSE comment whenever they pause for `every` seconds (Claude thinking), so proxies and
    tunnels don't cut the stream as idle. The pending read is never cancelled by the timeout, only waited on."""
    pending = asyncio.ensure_future(anext(frames))
    try:
        while True:
            done, _ = await asyncio.wait({pending}, timeout=every)
            if not done:
                yield ": ping\n\n"
                continue
            try:
                frame = pending.result()
            except StopAsyncIteration:
                return
            yield frame
            pending = asyncio.ensure_future(anext(frames))
    finally:
        pending.cancel()  # the client left: stop reading (the caller decides what happens to the turn)


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
    agents = {"a2a_booking": settings.a2a_booking_url, "a2a_interpreter": settings.a2a_interpreter_url}
    servers = {"mcp_travel_data": settings.mcp_travel_data_url, "mcp_merchant": settings.mcp_merchant_url}
    probes = [_a2a_check(url) for url in agents.values()] + [_mcp_check(url) for url in servers.values()]
    checks |= dict(zip([*agents, *servers], await asyncio.gather(*probes), strict=True))
    checks["demo_mode"] = settings.demo_mode
    return checks


async def _a2a_check(url: str) -> dict[str, object]:
    try:
        async with httpx.AsyncClient(timeout=HEALTH_TIMEOUT_S) as http:
            reply = await a2a.ping(url, http=http)
        return {"ok": bool(reply.data.get("pong")), "ping_ms": round(reply.ms)}
    except (httpx.HTTPError, A2AClientError, a2a.A2AReplyMissing) as err:
        return {"ok": False, "error": f"{type(err).__name__} at {url}"}


async def _mcp_check(url: str) -> dict[str, object]:
    """An MCP handshake and tools/list: the same path the Claude CLI takes. A server that is down shows up as
    a timeout (the MCP client doesn't fail fast on a closed port), so this costs at most HEALTH_TIMEOUT_S."""
    try:
        async with asyncio.timeout(HEALTH_TIMEOUT_S), McpClient(url) as client:
            tools = (await client.list_tools()).tools
        return {"ok": True, "tools": [tool.name for tool in tools]}
    except Exception as err:  # noqa: BLE001 - any failure means "not usable"; the name says why
        return {"ok": False, "error": f"{type(err).__name__} at {url}"}


@app.get("/api/trips/{trip_id}")
async def get_trip(trip_id: str) -> dict[str, Any]:
    """The UI loads this first, so it is also the moment to start Claude's session in the background."""
    db = get_db()
    if get_settings().demo_mode and await seed.ensure_current(db, trip_id):
        await agent.close(trip_id)  # its system prompt carries the old date
    try:
        view = await repo.trip_view(db, trip_id)
    except repo.TripNotFound as err:
        raise HTTPException(404, str(err)) from err
    # The same source as the agent's get_weather, so the card and the answer never disagree. The trip's own
    # coordinates skip geocoding; if the weather service is down the trip still loads, without a weather card.
    lon, lat = view["trip"]["destination"]["location"]["coordinates"]
    try:
        report = await weather.report(view["trip"]["destination"]["city"], lat, lon, hours_ahead=0)
        view["weather"] = report.view()
    except ToolError as err:
        logger.warning("Trip view without weather: %s", err)
        view["weather"] = None

    async def warm() -> None:
        try:
            await agent.warm(trip_id)
        except (ClaudeCliNotFound, ClaudeSDKError) as err:
            logger.warning("Claude session warm-up failed: %s", err)

    _later(0, warm)
    return jsonable_encoder(view)


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


@app.get("/api/trips/{trip_id}/events/poll")
async def trip_event_poll(trip_id: str, cursor: str = "") -> dict[str, Any]:
    """The trip event stream as a long poll (what the web client uses): Cloudflare quick tunnels buffer streamed
    responses until they end, so an endless SSE stream would never deliver a nudge through the public URL."""
    return jsonable_encoder(await trip_events.wait(trip_id, cursor, POLL_WAIT_S))


class ChatRequest(BaseModel):
    trip_id: str
    message: str = Field(min_length=1, max_length=2000)


async def chat_turn(trip_id: str, message: str, run_id: str) -> AsyncIterator[Event]:
    """One agent turn as §8.4 events. The reply is stored in `messages`, tool calls in `agent_events`."""
    reply = ""
    try:
        async for item in agent.run(trip_id, message, run_id):
            data = item["data"]
            if item["type"] == "message.delta":
                reply += data["text"]
            elif item["type"] == "tool.end":
                await audit(
                    trip_id,
                    run_id,
                    type="tool",
                    name=data["name"],
                    input=data.get("input"),
                    output_summary=data["summary"] if data["ok"] else data.get("detail") or data["summary"],
                    ok=data["ok"],
                    ms=data["ms"],
                )
            yield item
    except Exception as err:  # noqa: BLE001 - the turn must end with a readable error, not a silent stop
        yield {"type": "error", "data": {"message": f"{type(err).__name__}: {err}"}}
    if reply:
        try:
            await repo.save_message(get_db(), trip_id, "assistant", reply, run_id)
        except (PyMongoError, MongoNotConfigured) as err:  # the reply already reached the traveler
            logger.warning("Assistant reply not saved: %s", explain(err))


async def start_chat(body: ChatRequest) -> Run:
    db = get_db()
    try:
        await repo.get_trip(db, body.trip_id)  # only real trips get a Claude session
    except repo.TripNotFound as err:
        raise HTTPException(404, str(err)) from err
    run_id = f"run_{uuid.uuid4().hex[:10]}"
    await repo.save_message(db, body.trip_id, "user", body.message, run_id)
    return runs.start(body.trip_id, lambda run: chat_turn(body.trip_id, body.message, run.id), run_id=run_id)


@app.post("/api/chat")
async def chat(body: ChatRequest) -> StreamingResponse:
    """One agent turn as SSE (§8.4), read from its background run; the client leaving ends the turn."""
    run = await start_chat(body)

    async def frames() -> AsyncIterator[str]:
        try:
            async for item in run.stream():
                yield sse(item)
        finally:
            runs.cancel(run.id)  # a client that left mid-turn ends it (no-op once the turn is done)

    return stream(with_heartbeat(frames()))


@app.post("/api/chat/runs")
async def chat_run(body: ChatRequest) -> dict[str, str]:
    """The same turn, read by long poll (what the web client uses): works through proxies that buffer streams."""
    return {"run_id": (await start_chat(body)).id}


@app.get("/api/chat/runs/{run_id}/events")
async def chat_run_events(run_id: str, cursor: Annotated[int, Query(ge=0)] = 0) -> dict[str, Any]:
    """The run's events after `cursor`, waiting up to POLL_WAIT_S for the first; `done` once the turn ended."""
    run = runs.get(run_id)
    if run is None:
        raise HTTPException(404, f"No run {run_id!r} (finished runs are kept for 10 minutes).")
    return jsonable_encoder(await run.events_after(cursor, POLL_WAIT_S))


@app.delete("/api/chat/runs/{run_id}")
async def cancel_chat_run(run_id: str) -> dict[str, bool]:
    """The traveler left mid-turn (reset, mode switch): stop it, so the next question doesn't wait for it."""
    return {"cancelled": runs.cancel(run_id)}


@app.post("/api/proposals/{proposal_id}/reject")
async def reject_proposal(proposal_id: str) -> dict[str, Any]:
    """The travelers declined the card (§8.4). Only an open proposal can be declined."""
    proposal = await proposals.reject(proposal_id)
    if proposal is None:
        raise HTTPException(409, "This proposal is no longer open (decided or replaced by a newer one).")
    return jsonable_encoder(proposal)


Lang = Literal["mn", "en"]


class InterpretRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    source_lang: Lang
    target_lang: Lang


@app.post("/api/interpret")
async def interpret(body: InterpretRequest) -> dict[str, Any]:
    """mn ⇄ en through the A2A Interpreter Agent (Orchu). If the agent is down, Orchu directly, so the
    interpreter screen keeps working on stage; the audit log records which path answered."""
    if body.source_lang == body.target_lang:
        return {"text": body.text}
    direction = f"{body.source_lang} → {body.target_lang}"
    try:
        reply = await a2a.call_skill(get_settings().a2a_interpreter_url, "translate", body.model_dump())
    except AgentCardResolutionError as err:  # the agent isn't running: nothing was sent, so Orchu directly
        logger.warning("Interpreter Agent unreachable (%s); translating with Orchu directly", type(err).__name__)
        result = await orchu.translate(body.text, body.source_lang, body.target_lang)
        await audit(
            repo.TRIP_ID,
            "interpreter",
            type="tool",
            name="orchu.translate",
            output_summary=direction,
            ms=round(result.ms),
        )
        return {"text": result.text, "via": "orchu", "ms": round(result.ms)}
    except (httpx.HTTPError, A2AClientError, a2a.A2AReplyMissing) as err:
        # The agent took the request (and may still be translating): translating again would only add to
        # Orchu's rate limit, so report it instead.
        status = 504 if isinstance(err, A2AClientTimeoutError) else 502
        raise HTTPException(status, f"Interpreter Agent: {type(err).__name__}") from err
    failed = "error" in reply.data
    await audit(
        repo.TRIP_ID,
        "interpreter",
        type="a2a",
        name="interpreter.translate",
        ok=not failed,
        output_summary=str(reply.data["error"])[:120] if failed else direction,
        ms=round(reply.ms),
    )
    if failed:
        raise HTTPException(502, f"Interpreter Agent: {reply.data['error']}")
    return {"text": reply.data["text"], "via": "a2a", "ms": round(reply.ms)}


@app.post("/api/voice/transcribe")
async def transcribe(file: Annotated[UploadFile, File()], lang: Annotated[Lang, Form()] = "mn") -> dict[str, str]:
    """Anir speech-to-text (Mongolian). English speech is recognized in the browser."""
    heard = await voice.transcribe(await file.read(), lang, filename=file.filename or "speech.wav")
    return {"text": heard.text}


class SpeakRequest(BaseModel):
    text: str = Field(min_length=1, max_length=4000)
    lang: Lang = "mn"


@app.post("/api/voice/speak")
async def speak(body: SpeakRequest) -> Response:
    """tsuurAI text-to-speech (Mongolian) as WAV. English speech is synthesized in the browser."""
    speech = await voice.speak(body.text, body.lang)
    return Response(content=speech.wav, media_type="audio/wav")


@app.post("/api/demo/reset", dependencies=[Depends(require_demo_mode)])
async def demo_reset() -> dict[str, str]:
    db = get_db()
    trip_id = await seed.reset(db)
    runs.cancel_trip(trip_id)  # a turn still running would otherwise answer into the fresh demo
    await agent.close(trip_id)
    trip = await repo.get_trip(db, trip_id)
    trip_events.publish(
        trip_id,
        {"type": "plan.updated", "data": {"trip_id": trip_id, "version": trip["version"], "changed_item_ids": []}},
    )
    return {"trip_id": trip_id}


class ScenarioRequest(BaseModel):
    weather: repo.Weather


@app.post("/api/demo/scenario", dependencies=[Depends(require_demo_mode)])
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
