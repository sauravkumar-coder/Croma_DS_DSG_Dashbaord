"""
parser.py — StoreWise XLSX parsing layer.

Domain-specific functions (Sales / Target files):
  parse_sales(filepath)          → list of store dicts with monthly revenue
  parse_croma_sales(filepath)    → list of store dicts from Croma RAW sheet
  parse_vs_sales(filepath)       → list of store dicts from Vijay Sales RAW sheet
  parse_targets(filepath)        → {store_id: target_float}
  get_month_columns(df)          → detect "MMM-YYYY" columns automatically
  validate_store_match(s, t)     → warn on Store_ID mismatches between files

Supports sales formats:
  • Pre-aggregated: Store_ID | Store_Name | State | Category | Jan-2024 | …
  • DS/DSG Transactional: SHIP_NODE | Category | State | Sub Classification |
                           GROSS_AMOUNT | Month (e.g. "Mar-26")
  • Croma RAW: Branch_ Code | Store Branch | State | Category | Plan_Category |
               Amount | Month ("Jan"/"Feb"…) | Date (for year inference)
  • Vijay Sales RAW: Branch | Spoc State Name | Plan_Category |
                     Amount | Month | Date

Supports two target formats:
  • Legacy:   Store_ID | Monthly_Target
  • OW Budget: Store Key | Store Name | … | OOW

Generic functions (used by /api/data and /api/analysis):
  get_sheets / get_sheet_data / analyze_sheet
"""

import logging
import re
from typing import Any

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)

# Matches "Jul-2024", "jan-2025", "DEC-2023", etc. (pre-aggregated column headers)
_MONTH_RE = re.compile(
    r"^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-\d{4}$",
    re.IGNORECASE,
)

# Matches short-year month values: "Mar-26", "Apr-26"
_MONTH_SHORT_RE = re.compile(
    r"^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-(\d{2})$",
    re.IGNORECASE,
)

_MONTH_ORDER = {
    m: i for i, m in enumerate(
        ["jan", "feb", "mar", "apr", "may", "jun",
         "jul", "aug", "sep", "oct", "nov", "dec"]
    )
}

_SALES_EXPECTED = {"Store_ID", "Store_Name", "State", "Category"}
_TARGETS_EXPECTED = {"Store_ID", "Monthly_Target"}

DS_LABEL  = "Device Secure"
DSG_LABEL = "Device Secure Gold"

# ── Croma RAW sheet column names ──────────────────────────────────────────────
CROMA_PRIMARY_LABEL   = "SP"      # Samsung Protect → DS slot
CROMA_SECONDARY_LABEL = "ADLD"   # Accidental/Liquid Damage → DSG slot

# ── Vijay Sales RAW sheet column names ───────────────────────────────────────
VS_PRIMARY_LABEL   = "SP"
VS_SECONDARY_LABEL = "ADLD"

# Month-name → canonical abbreviation (handles mixed capitalisation)
_MONTH_ABBR_NORM: dict[str, str] = {
    "jan": "Jan", "feb": "Feb", "mar": "Mar", "apr": "Apr",
    "may": "May", "jun": "Jun", "jul": "Jul", "aug": "Aug",
    "sep": "Sep", "oct": "Oct", "nov": "Nov", "dec": "Dec",
}

_MONTH_FULL_TO_ABBR: dict[str, str] = {
    "january": "Jan", "february": "Feb", "march": "Mar", "april": "Apr",
    "may": "May", "june": "Jun", "july": "Jul", "august": "Aug",
    "september": "Sep", "october": "Oct", "november": "Nov", "december": "Dec",
}


def detect_month_from_filename(filename: str) -> str | None:
    """Return 'MMM-YYYY' if the filename contains a recognisable month + 4-digit year.

    Example: 'OW Budget June 2026 store wise.xlsx' → 'Jun-2026'
    """
    lower = filename.lower()
    year_match = re.search(r"20\d{2}", lower)
    if not year_match:
        return None
    year = year_match.group()
    for full, abbr in _MONTH_FULL_TO_ABBR.items():
        if full in lower:
            return f"{abbr}-{year}"
    return None


def _normalise_month(m: str) -> str:
    """Convert 'Mar-26' → 'Mar-2026'. Full-year 'Mar-2026' is returned as-is."""
    m = str(m).strip()
    match = _MONTH_SHORT_RE.match(m)
    if match:
        name, yy = match.group(1), match.group(2)
        # Assume 20xx for 2-digit years
        return f"{name.capitalize()}-20{yy}"
    return m


# ── Domain-specific ────────────────────────────────────────────────────────────


def get_month_columns(df: pd.DataFrame) -> list[str]:
    """Return column names that match the 'MMM-YYYY' pattern, preserving order."""
    return [col for col in df.columns if _MONTH_RE.match(str(col))]


