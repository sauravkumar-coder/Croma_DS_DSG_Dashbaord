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
import type { FilterState } from '@/hooks/useFilters'
import { type StoreRecord, getTrackerData, type TrackerSalesRow } from '@/lib/api'
import { type StoreCategory } from '@/lib/classificationEngine'
import { transformStoresByPlanCategory } from '@/lib/filterHelpers'
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
import TargetStateMap from './TargetStateMap'

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
  { label: '25–50%',  min: 25,  max: 50,       color: '#f97316',  name: 'Lagging'    },
  { label: '50–75%',  min: 50,  max: 75,       color: '#f59e0b',  name: 'Developing' },
  { label: '75–100%', min: 75,  max: 100,      color: '#3b82f6',  name: 'On Track'   },
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

  const [dayOfMonth, setDayOfMonth] = useState<number>(() => {
    const d = new Date().getDate()
    return d
  })
  const [filterState, setFilterState] = useState<string>('')
  const [tableSearch, setTableSearch] = useState<string>('')
  const [tableSortKey, setTableSortKey] = useState<TableSortKey>('achPct')
  const [tableSortDir, setTableSortDir] = useState<'asc' | 'desc'>('desc')
  const [tablePage, setTablePage] = useState<number>(1)
  const [trackerSalesRows, setTrackerSalesRows] = useState<TrackerSalesRow[]>([])
  const [isTrackerLoading, setIsTrackerLoading] = useState(false)
  const [selectedBand, setSelectedBand] = useState<typeof BANDS[number] | null>(null)

  // ── Filter + split ─────────────────────────────────────────────────────────
  const { fs, fm } = useMemo(() => {
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
    return { fs, fm }
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

  // ── Fetch Daily Sales Tracker Data ──────────────────────────────────────────
  useEffect(() => {
    if (!targetMonth) return
    let active = true
    const fetchTracker = async () => {
      setIsTrackerLoading(true)
      try {
        const { data } = await getTrackerData(targetMonth)
        if (active && data.sales_rows) {
          setTrackerSalesRows(data.sales_rows)
        }
      } catch (err) {
        console.error("Failed to load tracker data", err)
      } finally {
        if (active) setIsTrackerLoading(false)
      }
    }
    fetchTracker()
    return () => {
      active = false
    }
  }, [targetMonth])

  // Map store names to their state from store records
  const storeStateMap = useMemo(() => {
    const map = new Map<string, string>()
    fs.forEach(s => {
      if (s.store_name && s.state) {
        map.set(s.store_name, s.state)
      }
    })
    return map
  }, [fs])

  // Aggregate daily sales for the current month
  const dailySalesData = useMemo(() => {
    const daily = Array.from({ length: totalDays }, () => 0)
    const hasDailyBreakdown = trackerSalesRows.some(r => r.day > 0)
    
    if (hasDailyBreakdown) {
      for (const r of trackerSalesRows) {
        const dayIdx = r.day - 1
        if (dayIdx >= 0 && dayIdx < totalDays) {
          const storeState = r.state || storeStateMap.get(r.store_name)
          if (!filterState || storeState === filterState) {
            daily[dayIdx] += r.sales
          }
        }
      }
    } else {
      const activeElapsed = elapsed > 0 ? elapsed : 1
      let sumTemp = 0
      const tempBars = Array.from({ length: activeElapsed }, (_, i) => {
        const mult = 0.8 + ((i * 7 + 13) % 5) * 0.1
        sumTemp += mult
        return mult
      })
      for (let i = 0; i < elapsed; i++) {
        daily[i] = sumTemp > 0 ? (tempBars[i] / sumTemp) * national.totalSales : 0
      }
    }
    return daily
  }, [trackerSalesRows, totalDays, filterState, elapsed, national.totalSales, storeStateMap])

  const requiredDailyPace = useMemo(() => {
    return national.totalTarget / (totalDays || 1)
  }, [national.totalTarget, totalDays])

  const barColors = useMemo(() => {
    return dailySalesData.map((val, idx) => {
      if (idx >= elapsed) return 'rgba(0, 0, 0, 0)'
      return val >= requiredDailyPace ? '#10b981' : '#ef4444'
    })
  }, [dailySalesData, requiredDailyPace, elapsed])

  const dailyChartTraces = useMemo(() => {
    const days = Array.from({ length: totalDays }, (_, i) => i + 1)
    
    const barTrace = {
      type: 'bar' as const,
      name: 'Daily Sales',
      x: days,
      y: dailySalesData,
      marker: {
        color: barColors,
        line: { color: 'rgba(0,0,0,0)', width: 0 }
      },
      hovertemplate: '<b>Day %{x}</b><br>Sales: ₹%{y:,.0f}<extra></extra>',
    }

    const paceLine = {
      type: 'scatter' as const,
      mode: 'lines' as const,
      name: 'Required Daily Pace',
      x: [0.5, totalDays + 0.5],
      y: [requiredDailyPace, requiredDailyPace],
      line: {
        color: '#f59e0b',
        width: 2,
        dash: 'dash' as const
      },
      hovertemplate: 'Required Pace: ₹%{y:,.0f}<extra></extra>',
    }

    return [barTrace, paceLine]
  }, [dailySalesData, barColors, totalDays, requiredDailyPace])

  const stateData = useMemo(() => {
    const map: Record<string, { target: number; achieved: number; expected: number; projected: number; count: number }> = {}
    for (const d of storeCalcs) {
      const st = d.store.state || 'Unknown'
      if (!map[st]) map[st] = { target: 0, achieved: 0, expected: 0, projected: 0, count: 0 }
      map[st].target    += d.target
      map[st].achieved  += d.currentSales
      map[st].expected  += d.expectedSales
      map[st].projected += d.projected
      map[st].count++
    }
    return Object.entries(map).map(([state, v]) => {
      const target = v.target
      const achieved = v.achieved
      const expected = v.expected
      const projected = v.projected
      const achPct = target > 0 ? (achieved / target) * 100 : 0
      const projPct = target > 0 ? (projected / target) * 100 : 0
      return {
        state,
        target,
        achieved,
        expected,
        projected,
        gap: target - achieved,
        achPct,
        projPct,
        storeCount: v.count,
        status: getRisk(projPct),
      }
    }).sort((a, b) => b.achPct - a.achPct)
  }, [storeCalcs, elapsed, totalDays])

  const stateBarsHeight = useMemo(() => {
    return Math.max(240, stateData.length * 36 + 80)
  }, [stateData])

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

  const bandCounts = useMemo(() => {
    return BANDS.map(b => storeCalcs.filter(r => r.achPct >= b.min && r.achPct < b.max).length)
  }, [storeCalcs])
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

        {/* ── ROW 2: Daily Sales vs Required Pace ── */}
        <motion.div {...panelSpring(0.1)}
          className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <h3 className="mb-0.5 text-sm font-semibold text-gray-800">Daily Performance vs Required Pace</h3>
          <p className="mb-3 text-[11px] text-gray-500">
            Bars = daily sales volume · Dashed line = required pace per day ·
            <span className="text-emerald-500 font-semibold"> Emerald</span> = met/exceeded required daily pace ·
            <span className="text-red-500 font-semibold"> Red</span> = below required daily pace
          </p>
          <Plot
            data={dailyChartTraces}
            layout={{
              paper_bgcolor: 'rgba(0,0,0,0)',
              plot_bgcolor:  'rgba(0,0,0,0)',
              font:          { color: PT.font, family: 'Inter,sans-serif', size: 11 },
              xaxis: {
                gridcolor: PT.grid,
                linecolor: PT.line,
                tickcolor: PT.line,
                automargin: true,
                title: { text: 'Day of Month' },
                dtick: 1,
                range: [0.5, totalDays + 0.5]
              },
              yaxis: {
                gridcolor: PT.grid,
                linecolor: PT.line,
                tickcolor: PT.line,
                automargin: true,
                title: { text: `Daily Sales (₹)` },
                ...plotlyInrTickVals(Math.max(...dailySalesData, requiredDailyPace) * 1.15)
              },
              legend: {
                bgcolor: 'rgba(0,0,0,0)',
                font: { color: PT.font, size: 10 },
                orientation: 'h' as const,
                y: -0.25
              },
              margin: { l: 70, r: 16, t: 8, b: 80 },
              height: 320,
              bargap: 0.3
            }}
            config={{ displayModeBar: false, responsive: true }}
            style={{ width: '100%' }}
          />
        </motion.div>

        {/* ── ROW 3: Geographic India Map ── */}
        <motion.div {...panelSpring(0.15)}>
          <TargetStateMap
            data={stateData}
            targetMonth={targetMonth}
            effectiveDay={elapsed}
            totalDays={totalDays}
          />
        </motion.div>

        {/* ── ROW 4: State Target Analysis ── */}
        <motion.div {...panelSpring(0.2)}
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
                  font: { color: PT.font, family: 'Inter,sans-serif', size: 11 },
                  legend: { bgcolor: 'rgba(0,0,0,0)', font: { color: PT.font, size: 10 }, orientation: 'h' as const, y: -0.22 },
                  xaxis: {
                    gridcolor: PT.grid,
                    linecolor: PT.line,
                    tickcolor: PT.line,
                    automargin: true,
                    title: { text: 'Achievement %' },
                    range: [0, Math.max(130, ...stateData.map(d => d.projPct + 5))]
                  },
                  yaxis: {
                    gridcolor: PT.grid,
                    linecolor: PT.line,
                    tickcolor: PT.line,
                    automargin: true
                  },
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

        {/* ── ROW 5: Achievement Distribution ── */}
        <motion.div {...panelSpring(0.3)}
          className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm p-5">
          
          {/* Card Header: Title on Left, State Dropdown on Right */}
          <div className="flex items-start justify-between gap-3 flex-wrap mb-5">
            <div>
              <h3 className="text-sm font-semibold text-gray-800">Achievement Distribution</h3>
              <p className="text-[11px] text-gray-500 mt-0.5">
                Store count by Monthly Achievement % · Click a segment or card to list the stores in that band
              </p>
            </div>
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
          </div>

          {/* Row of 5 Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
            {BANDS.map((b, i) => {
              const count = storeCalcs.filter(r => r.achPct >= b.min && r.achPct < b.max).length
              const totalCount = storeCalcs.length
              const pct = totalCount > 0 ? (count / totalCount) * 100 : 0
              const isSelected = selectedBand?.name === b.name
              
              return (
                <button
                  key={b.label}
                  onClick={() => setSelectedBand(isSelected ? null : b)}
                  className={cn(
                    "flex flex-col text-left p-4 rounded-xl border transition-all duration-200",
                    "hover:shadow-md cursor-pointer relative overflow-hidden bg-white",
                    isSelected 
                      ? "ring-2 ring-blue-500 border-blue-500" 
                      : "border-gray-100 hover:border-gray-200"
                  )}
                  style={{
                    borderLeftWidth: '4px',
                    borderLeftColor: b.color,
                  }}
                >
                  <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">{b.label}</span>
                  <span className="text-3xl font-bold mt-1.5 tabular-nums" style={{ color: b.color }}>
                    {count}
                  </span>
                  <span className="text-[10px] text-gray-500 mt-1">{pct.toFixed(1)}% of stores</span>
                </button>
              )
            })}
          </div>

          {/* Two Column Layout: Donut Chart on Left, Progress Bar Legend on Right */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center border border-gray-50 rounded-xl p-4 bg-gray-50/20">
            {/* Donut Chart */}
            <div className="lg:col-span-5 flex justify-center items-center">
              <Plot
                data={[{
                  type: 'pie' as const,
                  hole: 0.65,
                  values: bandCounts,
                  labels: BANDS.map(b => b.label),
                  marker: {
                    colors: BANDS.map(b => b.color),
                    line: { color: '#ffffff', width: 2 },
                  },
                  textinfo: 'none' as const,
                  hovertemplate: '<b>%{label} Achievement</b><br>%{value} stores (%{percent})<extra></extra>',
                  sort: false,
                }]}
                layout={{
                  paper_bgcolor: 'rgba(0,0,0,0)',
                  plot_bgcolor:  'rgba(0,0,0,0)',
                  font:  { color: PT.font, family: 'Inter, sans-serif', size: 10 },
                  showlegend: false,
                  margin: { l: 20, r: 20, t: 20, b: 20 },
                  height: 260,
                  uirevision: 'constant',
                  annotations: [
                    {
                      font: { size: 28, color: '#111827', family: 'Inter,sans-serif', weight: 'bold' },
                      showarrow: false,
                      text: `<b>${storeCalcs.length}</b>`,
                      x: 0.5,
                      y: 0.55
                    },
                    {
                      font: { size: 12, color: '#6b7280', family: 'Inter,sans-serif' },
                      showarrow: false,
                      text: 'stores',
                      x: 0.5,
                      y: 0.38
                    }
                  ]
                }}
                onClick={(event) => {
                  const pointIndex = event.points?.[0]?.pointIndex
                  if (pointIndex !== undefined && pointIndex >= 0 && pointIndex < BANDS.length) {
                    const clickedBand = BANDS[pointIndex]
                    setSelectedBand(prev => prev?.name === clickedBand.name ? null : clickedBand)
                  }
                }}
                config={{ displayModeBar: false, responsive: true }}
                style={{ width: '100%', maxWidth: '280px' }}
              />
            </div>

            {/* Custom Legend with Progress Bars */}
            <div className="lg:col-span-7 space-y-3">
              {BANDS.map((b, i) => {
                const count = bandCounts[i]
                const totalCount = storeCalcs.length
                const pct = totalCount > 0 ? (count / totalCount) * 100 : 0
                const isSelected = selectedBand?.name === b.name
                
                return (
                  <div
                    key={b.label}
                    onClick={() => setSelectedBand(isSelected ? null : b)}
                    className={cn(
                      "flex items-center justify-between gap-4 p-2 rounded-lg transition-colors cursor-pointer",
                      isSelected ? "bg-gray-100/70" : "hover:bg-gray-50"
                    )}
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: b.color }} />
                      <span className="text-xs font-semibold text-gray-700">{b.label} Achievement</span>
                    </div>
                    
                    <div className="flex items-center gap-4">
                      <span className="text-xs font-bold text-gray-900 w-8 text-right tabular-nums">{count}</span>
                      <div className="w-32 h-1.5 rounded-full bg-gray-100 overflow-hidden shrink-0 hidden sm:block">
                        <motion.div
                          className="h-full rounded-full"
                          style={{ backgroundColor: b.color }}
                          initial={{ width: 0 }}
                          animate={{ width: `${pct}%` }}
                          transition={{ duration: 0.8, ease: 'easeOut' }}
                        />
                      </div>
                      <span className="text-xs text-gray-500 w-8 text-right tabular-nums font-medium">{pct.toFixed(0)}%</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          <AnimatePresence>
            {selectedBand && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-4 border-t border-gray-100 pt-4 overflow-hidden"
              >
                <div className="flex items-center justify-between mb-3 bg-gray-50 px-3 py-2 rounded-lg border border-gray-100">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: selectedBand.color }} />
                    <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wider">
                      Stores in {selectedBand.name} Band ({selectedBand.label})
                    </h4>
                  </div>
                  <button
                    onClick={() => setSelectedBand(null)}
                    className="p-1 rounded-full hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {(() => {
                  const storesInBand = storeCalcs.filter(r => r.achPct >= selectedBand.min && r.achPct < selectedBand.max)
                  if (storesInBand.length === 0) {
                    return <p className="text-xs text-gray-500 italic px-2">No stores in this achievement band.</p>
                  }
                  return (
                    <div className="max-h-64 overflow-y-auto border border-gray-100 rounded-lg divide-y divide-gray-100">
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr className="bg-gray-50 text-gray-500 sticky top-0 font-semibold border-b border-gray-100">
                            <th className="px-3 py-2">Store Name</th>
                            <th className="px-3 py-2">State</th>
                            <th className="px-3 py-2 text-right">Target</th>
                            <th className="px-3 py-2 text-right">Achieved</th>
                            <th className="px-3 py-2 text-right">Ach %</th>
                          </tr>
                        </thead>
                        <tbody>
                          {storesInBand.map(r => (
                            <tr key={r.store.store_id} className="hover:bg-gray-50/50 transition-colors border-b border-gray-100 last:border-0">
                              <td className="px-3 py-2 font-medium text-gray-900">{r.store.store_name}</td>
                              <td className="px-3 py-2 text-gray-500">{r.store.state}</td>
                              <td className="px-3 py-2 text-right tabular-nums text-gray-600">{fmtInr(r.target)}</td>
                              <td className="px-3 py-2 text-right tabular-nums text-gray-900 font-semibold">{fmtInr(r.currentSales)}</td>
                              <td className="px-3 py-2 text-right tabular-nums font-bold" style={{ color: selectedBand.color }}>
                                {r.achPct.toFixed(1)}%
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )
                })()}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

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

  return renderTargetMode()
}
