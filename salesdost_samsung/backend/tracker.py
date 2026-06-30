"""
tracker.py — Target Tracker parsing layer.

Parses tracker-specific files (different format from the main dashboard):
  - Target file: Store Key | Store Name | Head - Operations | Zonal Manager |
                 Cluster Manager | OOW / Store Target
  - Sales file:  Store Name (or Store Key) | Sales/Amount | Date | (optional) State

The merge key is Store Key when both files carry it; falls back to Store Name.
"""

import logging
from typing import Any

import pandas as pd

logger = logging.getLogger(__name__)

_MONTH_ABBR = {
    1: "Jan", 2: "Feb", 3: "Mar", 4: "Apr", 5: "May", 6: "Jun",
    7: "Jul", 8: "Aug", 9: "Sep", 10: "Oct", 11: "Nov", 12: "Dec",
}

# Columns the OW-Budget target file must have (at least one target-like column)
TARGET_REQUIRED_COLS = ["Store Key", "Store Name", "Store Target"]
SALES_REQUIRED_COLS  = ["Store Name"]   # minimal requirement


# ── Helpers ────────────────────────────────────────────────────────────────────


def _find_col(df: pd.DataFrame, *candidates: str) -> str | None:
    """Return the first df column whose lower-stripped name matches any candidate."""
    cols = [(str(c).strip().lower(), c) for c in df.columns]
    for cand in candidates:
        cl = cand.lower()
        for lower, original in cols:
            if cl == lower or cl in lower:
                return original
    return None


# ── Validation ─────────────────────────────────────────────────────────────────


def validate_target_file(filepath: str) -> list[str]:
    """Return validation errors for a tracker target file. Empty list = valid."""
    try:
        df = pd.read_excel(filepath)
        df.columns = [str(c).strip() for c in df.columns]
    except Exception as e:
        return [f"Cannot read file: {e}"]

    errors: list[str] = []
    has_key = _find_col(df, "store key", "store_id", "store id", "ship_node", "branch code") is not None
    has_name = _find_col(df, "store name", "store_name", "store", "outlet") is not None
    if not has_key and not has_name:
        errors.append("Missing required column: 'Store Key' or 'Store Name'")
        
    if _find_col(df, "oow", "store target", "monthly target", "target", "budget") is None:
        errors.append(
            "Missing required column: 'Store Target' / 'OOW' / 'Monthly Target'"
        )
    return errors


def validate_sales_file(filepath: str) -> list[str]:
    """Return validation errors for a tracker sales file. Empty list = valid."""
    try:
        df = pd.read_excel(filepath)
        df.columns = [str(c).strip() for c in df.columns]
    except Exception as e:
        return [f"Cannot read file: {e}"]

    errors: list[str] = []
    if _find_col(df, "store name", "store_name", "store", "outlet",
                 "store key", "store_id", "ship_node") is None:
        errors.append(
            "Missing required column: 'Store Name' (or Store Key, Store, Outlet)"
        )
    if _find_col(df, "sales", "revenue", "amount", "net sales",
                 "gross_amount", "value", "total") is None:
        errors.append(
            "Missing required column: 'Sales' (or Revenue, Amount, Net Sales, Value)"
        )
    return errors


# ── Target parser ──────────────────────────────────────────────────────────────


def parse_tracker_target(filepath: str) -> list[dict[str, Any]]:
    """Parse target file for the Target Tracker (OW-Budget format).

    Returns a list of:
      {store_key, store_name, head_operations, zonal_manager, cluster_manager, target}
    """
    df = pd.read_excel(filepath)
    df.columns = [str(c).strip() for c in df.columns]

    c_key    = _find_col(df, "store key", "store_id", "store id", "ship_node", "branch code")
    c_name   = _find_col(df, "store name", "store_name", "store", "outlet")
    c_target = _find_col(df, "oow", "store target", "monthly target", "target", "budget")
    c_zm     = _find_col(df, "zonal manager", "zonal mgr")
    c_cm     = _find_col(df, "cluster manager", "cluster mgr")
    c_head   = _find_col(df, "head - operations", "head operations", "head ops")

    if c_target is None:
        raise ValueError(
            "Cannot find target column. Expected: OOW, Store Target, Monthly Target, Target, Budget"
        )

    df[c_target] = pd.to_numeric(df[c_target], errors="coerce").fillna(0)
    df = df[df[c_target] > 0].copy()

    results: list[dict[str, Any]] = []
    for _, row in df.iterrows():
        key  = str(row[c_key]).strip()  if c_key  and pd.notna(row[c_key])  else ""
        name = str(row[c_name]).strip() if c_name and pd.notna(row[c_name]) else ""
        if not key and not name:
            continue
        results.append({
            "store_key":       key or name,
            "store_name":      name or key,
            "head_operations": str(row[c_head]).strip() if c_head and pd.notna(row[c_head]) else "",
            "zonal_manager":   str(row[c_zm]).strip()   if c_zm   and pd.notna(row[c_zm])   else "",
            "cluster_manager": str(row[c_cm]).strip()   if c_cm   and pd.notna(row[c_cm])   else "",
            "target":          float(row[c_target]),
        })
    return results