def validate_store_match(
    sales_df: pd.DataFrame, target_df: pd.DataFrame
) -> list[str]:
    """Compare Store_ID sets across two DataFrames.

    Returns a (possibly empty) list of human-readable warning strings.
    Handles both legacy (Store_ID) and transactional (SHIP_NODE / Store Key) formats.
    """
    warnings: list[str] = []

    # Sales: try Store_ID first, then SHIP_NODE (transactional format)
    s_col = _find_col(sales_df, "store_id") or _find_col(sales_df, "ship_node")
    # Target: try Store_ID first, then Store Key (OW Budget format)
    t_col = _find_col(target_df, "store_id") or _find_col(target_df, "store key")

    if s_col is None:
        logger.info("validate_store_match: no store ID column found in sales — skipping validation.")
        return []
    if t_col is None:
        logger.info("validate_store_match: no store ID column found in targets — skipping validation.")
        return []

    sales_ids = set(sales_df[s_col].dropna().astype(str).str.strip())
    target_ids = set(target_df[t_col].dropna().astype(str).str.strip())

    only_sales = sales_ids - target_ids
    only_targets = target_ids - sales_ids

    if only_sales:
        sample = ", ".join(sorted(only_sales)[:10])
        suffix = "…" if len(only_sales) > 10 else ""
        w = f"{len(only_sales)} store(s) in sales but not in targets: {sample}{suffix}"
        warnings.append(w)
        logger.warning(w)

    if only_targets:
        sample = ", ".join(sorted(only_targets)[:10])
        suffix = "…" if len(only_targets) > 10 else ""
        w = f"{len(only_targets)} store(s) in targets but not in sales: {sample}{suffix}"
        warnings.append(w)
        logger.warning(w)

    if not warnings:
        logger.info("Store ID validation passed — all IDs match across both files.")

    return warnings


def _is_transactional(df: pd.DataFrame) -> bool:
    """True when the file is transaction-level DSG/DS data (SHIP_NODE / GROSS_AMOUNT)."""
    cols = {c.strip().lower() for c in df.columns}
    return "ship_node" in cols or (
        "sub classification" in cols and "gross_amount" in cols
    )


def _is_ow_target_format(df: pd.DataFrame) -> bool:
    """True when the file is the OW Budget format (Store Key + a target-like column)."""
    cols = {c.strip().lower() for c in df.columns}
    has_key = "store key" in cols
    has_target = any(
        t in col
        for col in cols
        for t in ("oow", "sales target", "store target", "monthly target")
    )
    return has_key and has_target


def _sort_months_list(months: list[str]) -> list[str]:
    def _key(m: str) -> tuple[int, int]:
        parts = m.split("-")
        if len(parts) != 2:
            return (9999, 99)
        name, year = parts
        return (int(year) if year.isdigit() else 9999,
                _MONTH_ORDER.get(name.lower(), 99))
    return sorted(months, key=_key)


def _parse_transactional(df: pd.DataFrame) -> list[dict[str, Any]]:
    """Parse transaction-level DSG/DS sales into per-store aggregated records.

    Input columns (case-insensitive):
      SHIP_NODE        → store_id
      Category         → store tier (A+/A/B/C/D)
      State            → state
      Sub Classification → "Device Secure" (DS) or "Device Secure Gold" (DSG)
      GROSS_AMOUNT     → sale value
      Month            → "Mar-26" style (normalised to "Mar-2026")

    Returns one dict per store:
      {
        store_id, store_name, state, category,
        monthly_sales:     {month: DS+DSG total},
        monthly_sales_ds:  {month: DS only},
        monthly_sales_dsg: {month: DSG only},
        total_sales: float,
      }
    """
    c_store = _find_col(df, "ship_node") or _find_col(df, "store_id")
    c_sub   = _find_col(df, "sub classification")
    c_amt   = _find_col(df, "gross_amount")
    c_month = _find_col(df, "month")
    c_state = _find_col(df, "state")
    c_cat   = _find_col(df, "category")

    if not all([c_store, c_sub, c_amt, c_month]):
        raise ValueError(
            "Transactional file missing required columns "
            "(SHIP_NODE, Sub Classification, GROSS_AMOUNT, Month)"
        )

    df = df.copy()
    df[c_amt]   = pd.to_numeric(df[c_amt], errors="coerce").fillna(0)
    df[c_store] = df[c_store].astype(str).str.strip()
    df[c_month] = df[c_month].astype(str).str.strip().apply(_normalise_month)
    df[c_sub]   = df[c_sub].astype(str).str.strip()

    # Collect per-store metadata (take first occurrence)
    meta: dict[str, dict] = {}
    for _, row in df.iterrows():
        sid = str(row[c_store])
        if sid not in meta:
            meta[sid] = {
                "state":    _str(row, c_state),
                "category": _clean_category(_str(row, c_cat)),
            }

    # Aggregate: sum GROSS_AMOUNT by (store, month, sub_classification)
    grp = (
        df.groupby([c_store, c_month, c_sub], observed=True)[c_amt]
        .sum()
        .reset_index()
    )

    # Count transactions (plan count) by (store, month, sub_classification)
    grp_cnt = (
        df.groupby([c_store, c_month, c_sub], observed=True)
        .size()
        .reset_index(name="_cnt")
    )

    # Build per-store dicts
    store_data: dict[str, dict] = {}
    for _, row in grp.iterrows():
        sid   = str(row[c_store])
        month = str(row[c_month])
        sub   = str(row[c_sub])
        amt   = float(row[c_amt])

        if sid not in store_data:
            store_data[sid] = {"ds": {}, "dsg": {}, "plans": {}}

        if sub == DS_LABEL:
            store_data[sid]["ds"][month]  = store_data[sid]["ds"].get(month, 0) + amt
        elif sub == DSG_LABEL:
            store_data[sid]["dsg"][month] = store_data[sid]["dsg"].get(month, 0) + amt
        else:
            # Unknown sub-classification — count in DS bucket
            store_data[sid]["ds"][month]  = store_data[sid]["ds"].get(month, 0) + amt

    # Accumulate plan counts per store per month (all sub-classifications combined)
    for _, row in grp_cnt.iterrows():
        sid   = str(row[c_store])
        month = str(row[c_month])
        cnt   = int(row["_cnt"])
        if sid not in store_data:
            store_data[sid] = {"ds": {}, "dsg": {}, "plans": {}}
        store_data[sid]["plans"][month] = store_data[sid]["plans"].get(month, 0) + cnt

    # Gather all months so every store has the same keys
    all_months = _sort_months_list(
        list({m for d in store_data.values() for m in list(d["ds"]) + list(d["dsg"])})
    )

    records: list[dict[str, Any]] = []
    for sid, buckets in store_data.items():
        ds_monthly    = {m: buckets["ds"].get(m, 0.0)  for m in all_months}
        dsg_monthly   = {m: buckets["dsg"].get(m, 0.0) for m in all_months}
        total_monthly = {m: ds_monthly[m] + dsg_monthly[m] for m in all_months}
        plans_monthly = {m: buckets.get("plans", {}).get(m, 0) for m in all_months}

        records.append({
            "store_id":              sid,
            "store_name":            "",  # filled from targets file if available
            "state":                 meta.get(sid, {}).get("state", ""),
            "category":              meta.get(sid, {}).get("category", ""),
            "monthly_sales":         total_monthly,
            "monthly_sales_ds":      ds_monthly,
            "monthly_sales_dsg":     dsg_monthly,
            "monthly_plans_count":   plans_monthly,
            "total_sales":           round(sum(total_monthly.values()), 2),
        })

    return records


