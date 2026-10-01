"""Orchestrator HTTP API (HANDBOOK §8.4). M0: health only; /api/chat arrives with M1-A1."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pymongo.errors import PyMongoError

from ayland.config import get_settings
from ayland.db.client import MongoNotConfigured, ping
from ayland.llm.claude import ClaudeCliNotFound, find_cli

app = FastAPI(title="AYLAND Orchestrator", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[get_settings().web_origin],
    allow_methods=["*"],
    allow_headers=["*"],
)


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
        checks["mongodb"] = {"ok": False, "error": type(err).__name__}
    try:
        checks["claude_cli"] = {"ok": True, "path": find_cli(), "model": settings.claude_model}
    except ClaudeCliNotFound as err:
        checks["claude_cli"] = {"ok": False, "error": str(err)}
    checks["oyu"] = {"ok": settings.oyu_api_key is not None, "base_url": settings.oyu_base_url}
    checks["demo_mode"] = settings.demo_mode
    return checks
