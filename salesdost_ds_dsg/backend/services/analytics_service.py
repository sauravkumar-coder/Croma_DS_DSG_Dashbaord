"""
services/analytics_service.py — Cross-cutting analytics logic.

Powers:
  - New Bloomers (stores with strong ramp in early months)
  - Brand Analysis (revenue split by brand across stores)
"""

from typing import Any

from repositories import brand_repository, sales_repository, store_repository
from shared.date_utils import month_label


async def get_new_bloomers(year: int, min_months_data: int = 3) -> dict[str, Any]:
    """
    Stores that are relatively new to the data set (few months of history)
    but show strong revenue growth across those months.

    Classified as 'new bloomer' if:
      - Has data for fewer than 6 months in the year
      - Revenue in latest tracked month > revenue in first tracked month by > 20%
    """
    stores = await store_repository.get_all_stores()
    revenue_map = await sales_repository.get_monthly_revenue_by_store(year)

    store_name_map = {
        (s.get("_id") or s.get("id", "")): s.get("storeName", "")
        for s in stores
    }

    bloomers: list[dict[str, Any]] = []
    for sid, monthly in revenue_map.items():
        sorted_months = sorted(monthly.keys())
        if len(sorted_months) < min_months_data or len(sorted_months) >= 6:
            continue
        first_rev = monthly[sorted_months[0]]
        last_rev = monthly[sorted_months[-1]]
        if first_rev > 0 and (last_rev - first_rev) / first_rev > 0.20:
            growth_pct = round((last_rev - first_rev) / first_rev * 100, 1)
            bloomers.append({
                "store_id": sid,
                "store_name": store_name_map.get(sid, sid),
                "months_tracked": len(sorted_months),
                "first_month": month_label(year, sorted_months[0]),
                "latest_month": month_label(year, sorted_months[-1]),
                "first_revenue": round(first_rev, 2),
                "latest_revenue": round(last_rev, 2),
                "growth_pct": growth_pct,
                "revenue_ytd": round(sum(monthly.values()), 2),
            })

    bloomers.sort(key=lambda s: s["growth_pct"], reverse=True)
    return {"year": year, "stores": bloomers, "total": len(bloomers)}


async def get_brand_analysis(year: int) -> dict[str, Any]:
    """Revenue breakdown by brand across all stores."""
    brands = await brand_repository.get_all_brands()
    sales_records = await sales_repository.get_sales_by_year(year)

    brand_name_map = {
        (b.get("_id") or b.get("id", "")): b.get("brandName", "")
        for b in brands
    }

    # Aggregate revenue by (brand, month)
    brand_monthly: dict[str, dict[int, float]] = {}
    for rec in sales_records:
        brand_id = rec.get("brandId", "")
        if brand_id not in brand_monthly:
            brand_monthly[brand_id] = {}
        for entry in rec.get("monthlySales", []):
            m = entry["month"]
            rev = entry.get("revenue", 0.0)
            brand_monthly[brand_id][m] = brand_monthly[brand_id].get(m, 0.0) + rev

    all_months = sorted({m for bm in brand_monthly.values() for m in bm})

    brand_summaries: list[dict[str, Any]] = []
    for brand_id, monthly in brand_monthly.items():
        ytd = sum(monthly.values())
        brand_summaries.append({
            "brand_id": brand_id,
            "brand_name": brand_name_map.get(brand_id, brand_id),
            "revenue_ytd": round(ytd, 2),
            "monthly_revenue": {
                month_label(year, m): round(monthly.get(m, 0.0), 2)
                for m in all_months
            },
        })

    brand_summaries.sort(key=lambda b: b["revenue_ytd"], reverse=True)
    total_ytd = sum(b["revenue_ytd"] for b in brand_summaries)

    # Add share_pct
    for b in brand_summaries:
        b["share_pct"] = round(b["revenue_ytd"] / total_ytd * 100, 1) if total_ytd > 0 else 0.0

    return {
        "year": year,
        "brands": brand_summaries,
        "total_revenue_ytd": round(total_ytd, 2),
        "months": [month_label(year, m) for m in all_months],
    }