# ── Short-month year inference ────────────────────────────────────────────────

def _infer_month_year(month_val: Any, date_val: Any) -> str | None:
    """Convert a short month name ('Jan') + a date value to 'Jan-2026'.
    Also correctly handles datetime objects and full month names.

    Extracts the 4-digit year from date_val (datetime object or string like
    '2026-01-01').  Falls back to current year if parsing fails.
    """
    if pd.isna(month_val):
        return None
        
    # 1. If month_val is a datetime object, use it directly
    if hasattr(month_val, "strftime"):
        return month_val.strftime("%b-%Y")
        
    # 2. Try parsing month_val with pandas (in case it's '2026-05-26')
    s_val = str(month_val).strip()
    if re.search(r"20\d{2}", s_val):
        parsed = pd.to_datetime(s_val, errors="coerce")
        if not pd.isna(parsed):
            return parsed.strftime("%b-%Y")

    # 3. Handle 'Jan' or 'January' + inferring year from date_val
    lower_s = s_val.lower()
    abbr = _MONTH_ABBR_NORM.get(lower_s) or _MONTH_FULL_TO_ABBR.get(lower_s)
    if not abbr:
        return None
        
    year: int | None = None
    try:
        if hasattr(date_val, "year"):
            year = int(date_val.year)
        else:
            m = re.search(r"(20\d{2})", str(date_val))
            if m:
                year = int(m.group(1))
    except Exception:
        pass
    if year is None:
        from datetime import datetime
        year = datetime.now().year
    return f"{abbr}-{year}"


# ── Croma RAW parser ──────────────────────────────────────────────────────────

def _is_croma_format(df: pd.DataFrame) -> bool:
    cols = {c.strip().lower() for c in df.columns}
    return "branch_ code" in cols and "store branch" in cols and "plan_category" in cols


