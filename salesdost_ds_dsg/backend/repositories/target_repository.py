"""
repositories/target_repository.py — StoreTarget collection access.

All live-MongoDB paths use raw Motor queries (not Beanie ODM) to remain
resilient against schema drift in the production database.
"""

import json
import os
from typing import Any

_MOCK_PATH = os.path.join(os.path.dirname(__file__), "..", "mock", "targets.json")


def _load_mock() -> list[dict[str, Any]]:
    with open(_MOCK_PATH, encoding="utf-8") as fh:
        return json.load(fh)


async def get_targets_by_store(store_id: str, year: int) -> list[dict[str, Any]]:
    """StoreTargets for a specific store across all months in a year."""
    from app.core.config import settings
    from app.core.database import is_mongo_connected, get_db

    if settings.USE_MOCK_DATA or not is_mongo_connected():
        return [
            t for t in _load_mock()
            if t.get("storeId") == store_id and t.get("year") == year
        ]

    from app.core.config import settings as cfg
    db = get_db()
    cursor = db[cfg.STORE_TARGET_COLLECTION].find({"storeId": store_id, "year": year})
    return await cursor.to_list(length=None)


async def get_monthly_targets_by_store(
    year: int,
    brand_id: str | None = None,
    category_id: str | None = None,
) -> dict[str, dict[int, float]]:
    """
    Returns {store_id: {month_int: total_target_revenue}} for a year.

    Pass brand_id / category_id to restrict to a single brand/category;
    omit either to aggregate across all brands/categories.
    """
    from app.core.config import settings

    if settings.USE_MOCK_DATA:
        result: dict[str, dict[int, float]] = {}
        for t in _load_mock():
            if t.get("year") != year:
                continue
            if brand_id and t.get("brandId") != brand_id:
                continue
            if category_id and t.get("categoryId") != category_id:
                continue
            sid = t["storeId"]
            month = t["month"]
            if sid not in result:
                result[sid] = {}
            result[sid][month] = result[sid].get(month, 0.0) + (t.get("targetRevenue") or 0.0)
        return result

    from app.core.config import settings as cfg
    from app.core.database import get_db

    db = get_db()
    if db is None:
        return {}

    match: dict = {"year": year, "targetRevenue": {"$ne": None}}
    if brand_id:
        match["brandId"] = brand_id
    if category_id:
        match["categoryId"] = category_id

    pipeline = [
        {"$match": match},
        {
            "$group": {
                "_id": {"storeId": "$storeId", "month": "$month"},
                "targetRevenue": {"$sum": "$targetRevenue"},
            }
        },
    ]
    cursor = db[cfg.STORE_TARGET_COLLECTION].aggregate(pipeline)
    agg = await cursor.to_list(length=None)

    result = {}
    for row in agg:
        sid = row["_id"]["storeId"]
        month = row["_id"]["month"]
        if sid not in result:
            result[sid] = {}
        result[sid][month] = row["targetRevenue"]
    return result
