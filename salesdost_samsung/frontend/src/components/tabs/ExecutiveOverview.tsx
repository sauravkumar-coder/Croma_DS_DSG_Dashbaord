import { useEffect, useMemo, useState, useRef } from 'react'
import {
  motion,
  useMotionValue,
  useTransform,
  animate,
  AnimatePresence,
} from 'framer-motion'
import {
  TrendingUp,
  TrendingDown,
  Users,
  Star,
  Moon,
  IndianRupee,
  Calendar,
  Settings,
  Target,
  ChevronUp,
  ChevronDown,
  Search,
  AlertCircle,
  Zap,
  Download,
  FileSpreadsheet,
  Minus,
  Activity,
  Trophy,
  X,
} from 'lucide-react'
// eslint-disable-next-line @typescript-eslint/no-require-imports
import createPlotlyComponent from 'react-plotly.js/factory'
// @ts-ignore — plotly.js-dist-min does not ship its own .d.ts
import Plotly from 'plotly.js-dist-min'
import { useDataContext } from '@/contexts/DataContext'
import { useRetailerContext } from '@/contexts/RetailerContext'
import type { FilterState } from '@/hooks/useFilters'
import type { StoreRecord } from '@/lib/api'
import { allocatePhases, type StoreCategory } from '@/lib/classificationEngine'
import { getTabClassification, transformStoresByPlanCategory } from '@/lib/filterHelpers'
import { cn } from '@/lib/utils'
import { fmtInr, fmtPct, plotlyInrTickVals, plotlyInrLogTickVals } from '@/lib/formatting'
import { exportExcel, exportCsv } from '@/lib/tableExport'
import { kpiContainer, kpiItem, panelSpring } from '@/lib/animations'
import { PT } from '@/lib/plotlyTheme'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'


const Plot = createPlotlyComponent(Plotly)

// ── Types ─────────────────────────────────────────────────────────────────────

type EarlyTier      = 'Top Performer' | 'Mid-tier' | 'Low Tier'
type RecentCategory = 'Consistent Performer' | 'Fallen Star' | 'Average' | 'Consistently Low' | 'Rising Star'
type HealthStatus   = 'Healthy' | 'Recovering' | 'Declining' | 'Underperforming' | 'Dormant' | 'Stable'

type RiskStatus = 'Champion' | 'On Track' | 'Watchlist' | 'At Risk'
type TableSortKey =
  | 'name' | 'state' | 'target' | 'sales'
  | 'achPct' | 'gapPct' | 'reqDRR' | 'projected' | 'projAchPct' | 'status'

// ── Target Configuration ──────────────────────────────────────────────────────

const RISK_ORDER: RiskStatus[] = ['Champion', 'On Track', 'Watchlist', 'At Risk']

const RISK_CFG: Record<RiskStatus, { color: string; badge: string; zone: string }> = {
  'Champion':  { color: '#10b981', badge: 'bg-emerald-100 text-emerald-700', zone: 'rgba(16,185,129,0.05)'  },
  'On Track':  { color: '#3b82f6', badge: 'bg-blue-100 text-blue-700',       zone: 'rgba(59,130,246,0.05)' },
  'Watchlist': { color: '#f59e0b', badge: 'bg-amber-100 text-amber-700',     zone: 'rgba(245,158,11,0.05)' },
  'At Risk':   { color: '#ef4444', badge: 'bg-red-100 text-red-700',         zone: 'rgba(239,68,68,0.05)'  },
}

const BANDS = [
  { label: '0–25%',   min: 0,   max: 25,       color: '#ef4444',  name: 'Critical'   },
  { label: '25–50%',  min: 25,  max: 50,       color: '#b45309',  name: 'Lagging'    },
  { label: '50–75%',  min: 50,  max: 75,       color: '#1d4ed8',  name: 'Developing' },
  { label: '75–100%', min: 75,  max: 100,      color: '#065f46',  name: 'On Track'   },
  { label: '100%+',   min: 100, max: Infinity, color: '#10b981',  name: 'Champions'  },
]

function getRisk(projAchPct: number): RiskStatus {
  if (projAchPct >= 110) return 'Champion'
  if (projAchPct >= 95)  return 'On Track'
  if (projAchPct >= 80)  return 'Watchlist'
  return 'At Risk'
}

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

function SortBtn({ col, sortKey, sortDir, onSort, label }: {
  col: TableSortKey; sortKey: TableSortKey; sortDir: 'asc' | 'desc'
  onSort: (c: TableSortKey) => void; label: string
}) {
  return (
    <button
      onClick={() => onSort(col)}
      className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500 hover:text-gray-900 transition-colors whitespace-nowrap"
    >
      {label}
      {sortKey === col
        ? sortDir === 'asc'
          ? <ChevronUp className="h-3 w-3 text-blue-500 font-bold" />
          : <ChevronDown className="h-3 w-3 text-blue-500 font-bold" />
        : <ChevronUp className="h-3 w-3 opacity-25" />}
    </button>
  )
}

interface TargetStoreRow {
  storeName:             string
  storeId:               string
  monthlyTarget:         number
  currentSales:          number
  dailyTarget:           number
  elapsedDays:           number
  expectedSalesTillDate: number
  runRateAchPct:         number
  monthlyAchPct:         number
  remainingTarget:       number
  projectedMonthEnd:     number
  projectedAchPct:       number
  status:                RiskStatus
}

function rrColorSet(pct: number) {
  if (pct >= 110) return { fill: 'linear-gradient(90deg,#047857,#059669)', glow: '#059669', text: '#059669', label: 'LEADING' }
  if (pct >= 100) return { fill: 'linear-gradient(90deg,#047857,#34d399)', glow: '#34d399', text: '#047857', label: 'ON PACE' }
  if (pct >= 90)  return { fill: 'linear-gradient(90deg,#b45309,#d97706)', glow: '#d97706', text: '#d97706', label: 'CLOSE'   }
  return              { fill: 'linear-gradient(90deg,#b91c1c,#dc2626)', glow: '#dc2626', text: '#dc2626', label: 'BEHIND'  }
}

function maColorSet(pct: number) {
  if (pct >= 100) return { fill: 'linear-gradient(90deg,#047857,#059669)', text: '#059669' }
  if (pct >= 75)  return { fill: 'linear-gradient(90deg,#1d4ed8,#2563eb)', text: '#2563eb' }
  if (pct >= 50)  return { fill: 'linear-gradient(90deg,#b45309,#d97706)', text: '#d97706' }
  return              { fill: 'linear-gradient(90deg,#b91c1c,#dc2626)', text: '#dc2626' }
}

const MAX_PCT = 135
const THERM_MAX = 125

function PaceRow({ row, rank, delay }: { row: TargetStoreRow; rank: number; delay: number }) {
  const actualPct   = Math.min(MAX_PCT, (row.currentSales / row.monthlyTarget) * 100)
  const expectedPct = Math.min(MAX_PCT, (row.expectedSalesTillDate / row.monthlyTarget) * 100)
  const cs          = rrColorSet(row.runRateAchPct)
  return (
    <div className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-slate-50 transition-colors group">
      <span className="text-[11px] tabular-nums font-bold w-5 text-center shrink-0 text-gray-400">{rank}</span>
      <span className="text-[11px] w-40 truncate shrink-0 text-gray-600 font-medium" title={row.storeName}>{row.storeName}</span>
      <div className="flex-1 relative h-5 rounded overflow-visible">
        <div className="absolute inset-0 rounded bg-slate-100" />
        {[25, 50, 75].map(m => (
          <div key={m} className="absolute top-0 bottom-0 w-px z-10"
            style={{ left: `${(m / MAX_PCT) * 100}%`, backgroundColor: '#e2e8f0' }} />
        ))}
        <div className="absolute top-[-3px] bottom-[-3px] w-0.5 z-20"
          style={{ left: `${(100 / MAX_PCT) * 100}%`, backgroundColor: 'rgba(71,85,105,0.4)' }} />
        <motion.div className="absolute left-0 top-0.5 bottom-0.5 rounded z-5"
          initial={{ width: 0 }} animate={{ width: `${(actualPct / MAX_PCT) * 100}%` }}
          transition={{ duration: 0.4, ease: 'easeOut', delay }} style={{ background: cs.fill }} />
        {expectedPct > 0 && (
          <div className="absolute top-1/2 z-30 w-2.5 h-2.5 rotate-45"
            style={{ left: `${(expectedPct / MAX_PCT) * 100}%`,
              transform: 'translateX(-50%) translateY(-50%) rotate(45deg)',
              backgroundColor: '#94a3b8', boxShadow: '0 0 4px rgba(148,163,184,0.4)' }} />
        )}
        <motion.div className="absolute top-1/2 z-40 w-3.5 h-3.5 rounded-full"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: delay + 0.35 }}
          style={{ left: `${(actualPct / MAX_PCT) * 100}%`,
            transform: 'translateX(-50%) translateY(-50%)',
            backgroundColor: cs.glow, boxShadow: `0 0 8px ${cs.glow}90, 0 0 16px ${cs.glow}40`,
            border: `2px solid ${cs.glow}50` }} />
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <span className="text-[10px] font-bold tracking-wider px-1.5 py-0.5 rounded"
          style={{ color: cs.label === 'LEADING' || cs.label === 'ON PACE' ? '#059669' : cs.label === 'CLOSE' ? '#d97706' : '#dc2626',
                   backgroundColor: cs.label === 'LEADING' || cs.label === 'ON PACE' ? 'rgba(16,185,129,0.1)' : cs.label === 'CLOSE' ? 'rgba(245,158,11,0.1)' : 'rgba(220,38,38,0.1)' }}>
          {cs.label}
        </span>
        <span className="text-xs font-bold tabular-nums w-14 text-right" style={{ color: cs.text }}>
          {fmtPct(row.runRateAchPct)}
        </span>
      </div>
    </div>
  )
}

