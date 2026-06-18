"""
repositories/store_repository.py — Store collection access.

Responsibilities:
  - Direct MongoDB / mock-JSON access only
  - No business logic, no dashboard calculations
  - All callers receive plain Python dicts (not Beanie documents)
"""

import json
import os
from typing import Any, Optional

_MOCK_PATH = os.path.join(os.path.dirname(__file__), "..", "mock", "stores.json")


def _load_mock() -> list[dict[str, Any]]:
    with open(_MOCK_PATH, encoding="utf-8") as fh:
        return json.load(fh)


async def get_all_stores() -> list[dict[str, Any]]:
    from app.core.config import settings
    from app.core.database import is_mongo_connected, get_db

    if settings.USE_MOCK_DATA or not is_mongo_connected():
        return _load_mock()

    from app.core.config import settings as cfg
    db = get_db()
    cursor = db[cfg.STORE_COLLECTION].find({}, {"_id": 1, "storeName": 1, "state": 1,
                                               "storeCategory": 1, "city": 1,
                                               "latitude": 1, "longitude": 1,
                                               "priority": 1})
    docs = await cursor.to_list(length=None)
    return docs


async def get_store_by_id(store_id: str) -> Optional[dict[str, Any]]:
    from app.core.config import settings
    from app.core.database import is_mongo_connected, get_db

    if settings.USE_MOCK_DATA or not is_mongo_connected():
        return next((s for s in _load_mock() if s.get("_id") == store_id), None)

    from app.core.config import settings as cfg
    db = get_db()
    return await db[cfg.STORE_COLLECTION].find_one({"_id": store_id})


async def get_store_code_map(brand_id: str) -> dict[str, str]:
    """
    Returns {storeId: storeBrandId} for every store mapped to the given brand.

    storeBrandId is the business-facing store code (e.g. 'A024') stored in the
    StoreBrand junction collection.  Use this to translate internal storeId keys
    into the codes that appear in targets, reports, and store names.
    """
    from app.core.config import settings
    from app.core.database import is_mongo_connected, get_db

    if settings.USE_MOCK_DATA or not is_mongo_connected():
        return {}

    from app.core.config import settings as cfg
    db = get_db()
    cursor = db[cfg.STORE_BRAND_COLLECTION].find(
        {"brandId": brand_id, "storeBrandId": {"$ne": None}},
        {"storeId": 1, "storeBrandId": 1, "_id": 0},
    )
    docs = await cursor.to_list(length=None)
    return {d["storeId"]: d["storeBrandId"] for d in docs if d.get("storeBrandId")}


async def get_stores_by_state(state: str) -> list[dict[str, Any]]:
    from app.core.config import settings
    from app.core.database import is_mongo_connected, get_db

    if settings.USE_MOCK_DATA or not is_mongo_connected():
        return [s for s in _load_mock() if s.get("state") == state]

    from app.core.config import settings as cfg
    db = get_db()
    cursor = db[cfg.STORE_COLLECTION].find({"state": state})
    return await cursor.to_list(length=None)
