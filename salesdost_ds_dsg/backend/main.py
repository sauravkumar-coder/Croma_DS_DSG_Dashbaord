"""
StoreWise FastAPI backend — MongoDB-backed (v4).

All data (sales + targets) comes from MongoDB.
No file uploads are accepted or required.

Routes:
  GET  /api/health
  GET  /api/data                 — dashboard payload in StoreRecord format (for DataContext)
  GET  /api/dashboard/overview   — aggregated KPIs for current year
  GET  /api/stores               — all stores with YTD revenue + achievement
  GET  /api/stores/rising-stars  — stores with upward revenue trend
  GET  /api/stores/fallen-stars  — stores with downward revenue trend
  GET  /api/stores/journey       — month-over-month revenue per store
  GET  /api/stores/new-bloomers  — new stores showing strong ramp-up growth
  GET  /api/stores/{store_id}    — single-store detail
  GET  /api/analytics/brands     — revenue breakdown by brand
  GET  /api/targets              — target achievement summary (all stores)
  GET  /api/tracker/status       — which months have target+sales data in MongoDB
  GET  /api/tracker/data         — tracker target+sales rows for a specific month
"""

import logging
from calendar import monthrange
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Any, Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from app.core.database import connect_to_mongo, close_mongo as close_client, ensure_indexes
import services.dashboard_service as dashboard_service
import services.store_service as store_service
import services.target_service as target_service
import services.analytics_service as analytics_service
import repositories.sales_repository as sales_repository
import repositories.store_repository as store_repository
import repositories.target_repository as target_repository
from shared.date_utils import MONTH_LABELS

logger = logging.getLogger(__name__)

_effective_year_cache: int | None = None


async def _get_effective_year(requested: int = 0) -> int:
    """
    Return the year to use for queries.

    If a non-zero year is explicitly requested, honour it.
    Otherwise, prefer the current calendar year; fall back to the
    most recent year that actually has SalesRecord data in MongoDB.
    This prevents the "No Data" screen when the database holds data
    from a prior year (e.g. 2025) while the server clock says 2026.
    """
    global _effective_year_cache
    if requested:
        return requested

    current = datetime.now().year
    available = await sales_repository.get_available_years()
    if not available:
        return current
    if current in available:
        return current
    _effective_year_cache = available[-1]   # most recent year with data
    return _effective_year_cache

_MONTH_ORDER = {m.lower(): i for i, m in enumerate(MONTH_LABELS)}


@asynccontextmanager
async def lifespan(app: FastAPI):
    from app.core.config import settings as _cfg

    # Production guard: refuse to start if MongoDB is required but not configured.
    # This prevents silent data-less deployments that are hard to diagnose.
    if (
        _cfg.ENVIRONMENT == "production"
        and not _cfg.USE_MOCK_DATA
        and not _cfg.MONGO_URI
    ):
        raise RuntimeError(
            "FATAL: ENVIRONMENT=production + USE_MOCK_DATA=false requires MONGO_URI. "
            "Set MONGO_URI in your environment variables or backend/.env file."
        )

    await connect_to_mongo()   # gracefully skipped when MONGO_URI is empty
    await ensure_indexes()     # idempotent; skipped when not connected
    yield
    await close_client()


app = FastAPI(title="StoreWise API", version="4.0.0", lifespan=lifespan)

from app.core.config import settings as _settings

