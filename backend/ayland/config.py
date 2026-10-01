"""Settings from the repo-root `.env`. The only module that reads environment variables (HANDBOOK §11)."""

from functools import lru_cache
from pathlib import Path

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    # env_ignore_empty: a blank `KEY=` line in .env means "not set", so the clear "configure X" errors fire.
    model_config = SettingsConfigDict(
        env_file=REPO_ROOT / ".env", env_file_encoding="utf-8", env_ignore_empty=True, extra="ignore"
    )

    # Database (M0-2)
    mongodb_uri: SecretStr | None = None
    mongodb_db: str = "ayland"

    # Claude, reached through the Claude Code CLI login instead of an API key (M0-3).
    # Empty path: use `claude` on PATH, else the copy bundled with the VS Code extension.
    claude_cli_path: str = ""
    claude_model: str = "claude-opus-5-5"
    claude_effort: str = "medium"

    # Novelsoft, required by the hackathon: OyuLLM, Anir STT, tsuurAI TTS (one key for all).
    oyu_api_key: SecretStr | None = None
    oyu_base_url: str = "https://api.oyu.so/v1"
    oyu_llm_model: str = "oyuLLM"
    oyu_stt_model: str = "v4"
    oyu_tts_voice: str = "mbspeech"

    # Local service URLs (HANDBOOK §5.1)
    orchestrator_url: str = "http://localhost:8000"
    web_origin: str = "http://localhost:3000"
    mcp_travel_data_url: str = "http://localhost:8201/mcp"
    mcp_merchant_url: str = "http://localhost:8202/mcp"
    a2a_booking_url: str = "http://localhost:8301"
    a2a_interpreter_url: str = "http://localhost:8302"

    # Demo (HANDBOOK §3)
    demo_mode: bool = True
    demo_scenario: str = "hanoi_rain"
    demo_now: str = "10:30"


@lru_cache
def get_settings() -> Settings:
    return Settings()
