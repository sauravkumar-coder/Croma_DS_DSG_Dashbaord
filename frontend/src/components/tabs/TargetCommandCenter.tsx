import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Activity, AlertCircle, BarChart2,
  Calendar, ChevronDown, ChevronUp,
  Download, Minus, Search, Target,
  TrendingDown, TrendingUp, X, Zap,
} from 'lucide-react'
// eslint-disable-next-line @typescript-eslint/no-require-imports
import createPlotlyComponent from 'react-plotly.js/factory'
// @ts-ignore — plotly.js-dist-min does not ship its own .d.ts
import Plotly from 'plotly.js-dist-min'
import { useDataContext } from '@/contexts/DataContext'
import type { FilterState } from '@/hooks/useFilters'
import { cn } from '@/lib/utils'

const Plot = createPlotlyComponent(Plotly)

// ── Constants ─────────────────────────────────────────────────────────────────

const TOTAL_DAYS = 31
const TABLE_PAGE_SIZE = 20

const PLOTLY_AXES = {
  gridcolor: '#1f2937',
  linecolor: '#374151',
  tickcolor: '#374151',
  automargin: true,
} as const

// ── Types ─────────────────────────────────────────────────────────────────────

type RiskStatus = 'Champion' | 'On Track' | 'Watchlist' | 'At Risk'
type TableSortKey =
  | 'name' | 'state' | 'target' | 'sales'
  | 'achPct' | 'gapPct' | 'reqDRR' | 'projected' | 'projAchPct' | 'status'

const RISK_ORDER: RiskStatus[] = ['Champion', 'On Track', 'Watchlist', 'At Risk']

const RISK_CFG: Record<RiskStatus, { color: string; badge: string; zone: string }> = {
  'Champion':  { color: '#10b981', badge: 'bg-emerald-500/15 text-emerald-400', zone: 'rgba(16,185,129,0.05)'  },
  'On Track':  { color: '#3b82f6', badge: 'bg-blue-500/15 text-blue-400',       zone: 'rgba(59,130,246,0.05)' },
  'Watchlist': { color: '#f59e0b', badge: 'bg-amber-500/15 text-amber-400',     zone: 'rgba(245,158,11,0.05)' },
  'At Risk':   { color: '#ef4444', badge: 'bg-red-500/15 text-red-400',         zone: 'rgba(239,68,68,0.05)'  },
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtInr(n: number): string {
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(2)}Cr`
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(2)}L`
  if (abs >= 1e3) return `${sign}₹${(abs / 1e3).toFixed(1)}K`
  return `${sign}₹${abs.toFixed(0)}`
}

function fmtPct(n: number, d = 1): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(d)}%`
}

function getRisk(projAchPct: number): RiskStatus {
  if (projAchPct >= 110) return 'Champion'
  if (projAchPct >= 95)  return 'On Track'
  if (projAchPct >= 80)  return 'Watchlist'
  return 'At Risk'
}

// ── Sub-components ────────────────────────────────────────────────────────────

function KPICard({ label, value, sub, valueClass, icon, accent, delay = 0 }: {
  label: string; value: string; sub?: string; valueClass?: string
  icon: React.ReactNode; accent?: string; delay?: number
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className={cn('rounded-xl border bg-gray-900 p-4 flex flex-col gap-1 min-w-0', accent ?? 'border-gray-800')}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-medium uppercase tracking-widest text-gray-500 truncate">{label}</p>
        <span className="shrink-0 text-gray-600">{icon}</span>
      </div>
      <p className={cn('text-2xl font-bold text-white tabular-nums truncate', valueClass)}>{value}</p>
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

function NoTargetsPrompt() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-dashed border-gray-700 bg-gray-900/50 min-h-[420px] flex flex-col items-center justify-center gap-5 p-10"
    >
      <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-amber-500/15 to-orange-400/15 flex items-center justify-center">
        <Target className="h-7 w-7 text-amber-400" />
      </div>
      <div className="text-center max-w-sm">
        <h3 className="text-lg font-semibold text-gray-100">No Targets Loaded</h3>
        <p className="mt-2 text-sm text-gray-400 leading-relaxed">
          Upload a <span className="font-mono text-amber-400 text-xs px-1.5 py-0.5 rounded bg-amber-500/10">targets.xlsx</span> file
          to unlock the Target Command Center. The file should contain{' '}
          <span className="text-gray-300">Store_ID</span> and <span className="text-gray-300">Monthly_Target</span> columns.
        </p>
      </div>
      <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-800 border border-gray-700">
        <AlertCircle className="h-4 w-4 text-amber-400 shrink-0" />
        <span className="text-xs text-gray-400">
          Go back to the upload screen via the <span className="text-gray-200 font-medium">Reset Data</span> button in the header.
        </span>
      </div>
    </motion.div>
  )
}

function DaySlider({ value, onChange, targetMonth }: {
  value: number; onChange: (v: number) => void; targetMonth: string
}) {
  const pct = ((value - 1) / (TOTAL_DAYS - 1)) * 100
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-gray-800 bg-gray-900 px-5 py-4"
    >
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-blue-400 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-gray-200">Day of Month Simulator</p>
            <p className="text-[11px] text-gray-500">
              Tracking: <span className="text-gray-300 font-medium">{targetMonth}</span> · All rows update live
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4 flex-1 min-w-[280px]">
          <span className="text-xs text-gray-500 shrink-0 w-10">Day 1</span>
          <div className="relative flex-1">
            <input
              type="range" min={1} max={TOTAL_DAYS} value={value}
              onChange={e => onChange(Number(e.target.value))}
              className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
              style={{ background: `linear-gradient(to right,#3b82f6 ${pct}%,#1f2937 ${pct}%)` }}
            />
          </div>
          <span className="text-xs text-gray-500 shrink-0 w-14 text-right">Day {TOTAL_DAYS}</span>
          <div className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20">
            <span className="text-xs text-gray-500">Day</span>
            <span className="text-lg font-bold text-blue-400 tabular-nums w-6 text-center">{value}</span>
            <span className="text-xs text-gray-600">/ {TOTAL_DAYS}</span>
          </div>
        </div>
      </div>
    </motion.div>
  )
}

