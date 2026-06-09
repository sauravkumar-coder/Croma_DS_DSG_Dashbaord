"""
StoreWise FastAPI backend.

Sales data policy
─────────────────
Main-dashboard sales are held IN MEMORY ONLY.  They are never written to
disk, and are cleared on every server restart.  The user must re-upload
a sales file after every browser refresh / server restart.

Target files are persistent (data/targets/).  Users upload them once per
month; they survive restarts.

Domain endpoints (StoreWise-specific):
  POST /api/upload/sales         — parse sales XLSX → hold in memory
  POST /api/upload/targets       — upload targets XLSX → month-keyed storage
  GET  /api/data                 — merged dashboard payload (in-memory sales)
  GET  /api/stores/{id}          — single-store detail

Storage management:
  GET  /api/storage/status       — snapshot of in-memory + persisted state
  DELETE /api/storage/sales      — clear in-memory sales data

Target management:
  GET  /api/targets/list         — list all managed target files
  POST /api/targets/upload       — upload target for a specific month
  POST /api/targets/set-active   — activate a month's target
  POST /api/targets/archive      — archive a month's target
  DELETE /api/targets/{month}    — permanently delete a month's target

Target Tracker:
  POST /api/tracker/sales/upload — upload tracker sales (month auto-detected)
  GET  /api/tracker/status       — list stored tracker data
  GET  /api/tracker/data         — parsed target + sales rows for a month
  DELETE /api/tracker/sales/{month} — delete tracker sales for a month

Generic (file-explorer, kept for compatibility):
  GET  /api/health
  POST /api/demo/load
  POST /api/upload
  GET  /api/sheets
  GET  /api/data/{sheet_name}
  GET  /api/analysis/{sheet_name}
"""

import io
import logging
import os
import tempfile
from datetime import datetime
from typing import Any

import pandas as pd
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from parser import (
    analyze_sheet,
    detect_month_from_filename,
    get_sheet_data,
    get_sheets,
    parse_sales,
    parse_targets,
    validate_store_match,
)
import storage as st
import tracker as trk

logger = logging.getLogger(__name__)