def _parse_croma(df: pd.DataFrame) -> list[dict[str, Any]]:
    """Parse Croma RAW sheet → StoreRecord-compatible dicts.

    Branch_ Code  → store_id
    Store Branch  → store_name
    State         → state (first State column)
    Category      → category  (A+ / A / B / C / D)
    Plan_Category → SP (primary/DS bucket) or ADLD/Combo (secondary/DSG bucket)
    Amount        → sale value
    Month         → 'Jan','Feb',… (year inferred from Date column)
    Quantity / Samsung Qty / Main Qty → Samsung main-unit volume (for attach %)
    """
    c_id   = _find_col(df, "branch_ code")
    c_name = _find_col(df, "store branch")
    c_state: str | None = None
    for col in df.columns:
        if str(col).strip().lower() == "state":
            c_state = col
            break
    c_cat   = _find_col(df, "device category") or _find_col(df, "category")
    c_plan  = _find_col(df, "plan_category")
    c_amt   = _find_col(df, "amount")
    c_month = _find_col(df, "month")
    c_date  = _find_col(df, "date")
    # Main quantity — try several common column names
    c_qty = (
        _find_col(df, "main qty")
        or _find_col(df, "main_qty")
        or _find_col(df, "samsung qty")
        or _find_col(df, "samsung_qty")
        or _find_col(df, "quantity")
        or _find_col(df, "qty")
    )

    if not all([c_id, c_plan, c_amt, c_month]):
        raise ValueError("Croma file missing required columns (Branch_ Code, Plan_Category, Amount, Month)")

    df = df.copy()
    df[c_amt]   = pd.to_numeric(df[c_amt], errors="coerce").fillna(0)
    df[c_id]    = df[c_id].astype(str).str.strip()
    df[c_month] = df[c_month].astype(str).str.strip()
    df[c_plan]  = df[c_plan].astype(str).str.strip()
    if c_qty:
        df[c_qty] = pd.to_numeric(df[c_qty], errors="coerce").fillna(0)

    meta: dict[str, dict] = {}
    for _, row in df.iterrows():
        sid = str(row[c_id])
        if sid not in meta:
            meta[sid] = {
                "store_name": _str(row, c_name),
                "state":      _str(row, c_state),
                "category":   _clean_category(_str(row, c_cat)),
            }

    def resolve_month(row: "pd.Series[Any]") -> str:
        result = _infer_month_year(str(row[c_month]), row[c_date] if c_date else None)
        return result or str(row[c_month])

    df["_month_label"] = df.apply(resolve_month, axis=1)

    grp = df.groupby([c_id, "_month_label", c_plan], observed=True)[c_amt].sum().reset_index()
    grp_cnt = df.groupby([c_id, "_month_label", c_plan], observed=True).size().reset_index(name="_cnt")

    # Aggregate main quantity per (store, month) — take max across rows since it's
    # typically a repeated store-level value for each plan row in the same month
    main_qty_map: dict[tuple[str, str], float] = {}
    if c_qty:
        grp_qty = df.groupby([c_id, "_month_label"], observed=True)[c_qty].max().reset_index()
        for _, row in grp_qty.iterrows():
            main_qty_map[(str(row[c_id]), str(row["_month_label"]))] = float(row[c_qty])

    store_data: dict[str, dict] = {}
    for _, row in grp.iterrows():
        sid, month, plan, amt = str(row[c_id]), str(row["_month_label"]), str(row[c_plan]), float(row[c_amt])
        if sid not in store_data:
            store_data[sid] = {"primary": {}, "secondary": {}, "plans": {}}
        if plan == CROMA_PRIMARY_LABEL:
            store_data[sid]["primary"][month]   = store_data[sid]["primary"].get(month, 0) + amt
        else:
            store_data[sid]["secondary"][month] = store_data[sid]["secondary"].get(month, 0) + amt

    for _, row in grp_cnt.iterrows():
        sid, month, cnt = str(row[c_id]), str(row["_month_label"]), int(row["_cnt"])
        if sid not in store_data:
            store_data[sid] = {"primary": {}, "secondary": {}, "plans": {}}
        store_data[sid]["plans"][month] = store_data[sid]["plans"].get(month, 0) + cnt

    all_months = _sort_months_list(
        list({m for d in store_data.values() for m in list(d["primary"]) + list(d["secondary"])})
    )

    records: list[dict[str, Any]] = []
    for sid, buckets in store_data.items():
        primary_m   = {m: buckets["primary"].get(m, 0.0)   for m in all_months}
        secondary_m = {m: buckets["secondary"].get(m, 0.0) for m in all_months}
        total_m     = {m: primary_m[m] + secondary_m[m]    for m in all_months}
        plans_m     = {m: buckets.get("plans", {}).get(m, 0) for m in all_months}
        main_qty_m  = {m: main_qty_map.get((sid, m), 0.0)  for m in all_months}
        attach_pct_m = {
            m: round(plans_m[m] / main_qty_m[m], 6) if main_qty_m.get(m, 0) > 0 else 0.0
            for m in all_months
        }
        m_info      = meta.get(sid, {})
        records.append({
            "store_id":              sid,
            "store_name":            m_info.get("store_name", ""),
            "state":                 m_info.get("state", ""),
            "category":              m_info.get("category", ""),
            "monthly_sales":         total_m,
            "monthly_sales_ds":      primary_m,
            "monthly_sales_dsg":     secondary_m,
            "monthly_plans_count":   plans_m,
            "monthly_main_qty":      main_qty_m,
            "monthly_attach_pct":    attach_pct_m,
            "total_sales":           round(sum(total_m.values()), 2),
        })
    return records


def parse_croma_sales(filepath: str) -> list[dict[str, Any]]:
    """Parse a Croma XLSX file (reads RAW sheet automatically)."""
    try:
        df = pd.read_excel(filepath, sheet_name="RAW")
    except Exception:
        df = pd.read_excel(filepath)
    return _parse_croma(_strip_column_names(df))


# ── Vijay Sales RAW parser ────────────────────────────────────────────────────

def _is_vs_format(df: pd.DataFrame) -> bool:
    cols = {c.strip().lower() for c in df.columns}
    return "spoc state name" in cols and "branch" in cols and "plan_category" in cols


