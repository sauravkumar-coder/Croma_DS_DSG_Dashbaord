import { useMemo } from 'react'
import { motion } from 'framer-motion'
import createPlotlyComponent from 'react-plotly.js/factory'
// @ts-ignore — plotly.js-dist-min does not ship its own .d.ts
import Plotly from 'plotly.js-dist-min'
import { useDataContext } from '@/contexts/DataContext'
import type { FilterState } from '@/hooks/useFilters'
import { cn } from '@/lib/utils'
import { allocatePhases } from '@/lib/classificationEngine'
import { fmtInr, fmtPct } from '@/lib/formatting'
import { panelSpring } from '@/lib/animations'
import { PT, PT_AXIS } from '@/lib/plotlyTheme'

const Plot = createPlotlyComponent(Plotly)

// ── Box-plot colour palette ───────────────────────────────────────────────────
const STATE_PALETTE = [
  '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6',
  '#06b6d4', '#f97316', '#84cc16', '#ec4899',
  '#14b8a6', '#a855f7', '#f43f5e', '#22d3ee',
]

// Phase colours — used consistently on bars and insight cards
const PHASE_COLOR = {
  early:  '#94a3b8',  // slate-400
  mid:    '#818cf8',  // indigo-400
  recent: '#3b82f6',  // blue-500
} as const

// ── Box-plot statistical helpers ──────────────────────────────────────────────

function pctile(sorted: number[], p: number): number {
  const idx = (p / 100) * (sorted.length - 1)
  const lo = Math.floor(idx), hi = Math.ceil(idx)
  return lo === hi ? sorted[lo] : sorted[lo] + (idx - lo) * (sorted[hi] - sorted[lo])
}

/** Format a number using Indian comma notation (e.g. ₹2,98,450) */
function fmtIndian(n: number): string {
  const abs = Math.round(Math.abs(n))
  const sign = n < 0 ? '-' : ''
  const s = abs.toString()
  if (s.length <= 3) return `${sign}₹${s}`
  const last3 = s.slice(-3)
  const rest = s.slice(0, -3)
  const groups: string[] = []
  for (let i = rest.length; i > 0; i -= 2) groups.unshift(rest.slice(Math.max(0, i - 2), i))
  return `${sign}₹${groups.join(',')},${last3}`
}

interface MonthStats {
  n: number; q1: number; median: number; q3: number; mean: number
  iqr: number; minR: number; maxR: number; outliers: number
}

function computeMonthStats(values: number[]): MonthStats | null {
  const sorted = [...values].sort((a, b) => a - b)
  const n = sorted.length
  if (n === 0) return null
  const q1 = pctile(sorted, 25)
  const median = pctile(sorted, 50)
  const q3 = pctile(sorted, 75)
  const mean = sorted.reduce((s, v) => s + v, 0) / n
  const iqr = q3 - q1
  const lf = q1 - 1.5 * iqr
  const uf = q3 + 1.5 * iqr
  const minR = sorted.find(v => v >= lf) ?? sorted[0]
  const maxR = [...sorted].reverse().find(v => v <= uf) ?? sorted[n - 1]
  const outliers = sorted.filter(v => v < lf || v > uf).length
  return { n, q1, median, q3, mean, iqr, minR, maxR, outliers }
}

