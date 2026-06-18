# Croma Analytics — DS & DSG Store Intelligence Dashboard

Real-time retail store analytics dashboard for the Croma DS/DSG network.
Sales data and targets are read live from MongoDB; no file uploads are required.

---

## Architecture

```
MongoDB (zoppertrack)
  ↓
FastAPI backend  (backend/)
  Collections: Store · Brand · Category · StoreBrand · SalesRecord · StoreTarget
  ↓  HTTP /api/*
React + Vite frontend  (frontend/)
  10 dashboard tabs: Overview · Revenue Trend · Store Journeys · State Health
                     Geo Map · Top Movers · Rising Stores · Fallen Stores
                     Store Spotlight · Target Pulse
```

### Backend layer structure

```
backend/
├── main.py                   # FastAPI app, routes, CORS, lifespan
├── models.py                 # Beanie ODM document definitions (schema reference)
├── requirements.txt
├── .env.example              # Environment variable template
├── app/
│   └── core/
│       ├── config.py         # All settings via pydantic-settings (single source)
│       └── database.py       # Motor client, Beanie init, index creation
├── repositories/             # Raw MongoDB access (Motor only, no Beanie .find())
│   ├── brand_repository.py
│   ├── sales_repository.py
│   ├── store_repository.py
│   └── target_repository.py
├── services/                 # Business logic (KPIs, trends, classifications)
│   ├── analytics_service.py
│   ├── dashboard_service.py
│   ├── store_service.py
│   └── target_service.py
├── shared/
│   └── date_utils.py         # Month labels, trend computation
└── mock/                     # Fallback JSON for USE_MOCK_DATA=true
    ├── brands.json
    ├── categories.json
    ├── sales_records.json
    ├── stores.json
    └── targets.json
```

---

## Tech Stack

| Layer    | Stack |
|----------|-------|
| Frontend | React 18 · TypeScript · Vite · Tailwind CSS · Plotly.js · Framer Motion · axios |
| Backend  | Python 3.12 · FastAPI · Motor (async MongoDB) · Beanie ODM · pydantic-settings |
| Database | MongoDB (Motor raw queries in repositories — Beanie used for schema reference only) |

---

## Local Development

### Prerequisites

- Python 3.11+
- Node.js 18+
- MongoDB instance (local or Atlas)

### 1 · Backend

```bash
cd backend

# Create and activate a virtual environment
python -m venv venv
venv\Scripts\activate        # Windows
# source venv/bin/activate   # macOS / Linux

pip install -r requirements.txt

# Copy the env template and fill in your values
cp .env.example .env

# Start the API server
uvicorn main:app --reload --port 8000
```

API runs at **http://localhost:8000**
Interactive docs: **http://localhost:8000/docs**
Health check: **http://localhost:8000/api/health**

### 2 · Frontend

```bash
cd frontend
npm install

# Optional: copy env template (only needed when VITE_API_URL differs from default)
cp .env.example .env

npm run dev
```

Frontend runs at **http://localhost:5173**

The Vite dev server proxies all `/api/*` requests to `http://localhost:8000` automatically — no `VITE_API_URL` needed during development.

---

## Environment Variables

### Backend (`backend/.env`)

| Variable | Default | Required in prod | Description |
|----------|---------|-----------------|-------------|
| `MONGO_URI` | *(empty)* | Yes | MongoDB connection string |
| `DATABASE_NAME` | `ds_dsg_tracker` | No | Informational only (URI database takes precedence) |
| `BRAND_ID` | `brand_007` | No | Brand whose data is shown |
| `BRAND_USES_DAILY_SALES` | `true` | No | Read revenue from `dailySales` instead of `monthlySales` |
| `STORE_COLLECTION` | `Store` | No | MongoDB collection name |
| `BRAND_COLLECTION` | `Brand` | No | MongoDB collection name |
| `CATEGORY_COLLECTION` | `Category` | No | MongoDB collection name |
| `SALES_RECORD_COLLECTION` | `SalesRecord` | No | MongoDB collection name |
| `STORE_TARGET_COLLECTION` | `StoreTarget` | No | MongoDB collection name |
| `STORE_BRAND_COLLECTION` | `StoreBrand` | No | MongoDB collection name |
| `ALLOWED_ORIGINS` | `*` | Yes | Comma-separated CORS origins |
| `USE_MOCK_DATA` | `true` | Yes | `false` to use MongoDB; `true` for mock JSON |
| `ENVIRONMENT` | `development` | Yes | `production` enables startup validation |

### Frontend (`frontend/.env`)

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_API_URL` | `http://localhost:8000` | Backend base URL for production builds |