def _parse_vijaysales(df: pd.DataFrame) -> list[dict[str, Any]]:
    """Parse Vijay Sales RAW sheet → StoreRecord-compatible dicts.

    Branch          → store_id AND store_name
    Spoc State Name → state
    Plan_Category   → SP (primary) or ADLD/Combo/EW (secondary)
    Amount          → sale value
    Month           → 'Jan','Feb',… (year inferred from Date)
    Quantity / Samsung Qty / Main Qty → Samsung main-unit volume (for attach %)
    """
    c_id    = _find_col(df, "branch")
    c_state = _find_col(df, "spoc state name")
    c_cat   = _find_col(df, "device category") or _find_col(df, "category")
    c_plan  = _find_col(df, "plan_category")
    c_amt   = _find_col(df, "amount")
    c_month = _find_col(df, "month")
    c_date  = _find_col(df, "date")
    # Main quantity — try several common column names
    c_qty = (
        _find_col(df, "main qty")
        or _find_col(df, "main_qty")
        or _find_col(df, "samsung qty")
        or _find_col(df, "samsung_qty")
        or _find_col(df, "quantity")
        or _find_col(df, "qty")
    )

    if not all([c_id, c_plan, c_amt, c_month]):
        raise ValueError("Vijay Sales file missing required columns (Branch, Plan_Category, Amount, Month)")

    df = df.copy()
    df[c_amt]   = pd.to_numeric(df[c_amt], errors="coerce").fillna(0)
    df[c_id]    = df[c_id].astype(str).str.strip()
    df[c_month] = df[c_month].astype(str).str.strip()
    df[c_plan]  = df[c_plan].astype(str).str.strip()
    if c_qty:
        df[c_qty] = pd.to_numeric(df[c_qty], errors="coerce").fillna(0)

    meta: dict[str, dict] = {}
    for _, row in df.iterrows():
        sid = str(row[c_id])
        if sid not in meta:
            meta[sid] = {
                "store_name": _str(row, c_id),
                "state":      _str(row, c_state),
                "category":   _clean_category(_str(row, c_cat)),
            }

    def resolve_month(row: "pd.Series[Any]") -> str:
        result = _infer_month_year(str(row[c_month]), row[c_date] if c_date else None)
        return result or str(row[c_month])

    df["_month_label"] = df.apply(resolve_month, axis=1)

    grp = df.groupby([c_id, "_month_label", c_plan], observed=True)[c_amt].sum().reset_index()
    grp_cnt = df.groupby([c_id, "_month_label", c_plan], observed=True).size().reset_index(name="_cnt")

    # Aggregate main quantity per (store, month)
    main_qty_map: dict[tuple[str, str], float] = {}
    if c_qty:
        grp_qty = df.groupby([c_id, "_month_label"], observed=True)[c_qty].max().reset_index()
        for _, row in grp_qty.iterrows():
            main_qty_map[(str(row[c_id]), str(row["_month_label"]))] = float(row[c_qty])

    store_data: dict[str, dict] = {}
    for _, row in grp.iterrows():
        sid, month, plan, amt = str(row[c_id]), str(row["_month_label"]), str(row[c_plan]), float(row[c_amt])
        if sid not in store_data:
            store_data[sid] = {"primary": {}, "secondary": {}, "plans": {}}
        if plan == VS_PRIMARY_LABEL:
            store_data[sid]["primary"][month]   = store_data[sid]["primary"].get(month, 0) + amt
        else:
            store_data[sid]["secondary"][month] = store_data[sid]["secondary"].get(month, 0) + amt

    for _, row in grp_cnt.iterrows():
        sid, month, cnt = str(row[c_id]), str(row["_month_label"]), int(row["_cnt"])
        if sid not in store_data:
            store_data[sid] = {"primary": {}, "secondary": {}, "plans": {}}
        store_data[sid]["plans"][month] = store_data[sid]["plans"].get(month, 0) + cnt

    all_months = _sort_months_list(
        list({m for d in store_data.values() for m in list(d["primary"]) + list(d["secondary"])})
    )

    records: list[dict[str, Any]] = []
    for sid, buckets in store_data.items():
        primary_m   = {m: buckets["primary"].get(m, 0.0)   for m in all_months}
        secondary_m = {m: buckets["secondary"].get(m, 0.0) for m in all_months}
        total_m     = {m: primary_m[m] + secondary_m[m]    for m in all_months}
        plans_m     = {m: buckets.get("plans", {}).get(m, 0) for m in all_months}
        main_qty_m  = {m: main_qty_map.get((sid, m), 0.0)  for m in all_months}
        attach_pct_m = {
            m: round(plans_m[m] / main_qty_m[m], 6) if main_qty_m.get(m, 0) > 0 else 0.0
            for m in all_months
        }
        m_info      = meta.get(sid, {})
        records.append({
            "store_id":              sid,
            "store_name":            m_info.get("store_name", sid),
            "state":                 m_info.get("state", ""),
            "category":              m_info.get("category", ""),
            "monthly_sales":         total_m,
            "monthly_sales_ds":      primary_m,
            "monthly_sales_dsg":     secondary_m,
            "monthly_plans_count":   plans_m,
            "monthly_main_qty":      main_qty_m,
            "monthly_attach_pct":    attach_pct_m,
            "total_sales":           round(sum(total_m.values()), 2),
        })
    return records


def parse_vs_sales(filepath: str) -> list[dict[str, Any]]:
    """Parse a Vijay Sales XLSX file (reads RAW sheet automatically)."""
    try:
        df = pd.read_excel(filepath, sheet_name="RAW")
    except Exception:
        df = pd.read_excel(filepath)
    return _parse_vijaysales(_strip_column_names(df))


# ── Reliance RAW parser ────────────────────────────────────────────────────────

def _is_reliance_format(df: pd.DataFrame) -> bool:
    cols = {c.strip().lower() for c in df.columns}
    return "store no" in cols and "plan selling price" in cols

