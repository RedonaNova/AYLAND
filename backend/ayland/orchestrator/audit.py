"""agent_events writes (§5.4 rule 3: every tool, A2A, plan and booking action is logged)."""

import logging
from typing import Any

from pydantic import ValidationError
from pymongo.errors import PyMongoError

from ayland.db import repo
from ayland.db.client import MongoNotConfigured, explain, get_db

logger = logging.getLogger("ayland.audit")


async def audit(trip_id: str, run_id: str, **fields: Any) -> None:
    """Best-effort: a failed audit log must never break a chat turn, a plan change or a translation."""
    try:
        await repo.log_event(get_db(), trip_id, run_id, **fields)
    except (PyMongoError, MongoNotConfigured, ValidationError) as err:
        logger.warning("agent_events write failed: %s", err if isinstance(err, ValidationError) else explain(err))