app = FastAPI(title="StoreWise API", version="3.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── In-memory sales state ──────────────────────────────────────────────────────
# Main-dashboard sales data lives here only.  None → no data loaded this session.

_in_memory_sales: list[dict] | None = None
_sales_session_meta: dict[str, Any] | None = None
_in_memory_sales_raw: bytes | None = None  # raw bytes for reload without restart
_in_memory_sales_is_demo: bool = False

# Used only by the generic /api/upload → /api/data/{sheet} flow
_uploaded_file: str | None = None

_MONTH_ORDER = {
    m: i
    for i, m in enumerate(
        ["jan", "feb", "mar", "apr", "may", "jun",
         "jul", "aug", "sep", "oct", "nov", "dec"]
    )
}


# ── Helpers ────────────────────────────────────────────────────────────────────


def _validate_excel(file: UploadFile) -> None:
    if not file.filename or not (
        file.filename.endswith(".xlsx") or file.filename.endswith(".xls")
    ):
        raise HTTPException(
            status_code=400, detail="Only .xlsx / .xls files are accepted."
        )


def _sort_months(months: list[str]) -> list[str]:
    def key(m: str) -> tuple[int, int]:
        parts = m.split("-")
        if len(parts) != 2:
            return (9999, 99)
        name, year = parts
        return (int(year) if year.isdigit() else 9999,
                _MONTH_ORDER.get(name.lower(), 99))
    return sorted(months, key=key)


def _extract_months(stores: list[dict]) -> list[str]:
    if not stores:
        return []
    return _sort_months(list(stores[0].get("monthly_sales", {}).keys()))


def _parse_bytes_as_sales(content: bytes) -> list[dict]:
    """Write bytes to a temp file, parse with parse_sales(), clean up."""
    with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as tmp:
        tmp.write(content)
        tmp_path = tmp.name
    try:
        return parse_sales(tmp_path)
    finally:
        os.unlink(tmp_path)


def _read_active_targets() -> tuple[bool, dict[str, dict], str | None]:
    """Return (has_targets, targets_dict, active_month) from the active target file on disk."""
    active_month = st.get_active_target_month()
    if not active_month:
        return False, {}, None
    target_path = st.get_month_target(active_month)
    if not target_path:
        return False, {}, active_month
    try:
        targets = parse_targets(target_path)
        return True, targets, active_month
    except Exception as exc:
        logger.warning("Could not parse active target file: %s", exc)
        return False, {}, active_month


# ── Health ────────────────────────────────────────────────────────────────────


@app.get("/api/health")
def health():
    return {"status": "ok"}


# ── Demo data ─────────────────────────────────────────────────────────────────


@app.post("/api/demo/load")
def load_demo_data():
    """Generate deterministic demo data, hold sales in memory, save target to disk."""
    global _in_memory_sales, _sales_session_meta

    import random
    rng = random.Random(42)
    states = [
        "Maharashtra", "Delhi", "Karnataka", "Tamil Nadu",
        "Gujarat", "Rajasthan", "West Bengal", "Telangana",
    ]
    categories = [
        "Electronics", "Large Appliances", "Mobile & Tablets",
        "Computers", "Small Appliances",
    ]
    city_map = {
        "Maharashtra": ["Mumbai", "Pune", "Nagpur", "Nashik"],
        "Delhi":       ["Connaught Place", "Lajpat Nagar", "Rohini", "Dwarka"],
        "Karnataka":   ["Bengaluru", "Mysuru", "Hubballi", "Mangaluru"],
        "Tamil Nadu":  ["Chennai", "Coimbatore", "Madurai", "Salem"],
        "Gujarat":     ["Ahmedabad", "Surat", "Vadodara", "Rajkot"],
        "Rajasthan":   ["Jaipur", "Jodhpur", "Kota", "Udaipur"],
        "West Bengal": ["Kolkata", "Howrah", "Siliguri", "Durgapur"],
        "Telangana":   ["Hyderabad", "Warangal", "Karimnagar", "Nizamabad"],
    }
    months = [
        "Jan-2024", "Feb-2024", "Mar-2024", "Apr-2024",
        "May-2024", "Jun-2024", "Jul-2024", "Aug-2024",
        "Sep-2024", "Oct-2024", "Nov-2024", "Dec-2024",
    ]

    sales_rows = []
    target_rows = []

    for i in range(1, 31):
        state = states[(i - 1) % len(states)]
        cat   = categories[(i - 1) % len(categories)]
        city  = city_map[state][(i - 1) % len(city_map[state])]
        store_id = f"CR{i:03d}"
        base = rng.randint(400_000, 2_000_000)

        row: dict = {
            "Store_ID":   store_id,
            "Store_Name": f"Croma {city} {(i - 1) // len(states) + 1}",
            "State":      state,
            "Category":   cat,
        }
        for m in months:
            row[m] = round(base * rng.uniform(0.65, 1.40) / 1000) * 1000
        sales_rows.append(row)
        target_rows.append({
            "Store_ID":       store_id,
            "Monthly_Target": round(base * 1.10 / 100_000) * 100_000,
        })

    sales_df  = pd.DataFrame(sales_rows)
    target_df = pd.DataFrame(target_rows)

    # Parse sales into memory
    buf = io.BytesIO()
    sales_df.to_excel(buf, index=False)
    try:
        stores = _parse_bytes_as_sales(buf.getvalue())
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    _in_memory_sales = stores
    _in_memory_sales_raw = buf.getvalue()
    _in_memory_sales_is_demo = True
    _sales_session_meta = {
        "filename":     "demo_data.xlsx",
        "uploaded_at":  datetime.now().isoformat(timespec="seconds"),
        "file_size_kb": round(len(buf.getvalue()) / 1024, 1),
        "record_count": len(stores),
    }

    # Save target to disk (targets are persistent)
    buf2 = io.BytesIO()
    target_df.to_excel(buf2, index=False)
    target_month = "Dec-2024"
    st.save_target_file(buf2.getvalue(), target_month)
    st.set_active_target(target_month)

    return {
        "ok":     True,
        "stores": len(stores),
        "months": _extract_months(stores),
    }


# ── Main dashboard upload endpoints ──────────────────────────────────────────


@app.post("/api/upload/sales")
async def upload_sales(
    file: UploadFile = File(...),
    force: bool = False,
):
    """Parse sales XLSX and hold it in memory.

    Sales data is NEVER written to disk.  It is cleared on server restart.

    If data is already loaded and force=False, returns
    {'needs_confirm': True, 'existing': <meta>} without replacing.
    Pass force=True to replace immediately.
    """
    global _in_memory_sales, _sales_session_meta

    _validate_excel(file)

    if not force and _in_memory_sales is not None:
        return {"needs_confirm": True, "existing": _sales_session_meta}

    content = await file.read()
    try:
        stores = _parse_bytes_as_sales(content)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Parse error: {exc}") from exc

    _in_memory_sales = stores
    _in_memory_sales_raw = content
    _in_memory_sales_is_demo = False
    _sales_session_meta = {
        "filename":     file.filename or "upload.xlsx",
        "uploaded_at":  datetime.now().isoformat(timespec="seconds"),
        "file_size_kb": round(len(content) / 1024, 1),
        "record_count": len(stores),
    }

    months = _extract_months(stores)
    return {"ok": True, "stores": len(stores), "months": months, "needs_confirm": False}


@app.post("/api/upload/targets")
async def upload_targets(file: UploadFile = File(...)):
    """Save targets XLSX (legacy endpoint; month inferred from filename)."""
    _validate_excel(file)
    original_name = file.filename or ""
    content = await file.read()

    target_month = detect_month_from_filename(original_name)
    if not target_month:
        target_month = datetime.now().strftime("%b-%Y")

    st.save_target_file(content, target_month)

    target_path = st.get_month_target(target_month)
    try:
        targets = parse_targets(target_path)  # type: ignore[arg-type]
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Parse error: {exc}") from exc

    return {"ok": True, "stores": len(targets), "target_month": target_month}


# ── Dashboard data ────────────────────────────────────────────────────────────


@app.get("/api/data")
def get_dashboard_data():
    """Return merged dashboard payload using in-memory sales + persisted targets."""
    if _in_memory_sales is None:
        return {
            "no_data":     True,
            "stores":      [],
            "months":      [],
            "states":      [],
            "categories":  [],
            "has_targets": False,
            "warnings":    [],
        }

    stores = [dict(s) for s in _in_memory_sales]

    has_targets, targets, target_month = _read_active_targets()
    warnings: list[str] = []

    for store in stores:
        t = targets.get(store["store_id"], {})
        store["target"]          = t.get("target")
        store["zonal_manager"]   = t.get("zonal_manager", "")
        store["cluster_manager"] = t.get("cluster_manager", "")
        if not store.get("store_name") and t.get("store_name"):
            store["store_name"] = t["store_name"]

    months     = _extract_months(stores)
    states     = sorted({s["state"] for s in stores if s["state"]})
    categories = sorted({s["category"] for s in stores if s["category"]})

    return {
        "no_data":      False,
        "stores":       stores,
        "months":       months,
        "states":       states,
        "categories":   categories,
        "has_targets":  has_targets,
        "target_month": target_month,
        "warnings":     warnings,
    }


@app.get("/api/stores/{store_id}")
def get_store_detail(store_id: str):
    if _in_memory_sales is None:
        raise HTTPException(status_code=404, detail="No sales data uploaded yet.")

    store = next((s for s in _in_memory_sales if s["store_id"] == store_id), None)
    if store is None:
        raise HTTPException(status_code=404, detail=f"Store '{store_id}' not found.")

    store = dict(store)

    active_month = st.get_active_target_month()
    if active_month:
        target_path = st.get_month_target(active_month)
        if target_path:
            try:
                t = parse_targets(target_path).get(store_id, {})
                store["target"]          = t.get("target")
                store["zonal_manager"]   = t.get("zonal_manager", "")
                store["cluster_manager"] = t.get("cluster_manager", "")
                if not store.get("store_name") and t.get("store_name"):
                    store["store_name"] = t["store_name"]
            except Exception:
                store["target"] = None
        else:
            store["target"] = None
    else:
        store["target"] = None

    return store


# ── Storage management endpoints ──────────────────────────────────────────────


@app.get("/api/storage/status")
def get_storage_status():
    """Return a snapshot of in-memory sales state + all persisted files."""
    base = st.storage_status()
    base["has_combined_sales"] = _in_memory_sales is not None
    base["active_sales_file"]  = _sales_session_meta.get("filename") if _sales_session_meta else None
    base["active_sales_meta"]  = _sales_session_meta
    return base


@app.delete("/api/storage/sales")
def delete_combined_sales():
    """Clear the in-memory sales data."""
    global _in_memory_sales, _sales_session_meta, _in_memory_sales_raw, _in_memory_sales_is_demo
    if _in_memory_sales is None:
        raise HTTPException(status_code=404, detail="No sales data is currently loaded.")
    _in_memory_sales = None
    _sales_session_meta = None
    _in_memory_sales_raw = None
    _in_memory_sales_is_demo = False
    return {"ok": True}


@app.post("/api/sales/reload")
def reload_sales():
    """Re-parse the currently stored raw bytes without a new upload."""
    global _in_memory_sales
    if _in_memory_sales_raw is None:
        raise HTTPException(status_code=404, detail="No sales data to reload. Upload a file first.")
    try:
        stores = _parse_bytes_as_sales(_in_memory_sales_raw)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Reload error: {exc}") from exc
    _in_memory_sales = stores
    return {"ok": True, "stores": len(stores), "months": _extract_months(stores)}


@app.get("/api/sales/meta")
def get_sales_meta():
    """Return summary metadata for the currently loaded sales dataset."""
    if _in_memory_sales is None or _sales_session_meta is None:
        return {"loaded": False}

    months = _extract_months(_in_memory_sales)
    total_revenue = sum(
        sum(s.get("monthly_sales", {}).values())
        for s in _in_memory_sales
    )

    return {
        "loaded":       True,
        "filename":     _sales_session_meta.get("filename", "unknown"),
        "uploaded_at":  _sales_session_meta.get("uploaded_at", ""),
        "file_size_kb": _sales_session_meta.get("file_size_kb", 0),
        "store_count":  len(_in_memory_sales),
        "record_count": len(_in_memory_sales),
        "date_from":    months[0] if months else None,
        "date_to":      months[-1] if months else None,
        "month_count":  len(months),
        "total_revenue": total_revenue,
        "is_demo":      _in_memory_sales_is_demo,
    }


# ── Target management endpoints ───────────────────────────────────────────────


class MonthBody(BaseModel):
    month: str


@app.get("/api/targets/list")
def list_managed_targets():
    return {"targets": st.list_target_files()}


@app.post("/api/targets/upload")
async def upload_managed_target(
    file: UploadFile = File(...),
    month_label: str = Form(...),
):
    """Upload a targets XLSX for a specific month (MMM-YYYY format)."""
    _validate_excel(file)
    month_label = month_label.strip()
    if not st.validate_month_label(month_label):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid month format '{month_label}'. Expected MMM-YYYY, e.g. Jul-2025.",
        )
    content = await file.read()

    # Validate target file columns
    with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as tmp:
        tmp.write(content)
        tmp_path = tmp.name
    try:
        errors = trk.validate_target_file(tmp_path)
    finally:
        os.unlink(tmp_path)

    if errors:
        raise HTTPException(status_code=422, detail="; ".join(errors))

    try:
        meta = st.save_target_file(content, month_label)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return meta