function ThermRow({ row, rank, delay }: { row: TargetStoreRow; rank: number; delay: number }) {
  const fillPct = Math.min(THERM_MAX, row.monthlyAchPct)
  const cs      = maColorSet(row.monthlyAchPct)
  return (
    <div className="flex items-center gap-3 px-2 py-2.5 rounded-lg hover:bg-slate-50 transition-colors">
      <span className="text-[11px] tabular-nums font-bold w-5 text-center shrink-0 text-gray-400">{rank}</span>
      <span className="text-[11px] w-40 truncate shrink-0 text-gray-600 font-medium" title={row.storeName}>{row.storeName}</span>
      <div className="flex-1 relative h-4 rounded overflow-hidden">
        <div className="absolute inset-0 rounded bg-slate-100" />
        <div className="absolute inset-0 flex">
          <div style={{ width: `${(25/THERM_MAX)*100}%`, background: 'rgba(220,38,38,0.07)' }} />
          <div style={{ width: `${(25/THERM_MAX)*100}%`, background: 'rgba(217,119,6,0.07)' }} />
          <div style={{ width: `${(25/THERM_MAX)*100}%`, background: 'rgba(37,99,235,0.07)' }} />
          <div style={{ width: `${(25/THERM_MAX)*100}%`, background: 'rgba(5,150,105,0.07)' }} />
          <div style={{ flex: 1, background: 'rgba(5,150,105,0.04)' }} />
        </div>
        {[25, 50, 75, 100].map(m => (
          <div key={m} className="absolute top-0 bottom-0 w-px z-10"
            style={{ left: `${(m/THERM_MAX)*100}%`, backgroundColor: '#cbd5e1' }} />
        ))}
        <div className="absolute top-[-2px] bottom-[-2px] w-0.5 z-20"
          style={{ left: `${(100/THERM_MAX)*100}%`, backgroundColor: 'rgba(71,85,105,0.5)' }} />
        <motion.div className="absolute left-0 top-0 bottom-0 z-5 rounded"
          initial={{ width: 0 }} animate={{ width: `${(fillPct/THERM_MAX)*100}%` }}
          transition={{ duration: 0.4, ease: 'easeOut', delay }} style={{ background: cs.fill }} />
        {[25, 50, 75, 100].map(m => (
          <span key={m} className="absolute top-1/2 text-[8px] z-30 pointer-events-none select-none"
            style={{ left: `${(m/THERM_MAX)*100}%`, transform: 'translateX(-50%) translateY(-50%)', color: 'rgba(255,255,255,0.65)' }}>
            {m}%
          </span>
        ))}
      </div>
      <span className="text-xs font-bold tabular-nums w-14 text-right shrink-0" style={{ color: cs.text }}>{fmtPct(row.monthlyAchPct)}</span>
      <span className="text-[10px] w-20 text-right shrink-0 tabular-nums text-gray-400 font-medium">
        {row.remainingTarget <= 0 ? '✓ HIT' : `-${fmtInr(row.remainingTarget)}`}
      </span>
    </div>
  )
}


function RiskBadge({ status }: { status: RiskStatus }) {
  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap', RISK_CFG[status].badge)}>
      {status}
    </span>
  )
}

function DaySlider({ value, onChange, targetMonth, totalDays }: {
  value: number; onChange: (v: number) => void; targetMonth: string; totalDays: number
}) {
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



// ── Color palette ─────────────────────────────────────────────────────────────

const HEALTH_COLORS: Record<HealthStatus, string> = {
  Healthy:         '#10b981',
  Recovering:      '#0ea5e9',
  Declining:       '#f59e0b',
  Underperforming: '#ef4444',
  Dormant:         '#94a3b8',
  Stable:          '#8b5cf6',
}

const EARLY_TIERS: EarlyTier[] = ['Top Performer', 'Mid-tier', 'Low Tier']

const EARLY_NODE_COLORS = ['#0ea5e9', '#8b5cf6', '#94a3b8']

// Target nodes for Sankey — keyed to the central classification engine categories
const SANKEY_TARGETS: StoreCategory[] = [
  'Rising Star', 'New Bloomer', 'Growing Store', 'Constant Store',
  'Declining Store', 'Fallen Star', 'Inactive Store',
]
// Colors aligned with categoryStyles.ts (hex equivalents of Tailwind classes)
const SANKEY_TARGET_COLORS: Record<StoreCategory, string> = {
  'Rising Star':    '#eab308',
  'New Bloomer':    '#059669',
  'Growing Store':  '#3b82f6',
  'Constant Store': '#8b5cf6',
  'Declining Store':'#f97316',
  'Fallen Star':    '#dc2626',
  'Inactive Store': '#9ca3af',
}

const SANKEY_LINK_COLORS = [
  'rgba(14,165,233,0.20)',
  'rgba(139,92,246,0.20)',
  'rgba(148,163,184,0.20)',
]

// nodeBorder re-uses the shared line token
const nodeBorder = PT.line

// ── Helpers ───────────────────────────────────────────────────────────────────

function winRev(store: StoreRecord, months: string[]): number {
  return months.reduce((s, m) => s + (store.monthly_sales[m] ?? 0), 0)
}

function pctileOf(rev: number, sorted: number[]): number {
  if (!sorted.length) return 0
  return (sorted.filter(r => r <= rev).length / sorted.length) * 100
}

function classifyEarlyTier(pct: number): EarlyTier {
  if (pct >= 67) return 'Top Performer'
  if (pct >= 33) return 'Mid-tier'
  return 'Low Tier'
}

function classifyRecentCategory(
  earlyTier: EarlyTier, recentPct: number, recentRev: number,
): RecentCategory {
  if (recentRev === 0) return 'Consistently Low'
  const band = recentPct >= 67 ? 'Top' : recentPct >= 33 ? 'Mid' : 'Low'
  if (earlyTier === 'Top Performer') {
    if (band === 'Top') return 'Consistent Performer'
    if (band === 'Low') return 'Fallen Star'
    return 'Average'
  }
  if (earlyTier === 'Low Tier') {
    if (band === 'Top') return 'Rising Star'
    if (band === 'Low') return 'Consistently Low'
    return 'Average'
  }
  if (band === 'Top') return 'Consistent Performer'
  if (band === 'Low') return 'Consistently Low'
  return 'Average'
}

function classifyHealth(ePct: number, rPct: number, rRev: number): HealthStatus {
  if (rRev === 0)           return 'Dormant'
  const diff = rPct - ePct
  if (rPct >= 67 && diff >= 0) return 'Healthy'
  if (diff >= 20)           return 'Recovering'
  if (diff <= -25)          return 'Declining'
  if (rPct < 20)            return 'Underperforming'
  return 'Stable'
}

// ── AnimatedNumber ────────────────────────────────────────────────────────────

function AnimatedNumber({ value, className }: { value: number; className?: string }) {
  const mv      = useMotionValue(0)
  const display = useTransform(mv, (v: number) => Math.round(v).toLocaleString())

  useEffect(() => {
    const ctrl = animate(mv, value, { duration: 1.1, ease: [0.22, 1, 0.36, 1] })
    return () => ctrl.stop()
  }, [mv, value])

  return <motion.span className={className}>{display}</motion.span>
}

// ── MiniBar ───────────────────────────────────────────────────────────────────

function MiniBar({ ratio, color }: { ratio: number; color: string }) {
  return (
    <div className="h-[3px] w-full rounded-full bg-gray-100 overflow-hidden mt-1.5">
      <motion.div
        className="h-full rounded-full"
        style={{ backgroundColor: color }}
        initial={{ scaleX: 0, originX: 0 }}
        animate={{ scaleX: Math.min(Math.max(ratio, 0), 1) }}
        transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1], delay: 0.25 }}
      />
    </div>
  )
}

// ── KPI Card ──────────────────────────────────────────────────────────────────

interface KPICardProps {
  label:          string
  value:          number
  sub:            string
  icon:           React.ReactNode
  barRatio?:      number
  barColor?:      string
  danger?:        boolean
  formattedValue?: string
}

