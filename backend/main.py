"""
StoreWise FastAPI backend.

Domain endpoints (StoreWise-specific):
  POST /api/upload/sales    — upload sales XLSX (fixed path: data/sales.xlsx)
  POST /api/upload/targets  — upload targets XLSX (fixed path: data/targets.xlsx)
  GET  /api/data            — merged dashboard payload
  GET  /api/stores/{id}     — single-store detail

Generic endpoints (file-explorer, kept for compatibility):
  GET  /api/health
  POST /api/upload
  GET  /api/sheets
  GET  /api/data/{sheet_name}
  GET  /api/analysis/{sheet_name}
"""

import logging
import os
import shutil

import pandas as pd
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from parser import (
    analyze_sheet,
    get_sheet_data,
    get_sheets,
    parse_sales,
    parse_targets,
    validate_store_match,
)

logger = logging.getLogger(__name__)

app = FastAPI(title="StoreWise API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
os.makedirs(DATA_DIR, exist_ok=True)

SALES_FILE = os.path.join(DATA_DIR, "sales.xlsx")
TARGETS_FILE = os.path.join(DATA_DIR, "targets.xlsx")

# Used only by the generic /api/upload → /api/data/{sheet} flow
_uploaded_file: str | None = None

# Locale-safe month ordering (avoids strptime %b locale issues)
_MONTH_ORDER = {
    m: i
    for i, m in enumerate(
        ["jan", "feb", "mar", "apr", "may", "jun",
         "jul", "aug", "sep", "oct", "nov", "dec"]
    )
}


# ── Helpers ───────────────────────────────────────────────────────────────────


def _validate_excel(file: UploadFile) -> None:
    if not file.filename or not (
        file.filename.endswith(".xlsx") or file.filename.endswith(".xls")
    ):
        raise HTTPException(
            status_code=400, detail="Only .xlsx / .xls files are accepted."
        )


def _save(file: UploadFile, dest: str) -> None:
    with open(dest, "wb") as f:
        shutil.copyfileobj(file.file, f)


def _sort_months(months: list[str]) -> list[str]:
    """Sort 'MMM-YYYY' strings chronologically, locale-independently."""
    def key(m: str) -> tuple[int, int]:
        parts = m.split("-")
        if len(parts) != 2:
            return (9999, 99)
        name, year = parts
        return (int(year) if year.isdigit() else 9999,
                _MONTH_ORDER.get(name.lower(), 99))

    return sorted(months, key=key)


def _extract_months(stores: list[dict]) -> list[str]:
    """Pull month keys from the first store record and return them sorted."""
    if not stores:
        return []
    return _sort_months(list(stores[0].get("monthly_sales", {}).keys()))


# ── Domain endpoints ──────────────────────────────────────────────────────────


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.post("/api/upload/sales")
async def upload_sales(file: UploadFile = File(...)):
    """Save sales XLSX and return a summary."""
    _validate_excel(file)
    _save(file, SALES_FILE)

    try:
        stores = parse_sales(SALES_FILE)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Parse error: {exc}") from exc

    months = _extract_months(stores)
    return {"ok": True, "stores": len(stores), "months": months}


@app.post("/api/upload/targets")
async def upload_targets(file: UploadFile = File(...)):
    """Save targets XLSX and return a summary."""
    _validate_excel(file)
    _save(file, TARGETS_FILE)

    try:
        targets = parse_targets(TARGETS_FILE)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Parse error: {exc}") from exc

    return {"ok": True, "stores": len(targets)}


@app.get("/api/data")
def get_dashboard_data():
    """Return the merged dashboard payload.

    If no sales file has been uploaded yet, returns an empty payload with
    no_data=True so the frontend can show the upload prompt instead of
    crashing.
    """
    if not os.path.exists(SALES_FILE):
        return {
            "no_data": True,
            "stores": [],
            "months": [],
            "states": [],
            "categories": [],
            "has_targets": False,
            "warnings": [],
        }

    try:
        stores = parse_sales(SALES_FILE)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to read sales data: {exc}") from exc

    has_targets = os.path.exists(TARGETS_FILE)
    targets: dict[str, float] = {}
    warnings: list[str] = []

    if has_targets:
        try:
            targets = parse_targets(TARGETS_FILE)
            # Cross-validate store IDs using raw DataFrames
            sales_df = pd.read_excel(SALES_FILE)
            target_df = pd.read_excel(TARGETS_FILE)
            warnings = validate_store_match(sales_df, target_df)
        except Exception as exc:
            logger.warning("Targets file could not be processed: %s", exc)
            has_targets = False

    # Attach per-store target (None if not in targets file)
    for store in stores:
        store["target"] = targets.get(store["store_id"])

    months = _extract_months(stores)
    states = sorted({s["state"] for s in stores if s["state"]})
    categories = sorted({s["category"] for s in stores if s["category"]})

    return {
        "no_data": False,
        "stores": stores,
        "months": months,
        "states": states,
        "categories": categories,
        "has_targets": has_targets,
        "warnings": warnings,
    }


@app.get("/api/stores/{store_id}")
def get_store_detail(store_id: str):
    """Return a single store's full record including all monthly revenue."""
    if not os.path.exists(SALES_FILE):
        raise HTTPException(status_code=404, detail="No sales data uploaded yet.")

    try:
        stores = parse_sales(SALES_FILE)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    store = next((s for s in stores if s["store_id"] == store_id), None)
    if store is None:
        raise HTTPException(status_code=404, detail=f"Store '{store_id}' not found.")

    if os.path.exists(TARGETS_FILE):
        try:
            store["target"] = parse_targets(TARGETS_FILE).get(store_id)
        except Exception:
            store["target"] = None
    else:
        store["target"] = None

    return store


# ── Generic file-explorer endpoints (compatibility) ───────────────────────────


@app.post("/api/upload")
async def upload_file(file: UploadFile = File(...)):
    """Generic XLSX upload for the sheet-explorer UI."""
    global _uploaded_file
    _validate_excel(file)
    dest = os.path.join(DATA_DIR, file.filename)  # type: ignore[arg-type]
    _save(file, dest)
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
