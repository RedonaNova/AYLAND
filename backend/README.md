# AYLAND backend

One Python project (uv, Python 3.12), several processes (HANDBOOK §5.1, §7): orchestrator (FastAPI, :8000),
MCP servers `travel-data` (:8201) and `merchant` (:8202), A2A agents `booking` (:8301) and `interpreter` (:8302).

```bash
uv sync                                   # install
uv run uvicorn ayland.orchestrator.app:app --reload --port 8000
uv run python -m spikes.check_services    # M0: MongoDB, Claude CLI, OyuLLM, Anir STT, TsuurAI TTS
```

Settings come from the repo-root `.env` (copy `.env.example`); `ayland/config.py` is the only module that reads it.
