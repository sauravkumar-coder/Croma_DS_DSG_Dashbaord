"""
app/core/config.py — Single source of truth for all environment variables.

All settings are loaded once via pydantic-settings.
Nothing else in the codebase should read os.environ or dotenv directly
for these values — import `settings` from here instead.

To switch from mock mode to live MongoDB:
  1. Set MONGO_URI=<your connection string> in .env
  2. Set USE_MOCK_DATA=false in .env
  3. Restart the application
"""

import os
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict

# .env lives next to main.py, two levels up from this file
_ENV_FILE = os.path.join(os.path.dirname(__file__), "..", "..", ".env")


class Settings(BaseSettings):
    # ── MongoDB ───────────────────────────────────────────────────────────────
    MONGO_URI: str = ""
    DATABASE_NAME: str = "ds_dsg_tracker"

    # ── Brand filter — only this brand's data is shown in the dashboard ─────────
    BRAND_ID: str = "brand_007"
    # brand_007 stores sales in dailySales (not monthlySales); set False if that changes
    BRAND_USES_DAILY_SALES: bool = True

    # ── Collection names — must match models.py Settings.name values ──────────
    STORE_COLLECTION: str = "Store"
    BRAND_COLLECTION: str = "Brand"
    CATEGORY_COLLECTION: str = "Category"
    SALES_RECORD_COLLECTION: str = "SalesRecord"
    STORE_TARGET_COLLECTION: str = "StoreTarget"
    STORE_BRAND_COLLECTION: str = "StoreBrand"

    # ── CORS ──────────────────────────────────────────────────────────────────
    # Comma-separated list of allowed origins.
    # Production example: ALLOWED_ORIGINS=https://croma-dashboard.example.com
    ALLOWED_ORIGINS: str = "*"

    # ── Feature flags ─────────────────────────────────────────────────────────
    USE_MOCK_DATA: bool = True
    ENVIRONMENT: str = "development"

    model_config = SettingsConfigDict(
        env_file=_ENV_FILE,
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