_cors_origins = [o.strip() for o in _settings.ALLOWED_ORIGINS.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Helpers ────────────────────────────────────────────────────────────────────


def _sort_months(months: list[str]) -> list[str]:
    def key(m: str) -> tuple[int, int]:
        parts = m.split("-")
        if len(parts) != 2:
            return (9999, 99)
        name, year = parts
        return (int(year) if year.isdigit() else 9999,
                _MONTH_ORDER.get(name.lower(), 99))
    return sorted(months, key=key)


def _parse_month_label(month: str) -> tuple[int, int]:
    """Parse 'Jun-2026' → (2026, 6). Returns (0, 0) on failure."""
    parts = month.strip().split("-")
    if len(parts) != 2:
        return (0, 0)
    name, year_str = parts
    year = int(year_str) if year_str.isdigit() else 0
    month_int = _MONTH_ORDER.get(name.lower(), -1) + 1
    if month_int == 0:
        return (0, 0)
    return (year, month_int)


# ── Health ─────────────────────────────────────────────────────────────────────


@app.get("/api/health")
def health():
    from app.core.config import settings
    return {
        "status": "ok",
        "use_mock_data": settings.USE_MOCK_DATA,
        "mongo_configured": bool(settings.MONGO_URI),
        "environment": settings.ENVIRONMENT,
    }


# ── Dashboard data (compatible StoreRecord format for DataContext) ─────────────


@app.get("/api/data")
async def get_dashboard_data():
    """
    Serve the main dashboard payload from MongoDB.

    Returns data in the StoreRecord / DashboardData shape expected by
    the React DataContext so all existing dashboard tabs work unchanged.

    Data is filtered to the configured BRAND_ID (brand_007 = DSDSG).
    Store identifiers are the storeBrandId codes (e.g. 'A024') from the
    StoreBrand collection, not internal storeId strings.
    """
    from app.core.config import settings as _cfg

    year = await _get_effective_year()
    brand_id = _cfg.BRAND_ID
    from_daily = _cfg.BRAND_USES_DAILY_SALES

    stores_master = await store_repository.get_all_stores()
    revenue_map = await sales_repository.get_monthly_revenue_by_store(year, brand_id, from_daily)
    target_map = await target_repository.get_monthly_targets_by_store(year, brand_id)
    # {internal storeId → storeBrandId business code}
    store_code_map = await store_repository.get_store_code_map(brand_id)

    store_meta: dict[str, dict[str, Any]] = {
        (s.get("_id") or s.get("id", "")): s
        for s in stores_master
    }

    stores: list[dict[str, Any]] = []
    all_months_set: set[str] = set()

    for sid, monthly_rev in revenue_map.items():
        meta = store_meta.get(sid, {})
        monthly_targets = target_map.get(sid, {})
        store_code = store_code_map.get(sid, sid)   # use storeBrandId; fall back to storeId

        monthly_sales: dict[str, float] = {}
        for m_int, rev in monthly_rev.items():
            label = f"{MONTH_LABELS[m_int - 1]}-{year}"
            monthly_sales[label] = round(rev, 2)
            all_months_set.add(label)

        total_target = sum(monthly_targets.values()) if monthly_targets else None

        stores.append({
            "store_id":        store_code,
            "store_name":      meta.get("storeName", ""),
            "state":           meta.get("state", ""),
            "category":        meta.get("storeCategory", ""),
            "monthly_sales":   monthly_sales,
            "target":          round(total_target, 2) if total_target is not None else None,
            "zonal_manager":   "",
            "cluster_manager": "",
        })

    months = _sort_months(list(all_months_set))
    states = sorted({s["state"] for s in stores if s["state"]})
    categories = sorted({s["category"] for s in stores if s["category"]})
    has_targets = any(s["target"] is not None for s in stores)
    no_data = len(stores) == 0

    return {
        "no_data":      no_data,
        "stores":       stores,
        "months":       months,
        "states":       states,
        "categories":   categories,
        "has_targets":  has_targets,
        "target_month": None,
        "warnings":     [],
    }


# ── MongoDB-backed analytics routes ───────────────────────────────────────────
# Static paths MUST be registered before /stores/{store_id}


@app.get("/api/dashboard/overview")
async def get_dashboard_overview(year: int = Query(default=0)):
    """Aggregated KPIs from MongoDB for the given year."""
    year = await _get_effective_year(year)
    return await dashboard_service.get_overview(year)


@app.get("/api/stores")
async def list_stores(year: int = Query(default=0)):
    """All stores with YTD revenue, target achievement, and trend."""
    year = await _get_effective_year(year)
    return await store_service.get_all_stores(year)


@app.get("/api/stores/rising-stars")
async def get_rising_stars(
    year: int = Query(default=0),
    min_months: int = Query(default=3),
):
    """Stores with a consistent upward revenue trend."""
    year = await _get_effective_year(year)
    return await store_service.get_rising_stars(year, min_months)


@app.get("/api/stores/fallen-stars")
async def get_fallen_stars(
    year: int = Query(default=0),
    min_months: int = Query(default=3),
):
    """Stores with a consistent downward revenue trend."""
    year = await _get_effective_year(year)
    return await store_service.get_fallen_stars(year, min_months)


@app.get("/api/stores/journey")
async def get_store_journey(year: int = Query(default=0)):
    """Month-over-month revenue trajectory for every store."""
    year = await _get_effective_year(year)
    return await store_service.get_store_journey(year)


@app.get("/api/stores/new-bloomers")
async def get_new_bloomers(
    year: int = Query(default=0),
    min_months: int = Query(default=3),
):
    """New stores showing strong ramp-up growth."""
    year = await _get_effective_year(year)
    return await analytics_service.get_new_bloomers(year, min_months)


@app.get("/api/analytics/brands")
async def get_brand_analysis(year: int = Query(default=0)):
    """Revenue breakdown by brand across all stores."""
    year = await _get_effective_year(year)
    return await analytics_service.get_brand_analysis(year)


@app.get("/api/targets")
async def get_targets_summary(
    year: int = Query(default=0),
    month: Optional[int] = Query(default=None),
):
    """Target achievement summary for all stores (YTD or single month)."""
    year = await _get_effective_year(year)
    return await target_service.get_targets_summary(year, month)


# ── Tracker routes (MongoDB-backed) ──────────────────────────────────────────


@app.get("/api/tracker/status")
async def get_tracker_status():
    """Return which months have target + sales data in MongoDB."""
    from app.core.config import settings as _cfg

    # Tracker always uses the current calendar year — targets are set for the
    # live year even when SalesRecord data hasn't been uploaded yet.
    year = datetime.now().year
    brand_id = _cfg.BRAND_ID
    from_daily = _cfg.BRAND_USES_DAILY_SALES

    revenue_map = await sales_repository.get_monthly_revenue_by_store(year, brand_id, from_daily)
    target_map = await target_repository.get_monthly_targets_by_store(year, brand_id)

    months_with_sales: set[int] = set()
    for monthly in revenue_map.values():
        months_with_sales.update(monthly.keys())

    months_with_targets: set[int] = set()
    for monthly in target_map.values():
        months_with_targets.update(monthly.keys())

    all_month_ints = sorted(months_with_sales | months_with_targets, reverse=True)

    current_month = datetime.now().month
    active_label: str | None = None
    months_data: list[dict[str, Any]] = []

    for m_int in all_month_ints:
        label = f"{MONTH_LABELS[m_int - 1]}-{year}"
        has_t = m_int in months_with_targets
        has_s = m_int in months_with_sales
        is_active = (m_int == current_month) and has_t and has_s
        if is_active:
            active_label = label
        months_data.append({
            "month":            label,
            "has_target":       has_t,
            "has_sales":        has_s,
            "is_active_target": is_active,
            "target_meta":      None,
            "sales_meta":       None,
        })

    # If no month matches the current calendar month, auto-select the first
    # month that has both target and sales data.
    if not active_label:
        for m in months_data:
            if m["has_target"] and m["has_sales"]:
                active_label = m["month"]
                m["is_active_target"] = True
                break

    return {
        "active_target_month": active_label,
        "months":              months_data,
    }


@app.get("/api/tracker/data")
async def get_tracker_data(month: str):
    """
    Return tracker data (targets + actual monthly sales) for a month from MongoDB.

    Sales rows have day=0 because MongoDB stores monthly aggregates, not
    daily transactions.  The frontend day-slider still works: when all rows
    have day=0 it displays the month total without day-filtering.
    """
    from app.core.config import settings as _cfg

    year, month_int = _parse_month_label(month)
    if year == 0 or month_int == 0:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid month format '{month}'. Expected MMM-YYYY (e.g. Jun-2026).",
        )

    brand_id = _cfg.BRAND_ID
    from_daily = _cfg.BRAND_USES_DAILY_SALES
    target_map = await target_repository.get_monthly_targets_by_store(year, brand_id)
    revenue_map = await sales_repository.get_monthly_revenue_by_store(year, brand_id, from_daily)
    stores_master = await store_repository.get_all_stores()
    store_code_map = await store_repository.get_store_code_map(brand_id)

    store_meta: dict[str, dict[str, Any]] = {
        (s.get("_id") or s.get("id", "")): s
        for s in stores_master
    }

    targets: list[dict[str, Any]] = []
    for sid, monthly_tgt in target_map.items():
        if month_int not in monthly_tgt:
            continue
        meta = store_meta.get(sid, {})
        store_code = store_code_map.get(sid, sid)
        targets.append({
            "store_key":       store_code,
            "store_name":      meta.get("storeName", sid),
            "head_operations": "",
            "zonal_manager":   "",
            "cluster_manager": "",
            "target":          round(monthly_tgt[month_int], 2),
        })

    # Fetch per-day sales breakdown from dailySales when available.
    # For brands with BRAND_USES_DAILY_SALES=true each store has one row per
    # calendar day; for monthly-only brands the dict is empty and we fall back
    # to the single monthly-aggregate row (day=0).
    daily_rev_map = await sales_repository.get_daily_revenue_by_store_for_month(
        year, month_int, brand_id, from_daily
    )

    sales_rows: list[dict[str, Any]] = []
    for sid, monthly_rev in revenue_map.items():
        if month_int not in monthly_rev:
            continue
        meta = store_meta.get(sid, {})
        store_code = store_code_map.get(sid, sid)
        state_val = meta.get("state", "")
        store_name_val = meta.get("storeName", sid)

        daily_entries = daily_rev_map.get(sid, [])
        if daily_entries:
            # One row per calendar day so the frontend can filter by slider day.
            for day, revenue in daily_entries:
                sales_rows.append({
                    "store_name": store_name_val,
                    "store_key":  store_code,
                    "sales":      round(revenue, 2),
                    "day":        day,
                    "state":      state_val,
                })
        else:
            # No daily breakdown available — single monthly aggregate row.
            # Slider will treat this as "always included" via the day=0 fallback
            # in the frontend activeSalesMap logic.
            sales_rows.append({
                "store_name": store_name_val,
                "store_key":  store_code,
                "sales":      round(monthly_rev[month_int], 2),
                "day":        0,
                "state":      state_val,
            })

    # Compute max_elapsed as the latest day that actually has sales data.
    # For current-month brands with daily data this reflects the last loaded
    # day (e.g. Jun 16), not today's calendar day — so the slider never shows
    # days beyond the available data.  Past months always use full month total.
    now = datetime.now()
    if year < now.year or (year == now.year and month_int < now.month):
        _, total_days = monthrange(year, month_int)
        max_elapsed = total_days
    elif year == now.year and month_int == now.month:
        # Prefer the highest day number found in the actual daily data.
        actual_max_day = max(
            (day for entries in daily_rev_map.values() for day, _ in entries),
            default=0,
        )
        max_elapsed = actual_max_day if actual_max_day > 0 else now.day
    else:
        max_elapsed = 0

    # Determine the latest date for which sales data is available.
    latest_sales_date: str | None = None
    if sales_rows:
        latest_sales_date = await sales_repository.get_latest_sales_date_for_month(
            year, month_int, brand_id, from_daily
        )
        if not latest_sales_date and max_elapsed > 0:
            latest_sales_date = f"{year}-{month_int:02d}-{max_elapsed:02d}"

    return {
        "month":                month,
        "has_target":           len(targets) > 0,
        "has_sales":            len(sales_rows) > 0,
        "targets":              targets,
        "raw_target_row_count": len(targets),
        "sales_rows":           sales_rows,
        "max_elapsed":          max_elapsed,
        "detected_month":       month,
        "latest_sales_date":    latest_sales_date,
    }


# ── Single-store detail — MUST come after all static /stores/... paths ─────────


@app.get("/api/stores/{store_id}")
async def get_store_detail(store_id: str, year: int = Query(default=0)):
    """Single-store detail with monthly revenue + target breakdown."""
    year = await _get_effective_year(year)
    detail = await store_service.get_store_detail(store_id, year)
    if detail is None:
        raise HTTPException(status_code=404, detail=f"Store '{store_id}' not found.")
    return detail
