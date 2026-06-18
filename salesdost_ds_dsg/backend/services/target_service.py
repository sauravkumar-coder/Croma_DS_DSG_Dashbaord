"""
services/target_service.py — Target achievement business logic.

Powers:
  - GET /api/targets
  - Target achievement per store per month
"""

from typing import Any, Optional

from repositories import sales_repository, store_repository, target_repository
from shared.date_utils import month_label


async def get_targets_summary(year: int, month: Optional[int] = None) -> dict[str, Any]:
    """
    Target achievement summary for all stores.

    If month is given, returns achievement for that single month.
    Otherwise returns full-year YTD achievement.
    """
    stores = await store_repository.get_all_stores()
    revenue_map = await sales_repository.get_monthly_revenue_by_store(year)
    target_map = await target_repository.get_monthly_targets_by_store(year)

    store_name_map = {
        (s.get("_id") or s.get("id", "")): s.get("storeName", "")
        for s in stores
    }

    rows: list[dict[str, Any]] = []
    for store in stores:
        sid = store.get("_id") or store.get("id", "")
        monthly_rev = revenue_map.get(sid, {})
        monthly_tgt = target_map.get(sid, {})

        if month is not None:
            revenue = monthly_rev.get(month, 0.0)
            target = monthly_tgt.get(month, 0.0)
            period_label = month_label(year, month)
        else:
            revenue = sum(monthly_rev.values())
            target = sum(monthly_tgt.values())
            period_label = f"YTD-{year}"

        achievement_pct = round(revenue / target * 100, 1) if target > 0 else None

        rows.append({
            "store_id": sid,
            "store_name": store_name_map.get(sid, sid),
            "period": period_label,
            "revenue": round(revenue, 2),
            "target": round(target, 2),
            "achievement_pct": achievement_pct,
            "gap": round(target - revenue, 2) if target > 0 else None,
            "state": store.get("state"),
            "priority": store.get("priority"),
        })

    rows.sort(key=lambda r: r["achievement_pct"] or 0, reverse=True)

    total_revenue = sum(r["revenue"] for r in rows)
    total_target = sum(r["target"] for r in rows)

    return {
        "year": year,
        "month": month,
        "period": month_label(year, month) if month else f"YTD-{year}",
        "overall_achievement_pct": (
            round(total_revenue / total_target * 100, 1) if total_target > 0 else None
        ),
        "total_revenue": round(total_revenue, 2),
        "total_target": round(total_target, 2),
        "stores": rows,
        "total_stores": len(rows),
    }