@app.post("/api/targets/set-active")
def set_active_target(body: MonthBody):
    if not st.validate_month_label(body.month):
        raise HTTPException(status_code=400, detail=f"Invalid month '{body.month}'")
    try:
        return st.set_active_target(body.month.strip())
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/api/targets/archive")
def archive_managed_target(body: MonthBody):
    if not st.validate_month_label(body.month):
        raise HTTPException(status_code=400, detail=f"Invalid month '{body.month}'")
    try:
        return st.archive_target_file(body.month.strip())
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.delete("/api/targets/{month}")
def delete_managed_target(month: str):
    if not st.validate_month_label(month):
        raise HTTPException(status_code=400, detail=f"Invalid month '{month}'")
    try:
        st.delete_target_file(month)
        return {"ok": True}
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


# ── Target Tracker endpoints ──────────────────────────────────────────────────


@app.post("/api/tracker/sales/upload")
async def upload_tracker_sales(file: UploadFile = File(...)):
    """Upload tracker monthly sales. Month is auto-detected from the Date column."""
    _validate_excel(file)
    content = await file.read()

    with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as tmp:
        tmp.write(content)
        tmp_path = tmp.name
    try:
        errors = trk.validate_sales_file(tmp_path)
        if errors:
            raise HTTPException(status_code=422, detail="; ".join(errors))

        detected_month = trk.detect_sales_month(tmp_path)
        if not detected_month:
            now = datetime.now()
            MONTH_ABBR = {1:"Jan",2:"Feb",3:"Mar",4:"Apr",5:"May",6:"Jun",
                          7:"Jul",8:"Aug",9:"Sep",10:"Oct",11:"Nov",12:"Dec"}
            detected_month = f"{MONTH_ABBR[now.month]}-{now.year}"

        already_exists = st.tracker_sales_exists(detected_month)
        parsed = trk.parse_tracker_sales(tmp_path)
    finally:
        os.unlink(tmp_path)

    meta = st.save_tracker_sales(content, detected_month)
    meta["already_existed"] = already_exists
    meta["store_count"]     = parsed["store_count"]
    meta["max_elapsed"]     = parsed["max_elapsed"]
    return meta


