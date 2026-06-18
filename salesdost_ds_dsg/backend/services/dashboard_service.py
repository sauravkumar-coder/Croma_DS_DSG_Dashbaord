"""
services/dashboard_service.py — Aggregated KPIs for the overview dashboard.

Powers:
  - GET /api/dashboard/overview
"""

from typing import Any

from repositories import sales_repository, store_repository, target_repository
from shared.date_utils import month_label, compute_trend


async def get_overview(year: int) -> dict[str, Any]:
    """Top-level KPIs and monthly trend for the given year."""
    stores = await store_repository.get_all_stores()
    revenue_map = await sales_repository.get_monthly_revenue_by_store(year)
    target_map = await target_repository.get_monthly_targets_by_store(year)

    total_stores = len(stores)

    # Global monthly aggregates
    all_months: set[int] = set()
    for monthly in revenue_map.values():
        all_months.update(monthly.keys())
    for monthly in target_map.values():
        all_months.update(monthly.keys())

    global_revenue: dict[int, float] = {}
    global_target: dict[int, float] = {}
    for monthly in revenue_map.values():
        for m, v in monthly.items():
            global_revenue[m] = global_revenue.get(m, 0.0) + v
    for monthly in target_map.values():
        for m, v in monthly.items():
            global_target[m] = global_target.get(m, 0.0) + v

    total_revenue_ytd = sum(global_revenue.values())
    total_target_ytd = sum(global_target.values())
    achievement_pct = (
        round(total_revenue_ytd / total_target_ytd * 100, 1)
        if total_target_ytd > 0
        else None
    )

    monthly_trend = [
        {
            "month": m,
            "month_label": month_label(year, m),
            "revenue": round(global_revenue.get(m, 0.0), 2),
            "target": round(global_target.get(m, 0.0), 2),
        }
        for m in sorted(all_months)
    ]

    # Per-store performance distribution
    trend_counts: dict[str, int] = {"rising": 0, "falling": 0, "stable": 0}
    for sid, monthly in revenue_map.items():
        trend = compute_trend(monthly)
        trend_counts[trend] = trend_counts.get(trend, 0) + 1

    # Top performing state by total revenue
    state_revenue: dict[str, float] = {}
    store_state_map = {
        (s.get("_id") or s.get("id", "")): s.get("state", "")
        for s in stores
    }
    for sid, monthly in revenue_map.items():
        state = store_state_map.get(sid, "")
        if state:
            state_revenue[state] = state_revenue.get(state, 0.0) + sum(monthly.values())

    top_state = max(state_revenue, key=state_revenue.get) if state_revenue else None  # type: ignore[arg-type]

    return {
        "year": year,
        "total_stores": total_stores,
        "total_revenue_ytd": round(total_revenue_ytd, 2),
        "total_target_ytd": round(total_target_ytd, 2),
        "target_achievement_pct": achievement_pct,
        "top_state": top_state,
        "monthly_trend": monthly_trend,
        "store_performance": trend_counts,
    }
