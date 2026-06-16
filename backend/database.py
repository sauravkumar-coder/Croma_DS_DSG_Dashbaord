"""
database.py — MongoDB connection via Motor (async driver for FastAPI).

Usage:
    from database import get_db

    @app.get("/api/example")
    async def example():
        db = get_db()
        doc = await db["some_collection"].find_one({})
        return doc

Collections used by this project:
    target_files   — uploaded target XLSX files (binary + metadata)
    tracker_sales  — tracker monthly sales files (binary + metadata)
    target_registry — active-month registry and file metadata
"""

import os

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

_DATABASE_URL: str = os.environ["DATABASE_URL"]
_DB_NAME: str = "ds_dsg_tracker"

_client: AsyncIOMotorClient | None = None


def get_client() -> AsyncIOMotorClient:
    global _client
    if _client is None:
        _client = AsyncIOMotorClient(_DATABASE_URL)
    return _client


def get_db() -> AsyncIOMotorDatabase:
    return get_client()[_DB_NAME]


async def close_client() -> None:
    global _client
    if _client is not None:
        _client.close()
        _client = None
