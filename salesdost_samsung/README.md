# StoreWise — Analytics Dashboard

Upload any `.xlsx` / `.xls` file and instantly explore it with interactive charts, KPI cards, and a paginated data table. No data is hardcoded — everything comes from the uploaded file.

## Tech Stack

| Layer    | Stack                                                                 |
| -------- | --------------------------------------------------------------------- |
| Frontend | React 18 · TypeScript · Vite · Tailwind CSS · shadcn/ui · Plotly.js · Framer Motion |
| Backend  | FastAPI · Pandas · openpyxl · uvicorn                                 |

## Project Structure

```
StoreWise/
├── frontend/               # React + Vite app
│   ├── src/
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── ui/tabs.tsx
│   │   │   ├── Header.tsx
│   │   │   ├── UploadSection.tsx
│   │   │   ├── SheetSelector.tsx
│   │   │   ├── KPICards.tsx
│   │   │   ├── ChartPanel.tsx
│   │   │   └── DataTable.tsx
│   │   └── lib/
│   │       ├── api.ts
│   │       └── utils.ts
│   ├── package.json
│   └── vite.config.ts
├── backend/                # FastAPI app
│   ├── main.py             # Routes + CORS
│   ├── parser.py           # XLSX parsing logic
│   ├── requirements.txt
│   └── data/               # Uploaded files land here
├── .gitignore
└── README.md
```

## Setup

### 1 · Backend

```bash
cd backend

# Create and activate a virtual environment
python -m venv venv

# Windows
venv\Scripts\activate
# macOS / Linux
source venv/bin/activate

pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

API runs at **http://localhost:8000**  
Interactive docs: **http://localhost:8000/docs**

### 2 · Frontend

```bash
cd frontend
npm install
npm run dev
```

App runs at **http://localhost:5173**

> The Vite dev server proxies `/api/*` requests to the FastAPI backend automatically.

## API Reference

| Method | Path                         | Description                          |
| ------ | ---------------------------- | ------------------------------------ |
| GET    | `/api/health`                | Health check → `{"status":"ok"}`     |
| POST   | `/api/upload`                | Upload an XLSX file (multipart/form-data, field: `file`) |
| GET    | `/api/sheets`                | List sheet names in the uploaded file |
| GET    | `/api/data/{sheet_name}`     | Raw rows + columns for a sheet       |
| GET    | `/api/analysis/{sheet_name}` | KPIs, bar-chart data, distributions  |

## Features

- **Drag-and-drop upload** with animated feedback
- **Multi-sheet support** — tab selector auto-generated from the workbook
- **KPI cards** — row count + sum/avg for up to 4 numeric columns
- **Bar charts** — top-20 aggregations for each categorical × numeric pair
- **Histograms** — value distributions for numeric columns
- **Data table** — paginated (25 rows/page) with row numbers
- **Dark theme** throughout with smooth Framer Motion transitions
