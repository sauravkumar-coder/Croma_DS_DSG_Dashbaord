import { useMemo, useState } from 'react'
import { BarChart2, ArrowUpRight, ArrowDownRight, Minus, TrendingUp, TrendingDown } from 'lucide-react'
// eslint-disable-next-line @typescript-eslint/no-require-imports
import createPlotlyComponent from 'react-plotly.js/factory'
// @ts-ignore — plotly.js-dist-min does not ship its own .d.ts
import Plotly from 'plotly.js-dist-min'
import { useDataContext } from '@/contexts/DataContext'
import type { FilterState } from '@/hooks/useFilters'
import type { StoreRecord } from '@/lib/api'
import { allocatePhases } from '@/lib/classificationEngine'
import type { StoreCategory } from '@/lib/classificationEngine'
import { cn } from '@/lib/utils'
import { fmtInr, fmtPct, fmtCount, monthAbbr, fmtStore } from '@/lib/formatting'
import { exportCsv, exportExcel } from '@/lib/tableExport'
import DataTable from '@/components/ui/DataTable'

const Plot = createPlotlyComponent(Plotly)

type TableSort = 'change' | 'pct' | 'recentAvg' | 'name'
type TableDir  = 'asc' | 'desc'
type TopN      = 5 | 10 | 20
type ShowMode  = 'both' | 'growing' | 'declining'

interface MoverRow {
  store: StoreRecord
  recentAvg: number
  midAvg: number
  earlyAvg: number
  absChange: number
  pctChange: number | null
  earlyPlanCount: number
  midPlanCount: number
  recentPlanCount: number
  category: StoreCategory
}

