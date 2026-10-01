from ayland.config import REPO_ROOT, Settings


def test_settings_default_to_the_handbook_ports() -> None:
    settings = Settings(_env_file=None)
    assert settings.mcp_travel_data_url.endswith(":8201/mcp")
    assert settings.a2a_booking_url.endswith(":8301")
    assert settings.oyu_llm_model == "oyuLLM"


def test_repo_root_holds_the_handbook() -> None:
    assert (REPO_ROOT / "HANDBOOK.md").exists()