def _parse_reliance(df: pd.DataFrame) -> list[dict[str, Any]]:
    c_id    = _find_col(df, "store no")
    c_name  = _find_col(df, "store name")
    c_state = _find_col(df, "state")
    c_cat   = _find_col(df, "device category") or _find_col(df, "category")
    c_plan  = _find_col(df, "plan type")
    c_amt   = _find_col(df, "plan selling price")
    c_month = _find_col(df, "transaction date")

    if not all([c_id, c_plan, c_amt, c_month]):
        raise ValueError("Reliance file missing required columns (Store No, Plan Type, Plan Selling Price, Transaction Date)")

    df = df.copy()
    df[c_amt]   = pd.to_numeric(df[c_amt], errors="coerce").fillna(0)
    df[c_id]    = df[c_id].astype(str).str.strip()
    df[c_plan]  = df[c_plan].astype(str).str.strip()

    meta: dict[str, dict] = {}
    for _, row in df.iterrows():
        sid = str(row[c_id])
        if sid not in meta:
            meta[sid] = {
                "store_name": _str(row, c_name),
                "state":      _str(row, c_state),
                "category":   _clean_category(_str(row, c_cat)),
            }

    def resolve_month(row: "pd.Series[Any]") -> str:
        d = row[c_month]
        if pd.isna(d):
            return "Unknown"
        try:
            if hasattr(d, "strftime"):
                return d.strftime("%b-%Y")
            else:
                parsed = pd.to_datetime(d, errors="coerce")
                if not pd.isna(parsed):
                    return parsed.strftime("%b-%Y")
        except Exception:
            pass
        return str(d)

    df["_month_label"] = df.apply(resolve_month, axis=1)

    grp = df.groupby([c_id, "_month_label", c_plan], observed=True)[c_amt].sum().reset_index()
    grp_cnt = df.groupby([c_id, "_month_label", c_plan], observed=True).size().reset_index(name="_cnt")

    store_data: dict[str, dict] = {}
    for _, row in grp.iterrows():
        sid, month, plan, amt = str(row[c_id]), str(row["_month_label"]), str(row[c_plan]), float(row[c_amt])
        if sid not in store_data:
            store_data[sid] = {"primary": {}, "secondary": {}, "plans": {}}
        if "SP" in plan.upper() or ("PROTECT" in plan.upper() and "ADLD" not in plan.upper() and "COMBO" not in plan.upper()):
            store_data[sid]["primary"][month]   = store_data[sid]["primary"].get(month, 0) + amt
        else:
            store_data[sid]["secondary"][month] = store_data[sid]["secondary"].get(month, 0) + amt

    for _, row in grp_cnt.iterrows():
        sid, month, cnt = str(row[c_id]), str(row["_month_label"]), int(row["_cnt"])
        if sid not in store_data:
            store_data[sid] = {"primary": {}, "secondary": {}, "plans": {}}
        store_data[sid]["plans"][month] = store_data[sid]["plans"].get(month, 0) + cnt

    all_months = _sort_months_list(
        list({m for d in store_data.values() for m in list(d["primary"]) + list(d["secondary"])})
    )

    records: list[dict[str, Any]] = []
    for sid, buckets in store_data.items():
        primary_m   = {m: buckets["primary"].get(m, 0.0)   for m in all_months}
        secondary_m = {m: buckets["secondary"].get(m, 0.0) for m in all_months}
        total_m     = {m: primary_m[m] + secondary_m[m]    for m in all_months}
        plans_m     = {m: buckets.get("plans", {}).get(m, 0) for m in all_months}
        m_info      = meta.get(sid, {})
        records.append({
            "store_id":            sid,
            "store_name":          m_info.get("store_name", sid),
            "state":               m_info.get("state", ""),
            "category":            m_info.get("category", ""),
            "monthly_sales":       total_m,
            "monthly_sales_ds":    primary_m,
            "monthly_sales_dsg":   secondary_m,
            "monthly_plans_count": plans_m,
            "total_sales":         round(sum(total_m.values()), 2),
        })
    return records


def parse_reliance_sales(filepath: str) -> list[dict[str, Any]]:
    """Parse a Reliance XLSX file."""
    try:
        df = pd.read_excel(filepath, sheet_name="RAW")
    except Exception:
        df = pd.read_excel(filepath)
    return _parse_reliance(_strip_column_names(df))


# ── Hotspot RAW parser ────────────────────────────────────────────────────────

def _is_hotspot_format(df: pd.DataFrame) -> bool:
    cols = {c.strip().lower() for c in df.columns}
    return "plan premium" in cols and "store code" in cols

def _parse_hotspot(df: pd.DataFrame) -> list[dict[str, Any]]:
    c_id    = _find_col(df, "store code") or _find_col(df, "store id")
    c_name  = _find_col(df, "store name")
    c_state = _find_col(df, "region")
    c_cat   = _find_col(df, "device category") or _find_col(df, "category")
    c_plan  = _find_col(df, "category") or _find_col(df, "plan name")
    c_amt   = _find_col(df, "plan premium") or _find_col(df, "retailer premium")
    c_month = _find_col(df, "plan purchase date") or _find_col(df, "device purchase date")

    if not all([c_id, c_plan, c_amt, c_month]):
        raise ValueError("Hotspot file missing required columns")

    df = df.copy()
    df[c_amt]   = pd.to_numeric(df[c_amt], errors="coerce").fillna(0)
    df[c_id]    = df[c_id].astype(str).str.strip()
    df[c_plan]  = df[c_plan].astype(str).str.strip()

    meta: dict[str, dict] = {}
    for _, row in df.iterrows():
        sid = str(row[c_id])
        if sid not in meta:
            meta[sid] = {
                "store_name": _str(row, c_name),
                "state":      _str(row, c_state),
                "category":   _clean_category(_str(row, c_cat)),
            }

    def resolve_month(row: "pd.Series[Any]") -> str:
        d = row[c_month]
        if pd.isna(d):
            return "Unknown"
        try:
            if hasattr(d, "strftime"):
                return d.strftime("%b-%Y")
            else:
                parsed = pd.to_datetime(d, errors="coerce")
                if not pd.isna(parsed):
                    return parsed.strftime("%b-%Y")
        except Exception:
            pass
        return str(d)

    df["_month_label"] = df.apply(resolve_month, axis=1)

    grp = df.groupby([c_id, "_month_label", c_plan], observed=True)[c_amt].sum().reset_index()
    grp_cnt = df.groupby([c_id, "_month_label", c_plan], observed=True).size().reset_index(name="_cnt")

    store_data: dict[str, dict] = {}
    for _, row in grp.iterrows():
        sid, month, plan, amt = str(row[c_id]), str(row["_month_label"]), str(row[c_plan]), float(row[c_amt])
        if sid not in store_data:
            store_data[sid] = {"primary": {}, "secondary": {}, "plans": {}}
        
        # SP in category name
        if "SP" in plan.upper() and "ADLD" not in plan.upper():
            store_data[sid]["primary"][month]   = store_data[sid]["primary"].get(month, 0) + amt
        else:
            store_data[sid]["secondary"][month] = store_data[sid]["secondary"].get(month, 0) + amt

    for _, row in grp_cnt.iterrows():
        sid, month, cnt = str(row[c_id]), str(row["_month_label"]), int(row["_cnt"])
        if sid not in store_data:
            store_data[sid] = {"primary": {}, "secondary": {}, "plans": {}}
        store_data[sid]["plans"][month] = store_data[sid]["plans"].get(month, 0) + cnt

    all_months = _sort_months_list(
        list({m for d in store_data.values() for m in list(d["primary"]) + list(d["secondary"])})
    )

    records: list[dict[str, Any]] = []
    for sid, buckets in store_data.items():
        primary_m   = {m: buckets["primary"].get(m, 0.0)   for m in all_months}
        secondary_m = {m: buckets["secondary"].get(m, 0.0) for m in all_months}
        total_m     = {m: primary_m[m] + secondary_m[m]    for m in all_months}
        plans_m     = {m: buckets.get("plans", {}).get(m, 0) for m in all_months}
        m_info      = meta.get(sid, {})
        records.append({
            "store_id":            sid,
            "store_name":          m_info.get("store_name", sid),
            "state":               m_info.get("state", ""),
            "category":            m_info.get("category", ""),
            "monthly_sales":       total_m,
            "monthly_sales_ds":    primary_m,
            "monthly_sales_dsg":   secondary_m,
            "monthly_plans_count": plans_m,
            "total_sales":         round(sum(total_m.values()), 2),
        })
    return records


