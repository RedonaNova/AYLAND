"""MongoDB Atlas client (D8: PyMongo async API; Motor is deprecated)."""

import time
from functools import lru_cache

from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from ayland.config import get_settings


class MongoNotConfigured(RuntimeError):
    """MONGODB_URI is missing from .env."""


@lru_cache
def get_client() -> AsyncMongoClient:
    uri = get_settings().mongodb_uri
    if uri is None:
        raise MongoNotConfigured("Set MONGODB_URI in the repo-root .env (see .env.example).")
    return AsyncMongoClient(uri.get_secret_value(), appname="ayland", serverSelectionTimeoutMS=8000)


def get_db() -> AsyncDatabase:
    return get_client()[get_settings().mongodb_db]


async def ping() -> float:
    """Round-trip to the cluster in milliseconds."""
    started = time.perf_counter()
    await get_client().admin.command("ping")
    return (time.perf_counter() - started) * 1000
