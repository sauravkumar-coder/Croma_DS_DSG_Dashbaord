"""
storage.py — Centralized file storage abstraction layer.

All file I/O goes through this module. To migrate to AWS S3:
  1. Replace _write / _read / _delete / _ls primitives with boto3 equivalents
  2. Update DATA_DIR / TARGETS_DIR / etc. to S3 bucket key prefixes
  3. Remove _ensure_dirs() calls (S3 has no directories)

Dashboard logic, Target Tracker, charts, KPIs, filters, and insights
require ZERO changes when migrating to AWS.

Storage policy:
  - Sales data (main dashboard): held in-memory only; never written to disk.
    On restart / refresh, the user must re-upload.
  - Target files: persisted to data/targets/  (one file per month)
  - Tracker monthly sales: persisted to data/sales/monthly/

Folder layout:
  data/
  ├── targets/                    ← YYYY-MM_target.xlsx  (one per month)
  ├── sales/
  │   └── monthly/                ← YYYY-MM_tracker_sales.xlsx (target tracker)
  ├── metadata/
  │   └── target_registry.json
  └── cache/

To migrate to S3StorageProvider later:
  - Replace the _write / _read / _delete / _ls primitives below with boto3 calls.
  - Dashboard pages need ZERO changes.
"""

import json
import logging
import os
import re
import shutil
from datetime import datetime
from typing import Any

import pandas as pd

logger = logging.getLogger(__name__)

# ── Path constants ─────────────────────────────────────────────────────────────

_BASE        = os.path.dirname(__file__)
DATA_DIR     = os.path.join(_BASE, "data")
TARGETS_DIR  = os.path.join(DATA_DIR, "targets")
SALES_DIR    = os.path.join(DATA_DIR, "sales")
MONTHLY_DIR  = os.path.join(SALES_DIR, "monthly")
METADATA_DIR = os.path.join(DATA_DIR, "metadata")
CACHE_DIR    = os.path.join(DATA_DIR, "cache")

TARGET_REGISTRY = os.path.join(METADATA_DIR, "target_registry.json")

_MONTH_IDX: dict[str, int] = {
    m: i + 1
    for i, m in enumerate(
        ["jan", "feb", "mar", "apr", "may", "jun",
         "jul", "aug", "sep", "oct", "nov", "dec"]
    )
}
_IDX_MONTH: dict[int, str] = {v: k.capitalize() for k, v in _MONTH_IDX.items()}

_MONTH_LABEL_RE = re.compile(
    r"^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-\d{4}$",
    re.IGNORECASE,
)


def _ensure_dirs() -> None:
    for d in [TARGETS_DIR, MONTHLY_DIR, METADATA_DIR, CACHE_DIR]:
        os.makedirs(d, exist_ok=True)


_ensure_dirs()


# ── Low-level primitives (swap these for boto3 when migrating to S3) ──────────


def save_file(path: str, content: bytes) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(content)


def load_file(path: str) -> bytes | None:
    if not os.path.exists(path):
        return None
    with open(path, "rb") as f:
        return f.read()


def delete_file(path: str) -> None:
    if os.path.exists(path):
        os.remove(path)


def list_files(folder: str, suffix: str = "") -> list[str]:
    if not os.path.exists(folder):
        return []
    return sorted(f for f in os.listdir(folder) if not suffix or f.endswith(suffix))


def file_exists(path: str) -> bool:
    return os.path.exists(path)


def _size_kb(path: str) -> float:
    if not os.path.exists(path):
        return 0.0
    return round(os.path.getsize(path) / 1024, 1)


def _mtime(path: str) -> str:
    if not os.path.exists(path):
        return ""
    return datetime.fromtimestamp(os.path.getmtime(path)).isoformat(timespec="seconds")


# ── Registry helpers ───────────────────────────────────────────────────────────


def _read_json(path: str) -> Any:
    if not os.path.exists(path):
        return {}
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return {}


def _write_json(path: str, data: Any) -> None:
    with open(path, "w") as f:
        json.dump(data, f, indent=2)


# ── Month label utilities ──────────────────────────────────────────────────────


def validate_month_label(label: str) -> bool:
    return bool(_MONTH_LABEL_RE.match(label.strip()))


def _label_to_target_filename(month_label: str) -> str:
    """'Jun-2026' → '2026-06_target.xlsx'"""
    parts = month_label.strip().split("-")
    if len(parts) == 2:
        name, year = parts
        idx = _MONTH_IDX.get(name.lower(), 0)
        return f"{year}-{idx:02d}_target.xlsx"
    return f"{month_label}_target.xlsx"