def parse_hotspot_sales(filepath: str) -> list[dict[str, Any]]:
    """Parse a Hotspot XLSX file."""
    try:
        df = pd.read_excel(filepath, sheet_name="RAW")
    except Exception:
        df = pd.read_excel(filepath)
    return _parse_hotspot(_strip_column_names(df))


def parse_sales(filepath: str) -> list[dict[str, Any]]:
    """Parse a Sales XLSX file — handles both pre-aggregated and transactional formats.

    Pre-aggregated format (legacy):
      Store_ID | Store_Name | State | Category | Jan-2024 | …

    Transactional format (DSG/DS):
      SHIP_NODE | Category | State | Sub Classification | GROSS_AMOUNT | Month

    Returns a list of store dicts. Transactional records include
    monthly_sales_ds and monthly_sales_dsg in addition to monthly_sales.
    """
    df = pd.read_excel(filepath)
    df = _strip_column_names(df)

    if _is_transactional(df):
        logger.info("Detected transactional sales format in: %s", filepath)
        return _parse_transactional(df)

    # ── Pre-aggregated (legacy) path ──────────────────────────────────────────
    _warn_missing_cols(df, _SALES_EXPECTED, filepath)

    month_cols = get_month_columns(df)
    if not month_cols:
        logger.warning("No month columns (MMM-YYYY) detected in: %s", filepath)

    for col in month_cols:
        df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)

    c_id   = _find_col(df, "store_id")
    c_name = _find_col(df, "store_name")
    c_state = _find_col(df, "state")
    c_cat   = _find_col(df, "category")

    records: list[dict[str, Any]] = []
    skipped = 0

    for _, row in df.iterrows():
        raw_id = str(row[c_id]).strip() if c_id else ""
        if not raw_id or raw_id.lower() == "nan":
            skipped += 1
            continue

        monthly: dict[str, float] = {col: float(row[col]) for col in month_cols}
        records.append({
            "store_id":         raw_id,
            "store_name":       _str(row, c_name),
            "state":            _str(row, c_state),
            "category":         _clean_category(_str(row, c_cat)),
            "monthly_sales":    monthly,
            "monthly_sales_ds": {},
            "monthly_sales_dsg": {},
            "total_sales":      round(sum(monthly.values()), 2),
        })

    if skipped:
        logger.warning("Skipped %d row(s) with blank Store_ID in: %s", skipped, filepath)

    return records


def parse_targets(filepath: str) -> dict[str, dict]:
    """Parse a Targets XLSX file — handles both legacy and OW Budget formats.

    Legacy format:
      Store_ID | Monthly_Target

    OW Budget format:
      Store Key | Store Name | Head - Operations | Zonal Manager | Cluster Manager | OOW

    Returns {store_id: {"target": float, "store_name": str, "zonal_manager": str, "cluster_manager": str}}.
    """
    df = pd.read_excel(filepath)
    df = _strip_column_names(df)

    if _is_ow_target_format(df):
        logger.info("Detected OW Budget target format in: %s", filepath)
        return _parse_ow_targets(df)

    # ── Legacy format ─────────────────────────────────────────────────────────
    _warn_missing_cols(df, _TARGETS_EXPECTED, filepath)

    c_id     = _find_col(df, "store_id")
    c_target = _find_col(df, "monthly_target")

    if c_id is None:
        logger.error("Store_ID column not found in targets file: %s", filepath)
        return {}

    if c_target is not None:
        df[c_target] = pd.to_numeric(df[c_target], errors="coerce").fillna(0)

    df = df[df[c_id].notna()].copy()
    df[c_id] = df[c_id].astype(str).str.strip()
    df = df[df[c_id].str.lower() != "nan"]

    dupes = df[df.duplicated(subset=[c_id], keep=False)][c_id].unique()
    if len(dupes):
        logger.warning("Duplicate Store_IDs in targets (last row kept): %s", list(dupes)[:10])

    result: dict[str, dict] = {}
    for _, row in df.iterrows():
        sid = str(row[c_id])
        result[sid] = {
            "target":          float(row[c_target]) if c_target else 0.0,
            "store_name":      "",
            "zonal_manager":   "",
            "cluster_manager": "",
        }
    return result


