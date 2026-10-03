"""How AYLAND agents name a skill over A2A: the request carries a data part {"skill": <id>, ...inputs}.

A2A routes messages, not skills, so this convention is shared by our agents and the orchestrator's client.
"""

from dataclasses import dataclass
from typing import Any

from a2a.helpers.proto_helpers import get_data_parts, get_message_text
from a2a.types import Message


@dataclass
class SkillRequest:
    skill: str
    inputs: dict[str, Any]


def parse_request(message: Message | None) -> SkillRequest | None:
    """The first data part with a "skill" key; plain text "ping" is accepted for quick manual checks."""
    if message is None:
        return None
    for data in get_data_parts(message.parts):
        if isinstance(data, dict) and isinstance(data.get("skill"), str):
            inputs = {k: v for k, v in data.items() if k != "skill"}
            return SkillRequest(data["skill"], inputs)
    text = get_message_text(message).strip().lower()
    return SkillRequest(text, {}) if text else None