@app.get("/api/tracker/status")
def get_tracker_status():
    """Return what tracker data is currently stored."""
    target_files  = st.list_target_files()
    tracker_sales = st.list_tracker_sales()
    active_target = st.get_active_target_month()

    months_with_target = {t["month"] for t in target_files}
    months_with_sales  = {s["month"] for s in tracker_sales}
    all_months = sorted(
        months_with_target | months_with_sales,
        key=lambda m: st._label_sort_key(m),
        reverse=True,
    )

    months_data = []
    for month in all_months:
        has_t = month in months_with_target
        has_s = month in months_with_sales
        t_meta = next((t for t in target_files  if t["month"] == month), None)
        s_meta = next((s for s in tracker_sales if s["month"] == month), None)
        months_data.append({
            "month":            month,
            "has_target":       has_t,
            "has_sales":        has_s,
            "is_active_target": month == active_target,
            "target_meta":      t_meta,
            "sales_meta":       s_meta,
        })

    return {
        "active_target_month": active_target,
        "months":              months_data,
    }


@app.get("/api/tracker/data")
def get_tracker_data(month: str):
    """Return parsed target + sales data for a month."""
    if not st.validate_month_label(month):
        raise HTTPException(status_code=400, detail=f"Invalid month '{month}'")

    target_path = st.get_month_target(month)
    sales_path  = st.get_month_sales(month)

    if target_path is None:
        active = st.get_active_target_month()
        if active:
            target_path = st.get_month_target(active)

    has_target = target_path is not None
    has_sales  = sales_path is not None

    targets: list[dict] = []
    sales_result: dict = {
        "sales_rows":     [],
        "detected_month": month,
        "max_elapsed":    15,
        "store_count":    0,
    }

    if has_target:
        try:
            targets = trk.parse_tracker_target(target_path)  # type: ignore[arg-type]
        except Exception as exc:
            logger.warning("Could not parse target file: %s", exc)
            has_target = False

    if has_sales:
        try:
            sales_result = trk.parse_tracker_sales(sales_path)  # type: ignore[arg-type]
        except Exception as exc:
            logger.warning("Could not parse tracker sales file: %s", exc)
            has_sales = False

    return {
        "month":          month,
        "has_target":     has_target,
        "has_sales":      has_sales,
        "targets":        targets,
        "sales_rows":     sales_result["sales_rows"],
        "max_elapsed":    sales_result["max_elapsed"],
        "detected_month": sales_result.get("detected_month", month),
    }


