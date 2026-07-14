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
import json
import logging
import os
import re
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Any
from contextlib import asynccontextmanager

from database import connect_to_mongo, close_mongo_connection, get_db
import pandas as pd
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel

from parser import (
    analyze_sheet,
    detect_month_from_filename,
    get_sheet_data,
    get_sheets,
    parse_sales,
    parse_croma_sales,
    parse_vs_sales,
    parse_reliance_sales,
    parse_hotspot_sales,
    parse_targets,
    parse_attach_file,
    validate_store_match,
)
import storage as st
import tracker as trk

logger = logging.getLogger(__name__)

def _normalize_store_name(name: str, keep_locations: bool = False) -> str:
    name = str(name).lower()
    # Replace common synonyms
    name = name.replace('rr nagar', 'rajarajeshwari nagar')
    name = name.replace('marathalli', 'marthahalli')
    name = name.replace('marathahalli', 'marthahalli')
    name = name.replace('kanakpura', 'kanakapura')
    name = name.replace('rajajinagar', 'rajaji nagar')
    name = name.replace('tirupathi', 'tirupati')
    
    # strip prefix
    name = re.sub(r'^(vs|croma|vijay\s*sales|vijaysales|vijay)\s*[-–—]?\s*', '', name)
    name = re.sub(r'\s+br(\.|\b)?$', '', name)
    name = re.sub(r'\s+branch$', '', name)
    
    # Remove city/state noise words to make matching location-agnostic
    if not keep_locations:
        noise_words = ['bangalore', 'blr', 'mumbai', 'mum', 'delhi', 'pune', 'hyderabad', 'hyd', 'chennai', 'ts', 'ap', 'up', 'haryana', 'cassette', 'tv', 'trading']
        for word in noise_words:
            name = name.replace(word, '')
        
    name = re.sub(r'[^a-z0-9]', '', name)
    return name

_ATTACH_RETAILERS = {"croma", "vijaysales"}
_CROMA_STORE_CODE_RE = re.compile(r'-\s*(A\d+)\s*$', re.IGNORECASE)
_attach_data_cache: dict[str, dict] = {}


def _get_attach_lookup(retailer: str) -> dict[str, tuple[dict[str, float], dict[str, float]]]:
    """Load & cache uploaded attach % files for a retailer.

    Returns {month_label: (by_code, by_name)} where by_code/by_name map a
    normalized store key to attach_pct (0-1). Cache is invalidated whenever
    the set of uploaded files (or their upload timestamps) changes.
    """
    if retailer not in _ATTACH_RETAILERS:
        return {}
    files = st.list_attach_files(retailer)
    cache_key = tuple(sorted((f["month"], f["uploaded_at"]) for f in files))
    cached = _attach_data_cache.get(retailer)
    if cached and cached.get("cache_key") == cache_key:
        return cached["months"]

    months: dict[str, tuple[dict[str, float], dict[str, float]]] = {}
    for f in files:
        month_label = f["month"]
        path = st.get_month_attach(retailer, month_label)
        if not path:
            continue
        try:
            rows = parse_attach_file(path)
        except Exception:
            logger.exception("Failed to parse attach file for %s %s", retailer, month_label)
            continue
        by_code: dict[str, float] = {}
        by_name: dict[str, float] = {}
        for r in rows:
            if r.get("store_code"):
                by_code[str(r["store_code"]).strip().lower()] = r["attach_pct"]
            if r.get("store_name"):
                by_name[_normalize_store_name(r["store_name"], keep_locations=True)] = r["attach_pct"]
        months[month_label] = (by_code, by_name)

    _attach_data_cache[retailer] = {"cache_key": cache_key, "months": months}
    return months


def _match_attach_pct(store_name: str, by_code: dict[str, float], by_name: dict[str, float]) -> float | None:
    """Match a Store doc's name against an attach file's rows.

    Croma store names embed the attach file's StoreCode as a suffix
    (e.g. "Croma-Agra-Church Road- A612" -> "A612"), so that's tried first
    since it's an exact match; Vijay Sales has no such code, so normalized
    name matching (same scheme as target-file matching) is the fallback.
    """
    m = _CROMA_STORE_CODE_RE.search(store_name or "")
    if m and m.group(1).lower() in by_code:
        return by_code[m.group(1).lower()]
    norm = _normalize_store_name(store_name or "", keep_locations=True)
    if norm in by_name:
        return by_name[norm]
    if norm and len(norm) >= 4:
        for key, pct in by_name.items():
            if key and len(key) >= 4 and (key in norm or norm in key):
                return pct
    return None


_samsung_targets_cache = None
_samsung_targets_mtime = 0

def get_samsung_targets(retailer: str) -> dict[str, float]:
    global _samsung_targets_cache, _samsung_targets_mtime
    possible_paths = [
        "Samsung Targets (1).xlsx",
        "../Samsung Targets (1).xlsx",
        "../../Samsung Targets (1).xlsx",
        "../../../Samsung Targets (1).xlsx",
        "backend/data/Samsung Targets (1).xlsx",
        "data/Samsung Targets (1).xlsx",
        "/app/data/Samsung Targets (1).xlsx",
        "c:/Users/Yoganshu Sharma/Desktop/samsung_dashboard/Samsung Targets (1).xlsx",
    ]
    file_path = None
    for path in possible_paths:
        try:
            if os.path.exists(path):
                file_path = path
                break
        except Exception:
            pass

    if not file_path:
        return {}

    try:
        mtime = os.path.getmtime(file_path)
        if _samsung_targets_cache is not None and mtime == _samsung_targets_mtime:
            cache = _samsung_targets_cache
        else:
            logger.info("Parsing Samsung Targets (1).xlsx from %s", file_path)
            xl = pd.ExcelFile(file_path)
            croma_targets = {}
            if "Croma" in xl.sheet_names:
                df = pd.read_excel(xl, sheet_name="Croma")
                df.columns = [str(c).strip() for c in df.columns]
                store_code_col = next((c for c in df.columns if c.lower() == "store code"), None)
                croma_val_col = next((c for c in df.columns if c.lower() == "croma"), None)
                if store_code_col and croma_val_col:
                    for _, row in df.iterrows():
                        code = str(row[store_code_col]).strip()
                        try:
                            val = float(row[croma_val_col])
                        except (ValueError, TypeError):
                            val = 0.0
                        if code and val > 0:
                            croma_targets[_normalize_store_name(code)] = val

            vs_targets = {}
            vs_sheet = next((name for name in xl.sheet_names if name.strip().lower() in ["vs", "vs "]), None)
            if vs_sheet:
                df = pd.read_excel(xl, sheet_name=vs_sheet)
                df.columns = [str(c).strip() for c in df.columns]
                store_branch_col = next((c for c in df.columns if c.lower() == "store / branch"), None)
                val_col = next((c for c in df.columns if c.lower() == "target value"), None)
                if store_branch_col and val_col:
                    for _, row in df.iterrows():
                        branch = str(row[store_branch_col]).strip()
                        try:
                            val = float(row[val_col])
                        except (ValueError, TypeError):
                            val = 0.0
                        if branch and val > 0:
                            vs_targets[_normalize_store_name(branch, keep_locations=True)] = val

            _samsung_targets_cache = {"croma": croma_targets, "vijaysales": vs_targets}
            _samsung_targets_mtime = mtime
            logger.info("Loaded %d Croma and %d VS targets from Excel.", len(croma_targets), len(vs_targets))
            cache = _samsung_targets_cache
    except Exception as exc:
        logger.error("Error loading Samsung Targets (1).xlsx: %s", exc)
        return {}

    r_lower = retailer.lower()
    if r_lower == "croma":
        return cache.get("croma", {})
    elif r_lower == "vijaysales":
        return cache.get("vijaysales", {})
    return {}



