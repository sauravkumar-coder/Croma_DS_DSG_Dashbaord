"""
models.py — MongoDB collection definitions (Beanie ODM).

Single source of truth for the database schema.  Every collection used by
the application is defined here as a Beanie Document subclass.

Collections:
    Store              — Store master data (name, location, category, tier)
    Brand              — Brand master data
    ProductCategory    — Product category master data
    StoreBrand         — Store ↔ Brand mapping (junction table)
    SalesRecord        — Monthly + daily sales per (store, brand, category, year)
    StoreTarget        — Monthly revenue/unit targets per (store, brand, category, year)
    ProductModel       — Product model master data
    ProductSubCategory — Product sub-category master data
"""

from datetime import datetime
from enum import Enum
from typing import Optional

from beanie import Document
from bson import ObjectId
from pydantic import BaseModel, Field


# ── Enums ──────────────────────────────────────────────────────────────────────

class PartnerBrandType(str, Enum):
    NONE      = "NONE"
    PRIMARY   = "PRIMARY"
    SECONDARY = "SECONDARY"
    TERTIARY  = "TERTIARY"


class Priority(str, Enum):
    HIGH   = "HIGH"
    MEDIUM = "MEDIUM"
    LOW    = "LOW"


class PlanType(str, Enum):
    ADLD  = "ADLD"
    SP    = "SP"
    COMBO = "COMBO"
    EW    = "EW"


# ── Nested models for JSON fields ──────────────────────────────────────────────

class MonthlySalesEntry(BaseModel):
    """One entry inside SalesRecord.monthlySales list."""
    month:       int            # 1–12
    deviceSales: int   = 0
    planSales:   int   = 0
    attachPct:   float = 0.0
    revenue:     float = 0.0


class DailySalesEntry(BaseModel):
    """One row inside a month's daily sales list."""
    date:      str            # "DD-MM-YYYY"
    planSales: int   = 0
    revenue:   float = 0.0


# dailySales is stored as dict[str, list[DailySalesEntry]]
# key = month number as string ("1" … "12")
# e.g. { "1": [{date, planSales, revenue}, ...], "6": [...] }


# ── Collection 1: Store ────────────────────────────────────────────────────────

class Store(Document):
    id: str = Field(..., alias="_id")           # custom string ID from source

    storeName:         str
    city:              Optional[str]   = None
    fullAddress:       Optional[str]   = None
    latitude:          Optional[float] = None   # geocoded via Google Places
    longitude:         Optional[float] = None   # geocoded via Google Places

    storeCategory: Optional[str] = None
    storeChannel:  Optional[str] = None
    cityTier:      Optional[str] = None
    state:         Optional[str] = None
    priority:      Optional[Priority] = None

    # Relations stored as ID lists (no joins in MongoDB)
    # visits, digitalVisits, executiveStores, adminVisits → separate collections
    # alignment → separate collection (StoreAlignment, not defined here)

    class Settings:
        name = "Store"


# ── Collection 2: Brand ────────────────────────────────────────────────────────

class Brand(Document):
    id: str = Field(..., alias="_id")           # custom string ID from source

    brandName: str

    class Settings:
        name = "Brand"


# ── Collection 3: ProductCategory ─────────────────────────────────────────────

class ProductCategory(Document):
    id: str = Field(..., alias="_id")           # custom string ID from source

    categoryName: str

    class Settings:
        name = "ProductCategory"


# ── Collection 4: StoreBrand (junction) ───────────────────────────────────────
# Represents the many-to-many relationship between Store and Brand.

class StoreBrand(Document):
    storeId:      str
    brandId:      str
    storeBrandId: Optional[str] = None          # external mapping ID if any
    brandType:    PartnerBrandType = PartnerBrandType.NONE

    class Settings:
        name = "StoreBrand"


# ── Collection 5: SalesRecord ─────────────────────────────────────────────────
# One document per (store, brand, category, year).
# Holds both monthly summary and daily breakdown.

class SalesRecord(Document):
    storeId:           str
    brandId:           str
    productCategoryId: str
    year:              int

    # Monthly summary — 12 entries, one per month
    # [{ month: 1, deviceSales, planSales, attachPct, revenue }, ...]
    monthlySales: list[MonthlySalesEntry] = []

    # Daily sales grouped by month number (string key "1"…"12")
    # { "1": [{ date, planSales, revenue }, ...], "6": [...] }
    # ⚠️ Only planSales + revenue tracked at daily level (not deviceSales/attachPct)
    dailySales: dict[str, list[DailySalesEntry]] = {}

    class Settings:
        name = "SalesRecord"


# ── Collection 6: StoreTarget ─────────────────────────────────────────────────
# Monthly revenue + unit targets per store per brand per category.

class StoreTarget(Document):
    storeId:           str
    brandId:           str
    productCategoryId: str
    month:             int            # 1–12
    year:              int            # e.g. 2026

    targetRevenue: Optional[float] = None
    targetUnits:   Optional[int]   = None

    class Settings:
        name = "StoreTarget"


# ── Collection 7: ProductModel ─────────────────────────────────────────────────

class ProductModel(Document):
    name:      str
    createdAt: datetime = Field(default_factory=datetime.utcnow)
    updatedAt: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        name = "ProductModel"


# ── Collection 8: ProductSubCategory ──────────────────────────────────────────

class ProductSubCategory(Document):
    name:      str
    createdAt: datetime = Field(default_factory=datetime.utcnow)
    updatedAt: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        name = "ProductSubCategory"