function KPICard({ label, value, sub, icon, barRatio, barColor, danger, formattedValue }: KPICardProps) {
  return (
    <motion.div
      variants={kpiItem}
      whileHover={{
        scale: 1.035, y: -4,
        transition: { type: 'spring', stiffness: 420, damping: 26 },
      }}
      whileTap={{ scale: 0.97, transition: { duration: 0.1 } }}
      className={cn(
        'rounded-xl border bg-white p-4 flex flex-col gap-0.5 min-w-0 cursor-default',
        'shadow-sm hover:shadow-md transition-shadow duration-200',
        danger ? 'border-red-200' : 'border-gray-200',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-medium uppercase tracking-widest text-gray-500 truncate">
          {label}
        </p>
        <motion.span
          className={cn('shrink-0', danger ? 'text-red-400' : 'text-gray-400')}
          animate={danger ? { rotate: [0, -8, 8, -4, 0] } : {}}
          transition={{ duration: 0.5, delay: 0.6 }}
        >
          {icon}
        </motion.span>
      </div>

      {formattedValue !== undefined ? (
        <motion.span
          key={formattedValue}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
          className={cn(
            'text-2xl font-bold tabular-nums block',
            danger ? 'text-red-600' : 'text-gray-900',
          )}
        >
          {formattedValue}
        </motion.span>
      ) : (
        <AnimatedNumber
          value={value}
          className={cn(
            'text-2xl font-bold tabular-nums block',
            danger ? 'text-red-600' : 'text-gray-900',
          )}
        />
      )}

      <p className="text-[11px] text-gray-500 truncate">{sub}</p>

      {barRatio !== undefined && barColor && (
        <MiniBar ratio={barRatio} color={barColor} />
      )}
    </motion.div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

interface Props { filters: FilterState }

export default function ExecutiveOverview({ filters }: Props) {
  const { stores, months } = useDataContext()
  const { retailer, retailerCfg } = useRetailerContext()

  const [viewMode, setViewMode] = useState<'revenue' | 'target'>('revenue')
  const [dayOfMonth, setDayOfMonth] = useState<number>(() => {
    const d = new Date().getDate()
    return d
  })
  const [filterState, setFilterState] = useState<string>('')
  const [tableSearch, setTableSearch] = useState<string>('')
  const [tableSortKey, setTableSortKey] = useState<TableSortKey>('achPct')
  const [tableSortDir, setTableSortDir] = useState<'asc' | 'desc'>('desc')
  const [tablePage, setTablePage] = useState<number>(1)
  const [leaderboardFilter, setLeaderboardFilter] = useState<'all' | 'top' | 'bottom'>('top')
  const [thermometerFilter, setThermometerFilter] = useState<'all' | 'top' | 'bottom'>('top')

  useEffect(() => {
    if (retailer !== 'croma' && retailer !== 'vijaysales') {
      setViewMode('revenue')
    }
  }, [retailer])

  const tabClassification = useMemo(() => {
    return getTabClassification(stores, months, filters.planCategory);
  }, [stores, months, filters.planCategory]);

  // ── Filter + split ─────────────────────────────────────────────────────────
  const { fs, fm, early, mid, recent } = useMemo(() => {
    let fs = transformStoresByPlanCategory(stores, filters.planCategory)
    if (filters.state)              fs = fs.filter(s => s.state === filters.state)
    if (filters.productSubcategory) fs = fs.filter(s => s.category?.toLowerCase() === filters.productSubcategory.toLowerCase())
    let fm = months
    if (filters.fromMonth) {
      const i = months.indexOf(filters.fromMonth); if (i >= 0) fm = fm.slice(i)
    }
    if (filters.toMonth) {
      const i = months.indexOf(filters.toMonth); if (i >= 0) fm = fm.slice(0, i + 1)
    }
    const { earlyMonths: early, midMonths: mid, recentMonths: recent } = allocatePhases(fm)
    return { fs, fm, early, mid, recent }
  }, [stores, months, filters])

  // ── Target Tracker Computations ─────────────────────────────────────────────

  const targetMonth = useMemo(() => {
    return fm[fm.length - 1] || 'Jun-2026'
  }, [fm])

  const totalDays = useMemo(() => getDaysInMonth(targetMonth), [targetMonth])
  const elapsed = useMemo(() => Math.min(dayOfMonth, totalDays), [dayOfMonth, totalDays])

  const targetStatesList = useMemo(() => {
    const statesSet = new Set<string>()
    fs.forEach(s => {
      if (s.target && s.target > 0 && s.state) {
        statesSet.add(s.state)
      }
    })
    return [...statesSet].sort()
  }, [fs])

  const targetStores = useMemo(() => {
    let list = fs.filter(s => s.target && s.target > 0)
    if (filterState) {
      list = list.filter(s => s.state === filterState)
    }
    return list
  }, [fs, filterState])

  const storeCalcs = useMemo(() => {
    const remaining = Math.max(0, totalDays - elapsed)
    return targetStores.map(store => {
      const target = store.target || 0
      const currentSales = store.monthly_sales[targetMonth] ?? 0
      const achPct = target > 0 ? (currentSales / target) * 100 : 0
      const expectedPct = (elapsed / totalDays) * 100
      const gap = target - currentSales
      const gapPct = target > 0 ? (gap / target) * 100 : 0
      const projected = elapsed > 0 ? (currentSales / elapsed) * totalDays : 0
      const projAchPct = target > 0 ? (projected / target) * 100 : 0
      const reqDRR = remaining > 0 && gap > 0 ? gap / remaining : 0
      const expectedSales = target * (elapsed / totalDays)
      const status = getRisk(projAchPct)

      return {
        store,
        target,
        currentSales,
        achPct,
        expectedPct,
        gap,
        gapPct,
        projected,
        projAchPct,
        reqDRR,
        expectedSales,
        status,
      }
    })
  }, [targetStores, elapsed, totalDays, targetMonth])

  const national = useMemo(() => {
    const remaining = Math.max(0, totalDays - elapsed)
    const totalTarget = storeCalcs.reduce((s, d) => s + d.target, 0)
    const totalSales = storeCalcs.reduce((s, d) => s + d.currentSales, 0)
    const achPct = totalTarget > 0 ? (totalSales / totalTarget) * 100 : 0
    const expectedPct = (elapsed / totalDays) * 100
    const gap = totalTarget - totalSales
    const projected = elapsed > 0 ? (totalSales / elapsed) * totalDays : 0
    const reqDRR = remaining > 0 && gap > 0 ? gap / remaining : 0

    return {
      totalTarget,
      totalSales,
      achPct,
      expectedPct,
      gap,
      projected,
      reqDRR,
      remaining_target: Math.max(0, gap),
      elapsed,
      remaining,
    }
  }, [storeCalcs, elapsed, totalDays])

  // ── Plotly Traces ─────────────────────────────────────────────────────────

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
      axis: { range: [0, 150], tickwidth: 1, tickcolor: '#374151', tickfont: { color: PT.font, size: 10 }, dtick: 25 },
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

  const paceTraces = useMemo(() => {
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
      { type: 'scatter' as const, mode: 'lines' as const, name: 'Target',
        x: [0, totalDays], y: [national.totalTarget, national.totalTarget],
        line: { color: '#f59e0b80', width: 1.5, dash: 'longdash' as const },
        hovertemplate: 'Target: ₹%{y:,.0f}<extra>Target</extra>' },
      { type: 'scatter' as const, mode: 'markers' as const, name: 'Expected by Today',
        x: [elapsed], y: [expectedToday],
        marker: { size: 10, color: '#6b7280', symbol: 'diamond' as const, line: { color: '#374151', width: 1.5 } },
        hovertemplate: `Day ${elapsed}<br>Should have: ₹%{y:,.0f}<extra>Expected by Day ${elapsed}</extra>` },
    ]
  }, [national, targetMonth, totalDays, elapsed])

  const counts = useMemo(() => {
    return BANDS.map(b => storeCalcs.filter(r => r.achPct >= b.min && r.achPct < b.max).length)
  }, [storeCalcs])

  const distributionTrace = useMemo(() => ({
    type: 'bar' as const, x: BANDS.map(b => b.label), y: counts,
    marker: { color: BANDS.map(b => b.color), opacity: 0.85, line: { color: BANDS.map(b => `${b.color}60`), width: 1 } },
    text: counts.map(c => String(c)), textposition: 'outside' as const, textfont: { color: PT.font, size: 12 },
    hovertemplate: '<b>%{x}</b><br>%{y} stores<extra></extra>'
  }), [counts])

  // ── Store table ───────────────────────────────────────────────────────────

  const storeTableData = useMemo(() => {
    let rows = [...storeCalcs]
    const q = tableSearch.trim().toLowerCase()
    if (q) rows = rows.filter(r => (r.store.store_name || '').toLowerCase().includes(q) || (r.store.state || '').toLowerCase().includes(q))
    rows.sort((a, b) => {
      let diff = 0
      switch (tableSortKey) {
        case 'name':       diff = (a.store.store_name || '').localeCompare(b.store.store_name || ''); break
        case 'state':      diff = (a.store.state || '').localeCompare(b.store.state || ''); break
        case 'target':     diff = a.target - b.target; break
        case 'sales':      diff = a.currentSales - b.currentSales; break
        case 'achPct':     diff = a.achPct - b.achPct; break
        case 'gapPct':     diff = a.gapPct - b.gapPct; break
        case 'reqDRR':     diff = a.reqDRR - b.reqDRR; break
        case 'projected':  diff = a.projected - b.projected; break
        case 'projAchPct': diff = a.projAchPct - b.projAchPct; break
        case 'status':     diff = a.projAchPct - b.projAchPct; break
      }
      return tableSortDir === 'asc' ? diff : -diff
    })
    return rows
  }, [storeCalcs, tableSearch, tableSortKey, tableSortDir])

  const TABLE_PAGE_SIZE = 15
  const totalPages = Math.max(1, Math.ceil(storeTableData.length / TABLE_PAGE_SIZE))
  const pagedRows  = storeTableData.slice((tablePage - 1) * TABLE_PAGE_SIZE, tablePage * TABLE_PAGE_SIZE)

  const toggleSort = (col: TableSortKey) => {
    if (tableSortKey === col) setTableSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setTableSortKey(col); setTableSortDir('desc') }
  }

  const exportCsvData = () => {
    const headers = ['Store Name', 'State', 'Target (₹)', 'Current Sales (₹)', 'Achievement %', 'Gap (₹)', 'Gap %', 'Req Daily Sales (₹)', 'Projected Month-End (₹)', 'Projected %', 'Risk Status']
    const rows = storeTableData.map(r => [
      r.store.store_name, r.store.state,
      r.target.toFixed(0), r.currentSales.toFixed(0),
      r.achPct.toFixed(1) + '%', r.gap.toFixed(0), r.gapPct.toFixed(1) + '%',
      r.reqDRR.toFixed(0), r.projected.toFixed(0), r.projAchPct.toFixed(1) + '%', r.status,
    ])
    exportCsv(`target-tracker-day${elapsed}-${targetMonth}`, headers, rows)
  }

  const exportXlsxData = () => {
    const headers = ['Store Name', 'State', 'Target (₹)', 'Current Sales (₹)', 'Achievement %', 'Gap (₹)', 'Gap %', 'Req Daily Sales (₹)', 'Projected Month-End (₹)', 'Projected %', 'Risk Status']
    const rows = storeTableData.map(r => [
      r.store.store_name, r.store.state,
      r.target, r.currentSales,
      r.achPct.toFixed(1) + '%', r.gap, r.gapPct.toFixed(1) + '%',
      r.reqDRR.toFixed(0), r.projected.toFixed(0), r.projAchPct.toFixed(1) + '%', r.status,
    ])
    exportExcel(`target-tracker-day${elapsed}-${targetMonth}`, headers, rows)
  }

  // ── Journey data ───────────────────────────────────────────────────────────
  const journeys = useMemo(() => {
    if (!fs.length || !early.length || !recent.length) return []
    const eSorted = fs.map(s => winRev(s, early)).sort((a, b) => a - b)
    const rSorted = fs.map(s => winRev(s, recent)).sort((a, b) => a - b)
    return fs.map(store => {
      const eRev = winRev(store, early)
      const rRev = winRev(store, recent)
      const ePct = pctileOf(eRev, eSorted)
      const rPct = pctileOf(rRev, rSorted)
      const earlyTier      = classifyEarlyTier(ePct)
      const recentCategory = classifyRecentCategory(earlyTier, rPct, rRev)
      const health         = classifyHealth(ePct, rPct, rRev)
      return { store, eRev, rRev, ePct, rPct, earlyTier, recentCategory, health }
    })
  }, [fs, early, recent])

  // ── KPIs ───────────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    // Always show the state/category filtered store count, regardless of whether
    // the date window is wide enough for phase analysis. This keeps "Stores in Scope"
    // consistent with the count shown on every other dashboard page.
    const scope    = fs.length
    const improved = journeys.filter(j => j.rPct > j.ePct).length
    const declined = journeys.filter(j => j.rPct <= j.ePct).length
    const dormant  = journeys.filter(j => j.rRev === 0).length

    // Use the central classification engine so counts match the detail pages
    let engineScope = tabClassification.metrics
    if (filters.state)              engineScope = engineScope.filter(m => m.store.state === filters.state)
    if (filters.productSubcategory) engineScope = engineScope.filter(m => m.store.category?.toLowerCase() === filters.productSubcategory.toLowerCase())
    const rising = engineScope.filter(m => m.category === 'Rising Star').length
    const fallen = engineScope.filter(m => m.category === 'Fallen Star').length

    return { scope, improved, declined, rising, fallen, dormant }
  }, [fs, journeys, tabClassification, filters])

  // ── Sankey (uses the same engineScope as the KPI cards) ────────────────────
  const sankeyTrace = useMemo(() => {
    // Mirror the exact filter the KPI cards apply so counts stay in sync
    let engineScope = tabClassification.metrics
    if (filters.state)              engineScope = engineScope.filter(m => m.store.state === filters.state)
    if (filters.productSubcategory) engineScope = engineScope.filter(m => m.store.category?.toLowerCase() === filters.productSubcategory.toLowerCase())

    if (!engineScope.length) return null

    // Early tier derived from earlyTotal percentile within filtered scope
    const sortedEarlyTotals = engineScope.map(m => m.earlyTotal).sort((a, b) => a - b)
    const earlyTierOf = (earlyTotal: number): EarlyTier => {
      const pct = sortedEarlyTotals.filter(t => t <= earlyTotal).length / sortedEarlyTotals.length * 100
      if (pct >= 67) return 'Top Performer'
      if (pct >= 33) return 'Mid-tier'
      return 'Low Tier'
    }

    const labels = [...EARLY_TIERS, ...SANKEY_TARGETS]
    const colors = [...EARLY_NODE_COLORS, ...SANKEY_TARGETS.map(c => SANKEY_TARGET_COLORS[c])]

    const flowMap: Record<string, number> = {}
    for (const m of engineScope) {
      const src = EARLY_TIERS.indexOf(earlyTierOf(m.earlyTotal))
      const tgt = EARLY_TIERS.length + SANKEY_TARGETS.indexOf(m.category)
      const key = `${src}_${tgt}`
      flowMap[key] = (flowMap[key] ?? 0) + 1
    }

    const sources: number[] = [], targets: number[] = []
    const values: number[]  = [], linkColors: string[] = []
    for (const [k, v] of Object.entries(flowMap)) {
      const [s, t] = k.split('_').map(Number)
      sources.push(s); targets.push(t); values.push(v)
      linkColors.push(SANKEY_LINK_COLORS[s % SANKEY_LINK_COLORS.length])
    }

    // ── Debug validation ──────────────────────────────────────────────────────
    const totalInScope  = engineScope.length
    const sankeyTotal   = values.reduce((s, v) => s + v, 0)
    const fallenTotal   = engineScope.filter(m => m.category === 'Fallen Star').length
    const risingTotal   = engineScope.filter(m => m.category === 'Rising Star').length
    const missingStores = totalInScope - sankeyTotal

    console.group('[Sankey Debug]')
    console.log('Stores in Scope      :', totalInScope)
    console.log('Sankey Source Total  :', sankeyTotal)
    console.log('Sankey Target Total  :', sankeyTotal)
    console.log('Fallen Star Total    :', fallenTotal)
    console.log('Rising Star Total    :', risingTotal)
    console.log('Missing Stores       :', missingStores)
    console.groupEnd()

    return { labels, colors, sources, targets, values, linkColors }
  }, [tabClassification, filters])

  // ── Donut ──────────────────────────────────────────────────────────────────
  const donutCounts = useMemo(() => {
    const c: Record<HealthStatus, number> = {
      Healthy: 0, Recovering: 0, Declining: 0, Underperforming: 0, Dormant: 0, Stable: 0,
    }
    for (const j of journeys) c[j.health]++
    return c
  }, [journeys])

  // ── Bar data ───────────────────────────────────────────────────────────────
  const barEarly = useMemo(() =>
    early.map(m => ({ m, rev: fs.reduce((s, st) => s + (st.monthly_sales[m] ?? 0), 0) })),
  [fs, early])

  const barMid = useMemo(() =>
    mid.map(m => ({ m, rev: fs.reduce((s, st) => s + (st.monthly_sales[m] ?? 0), 0) })),
  [fs, mid])

  const barRecent = useMemo(() =>
    recent.map(m => ({ m, rev: fs.reduce((s, st) => s + (st.monthly_sales[m] ?? 0), 0) })),
  [fs, recent])

  const totalEarly  = barEarly.reduce((s, d)  => s + d.rev, 0)
  const totalMid    = barMid.reduce((s, d)    => s + d.rev, 0)
  const totalRecent = barRecent.reduce((s, d) => s + d.rev, 0)
  const phaseShift  = totalEarly > 0 ? (totalRecent - totalEarly) / totalEarly * 100 : null

  const earlyLabel  = early.length   ? `${early[0]} – ${early[early.length - 1]}`     : ''
  const midLabel    = mid.length     ? `${mid[0]} – ${mid[mid.length - 1]}`            : ''
  const recentLabel = recent.length  ? `${recent[0]} – ${recent[recent.length - 1]}`  : ''

  // ── Revenue Context Narrative ───────────────────────────────────────────────
  const phaseNarrative = useMemo(() => {
    const totalAll = totalEarly + totalMid + totalRecent
    if (totalAll === 0 || fs.length === 0) return null

    const earlyShare  = totalAll > 0 ? (totalEarly / totalAll * 100) : 0
    const midShare    = totalAll > 0 ? (totalMid   / totalAll * 100) : 0
    const recentShare = totalAll > 0 ? (totalRecent / totalAll * 100) : 0

    const earlyMonthAvg  = early.length  ? totalEarly  / early.length  : 0
    const midMonthAvg    = mid.length    ? totalMid    / mid.length    : 0
    const recentMonthAvg = recent.length ? totalRecent / recent.length : 0

    // How many stores contributed revenue in each phase
    const earlyActive  = fs.filter(s => early.some(m => (s.monthly_sales[m] ?? 0) > 0)).length
    const midActive    = fs.filter(s => mid.some(m => (s.monthly_sales[m] ?? 0) > 0)).length
    const recentActive = fs.filter(s => recent.some(m => (s.monthly_sales[m] ?? 0) > 0)).length

    // Month-over-month momentum within early phase
    const earlyMomArr = barEarly.map((d, i) => i === 0 ? null : earlyMonthAvg === 0 ? null : (d.rev - barEarly[i-1].rev) / Math.max(barEarly[i-1].rev, 1) * 100)
    const earlyMomAvg = earlyMomArr.filter((v): v is number => v !== null).reduce((s, v) => s + v, 0) / Math.max(earlyMomArr.filter(v => v !== null).length, 1)

    const recentMomArr = barRecent.map((d, i) => i === 0 ? null : (d.rev - barRecent[i-1].rev) / Math.max(barRecent[i-1].rev, 1) * 100)
    const recentMomAvg = recentMomArr.filter((v): v is number => v !== null).reduce((s, v) => s + v, 0) / Math.max(recentMomArr.filter(v => v !== null).length, 1)

    const earlyPeak  = barEarly.length  ? Math.max(...barEarly.map(d => d.rev))  : 0
    const recentPeak = barRecent.length ? Math.max(...barRecent.map(d => d.rev)) : 0

    const earlyLow   = barEarly.filter(d => d.rev > 0).length ? Math.min(...barEarly.filter(d => d.rev > 0).map(d => d.rev))  : 0
    const recentLow  = barRecent.filter(d => d.rev > 0).length ? Math.min(...barRecent.filter(d => d.rev > 0).map(d => d.rev)) : 0

    const networkGrowthPct = phaseShift

    // Mid vs early
    const midGrowth    = earlyMonthAvg > 0 ? (midMonthAvg    - earlyMonthAvg) / earlyMonthAvg * 100 : null
    const recentGrowth = earlyMonthAvg > 0 ? (recentMonthAvg - earlyMonthAvg) / earlyMonthAvg * 100 : null

    return { earlyShare, midShare, recentShare, earlyMonthAvg, midMonthAvg, recentMonthAvg, earlyActive, midActive, recentActive, earlyMomAvg, recentMomAvg, earlyPeak, recentPeak, earlyLow, recentLow, networkGrowthPct, midGrowth, recentGrowth, totalAll }
  }, [barEarly, barMid, barRecent, totalEarly, totalMid, totalRecent, fs, early, mid, recent, phaseShift])

  const n       = kpis.scope || 1
  const cardCls = 'rounded-xl border border-gray-200 bg-white p-4 shadow-sm'
  const emptyMsg = 'flex items-center justify-center h-64 text-gray-400 text-sm'

  const targetStoreRows: TargetStoreRow[] = useMemo(() => {
    return storeCalcs.map(c => ({
      storeName: c.store.store_name || '',
      storeId: c.store.store_id,
      monthlyTarget: c.target,
      currentSales: c.currentSales,
      dailyTarget: c.target / (totalDays || 1),
      elapsedDays: elapsed,
      expectedSalesTillDate: c.expectedSales,
      runRateAchPct: c.expectedSales > 0 ? (c.currentSales / c.expectedSales) * 100 : 0,
      monthlyAchPct: c.achPct,
      remainingTarget: c.gap,
      projectedMonthEnd: c.projected,
      projectedAchPct: c.projAchPct,
      status: c.status,
    }))
  }, [storeCalcs, totalDays, elapsed])

  const sortedPaceRows = useMemo(() => {
    const list = [...targetStoreRows]
    list.sort((a, b) => b.runRateAchPct - a.runRateAchPct)
    if (leaderboardFilter === 'top') {
      return list.slice(0, 10)
    } else if (leaderboardFilter === 'bottom') {
      return [...list].reverse().slice(0, 10)
    }
    return list
  }, [targetStoreRows, leaderboardFilter])

  const sortedThermRows = useMemo(() => {
    const list = [...targetStoreRows]
    list.sort((a, b) => b.monthlyAchPct - a.monthlyAchPct)
    if (thermometerFilter === 'top') {
      return list.slice(0, 10)
    } else if (thermometerFilter === 'bottom') {
      return [...list].reverse().slice(0, 10)
    }
    return list
  }, [targetStoreRows, thermometerFilter])

  useEffect(() => {
    setTablePage(1)
  }, [tableSearch, tableSortKey, tableSortDir])

  const renderTargetMode = () => {
    const gapPositive = national.gap > 0

    return (
      <div className="space-y-6 animate-in fade-in duration-200">
        {/* ── Page Header ── */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
          className="flex items-center justify-between gap-3 flex-wrap pb-1 border-b border-gray-100"
        >
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">Target Command Center</span>
            </div>
            <h2 className="text-xl font-bold text-gray-950">What is the status of the monthly targets?</h2>
            <p className="text-sm text-gray-500 mt-0.5 max-w-2xl leading-relaxed">
              Target month: <span className="text-blue-600 font-semibold">{targetMonth || '—'}</span>
              {' · '}{storeCalcs.length} stores · OOW Budget · Day {elapsed} of {totalDays}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {targetStatesList.length > 0 && (
              <Select value={filterState || '__all__'} onValueChange={v => setFilterState(v === '__all__' ? '' : v)}>
                <SelectTrigger className="h-8 w-36 text-xs bg-white">
                  <SelectValue placeholder="All States" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All States</SelectItem>
                  {targetStatesList.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            )}

            {/* Analysis Mode Toggle */}
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-gray-500 font-medium">Analysis Mode:</span>
              <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5">
                <button
                  onClick={() => setViewMode('revenue')}
                  className={cn(
                    'px-3 py-1 rounded-md text-[11px] font-semibold transition-all duration-200',
                    viewMode === 'revenue'
                      ? 'bg-white text-blue-700 shadow-sm border border-blue-200'
                      : 'text-gray-500 hover:text-gray-700',
                  )}
                >
                  💰 Sales Revenue
                </button>
                <button
                  onClick={() => setViewMode('target')}
                  className={cn(
                    'px-3 py-1 rounded-md text-[11px] font-semibold transition-all duration-200',
                    viewMode === 'target'
                      ? 'bg-white text-amber-700 shadow-sm border border-amber-200'
                      : 'text-gray-500 hover:text-gray-700',
                  )}
                >
                  🎯 Target Tracking
                </button>
              </div>
            </div>
          </div>
        </motion.div>

        {/* ── Day Slider ── */}
        <DaySlider value={dayOfMonth} onChange={setDayOfMonth} targetMonth={targetMonth} totalDays={totalDays} />

        {/* ── ROW 1: KPI Cards ── */}
        <motion.div
          className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7"
          variants={kpiContainer}
          initial="hidden"
          animate="show"
        >
          <KPICard
            label="OOW Target"
            value={national.totalTarget}
            formattedValue={fmtInr(national.totalTarget)}
            sub={`${storeCalcs.length} stores`}
            icon={<Target className="h-4 w-4" />}
          />
          <KPICard
            label="Sales"
            value={national.totalSales}
            formattedValue={fmtInr(national.totalSales)}
            sub={`Day ${elapsed} of ${totalDays}`}
            icon={<IndianRupee className="h-4 w-4 text-blue-500" />}
          />
          <KPICard
            label="Achievement %"
            value={national.achPct}
            formattedValue={`${national.achPct.toFixed(1)}%`}
            sub={`Expected ${national.expectedPct.toFixed(1)}%`}
            danger={national.achPct < national.expectedPct}
            icon={national.achPct >= national.expectedPct
              ? <TrendingUp className="h-4 w-4 text-emerald-500" />
              : <TrendingDown className="h-4 w-4 text-red-500" />}
          />
          <KPICard
            label="Gap to Target"
            value={national.gap}
            formattedValue={gapPositive ? fmtInr(national.gap) : '✓ Exceeded'}
            sub={gapPositive ? 'still to be sold' : `by ${fmtInr(-national.gap)}`}
            danger={gapPositive}
            icon={gapPositive ? <AlertCircle className="h-4 w-4 text-red-500" /> : <TrendingUp className="h-4 w-4 text-emerald-500" />}
          />
          <KPICard
            label="Remaining Target"
            value={national.remaining_target}
            formattedValue={fmtInr(national.remaining_target)}
            sub={`${national.remaining} days left`}
            icon={<Minus className="h-4 w-4 text-amber-500" />}
          />
          <KPICard
            label="Req. Daily Run Rate"
            value={national.reqDRR}
            formattedValue={fmtInr(national.reqDRR)}
            sub="per day to close gap"
            icon={<Zap className="h-4 w-4 text-amber-500" />}
          />
          <KPICard
            label="Projected Month-End"
            value={national.projected}
            formattedValue={fmtInr(national.projected)}
            sub={`${fmtPct((national.projected / (national.totalTarget || 1) - 1) * 100)} vs target`}
            danger={national.projected < national.totalTarget}
            icon={<Activity className="h-4 w-4" />}
          />
        </motion.div>

        {/* ── ROW 2: Gauge + Pace ── */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          <motion.div {...panelSpring(0.1)}
            className="lg:col-span-2 rounded-xl border border-gray-200 bg-white p-4 shadow-sm overflow-hidden">
            <h3 className="mb-0.5 text-sm font-semibold text-gray-800">
              OOW Target Achievement — {targetMonth}
            </h3>
            <p className="mb-2 text-[11px] text-gray-500">
              Sales vs OOW budget ·
              <span className="text-red-500"> &lt;80%</span> ·
              <span className="text-amber-500"> 80–95%</span> ·
              <span className="text-emerald-500"> &gt;95%</span>
            </p>
            <div className="w-full max-w-[360px] mx-auto overflow-hidden">
              <Plot data={[gaugeTrace]}
                layout={{ paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)', font: { color: PT.font, family: 'Inter,sans-serif', size: 11 }, margin: { l: 24, r: 24, t: 16, b: 8 }, height: 260 }}
                config={{ displayModeBar: false, responsive: true }} style={{ width: '100%' }} />
            </div>
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
                font: { color: PT.font, family: 'Inter,sans-serif', size: 11 },
                legend: { bgcolor: 'rgba(0,0,0,0)', font: { color: PT.font, size: 10 }, orientation: 'h' as const, y: -0.26 },
                xaxis: { gridcolor: PT.grid, linecolor: PT.line, tickcolor: PT.line, automargin: true, title: { text: 'Day of Month' }, dtick: 5, range: [0, totalDays + 0.5] },
                yaxis: { gridcolor: PT.grid, linecolor: PT.line, tickcolor: PT.line, automargin: true, title: { text: `Cumulative Sales (₹) — ${targetMonth}` }, ...plotlyInrTickVals(Math.max(national.totalSales, national.totalTarget) * 1.1) },
                hovermode: 'closest' as const,
                margin: { l: 70, r: 16, t: 8, b: 100 }, height: 310,
                shapes: [{ type: 'line' as const, x0: elapsed, x1: elapsed, y0: 0, y1: 1, xref: 'x' as const, yref: 'paper' as const, line: { color: '#3b82f650', width: 1.5, dash: 'dot' as const } }],
                annotations: [{ x: elapsed, y: 1, xref: 'x' as const, yref: 'paper' as const, text: `Day ${elapsed}`, showarrow: false, font: { color: '#3b82f6', size: 10 }, yanchor: 'bottom' as const }],
              }}
              config={{ displayModeBar: false, responsive: true }} style={{ width: '100%' }} />
          </motion.div>
        </div>



        {/* ── ROW 5: Leaderboards & Distribution ── */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* Pace Leaderboard */}
          <motion.div {...panelSpring(0.3)} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-2 mb-1">
              <h3 className="text-sm font-semibold text-gray-800">Pace Leaderboard</h3>
              <select
                value={leaderboardFilter}
                onChange={e => setLeaderboardFilter(e.target.value as any)}
                className="text-xs border border-gray-200 rounded px-1.5 py-0.5 bg-gray-50 text-gray-600 outline-none"
              >
                <option value="top">Top 10 Pace</option>
                <option value="bottom">Bottom 10 Pace</option>
              </select>
            </div>
            <p className="text-[11px] text-gray-500 mb-3">Stores sorted by run rate pace vs target</p>
            <div className="space-y-1.5 max-h-[380px] overflow-y-auto pr-1">
              {sortedPaceRows.map((row, i) => (
                <PaceRow key={row.storeId} row={row} rank={leaderboardFilter === 'top' ? i + 1 : storeCalcs.length - 10 + i + 1} delay={i * 0.03} />
              ))}
            </div>
          </motion.div>

          {/* Achievement Thermometer */}
          <motion.div {...panelSpring(0.33)} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-2 mb-1">
              <h3 className="text-sm font-semibold text-gray-800">Achievement Thermometer</h3>
              <select
                value={thermometerFilter}
                onChange={e => setThermometerFilter(e.target.value as any)}
                className="text-xs border border-gray-200 rounded px-1.5 py-0.5 bg-gray-50 text-gray-600 outline-none"
              >
                <option value="top">Top 10 Achieved</option>
                <option value="bottom">Bottom 10 Achieved</option>
              </select>
            </div>
            <p className="text-[11px] text-gray-500 mb-3">Cumulative monthly achievement vs OOW target</p>
            <div className="space-y-1.5 max-h-[380px] overflow-y-auto pr-1">
              {sortedThermRows.map((row, i) => (
                <ThermRow key={row.storeId} row={row} rank={thermometerFilter === 'top' ? i + 1 : storeCalcs.length - 10 + i + 1} delay={i * 0.03} />
              ))}
            </div>
          </motion.div>

          {/* Achievement Distribution */}
          <motion.div {...panelSpring(0.36)} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-800">Achievement Distribution</h3>
            <p className="text-[11px] text-gray-500 mb-3">Number of stores in each achievement percentage band</p>
            <div className="flex items-center justify-center">
              <Plot
                data={[distributionTrace]}
                layout={{
                  paper_bgcolor: 'rgba(0,0,0,0)',
                  plot_bgcolor:  'rgba(0,0,0,0)',
                  font:   { color: PT.font, family: 'Inter,sans-serif', size: 10 },
                  xaxis:  { gridcolor: PT.grid, linecolor: PT.line, tickcolor: PT.line, automargin: true },
                  yaxis:  { gridcolor: PT.grid, linecolor: PT.line, tickcolor: PT.line, automargin: true, dtick: 5 },
                  margin: { l: 30, r: 10, t: 20, b: 40 },
                  height: 310,
                }}
                config={{ displayModeBar: false, responsive: true }}
                style={{ width: '100%' }}
              />
            </div>
          </motion.div>
        </div>

        {/* ── ROW 6: Store Command Center Table ── */}
        <motion.div {...panelSpring(0.4)}
          className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h3 className="text-sm font-semibold text-gray-800">Store Command Center</h3>
              <p className="text-[11px] text-gray-500 mt-0.5">
                {storeTableData.length} store{storeTableData.length !== 1 ? 's' : ''} · sortable · searchable · Page {tablePage} of {totalPages}
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
              <button onClick={exportCsvData}
                className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-white border border-gray-200 text-xs text-gray-600 hover:text-gray-900 hover:border-gray-400 shadow-sm transition-colors">
                <Download className="h-3.5 w-3.5" /> CSV
              </button>
              <button onClick={exportXlsxData}
                className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-white border border-emerald-200 text-xs text-emerald-700 hover:text-emerald-900 hover:border-emerald-400 shadow-sm transition-colors">
                <Download className="h-3.5 w-3.5" /> Excel
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="px-3 py-2.5 text-left text-xs text-gray-400 w-8">#</th>
                  {([
                    { col: 'name'       as TableSortKey, label: 'Store'       },
                    { col: 'state'      as TableSortKey, label: 'State'       },
                    { col: 'target'     as TableSortKey, label: 'OOW Target'  },
                    { col: 'sales'      as TableSortKey, label: 'Sales'       },
                    { col: 'achPct'     as TableSortKey, label: 'Ach %'       },
                    { col: 'gapPct'     as TableSortKey, label: 'Gap %'       },
                    { col: 'reqDRR'     as TableSortKey, label: 'Req Daily'   },
                    { col: 'projected'  as TableSortKey, label: 'Projection'  },
                    { col: 'status'     as TableSortKey, label: 'Risk Status' },
                  ] as const).map(({ col, label }) => (
                    <th key={col} className="px-3 py-2.5 text-left">
                      <SortBtn col={col} sortKey={tableSortKey} sortDir={tableSortDir} onSort={toggleSort} label={label} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pagedRows.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-3 py-10 text-center text-gray-400 text-sm">
                      No stores match "{tableSearch}"
                    </td>
                  </tr>
                ) : pagedRows.map((row, i) => {
                  const globalIdx = (tablePage - 1) * TABLE_PAGE_SIZE + i + 1
                  return (
                    <tr key={row.store.store_id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                      <td className="px-3 py-2.5 text-gray-400 tabular-nums text-xs">{globalIdx}</td>
                      <td className="px-3 py-2.5">
                        <p className="text-gray-950 font-semibold text-xs truncate max-w-[180px]" title={row.store.store_name}>
                          {row.store.store_name}
                        </p>
                      </td>
                      <td className="px-3 py-2.5 text-gray-500 text-xs whitespace-nowrap">{row.store.state || '—'}</td>
                      <td className="px-3 py-2.5 text-gray-700 tabular-nums text-xs whitespace-nowrap">{fmtInr(row.target)}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <p className="text-gray-900 tabular-nums text-xs font-semibold">{fmtInr(row.currentSales)}</p>
                      </td>
                      <td className={cn('px-3 py-2.5 tabular-nums text-xs font-semibold whitespace-nowrap', row.achPct >= 95 ? 'text-emerald-600' : row.achPct >= 80 ? 'text-amber-600' : 'text-red-600')}>
                        {row.achPct.toFixed(1)}%
                      </td>
                      <td className={cn('px-3 py-2.5 tabular-nums text-xs whitespace-nowrap', row.gapPct <= 0 ? 'text-emerald-600' : row.gapPct <= 20 ? 'text-amber-600' : 'text-red-600')}>
                        {row.gap <= 0 ? `+${fmtPct(-row.gapPct)}` : fmtPct(row.gapPct)}
                      </td>
                      <td className="px-3 py-2.5 text-amber-600 tabular-nums text-xs whitespace-nowrap">
                        {row.reqDRR > 0 ? fmtInr(row.reqDRR) : '—'}
                      </td>
                      <td className={cn('px-3 py-2.5 tabular-nums text-xs font-medium whitespace-nowrap', row.projected >= row.target ? 'text-emerald-600' : 'text-red-600')}>
                        {fmtInr(row.projected)}
                        <span className="text-[10px] text-gray-400 ml-1">({row.projAchPct.toFixed(0)}%)</span>
                      </td>
                      <td className="px-3 py-2.5"><RiskBadge status={row.status} /></td>
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
      </div>
    )
  }

  if (viewMode === 'target') {
    return renderTargetMode()
  }

  return (
    <div className="space-y-5 animate-in fade-in duration-200">

      {/* ── Header ── */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="pb-1 border-b border-gray-100"
      >
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">Business Snapshot</span>
        </div>
        <h2 className="text-xl font-bold text-gray-900">What is happening across the network?</h2>
        <p className="text-sm text-gray-500 mt-0.5 max-w-2xl leading-relaxed">
          Store trajectory from early phase ({earlyLabel || 'Jun-2025 – Aug-2025'}) to recent phase ({recentLabel || 'Dec-2025 – Feb-2026'}). Revenue trend provides financial context; the Sankey shows how stores moved in performance tier.
        </p>
      </motion.div>

      {/* ── Analysis Mode Toggle ── */}
      {(retailer === 'croma' || retailer === 'vijaysales') && (
        <motion.div {...panelSpring(0.06)} className="flex items-center gap-2 mb-1">
          <span className="text-[11px] text-gray-500 font-medium">Analysis Mode:</span>
          <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5">
            <button
              onClick={() => setViewMode('revenue')}
              className={cn(
                'px-3 py-1 rounded-md text-[11px] font-semibold transition-all duration-200',
                (viewMode as string) === 'revenue'
                  ? 'bg-white text-blue-700 shadow-sm border border-blue-200'
                  : 'text-gray-500 hover:text-gray-700',
              )}
            >
              💰 Sales Revenue
            </button>
            <button
              onClick={() => setViewMode('target')}
              className={cn(
                'px-3 py-1 rounded-md text-[11px] font-semibold transition-all duration-200',
                (viewMode as string) === 'target'
                  ? 'bg-white text-amber-700 shadow-sm border border-amber-200'
                  : 'text-gray-500 hover:text-gray-700',
              )}
            >
              🎯 Target Tracking
            </button>
          </div>
        </motion.div>
      )}


      {/* ── KPI Row — staggered spring entrance ── */}
      <motion.div
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-7"
        variants={kpiContainer}
        initial="hidden"
        animate="show"
      >
        <KPICard
          label="Total Revenue"
          value={totalEarly + totalMid + totalRecent}
          formattedValue={fmtInr(totalEarly + totalMid + totalRecent)}
          sub="Revenue in current scope"
          icon={<IndianRupee className="h-4 w-4 text-emerald-500" />}
        />
        <KPICard
          label="Stores in Scope" value={kpis.scope}
          sub={`of ${stores.length} tracked`}
          icon={<Users className="h-4 w-4" />}
          barRatio={kpis.scope / (stores.length || 1)} barColor="#6b7280"
        />
        <KPICard
          label="Improved Rank" value={kpis.improved}
          sub="Climbed in percentile"
          icon={<TrendingUp className="h-4 w-4 text-emerald-500" />}
          barRatio={kpis.improved / n} barColor="#10b981"
        />
        <KPICard
          label="Declined Rank" value={kpis.declined}
          sub="Slipped in percentile"
          icon={<TrendingDown className="h-4 w-4" />}
          barRatio={kpis.declined / n} barColor="#ef4444"
          danger
        />
        <KPICard
          label="Rising Stars" value={kpis.rising}
          sub="Bottom→top movers"
          icon={<Star className="h-4 w-4 text-amber-500" />}
          barRatio={kpis.rising / n} barColor="#f59e0b"
        />
        <KPICard
          label="Fallen Stars" value={kpis.fallen}
          sub="Top→bottom movers"
          icon={<Star className="h-4 w-4" />}
          barRatio={kpis.fallen / n} barColor="#ef4444"
          danger
        />
        <KPICard
          label="Dormant Now" value={kpis.dormant}
          sub="Zero recent revenue"
          icon={<Moon className="h-4 w-4 text-slate-400" />}
          barRatio={kpis.dormant / n} barColor="#94a3b8"
        />
      </motion.div>

      {/* ── Sankey + Donut ── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">

        {/* Store Journey Flow */}
        <motion.div {...panelSpring(0.12)} className={cn(cardCls, 'lg:col-span-3')}>
          <h3 className="text-sm font-semibold text-gray-800">Store Journey Flow</h3>
          <p className="text-[11px] text-gray-500 mt-0.5 mb-3">
            How early-phase tiers flowed into recent performance categories
          </p>
          {sankeyTrace ? (
            <Plot
              data={[{
                type: 'sankey' as const,
                orientation: 'h' as const,
                node: {
                  pad: 20,
                  thickness: 24,
                  line: { color: nodeBorder, width: 0.5 },
                  label: sankeyTrace.labels,
                  color: sankeyTrace.colors,
                },
                link: {
                  source:     sankeyTrace.sources,
                  target:     sankeyTrace.targets,
                  value:      sankeyTrace.values,
                  color:      sankeyTrace.linkColors,
                },
              }]}
              layout={{
                paper_bgcolor: 'rgba(0,0,0,0)',
                plot_bgcolor:  'rgba(0,0,0,0)',
                font:  { color: PT.font, family: 'Inter, sans-serif', size: 11 },
                margin: { l: 8, r: 8, t: 8, b: 8 },
                height: 300,
                uirevision: 'constant',
              }}
              config={{ displayModeBar: false, responsive: true }}
              style={{ width: '100%' }}
            />
          ) : (
            <div className={emptyMsg}>No data for selected filters</div>
          )}
        </motion.div>

        {/* Store Movement Summary */}
        <motion.div {...panelSpring(0.2)} className={cn(cardCls, 'lg:col-span-2')}>
          <h3 className="text-sm font-semibold text-gray-800">Store Movement Summary</h3>
          <p className="text-[11px] text-gray-500 mt-0.5 mb-3">
            Performance & status distribution of in-scope stores
          </p>
          {journeys.length > 0 ? (
            <Plot
              data={[{
                type: 'pie' as const,
                hole: 0.55,
                labels: Object.keys(donutCounts),
                values: Object.values(donutCounts),
                marker: {
                  colors: (Object.keys(donutCounts) as HealthStatus[]).map(k => HEALTH_COLORS[k]),
                  line: { color: '#ffffff', width: 2 },
                },
                textinfo:      'percent' as const,
                textfont:      { size: 10, color: '#ffffff' },
                hovertemplate: '<b>%{label}</b><br>%{value} stores · %{percent}<extra></extra>',
                sort: false,
              }]}
              layout={{
                paper_bgcolor: 'rgba(0,0,0,0)',
                plot_bgcolor:  'rgba(0,0,0,0)',
                font:  { color: PT.font, family: 'Inter, sans-serif', size: 10 },
                showlegend: true,
                legend: {
                  bgcolor: 'rgba(0,0,0,0)',
                  font: { size: 10, color: PT.font },
                  orientation: 'h' as const,
                  x: 0, y: -0.1,
                },
                margin: { l: 10, r: 10, t: 10, b: 80 },
                height: 300,
                uirevision: 'constant',
              }}
              config={{ displayModeBar: false, responsive: true }}
              style={{ width: '100%' }}
            />
          ) : (
            <div className={emptyMsg}>No data for selected filters</div>
          )}
        </motion.div>
      </div>

      {/* ── Revenue bar chart ── */}
      <motion.div {...panelSpring(0.28)} className={cardCls}>
        <div className="flex items-start justify-between gap-2 flex-wrap mb-1">
          <div>
            <h3 className="text-sm font-semibold text-gray-800">Revenue Context — Network Trend</h3>
            <p className="text-[11px] text-gray-500 mt-0.5">
              Monthly gross revenue · early / mid / recent phases
              {totalEarly + totalMid + totalRecent > 0
                ? ` · ${fmtInr(totalEarly + totalMid + totalRecent)} total`
                : ''}
            </p>
          </div>
          {phaseShift !== null && (
            <motion.span
              key={Math.round(phaseShift)}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: 'spring', stiffness: 400, damping: 28 }}
              className={cn(
                'text-xs font-semibold px-2.5 py-1 rounded-full border',
                phaseShift >= 0
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : 'bg-red-50 text-red-700 border-red-200',
              )}
            >
              {fmtPct(phaseShift)} phase shift
            </motion.span>
          )}
        </div>

        {(barEarly.length + barMid.length + barRecent.length) === 0 ? (
          <div className="flex items-center justify-center h-48 text-gray-400 text-sm">
            No data for selected filters
          </div>
        ) : (
          <Plot
            data={[
              {
                type: 'bar' as const,
                name: 'Early Phase',
                x: barEarly.map(d => d.m),
                y: barEarly.map(d => d.rev),
                marker: { color: '#94a3b8' },
                hovertemplate: '<b>%{x}</b><br>₹%{y:,.0f}<extra>Early Phase</extra>',
              },
              ...(barMid.length > 0 ? [{
                type: 'bar' as const,
                name: 'Mid Phase',
                x: barMid.map(d => d.m),
                y: barMid.map(d => d.rev),
                marker: { color: '#8b5cf6' },
                hovertemplate: '<b>%{x}</b><br>₹%{y:,.0f}<extra>Mid Phase</extra>',
              }] : []),
              {
                type: 'bar' as const,
                name: 'Recent Phase',
                x: barRecent.map(d => d.m),
                y: barRecent.map(d => d.rev),
                marker: { color: '#3b82f6' },
                hovertemplate: '<b>%{x}</b><br>₹%{y:,.0f}<extra>Recent Phase</extra>',
              },
            ]}
            layout={{
              paper_bgcolor: 'rgba(0,0,0,0)',
              plot_bgcolor:  'rgba(0,0,0,0)',
              font:   { color: PT.font, family: 'Inter, sans-serif', size: 11 },
              xaxis:  { gridcolor: PT.grid, linecolor: PT.line, tickcolor: PT.line, automargin: true },
              yaxis:  {
                gridcolor: PT.grid, linecolor: PT.line, tickcolor: PT.line,
                automargin: true,
                title: { text: 'Revenue (₹)' },
                ...plotlyInrTickVals(Math.max(0, ...barEarly.map(d=>d.rev), ...barMid.map(d=>d.rev), ...barRecent.map(d=>d.rev))),
              },
              legend: {
                bgcolor: 'rgba(0,0,0,0)',
                font: { color: PT.font, size: 10 },
                orientation: 'h' as const,
                x: 0, y: 1.08,
              },
              margin:     { l: 70, r: 16, t: 36, b: 70 },
              height:     260,
              bargap:     0.25,
              uirevision: 'constant',
            }}
            config={{ displayModeBar: false, responsive: true }}
            style={{ width: '100%' }}
          />
        )}
      </motion.div>

      {/* ── Revenue Context Narrative ── */}
      {phaseNarrative && (totalEarly + totalMid + totalRecent) > 0 && (
        <motion.div {...panelSpring(0.36)} className={cardCls}>
          <h3 className="text-sm font-semibold text-gray-800 mb-1">Revenue Context — Executive Narrative</h3>
          <p className="text-[11px] text-gray-500 mb-4">
            Phase-by-phase business interpretation of network revenue performance · Early → Mid → Recent
          </p>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">

            {/* Early Phase */}
            {barEarly.length > 0 && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="inline-block h-2.5 w-2.5 rounded-full bg-slate-400 shrink-0" />
                  <p className="text-xs font-bold text-slate-700 uppercase tracking-wider">Early Phase</p>
                </div>
                {earlyLabel && <p className="text-[10px] text-slate-500 font-mono">{earlyLabel}</p>}

                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-white border border-slate-100 px-2.5 py-2">
                    <p className="text-[9px] text-slate-400 uppercase tracking-wider">Revenue</p>
                    <p className="text-sm font-bold text-slate-800">{fmtInr(totalEarly)}</p>
                  </div>
                  <div className="rounded-lg bg-white border border-slate-100 px-2.5 py-2">
                    <p className="text-[9px] text-slate-400 uppercase tracking-wider">Network Share</p>
                    <p className="text-sm font-bold text-slate-800">{phaseNarrative.earlyShare.toFixed(1)}%</p>
                  </div>
                  <div className="rounded-lg bg-white border border-slate-100 px-2.5 py-2">
                    <p className="text-[9px] text-slate-400 uppercase tracking-wider">Active Stores</p>
                    <p className="text-sm font-bold text-slate-800">{phaseNarrative.earlyActive} / {fs.length}</p>
                  </div>
                  <div className="rounded-lg bg-white border border-slate-100 px-2.5 py-2">
                    <p className="text-[9px] text-slate-400 uppercase tracking-wider">Avg / Month</p>
                    <p className="text-sm font-bold text-slate-800">{fmtInr(phaseNarrative.earlyMonthAvg)}</p>
                  </div>
                </div>

                <div className="space-y-2 text-[11px] text-slate-600 leading-relaxed">
                  <p><span className="font-semibold text-slate-700">Performance:</span>{' '}
                    {phaseNarrative.earlyMomAvg > 5
                      ? 'The early phase showed accelerating momentum with positive month-on-month growth across most months.'
                      : phaseNarrative.earlyMomAvg > 0
                        ? 'The early phase maintained modest but consistent growth, establishing a stable revenue baseline.'
                        : 'The early phase reflected a contracting trend with revenue declining month-on-month in most periods.'}
                  </p>
                  <p><span className="font-semibold text-slate-700">Store Contribution:</span>{' '}
                    {phaseNarrative.earlyActive === fs.length
                      ? 'All stores in scope contributed revenue — full network activation in this phase.'
                      : `${phaseNarrative.earlyActive} of ${fs.length} stores were active, suggesting ${fs.length - phaseNarrative.earlyActive} store${fs.length - phaseNarrative.earlyActive > 1 ? 's were' : ' was'} yet to ramp up.`}
                  </p>
                  <p><span className="font-semibold text-slate-700">Key Drivers:</span>{' '}
                    Revenue range spanned {fmtInr(phaseNarrative.earlyLow)}–{fmtInr(phaseNarrative.earlyPeak)} across early months.
                    {phaseNarrative.earlyPeak > phaseNarrative.earlyMonthAvg * 1.3
                      ? ' Significant month spikes indicate event-driven or seasonal peaks in this window.'
                      : ' Revenue was broadly stable without sharp seasonal distortion.'}
                  </p>
                  <p><span className="font-semibold text-slate-700">Risk:</span>{' '}
                    {phaseNarrative.earlyShare > 40
                      ? 'A high early-phase revenue share relative to other phases may indicate the network is past its peak growth window.'
                      : phaseNarrative.earlyShare < 25
                        ? 'Lower early share suggests the network was still ramping — subsequent phases carry more weight in evaluation.'
                        : 'Early share is balanced, indicating a normal ramp across the dataset period.'}
                  </p>
                </div>
              </div>
            )}

            {/* Mid Phase */}
            {barMid.length > 0 && (
              <div className="rounded-xl border border-violet-200 bg-violet-50 p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="inline-block h-2.5 w-2.5 rounded-full bg-violet-400 shrink-0" />
                  <p className="text-xs font-bold text-violet-700 uppercase tracking-wider">Mid Phase</p>
                </div>
                {midLabel && <p className="text-[10px] text-violet-500 font-mono">{midLabel}</p>}

                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-white border border-violet-100 px-2.5 py-2">
                    <p className="text-[9px] text-violet-400 uppercase tracking-wider">Revenue</p>
                    <p className="text-sm font-bold text-violet-800">{fmtInr(totalMid)}</p>
                  </div>
                  <div className="rounded-lg bg-white border border-violet-100 px-2.5 py-2">
                    <p className="text-[9px] text-violet-400 uppercase tracking-wider">Network Share</p>
                    <p className="text-sm font-bold text-violet-800">{phaseNarrative.midShare.toFixed(1)}%</p>
                  </div>
                  <div className="rounded-lg bg-white border border-violet-100 px-2.5 py-2">
                    <p className="text-[9px] text-violet-400 uppercase tracking-wider">Active Stores</p>
                    <p className="text-sm font-bold text-violet-800">{phaseNarrative.midActive} / {fs.length}</p>
                  </div>
                  <div className="rounded-lg bg-white border border-violet-100 px-2.5 py-2">
                    <p className="text-[9px] text-violet-400 uppercase tracking-wider">Avg / Month</p>
                    <p className="text-sm font-bold text-violet-800">{fmtInr(phaseNarrative.midMonthAvg)}</p>
                  </div>
                </div>

                <div className="space-y-2 text-[11px] text-violet-700 leading-relaxed">
                  <p><span className="font-semibold text-violet-800">vs Early Phase:</span>{' '}
                    {phaseNarrative.midGrowth === null ? 'No early phase data for comparison.' :
                     phaseNarrative.midGrowth > 10
                       ? `Mid-phase average monthly revenue grew ${fmtPct(phaseNarrative.midGrowth)} over early phase — a strong acceleration signal.`
                       : phaseNarrative.midGrowth > 0
                         ? `Mid-phase saw modest improvement of ${fmtPct(phaseNarrative.midGrowth)} over early — steady but not accelerating.`
                         : `Mid-phase contracted by ${fmtPct(Math.abs(phaseNarrative.midGrowth))} vs early — the network faced headwinds during this window.`}
                  </p>
                  <p><span className="font-semibold text-violet-800">Network Engagement:</span>{' '}
                    {phaseNarrative.midActive > phaseNarrative.earlyActive
                      ? `Mid phase brought ${phaseNarrative.midActive - phaseNarrative.earlyActive} additional store${phaseNarrative.midActive - phaseNarrative.earlyActive > 1 ? 's' : ''} online compared to the early window — network expansion in progress.`
                      : phaseNarrative.midActive === phaseNarrative.earlyActive
                        ? 'Same number of stores active as early phase — stable network coverage.'
                        : `${phaseNarrative.earlyActive - phaseNarrative.midActive} fewer stores active than early phase — some stores may have gone dormant mid-period.`}
                  </p>
                  <p><span className="font-semibold text-violet-800">Observation:</span>{' '}
                    Mid-phase revenue share of {phaseNarrative.midShare.toFixed(1)}% of the full-period total
                    {phaseNarrative.midShare > phaseNarrative.earlyShare && phaseNarrative.midShare > phaseNarrative.recentShare
                      ? ' represents the peak phase — the network performed best in this window.'
                      : phaseNarrative.midShare > phaseNarrative.earlyShare
                        ? ' shows improvement from early phase, though recent phase has overtaken it.'
                        : ' reflects a transitional period — performance will be judged by whether the recent phase recovers or further contracts.'}
                  </p>
                </div>
              </div>
            )}

            {/* Recent Phase */}
            {barRecent.length > 0 && (
              <div className={`rounded-xl border p-4 space-y-3 ${
                phaseNarrative.recentGrowth !== null && phaseNarrative.recentGrowth >= 0
                  ? 'border-blue-200 bg-blue-50'
                  : 'border-orange-200 bg-orange-50'
              }`}>
                <div className="flex items-center gap-2">
                  <span className={`inline-block h-2.5 w-2.5 rounded-full shrink-0 ${
                    phaseNarrative.recentGrowth !== null && phaseNarrative.recentGrowth >= 0
                      ? 'bg-blue-500'
                      : 'bg-orange-400'
                  }`} />
                  <p className={`text-xs font-bold uppercase tracking-wider ${
                    phaseNarrative.recentGrowth !== null && phaseNarrative.recentGrowth >= 0
                      ? 'text-blue-700'
                      : 'text-orange-700'
                  }`}>Recent Phase</p>
                </div>
                {recentLabel && <p className={`text-[10px] font-mono ${
                  phaseNarrative.recentGrowth !== null && phaseNarrative.recentGrowth >= 0
                    ? 'text-blue-500'
                    : 'text-orange-500'
                }`}>{recentLabel}</p>}

                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: 'Revenue', val: fmtInr(totalRecent) },
                    { label: 'Network Share', val: `${phaseNarrative.recentShare.toFixed(1)}%` },
                    { label: 'Active Stores', val: `${phaseNarrative.recentActive} / ${fs.length}` },
                    { label: 'Avg / Month', val: fmtInr(phaseNarrative.recentMonthAvg) },
                  ].map(({ label, val }) => (
                    <div key={label} className="rounded-lg bg-white border border-white/70 px-2.5 py-2">
                      <p className="text-[9px] text-gray-400 uppercase tracking-wider">{label}</p>
                      <p className="text-sm font-bold text-gray-800">{val}</p>
                    </div>
                  ))}
                </div>

                <div className="space-y-2 text-[11px] leading-relaxed text-gray-700">
                  <p><span className="font-semibold text-gray-800">vs Early Phase:</span>{' '}
                    {phaseNarrative.recentGrowth === null
                      ? 'Insufficient data for cross-phase comparison.'
                      : phaseNarrative.recentGrowth > 20
                        ? `Exceptional trajectory — recent average monthly revenue is ${fmtPct(phaseNarrative.recentGrowth)} higher than early phase. Management should identify and replicate these drivers.`
                        : phaseNarrative.recentGrowth > 5
                          ? `Positive momentum — recent phase average is ${fmtPct(phaseNarrative.recentGrowth)} ahead of early baseline, indicating healthy network progression.`
                          : phaseNarrative.recentGrowth > -5
                            ? 'Revenue is broadly flat versus the early phase. Growth has stalled — further diagnosis needed to distinguish structural ceiling from temporary slowdown.'
                            : `Concerning reversal — recent phase is ${fmtPct(Math.abs(phaseNarrative.recentGrowth))} below early baseline. Immediate review of underperforming stores is recommended.`}
                  </p>
                  <p><span className="font-semibold text-gray-800">MoM Trend:</span>{' '}
                    {phaseNarrative.recentMomAvg > 3
                      ? `Within the recent phase, month-on-month growth averaged ${phaseNarrative.recentMomAvg.toFixed(1)}% — an accelerating close to the period.`
                      : phaseNarrative.recentMomAvg > -3
                        ? 'Month-on-month variation within recent phase was minimal — the network is in a holding pattern.'
                        : `Recent phase showed a declining month-on-month trajectory averaging ${phaseNarrative.recentMomAvg.toFixed(1)}% — momentum is fading and proactive intervention is advisable.`}
                  </p>
                  <p><span className="font-semibold text-gray-800">Store Health Signal:</span>{' '}
                    {phaseNarrative.recentActive === fs.length
                      ? `All ${fs.length} stores are active in recent phase — full network engagement, a positive indicator.`
                      : phaseNarrative.recentActive >= phaseNarrative.earlyActive
                        ? `${phaseNarrative.recentActive} stores active in recent phase — same or better coverage than early period.`
                        : `${fs.length - phaseNarrative.recentActive} store${fs.length - phaseNarrative.recentActive > 1 ? 's have' : ' has'} gone dormant since the early phase — review store viability and re-engagement strategies.`}
                  </p>
                  <p><span className="font-semibold text-gray-800">Peak vs Low:</span>{' '}
                    Recent phase revenue swung from {fmtInr(phaseNarrative.recentLow)} to {fmtInr(phaseNarrative.recentPeak)}.
                    {(phaseNarrative.recentPeak / Math.max(phaseNarrative.recentLow, 1)) > 1.4
                      ? ' High intra-phase volatility suggests uneven store performance or seasonal demand patterns — investigate outlier months.'
                      : ' Intra-phase revenue was broadly consistent, suggesting stable demand without sharp seasonal swings.'}
                  </p>
                  {phaseNarrative.networkGrowthPct !== null && (
                    <p><span className="font-semibold text-gray-800">Overall Verdict:</span>{' '}
                      {phaseNarrative.networkGrowthPct > 15
                        ? `The network has grown significantly — ${fmtPct(phaseNarrative.networkGrowthPct)} improvement from early to recent phase. Protect and scale the top performers driving this result.`
                        : phaseNarrative.networkGrowthPct > 0
                          ? `Moderate network growth of ${fmtPct(phaseNarrative.networkGrowthPct)} over the period. Focus on converting mid-tier stores to outperformers to accelerate the trajectory.`
                          : `Network revenue has declined ${fmtPct(Math.abs(phaseNarrative.networkGrowthPct))} from early to recent phase. Immediate diagnosis of structural vs operational causes is critical.`}
                    </p>
                  )}
                </div>
              </div>
            )}

          </div>
        </motion.div>
      )}

    </div>
  )
}