@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await connect_to_mongo()
    yield
    # Shutdown
    await close_mongo_connection()

app = FastAPI(title="StoreWise API", version="3.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── In-memory sales state ─────────────────────────────────────────────────────
# Main-dashboard sales data lives here only.  None → no data loaded this session.

# DS/DSG (legacy / demo)
_in_memory_sales: list[dict] | None = None
_sales_session_meta: dict[str, Any] | None = None
_in_memory_sales_raw: bytes | None = None
_in_memory_sales_is_demo: bool = False

# Croma
_in_memory_croma: list[dict] | None = None
_croma_session_meta: dict[str, Any] | None = None
_in_memory_croma_raw: bytes | None = None

# Vijay Sales
_in_memory_vs: list[dict] | None = None
_vs_session_meta: dict[str, Any] | None = None
_in_memory_vs_raw: bytes | None = None

# Reliance
_in_memory_reliance: list[dict] | None = None
_reliance_session_meta: dict[str, Any] | None = None
_in_memory_reliance_raw: bytes | None = None

# Hotspot
_in_memory_hotspot: list[dict] | None = None
_hotspot_session_meta: dict[str, Any] | None = None
_in_memory_hotspot_raw: bytes | None = None

# Kore
_in_memory_kore: list[dict] | None = None
_kore_session_meta: dict[str, Any] | None = None
_in_memory_kore_raw: bytes | None = None

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
        file.filename.lower().endswith(".xlsx") or file.filename.lower().endswith(".xls")
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


def _dedupe_sales(sales: list[dict]) -> list[dict]:
    """Collapse exact-duplicate SalesRecord docs before revenue is summed.

    The Store->SalesRecord $lookup matches storeId against both its native type
    and its stringified form (to tolerate inconsistent typing upstream). If the
    same store/year/plan/subcategory revenue was ever ingested twice under two
    separate SalesRecord documents, both are legitimately matched by the lookup
    and would otherwise be added together, inflating the store's total revenue.
    Two records only collapse here if their revenue-bearing content is
    byte-identical — anything with even slightly different numbers is treated
    as a distinct, real record and kept.
    """
    seen: set[str] = set()
    deduped: list[dict] = []
    for sale in sales:
        signature = json.dumps(
            {
                "year": sale.get("year"),
                "planType": (sale.get("planType") or "").strip().lower(),
                "productSubCategoryId": sale.get("productSubCategoryId"),
                "monthlySales": sale.get("monthlySales"),
                "dailySales": sale.get("dailySales"),
            },
            sort_keys=True,
            default=str,
        )
        if signature in seen:
            continue
        seen.add(signature)
        deduped.append(sale)
    return deduped


def _parse_bytes_as_sales(content: bytes) -> list[dict]:
    """Write bytes to a temp file, parse with parse_sales(), clean up."""
    with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as tmp:
        tmp.write(content)
        tmp_path = tmp.name
    try:
        return parse_sales(tmp_path)
    finally:
        os.unlink(tmp_path)


def _parse_bytes_as_croma(content: bytes) -> list[dict]:
    with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as tmp:
        tmp.write(content)
        tmp_path = tmp.name
    try:
        return parse_croma_sales(tmp_path)
    finally:
        os.unlink(tmp_path)


def _parse_bytes_as_vs(content: bytes) -> list[dict]:
    with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as tmp:
        tmp.write(content)
        tmp_path = tmp.name
    try:
        return parse_vs_sales(tmp_path)
    finally:
        os.unlink(tmp_path)


def _parse_bytes_as_reliance(content: bytes) -> list[dict]:
    with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as tmp:
        tmp.write(content)
        tmp_path = tmp.name
    try:
        return parse_reliance_sales(tmp_path)
    finally:
        os.unlink(tmp_path)


def _parse_bytes_as_hotspot(content: bytes) -> list[dict]:
    with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as tmp:
        tmp.write(content)
        tmp_path = tmp.name
    try:
        return parse_hotspot_sales(tmp_path)
    finally:
        os.unlink(tmp_path)


def _parse_bytes_as_kore(content: bytes) -> list[dict]:
    with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as tmp:
        tmp.write(content)
        tmp_path = tmp.name
    try:
        try:
            return parse_hotspot_sales(tmp_path)
        except Exception:
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

@app.get("/api/db-status")
def db_status():
    from database import get_db
    db = get_db()
    if db is not None:
        return {"status": "ok", "message": "Successfully connected to MongoDB 'zoppertrack' database."}
    else:
        return {"status": "error", "message": "MongoDB connection is not active."}


# ── Demo data ─────────────────────────────────────────────────────────────────


@app.post("/api/demo/load")
def load_demo_data(retailer: str = ""):
    return {"ok": True, "message": "Disabled. Strict read-only mode active."}

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


# ── Croma upload ───────────────────────────────────────────────────────────────────


@app.post("/api/upload/sales/croma")
async def upload_croma_sales(file: UploadFile = File(...), force: bool = False):
    """Parse Croma XLSX and hold it in memory."""
    global _in_memory_croma, _croma_session_meta, _in_memory_croma_raw
    _validate_excel(file)
    if not force and _in_memory_croma is not None:
        return {"needs_confirm": True, "existing": _croma_session_meta}
    content = await file.read()
    try:
        stores = _parse_bytes_as_croma(content)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Croma parse error: {exc}") from exc
    _in_memory_croma = stores
    _in_memory_croma_raw = content
    _croma_session_meta = {
        "filename":     file.filename or "croma_upload.xlsx",
        "uploaded_at":  datetime.now().isoformat(timespec="seconds"),
        "file_size_kb": round(len(content) / 1024, 1),
        "record_count": len(stores),
    }
    months = _extract_months(stores)
    return {"ok": True, "stores": len(stores), "months": months, "needs_confirm": False}


@app.delete("/api/storage/sales/croma")
def delete_croma_sales():
    return {"ok": True, "message": "Disabled. Strict read-only mode active."}

@app.get("/api/sales/meta/croma")
def get_croma_meta():
    if _in_memory_croma is None or _croma_session_meta is None:
        return {"loaded": False}
    months = _extract_months(_in_memory_croma)
    total_revenue = sum(sum(s.get("monthly_sales", {}).values()) for s in _in_memory_croma)
    return {
        "loaded": True,
        "filename":      _croma_session_meta.get("filename", "unknown"),
        "uploaded_at":   _croma_session_meta.get("uploaded_at", ""),
        "file_size_kb":  _croma_session_meta.get("file_size_kb", 0),
        "store_count":   len(_in_memory_croma),
        "record_count":  len(_in_memory_croma),
        "date_from":     months[0] if months else None,
        "date_to":       months[-1] if months else None,
        "month_count":   len(months),
        "total_revenue": total_revenue,
        "is_demo":       False,
    }


# ── Vijay Sales upload ───────────────────────────────────────────────────────────


@app.post("/api/upload/sales/vijaysales")
async def upload_vs_sales(file: UploadFile = File(...), force: bool = False):
    """Parse Vijay Sales XLSX and hold it in memory."""
    global _in_memory_vs, _vs_session_meta, _in_memory_vs_raw
    _validate_excel(file)
    if not force and _in_memory_vs is not None:
        return {"needs_confirm": True, "existing": _vs_session_meta}
    content = await file.read()
    try:
        stores = _parse_bytes_as_vs(content)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Vijay Sales parse error: {exc}") from exc
    _in_memory_vs = stores
    _in_memory_vs_raw = content
    _vs_session_meta = {
        "filename":     file.filename or "vijaysales_upload.xlsx",
        "uploaded_at":  datetime.now().isoformat(timespec="seconds"),
        "file_size_kb": round(len(content) / 1024, 1),
        "record_count": len(stores),
    }
    months = _extract_months(stores)
    return {"ok": True, "stores": len(stores), "months": months, "needs_confirm": False}


@app.delete("/api/storage/sales/vijaysales")
def delete_vs_sales():
    return {"ok": True, "message": "Disabled. Strict read-only mode active."}

@app.get("/api/sales/meta/vijaysales")
def get_vs_meta():
    if _in_memory_vs is None or _vs_session_meta is None:
        return {"loaded": False}
    months = _extract_months(_in_memory_vs)
    total_revenue = sum(sum(s.get("monthly_sales", {}).values()) for s in _in_memory_vs)
    return {
        "loaded": True,
        "filename":      _vs_session_meta.get("filename", "unknown"),
        "uploaded_at":   _vs_session_meta.get("uploaded_at", ""),
        "file_size_kb":  _vs_session_meta.get("file_size_kb", 0),
        "store_count":   len(_in_memory_vs),
        "record_count":  len(_in_memory_vs),
        "date_from":     months[0] if months else None,
        "date_to":       months[-1] if months else None,
        "month_count":   len(months),
        "total_revenue": total_revenue,
        "is_demo":       False,
    }


# ── Reliance upload ───────────────────────────────────────────────────────────


@app.post("/api/upload/sales/reliance")
async def upload_reliance_sales(file: UploadFile = File(...), force: bool = False):
    """Parse Reliance XLSX and hold it in memory."""
    global _in_memory_reliance, _reliance_session_meta, _in_memory_reliance_raw
    _validate_excel(file)
    if not force and _in_memory_reliance is not None:
        return {"needs_confirm": True, "existing": _reliance_session_meta}
    content = await file.read()
    try:
        stores = _parse_bytes_as_reliance(content)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Reliance parse error: {exc}") from exc
    _in_memory_reliance = stores
    _in_memory_reliance_raw = content
    _reliance_session_meta = {
        "filename":     file.filename or "reliance_upload.xlsx",
        "uploaded_at":  datetime.now().isoformat(timespec="seconds"),
        "file_size_kb": round(len(content) / 1024, 1),
        "record_count": len(stores),
    }
    months = _extract_months(stores)
    return {"ok": True, "stores": len(stores), "months": months, "needs_confirm": False}


@app.delete("/api/storage/sales/reliance")
def delete_reliance_sales():
    return {"ok": True, "message": "Disabled. Strict read-only mode active."}

@app.get("/api/sales/meta/reliance")
def get_reliance_meta():
    if _in_memory_reliance is None or _reliance_session_meta is None:
        return {"loaded": False}
    months = _extract_months(_in_memory_reliance)
    total_revenue = sum(sum(s.get("monthly_sales", {}).values()) for s in _in_memory_reliance)
    return {
        "loaded": True,
        "filename":      _reliance_session_meta.get("filename", "unknown"),
        "uploaded_at":   _reliance_session_meta.get("uploaded_at", ""),
        "file_size_kb":  _reliance_session_meta.get("file_size_kb", 0),
        "store_count":   len(_in_memory_reliance),
        "record_count":  len(_in_memory_reliance),
        "date_from":     months[0] if months else None,
        "date_to":       months[-1] if months else None,
        "month_count":   len(months),
        "total_revenue": total_revenue,
        "is_demo":       False,
    }


# ── Hotspot upload ────────────────────────────────────────────────────────────


@app.post("/api/upload/sales/hotspot")
async def upload_hotspot_sales(file: UploadFile = File(...), force: bool = False):
    """Parse Hotspot XLSX and hold it in memory."""
    global _in_memory_hotspot, _hotspot_session_meta, _in_memory_hotspot_raw
    _validate_excel(file)
    if not force and _in_memory_hotspot is not None:
        return {"needs_confirm": True, "existing": _hotspot_session_meta}
    content = await file.read()
    try:
        stores = _parse_bytes_as_hotspot(content)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Hotspot parse error: {exc}") from exc
    _in_memory_hotspot = stores
    _in_memory_hotspot_raw = content
    _hotspot_session_meta = {
        "filename":     file.filename or "hotspot_upload.xlsx",
        "uploaded_at":  datetime.now().isoformat(timespec="seconds"),
        "file_size_kb": round(len(content) / 1024, 1),
        "record_count": len(stores),
    }
    months = _extract_months(stores)
    return {"ok": True, "stores": len(stores), "months": months, "needs_confirm": False}


@app.delete("/api/storage/sales/hotspot")
def delete_hotspot_sales():
    return {"ok": True, "message": "Disabled. Strict read-only mode active."}

@app.get("/api/sales/meta/hotspot")
def get_hotspot_meta():
    if _in_memory_hotspot is None or _hotspot_session_meta is None:
        return {"loaded": False}
    months = _extract_months(_in_memory_hotspot)
    total_revenue = sum(sum(s.get("monthly_sales", {}).values()) for s in _in_memory_hotspot)
    return {
        "loaded": True,
        "filename":      _hotspot_session_meta.get("filename", "unknown"),
        "uploaded_at":   _hotspot_session_meta.get("uploaded_at", ""),
        "file_size_kb":  _hotspot_session_meta.get("file_size_kb", 0),
        "store_count":   len(_in_memory_hotspot),
        "record_count":  len(_in_memory_hotspot),
        "date_from":     months[0] if months else None,
        "date_to":       months[-1] if months else None,
        "month_count":   len(months),
        "total_revenue": total_revenue,
        "is_demo":       False,
    }


# ── Kore upload ───────────────────────────────────────────────────────────────


@app.post("/api/upload/sales/kore")
async def upload_kore_sales(file: UploadFile = File(...), force: bool = False):
    """Parse Kore XLSX and hold it in memory."""
    global _in_memory_kore, _kore_session_meta, _in_memory_kore_raw
    _validate_excel(file)
    if not force and _in_memory_kore is not None:
        return {"needs_confirm": True, "existing": _kore_session_meta}
    content = await file.read()
    try:
        stores = _parse_bytes_as_kore(content)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Kore parse error: {exc}") from exc
    _in_memory_kore = stores
    _in_memory_kore_raw = content
    _kore_session_meta = {
        "filename":     file.filename or "kore_upload.xlsx",
        "uploaded_at":  datetime.now().isoformat(timespec="seconds"),
        "file_size_kb": round(len(content) / 1024, 1),
        "record_count": len(stores),
    }
    months = _extract_months(stores)
    return {"ok": True, "stores": len(stores), "months": months, "needs_confirm": False}


@app.delete("/api/storage/sales/kore")
def delete_kore_sales():
    return {"ok": True, "message": "Disabled. Strict read-only mode active."}

@app.get("/api/sales/meta/kore")
def get_kore_meta():
    if _in_memory_kore is None or _kore_session_meta is None:
        return {"loaded": False}
    months = _extract_months(_in_memory_kore)
    total_revenue = sum(sum(s.get("monthly_sales", {}).values()) for s in _in_memory_kore)
    return {
        "loaded": True,
        "filename":      _kore_session_meta.get("filename", "unknown"),
        "uploaded_at":   _kore_session_meta.get("uploaded_at", ""),
        "file_size_kb":  _kore_session_meta.get("file_size_kb", 0),
        "store_count":   len(_in_memory_kore),
        "record_count":  len(_in_memory_kore),
        "date_from":     months[0] if months else None,
        "date_to":       months[-1] if months else None,
        "month_count":   len(months),
        "total_revenue": total_revenue,
        "is_demo":       False,
    }


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


# ── Attach % file upload (Croma / Vijay Sales only) ───────────────────────────
#
# SalesRecord's own device counts are unreliable (see get_dashboard_data), so
# the Attach Performance tab derives devices from this separately-uploaded,
# manually-reconciled monthly attach % report instead.

_ATTACH_RETAILERS = {"croma", "vijaysales"}


@app.post("/api/upload/attach/{retailer}")
async def upload_attach_file(retailer: str, file: UploadFile = File(...), month: str = ""):
    if retailer not in _ATTACH_RETAILERS:
        raise HTTPException(status_code=400, detail="Attach % upload is only supported for croma and vijaysales.")
    _validate_excel(file)
    content = await file.read()

    month_label = month.strip() or detect_month_from_filename(file.filename or "")
    if not month_label:
        raise HTTPException(status_code=400, detail="Could not detect month from filename; pass ?month=Jul-2026.")

    meta = st.save_attach_file(retailer, content, month_label)

    attach_path = st.get_month_attach(retailer, month_label)
    try:
        rows = parse_attach_file(attach_path)  # type: ignore[arg-type]
    except Exception as exc:
        st.delete_attach_file(retailer, month_label)
        raise HTTPException(status_code=422, detail=f"Attach file parse error: {exc}") from exc
    if not rows:
        st.delete_attach_file(retailer, month_label)
        raise HTTPException(status_code=422, detail="No attach % rows could be parsed from this file.")

    return {"ok": True, "retailer": retailer, "month": month_label, "rows": len(rows), **meta}


@app.get("/api/attach/meta/{retailer}")
def get_attach_meta(retailer: str):
    if retailer not in _ATTACH_RETAILERS:
        return {"files": []}
    return {"files": st.list_attach_files(retailer)}


@app.delete("/api/storage/attach/{retailer}/{month}")
def delete_attach(retailer: str, month: str):
    if retailer not in _ATTACH_RETAILERS:
        raise HTTPException(status_code=400, detail="Attach % storage is only supported for croma and vijaysales.")
    st.delete_attach_file(retailer, month)
    return {"ok": True}


# ── Dashboard data ────────────────────────────────────────────────────────────


@app.get("/api/data")
async def get_dashboard_data(retailer: str = ""):
    """Return merged dashboard payload from MongoDB.

    ?retailer=croma     → Croma dataset (matches storeCategory or storeChannel)
    ?retailer=vijaysales → Vijay Sales dataset
    (no param)          → All stores
    """
    db = get_db()
    
    _NO_DATA = {
        "no_data": True, "stores": [], "months": [],
        "states": [], "categories": [], "has_targets": False, "warnings": [],
    }
    if db is None:
        _NO_DATA["warnings"].append("MongoDB not connected.")
        return _NO_DATA

    # Determine target month dynamically from StoreTarget
    target_month_num = 6
    target_year = 2026
    target_doc = await db["StoreTarget"].find_one({"brandId": "brand_002"}, sort=[("year", -1), ("month", -1)])
    if target_doc:
        target_month_num = target_doc.get("month", 6)
        target_year = target_doc.get("year", 2026)
    
    _MONTH_MAP = {
        1: "Jan", 2: "Feb", 3: "Mar", 4: "Apr", 5: "May", 6: "Jun",
        7: "Jul", 8: "Aug", 9: "Sep", 10: "Oct", 11: "Nov", 12: "Dec"
    }
    target_month_str = f"{_MONTH_MAP.get(target_month_num, 'Jun')}-{target_year}"

    match_stage = {}
    if retailer:
        r_lower = retailer.lower()
        if r_lower == "croma":
            match_stage = {"storeName": {"$regex": "croma", "$options": "i"}}
        elif r_lower == "vijaysales":
            match_stage = {"storeName": {"$regex": "^vs\\b|^vijay\\s*sales\\b", "$options": "i"}}
        elif r_lower == "reliance":
            match_stage = {"storeName": {"$regex": "reliance", "$options": "i"}}
        elif r_lower == "hotspot":
            match_stage = {"storeName": {"$regex": "hotspot", "$options": "i"}}
        elif r_lower == "kore":
            match_stage = {"storeName": {"$regex": "kore", "$options": "i"}}
        else:
            match_stage = {"storeName": {"$regex": retailer, "$options": "i"}}
    
    pipeline = []
    if match_stage:
        pipeline.append({"$match": match_stage})

    pipeline.extend([
        {"$lookup": {
            "from": "SalesRecord",
            "let": {"store_id": "$_id"},
            "pipeline": [
                {"$match": {
                    "$expr": {
                        "$and": [
                            {"$or": [
                                {"$eq": ["$storeId", "$$store_id"]},
                                {"$eq": ["$storeId", {"$toString": "$$store_id"}]}
                            ]},
                            {"$eq": ["$brandId", "brand_002"]}
                        ]
                    }
                }}
            ],
            "as": "sales"
        }},
        {"$lookup": {
            "from": "StoreTarget",
            "let": {"store_id": "$_id"},
            "pipeline": [
                {"$match": {
                    "$expr": {
                        "$and": [
                            {"$or": [
                                {"$eq": ["$storeId", "$$store_id"]},
                                {"$eq": ["$storeId", {"$toString": "$$store_id"}]}
                            ]},
                            {"$eq": ["$brandId", "brand_002"]}
                        ]
                    }
                }}
            ],
            "as": "targets"
        }},
        {"$lookup": {
            "from": "StoreBrand",
            "let": {"store_id": "$_id"},
            "pipeline": [
                {"$match": {
                    "$expr": {
                        "$and": [
                            {"$or": [
                                {"$eq": ["$storeId", "$$store_id"]},
                                {"$eq": ["$storeId", {"$toString": "$$store_id"}]}
                            ]},
                            {"$eq": ["$brandId", "brand_002"]}
                        ]
                    }
                }}
            ],
            "as": "brand_info"
        }}
    ])

    cursor = db["Store"].aggregate(pipeline)
    stores_docs = await cursor.to_list(None)

    # Load ProductSubCategory mappings
    psc_names = {}
    psc_cursor = db["ProductSubCategory"].find()
    psc_docs = await psc_cursor.to_list(None)
    psc_names = {str(psc["_id"]): psc["name"] for psc in psc_docs}

    samsung_targets = get_samsung_targets(retailer) if retailer else {}

    _MONTH_MAP = {
        1: "Jan", 2: "Feb", 3: "Mar", 4: "Apr", 5: "May", 6: "Jun",
        7: "Jul", 8: "Aug", 9: "Sep", 10: "Oct", 11: "Nov", 12: "Dec"
    }

    stores = []
    months_set = set()
    states_set = set()
    categories_set = set()
    
    for doc in stores_docs:
        brand_info = doc.get("brand_info", [])
        store_brand_id = brand_info[0].get("storeBrandId", "") if brand_info else ""
        store_id = store_brand_id if store_brand_id else str(doc.get("_id", ""))
        
        store_name = doc.get("storeName", "")
        state = doc.get("state", "")
        
        if state: states_set.add(state)
        
        monthly_sales = {}
        monthly_sales_ds = {}
        monthly_sales_dsg = {}
        monthly_sales_sp = {}
        monthly_sales_adld = {}
        monthly_sales_combo = {}
        monthly_sales_ew = {}
        monthly_plans = {}
        monthly_plans_sp = {}
        monthly_plans_adld = {}
        monthly_plans_combo = {}
        monthly_plans_ew = {}
        monthly_main = {}
        monthly_attach = {}
        subcat_revenue = {}
        # Plan counts split by source: SalesRecord carries both the real
        # per-plan-type transactional records AND, for Croma/Vijay Sales, a
        # redundant "planType: NA" monthly summary record that duplicates the
        # same activity. Kept separate so the attach-file override below can
        # use the de-duplicated count instead of double-summing both.
        monthly_plans_granular = {}
        monthly_plans_na = {}

        for sale in _dedupe_sales(doc.get("sales", [])):
            year = sale.get("year")
            plan_type = sale.get("planType") or ""
            plan_type_lower = plan_type.strip().lower()
            is_na_summary = plan_type_lower == "na"

            is_ds = plan_type_lower in ["sp", "device secure", "ds"]
            is_dsg = plan_type_lower in ["adld", "combo", "ew", "device secure gold", "dsg"]
            
            is_sp = plan_type_lower in ["sp", "device secure", "ds"]
            is_adld = plan_type_lower in ["adld", "device secure gold", "dsg"]
            is_combo = plan_type_lower in ["combo"]
            is_ew = plan_type_lower in ["ew"]
            
            subcat_id = sale.get("productSubCategoryId")
            subcat_name = psc_names.get(subcat_id) if subcat_id else None
            
            monthly = sale.get("monthlySales", [])
            if (not monthly or len(monthly) == 0) and "dailySales" in sale:
                daily = sale.get("dailySales", {})
                if isinstance(daily, dict):
                    reconstructed_monthly = []
                    for m_str, days in daily.items():
                        if not m_str.isdigit(): continue
                        m_num = int(m_str)
                        rev = sum(float(d.get("revenue", 0) or 0) for d in days)
                        plans = sum(int(d.get("countOfSales", 0) or 0) for d in days)
                        devices = sum(int(d.get("deviceSales", 0) or 0) for d in days)
                        reconstructed_monthly.append({
                            "month": m_num,
                            "revenue": rev,
                            "planSales": plans,
                            "deviceSales": devices
                        })
                    monthly = reconstructed_monthly

            if isinstance(monthly, list):
                for m_data in monthly:
                    month_num = m_data.get("month")
                    if not month_num or not year: continue
                    m_abbr = _MONTH_MAP.get(int(month_num))
                    if not m_abbr: continue
                    m = f"{m_abbr}-{year}"
                    months_set.add(m)
                    
                    rev_val = float(m_data.get("revenue", 0) or 0)
                    
                    monthly_sales[m] = monthly_sales.get(m, 0) + rev_val
                    monthly_plans[m] = monthly_plans.get(m, 0) + int(m_data.get("planSales", 0) or 0)
                    plans_val = int(m_data.get("planSales", 0) or 0)
                    if is_na_summary:
                        monthly_plans_na[m] = monthly_plans_na.get(m, 0) + plans_val
                    else:
                        monthly_plans_granular[m] = monthly_plans_granular.get(m, 0) + plans_val
                    if is_sp:
                        monthly_plans_sp[m] = monthly_plans_sp.get(m, 0) + plans_val
                    if is_adld:
                        monthly_plans_adld[m] = monthly_plans_adld.get(m, 0) + plans_val
                    if is_combo:
                        monthly_plans_combo[m] = monthly_plans_combo.get(m, 0) + plans_val
                    if is_ew:
                        monthly_plans_ew[m] = monthly_plans_ew.get(m, 0) + plans_val
                    monthly_main[m] = monthly_main.get(m, 0) + int(m_data.get("deviceSales", 0) or 0)
                    
                    if is_ds:
                        monthly_sales_ds[m] = monthly_sales_ds.get(m, 0) + rev_val
                    elif is_dsg:
                        monthly_sales_dsg[m] = monthly_sales_dsg.get(m, 0) + rev_val
                        
                    if is_sp:
                        monthly_sales_sp[m] = monthly_sales_sp.get(m, 0) + rev_val
                    if is_adld:
                        monthly_sales_adld[m] = monthly_sales_adld.get(m, 0) + rev_val
                    if is_combo:
                        monthly_sales_combo[m] = monthly_sales_combo.get(m, 0) + rev_val
                    if is_ew:
                        monthly_sales_ew[m] = monthly_sales_ew.get(m, 0) + rev_val
                        
                    if subcat_name:
                        subcat_revenue[subcat_name] = subcat_revenue.get(subcat_name, 0.0) + rev_val
        
        for m in monthly_sales.keys():
            plans = monthly_plans_granular.get(m, 0) or monthly_plans_na.get(m, 0)
            monthly_plans[m] = plans
            devices = monthly_main.get(m, 0)
            if devices > 0:
                monthly_attach[m] = round(plans / devices, 4)
            else:
                monthly_attach[m] = 0.0

        # Override with the reconciled attach % file where one has been uploaded
        # for this retailer/month — SalesRecord's own device counts are missing
        # for most stores/months, so devices are derived as plans ÷ attach_pct
        # using the de-duplicated (granular-preferred) plan count instead.
        if retailer.lower() in _ATTACH_RETAILERS:
            for m_label, (by_code, by_name) in _get_attach_lookup(retailer.lower()).items():
                pct = _match_attach_pct(store_name, by_code, by_name)
                if pct is None:
                    continue
                deduped_plans = monthly_plans_granular.get(m_label, 0) or monthly_plans_na.get(m_label, 0)
                monthly_plans[m_label] = deduped_plans
                monthly_attach[m_label] = round(pct, 4)
                monthly_main[m_label] = round(deduped_plans / pct) if pct > 0 else monthly_main.get(m_label, 0)
                months_set.add(m_label)

        # Gather targets for all months dynamically from database StoreTarget lookup
        monthly_targets = {}
        for t in doc.get("targets", []):
            t_month = t.get("month")
            t_year = t.get("year")
            if t_month and t_year:
                m_abbr = _MONTH_MAP.get(int(t_month))
                if m_abbr:
                    m_label = f"{m_abbr}-{t_year}"
                    monthly_targets[m_label] = monthly_targets.get(m_label, 0.0) + (t.get("targetRevenue", 0) or 0)

        # Prioritize database targets for the active target month/year
        # has_db_target = True means a StoreTarget record exists in MongoDB for this month/year
        # (even if targetRevenue=0). In that case we do NOT fall back to the Excel backup.
        db_target = 0
        has_db_target = False
        for t in doc.get("targets", []):
            if t.get("month") == target_month_num and t.get("year") == target_year:
                has_db_target = True
                db_target += t.get("targetRevenue", 0) or 0

        # Normalise store target matching (spreadsheet backup)
        norm_name = _normalize_store_name(store_name, keep_locations=(retailer == "vijaysales"))
        excel_target = samsung_targets.get(norm_name)
        if excel_target is None and store_id:
            excel_target = samsung_targets.get(_normalize_store_name(store_id, keep_locations=(retailer == "vijaysales")))
        if excel_target is None:
            # try substring match
            if norm_name and len(norm_name) >= 3:
                for k, v in samsung_targets.items():
                    if k and len(k) >= 3 and (k in norm_name or norm_name in k):
                        excel_target = v
                        break

        if has_db_target:
            # DB record exists — always use it (even when 0) to respect what was pushed
            target_val = db_target
        elif excel_target is not None:
            target_val = excel_target
        else:
            target_val = 0

        # Fall back spreadsheet targets to monthly_targets for the active month if database has none
        if target_month_str not in monthly_targets and target_val > 0:
            monthly_targets[target_month_str] = target_val

        # Primary subcat as the category field
        primary_subcat = "—"
        if subcat_revenue:
            primary_subcat = max(subcat_revenue, key=subcat_revenue.get)
            
        if primary_subcat and primary_subcat != "—":
            category = primary_subcat.strip()
            if category:
                category = category[0].upper() + category[1:]
        else:
            category = "—"

        if category and category != "—":
            categories_set.add(category)

        store_obj = {
            "store_id": store_id,
            "store_name": store_name,
            "state": state,
            "category": category,
            "monthly_sales": monthly_sales,
            "monthly_targets": monthly_targets,
            "monthly_sales_ds": monthly_sales_ds,
            "monthly_sales_dsg": monthly_sales_dsg,
            "monthly_sales_sp": monthly_sales_sp,
            "monthly_sales_adld": monthly_sales_adld,
            "monthly_sales_combo": monthly_sales_combo,
            "monthly_sales_ew": monthly_sales_ew,
            "monthly_plans_count": monthly_plans,
            "monthly_plans_sp": monthly_plans_sp,
            "monthly_plans_adld": monthly_plans_adld,
            "monthly_plans_combo": monthly_plans_combo,
            "monthly_plans_ew": monthly_plans_ew,
            "monthly_main_qty": monthly_main,
            "monthly_attach_pct": monthly_attach,
            "target": target_val if target_val > 0 else None,
            "zonal_manager": "",
            "cluster_manager": ""
        }
        stores.append(store_obj)
        
    from datetime import timezone, timedelta
    ist = timezone(timedelta(hours=5, minutes=30))
    now = datetime.now(ist)
    current_month_str = f"{_MONTH_MAP.get(now.month, 'Jul')}-{now.year}"
    months_set.add(current_month_str)

    return {
        "no_data": len(stores) == 0,
        "stores": stores,
        "months": _sort_months(list(months_set)),
        "states": sorted(list(states_set)),
        "categories": sorted(list(categories_set)),
        "has_targets": True,
        "target_month": target_month_str,
        "warnings": []
    }


@app.get("/api/stores/{store_id}")
async def get_store_detail(store_id: str, retailer: str = ""):
    db = get_db()
    if db is None:
        raise HTTPException(status_code=500, detail="Database not connected.")
        
    # Check if store_id matches any storeBrandId in StoreBrand
    sb_doc = await db["StoreBrand"].find_one({"storeBrandId": store_id, "brandId": "brand_002"})
    actual_store_id = sb_doc.get("storeId") if sb_doc else store_id
    
    pipeline = [
        {"$match": {"_id": actual_store_id}},
        {"$lookup": {
            "from": "SalesRecord",
            "let": {"store_id": "$_id"},
            "pipeline": [
                {"$match": {
                    "$expr": {
                        "$and": [
                            {"$or": [
                                {"$eq": ["$storeId", "$$store_id"]},
                                {"$eq": ["$storeId", {"$toString": "$$store_id"}]}
                            ]},
                            {"$eq": ["$brandId", "brand_002"]}
                        ]
                    }
                }}
            ],
            "as": "sales"
        }},
        {"$lookup": {
            "from": "StoreTarget",
            "let": {"store_id": "$_id"},
            "pipeline": [
                {"$match": {
                    "$expr": {
                        "$and": [
                            {"$or": [
                                {"$eq": ["$storeId", "$$store_id"]},
                                {"$eq": ["$storeId", {"$toString": "$$store_id"}]}
                            ]},
                            {"$eq": ["$brandId", "brand_002"]}
                        ]
                    }
                }}
            ],
            "as": "targets"
        }},
        {"$lookup": {
            "from": "StoreBrand",
            "let": {"store_id": "$_id"},
            "pipeline": [
                {"$match": {
                    "$expr": {
                        "$and": [
                            {"$or": [
                                {"$eq": ["$storeId", "$$store_id"]},
                                {"$eq": ["$storeId", {"$toString": "$$store_id"}]}
                            ]},
                            {"$eq": ["$brandId", "brand_002"]}
                        ]
                    }
                }}
            ],
            "as": "brand_info"
        }}
    ]
    cursor = db["Store"].aggregate(pipeline)
    docs = await cursor.to_list(1)
    if not docs:
        raise HTTPException(status_code=404, detail=f"Store '{store_id}' not found.")
        
    doc = docs[0]

    brand_info = doc.get("brand_info", [])
    store_brand_id = brand_info[0].get("storeBrandId", "") if brand_info else ""
    store_id = store_brand_id if store_brand_id else str(doc.get("_id", ""))
    
    store_name = doc.get("storeName", "")
    state = doc.get("state", "")
    
    # Load ProductSubCategory mappings
    psc_names = {}
    psc_cursor = db["ProductSubCategory"].find()
    psc_docs = await psc_cursor.to_list(None)
    psc_names = {str(psc["_id"]): psc["name"] for psc in psc_docs}

    _MONTH_MAP = {
        1: "Jan", 2: "Feb", 3: "Mar", 4: "Apr", 5: "May", 6: "Jun",
        7: "Jul", 8: "Aug", 9: "Sep", 10: "Oct", 11: "Nov", 12: "Dec"
    }

    monthly_sales = {}
    monthly_sales_ds = {}
    monthly_sales_dsg = {}
    monthly_sales_sp = {}
    monthly_sales_adld = {}
    monthly_sales_combo = {}
    monthly_sales_ew = {}
    monthly_plans = {}
    monthly_plans_sp = {}
    monthly_plans_adld = {}
    monthly_plans_combo = {}
    monthly_plans_ew = {}
    monthly_main = {}
    monthly_attach = {}
    subcat_revenue = {}
    # See the matching comment in get_dashboard_data.
    monthly_plans_granular = {}
    monthly_plans_na = {}

    for sale in _dedupe_sales(doc.get("sales", [])):
        year = sale.get("year")
        plan_type = sale.get("planType") or ""
        plan_type_lower = plan_type.strip().lower()
        is_na_summary = plan_type_lower == "na"

        is_ds = plan_type_lower in ["sp", "device secure", "ds"]
        is_dsg = plan_type_lower in ["adld", "combo", "ew", "device secure gold", "dsg"]

        is_sp = plan_type_lower in ["sp", "device secure", "ds"]
        is_adld = plan_type_lower in ["adld", "device secure gold", "dsg"]
        is_combo = plan_type_lower in ["combo"]
        is_ew = plan_type_lower in ["ew"]

        subcat_id = sale.get("productSubCategoryId")
        subcat_name = psc_names.get(subcat_id) if subcat_id else None

        monthly = sale.get("monthlySales", [])
        if (not monthly or len(monthly) == 0) and "dailySales" in sale:
            daily = sale.get("dailySales", {})
            if isinstance(daily, dict):
                reconstructed_monthly = []
                for m_str, days in daily.items():
                    if not m_str.isdigit(): continue
                    m_num = int(m_str)
                    rev = sum(float(d.get("revenue", 0) or 0) for d in days)
                    plans = sum(int(d.get("countOfSales", 0) or 0) for d in days)
                    devices = sum(int(d.get("deviceSales", 0) or 0) for d in days)
                    reconstructed_monthly.append({
                        "month": m_num,
                        "revenue": rev,
                        "planSales": plans,
                        "deviceSales": devices
                    })
                monthly = reconstructed_monthly

        if isinstance(monthly, list):
            for m_data in monthly:
                month_num = m_data.get("month")
                if not month_num or not year: continue
                m_abbr = _MONTH_MAP.get(int(month_num))
                if not m_abbr: continue
                m = f"{m_abbr}-{year}"

                rev_val = float(m_data.get("revenue", 0) or 0)

                monthly_sales[m] = monthly_sales.get(m, 0) + rev_val
                monthly_plans[m] = monthly_plans.get(m, 0) + int(m_data.get("planSales", 0) or 0)
                plans_val = int(m_data.get("planSales", 0) or 0)
                if is_na_summary:
                    monthly_plans_na[m] = monthly_plans_na.get(m, 0) + plans_val
                else:
                    monthly_plans_granular[m] = monthly_plans_granular.get(m, 0) + plans_val
                if is_sp:
                    monthly_plans_sp[m] = monthly_plans_sp.get(m, 0) + plans_val
                if is_adld:
                    monthly_plans_adld[m] = monthly_plans_adld.get(m, 0) + plans_val
                if is_combo:
                    monthly_plans_combo[m] = monthly_plans_combo.get(m, 0) + plans_val
                if is_ew:
                    monthly_plans_ew[m] = monthly_plans_ew.get(m, 0) + plans_val
                monthly_main[m] = monthly_main.get(m, 0) + int(m_data.get("deviceSales", 0) or 0)
                
                if is_ds:
                    monthly_sales_ds[m] = monthly_sales_ds.get(m, 0) + rev_val
                elif is_dsg:
                    monthly_sales_dsg[m] = monthly_sales_dsg.get(m, 0) + rev_val
                    
                if is_sp:
                    monthly_sales_sp[m] = monthly_sales_sp.get(m, 0) + rev_val
                if is_adld:
                    monthly_sales_adld[m] = monthly_sales_adld.get(m, 0) + rev_val
                if is_combo:
                    monthly_sales_combo[m] = monthly_sales_combo.get(m, 0) + rev_val
                if is_ew:
                    monthly_sales_ew[m] = monthly_sales_ew.get(m, 0) + rev_val
                    
                if subcat_name:
                    subcat_revenue[subcat_name] = subcat_revenue.get(subcat_name, 0.0) + rev_val
    
    for m in monthly_sales.keys():
        plans = monthly_plans_granular.get(m, 0) or monthly_plans_na.get(m, 0)
        monthly_plans[m] = plans
        devices = monthly_main.get(m, 0)
        if devices > 0:
            monthly_attach[m] = round(plans / devices, 4)
        else:
            monthly_attach[m] = 0.0

    # See the matching override in get_dashboard_data.
    if retailer.lower() in _ATTACH_RETAILERS:
        for m_label, (by_code, by_name) in _get_attach_lookup(retailer.lower()).items():
            pct = _match_attach_pct(store_name, by_code, by_name)
            if pct is None:
                continue
            deduped_plans = monthly_plans_granular.get(m_label, 0) or monthly_plans_na.get(m_label, 0)
            monthly_plans[m_label] = deduped_plans
            monthly_attach[m_label] = round(pct, 4)
            monthly_main[m_label] = round(deduped_plans / pct) if pct > 0 else monthly_main.get(m_label, 0)

    # Determine target month dynamically from StoreTarget
    target_month_num = 6
    target_year = 2026
    target_doc = await db["StoreTarget"].find_one({"brandId": "brand_002"}, sort=[("year", -1), ("month", -1)])
    if target_doc:
        target_month_num = target_doc.get("month", 6)
        target_year = target_doc.get("year", 2026)

    _MONTH_MAP = {
        1: "Jan", 2: "Feb", 3: "Mar", 4: "Apr", 5: "May", 6: "Jun",
        7: "Jul", 8: "Aug", 9: "Sep", 10: "Oct", 11: "Nov", 12: "Dec"
    }
    target_month_str = f"{_MONTH_MAP.get(target_month_num, 'Jun')}-{target_year}"

    # Gather targets for all months dynamically from database StoreTarget lookup
    monthly_targets = {}
    for t in doc.get("targets", []):
        t_month = t.get("month")
        t_year = t.get("year")
        if t_month and t_year:
            m_abbr = _MONTH_MAP.get(int(t_month))
            if m_abbr:
                m_label = f"{m_abbr}-{t_year}"
                monthly_targets[m_label] = monthly_targets.get(m_label, 0.0) + (t.get("targetRevenue", 0) or 0)

    # Prioritize database targets for the active target month/year
    # has_db_target = True means a StoreTarget record exists in MongoDB for this month/year
    # (even if targetRevenue=0). In that case we do NOT fall back to the Excel backup.
    db_target = 0
    has_db_target = False
    for t in doc.get("targets", []):
        if t.get("month") == target_month_num and t.get("year") == target_year:
            has_db_target = True
            db_target += t.get("targetRevenue", 0) or 0

    # Normalise store target matching (infer retailer if not specified)
    retailer_inferred = retailer
    if not retailer_inferred:
        sname_lower = store_name.lower()
        if "croma" in sname_lower:
            retailer_inferred = "croma"
        elif "vs" in sname_lower or "vijay" in sname_lower:
            retailer_inferred = "vijaysales"
            
    samsung_targets = get_samsung_targets(retailer_inferred) if retailer_inferred else {}
    norm_name = _normalize_store_name(store_name, keep_locations=(retailer_inferred == "vijaysales"))
    excel_target = samsung_targets.get(norm_name)
    if excel_target is None and store_id:
        excel_target = samsung_targets.get(_normalize_store_name(store_id, keep_locations=(retailer_inferred == "vijaysales")))
    if excel_target is None:
        if norm_name and len(norm_name) >= 3:
            for k, v in samsung_targets.items():
                if k and len(k) >= 3 and (k in norm_name or norm_name in k):
                    excel_target = v
                    break

    if has_db_target:
        # DB record exists — always use it (even when 0) to respect what was pushed
        target_val = db_target
    elif excel_target is not None:
        target_val = excel_target
    else:
        target_val = 0

    # Fall back spreadsheet targets to monthly_targets for the active month if database has none
    if target_month_str not in monthly_targets and target_val > 0:
        monthly_targets[target_month_str] = target_val

    primary_subcat = "—"
    if subcat_revenue:
        primary_subcat = max(subcat_revenue, key=subcat_revenue.get)
        
    if primary_subcat and primary_subcat != "—":
        category = primary_subcat.strip()
        if category:
            category = category[0].upper() + category[1:]
    else:
        category = "—"

    return {
        "store_id": store_id,
        "store_name": store_name,
        "state": state,
        "category": category,
        "monthly_sales": monthly_sales,
        "monthly_targets": monthly_targets,
        "monthly_sales_ds": monthly_sales_ds,
        "monthly_sales_dsg": monthly_sales_dsg,
        "monthly_sales_sp": monthly_sales_sp,
        "monthly_sales_adld": monthly_sales_adld,
        "monthly_sales_combo": monthly_sales_combo,
        "monthly_sales_ew": monthly_sales_ew,
        "monthly_plans_count": monthly_plans,
        "monthly_plans_sp": monthly_plans_sp,
        "monthly_plans_adld": monthly_plans_adld,
        "monthly_plans_combo": monthly_plans_combo,
        "monthly_plans_ew": monthly_plans_ew,
        "monthly_main_qty": monthly_main,
        "monthly_attach_pct": monthly_attach,
        "target": target_val if target_val > 0 else None,
        "zonal_manager": "",
        "cluster_manager": ""
    }


# ── Storage management endpoints ──────────────────────────────────────────────


@app.get("/api/storage/status")
def get_storage_status():
    """Return a mocked snapshot for MongoDB read-only mode."""
    base = st.storage_status()
    # Force frontend to bypass the "Upload Data" screen and go straight to the dashboard
    base["has_combined_sales"] = True
    base["active_sales_file"]  = "mongodb_zoppertrack"
    base["active_sales_meta"]  = {"filename": "mongodb_zoppertrack"}
    base["croma"]      = {"loaded": True, "meta": {"filename": "mongodb_zoppertrack"}}
    base["vijaysales"] = {"loaded": True, "meta": {"filename": "mongodb_zoppertrack"}}
    base["reliance"]   = {"loaded": True, "meta": {"filename": "mongodb_zoppertrack"}}
    base["hotspot"]    = {"loaded": True, "meta": {"filename": "mongodb_zoppertrack"}}
    base["kore"]       = {"loaded": True, "meta": {"filename": "mongodb_zoppertrack"}}
    return base


@app.delete("/api/storage/sales")
def delete_combined_sales():
    """Clear the in-memory sales data (now a no-op)."""
    return {"ok": True}


@app.post("/api/sales/reload")
def reload_sales():
    """Re-parse the currently stored raw bytes (now a no-op)."""
    return {"ok": True, "stores": 0, "months": []}


@app.get("/api/sales/meta")
def get_sales_meta():
    """Return summary metadata for the currently loaded sales dataset (now stubbed)."""
    return {
        "loaded":       True,
        "filename":     "mongodb_zoppertrack",
        "uploaded_at":  "",
        "file_size_kb": 0,
        "store_count":  0,
        "record_count": 0,
        "date_from":    None,
        "date_to":      None,
        "month_count":  12,
        "total_revenue": 0,
        "is_demo":      False,
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
    return {"ok": True, "message": "Disabled. Strict read-only mode active."}

@app.post("/api/targets/archive")
def archive_managed_target(body: MonthBody):
    return {"ok": True, "message": "Disabled. Strict read-only mode active."}

@app.delete("/api/targets/{month}")
def delete_managed_target(month: str):
    return {"ok": True, "message": "Disabled. Strict read-only mode active."}

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
async def get_tracker_data(month: str):
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

    # Fallback to MongoDB if data is missing from files
    db = get_db()
    if db is not None:
        # Parse month parameter into month_num and year
        parts = month.split("-")
        month_num, year = None, None
        if len(parts) == 2:
            m_abbr, year_str = parts
            month_num = _MONTH_ORDER.get(m_abbr.lower()) + 1 if m_abbr.lower() in _MONTH_ORDER else None
            try:
                year = int(year_str)
            except ValueError:
                pass

        if month_num is not None and year is not None:
            store_map = {}
            
            # Helper to lazily load store map if needed
            async def ensure_store_map():
                if not store_map:
                    try:
                        async for s in db.Store.find({}, {"storeName": 1, "state": 1}):
                            store_map[str(s["_id"])] = {
                                "name": s.get("storeName", ""),
                                "state": s.get("state", ""),
                                "key": ""
                            }
                        async for sb in db.StoreBrand.find({"brandId": "brand_002"}, {"storeBrandId": 1, "storeId": 1}):
                            sid = str(sb.get("storeId", ""))
                            if sid in store_map:
                                store_map[sid]["key"] = str(sb.get("storeBrandId", ""))
                    except Exception as e:
                        logger.warning("Error building store map: %s", e)

            # Fallback for targets
            if not has_target or not targets:
                await ensure_store_map()
                if store_map:
                    try:
                        targets_cursor = db.StoreTarget.find({
                            "brandId": "brand_002",
                            "month": month_num,
                            "year": year
                        })
                        db_targets = []
                        async for t in targets_cursor:
                            sid = str(t.get("storeId", ""))
                            s_info = store_map.get(sid)
                            if s_info:
                                db_targets.append({
                                    "store_key": s_info["key"],
                                    "store_name": s_info["name"],
                                    "head_operations": "",
                                    "zonal_manager": "",
                                    "cluster_manager": "",
                                    "target": float(t.get("targetRevenue", 0.0) or 0.0)
                                })
                        if db_targets:
                            targets = db_targets
                            has_target = True
                    except Exception as e:
                        logger.warning("Error fetching fallback targets from DB: %s", e)

            # Fallback for sales_rows
            if not has_sales or not sales_result["sales_rows"]:
                await ensure_store_map()
                if store_map:
                    try:
                        sales_cursor = db.SalesRecord.find({
                            "brandId": "brand_002",
                            "year": year,
                            f"dailySales.{month_num}": {"$exists": True}
                        }, {"storeId": 1, f"dailySales.{month_num}": 1})
                        
                        daily_sales_by_store = {}
                        async for doc in sales_cursor:
                            sid = str(doc.get("storeId", ""))
                            daily = doc.get("dailySales", {}).get(str(month_num), [])
                            if not isinstance(daily, list): continue
                            
                            if sid not in daily_sales_by_store:
                                daily_sales_by_store[sid] = {}
                                
                            for idx, day_info in enumerate(daily):
                                day_num = idx + 1
                                rev = float(day_info.get("revenue", 0.0) or 0.0)
                                if rev > 0:
                                    daily_sales_by_store[sid][day_num] = daily_sales_by_store[sid].get(day_num, 0.0) + rev
                        
                        db_sales_rows = []
                        max_elapsed = 0
                        for sid, day_map in daily_sales_by_store.items():
                            s_info = store_map.get(sid, {"name": "", "state": "", "key": ""})
                            for day_num, rev in day_map.items():
                                db_sales_rows.append({
                                    "store_name": s_info["name"],
                                    "store_key": s_info["key"],
                                    "sales": rev,
                                    "day": day_num,
                                    "state": s_info["state"]
                                })
                                if day_num > max_elapsed:
                                    max_elapsed = day_num
                        
                        if db_sales_rows:
                            sales_result = {
                                "sales_rows": db_sales_rows,
                                "detected_month": month,
                                "max_elapsed": max_elapsed,
                                "store_count": len(daily_sales_by_store)
                            }
                            has_sales = True
                    except Exception as e:
                        logger.warning("Error fetching fallback sales from DB: %s", e)

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
    return {"ok": True, "message": "Disabled. Strict read-only mode active."}

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


# ── Serve frontend dist and campaign analysis ─────────────────────────────────

_DIST_DIR = Path(__file__).resolve().parent.parent / "frontend" / "dist"
_CAMPAIGN_DIR = Path("C:/Users/Yoganshu Sharma/Desktop/campaign_analysis/outputs")

if _CAMPAIGN_DIR.is_dir():
    app.mount("/campaign", StaticFiles(directory=str(_CAMPAIGN_DIR)), name="campaign-assets")

if _DIST_DIR.is_dir():
    # Serve static assets (JS, CSS, etc.)
    app.mount("/assets", StaticFiles(directory=str(_DIST_DIR / "assets")), name="frontend-assets")

    # Serve other static files in dist root (geojson, etc.)
    @app.get("/{full_path:path}")
    def serve_frontend(full_path: str):
        """Catch-all: serve files from dist or fall back to index.html for SPA routing."""
        file_path = _DIST_DIR / full_path
        if full_path and file_path.is_file():
            return FileResponse(str(file_path))
        return FileResponse(str(_DIST_DIR / "index.html"))