function phasePlanSum(store: StoreRecord, ms: string[]) {
  return ms.reduce((s, m) => s + (store.monthly_plans_count?.[m] ?? 0), 0)
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function RevenueMovers({ filters }: { filters: FilterState }) {
  const { stores, months, classification } = useDataContext()
  const [tableSort, setTableSort] = useState<TableSort>('change')
  const [tableDir,  setTableDir]  = useState<TableDir>('desc')
  const [topN,      setTopN]      = useState<TopN>(5)
  const [showMode,  setShowMode]  = useState<ShowMode>('both')

  const {
    earlyRange, midRange, recentRange,
    growingStores, decliningStores, allMovers, maxAbsChange, netChange,
    topGrowing, topDeclining, insufficient,
    avgGrowthPct, avgDeclinePct,
  } = useMemo(() => {
    try {
    let fs: StoreRecord[] = stores
    if (filters.state)    fs = fs.filter(s => s.state    === filters.state)
    if (filters.category) fs = fs.filter(s => s.category === filters.category)

    let fm: string[] = months
    if (filters.fromMonth) {
      const i = months.indexOf(filters.fromMonth)
      if (i >= 0) fm = fm.slice(i)
    }
    if (filters.toMonth) {
      const i = months.indexOf(filters.toMonth)
      if (i >= 0) fm = fm.slice(0, i + 1)
    }

    if (fm.length < 2) {
      return {
        earlyRange: '—', midRange: '—', recentRange: '—',
        growingStores: [], decliningStores: [], allMovers: [],
        maxAbsChange: 1, netChange: 0,
        topGrowing: null, topDeclining: null, insufficient: true,
        avgGrowthPct: 0, avgDeclinePct: 0,
      }
    }

    // Phase allocation uses the filtered month window for accurate revenue figures
    const { earlyMonths: early, midMonths: mid, recentMonths: recent } = allocatePhases(fm)

    const earlyRange  = `${monthAbbr(early[0])} – ${monthAbbr(early[early.length - 1])}`
    const midRange    = mid.length > 0 ? `${monthAbbr(mid[0])} – ${monthAbbr(mid[mid.length - 1])}` : '—'
    const recentRange = `${monthAbbr(recent[0])} – ${monthAbbr(recent[recent.length - 1])}`

    // Category from the central classification engine (full date range) — consistent with all other pages
    const categoryMap = new Map<string, StoreCategory>(
      classification.metrics.map(m => [m.store.store_id, m.category])
    )

    const allMovers: MoverRow[] = fs
      .filter(store => {
        const earlyTotal  = early.reduce((s, m) => s + (store.monthly_sales[m] ?? 0), 0)
        const recentTotal = recent.reduce((s, m) => s + (store.monthly_sales[m] ?? 0), 0)
        return earlyTotal > 0 || recentTotal > 0
      })
      .map(store => {
        const earlyTotal  = early.reduce((s, m) => s + (store.monthly_sales[m] ?? 0), 0)
        const midTotal    = mid.reduce((s, m) => s + (store.monthly_sales[m] ?? 0), 0)
        const recentTotal = recent.reduce((s, m) => s + (store.monthly_sales[m] ?? 0), 0)
        const earlyAvg  = early.length  > 0 ? earlyTotal  / early.length  : 0
        const midAvg    = mid.length    > 0 ? midTotal    / mid.length    : 0
        const recentAvg = recent.length > 0 ? recentTotal / recent.length : 0
        const absChange = recentAvg - earlyAvg
        const pctChange: number | null = earlyAvg > 0 ? (recentAvg - earlyAvg) / earlyAvg * 100 : null
        return {
          store, recentAvg, midAvg, earlyAvg, absChange, pctChange,
          earlyPlanCount:  phasePlanSum(store, early),
          midPlanCount:    phasePlanSum(store, mid),
          recentPlanCount: phasePlanSum(store, recent),
          category: categoryMap.get(store.store_id) ?? ('Constant Store' as StoreCategory),
        }
      })
      .sort((a, b) => b.absChange - a.absChange)

    // Growing = Rising Star + Growing Store (≥15% growth by classification rules)
    // Declining = Declining Store + Fallen Star (≥15% decline by classification rules)
    const growingStores   = allMovers.filter(m => m.category === 'Rising Star' || m.category === 'Growing Store')
    const decliningStores = allMovers.filter(m => m.category === 'Declining Store' || m.category === 'Fallen Star')

    const maxAbsChange = Math.max(...allMovers.map(m => Math.abs(m.absChange)), 1)
    const netChange    = allMovers.reduce((s, m) => s + m.absChange, 0)

    const topGrowing   = growingStores[0] ?? null
    const topDeclining = decliningStores.length > 0
      ? [...decliningStores].sort((a, b) => a.absChange - b.absChange)[0]
      : null

    const avgGrowthPct  = growingStores.length > 0
      ? growingStores.reduce((s, m) => s + (m.pctChange ?? 0), 0) / growingStores.length
      : 0
    const avgDeclinePct = decliningStores.length > 0
      ? decliningStores.reduce((s, m) => s + (m.pctChange ?? 0), 0) / decliningStores.length
      : 0

    return {
      earlyRange, midRange, recentRange,
      growingStores, decliningStores, allMovers, maxAbsChange, netChange,
      topGrowing, topDeclining, insufficient: false,
      avgGrowthPct, avgDeclinePct,
    }
    } catch (e) {
      console.error('[RevenueMovers] computation error:', e)
      return {
        earlyRange: '—', midRange: '—', recentRange: '—',
        growingStores: [], decliningStores: [], allMovers: [],
        maxAbsChange: 1, netChange: 0,
        topGrowing: null, topDeclining: null, insufficient: true,
        avgGrowthPct: 0, avgDeclinePct: 0,
      }
    }
  }, [stores, months, filters, classification])

  // ── Slope chart traces ────────────────────────────────────────────────────
  const slopeTraces = useMemo(() => {
    if (allMovers.length === 0) return []

    const showGrowing   = showMode !== 'declining'
    const showDeclining = showMode !== 'growing'

    // top N growing sorted by absChange desc; top N declining sorted by most decline first
    const topGrowingSlope   = showGrowing   ? growingStores.slice(0, topN) : []
    const topDecliningSlope = showDeclining
      ? [...decliningStores].sort((a, b) => a.absChange - b.absChange).slice(0, topN)
      : []
    const showStores = [...topGrowingSlope, ...topDecliningSlope]
    if (showStores.length === 0) return []

    const maxAbs = Math.max(...showStores.map(m => Math.abs(m.absChange)), 1)
    const maxRev = Math.max(...showStores.map(m => Math.max(m.recentAvg, m.earlyAvg)), 1)

    function lerpHex(c1: string, c2: string, t: number): string {
      const p = (s: string, o: number) => parseInt(s.slice(o, o + 2), 16)
      const r = Math.round(p(c1, 1) + (p(c2, 1) - p(c1, 1)) * t)
      const g = Math.round(p(c1, 3) + (p(c2, 3) - p(c1, 3)) * t)
      const b = Math.round(p(c1, 5) + (p(c2, 5) - p(c1, 5)) * t)
      return `rgb(${r},${g},${b})`
    }
    const gColor = (mag: number) => lerpHex('#86efac', '#15803d', mag)
    const lColor = (mag: number) => lerpHex('#fca5a5', '#b91c1c', mag)

    const traces: object[] = []

    // ① Very subtle delta-fill triangles (rendered behind lines)
    for (const m of showStores) {
      const isGrowing = m.absChange > 0
      const mag       = Math.abs(m.absChange) / maxAbs
      traces.push({
        type: 'scatter', mode: 'lines',
        x: [0, 1, 1, 0],
        y: [m.earlyAvg, m.recentAvg, m.earlyAvg, m.earlyAvg],
        fill: 'toself',
        fillcolor: isGrowing
          ? `rgba(16,185,129,${(0.02 + mag * 0.06).toFixed(2)})`
          : `rgba(239,68,68,${(0.02 + mag * 0.06).toFixed(2)})`,
        line: { color: 'rgba(0,0,0,0)', width: 0 },
        showlegend: false,
        hoverinfo: 'none',
      })
    }

    // ② Thin spline lines — range 0.8→1.8 px (was 1.8→5 px)
    for (const m of showStores) {
      const isGrowing = m.absChange > 0
      const mag       = Math.abs(m.absChange) / maxAbs
      traces.push({
        type: 'scatter', mode: 'lines',
        x: [0, 1],
        y: [m.earlyAvg, m.recentAvg],
        line: {
          color:     isGrowing ? gColor(mag) : lColor(mag),
          width:     0.8 + mag * 1.0,   // max ~1.8 px
          shape:     'spline',
          smoothing: 1.2,
        },
        opacity: 0.65 + mag * 0.35,
        showlegend: false,
        hoverinfo: 'none',
      })
    }

    // ③ Left dots — rank badge + store name + state
    const leftRows = [
      ...topGrowingSlope  .map((m, i) => ({ m, rank: i + 1, isGrowing: true  })),
      ...topDecliningSlope.map((m, i) => ({ m, rank: i + 1, isGrowing: false })),
    ]
    traces.push({
      type: 'scatter', mode: 'markers+text',
      x: leftRows.map(() => 0),
      y: leftRows.map(({ m }) => m.earlyAvg),
      marker: {
        size:  leftRows.map(({ m }) => 5 + (m.earlyAvg / maxRev) * 5),
        color: leftRows.map(({ m, isGrowing }) => {
          const mag = Math.abs(m.absChange) / maxAbs
          return isGrowing ? gColor(mag) : lColor(mag)
        }),
        line: { color: '#fff', width: 1 },
      },
      text: leftRows.map(({ m, rank, isGrowing }) => {
        const label = m.store.store_name
          ? `${m.store.store_name.slice(0, 14)} (${m.store.store_id})`
          : m.store.store_id
        const state = m.store.state ? ` · ${m.store.state}` : ''
        return `${isGrowing ? '▲' : '▼'}${rank} ${label}${state}  `
      }),
      textposition: 'middle left',
      textfont: {
        size:  9,
        color: leftRows.map(({ isGrowing }) => isGrowing ? '#065f46' : '#7f1d1d'),
      },
      showlegend: false,
      hoverinfo: 'none',
    })

    // ④ Right dots — % + recent revenue label + rich hover
    traces.push({
      type: 'scatter', mode: 'markers+text',
      x: showStores.map(() => 1),
      y: showStores.map(m => m.recentAvg),
      marker: {
        size:  showStores.map(m => 6 + (m.recentAvg / maxRev) * 6),
        color: showStores.map(m => {
          const mag = Math.abs(m.absChange) / maxAbs
          return m.absChange > 0 ? gColor(mag) : lColor(mag)
        }),
        line: { color: '#fff', width: 1 },
      },
      text: showStores.map(m =>
        `  ${fmtPct(m.pctChange ?? 0)}  ${fmtInr(m.recentAvg)}`
      ),
      textposition: 'middle right',
      textfont: {
        size:  9,
        color: showStores.map(m => m.absChange > 0 ? '#059669' : '#dc2626'),
      },
      customdata: showStores.map(m => [
        fmtStore(m.store),
        m.store.state ?? '—',
        fmtInr(m.recentAvg),
        fmtInr(m.earlyAvg),
        fmtInr(m.absChange),
        fmtPct(m.pctChange ?? 0),
        m.category,
      ]),
      hovertemplate:
        '<b>%{customdata[0]}</b>  <i>%{customdata[1]}</i><br>' +
        '<i>%{customdata[6]}</i><br>' +
        `Recent (${recentRange}): ` + '%{customdata[2]}<br>' +
        `Early  (${earlyRange}): `  + '%{customdata[3]}<br>' +
        'Avg Δ: %{customdata[4]}  (%{customdata[5]})<extra></extra>',
      showlegend: false,
    })

    // ⑤ Legend entries
    if (topGrowingSlope.length > 0) {
      traces.push({
        type: 'scatter', mode: 'lines',
        name: `▲ Growing — top ${topGrowingSlope.length}`,
        x: [null], y: [null],
        line: { color: '#10b981', width: 2 },
      })
    }
    if (topDecliningSlope.length > 0) {
      traces.push({
        type: 'scatter', mode: 'lines',
        name: `▼ Declining — top ${topDecliningSlope.length}`,
        x: [null], y: [null],
        line: { color: '#ef4444', width: 2 },
      })
    }

    return traces
  }, [growingStores, decliningStores, topN, showMode, earlyRange, recentRange])

  // ── Table sort ────────────────────────────────────────────────────────────
  const sortedTable = useMemo(() => {
    return [...allMovers].sort((a, b) => {
      if (tableSort === 'change')    return tableDir === 'desc' ? b.absChange - a.absChange : a.absChange - b.absChange
      if (tableSort === 'pct') {
        const pa = a.pctChange ?? -Infinity, pb = b.pctChange ?? -Infinity
        return tableDir === 'desc' ? pb - pa : pa - pb
      }
      if (tableSort === 'recentAvg') return tableDir === 'desc' ? b.recentAvg - a.recentAvg : a.recentAvg - b.recentAvg
      const na = a.store.store_name ?? a.store.store_id
      const nb = b.store.store_name ?? b.store.store_id
      return tableDir === 'asc' ? na.localeCompare(nb) : nb.localeCompare(na)
    })
  }, [allMovers, tableSort, tableDir])

  function toggleTable(key: TableSort) {
    if (tableSort === key) setTableDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setTableSort(key); setTableDir('desc') }
  }

  function buildExportData() {
    const headers = [
      '#', 'Store ID', 'Store Name', 'State', 'Category',
      `Early Avg (${earlyRange})`, `Mid Avg (${midRange})`, `Recent Avg (${recentRange})`,
      'Δ Avg (₹)', 'Δ %',
    ]
    const rows = sortedTable.map((r, i) => [
      i + 1, r.store.store_id, r.store.store_name ?? '', r.store.state ?? '', r.category,
      r.earlyAvg.toFixed(0), r.midAvg.toFixed(0), r.recentAvg.toFixed(0),
      r.absChange.toFixed(0), r.pctChange != null ? r.pctChange.toFixed(1) : '',
    ])
    return { headers, rows }
  }
  function handleExportCsv()   { const { headers, rows } = buildExportData(); exportCsv('revenue-movers',   headers, rows) }
  function handleExportExcel() { const { headers, rows } = buildExportData(); exportExcel('revenue-movers', headers, rows) }

  if (insufficient) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">
        Need at least 2 months of data to compute phase comparison.
      </div>
    )
  }

  const topNOptions: { value: TopN; label: string }[] = [
    { value: 5,  label: 'Top 5'  },
    { value: 10, label: 'Top 10' },
    { value: 20, label: 'Top 20' },
  ]

  const modeOptions: { value: ShowMode; label: string }[] = [
    { value: 'both',      label: 'Both'      },
    { value: 'growing',   label: 'Growing'   },
    { value: 'declining', label: 'Declining' },
  ]

  const scopeLabel = filters.state ? filters.state : 'All India'
  // Height scales with both topN and whether we're showing one or both sides
  const chartHeight = (() => {
    const base = showMode === 'both' ? topN * 2 : topN
    if (base <= 10) return 460
    if (base <= 20) return 600
    return 760
  })()

  return (
    <div className="space-y-6">

      {/* Page Header */}
      <div className="pb-1 border-b border-gray-100">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">Momentum &amp; Movement</span>
        </div>
        <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
          <BarChart2 className="w-5 h-5 text-blue-500 shrink-0" />
          What is changing, and how fast?
        </h2>
        <p className="text-sm text-gray-500 mt-1 max-w-2xl">
          Stores ranked by average monthly revenue shift — Early{' '}
          <span className="text-gray-700 font-semibold">({earlyRange})</span>
          {' vs '}
          Recent <span className="text-gray-700 font-semibold">({recentRange})</span>
          {' · '}
          <span className={cn('font-semibold', filters.state ? 'text-blue-600' : 'text-gray-600')}>
            {scopeLabel}
          </span>
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">

        {/* Growing Stores — Rising Star + Growing Store (≥15% growth threshold) */}
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm flex items-start gap-3">
          <div className="mt-0.5"><ArrowUpRight className="w-4 h-4 text-emerald-500" /></div>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold text-emerald-600 uppercase tracking-wider mb-1">Growing Stores</p>
            <p className="text-3xl font-bold text-gray-900 tabular-nums leading-tight">{growingStores.length}</p>
            <p className="text-xs text-emerald-700 font-semibold mt-1 tabular-nums">
              Avg {fmtPct(avgGrowthPct)} growth
            </p>
            <p className="text-[10px] text-emerald-500 mt-0.5">Rising Star + Growing Store</p>
          </div>
        </div>

        {/* Declining Stores — Declining Store + Fallen Star (≥15% drop threshold) */}
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 shadow-sm flex items-start gap-3">
          <div className="mt-0.5"><ArrowDownRight className="w-4 h-4 text-red-500" /></div>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold text-red-600 uppercase tracking-wider mb-1">Declining Stores</p>
            <p className="text-3xl font-bold text-gray-900 tabular-nums leading-tight">{decliningStores.length}</p>
            <p className="text-xs text-red-700 font-semibold mt-1 tabular-nums">
              Avg {fmtPct(avgDeclinePct)} change
            </p>
            <p className="text-[10px] text-red-400 mt-0.5">Declining Store + Fallen Star</p>
          </div>
        </div>

        <div className={cn(
          'rounded-xl border p-4 shadow-sm flex items-start gap-3',
          netChange >= 0 ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50',
        )}>
          <div className="mt-0.5">
            {netChange >= 0
              ? <TrendingUp className="w-4 h-4 text-emerald-500" />
              : <TrendingDown className="w-4 h-4 text-red-500" />
            }
          </div>
          <div>
            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">Net Direction</p>
            <p className={cn('text-xl font-bold leading-tight', netChange >= 0 ? 'text-emerald-700' : 'text-red-700')}>
              {netChange >= 0 ? 'Growing ↑' : 'Declining ↓'}
            </p>
            <p className="text-xs font-semibold tabular-nums mt-1" style={{ color: netChange >= 0 ? '#047857' : '#b91c1c' }}>
              Net {fmtInr(netChange)}/mo
            </p>
            <p className="text-[10px] text-gray-400 mt-0.5">
              {growingStores.length} growing · {decliningStores.length} declining
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm flex items-start gap-3">
          <div className="mt-0.5"><Minus className="w-4 h-4 text-gray-400" /></div>
          <div>
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Flat / Other</p>
            <p className="text-3xl font-bold text-gray-900 tabular-nums leading-tight">
              {allMovers.filter(m =>
                m.category !== 'Growing Store' &&
                m.category !== 'Rising Star' &&
                m.category !== 'Declining Store' &&
                m.category !== 'Fallen Star'
              ).length}
            </p>
            <p className="text-xs text-gray-400 mt-1">Constant / New Bloomer</p>
          </div>
        </div>

      </div>

      {/* Spotlight — best growing & worst declining */}
      {(topGrowing || topDeclining) && (
        <div className="grid grid-cols-2 gap-3">
          {topGrowing && (
            <div className="rounded-xl border border-emerald-100 bg-gradient-to-br from-emerald-50 via-white to-white p-4 shadow-sm">
              <p className="text-[10px] font-semibold text-emerald-600 uppercase tracking-wider mb-2">
                Best Performer · {scopeLabel}
              </p>
              <p className="text-sm font-bold text-gray-900 truncate">
                {fmtStore(topGrowing.store)}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">{topGrowing.store.state ?? '—'} · {topGrowing.category}</p>
              <p className="text-2xl font-bold text-emerald-600 mt-2 tabular-nums">
                {fmtPct(topGrowing.pctChange ?? 0)}
              </p>
              <p className="text-[10px] text-gray-400 mt-1">{earlyRange} → {recentRange}</p>
            </div>
          )}
          {topDeclining && (
            <div className="rounded-xl border border-red-100 bg-gradient-to-br from-red-50 via-white to-white p-4 shadow-sm">
              <p className="text-[10px] font-semibold text-red-600 uppercase tracking-wider mb-2">
                Steepest Decline · {scopeLabel}
              </p>
              <p className="text-sm font-bold text-gray-900 truncate">
                {fmtStore(topDeclining.store)}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">{topDeclining.store.state ?? '—'} · {topDeclining.category}</p>
              <p className="text-2xl font-bold text-red-500 mt-2 tabular-nums">
                {fmtPct(topDeclining.pctChange ?? 0)}
              </p>
              <p className="text-[10px] text-gray-400 mt-1">{earlyRange} → {recentRange}</p>
            </div>
          )}
        </div>
      )}

      {/* Slope Chart */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">

        <div className="flex items-start justify-between gap-4 mb-4 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold text-gray-700">
              Phase Revenue Slope — {scopeLabel}
            </h3>
            <p className="text-xs text-gray-400 mt-0.5">
              <span className="text-emerald-600 font-medium">Growing</span> &amp;{' '}
              <span className="text-red-500 font-medium">Declining</span> stores by avg monthly revenue shift ·
              Darker = bigger move · Right label shows % change + recent avg · Hover for details.
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0 flex-wrap">
            {/* Growing / Declining / Both toggle */}
            <div className="flex items-center gap-0.5 bg-gray-100 rounded-lg p-0.5">
              {modeOptions.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setShowMode(opt.value)}
                  className={cn(
                    'px-2.5 py-1 rounded-md text-xs font-semibold transition-colors',
                    showMode === opt.value
                      ? opt.value === 'growing'
                        ? 'bg-emerald-600 text-white'
                        : opt.value === 'declining'
                          ? 'bg-red-600 text-white'
                          : 'bg-blue-600 text-white'
                      : 'text-gray-500 hover:bg-white hover:text-gray-700',
                  )}
                >
                  {opt.value === 'growing' ? '▲ ' : opt.value === 'declining' ? '▼ ' : ''}{opt.label}
                </button>
              ))}
            </div>

            {/* Top N selector */}
            <div className="flex items-center gap-1">
              {topNOptions.map(opt => (
                <button
                  key={String(opt.value)}
                  onClick={() => setTopN(opt.value)}
                  className={cn(
                    'px-3 py-1 rounded-lg text-xs font-semibold transition-colors',
                    topN === opt.value
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-500 hover:bg-gray-200',
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <Plot
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          data={slopeTraces as any}
          layout={{
            paper_bgcolor: 'rgba(0,0,0,0)',
            plot_bgcolor:  'rgba(249,250,251,0.6)',
            height: chartHeight,
            // Smaller left margin = more horizontal space for slopes; wider right margin for % + revenue label
            margin: { l: 220, r: 175, t: 44, b: 50 },
            font: { color: '#6b7280', family: 'Inter, sans-serif', size: 11 },
            xaxis: {
              tickvals: [0, 1],
              ticktext: [
                `Early Phase<br><i style="color:#9ca3af;font-size:10px">${earlyRange}</i>`,
                `Recent Phase<br><i style="color:#9ca3af;font-size:10px">${recentRange}</i>`,
              ],
              range: [-0.05, 1.05],
              fixedrange: true,
              showgrid: false,
              linecolor: '#e5e7eb',
              zeroline: false,
              tickfont: { size: 12, color: '#111827', family: 'Inter, sans-serif' },
              ticklen: 0,
            },
            yaxis: {
              gridcolor: '#f3f4f6',
              linecolor: 'rgba(0,0,0,0)',
              tickcolor: 'rgba(0,0,0,0)',
              showticklabels: false,
              automargin: false,
              title: { text: '' },
            },
            legend: {
              bgcolor: 'rgba(255,255,255,0.85)',
              bordercolor: '#f3f4f6',
              borderwidth: 1,
              font: { color: '#6b7280', size: 10 },
              orientation: 'h',
              x: 0,
              y: 1.08,
            },
            hovermode: 'closest',
          }}
          config={{ displayModeBar: false, responsive: true }}
          style={{ width: '100%' }}
        />
      </div>

      {/* Full phase ranking table */}
      <DataTable
        title={`Full Phase Ranking — ${allMovers.length} store${allMovers.length !== 1 ? 's' : ''}${filters.state ? ` · ${filters.state}` : ''}`}
        subtitle="Click column headers to sort · Plan counts = total policies sold per phase"
        headerRight={<span className="text-xs text-gray-400 whitespace-nowrap">{earlyRange} · {midRange} · {recentRange}</span>}
        onExportCsv={handleExportCsv}
        onExportExcel={handleExportExcel}
      >
        <table className="w-full text-xs min-w-[960px]">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="px-3 py-3 text-left font-semibold uppercase tracking-wider text-gray-500 w-8">#</th>
                <th
                  className={cn('px-3 py-3 text-left font-semibold uppercase tracking-wider cursor-pointer select-none whitespace-nowrap', tableSort === 'name' ? 'text-gray-800' : 'text-gray-500 hover:text-gray-800')}
                  onClick={() => toggleTable('name')}
                >
                  Store {tableSort === 'name' && (tableDir === 'desc' ? '↓' : '↑')}
                </th>
                <th className="px-3 py-3 text-left font-semibold uppercase tracking-wider text-gray-500 hidden sm:table-cell">
                  State
                </th>

                {/* Early Phase */}
                <th className="px-3 py-3 text-right font-semibold uppercase tracking-wider text-blue-500 whitespace-nowrap">
                  <span className="block">Early Avg</span>
                  <span className="block text-[9px] font-normal text-gray-400 normal-case tracking-normal">{earlyRange}</span>
                </th>

                {/* Mid Phase */}
                <th className="px-3 py-3 text-right font-semibold uppercase tracking-wider text-purple-500 whitespace-nowrap hidden md:table-cell">
                  <span className="block">Mid Avg</span>
                  <span className="block text-[9px] font-normal text-gray-400 normal-case tracking-normal">{midRange}</span>
                </th>

                {/* Recent Phase */}
                <th
                  className={cn('px-3 py-3 text-right font-semibold uppercase tracking-wider cursor-pointer select-none whitespace-nowrap', tableSort === 'recentAvg' ? 'text-gray-800' : 'text-emerald-600 hover:text-gray-800')}
                  onClick={() => toggleTable('recentAvg')}
                >
                  <span className="block">Recent Avg {tableSort === 'recentAvg' && (tableDir === 'desc' ? '↓' : '↑')}</span>
                  <span className="block text-[9px] font-normal text-gray-400 normal-case tracking-normal">{recentRange}</span>
                </th>

                <th
                  className={cn('px-3 py-3 text-right font-semibold uppercase tracking-wider cursor-pointer select-none whitespace-nowrap', tableSort === 'change' ? 'text-gray-800' : 'text-gray-500 hover:text-gray-800')}
                  onClick={() => toggleTable('change')}
                >
                  Δ Avg {tableSort === 'change' && (tableDir === 'desc' ? '↓' : '↑')}
                </th>
                <th
                  className={cn('px-3 py-3 text-right font-semibold uppercase tracking-wider cursor-pointer select-none hidden md:table-cell whitespace-nowrap', tableSort === 'pct' ? 'text-gray-800' : 'text-gray-500 hover:text-gray-800')}
                  onClick={() => toggleTable('pct')}
                >
                  Δ % {tableSort === 'pct' && (tableDir === 'desc' ? '↓' : '↑')}
                </th>
                <th className="px-3 py-3 text-left font-semibold uppercase tracking-wider text-gray-500 hidden lg:table-cell w-24">
                  Bar
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedTable.map((row, i) => {
                const isGrowing   = row.category === 'Rising Star' || row.category === 'Growing Store'
                const isDeclining = row.category === 'Declining Store' || row.category === 'Fallen Star'
                const barW        = (Math.abs(row.absChange) / maxAbsChange) * 100
                return (
                  <tr
                    key={row.store.store_id}
                    className={cn(
                      'border-b border-gray-100 transition-colors',
                      i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50',
                      'hover:bg-blue-50/30',
                    )}
                  >
                    <td className="px-3 py-2 text-gray-400">{i + 1}</td>
                    <td className="px-3 py-2 font-semibold text-gray-800 max-w-[200px]">
                      <div className="truncate">{row.store.store_name ?? row.store.store_id}</div>
                      <div className="text-[10px] text-gray-400 font-normal">{row.store.store_id}</div>
                    </td>
                    <td className="px-3 py-2 text-gray-500 hidden sm:table-cell">
                      {row.store.state ?? '—'}
                    </td>

                    {/* Early Phase: avg revenue + plan count */}
                    <td className="px-3 py-2 text-right">
                      <span className="block text-blue-700 font-medium tabular-nums">{fmtInr(row.earlyAvg)}</span>
                      {row.earlyPlanCount > 0 && (
                        <span className="block text-[10px] text-blue-400 tabular-nums">{fmtCount(row.earlyPlanCount)} plans</span>
                      )}
                    </td>

                    {/* Mid Phase: avg revenue + plan count */}
                    <td className="px-3 py-2 text-right hidden md:table-cell">
                      <span className="block text-purple-700 font-medium tabular-nums">{fmtInr(row.midAvg)}</span>
                      {row.midPlanCount > 0 && (
                        <span className="block text-[10px] text-purple-400 tabular-nums">{fmtCount(row.midPlanCount)} plans</span>
                      )}
                    </td>

                    {/* Recent Phase: avg revenue + plan count */}
                    <td className="px-3 py-2 text-right">
                      <span className="block text-emerald-700 font-medium tabular-nums">{fmtInr(row.recentAvg)}</span>
                      {row.recentPlanCount > 0 && (
                        <span className="block text-[10px] text-emerald-500 tabular-nums">{fmtCount(row.recentPlanCount)} plans</span>
                      )}
                    </td>

                    <td className={cn(
                      'px-3 py-2 text-right font-semibold tabular-nums',
                      isGrowing ? 'text-emerald-600' : isDeclining ? 'text-red-500' : 'text-gray-400',
                    )}>
                      <span className="mr-0.5">{isGrowing ? '▲' : isDeclining ? '▼' : '—'}</span>
                      {fmtInr(Math.abs(row.absChange))}
                    </td>
                    <td className={cn(
                      'px-3 py-2 text-right tabular-nums hidden md:table-cell',
                      isGrowing ? 'text-emerald-500' : isDeclining ? 'text-red-400' : 'text-gray-400',
                    )}>
                      {row.pctChange !== null ? fmtPct(row.pctChange) : '—'}
                    </td>
                    <td className="px-3 py-2 hidden lg:table-cell">
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden w-full">
                        <div
                          className={cn('h-full rounded-full', isGrowing ? 'bg-emerald-500' : isDeclining ? 'bg-red-500' : 'bg-gray-300')}
                          style={{ width: `${barW}%` }}
                        />
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
      </DataTable>

    </div>
  )
}