def _target_filename_to_label(filename: str) -> str | None:
    """'2026-06_target.xlsx' → 'Jun-2026'"""
    stem = filename.replace("_target.xlsx", "")
    try:
        year_str, mon_str = stem.split("-")
        mon_idx = int(mon_str)
        return f"{_IDX_MONTH[mon_idx]}-{year_str}"
    except Exception:
        return None


def _label_sort_key(label: str) -> tuple[int, int]:
    parts = label.split("-")
    if len(parts) != 2:
        return (9999, 99)
    name, year = parts
    return (int(year) if year.isdigit() else 9999,
            _MONTH_IDX.get(name.lower(), 99))


# ── Target file API ────────────────────────────────────────────────────────────


def target_filepath(month_label: str) -> str:
    return os.path.join(TARGETS_DIR, _label_to_target_filename(month_label))


def target_file_exists(month_label: str) -> bool:
    return file_exists(target_filepath(month_label))


def _compute_target_meta(path: str, month_label: str, status: str) -> dict[str, Any]:
    meta: dict[str, Any] = {
        "month":        month_label,
        "filename":     os.path.basename(path),
        "uploaded_at":  _mtime(path),
        "file_size_kb": _size_kb(path),
        "status":       status,
        "store_count":  0,
        "total_target": 0.0,
    }
    try:
        df = pd.read_excel(path)
        meta["store_count"] = len(df)
        for col in df.columns:
            cl = str(col).strip().lower()
            if cl in ("oow", "store target", "monthly target", "target"):
                meta["total_target"] = float(
                    pd.to_numeric(df[col], errors="coerce").fillna(0).sum()
                )
                break
    except Exception:
        pass
    return meta


def save_target_file(content: bytes, month_label: str) -> dict[str, Any]:
    """Save target bytes and update registry. Returns metadata dict."""
    path = target_filepath(month_label)
    save_file(path, content)

    registry = _read_json(TARGET_REGISTRY)
    if not isinstance(registry, dict):
        registry = {}
    prev_status = registry.get(month_label, {}).get("status", "inactive")
    meta = _compute_target_meta(path, month_label, prev_status)
    registry[month_label] = meta
    _write_json(TARGET_REGISTRY, registry)
    return meta


def load_target_file(month_label: str) -> bytes | None:
    return load_file(target_filepath(month_label))


def list_target_files() -> list[dict[str, Any]]:
    """Return all target files present on disk, registry cleaned of orphans."""
    registry = _read_json(TARGET_REGISTRY)
    if not isinstance(registry, dict):
        registry = {}

    active_month = _get_active_month_from_registry(registry)
    seen: set[str] = set()
    results: list[dict[str, Any]] = []

    for fname in list_files(TARGETS_DIR, "_target.xlsx"):
        label = _target_filename_to_label(fname)
        if label is None:
            continue
        seen.add(label)
        path = os.path.join(TARGETS_DIR, fname)
        status = "active" if label == active_month else "inactive"
        meta = registry.get(label) or _compute_target_meta(path, label, status)
        meta["status"] = status
        results.append(meta)

    # Purge registry entries whose files are gone
    for label in list(registry.keys()):
        if label not in seen:
            del registry[label]
    _write_json(TARGET_REGISTRY, registry)

    return sorted(results, key=lambda x: _label_sort_key(x.get("month", "")), reverse=True)


def _get_active_month_from_registry(registry: dict[str, Any]) -> str | None:
    for month, meta in registry.items():
        if isinstance(meta, dict) and meta.get("status") == "active":
            return month
    return None


def get_active_target_month() -> str | None:
    registry = _read_json(TARGET_REGISTRY)
    if not isinstance(registry, dict):
        return None
    return _get_active_month_from_registry(registry)


def set_active_target(month_label: str) -> dict[str, Any]:
    """Make month_label the active target."""
    path = target_filepath(month_label)
    if not file_exists(path):
        raise FileNotFoundError(f"No target file for month '{month_label}'")

    registry = _read_json(TARGET_REGISTRY)
    if not isinstance(registry, dict):
        registry = {}
    for m in registry:
        if isinstance(registry[m], dict):
            registry[m]["status"] = "inactive"

    meta = _compute_target_meta(path, month_label, "active")
    registry[month_label] = meta
    _write_json(TARGET_REGISTRY, registry)
    return meta


