"""
repositories/sales_repository.py — SalesRecord collection access.

No business logic here — only data retrieval and minimal grouping
that is structurally necessary to avoid N+1 queries.
All live-MongoDB paths use raw Motor queries (not Beanie ODM) to remain
resilient against schema drift in the production database.
"""

import json
import os
from typing import Any

_MOCK_PATH = os.path.join(os.path.dirname(__file__), "..", "mock", "sales_records.json")


def _load_mock() -> list[dict[str, Any]]:
    with open(_MOCK_PATH, encoding="utf-8") as fh:
        return json.load(fh)


async def get_sales_by_year(year: int) -> list[dict[str, Any]]:
    """All SalesRecords for a given year."""
    from app.core.config import settings
    from app.core.database import is_mongo_connected, get_db

    if settings.USE_MOCK_DATA or not is_mongo_connected():
        return [r for r in _load_mock() if r.get("year") == year]

    from app.core.config import settings as cfg
    db = get_db()
    cursor = db[cfg.SALES_RECORD_COLLECTION].find({"year": year})
    return await cursor.to_list(length=None)


async def get_sales_by_store(store_id: str, year: int) -> list[dict[str, Any]]:
    """SalesRecords for a specific store in a year (all brands/categories)."""
    from app.core.config import settings
    from app.core.database import is_mongo_connected, get_db

    if settings.USE_MOCK_DATA or not is_mongo_connected():
        return [
            r for r in _load_mock()
            if r.get("storeId") == store_id and r.get("year") == year
        ]

    from app.core.config import settings as cfg
    db = get_db()
    cursor = db[cfg.SALES_RECORD_COLLECTION].find({"storeId": store_id, "year": year})
    return await cursor.to_list(length=None)


async def get_available_years() -> list[int]:
    """Returns sorted list of distinct years present in SalesRecord."""
    from app.core.config import settings

    if settings.USE_MOCK_DATA:
        mock_data = _load_mock()
        return sorted({r["year"] for r in mock_data if r.get("year")})

    from app.core.config import settings as cfg
    from app.core.database import get_db

    db = get_db()
    if db is None:
        return []

    pipeline = [{"$group": {"_id": "$year"}}, {"$sort": {"_id": 1}}]
    cursor = db[cfg.SALES_RECORD_COLLECTION].aggregate(pipeline)
    agg = await cursor.to_list(length=None)
    return [row["_id"] for row in agg]


async def get_latest_sales_date_for_month(
    year: int,
    month_int: int,
    brand_id: str | None = None,
    from_daily: bool = False,
) -> str | None:
    """
    Returns the latest date string (YYYY-MM-DD) found in sales data for the
    given month.  Used to surface "Sales data updated till: DD Mon YYYY" on
    the Target Pulse page.

    For from_daily=True brands (e.g. brand_007 / DSDSG) the date is read from
    individual day-entries inside dailySales.  For monthly-only brands we fall
    back to None (no day granularity available).
    """
    from app.core.config import settings

    if settings.USE_MOCK_DATA:
        best: str | None = None
        for rec in _load_mock():
            if rec.get("year") != year:
                continue
            if brand_id and rec.get("brandId") != brand_id:
                continue
            if from_daily:
                month_key = str(month_int)
                for entry in rec.get("dailySales", {}).get(month_key, []):
                    d = entry.get("date")
                    if d and (best is None or str(d) > str(best)):
                        best = str(d)
            else:
                for entry in rec.get("monthlySales", []):
                    if entry.get("month") == month_int:
                        d = entry.get("date")
                        if d and (best is None or str(d) > str(best)):
                            best = str(d)
        return best[:10] if best else None

    from app.core.config import settings as cfg
    from app.core.database import get_db

    db = get_db()
    if db is None:
        return None

    match: dict[str, Any] = {"year": year}
    if brand_id:
        match["brandId"] = brand_id

    if from_daily:
        month_key = str(month_int)
        pipeline: list[dict[str, Any]] = [
            {"$match": match},
            {"$project": {
                "dayEntries": {
                    "$let": {
                        "vars": {
                            "monthArr": {
                                "$arrayElemAt": [
                                    {"$filter": {
                                        "input": {"$objectToArray": {"$ifNull": ["$dailySales", {}]}},
                                        "cond": {"$eq": ["$$this.k", month_key]},
                                    }},
                                    0,
                                ],
                            },
                        },
                        "in": {"$ifNull": ["$$monthArr.v", []]},
                    }
                }
            }},
            {"$unwind": {"path": "$dayEntries", "preserveNullAndEmptyArrays": False}},
            {"$group": {"_id": None, "max_date": {"$max": "$dayEntries.date"}}},
        ]
    else:
        pipeline = [
            {"$match": match},
            {"$unwind": "$monthlySales"},
            {"$match": {"monthlySales.month": month_int}},
            {"$group": {"_id": None, "max_date": {"$max": "$monthlySales.date"}}},
        ]

    from app.core.config import settings as cfg2
    cursor = db[cfg2.SALES_RECORD_COLLECTION].aggregate(pipeline)
    agg = await cursor.to_list(length=1)
    if agg and agg[0].get("max_date"):
        val = agg[0]["max_date"]
        if hasattr(val, "strftime"):
            return val.strftime("%Y-%m-%d")
        return str(val)[:10]
    return None


