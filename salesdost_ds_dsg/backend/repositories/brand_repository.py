"""
repositories/brand_repository.py — Brand collection access.

Responsibilities:
  - Direct MongoDB / mock-JSON access only
  - No business logic, no dashboard calculations
  - All callers receive plain Python dicts (not Beanie documents)
"""

import json
import os
from typing import Any

_MOCK_PATH = os.path.join(os.path.dirname(__file__), "..", "mock", "brands.json")


def _load_mock() -> list[dict[str, Any]]:
    with open(_MOCK_PATH, encoding="utf-8") as fh:
        return json.load(fh)


async def get_all_brands() -> list[dict[str, Any]]:
    from app.core.config import settings
    from app.core.database import is_mongo_connected, get_db

    if settings.USE_MOCK_DATA or not is_mongo_connected():
        return _load_mock()

    from app.core.config import settings as cfg
    db = get_db()
    cursor = db[cfg.BRAND_COLLECTION].find({}, {"_id": 1, "brandName": 1})
    return await cursor.to_list(length=None)
