"""
parser.py — StoreWise XLSX parsing layer.

Domain-specific functions (Sales / Target files):
  parse_sales(filepath)          → list of store dicts with monthly revenue
  parse_targets(filepath)        → {store_id: target_float}
  get_month_columns(df)          → detect "MMM-YYYY" columns automatically
  validate_store_match(s, t)     → warn on Store_ID mismatches between files

Supports two sales formats:
  • Pre-aggregated: Store_ID | Store_Name | State | Category | Jan-2024 | …
  • Transactional:  SHIP_NODE | Category | State | Sub Classification |
                    GROSS_AMOUNT | Month (e.g. "Mar-26")

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

# Matches ISO date strings produced by pandas Timestamp.str: "2026-03-01 00:00:00" or "2026-03-01"
_ISO_DATE_RE = re.compile(r"^(\d{4})-(\d{2})-\d{2}")

_MONTH_ABBR_LIST = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]

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
    """Normalise any common month representation to 'Mmm-YYYY' (e.g. 'Mar-2026').

    Handles:
      'Mar-26'               → 'Mar-2026'   (short-year DSG format)
      'Mar-2026'             → 'Mar-2026'   (already normalised)
      '2026-03-01 00:00:00'  → 'Mar-2026'   (pandas Timestamp.str / ISO datetime)
      '2026-03-01'           → 'Mar-2026'   (ISO date)
    """
    m = str(m).strip()

    # Already in canonical form "Mmm-YYYY" — re-capitalise to be safe
    if _MONTH_RE.match(m):
        parts = m.split("-")
        return f"{parts[0].capitalize()}-{parts[1]}"

    # Short-year "Mar-26" (most common DSG export format)
    short = _MONTH_SHORT_RE.match(m)
    if short:
        return f"{short.group(1).capitalize()}-20{short.group(2)}"

    # ISO date string from pandas Timestamp: "2026-03-01 00:00:00" or "2026-03-01"
    iso = _ISO_DATE_RE.match(m)
    if iso:
        yr, mo = iso.group(1), int(iso.group(2))
        if 1 <= mo <= 12:
            return f"{_MONTH_ABBR_LIST[mo - 1]}-{yr}"

    logger.warning("_normalise_month: unrecognised format %r — revenue for this month may be lost", m)
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
    df[c_sub]   = df[c_sub].astype(str).str.strip()

    # Excel sometimes auto-formats "Mar-26" cells as date values.
    # pandas reads those as datetime64; .strftime gives the canonical form directly.
    # For plain text cells, fall back to the string-based normaliser.
    if pd.api.types.is_datetime64_any_dtype(df[c_month]):
        df[c_month] = df[c_month].dt.strftime("%b-%Y")
        logger.info(
            "_parse_transactional: Month column was datetime64 — converted via strftime. "
            "Distinct months: %s",
            sorted(df[c_month].unique()),
        )
    else:
        df[c_month] = df[c_month].astype(str).str.strip().apply(_normalise_month)

    # Validate: warn if any month key still doesn't match the canonical pattern
    bad = [m for m in df[c_month].unique() if not _MONTH_RE.match(str(m))]
    if bad:
        logger.warning(
            "_parse_transactional: %d unrecognised month value(s) — revenue under "
            "these keys will be excluded from the dashboard: %s",
            len(bad), bad[:10],
        )

    # Collect per-store metadata (take first occurrence)
    meta: dict[str, dict] = {}
    for _, row in df.iterrows():
        sid = str(row[c_store])
        if sid not in meta:
            meta[sid] = {
                "state":    _str(row, c_state),
                "category": _str(row, c_cat),
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
            "category":         _str(row, c_cat),
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