async def get_daily_revenue_by_store_for_month(
    year: int,
    month_int: int,
    brand_id: str | None = None,
    from_daily: bool = False,
) -> dict[str, list[tuple[int, float]]]:
    """
    Returns {store_id: [(day_int, revenue), ...]} for a specific month.
    Only meaningful when from_daily=True (dailySales sub-document structure).
    Returns {} if from_daily=False or no daily entries are found.
    """
    if not from_daily:
        return {}

    from app.core.config import settings

    if settings.USE_MOCK_DATA:
        result: dict[str, list[tuple[int, float]]] = {}
        month_key = str(month_int)
        for rec in _load_mock():
            if rec.get("year") != year:
                continue
            if brand_id and rec.get("brandId") != brand_id:
                continue
            sid = rec["storeId"]
            for entry in rec.get("dailySales", {}).get(month_key, []):
                date_str = str(entry.get("date", ""))
                revenue = float(entry.get("revenue", 0.0))
                if len(date_str) >= 10:
                    try:
                        day = int(date_str[8:10])
                    except ValueError:
                        continue
                    result.setdefault(sid, []).append((day, revenue))
        return result

    from app.core.config import settings as cfg
    from app.core.database import get_db

    db = get_db()
    if db is None:
        return {}

    month_key = str(month_int)
    match_filter: dict[str, Any] = {"year": year}
    if brand_id:
        match_filter["brandId"] = brand_id

    pipeline: list[dict[str, Any]] = [
        {"$match": match_filter},
        {
            "$project": {
                "storeId": 1,
                "dayEntries": {
                    "$let": {
                        "vars": {
                            "monthArr": {
                                "$arrayElemAt": [
                                    {
                                        "$filter": {
                                            "input": {
                                                "$objectToArray": {
                                                    "$ifNull": ["$dailySales", {}]
                                                }
                                            },
                                            "cond": {"$eq": ["$$this.k", month_key]},
                                        }
                                    },
                                    0,
                                ],
                            },
                        },
                        "in": {"$ifNull": ["$$monthArr.v", []]},
                    }
                },
            }
        },
        {"$unwind": {"path": "$dayEntries", "preserveNullAndEmptyArrays": False}},
        {
            "$group": {
                "_id": {
                    "storeId": "$storeId",
                    "date": "$dayEntries.date",
                },
                "revenue": {"$sum": "$dayEntries.revenue"},
            }
        },
    ]

    cursor = db[cfg.SALES_RECORD_COLLECTION].aggregate(pipeline)
    agg = await cursor.to_list(length=None)

    result = {}
    for row in agg:
        sid = row["_id"]["storeId"]
        date_val = row["_id"]["date"]
        revenue = float(row["revenue"])
        if hasattr(date_val, "day"):
            day = date_val.day
        else:
            date_str = str(date_val)
            if len(date_str) < 10:
                continue
            try:
                day = int(date_str[8:10])
            except ValueError:
                continue
        result.setdefault(sid, []).append((day, revenue))

    return result


async def get_monthly_revenue_by_store(
    year: int,
    brand_id: str | None = None,
    from_daily: bool = False,
) -> dict[str, dict[int, float]]:
    """
    Returns {store_id: {month_int: total_revenue}} for a year.

    Pass brand_id to restrict to a single brand.
    Pass from_daily=True to aggregate revenue from the dailySales sub-document
    instead of monthlySales — use this when the brand stores per-day records
    but leaves monthlySales empty (e.g. brand_007 / DSDSG).
    """
    from app.core.config import settings

    if settings.USE_MOCK_DATA:
        result: dict[str, dict[int, float]] = {}
        for rec in _load_mock():
            if rec.get("year") != year:
                continue
            if brand_id and rec.get("brandId") != brand_id:
                continue
            sid = rec["storeId"]
            if sid not in result:
                result[sid] = {}
            if from_daily:
                for month_key, day_entries in rec.get("dailySales", {}).items():
                    m = int(month_key)
                    for entry in day_entries:
                        result[sid][m] = result[sid].get(m, 0.0) + entry.get("revenue", 0.0)
            else:
                for entry in rec.get("monthlySales", []):
                    m = entry["month"]
                    result[sid][m] = result[sid].get(m, 0.0) + entry.get("revenue", 0.0)
        return result

    from app.core.config import settings as cfg
    from app.core.database import get_db

    db = get_db()
    if db is None:
        return {}

    match: dict[str, Any] = {"year": year}
    if brand_id:
        match["brandId"] = brand_id

    if from_daily:
        # dailySales is stored as {month_str: [{date, revenue, ...}]}
        # Use $objectToArray to unwind the month keys, then unwind each day entry.
        pipeline = [
            {"$match": match},
            {"$project": {
                "storeId": 1,
                "months": {"$objectToArray": "$dailySales"},
            }},
            {"$unwind": "$months"},
            {"$unwind": "$months.v"},
            {"$group": {
                "_id": {
                    "storeId": "$storeId",
                    "month": {"$toInt": "$months.k"},
                },
                "revenue": {"$sum": "$months.v.revenue"},
            }},
        ]
    else:
        pipeline = [
            {"$match": match},
            {"$unwind": "$monthlySales"},
            {"$group": {
                "_id": {"storeId": "$storeId", "month": "$monthlySales.month"},
                "revenue": {"$sum": "$monthlySales.revenue"},
            }},
        ]

    cursor = db[cfg.SALES_RECORD_COLLECTION].aggregate(pipeline)
    agg = await cursor.to_list(length=None)

    result = {}
    for row in agg:
        sid = row["_id"]["storeId"]
        month = row["_id"]["month"]
        if sid not in result:
            result[sid] = {}
        result[sid][month] = row["revenue"]
    return result
