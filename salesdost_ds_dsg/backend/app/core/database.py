"""
app/core/database.py — Motor + Beanie lifecycle management.

Called once on FastAPI startup via connect_to_mongo() then ensure_indexes().
Repositories import get_db() / is_mongo_connected() from here.

Graceful behaviour when MONGO_URI is empty:
  - Logs a warning and skips connection
  - Application starts normally in mock mode
  - All repository calls that check USE_MOCK_DATA will serve from JSON files
"""

import logging
from typing import Optional

from beanie import init_beanie
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

logger = logging.getLogger(__name__)

_client: Optional[AsyncIOMotorClient] = None


async def connect_to_mongo() -> None:
    global _client

    from app.core.config import settings

    if not settings.MONGO_URI:
        logger.warning(
            "MONGO_URI is not set — MongoDB connection skipped. "
            "USE_MOCK_DATA=%s. Application will serve mock data.",
            settings.USE_MOCK_DATA,
        )
        return

    try:
        from models import (  # noqa: F401 — imported so Beanie registers them
            Brand,
            ProductCategory,
            ProductModel,
            ProductSubCategory,
            SalesRecord,
            Store,
            StoreBrand,
            StoreTarget,
        )

        _client = AsyncIOMotorClient(settings.MONGO_URI)

        db = _client.get_default_database()
        await init_beanie(
            database=db,
            document_models=[
                Store, Brand, ProductCategory, StoreBrand,
                SalesRecord, StoreTarget, ProductModel, ProductSubCategory,
            ],
        )
        logger.info(
            "MongoDB connected — database: %s  environment: %s",
            settings.DATABASE_NAME,
            settings.ENVIRONMENT,
        )
    except Exception as exc:
        logger.error("MongoDB connection failed: %s", exc)
        _client = None


async def close_mongo() -> None:
    global _client
    if _client is not None:
        _client.close()
        _client = None
        logger.info("MongoDB connection closed.")


def get_db() -> Optional[AsyncIOMotorDatabase]:
    """Return the Motor database handle, or None if not connected."""
    if _client is None:
        return None
    return _client.get_default_database()


def get_motor_client() -> Optional[AsyncIOMotorClient]:
    return _client


def is_mongo_connected() -> bool:
    return _client is not None


async def ensure_indexes() -> None:
    """Create compound indexes for the most frequent query patterns.

    Uses Motor directly (not Beanie Settings.indexes) to avoid conflicts with
    existing index names in the production database.  create_index() is
    idempotent for the same key pattern, so calling this on every startup is safe.
    Only runs when MongoDB is connected; skips silently otherwise.
    """
    if _client is None:
        return
    try:
        from app.core.config import settings as cfg

        db = _client.get_default_database()

        # SalesRecord — queried by (year, brandId) and (storeId, year)
        sales_col = db[cfg.SALES_RECORD_COLLECTION]
        await sales_col.create_index([("year", 1), ("brandId", 1)])
        await sales_col.create_index([("storeId", 1), ("year", 1)])

        # StoreTarget — queried by (year, brandId), (storeId, year), and (year, month, brandId)
        target_col = db[cfg.STORE_TARGET_COLLECTION]
        await target_col.create_index([("year", 1), ("brandId", 1)])
        await target_col.create_index([("storeId", 1), ("year", 1)])
        await target_col.create_index([("year", 1), ("month", 1), ("brandId", 1)])

        # StoreBrand — looked up by (brandId, storeBrandId) for store-code mapping
        sb_col = db[cfg.STORE_BRAND_COLLECTION]
        await sb_col.create_index([("brandId", 1), ("storeBrandId", 1)])

        # Store — filtered by state in geo / journey queries
        store_col = db[cfg.STORE_COLLECTION]
        await store_col.create_index([("state", 1)])

        logger.info("MongoDB indexes verified.")
    except Exception as exc:
        logger.warning("Index creation skipped (non-fatal): %s", exc)
