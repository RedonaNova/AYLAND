"""Claude through the Claude Code CLI login (Claude Agent SDK), so no Anthropic API key is needed (M0-3)."""

import re
import shutil
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path

import claude_agent_sdk
from claude_agent_sdk import AssistantMessage, ClaudeAgentOptions, ResultMessage, TextBlock, query

from ayland.config import get_settings

CLI_NAMES = ("claude.exe", "claude")


class ClaudeCliNotFound(RuntimeError):
    """No usable Claude Code CLI on this machine."""


class ClaudeError(RuntimeError):
    """The CLI ran but the turn failed (not logged in, unknown model, API error...)."""


def _version(folder: Path) -> tuple[int, ...]:
    """'anthropic.claude-code-2.1.285-win32-x64' -> (2, 1, 285), so 2.1.10 sorts after 2.1.9."""
    match = re.search(r"(\d+)\.(\d+)\.(\d+)", folder.name)
    return tuple(int(part) for part in match.groups()) if match else (0,)


def find_cli() -> str:
    """CLAUDE_CLI_PATH, the SDK's bundled CLI, a native `claude` on PATH, then the VS Code extension's copy.

    Batch shims (npm's claude.cmd) are skipped: the SDK refuses to run .cmd/.bat files on Windows.
    """
    configured = get_settings().claude_cli_path
    if configured:
        return configured
    bundled_dir = Path(claude_agent_sdk.__file__).parent / "_bundled"
    for name in CLI_NAMES:
        if (bundled_dir / name).is_file():
            return str(bundled_dir / name)
    for name in CLI_NAMES:
        found = shutil.which(name)
        if found and not found.lower().endswith((".cmd", ".bat")):
            return found
    extensions = sorted((Path.home() / ".vscode" / "extensions").glob("anthropic.claude-code-*"), key=_version)
    for folder in reversed(extensions):
        for name in CLI_NAMES:
            if (binary := folder / "resources" / "native-binary" / name).is_file():
                return str(binary)
    raise ClaudeCliNotFound(
        "Install Claude Code (https://claude.com/claude-code) and run `claude` once to log in, "
        "or set CLAUDE_CLI_PATH in .env."
    )


@dataclass
class ClaudeReply:
    text: str
    ms: float
    cost_usd: float | None


async def ask(prompt: str, system: str = "", effort: str | None = None) -> ClaudeReply:
    """One-shot completion with no built-in tools, user settings or project files in play."""
    settings = get_settings()
    options = ClaudeAgentOptions(
        cli_path=find_cli(),
        model=settings.claude_model,
        effort=effort or settings.claude_effort,
        system_prompt=system or None,
        tools=[],
        setting_sources=[],
        max_turns=1,
        cwd=tempfile.gettempdir(),
    )
    started = time.perf_counter()
    parts: list[str] = []
    result: ResultMessage | None = None
    async for message in query(prompt=prompt, options=options):
        if isinstance(message, AssistantMessage):
            parts.extend(block.text for block in message.content if isinstance(block, TextBlock))
        elif isinstance(message, ResultMessage):
            result = message
    if result is None or result.is_error:
        detail = (result.result or result.subtype) if result else "no result message"
        raise ClaudeError(f"Claude turn failed: {detail}")
    return ClaudeReply(
        text="".join(parts).strip(), ms=(time.perf_counter() - started) * 1000, cost_usd=result.total_cost_usd
    )