@app.delete("/api/tracker/sales/{month}")
def delete_tracker_sales(month: str):
    if not st.validate_month_label(month):
        raise HTTPException(status_code=400, detail=f"Invalid month '{month}'")
    if not st.tracker_sales_exists(month):
        raise HTTPException(status_code=404, detail=f"No tracker sales for month '{month}'")
    st.delete_tracker_sales(month)
    return {"ok": True}


# ── Generic file-explorer endpoints (compatibility) ───────────────────────────


@app.post("/api/upload")
async def upload_file(file: UploadFile = File(...)):
    global _uploaded_file
    _validate_excel(file)
    dest = os.path.join(st.DATA_DIR, file.filename)  # type: ignore[arg-type]
    content = await file.read()
    st.save_file(dest, content)
    _uploaded_file = dest
    return {"filename": file.filename, "sheets": get_sheets(dest)}


@app.get("/api/sheets")
def list_sheets():
    if not _uploaded_file:
        raise HTTPException(status_code=404, detail="No file uploaded yet.")
    return {"sheets": get_sheets(_uploaded_file)}


@app.get("/api/data/{sheet_name}")
def fetch_sheet(sheet_name: str):
    if not _uploaded_file:
        raise HTTPException(status_code=404, detail="No file uploaded yet.")
    return get_sheet_data(_uploaded_file, sheet_name)


@app.get("/api/analysis/{sheet_name}")
def fetch_analysis(sheet_name: str):
    if not _uploaded_file:
        raise HTTPException(status_code=404, detail="No file uploaded yet.")
    return analyze_sheet(_uploaded_file, sheet_name)