# ── Sales parser ───────────────────────────────────────────────────────────────


def detect_sales_month(filepath: str) -> str | None:
    """Return 'MMM-YYYY' of the most frequent month in the Date column."""
    try:
        df = pd.read_excel(filepath)
        df.columns = [str(c).strip() for c in df.columns]
        c_date = _find_col(df, "date", "txn date", "transaction date",
                           "sale date", "invoice date", "invoice")
        if c_date is None:
            return None
        dates = pd.to_datetime(df[c_date], errors="coerce").dropna()
        if dates.empty:
            return None
        counts = dates.dt.to_period("M").value_counts()
        if counts.empty:
            return None
        top = counts.index[0]
        return f"{_MONTH_ABBR[top.month]}-{top.year}"
    except Exception:
        return None


def parse_tracker_sales(filepath: str) -> dict[str, Any]:
    """Parse tracker sales file.

    Returns:
      {
        "sales_rows": [{store_name, store_key, sales, day, state}],
        "detected_month": "Jun-2026" | None,
        "max_elapsed":    int,
        "store_count":    int,
      }
    """
    df = pd.read_excel(filepath)
    df.columns = [str(c).strip() for c in df.columns]

    c_name  = _find_col(df, "store name", "store_name", "store", "outlet")
    c_key   = _find_col(df, "store key", "store_id", "ship_node", "branch code")
    c_sales = _find_col(df, "sales", "revenue", "amount", "net sales",
                        "gross_amount", "value", "total")
    c_date  = _find_col(df, "date", "txn date", "transaction date",
                        "sale date", "invoice date", "invoice")
    c_state = _find_col(df, "state", "region", "zone")

    if c_name is None and c_key is None:
        raise ValueError(
            "Cannot find store name/key column. Expected: Store Name, Store Key, Store, Outlet"
        )
    if c_sales is None:
        raise ValueError(
            "Cannot find sales column. Expected: Sales, Revenue, Amount, Net Sales, Value"
        )

    df[c_sales] = pd.to_numeric(df[c_sales], errors="coerce").fillna(0)
    detected_month = detect_sales_month(filepath)
    max_elapsed = 0
    sales_rows: list[dict[str, Any]] = []

    for _, row in df.iterrows():
        name = str(row[c_name]).strip() if c_name and pd.notna(row[c_name]) else ""
        key  = str(row[c_key]).strip()  if c_key  and pd.notna(row[c_key])  else ""
        store_id = key or name
        if not store_id or store_id.lower() in ("nan", ""):
            continue

        sales = float(row[c_sales])
        day = 0
        if c_date and pd.notna(row[c_date]):
            try:
                d = pd.to_datetime(row[c_date])
                day = d.day
                if sales > 0 and day > max_elapsed:
                    max_elapsed = day
            except Exception:
                pass

        state = str(row[c_state]).strip() if c_state and pd.notna(row[c_state]) else ""

        sales_rows.append({
            "store_name": name or key,
            "store_key":  key or name,
            "sales":      sales,
            "day":        day,
            "state":      state,
        })

    return {
        "sales_rows":     sales_rows,
        "detected_month": detected_month,
        "max_elapsed":    max_elapsed if max_elapsed > 0 else 15,
        "store_count":    len({r["store_key"] for r in sales_rows}),
    }