def archive_target_file(month_label: str) -> dict[str, Any]:
    """Move target to data/archive/."""
    path = target_filepath(month_label)
    if not file_exists(path):
        raise FileNotFoundError(f"No target file for month '{month_label}'")

    archive_dir = os.path.join(DATA_DIR, "archive")
    os.makedirs(archive_dir, exist_ok=True)
    archive_path = os.path.join(archive_dir, os.path.basename(path))
    shutil.move(path, archive_path)

    registry = _read_json(TARGET_REGISTRY)
    if not isinstance(registry, dict):
        registry = {}
    meta = _compute_target_meta(archive_path, month_label, "archived")
    registry.pop(month_label, None)
    _write_json(TARGET_REGISTRY, registry)
    return meta


def delete_target_file(month_label: str) -> None:
    """Permanently delete a target file."""
    path = target_filepath(month_label)
    registry = _read_json(TARGET_REGISTRY)
    if isinstance(registry, dict):
        registry.pop(month_label, None)
        _write_json(TARGET_REGISTRY, registry)
    delete_file(path)


# ── Sales file API (tracker monthly sales) ─────────────────────────────────────
#
# These persist to disk so the Target Tracker can reload data across sessions.
# For the main dashboard, sales data is in-memory only (see main.py).


def _tracker_sales_filename(month_label: str) -> str:
    """'Jun-2026' → '2026-06_tracker_sales.xlsx'"""
    parts = month_label.strip().split("-")
    if len(parts) == 2:
        name, year = parts
        idx = _MONTH_IDX.get(name.lower(), 0)
        return f"{year}-{idx:02d}_tracker_sales.xlsx"
    return f"{month_label}_tracker_sales.xlsx"


def tracker_sales_filepath(month_label: str) -> str:
    return os.path.join(MONTHLY_DIR, _tracker_sales_filename(month_label))


def tracker_sales_exists(month_label: str) -> bool:
    return file_exists(tracker_sales_filepath(month_label))


def save_tracker_sales(content: bytes, month_label: str) -> dict[str, Any]:
    path = tracker_sales_filepath(month_label)
    save_file(path, content)
    return {
        "month":        month_label,
        "filename":     os.path.basename(path),
        "file_size_kb": _size_kb(path),
        "uploaded_at":  _mtime(path),
    }


# Abstract aliases per the storage interface spec
save_sales_file = save_tracker_sales


def load_sales_file(month_label: str) -> bytes | None:
    """Load tracker monthly sales file. Returns None if not found."""
    return load_file(tracker_sales_filepath(month_label))


def delete_tracker_sales(month_label: str) -> None:
    delete_file(tracker_sales_filepath(month_label))


def list_tracker_sales() -> list[dict[str, Any]]:
    """Return all persisted tracker sales files."""
    results = []
    for fname in list_files(MONTHLY_DIR, "_tracker_sales.xlsx"):
        stem = fname.replace("_tracker_sales.xlsx", "")
        try:
            year_str, mon_str = stem.split("-")
            mon_idx = int(mon_str)
            label = f"{_IDX_MONTH[mon_idx]}-{year_str}"
        except Exception:
            continue
        path = os.path.join(MONTHLY_DIR, fname)
        results.append({
            "month":        label,
            "filename":     fname,
            "file_size_kb": _size_kb(path),
            "uploaded_at":  _mtime(path),
        })
    return sorted(results, key=lambda x: _label_sort_key(x.get("month", "")), reverse=True)


# ── Convenience aliases ────────────────────────────────────────────────────────


def get_month_target(month_label: str) -> str | None:
    """Return path to target file for the given month, or None."""
    path = target_filepath(month_label)
    return path if file_exists(path) else None


def get_month_sales(month_label: str) -> str | None:
    """Return path to tracker sales for the given month, or None."""
    path = tracker_sales_filepath(month_label)
    return path if file_exists(path) else None


def storage_status() -> dict[str, Any]:
    """Return a snapshot of all persisted files (targets + tracker sales).

    Note: main dashboard sales data is in-memory only and is NOT reported here.
    The caller (main.py) enriches this with the in-memory sales state.
    """
    return {
        "active_target_month": get_active_target_month(),
        "target_files":        list_target_files(),
        "tracker_sales":       list_tracker_sales(),
    }
