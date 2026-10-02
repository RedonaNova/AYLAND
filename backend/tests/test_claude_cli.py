from pathlib import Path
from types import SimpleNamespace

import pytest

from ayland.config import Settings
from ayland.llm import claude


@pytest.fixture
def no_configured_cli(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    """No CLAUDE_CLI_PATH and no CLI bundled with the SDK (some platforms' wheels ship one, e.g. on CI)."""
    monkeypatch.setattr(claude, "get_settings", lambda: Settings(_env_file=None))
    monkeypatch.setattr(claude, "claude_agent_sdk", SimpleNamespace(__file__=str(tmp_path / "sdk" / "__init__.py")))


def test_skips_npm_batch_shim_and_picks_newest_extension(
    no_configured_cli: None, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    for version in ("2.1.9", "2.1.10"):
        binary = tmp_path / ".vscode/extensions" / f"anthropic.claude-code-{version}-win32-x64/resources/native-binary"
        binary.mkdir(parents=True)
        (binary / "claude.exe").write_bytes(b"")
    monkeypatch.setattr(claude.Path, "home", lambda: tmp_path)
    monkeypatch.setattr(claude.shutil, "which", lambda name: r"C:\npm\claude.CMD")

    assert "claude-code-2.1.10-" in claude.find_cli()


def test_reports_missing_cli(no_configured_cli: None, monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setattr(claude.Path, "home", lambda: tmp_path)
    monkeypatch.setattr(claude.shutil, "which", lambda name: None)

    with pytest.raises(claude.ClaudeCliNotFound):
        claude.find_cli()
