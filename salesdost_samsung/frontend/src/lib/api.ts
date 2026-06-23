import axios from 'axios'

const api = axios.create({
  baseURL: (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3004',
})

// In production, when using relative paths (baseURL is empty), prepend '/analytics/samsung'
if (import.meta.env.PROD && !import.meta.env.VITE_API_URL) {
  api.interceptors.request.use((config) => {
    if (config.url && config.url.startsWith('/api')) {
      config.url = `/analytics/samsung${config.url}`
    }
    return config
  })
}

export interface StoreRecord {
  store_id: string
  store_name?: string
  state?: string
  category?: string
  monthly_sales: Record<string, number>
  monthly_sales_ds?: Record<string, number>
  monthly_sales_dsg?: Record<string, number>
  monthly_sales_sp?: Record<string, number>
  monthly_sales_adld?: Record<string, number>
  monthly_sales_combo?: Record<string, number>
  monthly_sales_ew?: Record<string, number>
  monthly_plans_count?: Record<string, number>
  /** Samsung main-unit volume sold per month (used to compute attach %) */
  monthly_main_qty?: Record<string, number>
  /** Attach percentage per month = plans / main_qty (0–1 range) */
  monthly_attach_pct?: Record<string, number>
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

export const getDashboardData = (retailer?: string) =>
  api.get<DashboardData>(
    retailer
      ? `/api/data?retailer=${encodeURIComponent(retailer)}`
      : '/api/data'
  )

// ── Retailer-specific upload / meta helpers ───────────────────────────────────

export const uploadRetailerSales = (
  retailer: string,
  file: File,
  onProgress?: (pct: number) => void,
  force = false,
) => {
  const form = new FormData()
  form.append('file', file)
  const endpoint = `/api/upload/sales/${encodeURIComponent(retailer.toLowerCase())}?force=${force}`
  return api.post<UploadSalesResult>(endpoint, form, {
    onUploadProgress: e =>
      onProgress?.(Math.round((e.loaded * 100) / (e.total ?? 1))),
  })
}

export const deleteRetailerSales = (retailer: string) =>
  api.delete<{ ok: boolean }>(`/api/storage/sales/${encodeURIComponent(retailer.toLowerCase())}`)

export const getRetailerSalesMeta = (retailer: string) =>
  api.get<SalesMetaResult>(`/api/sales/meta/${encodeURIComponent(retailer.toLowerCase())}`)

export interface UploadSalesResult {
  ok: boolean
  stores: number
  months: string[]
  needs_confirm: boolean
  existing?: SalesFileMeta
}
export interface UploadTargetsResult {
  ok: boolean
  stores: number
}

export const uploadSales = (
  file: File,
  onProgress?: (pct: number) => void,
  force = false,
) => {
  const form = new FormData()
  form.append('file', file)
  return api.post<UploadSalesResult>(`/api/upload/sales?force=${force}`, form, {
    onUploadProgress: e =>
      onProgress?.(Math.round((e.loaded * 100) / (e.total ?? 1))),
  })
}

export const uploadTargets = (
  file: File,
  onProgress?: (pct: number) => void,
) => {
  const form = new FormData()
  form.append('file', file)
  return api.post<UploadTargetsResult>('/api/upload/targets', form, {
    onUploadProgress: e =>
      onProgress?.(Math.round((e.loaded * 100) / (e.total ?? 1))),
  })
}

export const loadDemoData = (retailer?: string) =>
  api.post<UploadSalesResult>(
    retailer ? `/api/demo/load?retailer=${encodeURIComponent(retailer)}` : '/api/demo/load'
  )

// ── Storage management ────────────────────────────────────────────────────────

export interface SalesFileMeta {
  filename: string
  uploaded_at: string
  file_size_kb: number
  record_count: number
}

export interface StorageStatus {
  has_combined_sales: boolean
  active_sales_file: string | null
  active_sales_meta: SalesFileMeta | null
  active_target_month: string | null
  target_files: TargetFileRecord[]
  tracker_sales: TrackerSalesMeta[]
}

export const getStorageStatus = () =>
  api.get<StorageStatus>('/api/storage/status')

export const deleteCombinedSales = () =>
  api.delete<{ ok: boolean }>('/api/storage/sales')

export interface SalesMetaResult {
  loaded: boolean
  filename?: string
  uploaded_at?: string
  file_size_kb?: number
  store_count?: number
  record_count?: number
  date_from?: string | null
  date_to?: string | null
  month_count?: number
  total_revenue?: number
  is_demo?: boolean
}

export const getSalesMeta = () =>
  api.get<SalesMetaResult>('/api/sales/meta')

export const reloadSales = () =>
  api.post<{ ok: boolean; stores: number; months: string[] }>('/api/sales/reload')

// ── Target management ─────────────────────────────────────────────────────────

export interface TargetFileRecord {
  month: string
  filename: string
  store_count: number
  uploaded_at: string
  file_size_kb: number
  status: 'active' | 'inactive' | 'archived'
  total_target?: number
}

export const listTargets = () =>
  api.get<{ targets: TargetFileRecord[] }>('/api/targets/list')

export const uploadManagedTarget = (
  file: File,
  monthLabel: string,
  onProgress?: (pct: number) => void,
) => {
  const form = new FormData()
  form.append('file', file)
  form.append('month_label', monthLabel)
  return api.post<TargetFileRecord>('/api/targets/upload', form, {
    onUploadProgress: e =>
      onProgress?.(Math.round((e.loaded * 100) / (e.total ?? 1))),
  })
}

export const setActiveTarget = (month: string) =>
  api.post<TargetFileRecord>('/api/targets/set-active', { month })

export const archiveTarget = (month: string) =>
  api.post<TargetFileRecord>('/api/targets/archive', { month })

export const deleteTarget = (month: string) =>
  api.delete<{ ok: boolean }>(`/api/targets/${encodeURIComponent(month)}`)

// ── Target Tracker ─────────────────────────────────────────────────────────────

export interface TrackerSalesMeta {
  month: string
  filename: string
  file_size_kb: number
  uploaded_at: string
}

export interface TrackerSalesUploadResult extends TrackerSalesMeta {
  already_existed: boolean
  store_count: number
  max_elapsed: number
}

export interface TrackerMonthStatus {
  month: string
  has_target: boolean
  has_sales: boolean
  is_active_target: boolean
  target_meta: TargetFileRecord | null
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
  sales_rows: TrackerSalesRow[]
  max_elapsed: number
  detected_month: string | null
}

export const uploadTrackerSales = (
  file: File,
  onProgress?: (pct: number) => void,
) => {
  const form = new FormData()
  form.append('file', file)
  return api.post<TrackerSalesUploadResult>('/api/tracker/sales/upload', form, {
    onUploadProgress: e =>
      onProgress?.(Math.round((e.loaded * 100) / (e.total ?? 1))),
  })
}

export const getTrackerStatus = () =>
  api.get<TrackerStatus>('/api/tracker/status')

export const getTrackerData = (month: string) =>
  api.get<TrackerData>(`/api/tracker/data?month=${encodeURIComponent(month)}`)

export const deleteTrackerSales = (month: string) =>
  api.delete<{ ok: boolean }>(`/api/tracker/sales/${encodeURIComponent(month)}`)

// ── Generic file-explorer (compatibility) ─────────────────────────────────────

export const uploadFile = (file: File) => {
  const form = new FormData()
  form.append('file', file)
  return api.post<{ filename: string; sheets: string[] }>('/api/upload', form)
}

export const getSheetData = (sheet: string) =>
  api.get<{
    columns: string[]
    rows: Record<string, unknown>[]
    shape: { rows: number; columns: number }
  }>(`/api/data/${encodeURIComponent(sheet)}`)

export const getAnalysis = (sheet: string) =>
  api.get<{
    numeric_columns: string[]
    categorical_columns: string[]
    shape: { rows: number; columns: number }
    kpis: Record<string, { sum: number; mean: number; min: number; max: number }>
    bar_charts: Array<{ title: string; x: string[]; y: number[]; x_label: string; y_label: string }>
    distributions: Array<{ title: string; column: string; data: number[] }>
  }>(`/api/analysis/${encodeURIComponent(sheet)}`)
