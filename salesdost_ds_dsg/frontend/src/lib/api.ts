import axios from 'axios'

const api = axios.create({
  baseURL: (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8000',
})

export interface StoreRecord {
  store_id: string
  store_name?: string
  state?: string
  category?: string
  monthly_sales: Record<string, number>
  monthly_plans_count?: Record<string, number>
  target?: number | null
  zonal_manager?: string
  cluster_manager?: string
}

export interface DashboardData {
  no_data: boolean
  stores: StoreRecord[]
  months: string[]
  states: string[]
  categories: string[]
  has_targets: boolean
  target_month?: string | null
  warnings: string[]
}

export const getDashboardData = () => api.get<DashboardData>('/api/data')

// ── Target Tracker ─────────────────────────────────────────────────────────────

export interface TrackerSalesMeta {
  month: string
  filename: string
  file_size_kb: number
  uploaded_at: string
}

export interface TrackerMonthStatus {
  month: string
  has_target: boolean
  has_sales: boolean
  is_active_target: boolean
  target_meta: null
  sales_meta: TrackerSalesMeta | null
}

export interface TrackerStatus {
  active_target_month: string | null
  months: TrackerMonthStatus[]
}

export interface TrackerTargetRow {
  store_key: string
  store_name: string
  head_operations: string
  zonal_manager: string
  cluster_manager: string
  target: number
}

export interface TrackerSalesRow {
  store_name: string
  store_key: string
  sales: number
  day: number
  state: string
}

export interface TrackerData {
  month: string
  has_target: boolean
  has_sales: boolean
  targets: TrackerTargetRow[]
  raw_target_row_count: number
  sales_rows: TrackerSalesRow[]
  max_elapsed: number
  detected_month: string | null
  latest_sales_date: string | null
}

export const getTrackerStatus = () =>
  api.get<TrackerStatus>('/api/tracker/status')

export const getTrackerData = (month: string) =>
  api.get<TrackerData>(`/api/tracker/data?month=${encodeURIComponent(month)}`)
