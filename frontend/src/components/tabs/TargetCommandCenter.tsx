import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useMotionValue, useTransform, animate } from 'framer-motion'
import {
  Activity, AlertCircle, BarChart2,
  Calendar, ChevronDown, ChevronUp,
  Download, FileSpreadsheet, Info, Loader2, Minus, RefreshCw, Search, Settings, Target,
  TrendingDown, TrendingUp, UploadCloud, X, XCircle, Zap,
} from 'lucide-react'
// eslint-disable-next-line @typescript-eslint/no-require-imports
import createPlotlyComponent from 'react-plotly.js/factory'
// @ts-ignore — plotly.js-dist-min does not ship its own .d.ts
import Plotly from 'plotly.js-dist-min'
import {
  getTrackerStatus, getTrackerData, uploadTrackerSales,
  type TrackerStatus,
} from '@/lib/api'
import { cn } from '@/lib/utils'
import { useDataContext } from '@/contexts/DataContext'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import TargetManagementDrawer from './TargetManagementDrawer'
import { fmtInr, fmtPct } from '@/lib/formatting'
import { exportExcel } from '@/lib/tableExport'
import { kpiContainer, kpiItem, panelSpring } from '@/lib/animations'

const Plot = createPlotlyComponent(Plotly)

// ── Constants ─────────────────────────────────────────────────────────────────

const TABLE_PAGE_SIZE = 20

// ── Helpers ───────────────────────────────────────────────────────────────────

function getDaysInMonth(monthStr: string): number {
  const DAYS: Record<string, number> = {
    Jan: 31, Feb: 28, Mar: 31, Apr: 30, May: 31, Jun: 30,
    Jul: 31, Aug: 31, Sep: 30, Oct: 31, Nov: 30, Dec: 31,
  }
  const parts = monthStr.split('-')
  if (parts.length !== 2) return 31
  const [abbr, yearStr] = parts
  const year = parseInt(yearStr, 10)
  if (abbr === 'Feb' && !isNaN(year)) {
    if ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0) return 29
  }
  return DAYS[abbr] ?? 31
}

const PLOTLY_AXES = {
  gridcolor: '#e5e7eb',
  linecolor: '#d1d5db',
  tickcolor: '#d1d5db',
  automargin: true,
} as const

const PF = { font: '#6b7280', legend: '#6b7280' }

// ── Types ─────────────────────────────────────────────────────────────────────

type RiskStatus = 'Champion' | 'On Track' | 'Watchlist' | 'At Risk'
type RemainingStatus = 'Hit' | 'At Risk' | 'Miss'
type TableSortKey =
  | 'name' | 'state' | 'target' | 'sales'
  | 'achPct' | 'gapPct' | 'reqDRR' | 'projected' | 'projAchPct' | 'status'
  | 'dailyTarget' | 'expectedTillDate' | 'runRateAch' | 'remainingStatus'
type TrackerInitStatus = 'loading' | 'needs_upload' | 'ready'
type SalesPhase =
  | { kind: 'idle' }
  | { kind: 'uploading'; progress: number }
  | { kind: 'done'; month: string; storeCount: number }
  | { kind: 'error'; message: string }

// Minimal store reference built from tracker data
type LocalStore = { store_id: string; store_name: string; state: string }

const RISK_ORDER: RiskStatus[] = ['Champion', 'On Track', 'Watchlist', 'At Risk']

const RISK_CFG: Record<RiskStatus, { color: string; badge: string; zone: string }> = {
  'Champion':  { color: '#10b981', badge: 'bg-emerald-100 text-emerald-700', zone: 'rgba(16,185,129,0.05)'  },
  'On Track':  { color: '#3b82f6', badge: 'bg-blue-100 text-blue-700',       zone: 'rgba(59,130,246,0.05)' },
  'Watchlist': { color: '#f59e0b', badge: 'bg-amber-100 text-amber-700',     zone: 'rgba(245,158,11,0.05)' },
  'At Risk':   { color: '#ef4444', badge: 'bg-red-100 text-red-700',         zone: 'rgba(239,68,68,0.05)'  },
}

const ACH_BUCKETS = [
  { label: '0–25%',   min: 0,   max: 25,       color: '#ef4444', textClass: 'text-red-600',     borderClass: 'border-red-200',     bgClass: 'bg-red-50'     },
  { label: '25–50%',  min: 25,  max: 50,        color: '#f97316', textClass: 'text-orange-600',  borderClass: 'border-orange-200',  bgClass: 'bg-orange-50'  },
  { label: '50–75%',  min: 50,  max: 75,        color: '#f59e0b', textClass: 'text-amber-600',   borderClass: 'border-amber-200',   bgClass: 'bg-amber-50'   },
  { label: '75–100%', min: 75,  max: 100,       color: '#3b82f6', textClass: 'text-blue-600',    borderClass: 'border-blue-200',    bgClass: 'bg-blue-50'    },
  { label: '100%+',   min: 100, max: Infinity,  color: '#10b981', textClass: 'text-emerald-600', borderClass: 'border-emerald-200', bgClass: 'bg-emerald-50' },
]

const REMAINING_CFG: Record<string, { badge: string }> = {
  'Hit':     { badge: 'bg-emerald-100 text-emerald-700' },
  'At Risk': { badge: 'bg-amber-100 text-amber-700'     },
  'Miss':    { badge: 'bg-red-100 text-red-700'         },
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getRisk(projAchPct: number): RiskStatus {
  if (projAchPct >= 110) return 'Champion'
  if (projAchPct >= 95)  return 'On Track'
  if (projAchPct >= 80)  return 'Watchlist'
  return 'At Risk'
}

function getRemainingStatus(projAchPct: number): RemainingStatus {
  if (projAchPct >= 100) return 'Hit'
  if (projAchPct >= 75)  return 'At Risk'
  return 'Miss'
}

function getBucketIdx(achPct: number): number {
  if (achPct >= 100) return 4
  if (achPct >= 75)  return 3
  if (achPct >= 50)  return 2
  if (achPct >= 25)  return 1
  return 0
}

// ── Sub-components ────────────────────────────────────────────────────────────

function AnimatedPercent({ value, className }: { value: number; className?: string }) {
  const mv      = useMotionValue(0)
  const display = useTransform(mv, (v: number) => `${v.toFixed(1)}%`)
  useEffect(() => {
    const ctrl = animate(mv, value, { duration: 1.1, ease: [0.22, 1, 0.36, 1] })
    return () => ctrl.stop()
  }, [mv, value])
  return <motion.span className={className}>{display}</motion.span>
}

function KPICard({ label, value, sub, valueClass, icon, accent, pctValue }: {
  label: string; value: string; sub?: string; valueClass?: string
  icon: React.ReactNode; accent?: string; pctValue?: number
}) {
  return (
    <motion.div
      variants={kpiItem}
      whileHover={{
        scale: 1.035, y: -4,
        transition: { type: 'spring', stiffness: 420, damping: 26 },
      }}
      whileTap={{ scale: 0.97, transition: { duration: 0.1 } }}
      className={cn(
        'rounded-xl border bg-white p-4 flex flex-col gap-1 min-w-0 cursor-default',
        'shadow-sm hover:shadow-md transition-shadow duration-200',
        accent ?? 'border-gray-200',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-medium uppercase tracking-widest text-gray-500 truncate">{label}</p>
        <span className="shrink-0 text-gray-400">{icon}</span>
      </div>
      {pctValue !== undefined
        ? <AnimatedPercent value={pctValue} className={cn('text-2xl font-bold tabular-nums truncate', valueClass ?? 'text-gray-900')} />
        : <p className={cn('text-2xl font-bold tabular-nums truncate', valueClass ?? 'text-gray-900')}>{value}</p>
      }
      {sub && <p className="text-[11px] text-gray-500 truncate">{sub}</p>}
    </motion.div>
  )
}

function RiskBadge({ status }: { status: RiskStatus }) {
  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap', RISK_CFG[status].badge)}>
      {status}
    </span>
  )
}

function NoTargetsPrompt({ onManage }: { onManage: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 28 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 24 }}
      className="rounded-xl border border-dashed border-gray-200 bg-gray-50 min-h-[420px] flex flex-col items-center justify-center gap-5 p-10"
    >
      <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-amber-50 to-orange-50 flex items-center justify-center shadow-sm">
        <Target className="h-7 w-7 text-amber-500" />
      </div>
      <div className="text-center max-w-sm">
        <h3 className="text-lg font-semibold text-gray-900">No Targets Loaded</h3>
        <p className="mt-2 text-sm text-gray-500 leading-relaxed">
          Upload an <span className="font-mono text-amber-600 text-xs px-1.5 py-0.5 rounded bg-amber-50 border border-amber-100">OW Budget</span> file
          to unlock the Target Command Center. The file should contain{' '}
          <span className="text-gray-700">Store Key</span> and <span className="text-gray-700">OOW</span> columns.
          Include the month and year in the filename (e.g. <span className="text-gray-700">OW Budget June 2026.xlsx</span>).
        </p>
      </div>
      <button
        onClick={onManage}
        className="flex items-center gap-2 h-10 px-5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors"
      >
        <Settings className="h-4 w-4" />
        Open Target Manager
      </button>
    </motion.div>
  )
}

function DaySlider({ value, onChange, targetMonth }: {
  value: number; onChange: (v: number) => void; targetMonth: string
}) {
  const totalDays = getDaysInMonth(targetMonth)
  const pct = ((value - 1) / (totalDays - 1)) * 100
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 24, delay: 0.05 }}
      className="rounded-xl border border-gray-200 bg-white px-5 py-4 shadow-sm"
    >
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-blue-500 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-gray-900">Day of Month Simulator</p>
            <p className="text-[11px] text-gray-500">
              Tracking: <span className="text-gray-700 font-medium">{targetMonth}</span> · All rows update live
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4 flex-1 min-w-[280px]">
          <span className="text-xs text-gray-400 shrink-0 w-10">Day 1</span>
          <div className="relative flex-1">
            <input
              type="range" min={1} max={totalDays} value={value}
              onChange={e => onChange(Number(e.target.value))}
              className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
              style={{ background: `linear-gradient(to right,#3b82f6 ${pct}%,#e5e7eb ${pct}%)` }}
            />
          </div>
          <span className="text-xs text-gray-400 shrink-0 w-14 text-right">Day {totalDays}</span>
          <div className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-50 border border-blue-100">
            <span className="text-xs text-gray-500">Day</span>
            <span className="text-lg font-bold text-blue-600 tabular-nums w-6 text-center">{value}</span>
            <span className="text-xs text-gray-400">/ {totalDays}</span>
          </div>
        </div>
      </div>
    </motion.div>
  )
}

