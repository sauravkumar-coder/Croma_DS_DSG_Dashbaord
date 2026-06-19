import { useMemo, useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import createPlotlyComponent from 'react-plotly.js/factory'
// @ts-ignore — plotly.js-dist-min does not ship its own .d.ts
import Plotly from 'plotly.js-dist-min'
import { useDataContext } from '@/contexts/DataContext'
import type { FilterState } from '@/hooks/useFilters'
import { cn } from '@/lib/utils'
import { allocatePhases } from '@/lib/classificationEngine'
import { transformStoresByPlanCategory } from '@/lib/filterHelpers'
import { fmtInr, fmtInrFull, fmtPct, plotlyInrTickVals } from '@/lib/formatting'
import { panelSpring } from '@/lib/animations'
import { PT, PT_AXIS } from '@/lib/plotlyTheme'
import { exportCsv, exportExcel } from '@/lib/tableExport'

const Plot = createPlotlyComponent(Plotly)

// ── Box-plot colour palette ───────────────────────────────────────────────────
const STATE_PALETTE = [
  '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6',
  '#06b6d4', '#f97316', '#84cc16', '#ec4899',
  '#14b8a6', '#a855f7', '#f43f5e', '#22d3ee',
]

const PHASE_COLOR = {
  early:  '#94a3b8',
  mid:    '#818cf8',
  recent: '#3b82f6',
} as const

// ── Statistical helpers ───────────────────────────────────────────────────────

function pctile(sorted: number[], p: number): number {
  const idx = (p / 100) * (sorted.length - 1)
  const lo = Math.floor(idx), hi = Math.ceil(idx)
  return lo === hi ? sorted[lo] : sorted[lo] + (idx - lo) * (sorted[hi] - sorted[lo])
}

interface MonthStats {
  n: number; q1: number; median: number; q3: number; mean: number
  iqr: number; minR: number; maxR: number; outliers: number
  lf: number; uf: number
}

interface OutlierRow {
  storeId: string; storeName: string; state: string; month: string
  revenue: number; type: 'High Outlier' | 'Low Outlier'
  fence: number; distance: number; lowerBound: number; upperBound: number
  /** Attach % value (0–100) when in attach mode — same slot reused for sorting */
  attachPct?: number
}

function computeMonthStats(values: number[]): MonthStats | null {
  const sorted = [...values].sort((a, b) => a - b)
  const n = sorted.length
  if (n === 0) return null
  const q1     = pctile(sorted, 25)
  const median = pctile(sorted, 50)
  const q3     = pctile(sorted, 75)
  const mean   = sorted.reduce((s, v) => s + v, 0) / n
  const iqr    = q3 - q1
  const lf     = q1 - 1.5 * iqr
  const uf     = q3 + 1.5 * iqr
  const minR   = sorted.find(v => v >= lf) ?? sorted[0]
  const maxR   = [...sorted].reverse().find(v => v <= uf) ?? sorted[n - 1]
  const outliers = sorted.filter(v => v < lf || v > uf).length
  return { n, q1, median, q3, mean, iqr, minR, maxR, outliers, lf, uf }
}

// Silverman's rule KDE — handles single-value and zero-variance edge cases
function computeKDE(sortedValues: number[], numPoints = 300): { x: number[]; y: number[] } {
  const n = sortedValues.length
  if (n === 0) return { x: [], y: [] }
  const mean     = sortedValues.reduce((a, b) => a + b, 0) / n
  const variance = sortedValues.reduce((s, v) => s + (v - mean) ** 2, 0) / n
  const std      = Math.sqrt(variance)
  // For zero-variance (all identical), use 10% of the mean as bandwidth
  const bw = std > 0
    ? 1.06 * std * Math.pow(n, -0.2)
    : Math.max(mean * 0.1, 1)
  const range = Math.max(sortedValues[n - 1] - sortedValues[0], bw * 2)
  const pad   = Math.max(0.2 * range, bw * 3)
  const xMin  = Math.max(sortedValues[0] - pad, 0)
  const xMax  = sortedValues[n - 1] + pad
  const inv   = 1 / (n * bw * Math.sqrt(2 * Math.PI))
  const xs: number[] = [], ys: number[] = []
  for (let i = 0; i < numPoints; i++) {
    const x       = xMin + (i / (numPoints - 1)) * (xMax - xMin)
    const density = sortedValues.reduce((s, v) => s + Math.exp(-0.5 * ((x - v) / bw) ** 2), 0) * inv
    xs.push(x)
    ys.push(density)
  }
  console.log(`[KDE] computeKDE: n=${n}, std=${std.toFixed(0)}, bw=${bw.toFixed(0)}, pts=${numPoints}, maxDensity=${Math.max(...ys).toExponential(3)}`)
  return { x: xs, y: ys }
}

function buildBoxHover(month: string, stats: MonthStats | null): string {
  if (!stats) return `<b>${month}</b><extra></extra>`
  const dispLb     = Math.max(stats.lf, 0)
  const outlierLine = stats.outliers > 0
    ? `Outlier Stores: <b>${stats.outliers}</b>`
    : 'No outliers detected'
  return [
    `<b>${month}</b>`,
    `Active Stores: <b>${stats.n}</b>`,
    `<b>Distribution</b>`,
    `Lower Bound:    <b>${fmtInrFull(dispLb)}</b>`,
    `Q1 (25th pct):  <b>${fmtInrFull(stats.q1)}</b>`,
    `Median:         <b>${fmtInrFull(stats.median)}</b>`,
    `Q3 (75th pct):  <b>${fmtInrFull(stats.q3)}</b>`,
    `Upper Bound:    <b>${fmtInrFull(stats.uf)}</b>`,
    `IQR: <b>${fmtInrFull(stats.iqr)}</b>`,
    outlierLine,
    `<i>Click to explore this month's distribution ↗</i>`,
  ].join('<br>') + '<extra></extra>'
}

function buildBoxHoverAttach(month: string, stats: MonthStats | null): string {
  if (!stats) return `<b>${month}</b><extra></extra>`
  const dispLb      = Math.max(stats.lf, 0)
  const f = (v: number) => `${v.toFixed(2)}%`
  const outlierLine = stats.outliers > 0
    ? `Outlier Stores: <b>${stats.outliers}</b>`
    : 'No outliers detected'
  return [
    `<b>${month}</b>`,
    `Active Stores: <b>${stats.n}</b>`,
    `<b>Attach % Distribution</b>`,
    `Lower Bound:    <b>${f(dispLb)}</b>`,
    `Q1 (25th pct):  <b>${f(stats.q1)}</b>`,
    `Median:         <b>${f(stats.median)}</b>`,
    `Q3 (75th pct):  <b>${f(stats.q3)}</b>`,
    `Upper Bound:    <b>${f(stats.uf)}</b>`,
    `IQR: <b>${f(stats.iqr)}</b>`,
    outlierLine,
    `<i>Click to explore this month's distribution ↗</i>`,
  ].join('<br>') + '<extra></extra>'
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props { filters: FilterState }

export default function MonthlyRevenue({ filters }: Props) {
  const { stores, months } = useDataContext()
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null)
  // Revenue ↔ Attach % analysis toggle
  const [viewMode, setViewMode] = useState<'revenue' | 'attach'>('revenue')

  // Tracks the currently hovered month via Plotly hover events.
  // Using a ref (not state) avoids re-renders on every mouse move.
  // The box fill area does NOT fire plotly_click, but plotly_hover fires reliably.
  // The wrapper div onClick reads this ref so clicks always resolve to the right month.
  const hoveredMonthRef = useRef<string | null>(null)

  // ── Filter ─────────────────────────────────────────────────────────────────
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

  // ── Attach % availability flag ─────────────────────────────────────────────
  const hasAttach = useMemo(() =>
    fs.some(s => Object.values(s.monthly_attach_pct ?? {}).some(v => v > 0)),
    [fs],
  )

  // ── Value accessor — switches between revenue and attach% ─────────────────
  // Attach % is stored as 0–1; we multiply by 100 for display.
  const getValue = (store: typeof stores[0], month: string): number => {
    if (viewMode === 'attach') {
      return (store.monthly_attach_pct?.[month] ?? 0) * 100
    }
    return store.monthly_sales[month] ?? 0
  }

  const fmtValue = (v: number) => viewMode === 'attach' ? `${v.toFixed(2)}%` : fmtInr(v)
  const fmtValueFull = (v: number) => viewMode === 'attach' ? `${v.toFixed(2)}%` : fmtInrFull(v)

  // Close drill-down whenever the filtered dataset changes.
  // useMemo always produces new array references when inputs change, so this
  // fires reliably for every filter update — more robust than watching the
  // filters object reference directly.
  useEffect(() => {
    console.log('[KDE] fs/fm changed → resetting selectedMonth')
    setSelectedMonth(null)
  }, [fs, fm])

  // Canonical selected month — null if selectedMonth is no longer in fm
  // (handles filter changes that don't change fs/fm refs in edge cases)
  const canonicalMonth = selectedMonth && fm.includes(selectedMonth) ? selectedMonth : null

  const { earlyMonths: early, midMonths: mid, recentMonths: recent } = useMemo(() => allocatePhases(fm), [fm])

  const phaseOf = (m: string) => early.includes(m) ? 'early' : mid.includes(m) ? 'mid' : 'recent'

  // ── Per-month aggregates ───────────────────────────────────────────────────
  const monthlyData = useMemo(() => fm.map(m => {
    if (viewMode === 'attach') {
      // For attach mode: show mean attach % across stores that have main_qty > 0
      const activeStores = fs.filter(st => (st.monthly_main_qty?.[m] ?? 0) > 0)
      const rev = activeStores.length > 0
        ? activeStores.reduce((s, st) => s + (st.monthly_attach_pct?.[m] ?? 0) * 100, 0) / activeStores.length
        : 0
      const active = activeStores.length
      const phase  = phaseOf(m)
      return { m, rev, active, phase }
    }
    const rev    = fs.reduce((s, st) => s + (st.monthly_sales[m] ?? 0), 0)
    const active = fs.filter(st => (st.monthly_sales[m] ?? 0) > 0).length
    const phase  = phaseOf(m)
    return { m, rev, active, phase }
  }), [fs, fm, early, mid, recent, viewMode]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── KPI metrics ────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    if (!monthlyData.length) return null

    const sorted = [...monthlyData].sort((a, b) => b.rev - a.rev)
    const peak   = sorted[0]
    const trough = sorted[sorted.length - 1]

    const avg = (phase: string) => {
      const rows = monthlyData.filter(d => d.phase === phase)
      return rows.length ? rows.reduce((s, d) => s + d.rev, 0) / rows.length : 0
    }
    const avgEarly  = avg('early')
    const avgMid    = avg('mid')
    const avgRecent = avg('recent')
    const runRatePct  = avgEarly > 0 ? (avgRecent - avgEarly) / avgEarly * 100 : 0
    const midShiftPct = avgEarly > 0 && mid.length > 0 ? (avgMid - avgEarly) / avgEarly * 100 : null

    const firstActive  = monthlyData[0].active
    const lastActive   = monthlyData[monthlyData.length - 1].active
    const footprintPct = firstActive > 0 ? (lastActive - firstActive) / firstActive * 100 : 0

    return { peak, trough, avgEarly, avgMid, avgRecent, runRatePct, midShiftPct, firstActive, lastActive, footprintPct }
  }, [monthlyData, mid])

  // ── Macro chart ────────────────────────────────────────────────────────────
  const macroTraces = useMemo(() => {
    const byPhase = (p: string) => monthlyData.filter(d => d.phase === p)
    const earlyD  = byPhase('early')
    const midD    = byPhase('mid')
    const recentD = byPhase('recent')

    const isAttach = viewMode === 'attach'
    const bar = (data: typeof monthlyData, phase: 'early' | 'mid' | 'recent', label: string) => ({
      type: 'bar' as const,
      name: label,
      x: data.map(d => d.m),
      y: data.map(d => d.rev),
      marker: { color: PHASE_COLOR[phase], opacity: 0.88 },
      yaxis: 'y' as const,
      hovertemplate: isAttach
        ? `<b>%{x}</b><br>Avg Attach %: <b>%{y:.2f}%</b><extra>${label}</extra>`
        : `<b>%{x}</b><br>Revenue: ₹%{y:,.0f}<extra>${label}</extra>`,
    })

    return [
      ...(earlyD.length  ? [bar(earlyD,  'early',  'Early')]     : []),
      ...(midD.length    ? [bar(midD,    'mid',    'Mid Phase')] : []),
      ...(recentD.length ? [bar(recentD, 'recent', 'Recent')]    : []),
      {
        type: 'scatter' as const, mode: 'lines+markers' as const,
        name: isAttach ? 'Active stores (w/ qty)' : 'Active stores',
        x: monthlyData.map(d => d.m), y: monthlyData.map(d => d.active),
        yaxis: 'y2' as const,
        line: { color: '#14b8a6', width: 2, shape: 'spline' as const }, marker: { color: '#14b8a6', size: 5 },
        hovertemplate: '<b>%{x}</b><br>Active stores: %{y}<extra></extra>',
      },
    ]
  }, [monthlyData, viewMode])

  const phaseAnnotations = useMemo(() => {
    const anns: object[] = []
    const labelAt = (months: string[], text: string, color: string) => {
      if (!months.length) return
      const centerM = months[Math.floor(months.length / 2)]
      anns.push({
        x: centerM, y: 1.06, xref: 'x', yref: 'paper',
        text: `<b>${text}</b>`, showarrow: false,
        font: { color, size: 10, family: 'Inter, sans-serif' },
        xanchor: 'center', yanchor: 'bottom',
      })
    }
    labelAt(early,  'Early Period',  PHASE_COLOR.early)
    labelAt(mid,    'Mid Phase',     PHASE_COLOR.mid)
    labelAt(recent, 'Recent Period', PHASE_COLOR.recent)
    return anns
  }, [early, mid, recent])

  // ── Box-plot y-axis ────────────────────────────────────────────────────────
  const { boxYAxis, boxScaleIsLog } = useMemo(() => {
    if (viewMode === 'attach') {
      // Attach % is 0–100, no log scale needed
      const allActive = fm.flatMap(m =>
        fs.map(s => (s.monthly_attach_pct?.[m] ?? 0) * 100).filter(v => v > 0)
      )
      if (!allActive.length) return { boxYAxis: { ...PT_AXIS, title: { text: 'Attach %' } }, boxScaleIsLog: false }
      const maxVal = Math.min(Math.max(...allActive) * 1.1, 100)
      const step = maxVal > 50 ? 10 : maxVal > 20 ? 5 : 2
      const tickvals: number[] = []
      for (let t = 0; t <= maxVal + step; t += step) tickvals.push(Math.round(t * 10) / 10)
      return {
        boxYAxis: { ...PT_AXIS, title: { text: 'Attach % per Store' }, tickmode: 'array' as const, tickvals, ticktext: tickvals.map(v => `${v}%`) },
        boxScaleIsLog: false,
      }
    }

    const allActive = fm.flatMap(m => fs.map(s => s.monthly_sales[m] ?? 0).filter(v => v > 0))
    const fallback  = { boxYAxis: { ...PT_AXIS, title: { text: 'Store Revenue' } }, boxScaleIsLog: false }
    if (!allActive.length) return fallback

    const sorted = [...allActive].sort((a, b) => a - b)
    const q1     = pctile(sorted, 25)
    const q3     = pctile(sorted, 75)
    const iqr    = q3 - q1
    const uf     = q3 + 1.5 * iqr
    const maxVal = sorted[sorted.length - 1]

    const needsLog = uf > 0 && maxVal > uf * 6 && q1 > 0

    if (needsLog) {
      const logFloor = Math.floor(Math.log10(Math.max(sorted[0], 1)))
      const logCeil  = Math.ceil(Math.log10(maxVal * 1.1))
      const tickvals: number[] = []
      for (let e = logFloor; e <= logCeil; e++) {
        tickvals.push(Math.pow(10, e))
        if (e < logCeil) { tickvals.push(2 * Math.pow(10, e)); tickvals.push(5 * Math.pow(10, e)) }
      }
      return {
        boxYAxis: { ...PT_AXIS, title: { text: 'Store Revenue (log scale)' }, type: 'log' as const, tickmode: 'array' as const, tickvals, ticktext: tickvals.map(fmtInrFull) },
        boxScaleIsLog: true,
      }
    }

    if (maxVal === 0) return fallback
    const rough = maxVal / 5
    const exp   = Math.pow(10, Math.floor(Math.log10(rough)))
    const norm  = rough / exp
    const step  = (norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10) * exp
    const tickvals: number[] = []
    for (let t = 0; t <= maxVal * 1.05; t += step) tickvals.push(Math.round(t))
    return {
      boxYAxis: { ...PT_AXIS, title: { text: 'Store Revenue' }, tickmode: 'array' as const, tickvals, ticktext: tickvals.map(fmtInrFull) },
      boxScaleIsLog: false,
    }
  }, [fs, fm, viewMode])

  // ── Per-month outlier detection ───────────────────────────────────────────
  const outlierData = useMemo((): OutlierRow[] => {
    const rows: OutlierRow[] = []
    for (const month of fm) {
      if (viewMode === 'attach') {
        // Outlier detection on attach % (0–100 scale)
        const vals = fs
          .filter(s => (s.monthly_main_qty?.[month] ?? 0) > 0)
          .map(s => (s.monthly_attach_pct?.[month] ?? 0) * 100)
          .filter(v => v > 0)
          .sort((a, b) => a - b)
        if (vals.length < 4) continue
        const q1  = pctile(vals, 25)
        const q3  = pctile(vals, 75)
        const iqr = q3 - q1
        const lf  = q1 - 1.5 * iqr
        const uf  = q3 + 1.5 * iqr
        for (const store of fs) {
          if ((store.monthly_main_qty?.[month] ?? 0) === 0) continue
          const ap = (store.monthly_attach_pct?.[month] ?? 0) * 100
          if (ap > uf) {
            rows.push({
              storeId: store.store_id, storeName: store.store_name ?? store.store_id,
              state: store.state ?? '—', month, revenue: store.monthly_sales[month] ?? 0,
              type: 'High Outlier', fence: uf, distance: ap - uf,
              lowerBound: Math.max(lf, 0), upperBound: uf, attachPct: ap,
            })
          } else if (ap > 0 && lf > 0 && ap < lf) {
            rows.push({
              storeId: store.store_id, storeName: store.store_name ?? store.store_id,
              state: store.state ?? '—', month, revenue: store.monthly_sales[month] ?? 0,
              type: 'Low Outlier', fence: lf, distance: lf - ap,
              lowerBound: Math.max(lf, 0), upperBound: uf, attachPct: ap,
            })
          }
        }
        continue
      }
      const revs = fs.map(s => s.monthly_sales[month] ?? 0).filter(v => v > 0).sort((a, b) => a - b)
      if (revs.length < 4) continue
      const q1  = pctile(revs, 25)
      const q3  = pctile(revs, 75)
      const iqr = q3 - q1
      const lf  = q1 - 1.5 * iqr
      const uf  = q3 + 1.5 * iqr
      for (const store of fs) {
        const rev = store.monthly_sales[month] ?? 0
        if (rev > uf) {
          rows.push({
            storeId: store.store_id, storeName: store.store_name ?? store.store_id,
            state: store.state ?? '—', month, revenue: rev, type: 'High Outlier',
            fence: uf, distance: rev - uf,
            lowerBound: Math.max(lf, 0), upperBound: uf,
          })
        } else if (rev > 0 && rev < lf) {
          rows.push({
            storeId: store.store_id, storeName: store.store_name ?? store.store_id,
            state: store.state ?? '—', month, revenue: rev, type: 'Low Outlier',
            fence: lf, distance: lf - rev,
            lowerBound: Math.max(lf, 0), upperBound: uf,
          })
        }
      }
    }
    return rows
  }, [fs, fm, viewMode])

  const outliersKpi = useMemo(() => {
    const total     = outlierData.length
    const high      = outlierData.filter(o => o.type === 'High Outlier').length
    const low       = total - high
    const topOutlier = outlierData.reduce<OutlierRow | null>(
      (best, o) => (!best || o.revenue > best.revenue) ? o : best, null,
    )
    return { total, high, low, topOutlier }
  }, [outlierData])

  // ── Box-plot traces ────────────────────────────────────────────────────────
  const boxTraces = useMemo(() => {
    const isAttach = viewMode === 'attach'
    const traces: object[] = fm.flatMap((month, i) => {
      const values = isAttach
        ? fs.filter(s => (s.monthly_main_qty?.[month] ?? 0) > 0)
             .map(s => (s.monthly_attach_pct?.[month] ?? 0) * 100)
             .filter(v => v > 0)
        : fs.map(s => s.monthly_sales[month] ?? 0).filter(v => v > 0)
      if (values.length === 0) return []
      const stats = computeMonthStats(values)
      const color = STATE_PALETTE[i % STATE_PALETTE.length]
      const hover = isAttach
        ? buildBoxHoverAttach(month, stats)
        : buildBoxHover(month, stats)
      return [{
        type: 'box' as const,
        y: values,
        name: month,
        boxpoints: false as const,
        marker:    { color },
        line:      { color, width: 2 },
        fillcolor: `${color}3a`,
        hovertemplate: hover,
      }]
    })

    // High outlier scatter
    const highOuts = outlierData.filter(o => o.type === 'High Outlier')
    if (highOuts.length > 0) {
      traces.push({
        type: 'scatter' as const, mode: 'markers' as const,
        name: 'High Performer',
        x: highOuts.map(o => o.month),
        y: isAttach ? highOuts.map(o => o.attachPct ?? 0) : highOuts.map(o => o.revenue),
        customdata: highOuts.map(o => [
          o.storeName, o.state, o.storeId,
          isAttach ? `${o.distance.toFixed(2)}pp` : fmtInrFull(o.distance),
          isAttach ? `${(o.attachPct ?? 0).toFixed(2)}%` : fmtInrFull(o.revenue),
        ]),
        marker: { symbol: 'circle', size: 9, color: '#10b981', opacity: 0.9, line: { width: 1.5, color: '#059669' } },
        hovertemplate: [
          '<b>%{customdata[0]}</b>', 'Store Code: %{customdata[2]}',
          'State: %{customdata[1]}', 'Month: %{x}',
          isAttach ? 'Attach %: <b>%{customdata[4]}</b>' : 'Revenue: <b>₹%{y:,.0f}</b>',
          'Above upper bound by: <b>%{customdata[3]}</b>',
          '<i>★ High Performance Outlier</i>',
        ].join('<br>') + '<extra></extra>',
        showlegend: true,
      })
    }

    // Low outlier scatter
    const lowOuts = outlierData.filter(o => o.type === 'Low Outlier')
    if (lowOuts.length > 0) {
      traces.push({
        type: 'scatter' as const, mode: 'markers' as const,
        name: 'Low Outlier',
        x: lowOuts.map(o => o.month),
        y: isAttach ? lowOuts.map(o => o.attachPct ?? 0) : lowOuts.map(o => o.revenue),
        customdata: lowOuts.map(o => [
          o.storeName, o.state, o.storeId,
          isAttach ? `${o.distance.toFixed(2)}pp` : fmtInrFull(o.distance),
          isAttach ? `${(o.attachPct ?? 0).toFixed(2)}%` : fmtInrFull(o.revenue),
        ]),
        marker: { symbol: 'triangle-down', size: 9, color: '#f97316', opacity: 0.9, line: { width: 1.5, color: '#c2410c' } },
        hovertemplate: [
          '<b>%{customdata[0]}</b>', 'Store Code: %{customdata[2]}',
          'State: %{customdata[1]}', 'Month: %{x}',
          isAttach ? 'Attach %: <b>%{customdata[4]}</b>' : 'Revenue: <b>₹%{y:,.0f}</b>',
          'Below lower bound by: <b>%{customdata[3]}</b>',
          '<i>▼ Low Outlier</i>',
        ].join('<br>') + '<extra></extra>',
        showlegend: true,
      })
    }

    return traces
  }, [fs, fm, outlierData, viewMode])

  // ── Drill-down data for selected month ─────────────────────────────────────
  const drillDown = useMemo(() => {
    console.log(`[KDE] drillDown memo — canonicalMonth="${canonicalMonth}" fm=[${fm.slice(0,3).join(',')}…]`)
    if (!canonicalMonth) { console.log('[KDE] drillDown → null (no canonical month)'); return null }

    const isAttach = viewMode === 'attach'
    const sortedVals = isAttach
      ? fs
          .filter(s => (s.monthly_main_qty?.[canonicalMonth] ?? 0) > 0)
          .map(s => (s.monthly_attach_pct?.[canonicalMonth] ?? 0) * 100)
          .filter(v => v > 0)
          .sort((a, b) => a - b)
      : fs
          .map(s => s.monthly_sales[canonicalMonth] ?? 0)
          .filter(v => v > 0)
          .sort((a, b) => a - b)

    console.log(`[KDE] month=${canonicalMonth} totalStores=${fs.length} activeStores=${sortedVals.length} min=${sortedVals[0]?.toFixed(0)} max=${sortedVals[sortedVals.length - 1]?.toFixed(0)}`)

    if (sortedVals.length === 0) {
      console.log('[KDE] drillDown → null (no active store revenues for this month)')
      return null
    }

    const stats = computeMonthStats(sortedVals)
    if (!stats) { console.log('[KDE] drillDown → null (computeMonthStats returned null)'); return null }

    console.log(`[KDE] stats: n=${stats.n} median=${stats.median.toFixed(0)} iqr=${stats.iqr.toFixed(0)} lf=${stats.lf.toFixed(0)} uf=${stats.uf.toFixed(0)}`)

    const kde        = computeKDE(sortedVals)
    const maxDensity = kde.y.length > 0 ? Math.max(...kde.y) : 0

    console.log(`[KDE] KDE ok: x.length=${kde.x.length} maxDensity=${maxDensity.toExponential(3)}`)

    const monthOutliers = outlierData.filter(o => o.month === canonicalMonth)
    const highOuts      = monthOutliers.filter(o => o.type === 'High Outlier')
    const lowOuts       = monthOutliers.filter(o => o.type === 'Low Outlier')
    const dispLb        = Math.max(stats.lf, 0)

    const densityLabel = isAttach ? 'Attach % Density' : 'Revenue Density'
    const xAxisLabel   = isAttach ? 'Store Attach %' : 'Store Revenue (₹)'
    const hoverX       = isAttach ? '%{x:.2f}%' : '₹%{x:,.0f}'

    const kdeTraces: object[] = [
      {
        type: 'scatter', mode: 'lines',
        name: densityLabel,
        x: kde.x, y: kde.y,
        line: { color: isAttach ? '#8b5cf6' : '#3b82f6', width: 2 },
        fill: 'tozeroy',
        fillcolor: isAttach ? 'rgba(139,92,246,0.12)' : 'rgba(59,130,246,0.12)',
        hovertemplate: `${isAttach ? 'Attach' : 'Revenue'}: <b>${hoverX}</b><extra>Density</extra>`,
      },
    ]

    if (highOuts.length > 0) {
      kdeTraces.push({
        type: 'scatter', mode: 'markers',
        name: 'High Performers',
        x: isAttach ? highOuts.map(o => o.attachPct ?? 0) : highOuts.map(o => o.revenue),
        y: highOuts.map(() => -(maxDensity * 0.04)),
        customdata: highOuts.map(o => [o.storeName, o.storeId]),
        marker: { symbol: 'line-ns', size: 14, color: '#10b981', line: { width: 2, color: '#10b981' } },
        hovertemplate: `<b>%{customdata[0]}</b><br>Code: %{customdata[1]}<br>${isAttach ? 'Attach' : 'Revenue'}: <b>${hoverX}</b><extra>High Performer</extra>`,
      })
    }
    if (lowOuts.length > 0) {
      kdeTraces.push({
        type: 'scatter', mode: 'markers',
        name: 'Low Outliers',
        x: isAttach ? lowOuts.map(o => o.attachPct ?? 0) : lowOuts.map(o => o.revenue),
        y: lowOuts.map(() => -(maxDensity * 0.04)),
        customdata: lowOuts.map(o => [o.storeName, o.storeId]),
        marker: { symbol: 'line-ns', size: 14, color: '#f97316', line: { width: 2, color: '#f97316' } },
        hovertemplate: `<b>%{customdata[0]}</b><br>Code: %{customdata[1]}<br>${isAttach ? 'Attach' : 'Revenue'}: <b>${hoverX}</b><extra>Low Outlier</extra>`,
      })
    }

    const vline = (x: number, color: string, dash: string) => ({
      type: 'line', x0: x, x1: x, y0: 0, y1: 1, yref: 'paper',
      line: { color, width: 1.5, dash },
    })
    const shapes = [
      vline(dispLb,       '#f97316', 'dot'),
      vline(stats.q1,     '#94a3b8', 'dash'),
      vline(stats.median, isAttach ? '#8b5cf6' : '#3b82f6', 'solid'),
      vline(stats.q3,     '#94a3b8', 'dash'),
      vline(stats.uf,     '#10b981', 'dot'),
    ]

    const ann = (x: number, text: string, color: string, anchor: 'left' | 'right' | 'center' = 'center') => ({
      x, y: 1.01, xref: 'x', yref: 'paper', xanchor: anchor, yanchor: 'bottom',
      text: `<b>${text}</b>`, showarrow: false,
      font: { color, size: 9, family: 'Inter, sans-serif' },
    })
    const annotations = [
      ann(dispLb,       'LB',     '#f97316', 'right'),
      ann(stats.q1,     'Q1',     '#94a3b8'),
      ann(stats.median, 'Median', isAttach ? '#8b5cf6' : '#3b82f6'),
      ann(stats.q3,     'Q3',     '#94a3b8'),
      ann(stats.uf,     'UB',     '#10b981', 'left'),
    ]

    console.log(`[KDE] drillDown → ready (kdeTraces=${kdeTraces.length} shapes=${shapes.length})`)
    return { stats, kde, kdeTraces, shapes, annotations, monthOutliers, highOuts, lowOuts, dispLb, maxDensity, xAxisLabel }
  }, [canonicalMonth, fs, fm, outlierData, viewMode])

  // ── Export handlers ───────────────────────────────────────────────────────
  const handleOutlierCsv = () => {
    const headers = ['Store Name', 'Store Code', 'State', 'Month', 'Revenue', 'Outlier Type', 'Lower Bound', 'Upper Bound', 'Distance from Bound']
    const rows    = outlierData.map(r => [r.storeName, r.storeId, r.state, r.month, r.revenue, r.type, r.lowerBound, r.upperBound, r.distance])
    exportCsv('outlier-stores', headers, rows)
  }

  const handleOutlierExcel = () => {
    const headers = ['Store Name', 'Store Code', 'State', 'Month', 'Revenue', 'Outlier Type', 'Lower Bound', 'Upper Bound', 'Distance from Bound']
    const rows    = outlierData.map(r => [r.storeName, r.storeId, r.state, r.month, r.revenue, r.type, r.lowerBound, r.upperBound, r.distance])
    exportExcel('outlier-stores', headers, rows)
  }

  // ── Empty state ────────────────────────────────────────────────────────────
  if (fs.length === 0 || fm.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white min-h-96 flex items-center justify-center shadow-sm">
        <p className="text-gray-400 text-sm">No data for selected filters</p>
      </div>
    )
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">

      {/* ── Revenue ↔ Attach % Toggle ── */}
      {hasAttach && (
        <motion.div {...panelSpring(0.06)} className="flex items-center gap-2 mb-1">
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
              onClick={() => setViewMode('attach')}
              className={cn(
                'px-3 py-1 rounded-md text-[11px] font-semibold transition-all duration-200',
                viewMode === 'attach'
                  ? 'bg-white text-purple-700 shadow-sm border border-purple-200'
                  : 'text-gray-500 hover:text-gray-700',
              )}
            >
              📎 Attach Percentage
            </button>
          </div>
          {viewMode === 'attach' && (
            <span className="text-[10px] text-purple-500 font-medium ml-1">
              Showing plan attach rate (plans ÷ Samsung units) per store
            </span>
          )}
        </motion.div>
      )}

      {/* ── Monthly Revenue / Attach Trend ── */}
      <motion.div {...panelSpring(0.12)} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-2 flex-wrap mb-1">
          <div>
            <h3 className="text-sm font-semibold text-gray-800">
              {viewMode === 'attach' ? 'Monthly Attach % Trend' : 'Monthly Revenue Trend'}
            </h3>
            <p className="text-[11px] text-gray-500 mt-0.5">
              {viewMode === 'attach'
                ? <>Bars = avg attach % by phase · Line = stores with Samsung unit data</>
                : <>Bars = revenue by phase
                    {mid.length > 0 ? <> · <span style={{ color: PHASE_COLOR.mid }}>■</span> <span className="text-indigo-500">{mid[0]}{mid.length > 1 ? `–${mid[mid.length - 1]}` : ''}</span> = mid phase</> : null}
                    {' '}· Line = active store count
                  </>
              }
            </p>
          </div>
          {viewMode === 'revenue' && kpis?.runRatePct != null && (
            <motion.span
              key={Math.round(kpis.runRatePct)}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: 'spring', stiffness: 400, damping: 28 }}
              className={cn(
                'text-xs font-semibold px-2.5 py-1 rounded-full border',
                kpis.runRatePct >= 0
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : 'bg-red-50 text-red-700 border-red-200',
              )}
            >
              {fmtPct(kpis.runRatePct)} run-rate shift
            </motion.span>
          )}
        </div>

        <Plot
          data={macroTraces as any}
          layout={{
            paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
            font: { color: PT.font, family: 'Inter, sans-serif', size: 11 },
            barmode: 'overlay' as const,
            legend: { bgcolor: 'rgba(0,0,0,0)', font: { color: PT.font, size: 10 }, orientation: 'h' as const, y: -0.22 },
            xaxis:  { ...PT_AXIS },
            yaxis:  viewMode === 'attach'
              ? { ...PT_AXIS, title: { text: 'Avg Attach %' }, ticksuffix: '%' }
              : { ...PT_AXIS, title: { text: 'Revenue (₹)' }, ...plotlyInrTickVals(monthlyData.length > 0 ? Math.max(...monthlyData.map(d=>d.rev)) : 0) },
            yaxis2: { ...PT_AXIS, title: { text: viewMode === 'attach' ? 'Stores w/ Qty' : 'Active Stores' }, overlaying: 'y' as const, side: 'right' as const, showgrid: false },
            annotations: phaseAnnotations as any[],
            margin: { l: 70, r: 70, t: 36, b: 110 },
            height: 420,
          }}
          config={{ displayModeBar: false, responsive: true }}
          style={{ width: '100%' }}
        />

        {kpis && viewMode === 'revenue' && (
          <div className="mt-4 border-t border-gray-100 pt-4">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-3">Story so far</p>
            <div className={cn('grid grid-cols-1 gap-3', mid.length > 0 ? 'sm:grid-cols-4' : 'sm:grid-cols-3')}>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 mb-1.5">Peak &amp; Trough</p>
                <p className="text-[11px] text-gray-700 leading-relaxed">
                  Best month: <span className="text-gray-900 font-semibold">{kpis.peak.m}</span> ({fmtInr(kpis.peak.rev)}).
                  Weakest: <span className="text-gray-900 font-semibold">{kpis.trough.m}</span> ({fmtInr(kpis.trough.rev)}).
                </p>
              </div>
              {mid.length > 0 && kpis.midShiftPct != null && (
                <div className="rounded-lg border border-indigo-100 bg-indigo-50 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-indigo-500 mb-1.5">Mid Phase ({mid[0]}{mid.length > 1 ? `–${mid[mid.length - 1]}` : ''})</p>
                  <p className="text-[11px] text-gray-700 leading-relaxed">
                    Mid phase averaged <span className="text-gray-900 font-semibold">{fmtInr(kpis.avgMid)}</span>,
                    a <span className={cn('font-semibold', kpis.midShiftPct >= 0 ? 'text-emerald-600' : 'text-red-600')}>{fmtPct(kpis.midShiftPct)}</span> shift from early baseline.
                  </p>
                </div>
              )}
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 mb-1.5">Run-Rate Shift</p>
                <p className="text-[11px] text-gray-700 leading-relaxed">
                  Early avg <span className="text-gray-900 font-semibold">{fmtInr(kpis.avgEarly)}/mo</span> →
                  Recent avg <span className="text-gray-900 font-semibold">{fmtInr(kpis.avgRecent)}/mo</span> —
                  a <span className={cn('font-semibold', kpis.runRatePct >= 0 ? 'text-emerald-600' : 'text-red-600')}>{fmtPct(kpis.runRatePct)}</span> change.
                </p>
              </div>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 mb-1.5">Active-Store Footprint</p>
                <p className="text-[11px] text-gray-700 leading-relaxed">
                  Active stores: <span className="text-gray-900 font-semibold">{kpis.firstActive}</span> →{' '}
                  <span className="text-gray-900 font-semibold">{kpis.lastActive}</span>{' '}
                  (<span className={cn('font-semibold', kpis.footprintPct >= 0 ? 'text-emerald-600' : 'text-red-600')}>{fmtPct(kpis.footprintPct)}</span>).
                </p>
              </div>
            </div>
          </div>
        )}
      </motion.div>

      {/* ── Store Revenue Distribution ── */}
      <motion.div {...panelSpring(0.22)} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-2 flex-wrap mb-1">
          <div>
            <h3 className="text-sm font-semibold text-gray-800">Store Revenue Distribution by Month</h3>
            <p className="text-[11px] text-gray-500 mt-0.5">
              Revenue spread across active stores each month. IQR outlier fences: Q1 − 1.5×IQR (low) and Q3 + 1.5×IQR (high).
              {boxScaleIsLog ? ' Log scale — extreme outliers detected.' : ''}
              {' '}<span className="text-blue-500 font-medium">Hover a month, then click to drill down.</span>
            </p>
          </div>
          {canonicalMonth && (
            <button
              onClick={() => setSelectedMonth(null)}
              className="text-[11px] px-2.5 py-1 rounded-full border border-blue-200 bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors"
            >
              ✕ Close {canonicalMonth}
            </button>
          )}
        </div>

        {/*
          Box fill areas do NOT emit plotly_click in plotly.js — only thin marker lines do.
          Fix: track the hovered month via plotly_hover (fires reliably on the full box area)
          in a ref, then use a native div onClick to open the drill-down.
        */}
        <div
          style={{ cursor: 'pointer' }}
          onClick={() => {
            const month = hoveredMonthRef.current
            console.log(`[KDE] div click — hoveredMonth="${month}" fm.includes=${month ? fm.includes(month) : false}`)
            if (!month || !fm.includes(month)) return
            setSelectedMonth(prev => {
              const next = prev === month ? null : month
              console.log(`[KDE] setSelectedMonth: "${prev}" → "${next}"`)
              return next
            })
          }}
        >
          <Plot
            data={boxTraces as any}
            layout={{
              paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
              font: { color: PT.font, family: 'Inter, sans-serif', size: 11 },
              showlegend: true,
              legend: { bgcolor: 'rgba(0,0,0,0)', font: { color: PT.font, size: 10 }, orientation: 'h' as const, y: -0.22, x: 0.5, xanchor: 'center' as const },
              xaxis: { ...PT_AXIS },
              yaxis: boxYAxis,
              margin: { l: 90, r: 16, t: 12, b: 100 },
              height: 460,
              hoverlabel: { bgcolor: '#ffffff', bordercolor: '#e5e7eb', font: { size: 12, family: 'Inter, sans-serif', color: '#374151' } },
            }}
            config={{ displayModeBar: false, responsive: true }}
            style={{ width: '100%' }}
            onHover={(data: any) => {
              const pt = data?.points?.[0]
              if (!pt) return
              // Try every possible path — box traces and scatter traces use different structures
              const month = String(pt.x ?? pt.data?.name ?? pt.fullData?.name ?? '')
              console.log(`[KDE] hover — pt.x="${pt.x}" pt.data?.name="${pt.data?.name}" resolved="${month}" inFm=${fm.includes(month)}`)
              if (month && fm.includes(month)) {
                hoveredMonthRef.current = month
              }
            }}
            onUnhover={() => {
              hoveredMonthRef.current = null
            }}
          />
        </div>

        <div className="mt-2 rounded-lg bg-gray-50 border border-gray-100 px-3 py-2 text-[10px] text-gray-500 leading-relaxed">
          <span className="font-semibold text-gray-600">How to read: </span>
          Active stores only &nbsp;·&nbsp; Box = Q1–Q3 &nbsp;·&nbsp; Line = Median &nbsp;·&nbsp;
          Whiskers = non-outlier min/max &nbsp;·&nbsp;
          <span className="font-semibold text-emerald-600">● High Performer</span> &nbsp;·&nbsp;
          <span className="font-semibold text-orange-500">▼ Low Outlier</span>
          {boxScaleIsLog && <span className="ml-2 font-semibold text-indigo-500">· Log scale active</span>}
        </div>

        {/* Outlier summary cards */}
        {outliersKpi.total > 0 && (
          <div className="mt-4 border-t border-gray-100 pt-4">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-3">Outlier Summary</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 mb-1">Total Outlier Stores</p>
                <p className="text-2xl font-bold text-gray-800">{outliersKpi.total}</p>
              </div>
              <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-emerald-600 mb-1">High Performers</p>
                <p className="text-2xl font-bold text-emerald-700">{outliersKpi.high}</p>
              </div>
              <div className="rounded-lg border border-orange-100 bg-orange-50 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-orange-500 mb-1">Low Outliers</p>
                <p className="text-2xl font-bold text-orange-700">{outliersKpi.low}</p>
              </div>
              {outliersKpi.topOutlier && (
                <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-emerald-600 mb-1">{viewMode === 'attach' ? 'Top Attach Outlier' : 'Top Revenue Performer'}</p>
                  <p className="text-xs font-semibold text-gray-800 truncate" title={outliersKpi.topOutlier.storeName}>{outliersKpi.topOutlier.storeName}</p>
                  <p className="text-[11px] text-gray-600 mt-0.5">{fmtInr(outliersKpi.topOutlier.revenue)} · {outliersKpi.topOutlier.month}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* KDE Drill-Down Panel */}
        <AnimatePresence>
          {canonicalMonth && (
            <motion.div
              key={canonicalMonth}
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.22, ease: 'easeOut' }}
              className="mt-4 border-t border-blue-100 pt-4"
            >
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-sm font-semibold text-gray-800">
                    {viewMode === 'attach' ? 'Attach % Distribution' : 'Revenue Distribution'} — {canonicalMonth}
                  </p>
                  <p className="text-[11px] text-gray-500 mt-0.5">
                    Kernel density estimate of {viewMode === 'attach' ? 'store attach rates' : 'store revenues'} · reference lines at key percentiles and IQR bounds
                  </p>
                </div>
                <button
                  onClick={() => setSelectedMonth(null)}
                  className="text-[11px] text-gray-400 hover:text-gray-600 transition-colors px-2 py-1 rounded"
                >
                  ✕ Close
                </button>
              </div>

              {/* Fallback when drillDown hasn't computed yet or has no data */}
              {!drillDown && (
                <div className="rounded-lg border border-gray-100 bg-gray-50 px-4 py-6 text-center text-[12px] text-gray-400">
                  No active store revenues found for {canonicalMonth} — distribution cannot be generated.
                </div>
              )}

              {drillDown && (
                <>
                  {/* Summary stat cards */}
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-4">
                    {[
                      { label: 'Store Count',    value: String(drillDown.stats.n),                                                color: 'text-gray-800' },
                      { label: viewMode === 'attach' ? 'Median Attach %' : 'Median Revenue', value: viewMode === 'attach' ? `${drillDown.stats.median.toFixed(2)}%` : fmtInr(drillDown.stats.median), color: viewMode === 'attach' ? 'text-purple-700' : 'text-blue-700' },
                      { label: viewMode === 'attach' ? 'Min Attach %' : 'Min Revenue',       value: viewMode === 'attach' ? `${drillDown.stats.minR.toFixed(2)}%` : fmtInr(drillDown.stats.minR),     color: 'text-gray-700' },
                      { label: viewMode === 'attach' ? 'Max Attach %' : 'Max Revenue',       value: viewMode === 'attach' ? `${drillDown.stats.maxR.toFixed(2)}%` : fmtInr(drillDown.stats.maxR),     color: 'text-gray-700' },
                      { label: 'IQR',            value: viewMode === 'attach' ? `${drillDown.stats.iqr.toFixed(2)}pp` : fmtInr(drillDown.stats.iqr),     color: 'text-indigo-700' },
                      { label: 'Outlier Count',  value: String(drillDown.stats.outliers),color: drillDown.stats.outliers > 0 ? 'text-emerald-700' : 'text-gray-500' },
                    ].map(({ label, value, color }) => (
                      <div key={label} className="rounded-lg border border-gray-100 bg-gray-50 px-2.5 py-2">
                        <p className="text-[9px] font-semibold uppercase tracking-widest text-gray-400 mb-0.5">{label}</p>
                        <p className={cn('text-sm font-bold', color)}>{value}</p>
                      </div>
                    ))}
                  </div>

                  {/* Legend */}
                  <div className="flex flex-wrap gap-3 mb-2 text-[10px]">
                    {(viewMode === 'attach' ? [
                      { color: '#f97316', label: `LB: ${drillDown.dispLb.toFixed(2)}%` },
                      { color: '#94a3b8', label: `Q1: ${drillDown.stats.q1.toFixed(2)}%` },
                      { color: '#8b5cf6', label: `Median: ${drillDown.stats.median.toFixed(2)}%` },
                      { color: '#94a3b8', label: `Q3: ${drillDown.stats.q3.toFixed(2)}%` },
                      { color: '#10b981', label: `UB: ${drillDown.stats.uf.toFixed(2)}%` },
                    ] : [
                      { color: '#f97316', label: `Lower Bound: ${fmtInr(drillDown.dispLb)}` },
                      { color: '#94a3b8', label: `Q1: ${fmtInr(drillDown.stats.q1)}` },
                      { color: '#3b82f6', label: `Median: ${fmtInr(drillDown.stats.median)}` },
                      { color: '#94a3b8', label: `Q3: ${fmtInr(drillDown.stats.q3)}` },
                      { color: '#10b981', label: `Upper Bound: ${fmtInr(drillDown.stats.uf)}` },
                    ]).map(({ color, label }) => (
                      <span key={label} className="flex items-center gap-1 text-gray-600">
                        <span style={{ display: 'inline-block', width: 16, height: 2, backgroundColor: color, borderRadius: 1 }} />
                        {label}
                      </span>
                    ))}
                  </div>

                  {/* KDE Plot */}
                  <Plot
                    key={`kde-${canonicalMonth}`}
                    data={drillDown.kdeTraces as any}
                    layout={{
                      paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
                      font: { color: PT.font, family: 'Inter, sans-serif', size: 11 },
                      showlegend: drillDown.monthOutliers.length > 0,
                      legend: { bgcolor: 'rgba(0,0,0,0)', font: { color: PT.font, size: 10 }, orientation: 'h' as const, y: -0.22, x: 0.5, xanchor: 'center' as const },
                      xaxis: viewMode === 'attach'
                        ? { ...PT_AXIS, title: { text: drillDown.xAxisLabel }, ticksuffix: '%' }
                        : { ...PT_AXIS, title: { text: drillDown.xAxisLabel }, ...plotlyInrTickVals(drillDown.stats.maxR) },
                      yaxis: { ...PT_AXIS, title: { text: 'Density' }, showticklabels: false, zeroline: true, zerolinecolor: PT.line },
                      shapes:      drillDown.shapes as any[],
                      annotations: drillDown.annotations as any[],
                      margin: { l: 40, r: 16, t: 36, b: drillDown.monthOutliers.length > 0 ? 90 : 50 },
                      height: 300,
                      hoverlabel: { bgcolor: '#ffffff', bordercolor: '#e5e7eb', font: { size: 12, family: 'Inter, sans-serif', color: '#374151' } },
                    }}
                    config={{ displayModeBar: false, responsive: true }}
                    style={{ width: '100%' }}
                  />

                  {/* Outlier stores for this month */}
                  {drillDown.monthOutliers.length > 0 && (
                    <div className="mt-3 rounded-lg border border-gray-100 overflow-hidden">
                      <div className="bg-gray-50 px-3 py-2 border-b border-gray-100">
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">
                          Outlier Stores — {canonicalMonth} ({drillDown.monthOutliers.length})
                        </p>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-[11px] text-gray-700 border-collapse">
                          <thead>
                            <tr className="border-b border-gray-100">
                              <th className="text-left px-3 py-2 font-semibold text-gray-600">Store Name</th>
                              <th className="text-left px-3 py-2 font-semibold text-gray-600">Code</th>
                              <th className="text-left px-3 py-2 font-semibold text-gray-600">State</th>
                              <th className="text-right px-3 py-2 font-semibold text-gray-600">{viewMode === 'attach' ? 'Attach %' : 'Revenue'}</th>
                              <th className="text-center px-3 py-2 font-semibold text-gray-600">Type</th>
                              <th className="text-right px-3 py-2 font-semibold text-gray-600">Distance</th>
                            </tr>
                          </thead>
                          <tbody>
                            {drillDown.monthOutliers.map((row, i) => (
                              <tr key={`dd-${row.storeId}-${row.month}`} className={cn('border-b border-gray-50', i % 2 === 0 ? 'bg-white' : 'bg-gray-50/40')}>
                                <td className="px-3 py-1.5 font-medium text-gray-800 max-w-[160px] truncate" title={row.storeName}>{row.storeName}</td>
                                <td className="px-3 py-1.5 text-gray-500 font-mono">{row.storeId}</td>
                                <td className="px-3 py-1.5">{row.state}</td>
                                <td className="px-3 py-1.5 text-right font-medium">{viewMode === 'attach' ? `${(row.attachPct ?? 0).toFixed(2)}%` : fmtInrFull(row.revenue)}</td>
                                <td className="px-3 py-1.5 text-center">
                                  <span className={cn(
                                    'px-1.5 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap',
                                    row.type === 'High Outlier' ? 'bg-emerald-100 text-emerald-700' : 'bg-orange-100 text-orange-700',
                                  )}>
                                    {row.type === 'High Outlier' ? '★ High Performer' : '▼ Low Outlier'}
                                  </span>
                                </td>
                                <td className="px-3 py-1.5 text-right text-gray-500">{viewMode === 'attach' ? `${row.distance.toFixed(2)}pp` : fmtInrFull(row.distance)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* ── Outlier Stores Table ── */}
      {outlierData.length > 0 && (
        <motion.div {...panelSpring(0.30)} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3 flex-wrap mb-0.5">
            <div>
              <h3 className="text-sm font-semibold text-gray-800">Outlier Stores</h3>
              <p className="text-[11px] text-gray-500 mt-0.5">
                Stores outside Q1 − 1.5×IQR (low) or Q3 + 1.5×IQR (high) for each month. Updates with all active filters.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={handleOutlierCsv}
                className="flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition-colors"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M2 10v4h12v-4M8 2v8M5 7l3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                CSV
              </button>
              <button
                onClick={handleOutlierExcel}
                className="flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M2 10v4h12v-4M8 2v8M5 7l3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Excel
              </button>
            </div>
          </div>
          <div className="overflow-x-auto mt-3">
            <table className="w-full text-[11px] text-gray-700 border-collapse">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  {(viewMode === 'attach'
                    ? ['Store Name','Store Code','State','Month','Attach %','Type','Lower Bound','Upper Bound','Distance']
                    : ['Store Name','Store Code','State','Month','Revenue','Type','Lower Bound','Upper Bound','Distance from Bound']
                  ).map(h => (
                    <th key={h} className={cn('px-3 py-2 font-semibold text-gray-600 whitespace-nowrap', h === 'Revenue' || h === 'Attach %' || h === 'Lower Bound' || h === 'Upper Bound' || h === 'Distance from Bound' || h === 'Distance' ? 'text-right' : h === 'Type' ? 'text-center' : 'text-left')}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {outlierData.map((row, i) => (
                  <tr key={`${row.storeId}-${row.month}`} className={cn('border-b border-gray-100', i % 2 === 0 ? 'bg-white' : 'bg-gray-50/60')}>
                    <td className="px-3 py-2 font-medium text-gray-800 max-w-[180px] truncate" title={row.storeName}>{row.storeName}</td>
                    <td className="px-3 py-2 text-gray-500 font-mono">{row.storeId}</td>
                    <td className="px-3 py-2">{row.state}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{row.month}</td>
                    <td className="px-3 py-2 text-right font-medium">{viewMode === 'attach' ? `${(row.attachPct ?? 0).toFixed(2)}%` : fmtInrFull(row.revenue)}</td>
                    <td className="px-3 py-2 text-center">
                      <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap',
                        row.type === 'High Outlier' ? 'bg-emerald-100 text-emerald-700' : 'bg-orange-100 text-orange-700',
                      )}>
                        {row.type === 'High Outlier' ? '★ High Performer' : '▼ Low Outlier'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right text-gray-500 whitespace-nowrap">{viewMode === 'attach' ? `${row.lowerBound.toFixed(2)}%` : fmtInrFull(row.lowerBound)}</td>
                    <td className="px-3 py-2 text-right text-gray-500 whitespace-nowrap">{viewMode === 'attach' ? `${row.upperBound.toFixed(2)}%` : fmtInrFull(row.upperBound)}</td>
                    <td className="px-3 py-2 text-right text-gray-600 whitespace-nowrap">{viewMode === 'attach' ? `${row.distance.toFixed(2)}pp` : fmtInrFull(row.distance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>
      )}

    </div>
  )
}