def _parse_ow_targets(df: pd.DataFrame) -> dict[str, dict]:
    """Parse OW Budget format: Store Key | Store Name | … | OOW / Sales Target."""
    c_id   = _find_col(df, "store key")
    c_name = _find_col(df, "store name")
    c_zm   = _find_col(df, "zonal manager")
    c_cm   = _find_col(df, "cluster manager")

    # Accept multiple column names for the target value
    c_oow = (
        _find_col(df, "oow")
        or _find_col(df, "sales target")
        or _find_col(df, "store target")
        or _find_col(df, "monthly target")
    )

    if c_id is None or c_oow is None:
        raise ValueError(
            "OW Budget file must have 'Store Key' and a target column "
            "(OOW / Sales Target / Store Target / Monthly Target)."
        )

    df = df[df[c_id].notna()].copy()
    df[c_id]  = df[c_id].astype(str).str.strip()
    df[c_oow] = pd.to_numeric(df[c_oow], errors="coerce").fillna(0)
    df = df[df[c_id].str.lower() != "nan"]

    result: dict[str, dict] = {}
    for _, row in df.iterrows():
        sid = str(row[c_id])
        result[sid] = {
            "target":          float(row[c_oow]),
            "store_name":      _str(row, c_name),
            "zonal_manager":   _str(row, c_zm),
            "cluster_manager": _str(row, c_cm),
        }
    return result


# ── Generic (used by /api/data and /api/analysis) ─────────────────────────────


def get_sheets(file_path: str) -> list[str]:
    xl = pd.ExcelFile(file_path)
    return xl.sheet_names  # type: ignore[return-value]


def get_sheet_data(file_path: str, sheet_name: str) -> dict[str, Any]:
    df = pd.read_excel(file_path, sheet_name=sheet_name)
    df = _clean(df)
    return {
        "columns": df.columns.tolist(),
        "rows": df.to_dict(orient="records"),
        "shape": {"rows": len(df), "columns": len(df.columns)},
    }


def analyze_sheet(file_path: str, sheet_name: str) -> dict[str, Any]:
    df = pd.read_excel(file_path, sheet_name=sheet_name)
    df = _clean(df)

    numeric_cols: list[str] = df.select_dtypes(include="number").columns.tolist()
    categorical_cols: list[str] = df.select_dtypes(
        include=["object", "category"]
    ).columns.tolist()

    kpis: dict[str, Any] = {}
    for col in numeric_cols[:5]:
        kpis[col] = {
            "sum": _safe_float(df[col].sum()),
            "mean": _safe_float(df[col].mean()),
            "min": _safe_float(df[col].min()),
            "max": _safe_float(df[col].max()),
        }

    bar_charts: list[dict[str, Any]] = []
    for cat_col in categorical_cols[:3]:
        for num_col in numeric_cols[:2]:
            grp = (
                df.groupby(cat_col)[num_col]
                .sum()
                .reset_index()
                .sort_values(num_col, ascending=False)
                .head(20)
            )
            bar_charts.append(
                {
                    "title": f"{num_col} by {cat_col}",
                    "x": [str(v) for v in grp[cat_col].tolist()],
                    "y": [_safe_float(v) for v in grp[num_col].tolist()],
                    "x_label": cat_col,
                    "y_label": num_col,
                }
            )

    distributions: list[dict[str, Any]] = []
    for col in numeric_cols[:5]:
        vals = df[col].dropna().tolist()
        distributions.append(
            {
                "title": f"Distribution of {col}",
                "column": col,
                "data": [_safe_float(v) for v in vals[:2000]],
            }
        )

    return {
        "numeric_columns": numeric_cols,
        "categorical_columns": categorical_cols,
        "shape": {"rows": len(df), "columns": len(df.columns)},
        "kpis": kpis,
        "bar_charts": bar_charts,
        "distributions": distributions,
    }


# ── Private helpers ────────────────────────────────────────────────────────────


def _clean_category(val: Any) -> str:
    """Clean category name by removing 'Protect Max ' prefix (case-insensitive) and extra spaces."""
    if pd.isna(val) or val is None:
        return ""
    s = str(val).strip()
    s = re.sub(r"(?i)^protect\s+max\s+", "", s)
    return s.strip()


def _strip_column_names(df: pd.DataFrame) -> pd.DataFrame:
    """Strip leading/trailing whitespace from every column name."""
    df.columns = [str(c).strip() for c in df.columns]
    return df


def _find_col(df: pd.DataFrame, name_lower: str) -> str | None:
    """Return the first column whose stripped, lowercased name matches name_lower."""
    for col in df.columns:
        if str(col).strip().lower() == name_lower:
            return col
    return None


def _warn_missing_cols(
    df: pd.DataFrame, expected: set[str], filepath: str
) -> None:
    existing_lower = {str(c).strip().lower() for c in df.columns}
    for col in sorted(expected):
        if col.lower() not in existing_lower:
            logger.warning("Expected column '%s' not found in: %s", col, filepath)


def _str(row: "pd.Series[Any]", col: str | None) -> str:
    if col is None:
        return ""
    val = row.get(col, "")
    return "" if pd.isna(val) else str(val).strip()


def _clean(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df.replace([np.inf, -np.inf], np.nan, inplace=True)
    df = df.where(pd.notna(df), other=None)
    return df


def _safe_float(value: Any) -> float:
    try:
        f = float(value)
        return 0.0 if np.isnan(f) or np.isinf(f) else f
    except (TypeError, ValueError):
        return 0.0
