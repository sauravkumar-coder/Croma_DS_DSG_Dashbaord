"""
services/store_service.py — Store-level business logic.

Powers:
  - Store list with YTD revenue + target achievement
  - Single-store detail with monthly breakdown
  - Rising stars / fallen stars classification
  - Store journey (multi-month revenue trajectory)
"""

from typing import Any, Optional

from repositories import sales_repository, store_repository, target_repository
from shared.date_utils import month_label, compute_trend


async def get_all_stores(year: int) -> dict[str, Any]:
    """All stores enriched with YTD revenue, target achievement, and trend."""
    stores = await store_repository.get_all_stores()
    revenue_map = await sales_repository.get_monthly_revenue_by_store(year)
    target_map = await target_repository.get_monthly_targets_by_store(year)

    result: list[dict[str, Any]] = []
    for store in stores:
        sid = store.get("_id") or store.get("id", "")
        monthly_rev = revenue_map.get(sid, {})
        monthly_tgt = target_map.get(sid, {})

        revenue_ytd = sum(monthly_rev.values())
        target_ytd = sum(monthly_tgt.values())
        achievement_pct = round((revenue_ytd / target_ytd * 100), 1) if target_ytd > 0 else None
        trend = compute_trend(monthly_rev)

        result.append({
            "store_id": sid,
            "store_name": store.get("storeName", ""),
            "city": store.get("city"),
            "state": store.get("state"),
            "storeCategory": store.get("storeCategory"),
            "storeChannel": store.get("storeChannel"),
            "cityTier": store.get("cityTier"),
            "priority": store.get("priority"),
            "latitude": store.get("latitude"),
            "longitude": store.get("longitude"),
            "revenue_ytd": round(revenue_ytd, 2),
            "target_ytd": round(target_ytd, 2),
            "achievement_pct": achievement_pct,
            "trend": trend,
        })

    return {"stores": result, "total": len(result), "year": year}


async def get_store_detail(store_id: str, year: int) -> Optional[dict[str, Any]]:
    """Single store with full monthly sales + target breakdown."""
    store = await store_repository.get_store_by_id(store_id)
    if store is None:
        return None

    sales_records = await sales_repository.get_sales_by_store(store_id, year)
    target_records = await target_repository.get_targets_by_store(store_id, year)

    # Aggregate monthly revenue across all brands/categories
    monthly_revenue: dict[int, float] = {}
    monthly_revenue_by_brand: dict[str, dict[int, float]] = {}
    for rec in sales_records:
        brand_id = rec.get("brandId", "")
        if brand_id not in monthly_revenue_by_brand:
            monthly_revenue_by_brand[brand_id] = {}
        for entry in rec.get("monthlySales", []):
            m = entry["month"]
            rev = entry.get("revenue", 0.0)
            monthly_revenue[m] = monthly_revenue.get(m, 0.0) + rev
            monthly_revenue_by_brand[brand_id][m] = (
                monthly_revenue_by_brand[brand_id].get(m, 0.0) + rev
            )

    # Aggregate monthly targets across all brands
    monthly_target: dict[int, float] = {}
    for t in target_records:
        m = t["month"]
        monthly_target[m] = monthly_target.get(m, 0.0) + (t.get("targetRevenue") or 0.0)

    # Build labelled monthly timeline
    all_months = sorted(set(monthly_revenue) | set(monthly_target))
    monthly_timeline = [
        {
            "month": m,
            "month_label": month_label(year, m),
            "revenue": round(monthly_revenue.get(m, 0.0), 2),
            "target_revenue": round(monthly_target.get(m, 0.0), 2),
            "achievement_pct": (
                round(monthly_revenue.get(m, 0.0) / monthly_target[m] * 100, 1)
                if monthly_target.get(m, 0.0) > 0
                else None
            ),
        }
        for m in all_months
    ]

    revenue_ytd = sum(monthly_revenue.values())
    target_ytd = sum(monthly_target.values())

    return {
        "store_id": store_id,
        "store_name": store.get("storeName", ""),
        "city": store.get("city"),
        "state": store.get("state"),
        "storeCategory": store.get("storeCategory"),
        "storeChannel": store.get("storeChannel"),
        "cityTier": store.get("cityTier"),
        "priority": store.get("priority"),
        "latitude": store.get("latitude"),
        "longitude": store.get("longitude"),
        "year": year,
        "revenue_ytd": round(revenue_ytd, 2),
        "target_ytd": round(target_ytd, 2),
        "achievement_pct": (
            round(revenue_ytd / target_ytd * 100, 1) if target_ytd > 0 else None
        ),
        "trend": compute_trend(monthly_revenue),
        "monthly_timeline": monthly_timeline,
        "monthly_revenue_by_brand": {
            brand: {month_label(year, m): round(rev, 2) for m, rev in months.items()}
            for brand, months in monthly_revenue_by_brand.items()
        },
    }


async def get_store_journey(year: int) -> dict[str, Any]:
    """Month-over-month revenue trajectory for every store in a year."""
    stores = await store_repository.get_all_stores()
    revenue_map = await sales_repository.get_monthly_revenue_by_store(year)

    store_name_map = {
        (s.get("_id") or s.get("id", "")): s.get("storeName", "")
        for s in stores
    }

    journeys: list[dict[str, Any]] = []
    for sid, monthly in revenue_map.items():
        sorted_months = sorted(monthly.keys())
        journeys.append({
            "store_id": sid,
            "store_name": store_name_map.get(sid, sid),
            "monthly_revenue": {
                month_label(year, m): round(monthly[m], 2) for m in sorted_months
            },
            "trend": compute_trend(monthly),
            "revenue_ytd": round(sum(monthly.values()), 2),
        })

    return {"year": year, "stores": journeys, "total": len(journeys)}


async def get_rising_stars(year: int, min_months: int = 3) -> dict[str, Any]:
    """Stores with consistent upward revenue trend."""
    journey = await get_store_journey(year)
    revenue_map = await sales_repository.get_monthly_revenue_by_store(year)

    rising = [
        s for s in journey["stores"]
        if s["trend"] == "rising"
        and len(revenue_map.get(s["store_id"], {})) >= min_months
    ]
    rising.sort(key=lambda s: s["revenue_ytd"], reverse=True)
    return {"year": year, "stores": rising, "total": len(rising)}


async def get_fallen_stars(year: int, min_months: int = 3) -> dict[str, Any]:
    """Stores with consistent downward revenue trend."""
    journey = await get_store_journey(year)
    revenue_map = await sales_repository.get_monthly_revenue_by_store(year)

    fallen = [
        s for s in journey["stores"]
        if s["trend"] == "falling"
        and len(revenue_map.get(s["store_id"], {})) >= min_months
    ]
    fallen.sort(key=lambda s: s["revenue_ytd"])
    return {"year": year, "stores": fallen, "total": len(fallen)}