function buildBoxHover(month: string, stats: MonthStats | null): string {
  if (!stats) return `<b>${month}</b><extra></extra>`
  const skew = stats.mean > stats.median * 1.15
    ? 'Right-skewed: Mean > Median (large stores inflate average)'
    : stats.mean < stats.median * 0.85
      ? 'Left-skewed: Mean < Median'
      : 'Balanced: Mean ≈ Median (evenly distributed stores)'
  const wideIqr = stats.iqr > stats.median ? ' · Wide IQR — high variation across stores' : ''
  const outlierLine = stats.outliers > 0
    ? `Outliers in raw data: <b>${stats.outliers} Stores</b>`
    : 'No outliers detected'
  return [
    `<b>${month}</b>`,
    `<b>Store Coverage</b>`,
    `Total Stores: <b>${stats.n}</b>`,
    `<b>Distribution Statistics</b>`,
    `Min Revenue:    <b>${fmtIndian(stats.minR)}</b>`,
    `Q1 (25th pct):  <b>${fmtIndian(stats.q1)}</b>`,
    `Median Revenue: <b>${fmtIndian(stats.median)}</b>`,
    `Mean Revenue:   <b>${fmtIndian(stats.mean)}</b>`,
    `Q3 (75th pct):  <b>${fmtIndian(stats.q3)}</b>`,
    `Max Revenue:    <b>${fmtIndian(stats.maxR)}</b>`,
    `<b>Spread</b>`,
    `IQR: <b>${fmtIndian(stats.iqr)}</b>`,
    outlierLine,
    `<i>${skew}${wideIqr}</i>`,
  ].join('<br>') + '<extra></extra>'
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props { filters: FilterState }

export default function MonthlyRevenue({ filters }: Props) {
  const { stores, months } = useDataContext()

  // ── Filter ─────────────────────────────────────────────────────────────────
  const { fs, fm } = useMemo(() => {
    let fs = stores
    if (filters.state)    fs = fs.filter(s => s.state    === filters.state)
    if (filters.category) fs = fs.filter(s => s.category === filters.category)

    let fm = months
    if (filters.fromMonth) {
      const i = months.indexOf(filters.fromMonth); if (i >= 0) fm = fm.slice(i)
    }
    if (filters.toMonth) {
      const i = months.indexOf(filters.toMonth); if (i >= 0) fm = fm.slice(0, i + 1)
    }

    return { fs, fm }
  }, [stores, months, filters])

  const { earlyMonths: early, midMonths: mid, recentMonths: recent } = useMemo(() => allocatePhases(fm), [fm])

  const phaseOf = (m: string) => early.includes(m) ? 'early' : mid.includes(m) ? 'mid' : 'recent'

  // ── Per-month aggregates ───────────────────────────────────────────────────
  const monthlyData = useMemo(() => fm.map(m => {
    const rev    = fs.reduce((s, st) => s + (st.monthly_sales[m] ?? 0), 0)
    const active = fs.filter(st => (st.monthly_sales[m] ?? 0) > 0).length
    const phase  = phaseOf(m)
    return { m, rev, active, phase }
  }), [fs, fm, early, mid, recent]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── KPI metrics ────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    if (!monthlyData.length) return null

    const sorted  = [...monthlyData].sort((a, b) => b.rev - a.rev)
    const peak    = sorted[0]
    const trough  = sorted[sorted.length - 1]

    const avg = (phase: string) => {
      const rows = monthlyData.filter(d => d.phase === phase)
      return rows.length ? rows.reduce((s, d) => s + d.rev, 0) / rows.length : 0
    }
    const avgEarly  = avg('early')
    const avgMid    = avg('mid')
    const avgRecent = avg('recent')
    const runRatePct = avgEarly > 0 ? (avgRecent - avgEarly) / avgEarly * 100 : 0
    const midShiftPct = avgEarly > 0 && mid.length > 0 ? (avgMid - avgEarly) / avgEarly * 100 : null

    const firstActive  = monthlyData[0].active
    const lastActive   = monthlyData[monthlyData.length - 1].active
    const footprintPct = firstActive > 0 ? (lastActive - firstActive) / firstActive * 100 : 0

    return { peak, trough, avgEarly, avgMid, avgRecent, runRatePct, midShiftPct, firstActive, lastActive, footprintPct }
  }, [monthlyData, mid])

  // ── Macro chart — one trace per phase for legend + phase annotations ───────
  const macroTraces = useMemo(() => {
    const byPhase = (p: string) => monthlyData.filter(d => d.phase === p)
    const earlyD  = byPhase('early')
    const midD    = byPhase('mid')
    const recentD = byPhase('recent')

    const bar = (data: typeof monthlyData, phase: 'early' | 'mid' | 'recent', label: string) => ({
      type: 'bar' as const,
      name: label,
      x: data.map(d => d.m),
      y: data.map(d => d.rev),
      marker: { color: PHASE_COLOR[phase], opacity: 0.88 },
      yaxis: 'y' as const,
      hovertemplate: `<b>%{x}</b><br>Revenue: ₹%{y:,.0f}<extra>${label}</extra>`,
    })

    return [
      ...(earlyD.length ? [bar(earlyD, 'early', 'Early')] : []),
      ...(midD.length   ? [bar(midD,   'mid',   'Mid Phase')] : []),
      ...(recentD.length? [bar(recentD,'recent','Recent')] : []),
      {
        type: 'scatter' as const, mode: 'lines+markers' as const,
        name: 'Active stores', x: monthlyData.map(d => d.m), y: monthlyData.map(d => d.active),
        yaxis: 'y2' as const,
        line: { color: '#14b8a6', width: 2, shape: 'spline' as const }, marker: { color: '#14b8a6', size: 5 },
        hovertemplate: '<b>%{x}</b><br>Active stores: %{y}<extra></extra>',
      },
    ]
  }, [monthlyData])

  // Phase label annotations for the bar chart
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

  // ── Box-plot y-axis with Indian number formatting ──────────────────────────
  const boxYAxis = useMemo(() => {
    const allVals = fm.flatMap(m => fs.map(s => s.monthly_sales[m] ?? 0))
    const maxVal = allVals.length > 0 ? Math.max(...allVals) : 0
    if (maxVal === 0) return { ...PT_AXIS, title: { text: 'Store Revenue' } }
    const rough = maxVal / 5
    const exp = Math.pow(10, Math.floor(Math.log10(rough)))
    const norm = rough / exp
    const step = (norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10) * exp
    const tickvals: number[] = []
    for (let t = 0; t <= maxVal * 1.05; t += step) tickvals.push(Math.round(t))
    return {
      ...PT_AXIS,
      title: { text: 'Store Revenue' },
      tickmode: 'array' as const,
      tickvals,
      ticktext: tickvals.map(fmtIndian),
    }
  }, [fs, fm])

  // ── Box-plot traces ────────────────────────────────────────────────────────
  const boxTraces = useMemo(() => {
    const traces: object[] = fm.map((month, i) => {
      const values = fs.map(s => s.monthly_sales[month] ?? 0)
      const stats = computeMonthStats(values)
      const color = STATE_PALETTE[i % STATE_PALETTE.length]
      return {
        type: 'box' as const,
        y: values,
        name: month,
        boxpoints: false as const,
        marker: { color },
        line: { color, width: 2 },
        fillcolor: `${color}3a`,
        hovertemplate: buildBoxHover(month, stats),
      }
    })

    // Mean diamond markers as a separate scatter trace
    const means = fm.map(m => {
      const vals = fs.map(s => s.monthly_sales[m] ?? 0)
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0
    })
    traces.push({
      type: 'scatter' as const,
      mode: 'markers' as const,
      name: 'Mean',
      x: fm,
      y: means,
      marker: { symbol: 'diamond', size: 8, color: '#f59e0b', line: { width: 2, color: '#b45309' } },
      hoverinfo: 'skip' as const,
      showlegend: true,
    })

    return traces
  }, [fs, fm])

  // PT_AXIS is imported from @/lib/plotlyTheme — shared axis style

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

      {/* ── Monthly Revenue Trend ── */}
      <motion.div {...panelSpring(0.12)} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-2 flex-wrap mb-1">
          <div>
            <h3 className="text-sm font-semibold text-gray-800">Monthly Revenue Trend</h3>
            <p className="text-[11px] text-gray-500 mt-0.5">
              Bars = revenue by phase
              {mid.length > 0 ? <> · <span style={{ color: PHASE_COLOR.mid }}>■</span> <span className="text-indigo-500">{mid[0]}{mid.length > 1 ? `–${mid[mid.length - 1]}` : ''}</span> = mid phase</> : null}
              {' '}· Line = active store count
            </p>
          </div>
          {kpis?.runRatePct != null && (
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
            paper_bgcolor: 'rgba(0,0,0,0)',
            plot_bgcolor:  'rgba(0,0,0,0)',
            font:    { color: PT.font, family: 'Inter, sans-serif', size: 11 },
            barmode: 'overlay' as const,
            legend:  {
              bgcolor: 'rgba(0,0,0,0)',
              font: { color: PT.font, size: 10 },
              orientation: 'h' as const,
              y: -0.22,
            },
            xaxis:  { ...PT_AXIS },
            yaxis:  { ...PT_AXIS, title: { text: 'Revenue (₹)' }, tickformat: ',.2s' },
            yaxis2: {
              ...PT_AXIS,
              title: { text: 'Active Stores' },
              overlaying: 'y' as const,
              side: 'right' as const,
              showgrid: false,
            },
            annotations: phaseAnnotations as any[],
            margin: { l: 70, r: 70, t: 36, b: 110 },
            height: 420,
          }}
          config={{ displayModeBar: false, responsive: true }}
          style={{ width: '100%' }}
        />

        {/* ── Insight cards ── */}
        {kpis && (
          <div className="mt-4 border-t border-gray-100 pt-4">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-3">
              Story so far
            </p>
            <div className={cn('grid grid-cols-1 gap-3', mid.length > 0 ? 'sm:grid-cols-4' : 'sm:grid-cols-3')}>

              {/* Peak & Trough */}
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 mb-1.5">Peak &amp; Trough</p>
                <p className="text-[11px] text-gray-700 leading-relaxed">
                  Best month: <span className="text-gray-900 font-semibold">{kpis.peak.m}</span> ({fmtInr(kpis.peak.rev)}).
                  Weakest: <span className="text-gray-900 font-semibold">{kpis.trough.m}</span> ({fmtInr(kpis.trough.rev)}).
                </p>
              </div>

              {/* Mid Phase — only when mid has months */}
              {mid.length > 0 && kpis.midShiftPct != null && (
                <div className="rounded-lg border border-indigo-100 bg-indigo-50 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-indigo-500 mb-1.5">Mid Phase ({mid[0]}{mid.length > 1 ? `–${mid[mid.length - 1]}` : ''})</p>
                  <p className="text-[11px] text-gray-700 leading-relaxed">
                    Mid phase averaged <span className="text-gray-900 font-semibold">{fmtInr(kpis.avgMid)}</span>,
                    a <span className={cn('font-semibold', kpis.midShiftPct >= 0 ? 'text-emerald-600' : 'text-red-600')}>{fmtPct(kpis.midShiftPct)}</span> shift from early baseline.
                  </p>
                </div>
              )}

              {/* Early → Recent Run-Rate Shift */}
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 mb-1.5">Run-Rate Shift</p>
                <p className="text-[11px] text-gray-700 leading-relaxed">
                  Early avg <span className="text-gray-900 font-semibold">{fmtInr(kpis.avgEarly)}/mo</span> →
                  Recent avg <span className="text-gray-900 font-semibold">{fmtInr(kpis.avgRecent)}/mo</span> —
                  a <span className={cn('font-semibold', kpis.runRatePct >= 0 ? 'text-emerald-600' : 'text-red-600')}>{fmtPct(kpis.runRatePct)}</span> change.
                </p>
              </div>

              {/* Active-Store Footprint */}
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
        <h3 className="text-sm font-semibold text-gray-800">Store Revenue Distribution by Month</h3>
        <p className="text-[11px] text-gray-500 mt-0.5 mb-3">
          Box plot showing how revenues spread across individual stores each month — outlier-free view of the core distribution
        </p>
        <Plot
          data={boxTraces as any}
          layout={{
            paper_bgcolor: 'rgba(0,0,0,0)',
            plot_bgcolor:  'rgba(0,0,0,0)',
            font:       { color: PT.font, family: 'Inter, sans-serif', size: 11 },
            showlegend: true,
            legend: {
              bgcolor: 'rgba(0,0,0,0)',
              font: { color: PT.font, size: 10 },
              orientation: 'h' as const,
              y: -0.22,
              x: 0.5,
              xanchor: 'center' as const,
            },
            xaxis: { ...PT_AXIS },
            yaxis: boxYAxis,
            margin: { l: 90, r: 16, t: 12, b: 90 },
            height: 360,
            hoverlabel: {
              bgcolor: '#ffffff',
              bordercolor: '#e5e7eb',
              font: { size: 12, family: 'Inter, sans-serif', color: '#374151' },
            },
          }}
          config={{ displayModeBar: false, responsive: true }}
          style={{ width: '100%' }}
        />
        {/* Interpretation footer */}
        <div className="mt-2 rounded-lg bg-gray-50 border border-gray-100 px-3 py-2 text-[10px] text-gray-500 leading-relaxed">
          <span className="font-semibold text-gray-600">How to read: </span>
          Box = middle 50% of stores (Q1–Q3) &nbsp;·&nbsp;
          Line inside box = Median Revenue &nbsp;·&nbsp;
          <span className="font-semibold text-amber-500">♦</span> = Mean Revenue &nbsp;·&nbsp;
          Whiskers = Min &amp; Max Revenue (excluding outliers)
        </div>
      </motion.div>

    </div>
  )
}