function SortBtn({ col, sortKey, sortDir, onSort, label }: {
  col: TableSortKey; sortKey: TableSortKey; sortDir: 'asc' | 'desc'
  onSort: (c: TableSortKey) => void; label: string
}) {
  return (
    <button
      onClick={() => onSort(col)}
      className="flex items-center gap-1 text-xs font-medium uppercase tracking-wider text-gray-400 hover:text-gray-200 transition-colors whitespace-nowrap"
    >
      {label}
      {sortKey === col
        ? sortDir === 'asc'
          ? <ChevronUp className="h-3 w-3 text-blue-400" />
          : <ChevronDown className="h-3 w-3 text-blue-400" />
        : <ChevronUp className="h-3 w-3 opacity-25" />}
    </button>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props { filters: FilterState }

export default function TargetCommandCenter({ filters }: Props) {
  const { stores, months, hasTargets } = useDataContext()

  const [dayOfMonth, setDayOfMonth] = useState(15)
  const [tableSearch, setTableSearch]     = useState('')
  const [tableSortKey, setTableSortKey]   = useState<TableSortKey>('achPct')
  const [tableSortDir, setTableSortDir]   = useState<'asc' | 'desc'>('asc')
  const [tablePage, setTablePage]         = useState(1)

  // Reset page when search or sort changes
  useEffect(() => { setTablePage(1) }, [tableSearch, tableSortKey, tableSortDir])

  // Month-range filter
  const fm = useMemo(() => {
    let m = months
    if (filters.fromMonth) { const i = months.indexOf(filters.fromMonth); if (i >= 0) m = m.slice(i) }
    if (filters.toMonth)   { const i = months.indexOf(filters.toMonth);   if (i >= 0) m = m.slice(0, i + 1) }
    return m
  }, [months, filters])

  const targetMonth = fm[fm.length - 1] ?? months[months.length - 1] ?? ''

  const filteredStores = useMemo(() => {
    let fs = stores
    if (filters.state)    fs = fs.filter(s => s.state === filters.state)
    if (filters.category) fs = fs.filter(s => s.category === filters.category)
    return fs.filter(s => s.target != null && (s.target as number) > 0)
  }, [stores, filters])

  // Per-store calculations — recomputes on every slider tick
  const storeCalcs = useMemo(() => {
    const elapsed    = Math.max(1, dayOfMonth)
    const remaining  = Math.max(0, TOTAL_DAYS - elapsed)
    return filteredStores.map(s => {
      const target       = s.target as number
      const currentSales = s.monthly_sales[targetMonth] ?? 0
      const achPct       = target > 0 ? (currentSales / target) * 100 : 0
      const expectedPct  = (elapsed / TOTAL_DAYS) * 100
      const gap          = target - currentSales
      const gapPct       = target > 0 ? (gap / target) * 100 : 0
      const projected    = elapsed > 0 ? (currentSales / elapsed) * TOTAL_DAYS : 0
      const projAchPct   = target > 0 ? (projected / target) * 100 : 0
      const reqDRR       = remaining > 0 && gap > 0 ? gap / remaining : 0
      const expectedSales = target * (elapsed / TOTAL_DAYS)
      const status        = getRisk(projAchPct)
      return {
        store: s, target, currentSales,
        achPct, expectedPct, gap, gapPct,
        projected, projAchPct, reqDRR, expectedSales, status,
      }
    })
  }, [filteredStores, targetMonth, dayOfMonth])

  // National roll-up
  const national = useMemo(() => {
    const elapsed    = Math.max(1, dayOfMonth)
    const remaining  = Math.max(0, TOTAL_DAYS - elapsed)
    const totalTarget = storeCalcs.reduce((s, d) => s + d.target, 0)
    const totalSales  = storeCalcs.reduce((s, d) => s + d.currentSales, 0)
    const achPct      = totalTarget > 0 ? (totalSales / totalTarget) * 100 : 0
    const expectedPct = (elapsed / TOTAL_DAYS) * 100
    const gap         = totalTarget - totalSales
    const projected   = elapsed > 0 ? (totalSales / elapsed) * TOTAL_DAYS : 0
    const reqDRR      = remaining > 0 && gap > 0 ? gap / remaining : 0
    return {
      totalTarget, totalSales, achPct, expectedPct,
      gap, projected, reqDRR,
      remaining_target: Math.max(0, gap),
      elapsed, remaining,
    }
  }, [storeCalcs, dayOfMonth])

  // ── Gauge ─────────────────────────────────────────────────────────────────

  const gaugeTrace = useMemo(() => ({
    type: 'indicator' as const,
    mode: 'gauge+number+delta' as const,
    value: national.achPct,
    number: { suffix: '%', font: { size: 32, color: '#e5e7eb' }, valueformat: '.1f' },
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
    const elapsed = national.elapsed
    const days    = Array.from({ length: TOTAL_DAYS }, (_, i) => i + 1)
    const idealY  = days.map(d => national.totalTarget * (d / TOTAL_DAYS))
    const actualDays = days.filter(d => d <= elapsed)
    const actualY    = actualDays.map(d => elapsed > 0 ? (national.totalSales / elapsed) * d : 0)
    const projDays   = days.filter(d => d >= elapsed)
    const projY      = projDays.map(d => elapsed > 0 ? (national.totalSales / elapsed) * d : 0)
    const aheadColor = national.achPct >= national.expectedPct ? '#10b981' : '#ef4444'
    return [
      { type: 'scatter' as const, mode: 'lines' as const, name: 'Ideal Pace', x: days, y: idealY,
        line: { color: '#6b7280', width: 2, dash: 'dot' as const },
        hovertemplate: 'Day %{x}<br>Ideal: ₹%{y:,.0f}<extra>Ideal Pace</extra>' },
      { type: 'scatter' as const, mode: 'lines+markers' as const, name: 'Actual to Date',
        x: actualDays, y: actualY,
        line: { color: aheadColor, width: 2.5 }, marker: { size: 4 },
        hovertemplate: 'Day %{x}<br>Actual: ₹%{y:,.0f}<extra>Actual</extra>' },
      { type: 'scatter' as const, mode: 'lines' as const, name: 'Projected',
        x: projDays, y: projY,
        line: { color: aheadColor + '80', width: 2, dash: 'dash' as const },
        hovertemplate: 'Day %{x}<br>Projected: ₹%{y:,.0f}<extra>Projected</extra>' },
      { type: 'scatter' as const, mode: 'lines' as const, name: 'Monthly Target',
        x: [1, TOTAL_DAYS], y: [national.totalTarget, national.totalTarget],
        line: { color: '#f59e0b50', width: 1.5, dash: 'longdash' as const },
        hovertemplate: 'Target: ₹%{y:,.0f}<extra>Target</extra>' },
    ]
  }, [national])

  // ── Daily Pace Matrix (ROW 3) ─────────────────────────────────────────────

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
      customdata: data.map(d => [d.store.store_name ?? d.store.store_id, d.store.store_id, d.target, d.currentSales, d.achPct, d.expectedPct, d.gap]),
      hovertemplate: '<b>%{customdata[0]}</b> (%{customdata[1]})<br>Target: ₹%{customdata[2]:,.0f}<br>Sales: ₹%{customdata[3]:,.0f}<br>Achievement: %{customdata[4]:.1f}%<br>Expected: %{customdata[5]:.1f}%<extra></extra>',
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

  // ── Projection Matrix traces (ROW 4) ──────────────────────────────────────

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
        marker: {
          size: data.map(d => sz(d.target)),
          color: RISK_CFG[status].color,
          opacity: 0.78,
          line: { color: '#111827', width: 1 },
        },
        customdata: data.map(d => [
          d.store.store_name ?? d.store.store_id, d.store.store_id,
          d.target, d.currentSales, d.achPct, d.projAchPct, d.gap,
        ]),
        hovertemplate:
          '<b>%{customdata[0]}</b> (%{customdata[1]})<br>' +
          'Target: ₹%{customdata[2]:,.0f}<br>' +
          'Sales: ₹%{customdata[3]:,.0f}<br>' +
          'Current Ach: %{customdata[4]:.1f}%<br>' +
          'Projected: %{customdata[5]:.1f}%<br>' +
          'Gap: ₹%{customdata[6]:,.0f}' +
          '<extra></extra>',
      }
    })
  }, [storeCalcs])

  // ── State-level aggregation (ROW 5) ──────────────────────────────────────

  const stateData = useMemo(() => {
    const map: Record<string, { target: number; achieved: number; projected: number; count: number }> = {}
    for (const d of storeCalcs) {
      const st = d.store.state ?? 'Unknown'
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
    const rev = [...stateData].reverse() // highest at top in horizontal bar chart
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

  // ── Store table data (ROW 6) ──────────────────────────────────────────────

  const storeTableData = useMemo(() => {
    let rows = [...storeCalcs]
    const q = tableSearch.trim().toLowerCase()
    if (q) {
      rows = rows.filter(r =>
        (r.store.store_name ?? '').toLowerCase().includes(q) ||
        r.store.store_id.toLowerCase().includes(q) ||
        (r.store.state ?? '').toLowerCase().includes(q)
      )
    }
    rows.sort((a, b) => {
      let diff = 0
      switch (tableSortKey) {
        case 'name':      diff = (a.store.store_name ?? a.store.store_id).localeCompare(b.store.store_name ?? b.store.store_id); break
        case 'state':     diff = (a.store.state ?? '').localeCompare(b.store.state ?? ''); break
        case 'target':    diff = a.target - b.target; break
        case 'sales':     diff = a.currentSales - b.currentSales; break
        case 'achPct':    diff = a.achPct - b.achPct; break
        case 'gapPct':    diff = a.gapPct - b.gapPct; break
        case 'reqDRR':    diff = a.reqDRR - b.reqDRR; break
        case 'projected': diff = a.projected - b.projected; break
        case 'projAchPct':diff = a.projAchPct - b.projAchPct; break
        case 'status':    diff = a.projAchPct - b.projAchPct; break
      }
      return tableSortDir === 'asc' ? diff : -diff
    })
    return rows
  }, [storeCalcs, tableSearch, tableSortKey, tableSortDir])

  const totalPages = Math.max(1, Math.ceil(storeTableData.length / TABLE_PAGE_SIZE))
  const pagedRows  = storeTableData.slice((tablePage - 1) * TABLE_PAGE_SIZE, tablePage * TABLE_PAGE_SIZE)

  const toggleSort = useCallback((col: TableSortKey) => {
    if (tableSortKey === col) setTableSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setTableSortKey(col); setTableSortDir('desc') }
  }, [tableSortKey])

  const exportCsv = useCallback(() => {
    const headers = [
      'Store ID','Store Name','State','Category',
      'Target (₹)','Current Sales (₹)','Achievement %',
      'Gap (₹)','Gap %','Req Daily Sales (₹)',
      'Projected Month-End (₹)','Projected %','Risk Status',
    ]
    const rows = storeTableData.map(r => [
      r.store.store_id, r.store.store_name ?? '', r.store.state ?? '', r.store.category ?? '',
      r.target.toFixed(0), r.currentSales.toFixed(0),
      r.achPct.toFixed(1) + '%', r.gap.toFixed(0), r.gapPct.toFixed(1) + '%',
      r.reqDRR.toFixed(0), r.projected.toFixed(0), r.projAchPct.toFixed(1) + '%', r.status,
    ])
    const csv = [headers, ...rows]
      .map(row => row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url
    a.download = `target-tracker-day${dayOfMonth}-${targetMonth}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [storeTableData, dayOfMonth, targetMonth])

  // ── Guards ────────────────────────────────────────────────────────────────

  if (!hasTargets) return <NoTargetsPrompt />
  if (filteredStores.length === 0) {
    return (
      <div className="rounded-xl border border-gray-800 bg-gray-900/50 min-h-72 flex items-center justify-center">
        <p className="text-sm text-gray-500">No stores with targets match the current filters.</p>
      </div>
    )
  }

  const achClass   = national.achPct >= 95 ? 'text-emerald-400' : national.achPct >= 80 ? 'text-amber-400' : 'text-red-400'
  const gapPositive = national.gap > 0

  // projection matrix Y ceiling
  const projYMax = Math.max(160, ...storeCalcs.map(d => d.projAchPct + 10))
  const stateBarsHeight = Math.max(240, stateData.length * 36 + 80)

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* ── Day Slider ── */}
      <DaySlider value={dayOfMonth} onChange={setDayOfMonth} targetMonth={targetMonth} />

      {/* ── ROW 1: KPI Cards ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
        <KPICard label="Monthly Target" value={fmtInr(national.totalTarget)}
          sub={`${filteredStores.length} stores`}
          icon={<Target className="h-4 w-4" />} delay={0} />
        <KPICard label="Achieved Sales" value={fmtInr(national.totalSales)}
          sub={`Day ${dayOfMonth} of ${TOTAL_DAYS}`}
          icon={<BarChart2 className="h-4 w-4 text-blue-400" />} delay={0.04} />
        <KPICard label="Achievement %" value={`${national.achPct.toFixed(1)}%`}
          sub={`Expected ${national.expectedPct.toFixed(1)}%`}
          valueClass={achClass}
          accent={national.achPct >= 95 ? 'border-emerald-800/40' : national.achPct >= 80 ? 'border-amber-800/40' : 'border-red-900/40'}
          icon={national.achPct >= national.expectedPct
            ? <TrendingUp className="h-4 w-4 text-emerald-400" />
            : <TrendingDown className="h-4 w-4 text-red-400" />}
          delay={0.08} />
        <KPICard label="Gap to Target"
          value={gapPositive ? fmtInr(national.gap) : '✓ Exceeded'}
          sub={gapPositive ? 'still to be sold' : `by ${fmtInr(-national.gap)}`}
          valueClass={gapPositive ? 'text-red-400' : 'text-emerald-400'}
          icon={gapPositive ? <AlertCircle className="h-4 w-4 text-red-400" /> : <TrendingUp className="h-4 w-4 text-emerald-400" />}
          delay={0.12} />
        <KPICard label="Remaining Target"
          value={national.remaining_target > 0 ? fmtInr(national.remaining_target) : '—'}
          sub={`${national.remaining} days left`}
          valueClass={national.remaining_target > 0 ? 'text-amber-400' : 'text-gray-400'}
          icon={<Minus className="h-4 w-4 text-amber-400" />} delay={0.16} />
        <KPICard label="Req. Daily Run Rate"
          value={national.reqDRR > 0 ? fmtInr(national.reqDRR) : '—'}
          sub="per day to close gap"
          valueClass={national.reqDRR > 0 ? 'text-amber-400' : 'text-gray-400'}
          icon={<Zap className="h-4 w-4 text-amber-400" />} delay={0.20} />
        <KPICard label="Projected Month-End" value={fmtInr(national.projected)}
          sub={`${fmtPct((national.projected / national.totalTarget - 1) * 100)} vs target`}
          valueClass={national.projected >= national.totalTarget ? 'text-emerald-400' : 'text-red-400'}
          icon={<Activity className="h-4 w-4" />} delay={0.24} />
      </div>

      {/* ── ROW 2: Gauge + Pace ── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="lg:col-span-2 rounded-xl border border-gray-800 bg-gray-900 p-4">
          <h3 className="mb-0.5 text-sm font-semibold text-gray-200">National Achievement</h3>
          <p className="mb-2 text-[11px] text-gray-500">
            Overall attainment ·
            <span className="text-red-400"> &lt;80%</span> ·
            <span className="text-amber-400"> 80–95%</span> ·
            <span className="text-emerald-400"> &gt;95%</span>
          </p>
          <Plot data={[gaugeTrace]}
            layout={{ paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)', font: { color: '#9ca3af', family: 'Inter,sans-serif', size: 11 }, margin: { l: 24, r: 24, t: 16, b: 8 }, height: 260 }}
            config={{ displayModeBar: false, responsive: true }} style={{ width: '100%' }} />
          <div className="flex justify-center gap-4 mt-1">
            {[{ l: 'Behind <80%', c: 'text-red-400' }, { l: 'On Track 80–95%', c: 'text-amber-400' }, { l: 'Exceeding >95%', c: 'text-emerald-400' }].map(z => (
              <span key={z.l} className={cn('text-[10px] font-medium', z.c)}>{z.l}</span>
            ))}
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
          className="lg:col-span-3 rounded-xl border border-gray-800 bg-gray-900 p-4">
          <h3 className="mb-0.5 text-sm font-semibold text-gray-200">Ideal vs Actual Pace</h3>
          <p className="mb-3 text-[11px] text-gray-500">Cumulative revenue vs ideal linear pace · Dashed = projected trajectory</p>
          <Plot data={paceTraces}
            layout={{
              paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
              font: { color: '#9ca3af', family: 'Inter,sans-serif', size: 11 },
              legend: { bgcolor: 'rgba(0,0,0,0)', font: { color: '#9ca3af', size: 10 }, orientation: 'h' as const, y: -0.22 },
              xaxis: { ...PLOTLY_AXES, title: { text: 'Day of Month' }, dtick: 5, range: [0, TOTAL_DAYS + 0.5] },
              yaxis: { ...PLOTLY_AXES, tickformat: ',.0s', title: { text: 'Cumulative Revenue (₹)' } },
              hovermode: 'x unified' as const,
              margin: { l: 70, r: 16, t: 8, b: 90 }, height: 300,
              shapes: [{ type: 'line' as const, x0: dayOfMonth, x1: dayOfMonth, y0: 0, y1: 1, xref: 'x' as const, yref: 'paper' as const, line: { color: '#3b82f640', width: 1.5, dash: 'dot' as const } }],
              annotations: [{ x: dayOfMonth, y: 1, xref: 'x' as const, yref: 'paper' as const, text: `Day ${dayOfMonth}`, showarrow: false, font: { color: '#3b82f6', size: 10 }, yanchor: 'bottom' as const }],
            }}
            config={{ displayModeBar: false, responsive: true }} style={{ width: '100%' }} />
        </motion.div>
      </div>

      {/* ── ROW 3: Daily Pace Matrix ── */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
        className="rounded-xl border border-gray-800 bg-gray-900 p-4">
        <h3 className="mb-0.5 text-sm font-semibold text-gray-200">Daily Pace Matrix</h3>
        <p className="mb-3 text-[11px] text-gray-500">
          Bubble = 1 store · Size = target · X = expected sales at Day {dayOfMonth} · Y = actual ·
          <span className="text-emerald-400"> Green</span> = ahead ·
          <span className="text-red-400"> Red</span> = behind
        </p>
        <Plot data={bubbleTraces}
          layout={{
            paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
            font: { color: '#9ca3af', family: 'Inter,sans-serif', size: 11 },
            legend: { bgcolor: 'rgba(0,0,0,0)', font: { color: '#9ca3af', size: 10 }, orientation: 'h' as const, y: -0.18 },
            xaxis: { ...PLOTLY_AXES, title: { text: `Expected Sales at Day ${dayOfMonth} (₹)` }, tickformat: ',.0s' },
            yaxis: { ...PLOTLY_AXES, title: { text: 'Actual Sales (₹)' }, tickformat: ',.0s' },
            hovermode: 'closest' as const,
            margin: { l: 70, r: 20, t: 16, b: 90 }, height: 380,
          }}
          config={{ displayModeBar: false, responsive: true }} style={{ width: '100%' }} />
        <div className="mt-3 flex flex-wrap gap-4 px-1">
          {[
            { l: 'Stores Ahead', v: storeCalcs.filter(d => d.currentSales >= d.expectedSales).length, c: 'text-emerald-400' },
            { l: 'Stores Behind', v: storeCalcs.filter(d => d.currentSales < d.expectedSales).length, c: 'text-red-400' },
            { l: 'Avg Achievement', v: `${(storeCalcs.reduce((s, d) => s + d.achPct, 0) / storeCalcs.length).toFixed(1)}%`, c: achClass },
            { l: 'Expected Pace', v: `${national.expectedPct.toFixed(1)}%`, c: 'text-gray-400' },
          ].map(({ l, v, c }) => (
            <div key={l} className="flex items-center gap-2">
              <span className="text-[11px] text-gray-500">{l}</span>
              <span className={cn('text-sm font-bold tabular-nums', c)}>{v}</span>
            </div>
          ))}
        </div>
      </motion.div>

      {/* ── ROW 4: Month-End Projection Matrix ── */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}
        className="rounded-xl border border-gray-800 bg-gray-900 p-4">
        <h3 className="mb-0.5 text-sm font-semibold text-gray-200">Month-End Projection Matrix</h3>
        <p className="mb-3 text-[11px] text-gray-500">
          X = monthly target (log scale) · Y = projected achievement % · Size = target magnitude · Background zones show performance tier
        </p>
        <Plot
          data={projMatrixTraces}
          layout={{
            paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
            font: { color: '#9ca3af', family: 'Inter,sans-serif', size: 11 },
            legend: { bgcolor: 'rgba(0,0,0,0)', font: { color: '#9ca3af', size: 10 }, orientation: 'h' as const, y: -0.18 },
            xaxis: { ...PLOTLY_AXES, type: 'log' as const, title: { text: 'Monthly Target (₹, log scale)' }, tickformat: ',.0s' },
            yaxis: { ...PLOTLY_AXES, title: { text: 'Projected Achievement %' }, range: [0, projYMax] },
            hovermode: 'closest' as const,
            margin: { l: 64, r: 20, t: 16, b: 90 }, height: 420,
            shapes: [
              // zone fills
              { type: 'rect' as const, xref: 'paper', yref: 'y', x0: 0, x1: 1, y0: 110,    y1: projYMax, fillcolor: RISK_CFG['Champion']['zone'],  line: { width: 0 } },
              { type: 'rect' as const, xref: 'paper', yref: 'y', x0: 0, x1: 1, y0: 95,     y1: 110,      fillcolor: RISK_CFG['On Track']['zone'],  line: { width: 0 } },
              { type: 'rect' as const, xref: 'paper', yref: 'y', x0: 0, x1: 1, y0: 80,     y1: 95,       fillcolor: RISK_CFG['Watchlist']['zone'], line: { width: 0 } },
              { type: 'rect' as const, xref: 'paper', yref: 'y', x0: 0, x1: 1, y0: 0,      y1: 80,       fillcolor: RISK_CFG['At Risk']['zone'],   line: { width: 0 } },
              // boundary lines
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

        {/* Quadrant count legend */}
        <div className="mt-3 flex flex-wrap gap-3 px-1">
          {RISK_ORDER.map(status => {
            const count = storeCalcs.filter(d => d.status === status).length
            return (
              <div key={status} className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: RISK_CFG[status].color }} />
                <span className="text-[11px] text-gray-400">{status}</span>
                <span className="text-sm font-bold tabular-nums" style={{ color: RISK_CFG[status].color }}>{count}</span>
              </div>
            )
          })}
        </div>
      </motion.div>

      {/* ── ROW 5: State Target Analysis ── */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
        className="rounded-xl border border-gray-800 bg-gray-900 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-800">
          <h3 className="text-sm font-semibold text-gray-200">State Target Analysis</h3>
          <p className="text-[11px] text-gray-500 mt-0.5">
            Bars = current achievement % · Diamond = projected % · Dashed line = 100% target
          </p>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-gray-800">
          {/* Bar chart */}
          <div className="p-4">
            <Plot data={stateBarTraces}
              layout={{
                paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
                font: { color: '#9ca3af', family: 'Inter,sans-serif', size: 11 },
                legend: { bgcolor: 'rgba(0,0,0,0)', font: { color: '#9ca3af', size: 10 }, orientation: 'h' as const, y: -0.22 },
                xaxis: { ...PLOTLY_AXES, title: { text: 'Achievement %' }, range: [0, Math.max(130, ...stateData.map(d => d.projPct + 5))] },
                yaxis: { ...PLOTLY_AXES },
                hovermode: 'y unified' as const,
                margin: { l: 110, r: 20, t: 8, b: 60 }, height: stateBarsHeight,
                shapes: [
                  { type: 'line' as const, xref: 'x', yref: 'paper', x0: 100, x1: 100, y0: 0, y1: 1, line: { color: '#4b556380', width: 1.5, dash: 'dash' as const } },
                ],
                annotations: [{
                  x: 100, y: 1, xref: 'x' as const, yref: 'paper' as const,
                  text: '100%', showarrow: false, font: { color: '#6b7280', size: 10 }, yanchor: 'bottom' as const,
                }],
              }}
              config={{ displayModeBar: false, responsive: true }} style={{ width: '100%' }} />
          </div>

          {/* State table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 bg-gray-800/40">
                  {['State', 'Stores', 'Target', 'Achieved', 'Ach%', 'Gap', 'Proj%', 'Status'].map(h => (
                    <th key={h} className="px-3 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-gray-400 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {stateData.map(row => (
                  <tr key={row.state} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                    <td className="px-3 py-2.5 text-gray-200 font-medium whitespace-nowrap">{row.state}</td>
                    <td className="px-3 py-2.5 text-gray-400 tabular-nums text-xs">{row.storeCount}</td>
                    <td className="px-3 py-2.5 text-gray-300 tabular-nums text-xs whitespace-nowrap">{fmtInr(row.target)}</td>
                    <td className="px-3 py-2.5 text-gray-300 tabular-nums text-xs whitespace-nowrap">{fmtInr(row.achieved)}</td>
                    <td className={cn('px-3 py-2.5 tabular-nums text-xs font-semibold',
                      row.achPct >= 95 ? 'text-emerald-400' : row.achPct >= 80 ? 'text-amber-400' : 'text-red-400')}>
                      {row.achPct.toFixed(1)}%
                    </td>
                    <td className={cn('px-3 py-2.5 tabular-nums text-xs whitespace-nowrap',
                      row.gap <= 0 ? 'text-emerald-400' : 'text-red-400')}>
                      {row.gap <= 0 ? `+${fmtInr(-row.gap)}` : fmtInr(row.gap)}
                    </td>
                    <td className={cn('px-3 py-2.5 tabular-nums text-xs font-semibold',
                      row.projPct >= 95 ? 'text-emerald-400' : row.projPct >= 80 ? 'text-amber-400' : 'text-red-400')}>
                      {row.projPct.toFixed(1)}%
                    </td>
                    <td className="px-3 py-2.5">
                      <RiskBadge status={row.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </motion.div>

      {/* ── ROW 6: Store Command Center Table ── */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}
        className="rounded-xl border border-gray-800 bg-gray-900 overflow-hidden">

        {/* Table header + controls */}
        <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold text-gray-200">Store Command Center</h3>
            <p className="text-[11px] text-gray-500 mt-0.5">
              {storeTableData.length} store{storeTableData.length !== 1 ? 's' : ''} · sortable · searchable · Page {tablePage} of {totalPages}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Search */}
            <div className="relative flex items-center">
              <Search className="absolute left-2.5 h-3.5 w-3.5 text-gray-500 pointer-events-none" />
              <input
                type="text"
                placeholder="Search store / state…"
                value={tableSearch}
                onChange={e => setTableSearch(e.target.value)}
                className="h-8 pl-8 pr-7 rounded-lg bg-gray-800 border border-gray-700 text-xs text-gray-200 placeholder:text-gray-600 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 w-48"
              />
              {tableSearch && (
                <button onClick={() => setTableSearch('')} className="absolute right-2 text-gray-500 hover:text-gray-300">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {/* Export */}
            <button
              onClick={exportCsv}
              className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-gray-800 border border-gray-700 text-xs text-gray-300 hover:text-white hover:border-gray-500 transition-colors"
            >
              <Download className="h-3.5 w-3.5" />
              Export CSV
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-800/40">
                <th className="px-3 py-2.5 text-left text-xs text-gray-600 w-8">#</th>
                {([
                  { col: 'name'      as TableSortKey, label: 'Store'         },
                  { col: 'state'     as TableSortKey, label: 'State'         },
                  { col: 'target'    as TableSortKey, label: 'Target'        },
                  { col: 'sales'     as TableSortKey, label: 'Sales'         },
                  { col: 'achPct'    as TableSortKey, label: 'Ach %'         },
                  { col: 'gapPct'    as TableSortKey, label: 'Gap %'         },
                  { col: 'reqDRR'    as TableSortKey, label: 'Req Daily'     },
                  { col: 'projected' as TableSortKey, label: 'Projection'    },
                  { col: 'status'    as TableSortKey, label: 'Risk Status'   },
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
                  <td colSpan={10} className="px-3 py-10 text-center text-gray-600 text-sm">
                    No stores match "{tableSearch}"
                  </td>
                </tr>
              ) : pagedRows.map((row, i) => {
                const globalIdx = (tablePage - 1) * TABLE_PAGE_SIZE + i + 1
                return (
                  <tr key={row.store.store_id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                    <td className="px-3 py-2.5 text-gray-600 tabular-nums text-xs">{globalIdx}</td>
                    <td className="px-3 py-2.5">
                      <p className="text-gray-200 font-medium text-xs truncate max-w-[160px]" title={row.store.store_name ?? row.store.store_id}>
                        {row.store.store_name ?? row.store.store_id}
                      </p>
                      <p className="text-[10px] text-gray-600">{row.store.store_id}</p>
                    </td>
                    <td className="px-3 py-2.5 text-gray-400 text-xs whitespace-nowrap">{row.store.state ?? '—'}</td>
                    <td className="px-3 py-2.5 text-gray-300 tabular-nums text-xs whitespace-nowrap">{fmtInr(row.target)}</td>
                    <td className="px-3 py-2.5 text-gray-200 tabular-nums text-xs font-medium whitespace-nowrap">{fmtInr(row.currentSales)}</td>
                    <td className={cn('px-3 py-2.5 tabular-nums text-xs font-semibold whitespace-nowrap',
                      row.achPct >= 95 ? 'text-emerald-400' : row.achPct >= 80 ? 'text-amber-400' : 'text-red-400')}>
                      {row.achPct.toFixed(1)}%
                    </td>
                    <td className={cn('px-3 py-2.5 tabular-nums text-xs whitespace-nowrap',
                      row.gapPct <= 0 ? 'text-emerald-400' : row.gapPct <= 20 ? 'text-amber-400' : 'text-red-400')}>
                      {row.gap <= 0 ? `+${fmtPct(-row.gapPct)}` : fmtPct(row.gapPct)}
                    </td>
                    <td className="px-3 py-2.5 text-amber-400 tabular-nums text-xs whitespace-nowrap">
                      {row.reqDRR > 0 ? fmtInr(row.reqDRR) : '—'}
                    </td>
                    <td className={cn('px-3 py-2.5 tabular-nums text-xs font-medium whitespace-nowrap',
                      row.projected >= row.target ? 'text-emerald-400' : 'text-red-400')}>
                      {fmtInr(row.projected)}
                      <span className="text-[10px] text-gray-600 ml-1">({row.projAchPct.toFixed(0)}%)</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <RiskBadge status={row.status} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-4 py-3 border-t border-gray-800 flex items-center justify-between gap-3 flex-wrap">
            <p className="text-xs text-gray-500">
              Showing {(tablePage - 1) * TABLE_PAGE_SIZE + 1}–{Math.min(tablePage * TABLE_PAGE_SIZE, storeTableData.length)} of {storeTableData.length} stores
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setTablePage(1)}
                disabled={tablePage === 1}
                className="h-7 px-2.5 rounded text-xs text-gray-400 hover:text-white hover:bg-gray-800 disabled:opacity-30 disabled:cursor-default transition-colors"
              >«</button>
              <button
                onClick={() => setTablePage(p => Math.max(1, p - 1))}
                disabled={tablePage === 1}
                className="h-7 px-2.5 rounded text-xs text-gray-400 hover:text-white hover:bg-gray-800 disabled:opacity-30 disabled:cursor-default transition-colors"
              >‹</button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, k) => {
                let page: number
                if (totalPages <= 5) {
                  page = k + 1
                } else if (tablePage <= 3) {
                  page = k + 1
                } else if (tablePage >= totalPages - 2) {
                  page = totalPages - 4 + k
                } else {
                  page = tablePage - 2 + k
                }
                return (
                  <button
                    key={page}
                    onClick={() => setTablePage(page)}
                    className={cn(
                      'h-7 w-7 rounded text-xs transition-colors',
                      page === tablePage
                        ? 'bg-blue-500 text-white font-bold'
                        : 'text-gray-400 hover:text-white hover:bg-gray-800',
                    )}
                  >{page}</button>
                )
              })}
              <button
                onClick={() => setTablePage(p => Math.min(totalPages, p + 1))}
                disabled={tablePage === totalPages}
                className="h-7 px-2.5 rounded text-xs text-gray-400 hover:text-white hover:bg-gray-800 disabled:opacity-30 disabled:cursor-default transition-colors"
              >›</button>
              <button
                onClick={() => setTablePage(totalPages)}
                disabled={tablePage === totalPages}
                className="h-7 px-2.5 rounded text-xs text-gray-400 hover:text-white hover:bg-gray-800 disabled:opacity-30 disabled:cursor-default transition-colors"
              >»</button>
            </div>
          </div>
        )}
      </motion.div>

    </div>
  )
}