---

## Mock Mode vs Live MongoDB

```
USE_MOCK_DATA=true   → backend serves data from backend/mock/*.json
                       No MongoDB connection required.
                       Useful for local development without a database.

USE_MOCK_DATA=false  → backend queries MongoDB via Motor.
                       MONGO_URI must be set.
                       In ENVIRONMENT=production, startup fails immediately
                       if MONGO_URI is missing (prevents silent empty dashboard).
```

### Switching to live MongoDB

1. Set `MONGO_URI=<your connection string>` in `backend/.env`
2. Set `USE_MOCK_DATA=false` in `backend/.env`
3. Restart: `uvicorn main:app --reload`

---

## MongoDB Collections & Indexes

The application uses these collections (all in the database named in the URI):

| Collection | Purpose |
|------------|---------|
| `Store` | Store master: name, city, state, category, geo-coordinates |
| `Brand` | Brand master (e.g. brand_007 = DSDSG/Croma) |
| `Category` | Category master |
| `StoreBrand` | Store ↔ Brand mapping; holds `storeBrandId` business codes |
| `SalesRecord` | Monthly/daily revenue per (store, brand, category, year) |
| `StoreTarget` | Monthly revenue targets per (store, brand, category, year, month) |

Indexes are created automatically on startup via `ensure_indexes()` in `database.py`:

| Collection | Index |
|------------|-------|
| `SalesRecord` | `(year, brandId)` · `(storeId, year)` |
| `StoreTarget` | `(year, brandId)` · `(storeId, year)` · `(year, month, brandId)` |
| `StoreBrand` | `(brandId, storeBrandId)` |
| `Store` | `(state)` |

---

## API Routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check — returns `use_mock_data`, `mongo_configured`, `environment` |
| GET | `/api/data` | Main dashboard payload (StoreRecord shape for DataContext) |
| GET | `/api/dashboard/overview` | Aggregated KPIs for current year |
| GET | `/api/stores` | All stores with YTD revenue + achievement |
| GET | `/api/stores/rising-stars` | Stores with consistent upward revenue trend |
| GET | `/api/stores/fallen-stars` | Stores with consistent downward revenue trend |
| GET | `/api/stores/journey` | Month-over-month revenue per store |
| GET | `/api/stores/new-bloomers` | New stores with strong ramp-up growth |
| GET | `/api/stores/{store_id}` | Single-store detail with monthly breakdown |
| GET | `/api/analytics/brands` | Revenue breakdown by brand |
| GET | `/api/targets` | Target achievement summary |
| GET | `/api/tracker/status` | Which months have target + sales data |
| GET | `/api/tracker/data?month=Jun-2026` | Tracker data for a specific month |

---

## AWS Deployment

### Backend (EC2 / ECS)

```bash
# On the server
pip install -r requirements.txt

# Set production environment variables
export MONGO_URI="mongodb+srv://user:pass@cluster.mongodb.net/zoppertrack"
export USE_MOCK_DATA=false
export ENVIRONMENT=production
export ALLOWED_ORIGINS=https://your-dashboard.example.com

uvicorn main:app --host 0.0.0.0 --port 8000 --workers 2
```

### Frontend (S3 + CloudFront)

```bash
cd frontend

# Set the backend URL at build time
echo "VITE_API_URL=https://api.your-dashboard.example.com" > .env

npm run build
# Upload dist/ to your S3 bucket
aws s3 sync dist/ s3://your-bucket-name --delete
```

Configure CloudFront to redirect all 404s to `/index.html` for React Router support.

---

## Authentication

Authentication and authorization are handled externally (e.g. AWS Cognito, nginx auth, VPN restriction) — the FastAPI application itself does not implement auth. All `/api/*` routes are open to requests that reach the server.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| "No Data in MongoDB" on dashboard | Sales year mismatch — backend auto-detects most recent year with data | Check `/api/health` and `/api/dashboard/overview?year=2025` |
| "No Tracker Data in MongoDB" | No `StoreTarget` docs for current year/month | Verify `StoreTarget` collection has docs for current month |
| Backend starts but returns empty | `USE_MOCK_DATA=false` but `MONGO_URI` empty or wrong | Check `/api/health` → `mongo_configured` field |
| CORS errors in browser | `ALLOWED_ORIGINS` does not include frontend origin | Add frontend URL to `ALLOWED_ORIGINS` in backend `.env` |
| `Brand.find()` or schema errors | Beanie ODM validation fails on production schema | Repositories use raw Motor — this should not occur; check logs |
| Index creation warnings on startup | Conflicting index names in existing DB | Non-fatal; existing indexes are reused |