function SortBtn({ col, sortKey, sortDir, onSort, label, info }: {
  col: TableSortKey; sortKey: TableSortKey; sortDir: 'asc' | 'desc'
  onSort: (c: TableSortKey) => void; label: string; info?: boolean
}) {
  return (
    <button
      onClick={() => onSort(col)}
      className="flex items-center gap-1 text-xs font-medium uppercase tracking-wider text-gray-500 hover:text-gray-900 transition-colors whitespace-nowrap"
    >
      {label}
      {info && <Info className="h-3 w-3 text-blue-400 opacity-70 shrink-0" />}
      {sortKey === col
        ? sortDir === 'asc'
          ? <ChevronUp className="h-3 w-3 text-blue-400" />
          : <ChevronDown className="h-3 w-3 text-blue-400" />
        : <ChevronUp className="h-3 w-3 opacity-25" />}
    </button>
  )
}

function ManageBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 h-8 px-3.5 rounded-lg bg-white border border-gray-200 text-xs font-medium text-gray-600 hover:text-gray-900 hover:border-gray-400 shadow-sm transition-colors"
    >
      <Settings className="h-3.5 w-3.5" />
      Manage Targets
    </button>
  )
}

// Inline upload zone — used when no tracker sales are loaded yet
function SalesUploadZone({ phase, onFile, onReset }: {
  phase: SalesPhase; onFile: (f: File) => void; onReset: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const dragRef  = useRef(0)
  const [drag, setDrag] = useState(false)
  const canInteract = phase.kind === 'idle' || phase.kind === 'error'

  return (
    <div
      onClick={() => canInteract && inputRef.current?.click()}
      onDragEnter={e => { e.preventDefault(); dragRef.current++; setDrag(true) }}
      onDragLeave={e => { e.preventDefault(); dragRef.current--; if (dragRef.current <= 0) { dragRef.current = 0; setDrag(false) } }}
      onDragOver={e => e.preventDefault()}
      onDrop={e => { e.preventDefault(); dragRef.current = 0; setDrag(false); const f = e.dataTransfer.files[0]; if (f) onFile(f) }}
      className={cn(
        'relative rounded-xl border-2 border-dashed transition-all duration-200 p-6 min-h-[180px] flex flex-col',
        canInteract && 'cursor-pointer',
        phase.kind === 'idle' && !drag && 'border-slate-200 bg-slate-50 hover:border-blue-400 hover:bg-blue-50/50',
        drag              && 'border-blue-500 bg-blue-50 ring-2 ring-blue-400/20',
        phase.kind === 'uploading' && 'border-blue-300 bg-blue-50/50',
        phase.kind === 'done'    && 'border-emerald-400 bg-emerald-50/60',
        phase.kind === 'error'   && 'border-red-300 bg-red-50/50',
      )}
    >
      <input ref={inputRef} type="file" accept=".xlsx,.xls" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = '' }} />

      <div className="flex items-center gap-2.5 mb-3">
        <FileSpreadsheet className="h-5 w-5 text-slate-400" />
        <div>
          <p className="text-sm font-semibold text-slate-800">Upload Monthly Sales File</p>
          <p className="text-xs text-slate-500">Required to view tracker analytics · .xlsx</p>
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center gap-3">
        <AnimatePresence mode="wait">
          {phase.kind === 'idle' && (
            <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="flex flex-col items-center gap-2.5 text-center">
              <div className={cn('h-12 w-12 rounded-xl flex items-center justify-center', drag ? 'bg-blue-100' : 'bg-slate-100')}>
                <UploadCloud className={cn('h-6 w-6', drag ? 'text-blue-500' : 'text-slate-400')} />
              </div>
              <p className="text-sm text-slate-500">{drag ? 'Drop to upload' : 'Drag & drop or click to browse'}</p>
              <div className="flex flex-wrap justify-center gap-1 mt-1">
                {['Store Name', 'Sales / Amount', 'Date'].map(h => (
                  <span key={h} className="text-[10px] px-2 py-0.5 rounded-full bg-slate-200 text-slate-500 font-mono">{h}</span>
                ))}
              </div>
            </motion.div>
          )}
          {phase.kind === 'uploading' && (
            <motion.div key="uploading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="flex flex-col items-center gap-2 w-full">
              <Loader2 className="h-8 w-8 text-blue-500 animate-spin" />
              <p className="text-sm text-slate-500">Uploading… {phase.progress}%</p>
              <div className="w-full max-w-[180px] h-1.5 rounded-full bg-slate-200 overflow-hidden">
                <div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${phase.progress}%` }} />
              </div>
            </motion.div>
          )}
          {phase.kind === 'done' && (
            <motion.div key="done" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
              className="flex flex-col items-center gap-2 text-center">
              <div className="h-12 w-12 rounded-xl bg-emerald-100 flex items-center justify-center">
                <FileSpreadsheet className="h-6 w-6 text-emerald-600" />
              </div>
              <p className="text-sm font-semibold text-emerald-700">Saved to server</p>
              <p className="text-xs text-slate-500">{phase.storeCount} stores · {phase.month}</p>
              <button onClick={e => { e.stopPropagation(); onReset() }}
                className="mt-1 text-xs text-slate-400 hover:text-red-500 flex items-center gap-1 transition-colors">
                <X className="h-3 w-3" /> Upload new file
              </button>
            </motion.div>
          )}
          {phase.kind === 'error' && (
            <motion.div key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="flex flex-col items-center gap-2 text-center">
              <XCircle className="h-10 w-10 text-red-400" />
              <p className="text-sm font-semibold text-red-600">Upload failed</p>
              <p className="text-xs text-slate-500 max-w-[220px] leading-relaxed">{phase.message}</p>
              <button onClick={e => { e.stopPropagation(); onReset() }} className="text-xs text-blue-500 underline">Try again</button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function TargetCommandCenter() {
  // ── Dashboard store master (for reconciliation against OW Budget) ─────────
  const { stores: dashboardStores } = useDataContext()

  // ── Tracker init / lifecycle ──────────────────────────────────────────────
  const [initStatus,     setInitStatus]     = useState<TrackerInitStatus>('loading')
  const [trackerStatus,  setTrackerStatus]  = useState<TrackerStatus | null>(null)
  const [currentMonth,   setCurrentMonth]   = useState<string | null>(null)
  const [salesPhase,     setSalesPhase]     = useState<SalesPhase>({ kind: 'idle' })
  const [showNewSales,   setShowNewSales]   = useState(false)

  // ── Tracker data (own store — never touches global filter bar) ────────────
  const [targetMap,        setTargetMap]        = useState<Map<string, number>>(new Map())
  const [targetKeyToName,  setTargetKeyToName]  = useState<Map<string, string>>(new Map())
  const [rawTargetRowCount,setRawTargetRowCount] = useState(0)  // rows before dedup in OW Budget
  const [rawSalesRows,    setRawSalesRows]    = useState<{ storeName: string; sales: number; day: number }[]>([])
  const [salesMap,        setSalesMap]        = useState<Map<string, number>>(new Map())
  const [storeStateMap,   setStoreStateMap]   = useState<Map<string, string>>(new Map())
  const [statesList,      setStatesList]      = useState<string[]>([])
  const [maxElapsed,      setMaxElapsed]      = useState(1)
  const [dayOfMonth,      setDayOfMonth]      = useState(15)

  // ── Own filter state (never reads from global filter bar) ─────────────────
  const [filterState,   setFilterState]   = useState('')

  // ── UI state ──────────────────────────────────────────────────────────────
  const [showDrawer,    setShowDrawer]    = useState(false)
  const [showAudit,     setShowAudit]     = useState(false)
  const [tableSearch,   setTableSearch]   = useState('')
  const [tableSortKey,      setTableSortKey]      = useState<TableSortKey>('achPct')
  const [tableSortDir,      setTableSortDir]      = useState<'asc' | 'desc'>('asc')
  const [tablePage,         setTablePage]         = useState(1)
  const [selectedBucketIdx, setSelectedBucketIdx] = useState<number | null>(null)

  useEffect(() => { setTablePage(1) }, [tableSearch, tableSortKey, tableSortDir, selectedBucketIdx])
  useEffect(() => { setSelectedBucketIdx(null) }, [filterState])

  // ── Apply tracker API data to local state ─────────────────────────────────

  const applyTrackerData = useCallback((data: import('@/lib/api').TrackerData) => {
    const tm  = new Map<string, number>()
    const knm = new Map<string, string>()
    for (const t of data.targets) {
      const key = t.store_key || t.store_name
      tm.set(key, t.target)
      knm.set(key, t.store_name || t.store_key)
    }
    setTargetMap(tm)
    setTargetKeyToName(knm)
    setRawTargetRowCount(data.raw_target_row_count ?? data.targets.length)

    const rawRows: { storeName: string; sales: number; day: number }[] = []
    const stateMapNew = new Map<string, string>()
    for (const r of data.sales_rows) {
      const salesKey = r.store_key || r.store_name
      rawRows.push({ storeName: salesKey, sales: r.sales, day: r.day })
      if (r.state) stateMapNew.set(salesKey, r.state)
    }

    const sm = new Map<string, number>()
    for (const r of rawRows) sm.set(r.storeName, (sm.get(r.storeName) ?? 0) + r.sales)

    setSalesMap(sm)
    setRawSalesRows(rawRows)
    setMaxElapsed(data.max_elapsed || 1)
    setDayOfMonth(data.max_elapsed || 1)
    setStoreStateMap(stateMapNew)
    setStatesList([...new Set(stateMapNew.values())].sort())
  }, [])

  // ── Data fetch helpers ────────────────────────────────────────────────────

  const refreshStatus = useCallback(async () => {
    try {
      const { data } = await getTrackerStatus()
      setTrackerStatus(data)
      return data
    } catch { return null }
  }, [])

  const loadMonth = useCallback(async (month: string) => {
    try {
      const { data } = await getTrackerData(month)
      if (data.has_target && data.has_sales) {
        applyTrackerData(data)
        setCurrentMonth(month)
        setInitStatus('ready')
        return true
      }
    } catch { /* fall through */ }
    return false
  }, [applyTrackerData])

  const initTracker = useCallback(async () => {
    setInitStatus('loading')
    const status = await refreshStatus()
    if (!status) { setInitStatus('needs_upload'); return }
    const ready = status.months.find(m => m.has_target && m.has_sales)
    if (ready) {
      const ok = await loadMonth(ready.month)
      if (ok) return
    }
    setInitStatus('needs_upload')
  }, [refreshStatus, loadMonth])

  useEffect(() => { initTracker() }, [initTracker])

  // ── Sales upload handler ──────────────────────────────────────────────────

  const handleSalesUpload = useCallback(async (file: File) => {
    setSalesPhase({ kind: 'uploading', progress: 0 })
    try {
      const { data: result } = await uploadTrackerSales(file, pct =>
        setSalesPhase({ kind: 'uploading', progress: pct })
      )
      setSalesPhase({ kind: 'done', month: result.month, storeCount: result.store_count })
      const status = await refreshStatus()
      if (status) {
        const ready = status.months.find(m => m.month === result.month && m.has_target && m.has_sales)
          ?? status.months.find(m => m.has_target && m.has_sales)
        if (ready) await loadMonth(ready.month)
      }
      setShowNewSales(false)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        ?? 'Upload failed. Check file format.'
      setSalesPhase({ kind: 'error', message: msg })
    }
  }, [refreshStatus, loadMonth])

  // ── Sales active map: respects day slider ─────────────────────────────────

  const activeSalesMap = useMemo(() => {
    const hasDateInfo = rawSalesRows.some(r => r.day > 0)
    if (!hasDateInfo) return salesMap
    const map = new Map<string, number>()
    for (const r of rawSalesRows) {
      if (r.day === 0 || r.day <= dayOfMonth) {
        map.set(r.storeName, (map.get(r.storeName) ?? 0) + r.sales)
      }
    }
    return map
  }, [rawSalesRows, dayOfMonth, salesMap])

  const targetMonth = currentMonth ?? ''
  const totalDays   = useMemo(() => getDaysInMonth(targetMonth), [targetMonth])

  // ── Filtered store entries ────────────────────────────────────────────────

  const filteredEntries = useMemo(() => {
    const entries = [...targetMap.entries()].filter(([, t]) => t > 0)
    if (!filterState) return entries
    return entries.filter(([name]) => storeStateMap.get(name) === filterState)
  }, [targetMap, filterState, storeStateMap])

  // ── Per-store calculations ────────────────────────────────────────────────

  const storeCalcs = useMemo(() => {
    const elapsed   = Math.max(1, dayOfMonth)
    const remaining = Math.max(0, totalDays - elapsed)
    return filteredEntries.map(([storeName, target]) => {
      const store: LocalStore = {
        store_id:   storeName,
        store_name: targetKeyToName.get(storeName) || storeName,
        state:      storeStateMap.get(storeName) ?? '',
      }
      const currentSales = activeSalesMap.get(storeName) ?? 0
      const achPct       = target > 0 ? (currentSales / target) * 100 : 0
      const expectedPct  = (elapsed / totalDays) * 100
      const gap          = target - currentSales
      const gapPct       = target > 0 ? (gap / target) * 100 : 0
      const projected    = elapsed > 0 ? (currentSales / elapsed) * totalDays : 0
      const projAchPct   = target > 0 ? (projected / target) * 100 : 0
      const reqDRR       = remaining > 0 && gap > 0 ? gap / remaining : 0
      const expectedSales = target * (elapsed / totalDays)
      const status          = getRisk(projAchPct)
      const dailyTarget     = totalDays > 0 ? target / totalDays : 0
      const runRateAchPct   = expectedSales > 0 ? (currentSales / expectedSales) * 100 : 0
      const remainingStatus = getRemainingStatus(projAchPct)
      return { store, target, currentSales, achPct, expectedPct, gap, gapPct, projected, projAchPct, reqDRR, expectedSales, status, dailyTarget, runRateAchPct, remainingStatus }
    })
  }, [filteredEntries, dayOfMonth, totalDays, activeSalesMap, storeStateMap, targetKeyToName])

  // ── National roll-up ──────────────────────────────────────────────────────

  const national = useMemo(() => {
    const elapsed     = Math.max(1, dayOfMonth)
    const remaining   = Math.max(0, totalDays - elapsed)
    const totalTarget = storeCalcs.reduce((s, d) => s + d.target, 0)
    const totalSales  = storeCalcs.reduce((s, d) => s + d.currentSales, 0)
    const achPct      = totalTarget > 0 ? (totalSales / totalTarget) * 100 : 0
    const expectedPct = (elapsed / totalDays) * 100
    const gap         = totalTarget - totalSales
    const projected   = elapsed > 0 ? (totalSales / elapsed) * totalDays : 0
    const reqDRR      = remaining > 0 && gap > 0 ? gap / remaining : 0
    return {
      totalTarget, totalSales, achPct, expectedPct,
      gap, projected, reqDRR,
      remaining_target: Math.max(0, gap),
      elapsed, remaining,
    }
  }, [storeCalcs, dayOfMonth, totalDays])

  // ── Gauge ─────────────────────────────────────────────────────────────────

  const gaugeTrace = useMemo(() => ({
    type: 'indicator' as const,
    mode: 'gauge+number+delta' as const,
    value: national.achPct,
    number: { suffix: '%', font: { size: 32, color: '#111827' }, valueformat: '.1f' },
    delta: {
      reference: national.expectedPct, relative: false, valueformat: '.1f',
      suffix: 'pp vs pace',
      increasing: { symbol: '▲', color: '#10b981' },
      decreasing: { symbol: '▼', color: '#ef4444' },
    },
    gauge: {
      axis: { range: [0, 150], tickwidth: 1, tickcolor: '#374151', tickfont: { color: '#6b7280', size: 10 }, dtick: 25 },
      bar: { color: national.achPct >= 95 ? '#10b981' : national.achPct >= 80 ? '#f59e0b' : '#ef4444', thickness: 0.72 },
      bgcolor: 'rgba(0,0,0,0)', borderwidth: 0,
      steps: [
        { range: [0,  80],  color: 'rgba(239,68,68,0.08)'  },
        { range: [80, 95],  color: 'rgba(245,158,11,0.08)' },
        { range: [95, 150], color: 'rgba(16,185,129,0.08)' },
      ],
      threshold: { line: { color: '#ffffff40', width: 2 }, thickness: 0.85, value: 100 },
    },
  }), [national.achPct, national.expectedPct])

  // ── Pace chart ────────────────────────────────────────────────────────────

  const paceTraces = useMemo(() => {
    const elapsed    = national.elapsed
    const days       = Array.from({ length: totalDays }, (_, i) => i + 1)
    const idealY     = days.map(d => national.totalTarget * (d / totalDays))
    const dailyRate  = elapsed > 0 ? national.totalSales / elapsed : 0
    const aheadColor = national.achPct >= national.expectedPct ? '#10b981' : '#ef4444'
    const actualX = [0, elapsed]
    const actualY = [0, national.totalSales]
    const projX = [elapsed, totalDays]
    const projY = [national.totalSales, dailyRate * totalDays]
    const expectedToday = national.totalTarget * (elapsed / totalDays)
    return [
      { type: 'scatter' as const, mode: 'lines' as const, name: 'Ideal Pace (Target Ramp)',
        x: [0, ...days], y: [0, ...idealY],
        line: { color: '#6b7280', width: 2, dash: 'dot' as const, shape: 'spline' as const },
        hovertemplate: 'Day %{x}<br>Should have: ₹%{y:,.0f}<extra>Ideal Pace</extra>' },
      { type: 'scatter' as const, mode: 'lines+markers' as const, name: `Actual Sales (${targetMonth})`,
        x: actualX, y: actualY,
        line: { color: aheadColor, width: 3, shape: 'spline' as const },
        marker: { size: [0, 10], color: aheadColor, symbol: 'circle' as const },
        hovertemplate: 'Day %{x}<br>Actual: ₹%{y:,.0f}<extra>Actual</extra>' },
      { type: 'scatter' as const, mode: 'lines' as const, name: 'Projected Month-End',
        x: projX, y: projY,
        line: { color: aheadColor + '70', width: 2, dash: 'dash' as const, shape: 'spline' as const },
        hovertemplate: 'Day %{x}<br>Projected: ₹%{y:,.0f}<extra>Projection</extra>' },
      { type: 'scatter' as const, mode: 'lines' as const, name: 'OOW Target',
        x: [0, totalDays], y: [national.totalTarget, national.totalTarget],
        line: { color: '#f59e0b80', width: 1.5, dash: 'longdash' as const },
        hovertemplate: 'Target: ₹%{y:,.0f}<extra>OOW Target</extra>' },
      { type: 'scatter' as const, mode: 'markers' as const, name: 'Expected by Today',
        x: [elapsed], y: [expectedToday],
        marker: { size: 10, color: '#6b7280', symbol: 'diamond' as const, line: { color: '#374151', width: 1.5 } },
        hovertemplate: `Day ${elapsed}<br>Should have: ₹%{y:,.0f}<extra>Expected by Day ${elapsed}</extra>` },
    ]
  }, [national, targetMonth, totalDays])

  // ── Daily Pace Matrix ─────────────────────────────────────────────────────

  const bubbleTraces = useMemo(() => {
    if (storeCalcs.length === 0) return []
    const maxT = Math.max(...storeCalcs.map(d => d.target), 1)
    const minT = Math.min(...storeCalcs.map(d => d.target), 1)
    const sz   = (t: number) => 10 + ((t - minT) / (maxT - minT || 1)) * 36
    const above = storeCalcs.filter(d => d.currentSales >= d.expectedSales)
    const below = storeCalcs.filter(d => d.currentSales <  d.expectedSales)
    const maxVal = Math.max(...storeCalcs.map(d => Math.max(d.expectedSales, d.currentSales)), 1) * 1.12
    const mkTrace = (data: typeof storeCalcs, color: string, name: string) => ({
      type: 'scatter' as const, mode: 'markers' as const, name,
      x: data.map(d => d.expectedSales), y: data.map(d => d.currentSales),
      marker: { size: data.map(d => sz(d.target)), color, opacity: 0.72, line: { color: '#111827', width: 1 } },
      customdata: data.map(d => [d.store.store_name, d.store.store_id, d.target, d.currentSales, d.achPct, d.expectedPct, d.gap]),
      hovertemplate: '<b>%{customdata[0]}</b><br>Target: ₹%{customdata[2]:,.0f}<br>Sales: ₹%{customdata[3]:,.0f}<br>Achievement: %{customdata[4]:.1f}%<br>Expected: %{customdata[5]:.1f}%<extra></extra>',
    })
    return [
      { type: 'scatter' as const, mode: 'lines' as const, name: 'On Pace (Y=X)',
        x: [0, maxVal], y: [0, maxVal],
        line: { color: '#374151', width: 1.5, dash: 'dash' as const },
        hoverinfo: 'skip' as const, showlegend: true },
      mkTrace(above, '#10b981', 'Ahead of Pace'),
      mkTrace(below, '#ef4444', 'Behind Pace'),
    ]
  }, [storeCalcs])

  // ── Projection Matrix ─────────────────────────────────────────────────────

  const projMatrixTraces = useMemo(() => {
    if (storeCalcs.length === 0) return []
    const maxT = Math.max(...storeCalcs.map(d => d.target), 1)
    const minT = Math.min(...storeCalcs.map(d => d.target), 1)
    const sz   = (t: number) => 10 + ((t - minT) / (maxT - minT || 1)) * 36
    return RISK_ORDER.map(status => {
      const data = storeCalcs.filter(d => d.status === status)
      return {
        type: 'scatter' as const, mode: 'markers' as const,
        name: `${status} (${data.length})`,
        x: data.map(d => d.target),
        y: data.map(d => d.projAchPct),
        marker: { size: data.map(d => sz(d.target)), color: RISK_CFG[status].color, opacity: 0.78, line: { color: '#111827', width: 1 } },
        customdata: data.map(d => [d.store.store_name, d.store.store_id, d.target, d.currentSales, d.achPct, d.projAchPct, d.gap]),
        hovertemplate:
          '<b>%{customdata[0]}</b><br>' +
          'Target: ₹%{customdata[2]:,.0f}<br>' +
          'Sales: ₹%{customdata[3]:,.0f}<br>' +
          'Current Ach: %{customdata[4]:.1f}%<br>' +
          'Projected: %{customdata[5]:.1f}%<br>' +
          'Gap: ₹%{customdata[6]:,.0f}' +
          '<extra></extra>',
      }
    })
  }, [storeCalcs])

  // ── State aggregation ─────────────────────────────────────────────────────

  const stateData = useMemo(() => {
    const map: Record<string, { target: number; achieved: number; projected: number; count: number }> = {}
    for (const d of storeCalcs) {
      const st = d.store.state || 'Unknown'
      if (!map[st]) map[st] = { target: 0, achieved: 0, projected: 0, count: 0 }
      map[st].target    += d.target
      map[st].achieved  += d.currentSales
      map[st].projected += d.projected
      map[st].count++
    }
    return Object.entries(map).map(([state, v]) => ({
      state,
      target:     v.target,
      achieved:   v.achieved,
      gap:        v.target - v.achieved,
      projected:  v.projected,
      achPct:     v.target > 0 ? (v.achieved  / v.target) * 100 : 0,
      projPct:    v.target > 0 ? (v.projected / v.target) * 100 : 0,
      storeCount: v.count,
      status:     getRisk(v.target > 0 ? (v.projected / v.target) * 100 : 0),
    })).sort((a, b) => b.achPct - a.achPct)
  }, [storeCalcs])

  const stateBarTraces = useMemo(() => {
    const rev = [...stateData].reverse()
    return [
      {
        type: 'bar' as const, orientation: 'h' as const, name: 'Current Ach %',
        x: rev.map(d => d.achPct), y: rev.map(d => d.state),
        marker: { color: rev.map(d => d.achPct >= 95 ? '#10b981' : d.achPct >= 80 ? '#f59e0b' : '#ef4444'), opacity: 0.82 },
        hovertemplate: '<b>%{y}</b><br>Achievement: %{x:.1f}%<extra>Current</extra>',
      },
      {
        type: 'scatter' as const, mode: 'markers' as const, name: 'Projected %',
        x: rev.map(d => d.projPct), y: rev.map(d => d.state),
        marker: {
          symbol: 'diamond' as const, size: 10,
          color: rev.map(d => d.projPct >= 95 ? '#10b981' : d.projPct >= 80 ? '#f59e0b' : '#ef4444'),
          opacity: 0.9, line: { color: '#111827', width: 1.5 },
        },
        hovertemplate: '<b>%{y}</b><br>Projected: %{x:.1f}%<extra>Projected</extra>',
      },
    ]
  }, [stateData])

  // ── Store Population Reconciliation ──────────────────────────────────────
  // Compares the dashboard store master (from sales file) against the OW Budget
  // target population to surface missing stores, unknown keys, and duplicates.

  const reconciliation = useMemo(() => {
    const dashboardIds  = new Set(dashboardStores.map(s => s.store_id))
    const trackerKeys   = new Set([...targetMap.keys()])
    const matched       = [...trackerKeys].filter(k => dashboardIds.has(k))
    const extraInTracker    = [...trackerKeys].filter(k => !dashboardIds.has(k))
    const missingFromTracker = dashboardStores
      .filter(s => !trackerKeys.has(s.store_id))
      .map(s => ({ id: s.store_id, name: s.store_name || s.store_id }))
    const duplicateCount = Math.max(0, rawTargetRowCount - trackerKeys.size)
    return {
      dashboardCount:       dashboardIds.size,
      trackerCount:         trackerKeys.size,
      rawOWBudgetRows:      rawTargetRowCount,
      duplicateCount,
      matchedCount:         matched.length,
      storesWithTargets:    matched.length,
      storesWithoutTargets: missingFromTracker.length,
      extraInTracker,
      missingFromTracker,
      reconciliationDiff:   dashboardIds.size - trackerKeys.size,
      isClean:
        extraInTracker.length === 0 &&
        missingFromTracker.length === 0 &&
        duplicateCount === 0,
    }
  }, [dashboardStores, targetMap, rawTargetRowCount])

  // ── Achievement buckets + donut chart ────────────────────────────────────

  const achBuckets = useMemo(() =>
    ACH_BUCKETS.map(b => {
      const stores = storeCalcs.filter(d => d.achPct >= b.min && (b.max === Infinity ? true : d.achPct < b.max))
      return {
        ...b,
        count: stores.length,
        pct: storeCalcs.length > 0 ? (stores.length / storeCalcs.length) * 100 : 0,
      }
    }),
  [storeCalcs])

  const donutTrace = useMemo(() => ({
    type:      'pie' as const,
    hole:      0.64,
    values:    achBuckets.map(b => b.count),
    labels:    achBuckets.map(b => b.label),
    marker:    { colors: ACH_BUCKETS.map(b => b.color), line: { color: '#ffffff', width: 2.5 } },
    textinfo:  'none' as const,
    hovertemplate: '<b>%{label}</b><br>%{value} stores (%{percent:.0%})<extra></extra>',
    pull:      ACH_BUCKETS.map((_, i) => selectedBucketIdx === i ? 0.07 : 0),
    sort:      false,
  }), [achBuckets, selectedBucketIdx])

  // ── Store table ───────────────────────────────────────────────────────────

  const storeTableData = useMemo(() => {
    let rows = [...storeCalcs]
    const q = tableSearch.trim().toLowerCase()
    if (q) rows = rows.filter(r => r.store.store_name.toLowerCase().includes(q) || r.store.state.toLowerCase().includes(q))

    if (selectedBucketIdx !== null) {
      const b = ACH_BUCKETS[selectedBucketIdx]
      rows = rows.filter(r => r.achPct >= b.min && (b.max === Infinity ? true : r.achPct < b.max))
    }

    rows.sort((a, b) => {
      let diff = 0
      const REMAINING_ORDER: Record<RemainingStatus, number> = { 'Hit': 2, 'At Risk': 1, 'Miss': 0 }
      switch (tableSortKey) {
        case 'name':             diff = a.store.store_name.localeCompare(b.store.store_name); break
        case 'state':            diff = a.store.state.localeCompare(b.store.state); break
        case 'target':           diff = a.target - b.target; break
        case 'sales':            diff = a.currentSales - b.currentSales; break
        case 'achPct':           diff = a.achPct - b.achPct; break
        case 'gapPct':           diff = a.gapPct - b.gapPct; break
        case 'reqDRR':           diff = a.reqDRR - b.reqDRR; break
        case 'projected':        diff = a.projected - b.projected; break
        case 'projAchPct':       diff = a.projAchPct - b.projAchPct; break
        case 'status':           diff = a.projAchPct - b.projAchPct; break
        case 'dailyTarget':      diff = a.dailyTarget - b.dailyTarget; break
        case 'expectedTillDate': diff = a.expectedSales - b.expectedSales; break
        case 'runRateAch':       diff = a.runRateAchPct - b.runRateAchPct; break
        case 'remainingStatus':  diff = REMAINING_ORDER[a.remainingStatus] - REMAINING_ORDER[b.remainingStatus]; break
      }
      return tableSortDir === 'asc' ? diff : -diff
    })
    return rows
  }, [storeCalcs, tableSearch, tableSortKey, tableSortDir, selectedBucketIdx])

  const totalPages = Math.max(1, Math.ceil(storeTableData.length / TABLE_PAGE_SIZE))
  const pagedRows  = storeTableData.slice((tablePage - 1) * TABLE_PAGE_SIZE, tablePage * TABLE_PAGE_SIZE)

  const toggleSort = useCallback((col: TableSortKey) => {
    if (tableSortKey === col) setTableSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setTableSortKey(col); setTableSortDir('desc') }
  }, [tableSortKey])

  const exportCsv = useCallback(() => {
    const headers = ['Rank', 'Store Name', 'State', 'Current Sales (₹)', 'Monthly Target (₹)', 'Daily Target (₹)', 'Expected Till Date (₹)', 'Run Rate Ach %', 'Monthly Ach %', 'Remaining Status', 'Projected Ach %']
    const rows = storeTableData.map((r, i) => [
      String(i + 1),
      r.store.store_name, r.store.state,
      r.currentSales.toFixed(0), r.target.toFixed(0),
      r.dailyTarget.toFixed(0), r.expectedSales.toFixed(0),
      r.runRateAchPct.toFixed(1) + '%',
      r.achPct.toFixed(1) + '%',
      r.remainingStatus,
      r.projAchPct.toFixed(1) + '%',
    ])
    const csv = [headers, ...rows].map(row => row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = `target-tracker-day${dayOfMonth}-${targetMonth}.csv`
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [storeTableData, dayOfMonth, targetMonth])

  const exportXlsx = useCallback(() => {
    const headers = ['Rank', 'Store Name', 'State', 'Current Sales (₹)', 'Monthly Target (₹)', 'Daily Target (₹)', 'Expected Till Date (₹)', 'Run Rate Ach %', 'Monthly Ach %', 'Remaining Status', 'Projected Ach %']
    const rows = storeTableData.map((r, i) => [
      i + 1,
      r.store.store_name, r.store.state,
      r.currentSales, r.target,
      r.dailyTarget, r.expectedSales,
      r.runRateAchPct.toFixed(1) + '%',
      r.achPct.toFixed(1) + '%',
      r.remainingStatus,
      r.projAchPct.toFixed(1) + '%',
    ])
    exportExcel(`target-tracker-day${dayOfMonth}-${targetMonth}`, headers, rows)
  }, [storeTableData, dayOfMonth, targetMonth])

  // ── Guards ────────────────────────────────────────────────────────────────

  if (initStatus === 'loading') {
    return (
      <div className="min-h-[420px] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 text-blue-500 animate-spin" />
          <p className="text-sm text-gray-500">Loading tracker data…</p>
        </div>
      </div>
    )
  }

  if (initStatus === 'needs_upload') {
    const activeMonth = trackerStatus?.active_target_month
    return (
      <>
        <TargetManagementDrawer
          open={showDrawer}
          onClose={() => setShowDrawer(false)}
          onTargetChanged={initTracker}
        />
        <div className="max-w-xl mx-auto py-8 space-y-5">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h2 className="text-base font-bold text-gray-900">Target Command Center</h2>
              <p className="text-[11px] text-gray-500 mt-0.5">Upload sales data to begin tracking</p>
            </div>
            <ManageBtn onClick={() => setShowDrawer(true)} />
          </div>

          {/* Target status */}
          <div className={cn('rounded-xl border p-4', activeMonth ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50')}>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className={cn('h-9 w-9 rounded-lg flex items-center justify-center shrink-0', activeMonth ? 'bg-emerald-100' : 'bg-amber-100')}>
                  <Target className={cn('h-5 w-5', activeMonth ? 'text-emerald-600' : 'text-amber-600')} />
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-800">Monthly Target File</p>
                  {activeMonth
                    ? <p className="text-xs text-emerald-700 mt-0.5">Active: <span className="font-semibold">{activeMonth}</span></p>
                    : <p className="text-xs text-amber-700 mt-0.5">No active target — click "Manage Targets" first</p>
                  }
                </div>
              </div>
              <button onClick={() => setShowDrawer(true)}
                className="text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors"
                style={activeMonth
                  ? { borderColor: '#6ee7b7', color: '#047857', backgroundColor: '#d1fae5' }
                  : { borderColor: '#fcd34d', color: '#92400e', backgroundColor: '#fef3c7' }}>
                {activeMonth ? 'Change' : 'Upload Target'}
              </button>
            </div>
          </div>

          {/* Sales upload zone */}
          <SalesUploadZone
            phase={salesPhase}
            onFile={handleSalesUpload}
            onReset={() => setSalesPhase({ kind: 'idle' })}
          />

          {!activeMonth && (
            <p className="text-xs text-blue-700 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2.5">
              <span className="font-semibold">Tip:</span> Upload the OW Budget target file first, then upload the sales file.
            </p>
          )}

          {/* Stored months */}
          {trackerStatus && trackerStatus.months.length > 0 && (
            <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
                <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Stored Months</p>
              </div>
              <div className="divide-y divide-gray-100">
                {trackerStatus.months.slice(0, 6).map(m => (
                  <div key={m.month} className="flex items-center justify-between px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-semibold text-gray-700">{m.month}</span>
                      <div className="flex items-center gap-1.5">
                        <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full font-medium', m.has_target ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-400')}>
                          {m.has_target ? '✓ Target' : '– Target'}
                        </span>
                        <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full font-medium', m.has_sales ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-400')}>
                          {m.has_sales ? '✓ Sales' : '– Sales'}
                        </span>
                      </div>
                    </div>
                    {m.has_target && m.has_sales && (
                      <button onClick={() => loadMonth(m.month)} className="text-xs font-medium text-blue-600 hover:text-blue-800 transition-colors">
                        Load →
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </>
    )
  }

  // initStatus === 'ready'

  if (storeCalcs.length === 0) {
    return (
      <>
        <div className="flex justify-end mb-3 gap-2">
          <button onClick={() => { setInitStatus('needs_upload'); setSalesPhase({ kind: 'idle' }) }}
            className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-white border border-gray-200 text-xs font-medium text-gray-600 hover:text-gray-900 hover:border-gray-400 shadow-sm transition-colors">
            <RefreshCw className="h-3.5 w-3.5" /> New Sales
          </button>
          <ManageBtn onClick={() => setShowDrawer(true)} />
        </div>
        <div className="rounded-xl border border-gray-200 bg-gray-50 min-h-72 flex items-center justify-center">
          <p className="text-sm text-gray-500">No stores with targets match the current filter.</p>
        </div>
        <TargetManagementDrawer open={showDrawer} onClose={() => setShowDrawer(false)} onTargetChanged={initTracker} />
      </>
    )
  }

  const achClass    = national.achPct >= 95 ? 'text-emerald-600' : national.achPct >= 80 ? 'text-amber-600' : 'text-red-600'
  const gapPositive = national.gap > 0
  const projYMax    = Math.max(160, ...storeCalcs.map(d => d.projAchPct + 10))
  const stateBarsHeight = Math.max(240, stateData.length * 36 + 80)

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* ── Inline "Upload New Sales" panel (collapsible) ── */}
      <AnimatePresence>
        {showNewSales && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-blue-900">Upload New Sales Data</p>
                <button onClick={() => { setShowNewSales(false); setSalesPhase({ kind: 'idle' }) }}
                  className="text-blue-400 hover:text-blue-600 transition-colors">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <SalesUploadZone
                phase={salesPhase}
                onFile={handleSalesUpload}
                onReset={() => setSalesPhase({ kind: 'idle' })}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Page Header ── */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="flex items-center justify-between gap-3 flex-wrap"
      >
        <div>
          <h2 className="text-base font-bold text-gray-900">Target Command Center</h2>
          <p className="text-[11px] text-gray-500 mt-0.5">
            Target month: <span className="text-blue-600 font-semibold">{targetMonth || '—'}</span>
            {' · '}{storeCalcs.length} stores (OW Budget){' · '}
            {reconciliation.dashboardCount} stores (Dashboard){' · '}
            Day {dayOfMonth} of {totalDays}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* State filter — own isolated state, never reads global filter bar */}
          <Select value={filterState || '__all__'} onValueChange={v => setFilterState(v === '__all__' ? '' : v)}>
            <SelectTrigger className="h-8 w-36 text-xs">
              <SelectValue placeholder="All States" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All States</SelectItem>
              {statesList.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>

          {/* Store Audit toggle */}
          <button
            onClick={() => setShowAudit(v => !v)}
            className={cn(
              'flex items-center gap-1.5 h-8 px-3 rounded-lg border text-xs font-medium transition-colors shadow-sm',
              showAudit
                ? 'bg-amber-600 text-white border-amber-600'
                : reconciliation.isClean
                  ? 'bg-white border-gray-200 text-gray-600 hover:text-gray-900 hover:border-gray-400'
                  : 'bg-amber-50 border-amber-300 text-amber-700 hover:bg-amber-100',
            )}
          >
            <Activity className="h-3.5 w-3.5" />
            Store Audit
            {!reconciliation.isClean && !showAudit && (
              <span className="ml-0.5 inline-flex items-center justify-center h-4 w-4 rounded-full bg-amber-500 text-white text-[10px] font-bold leading-none">
                {reconciliation.extraInTracker.length + (reconciliation.duplicateCount > 0 ? 1 : 0)}
              </span>
            )}
          </button>

          {/* Upload Sales toggle */}
          <button
            onClick={() => { setShowNewSales(v => !v); setSalesPhase({ kind: 'idle' }) }}
            className={cn(
              'flex items-center gap-1.5 h-8 px-3 rounded-lg border text-xs font-medium transition-colors shadow-sm',
              showNewSales
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white border-gray-200 text-gray-600 hover:text-gray-900 hover:border-gray-400',
            )}
          >
            <UploadCloud className="h-3.5 w-3.5" />
            Upload Sales
          </button>

          <ManageBtn onClick={() => setShowDrawer(true)} />
        </div>
      </motion.div>

      {/* ── Store Population Audit Panel ── */}
      <AnimatePresence>
        {showAudit && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4 space-y-4">

              {/* Header */}
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Activity className="h-4 w-4 text-amber-600 shrink-0" />
                  <p className="text-sm font-semibold text-gray-800">Store Population Audit</p>
                  <span className="text-[10px] text-gray-500">Reconciliation between Dashboard store master and OW Budget target file</span>
                </div>
                <button onClick={() => setShowAudit(false)} className="text-gray-400 hover:text-gray-600 transition-colors">
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Summary grid */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
                {[
                  { label: 'Dashboard Stores',     value: reconciliation.dashboardCount,       sub: 'from sales file',        color: 'text-gray-800'    },
                  { label: 'OW Budget Stores',      value: reconciliation.trackerCount,         sub: 'unique store keys',      color: 'text-blue-700'    },
                  { label: 'OW Budget Raw Rows',    value: reconciliation.rawOWBudgetRows,      sub: 'before deduplication',   color: 'text-gray-600'    },
                  { label: 'Duplicate Keys Merged', value: reconciliation.duplicateCount,       sub: 'targets summed',         color: reconciliation.duplicateCount > 0 ? 'text-amber-700' : 'text-emerald-700' },
                  { label: 'Matched',               value: reconciliation.matchedCount,         sub: 'in both files',          color: 'text-emerald-700' },
                  { label: 'Missing from OW Budget',value: reconciliation.storesWithoutTargets, sub: 'dashboard stores w/o target', color: reconciliation.storesWithoutTargets > 0 ? 'text-amber-700' : 'text-emerald-700' },
                  { label: 'Unknown OW Keys',       value: reconciliation.extraInTracker.length,sub: 'not in dashboard',        color: reconciliation.extraInTracker.length > 0 ? 'text-red-700' : 'text-emerald-700' },
                ].map(({ label, value, sub, color }) => (
                  <div key={label} className="rounded-lg border border-amber-100 bg-white px-3 py-2 space-y-0.5">
                    <p className="text-[10px] font-medium uppercase tracking-wider text-gray-500">{label}</p>
                    <p className={cn('text-xl font-bold tabular-nums', color)}>{value}</p>
                    <p className="text-[10px] text-gray-400">{sub}</p>
                  </div>
                ))}
              </div>

              {/* Reconciliation Difference */}
              <div className={cn(
                'rounded-lg border px-3 py-2 text-xs font-medium',
                reconciliation.reconciliationDiff === 0
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-amber-200 bg-amber-50 text-amber-800',
              )}>
                Reconciliation Difference: {reconciliation.reconciliationDiff > 0 ? '+' : ''}{reconciliation.reconciliationDiff} stores
                {' '}(Dashboard {reconciliation.dashboardCount} vs OW Budget {reconciliation.trackerCount})
                {reconciliation.reconciliationDiff === 0 && ' — store counts reconcile ✓'}
              </div>

              {/* Dashboard stores missing from OW Budget */}
              {reconciliation.missingFromTracker.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-amber-800">
                    Dashboard stores without OW Budget targets ({reconciliation.missingFromTracker.length}):
                  </p>
                  <div className="max-h-40 overflow-y-auto rounded-lg border border-amber-100 bg-white divide-y divide-gray-50">
                    {reconciliation.missingFromTracker.map(s => (
                      <div key={s.id} className="flex items-center gap-3 px-3 py-1.5">
                        <span className="text-[10px] font-mono text-gray-400 w-20 shrink-0">{s.id}</span>
                        <span className="text-xs text-gray-700 truncate">{s.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* OW Budget keys not in dashboard */}
              {reconciliation.extraInTracker.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-red-700">
                    OW Budget store keys not found in Dashboard ({reconciliation.extraInTracker.length}) — possible key mismatch:
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {reconciliation.extraInTracker.map(k => (
                      <span key={k} className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-mono bg-red-50 text-red-700 border border-red-200">
                        {k}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {reconciliation.isClean && (
                <p className="text-xs text-emerald-700 font-medium">
                  ✓ All OW Budget store keys match the Dashboard store master. No duplicates detected.
                </p>
              )}

            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Day Slider ── */}
      <DaySlider value={dayOfMonth} onChange={setDayOfMonth} targetMonth={targetMonth} />

      {/* ── ROW 1: KPI Cards ── */}
      <motion.div
        className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7"
        variants={kpiContainer}
        initial="hidden"
        animate="show"
      >
        <KPICard label="OOW Target" value={fmtInr(national.totalTarget)}
          sub={`${storeCalcs.length} / ${reconciliation.dashboardCount} stores`}
          icon={<Target className="h-4 w-4" />} />
        <KPICard label="Sales" value={fmtInr(national.totalSales)}
          sub={`Day ${dayOfMonth} of ${totalDays}`}
          icon={<BarChart2 className="h-4 w-4 text-blue-500" />} />
        <KPICard label="Achievement %"
          value={`${national.achPct.toFixed(1)}%`}
          pctValue={national.achPct}
          sub={`Expected ${national.expectedPct.toFixed(1)}%`}
          valueClass={achClass}
          accent={national.achPct >= 95 ? 'border-emerald-200' : national.achPct >= 80 ? 'border-amber-200' : 'border-red-200'}
          icon={national.achPct >= national.expectedPct
            ? <TrendingUp className="h-4 w-4 text-emerald-500" />
            : <TrendingDown className="h-4 w-4 text-red-500" />} />
        <KPICard label="Gap to Target"
          value={gapPositive ? fmtInr(national.gap) : '✓ Exceeded'}
          sub={gapPositive ? 'still to be sold' : `by ${fmtInr(-national.gap)}`}
          valueClass={gapPositive ? 'text-red-600' : 'text-emerald-600'}
          icon={gapPositive ? <AlertCircle className="h-4 w-4 text-red-500" /> : <TrendingUp className="h-4 w-4 text-emerald-500" />} />
        <KPICard label="Remaining Target"
          value={national.remaining_target > 0 ? fmtInr(national.remaining_target) : '—'}
          sub={`${national.remaining} days left`}
          valueClass={national.remaining_target > 0 ? 'text-amber-600' : 'text-gray-400'}
          icon={<Minus className="h-4 w-4 text-amber-500" />} />
        <KPICard label="Req. Daily Run Rate"
          value={national.reqDRR > 0 ? fmtInr(national.reqDRR) : '—'}
          sub="per day to close gap"
          valueClass={national.reqDRR > 0 ? 'text-amber-600' : 'text-gray-400'}
          icon={<Zap className="h-4 w-4 text-amber-500" />} />
        <KPICard label="Projected Month-End" value={fmtInr(national.projected)}
          sub={`${fmtPct((national.projected / national.totalTarget - 1) * 100)} vs target`}
          valueClass={national.projected >= national.totalTarget ? 'text-emerald-600' : 'text-red-600'}
          icon={<Activity className="h-4 w-4" />} />
      </motion.div>

      {/* ── ROW 2: Gauge + Pace ── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <motion.div {...panelSpring(0.1)}
          className="lg:col-span-2 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <h3 className="mb-0.5 text-sm font-semibold text-gray-800">
            OOW Target Achievement — {targetMonth}
          </h3>
          <p className="mb-2 text-[11px] text-gray-500">
            Sales vs OOW budget ·
            <span className="text-red-500"> &lt;80%</span> ·
            <span className="text-amber-500"> 80–95%</span> ·
            <span className="text-emerald-500"> &gt;95%</span>
          </p>
          <Plot data={[gaugeTrace]}
            layout={{ paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)', font: { color: PF.font, family: 'Inter,sans-serif', size: 11 }, margin: { l: 24, r: 24, t: 16, b: 8 }, height: 260 }}
            config={{ displayModeBar: false, responsive: true }} style={{ width: '100%' }} />
          <div className="flex justify-center gap-4 mt-1">
            {[{ l: 'Behind <80%', c: 'text-red-500' }, { l: 'On Track 80–95%', c: 'text-amber-500' }, { l: 'Exceeding >95%', c: 'text-emerald-500' }].map(z => (
              <span key={z.l} className={cn('text-[10px] font-medium', z.c)}>{z.l}</span>
            ))}
          </div>
        </motion.div>

        <motion.div {...panelSpring(0.15)}
          className="lg:col-span-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <h3 className="mb-0.5 text-sm font-semibold text-gray-800">Sales Pace vs OOW Target — {targetMonth}</h3>
          <p className="mb-3 text-[11px] text-gray-500">
            Ideal pace = OOW Target ÷ {totalDays} days × day · Dot = expected by today · Solid line = actual sales · Dashed = projected at current run rate
          </p>
          <Plot data={paceTraces}
            layout={{
              paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
              font: { color: PF.font, family: 'Inter,sans-serif', size: 11 },
              legend: { bgcolor: 'rgba(0,0,0,0)', font: { color: PF.legend, size: 10 }, orientation: 'h' as const, y: -0.26 },
              xaxis: { ...PLOTLY_AXES, title: { text: 'Day of Month' }, dtick: 5, range: [0, totalDays + 0.5] },
              yaxis: { ...PLOTLY_AXES, tickformat: ',.0s', title: { text: `Cumulative Sales (₹) — ${targetMonth}` } },
              hovermode: 'closest' as const,
              margin: { l: 70, r: 16, t: 8, b: 100 }, height: 310,
              shapes: [{ type: 'line' as const, x0: dayOfMonth, x1: dayOfMonth, y0: 0, y1: 1, xref: 'x' as const, yref: 'paper' as const, line: { color: '#3b82f650', width: 1.5, dash: 'dot' as const } }],
              annotations: [{ x: dayOfMonth, y: 1, xref: 'x' as const, yref: 'paper' as const, text: `Day ${dayOfMonth}`, showarrow: false, font: { color: '#3b82f6', size: 10 }, yanchor: 'bottom' as const }],
            }}
            config={{ displayModeBar: false, responsive: true }} style={{ width: '100%' }} />
        </motion.div>
      </div>

      {/* ── ROW 3: Daily Pace Matrix ── */}
      <motion.div {...panelSpring(0.2)}
        className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <h3 className="mb-0.5 text-sm font-semibold text-gray-800">Daily Pace Matrix — {targetMonth}</h3>
        <p className="mb-3 text-[11px] text-gray-500">
          Each bubble = 1 store · Bubble size = OOW target ·
          X = expected sales by Day {dayOfMonth} ·
          Y = actual {targetMonth} sales ·
          <span className="text-emerald-500"> Green</span> = above pace ·
          <span className="text-red-500"> Red</span> = below pace
        </p>
        <Plot data={bubbleTraces}
          layout={{
            paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
            font: { color: PF.font, family: 'Inter,sans-serif', size: 11 },
            legend: { bgcolor: 'rgba(0,0,0,0)', font: { color: PF.legend, size: 10 }, orientation: 'h' as const, y: -0.18 },
            xaxis: { ...PLOTLY_AXES, title: { text: `Expected Sales at Day ${dayOfMonth} (₹)` }, tickformat: ',.0s' },
            yaxis: { ...PLOTLY_AXES, title: { text: 'Actual Sales (₹)' }, tickformat: ',.0s' },
            hovermode: 'closest' as const,
            margin: { l: 70, r: 20, t: 16, b: 90 }, height: 380,
          }}
          config={{ displayModeBar: false, responsive: true }} style={{ width: '100%' }} />
        <div className="mt-3 flex flex-wrap gap-4 px-1">
          {[
            { l: 'Stores Ahead', v: storeCalcs.filter(d => d.currentSales >= d.expectedSales).length, c: 'text-emerald-600' },
            { l: 'Stores Behind', v: storeCalcs.filter(d => d.currentSales < d.expectedSales).length, c: 'text-red-600' },
            { l: 'Avg Achievement', v: `${(storeCalcs.reduce((s, d) => s + d.achPct, 0) / storeCalcs.length).toFixed(1)}%`, c: achClass },
            { l: 'Expected Pace', v: `${national.expectedPct.toFixed(1)}%`, c: 'text-gray-500' },
          ].map(({ l, v, c }) => (
            <div key={l} className="flex items-center gap-2">
              <span className="text-[11px] text-gray-500">{l}</span>
              <span className={cn('text-sm font-bold tabular-nums', c)}>{v}</span>
            </div>
          ))}
        </div>
      </motion.div>

      {/* ── ROW 4: Month-End Projection Matrix ── */}
      <motion.div {...panelSpring(0.25)}
        className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <h3 className="mb-0.5 text-sm font-semibold text-gray-800">Month-End Projection Matrix — {targetMonth}</h3>
        <p className="mb-3 text-[11px] text-gray-500">
          Each bubble = 1 store · X = OOW target (log scale) · Y = projected achievement % ·
          Projection = (actual sales ÷ Day {dayOfMonth}) × {totalDays} ÷ OOW Target
        </p>
        <Plot
          data={projMatrixTraces}
          layout={{
            paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
            font: { color: PF.font, family: 'Inter,sans-serif', size: 11 },
            legend: { bgcolor: 'rgba(0,0,0,0)', font: { color: PF.legend, size: 10 }, orientation: 'h' as const, y: -0.18 },
            xaxis: { ...PLOTLY_AXES, type: 'log' as const, title: { text: 'Monthly Target (₹, log scale)' }, tickformat: ',.0s' },
            yaxis: { ...PLOTLY_AXES, title: { text: 'Projected Achievement %' }, range: [0, projYMax] },
            hovermode: 'closest' as const,
            margin: { l: 64, r: 20, t: 16, b: 90 }, height: 420,
            shapes: [
              { type: 'rect' as const, xref: 'paper', yref: 'y', x0: 0, x1: 1, y0: 110,    y1: projYMax, fillcolor: RISK_CFG['Champion']['zone'],  line: { width: 0 } },
              { type: 'rect' as const, xref: 'paper', yref: 'y', x0: 0, x1: 1, y0: 95,     y1: 110,      fillcolor: RISK_CFG['On Track']['zone'],  line: { width: 0 } },
              { type: 'rect' as const, xref: 'paper', yref: 'y', x0: 0, x1: 1, y0: 80,     y1: 95,       fillcolor: RISK_CFG['Watchlist']['zone'], line: { width: 0 } },
              { type: 'rect' as const, xref: 'paper', yref: 'y', x0: 0, x1: 1, y0: 0,      y1: 80,       fillcolor: RISK_CFG['At Risk']['zone'],   line: { width: 0 } },
              { type: 'line' as const, xref: 'paper', yref: 'y', x0: 0, x1: 1, y0: 110, y1: 110, line: { color: '#10b98130', width: 1.5, dash: 'dot' as const } },
              { type: 'line' as const, xref: 'paper', yref: 'y', x0: 0, x1: 1, y0: 100, y1: 100, line: { color: '#6b728060', width: 2,   dash: 'dash' as const } },
              { type: 'line' as const, xref: 'paper', yref: 'y', x0: 0, x1: 1, y0: 95,  y1: 95,  line: { color: '#3b82f630', width: 1.5, dash: 'dot' as const } },
              { type: 'line' as const, xref: 'paper', yref: 'y', x0: 0, x1: 1, y0: 80,  y1: 80,  line: { color: '#ef444430', width: 1.5, dash: 'dot' as const } },
            ],
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            annotations: ([
              { y: (110 + projYMax) / 2, text: 'CHAMPION',  color: RISK_CFG['Champion']['color']  },
              { y: 102.5,                text: 'ON TRACK',   color: RISK_CFG['On Track']['color']  },
              { y: 87.5,                 text: 'WATCHLIST',  color: RISK_CFG['Watchlist']['color'] },
              { y: 40,                   text: 'AT RISK',    color: RISK_CFG['At Risk']['color']   },
            ] as { y: number; text: string; color: string }[]).map(a => ({
              xref: 'paper', x: 0.98, yref: 'y', y: a.y,
              text: a.text, showarrow: false, xanchor: 'right', yanchor: 'middle',
              font: { color: a.color + 'aa', size: 11, family: 'Inter,sans-serif' },
            })) as any[],
          }}
          config={{ displayModeBar: false, responsive: true }} style={{ width: '100%' }} />
        <div className="mt-3 flex flex-wrap gap-3 px-1">
          {RISK_ORDER.map(status => {
            const count = storeCalcs.filter(d => d.status === status).length
            return (
              <div key={status} className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: RISK_CFG[status].color }} />
                <span className="text-[11px] text-gray-500">{status}</span>
                <span className="text-sm font-bold tabular-nums" style={{ color: RISK_CFG[status].color }}>{count}</span>
              </div>
            )
          })}
        </div>
      </motion.div>

      {/* ── ROW 5: State Target Analysis ── */}
      <motion.div {...panelSpring(0.3)}
        className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm">
        <div className="px-4 py-3 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-800">State Target Analysis</h3>
          <p className="text-[11px] text-gray-500 mt-0.5">
            Bars = current achievement % · Diamond = projected % · Dashed line = 100% target
          </p>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-gray-100">
          <div className="p-4">
            <Plot data={stateBarTraces}
              layout={{
                paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
                font: { color: PF.font, family: 'Inter,sans-serif', size: 11 },
                legend: { bgcolor: 'rgba(0,0,0,0)', font: { color: PF.legend, size: 10 }, orientation: 'h' as const, y: -0.22 },
                xaxis: { ...PLOTLY_AXES, title: { text: 'Achievement %' }, range: [0, Math.max(130, ...stateData.map(d => d.projPct + 5))] },
                yaxis: { ...PLOTLY_AXES },
                hovermode: 'y unified' as const,
                margin: { l: 110, r: 20, t: 8, b: 60 }, height: stateBarsHeight,
                shapes: [{ type: 'line' as const, xref: 'x', yref: 'paper', x0: 100, x1: 100, y0: 0, y1: 1, line: { color: '#4b556380', width: 1.5, dash: 'dash' as const } }],
                annotations: [{ x: 100, y: 1, xref: 'x' as const, yref: 'paper' as const, text: '100%', showarrow: false, font: { color: '#6b7280', size: 10 }, yanchor: 'bottom' as const }],
              }}
              config={{ displayModeBar: false, responsive: true }} style={{ width: '100%' }} />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  {['State', 'Stores', 'Target', 'Achieved', 'Ach%', 'Gap', 'Proj%', 'Status'].map(h => (
                    <th key={h} className="px-3 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {stateData.map(row => (
                  <tr key={row.state} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                    <td className="px-3 py-2.5 text-gray-900 font-medium whitespace-nowrap">{row.state}</td>
                    <td className="px-3 py-2.5 text-gray-500 tabular-nums text-xs">{row.storeCount}</td>
                    <td className="px-3 py-2.5 text-gray-700 tabular-nums text-xs whitespace-nowrap">{fmtInr(row.target)}</td>
                    <td className="px-3 py-2.5 text-gray-700 tabular-nums text-xs whitespace-nowrap">{fmtInr(row.achieved)}</td>
                    <td className={cn('px-3 py-2.5 tabular-nums text-xs font-semibold', row.achPct >= 95 ? 'text-emerald-600' : row.achPct >= 80 ? 'text-amber-600' : 'text-red-600')}>
                      {row.achPct.toFixed(1)}%
                    </td>
                    <td className={cn('px-3 py-2.5 tabular-nums text-xs whitespace-nowrap', row.gap <= 0 ? 'text-emerald-600' : 'text-red-600')}>
                      {row.gap <= 0 ? `+${fmtInr(-row.gap)}` : fmtInr(row.gap)}
                    </td>
                    <td className={cn('px-3 py-2.5 tabular-nums text-xs font-semibold', row.projPct >= 95 ? 'text-emerald-600' : row.projPct >= 80 ? 'text-amber-600' : 'text-red-600')}>
                      {row.projPct.toFixed(1)}%
                    </td>
                    <td className="px-3 py-2.5"><RiskBadge status={row.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </motion.div>

      {/* ── ROW 6: Achievement Distribution ── */}
      <motion.div {...panelSpring(0.32)}
        className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold text-gray-800">Achievement Distribution</h3>
            <p className="text-[11px] text-gray-500 mt-0.5">
              Store count by Monthly Achievement % · Click a segment or card to filter the performance table
            </p>
          </div>
          {selectedBucketIdx !== null && (
            <button
              onClick={() => setSelectedBucketIdx(null)}
              className="flex items-center gap-1.5 h-7 px-3 rounded-lg bg-blue-50 border border-blue-200 text-xs font-medium text-blue-600 hover:bg-blue-100 transition-colors"
            >
              <X className="h-3 w-3" /> Clear filter: {ACH_BUCKETS[selectedBucketIdx].label}
            </button>
          )}
        </div>

        {/* Bucket KPI Cards */}
        <div className="px-4 pt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
          {achBuckets.map((b, i) => (
            <button
              key={b.label}
              onClick={() => setSelectedBucketIdx(selectedBucketIdx === i ? null : i)}
              className={cn(
                'rounded-xl border p-3 text-left transition-all cursor-pointer',
                selectedBucketIdx === i
                  ? `${b.borderClass} ${b.bgClass} shadow-sm ring-2 ring-offset-1`
                  : 'border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm',
              )}
            >
              <p className="text-[10px] font-medium uppercase tracking-wider text-gray-500">{b.label}</p>
              <p className={cn('text-2xl font-bold tabular-nums mt-0.5', b.textClass)}>{b.count}</p>
              <p className="text-[10px] text-gray-400 mt-0.5">{b.pct.toFixed(1)}% of stores</p>
            </button>
          ))}
        </div>

        {/* Donut chart + legend */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 p-4 items-center">
          <div className="relative">
            <Plot
              data={[donutTrace]}
              layout={{
                paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
                font: { color: PF.font, family: 'Inter,sans-serif', size: 11 },
                showlegend: false,
                margin: { l: 20, r: 20, t: 12, b: 12 },
                height: 240,
                annotations: [{
                  text: `<b>${storeCalcs.length}</b><br><span style="font-size:10px;color:#6b7280">stores</span>`,
                  x: 0.5, y: 0.5, xref: 'paper' as const, yref: 'paper' as const,
                  showarrow: false,
                  font: { size: 20, color: '#111827', family: 'Inter,sans-serif' },
                  align: 'center',
                }],
              }}
              config={{ displayModeBar: false, responsive: true }}
              style={{ width: '100%' }}
              onClick={(data: { points?: Array<{ pointIndex: number }> }) => {
                const idx = data.points?.[0]?.pointIndex
                if (idx !== undefined) setSelectedBucketIdx(v => v === idx ? null : idx)
              }}
            />
          </div>
          <div className="space-y-1.5 px-2">
            {ACH_BUCKETS.map((b, i) => {
              const bucket = achBuckets[i]
              const isActive = selectedBucketIdx === i
              return (
                <button
                  key={b.label}
                  onClick={() => setSelectedBucketIdx(isActive ? null : i)}
                  className={cn(
                    'w-full flex items-center justify-between rounded-lg px-3 py-2 transition-colors text-left',
                    isActive ? `${b.bgClass} border ${b.borderClass}` : 'bg-gray-50 hover:bg-gray-100 border border-transparent',
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: b.color }} />
                    <span className="text-xs font-medium text-gray-700">{b.label} Achievement</span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className={cn('text-sm font-bold tabular-nums', b.textClass)}>{bucket.count}</span>
                    <div className="w-20 h-1.5 rounded-full bg-gray-200 overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${bucket.pct}%`, backgroundColor: b.color }} />
                    </div>
                    <span className="text-[10px] text-gray-400 w-8 text-right">{bucket.pct.toFixed(0)}%</span>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      </motion.div>

      {/* ── Metric Definitions ── */}
      <motion.div {...panelSpring(0.34)}
        className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
          <Info className="h-4 w-4 text-blue-500 shrink-0" />
          <div>
            <h3 className="text-sm font-semibold text-gray-800">Metric Definitions</h3>
            <p className="text-[11px] text-gray-500 mt-0.5">How the key performance columns in the table below are calculated</p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 p-4">
          {[
            {
              label:   'Run Rate Ach %',
              formula: 'Current Sales ÷ Expected Till Date × 100',
              sub:     `Expected Till Date = Monthly Target × (Day ${dayOfMonth} ÷ ${totalDays} days)`,
              meaning: 'Whether the store is ahead of or behind the daily pace needed to hit its target by today. Above 100% means running ahead of schedule.',
            },
            {
              label:   'Monthly Ach %',
              formula: 'Current Sales ÷ Monthly Target × 100',
              sub:     'Raw progress toward the full-month OOW budget',
              meaning: 'Percentage of the monthly target already achieved. Does not factor in how much of the month has passed.',
            },
            {
              label:   'Status',
              formula: 'Driven by Projected Ach %',
              sub:     'Hit ≥ 100%  ·  At Risk 75 – 99%  ·  Miss < 75%',
              meaning: 'Performance classification based on whether the store is projected to meet its target at month-end.',
            },
            {
              label:   'Projected Ach %',
              formula: `(Current Sales ÷ Day ${dayOfMonth}) × ${totalDays} ÷ Target × 100`,
              sub:     'Estimated month-end achievement at the current daily run rate',
              meaning: 'If today\'s daily pace holds for the rest of the month, this is the achievement % the store will reach at month-end.',
            },
          ].map(({ label, formula, sub, meaning }) => (
            <div key={label} className="rounded-lg border border-gray-100 bg-gray-50/60 px-3 py-2.5 space-y-1.5">
              <div className="flex items-center gap-1.5">
                <Info className="h-3 w-3 text-blue-400 shrink-0" />
                <p className="text-[10px] font-bold uppercase tracking-wider text-blue-600">{label}</p>
              </div>
              <p className="text-[11px] font-mono text-gray-700 bg-white rounded border border-gray-200 px-2 py-1 leading-snug">{formula}</p>
              <p className="text-[10px] text-gray-400 leading-snug">{sub}</p>
              <p className="text-[11px] text-gray-500 leading-relaxed">{meaning}</p>
            </div>
          ))}
        </div>
      </motion.div>

      {/* ── ROW 7: Store Performance Table ── */}
      <motion.div {...panelSpring(0.35)}
        className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold text-gray-800">Store Performance</h3>
            <p className="text-[11px] text-gray-500 mt-0.5">
              {storeTableData.length} store{storeTableData.length !== 1 ? 's' : ''}
              {selectedBucketIdx !== null ? ` · Filtered: ${ACH_BUCKETS[selectedBucketIdx].label} Achievement` : ''}
              {' · '}Page {tablePage} of {totalPages}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex items-center">
              <Search className="absolute left-2.5 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
              <input
                type="text" placeholder="Search store / state…" value={tableSearch}
                onChange={e => setTableSearch(e.target.value)}
                className="h-8 pl-8 pr-7 rounded-lg bg-gray-50 border border-gray-200 text-xs text-gray-900 placeholder:text-gray-400 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400/30 w-48"
              />
              {tableSearch && (
                <button onClick={() => setTableSearch('')} className="absolute right-2 text-gray-400 hover:text-gray-600">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <button onClick={exportCsv}
              className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-white border border-gray-200 text-xs text-gray-600 hover:text-gray-900 hover:border-gray-400 shadow-sm transition-colors">
              <Download className="h-3.5 w-3.5" /> CSV
            </button>
            <button onClick={exportXlsx}
              className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-white border border-emerald-200 text-xs text-emerald-700 hover:text-emerald-900 hover:border-emerald-400 shadow-sm transition-colors">
              <Download className="h-3.5 w-3.5" /> Excel
            </button>
          </div>
        </div>

        <div className="max-h-[640px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="px-3 py-2.5 text-left text-xs text-gray-400 w-8 sticky top-0 bg-gray-50">#</th>
                {([
                  { col: 'name'            as TableSortKey, label: 'Store Name',        tip: 'Store name'                                                                               },
                  { col: 'sales'           as TableSortKey, label: 'Current Sales',     tip: `Actual cumulative sales recorded through Day ${dayOfMonth}`                              },
                  { col: 'target'          as TableSortKey, label: 'Monthly Target',    tip: 'Full-month OOW budget target'                                                             },
                  { col: 'dailyTarget'     as TableSortKey, label: 'Daily Target',      tip: `Monthly Target ÷ ${totalDays} days — average daily sales required`                       },
                  { col: 'expectedTillDate'as TableSortKey, label: 'Expected Till Date',tip: `Pro-rated target by Day ${dayOfMonth} = Monthly Target × (${dayOfMonth} / ${totalDays})` },
                  { col: 'runRateAch'      as TableSortKey, label: 'Run Rate Ach %',    tip: 'Current Sales ÷ Expected Till Date × 100 — see Metric Definitions above',    info: true  },
                  { col: 'achPct'          as TableSortKey, label: 'Monthly Ach %',     tip: 'Current Sales ÷ Monthly Target × 100 — see Metric Definitions above',        info: true  },
                  { col: 'remainingStatus' as TableSortKey, label: 'Status',            tip: 'Hit ≥ 100% projected · At Risk 75–99% · Miss < 75% — see Metric Definitions above', info: true },
                  { col: 'projAchPct'      as TableSortKey, label: 'Projected Ach %',   tip: `(Current Sales ÷ Day ${dayOfMonth}) × ${totalDays} ÷ Target × 100 — see Metric Definitions above`, info: true },
                ]).map(({ col, label, tip, info }) => (
                  <th key={col} className="px-3 py-2.5 text-left sticky top-0 bg-gray-50" title={tip}>
                    <SortBtn col={col} sortKey={tableSortKey} sortDir={tableSortDir} onSort={toggleSort} label={label} info={info} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pagedRows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-3 py-10 text-center text-gray-400 text-sm">
                    {tableSearch ? `No stores match "${tableSearch}"` : 'No stores in this filter.'}
                  </td>
                </tr>
              ) : pagedRows.map((row, i) => {
                const globalIdx = (tablePage - 1) * TABLE_PAGE_SIZE + i + 1
                const rowBg =
                  row.achPct >= 100 ? 'bg-emerald-50/50 hover:bg-emerald-50' :
                  row.achPct >= 75  ? 'bg-amber-50/50 hover:bg-amber-50'     :
                                      'bg-red-50/40 hover:bg-red-50/70'
                const runColor =
                  row.runRateAchPct >= 100 ? 'text-emerald-600' :
                  row.runRateAchPct >= 75  ? 'text-amber-600'   : 'text-red-600'
                const monthColor =
                  row.achPct >= 100 ? 'text-emerald-600' :
                  row.achPct >= 75  ? 'text-amber-600'   : 'text-red-600'
                const projColor =
                  row.projAchPct >= 100 ? 'text-emerald-600' :
                  row.projAchPct >= 75  ? 'text-amber-600'   : 'text-red-600'
                const bucketDot = ACH_BUCKETS[getBucketIdx(row.achPct)].color
                return (
                  <tr key={row.store.store_id} className={cn('border-b border-gray-100 transition-colors', rowBg)}>
                    <td className="px-3 py-2 text-gray-400 tabular-nums text-xs">{globalIdx}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: bucketDot }} />
                        <p className="text-gray-900 font-medium text-xs truncate max-w-[160px]" title={row.store.store_name}>
                          {row.store.store_name}
                        </p>
                      </div>
                      {row.store.state && <p className="text-[10px] text-gray-400 pl-3.5">{row.store.state}</p>}
                    </td>
                    <td className="px-3 py-2 text-gray-800 tabular-nums text-xs font-medium whitespace-nowrap">{fmtInr(row.currentSales)}</td>
                    <td className="px-3 py-2 text-gray-600 tabular-nums text-xs whitespace-nowrap">{fmtInr(row.target)}</td>
                    <td className="px-3 py-2 text-gray-500 tabular-nums text-xs whitespace-nowrap">{fmtInr(row.dailyTarget)}</td>
                    <td className="px-3 py-2 text-gray-500 tabular-nums text-xs whitespace-nowrap">{fmtInr(row.expectedSales)}</td>
                    <td className={cn('px-3 py-2 tabular-nums text-xs font-semibold whitespace-nowrap', runColor)}>
                      {row.runRateAchPct.toFixed(1)}%
                      <div className="w-16 h-1 rounded-full bg-gray-200 mt-0.5 overflow-hidden">
                        <div className="h-full rounded-full" style={{
                          width: `${Math.min(row.runRateAchPct, 150) / 150 * 100}%`,
                          backgroundColor: row.runRateAchPct >= 100 ? '#10b981' : row.runRateAchPct >= 75 ? '#f59e0b' : '#ef4444',
                        }} />
                      </div>
                    </td>
                    <td className={cn('px-3 py-2 tabular-nums text-xs font-semibold whitespace-nowrap', monthColor)}>
                      {row.achPct.toFixed(1)}%
                      <div className="w-16 h-1 rounded-full bg-gray-200 mt-0.5 overflow-hidden">
                        <div className="h-full rounded-full" style={{
                          width: `${Math.min(row.achPct, 150) / 150 * 100}%`,
                          backgroundColor: ACH_BUCKETS[getBucketIdx(row.achPct)].color,
                        }} />
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap', REMAINING_CFG[row.remainingStatus]?.badge ?? '')}>
                        {row.remainingStatus}
                      </span>
                    </td>
                    <td className={cn('px-3 py-2 tabular-nums text-xs font-bold whitespace-nowrap', projColor)}>
                      {row.projAchPct.toFixed(1)}%
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between gap-3 flex-wrap">
            <p className="text-xs text-gray-500">
              Showing {(tablePage - 1) * TABLE_PAGE_SIZE + 1}–{Math.min(tablePage * TABLE_PAGE_SIZE, storeTableData.length)} of {storeTableData.length} stores
            </p>
            <div className="flex items-center gap-1">
              <button onClick={() => setTablePage(1)} disabled={tablePage === 1}
                className="h-7 px-2.5 rounded text-xs text-gray-500 hover:text-gray-900 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-default transition-colors">«</button>
              <button onClick={() => setTablePage(p => Math.max(1, p - 1))} disabled={tablePage === 1}
                className="h-7 px-2.5 rounded text-xs text-gray-500 hover:text-gray-900 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-default transition-colors">‹</button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, k) => {
                let page: number
                if (totalPages <= 5) { page = k + 1 }
                else if (tablePage <= 3) { page = k + 1 }
                else if (tablePage >= totalPages - 2) { page = totalPages - 4 + k }
                else { page = tablePage - 2 + k }
                return (
                  <button key={page} onClick={() => setTablePage(page)}
                    className={cn('h-7 w-7 rounded text-xs transition-colors', page === tablePage ? 'bg-blue-500 text-white font-bold' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100')}>
                    {page}
                  </button>
                )
              })}
              <button onClick={() => setTablePage(p => Math.min(totalPages, p + 1))} disabled={tablePage === totalPages}
                className="h-7 px-2.5 rounded text-xs text-gray-500 hover:text-gray-900 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-default transition-colors">›</button>
              <button onClick={() => setTablePage(totalPages)} disabled={tablePage === totalPages}
                className="h-7 px-2.5 rounded text-xs text-gray-500 hover:text-gray-900 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-default transition-colors">»</button>
            </div>
          </div>
        )}
      </motion.div>

      {/* ── Target Management Drawer ── */}
      <TargetManagementDrawer
        open={showDrawer}
        onClose={() => setShowDrawer(false)}
        onTargetChanged={initTracker}
      />

    </div>
  )
}
