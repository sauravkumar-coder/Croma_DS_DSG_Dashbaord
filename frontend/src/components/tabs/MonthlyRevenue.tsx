import { useMemo } from 'react'
import { motion } from 'framer-motion'
import createPlotlyComponent from 'react-plotly.js/factory'
// @ts-ignore — plotly.js-dist-min does not ship its own .d.ts
import Plotly from 'plotly.js-dist-min'
import { useDataContext } from '@/contexts/DataContext'
import type { FilterState } from '@/hooks/useFilters'
import { cn } from '@/lib/utils'
import { allocatePhases } from '@/lib/classificationEngine'
import { fmtInr, fmtInrFull, fmtPct } from '@/lib/formatting'
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


interface MonthStats {
  n: number; q1: number; median: number; q3: number; mean: number
  iqr: number; minR: number; maxR: number; outliers: number
}

interface OutlierRow {
  storeId: string
  storeName: string
  state: string
  month: string
  revenue: number
  type: 'High Outlier' | 'Low Outlier'
  fence: number
  distance: number
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
    `Min Revenue:    <b>${fmtInrFull(stats.minR)}</b>`,
    `Q1 (25th pct):  <b>${fmtInrFull(stats.q1)}</b>`,
    `Median Revenue: <b>${fmtInrFull(stats.median)}</b>`,
    `Mean Revenue:   <b>${fmtInrFull(stats.mean)}</b>`,
    `Q3 (75th pct):  <b>${fmtInrFull(stats.q3)}</b>`,
    `Max Revenue:    <b>${fmtInrFull(stats.maxR)}</b>`,
    `<b>Spread</b>`,
    `IQR: <b>${fmtInrFull(stats.iqr)}</b>`,
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

  // ── Box-plot y-axis — active stores only, log scale when outliers are extreme ─
  const { boxYAxis, boxScaleIsLog } = useMemo(() => {
    const allActive = fm.flatMap(m => fs.map(s => s.monthly_sales[m] ?? 0).filter(v => v > 0))
    const fallback = { boxYAxis: { ...PT_AXIS, title: { text: 'Store Revenue' } }, boxScaleIsLog: false }
    if (!allActive.length) return fallback

    const sorted = [...allActive].sort((a, b) => a - b)
    const q1  = pctile(sorted, 25)
    const q3  = pctile(sorted, 75)
    const iqr = q3 - q1
    const uf  = q3 + 1.5 * iqr
    const maxVal = sorted[sorted.length - 1]

    // Switch to log scale when the max is more than 6× the upper fence
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

    // Linear scale based on active-store range
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
  }, [fs, fm])

  // ── Per-month outlier detection (active stores only) ─────────────────────
  const outlierData = useMemo((): OutlierRow[] => {
    const rows: OutlierRow[] = []
    for (const month of fm) {
      // Exclude inactive stores (revenue = 0) so the IQR reflects genuine revenue spread
      const revs = fs.map(s => s.monthly_sales[month] ?? 0).filter(v => v > 0).sort((a, b) => a - b)
      if (revs.length < 4) continue
      const q1 = pctile(revs, 25)
      const q3 = pctile(revs, 75)
      const iqr = q3 - q1
      const lf = q1 - 1.5 * iqr
      const uf = q3 + 1.5 * iqr
      for (const store of fs) {
        const rev = store.monthly_sales[month] ?? 0
        if (rev > uf) {
          rows.push({
            storeId: store.store_id,
            storeName: store.store_name ?? store.store_id,
            state: store.state ?? '—',
            month,
            revenue: rev,
            type: 'High Outlier',
            fence: uf,
            distance: rev - uf,
          })
        } else if (rev < lf) {
          rows.push({
            storeId: store.store_id,
            storeName: store.store_name ?? store.store_id,
            state: store.state ?? '—',
            month,
            revenue: rev,
            type: 'Low Outlier',
            fence: lf,
            distance: lf - rev,
          })
        }
      }
    }
    return rows
  }, [fs, fm])

  // ── Outlier summary KPIs ──────────────────────────────────────────────────
  const outliersKpi = useMemo(() => {
    const total = outlierData.length
    const high  = outlierData.filter(o => o.type === 'High Outlier').length
    const low   = total - high
    const topOutlier = outlierData.reduce<OutlierRow | null>(
      (best, o) => (!best || o.revenue > best.revenue) ? o : best,
      null,
    )
    return { total, high, low, topOutlier }
  }, [outlierData])

  // ── Box-plot traces (active stores only) ──────────────────────────────────
  const boxTraces = useMemo(() => {
    // Only plot active stores — zeros bias Q1 to 0, collapsing the lower distribution
    const traces: object[] = fm.flatMap((month, i) => {
      const values = fs.map(s => s.monthly_sales[month] ?? 0).filter(v => v > 0)
      if (values.length === 0) return []
      const stats = computeMonthStats(values)
      const color = STATE_PALETTE[i % STATE_PALETTE.length]
      return [{
        type: 'box' as const,
        y: values,
        name: month,
        boxpoints: false as const,
        marker: { color },
        line: { color, width: 2 },
        fillcolor: `${color}3a`,
        hovertemplate: buildBoxHover(month, stats),
      }]
    })

    // Mean diamonds — active stores only, skip months with no active stores
    const meanPoints = fm.flatMap(m => {
      const vals = fs.map(s => s.monthly_sales[m] ?? 0).filter(v => v > 0)
      if (!vals.length) return []
      return [{ x: m, y: vals.reduce((a, b) => a + b, 0) / vals.length }]
    })
    if (meanPoints.length > 0) {
      traces.push({
        type: 'scatter' as const,
        mode: 'markers' as const,
        name: 'Mean',
        x: meanPoints.map(p => p.x),
        y: meanPoints.map(p => p.y),
        marker: { symbol: 'diamond', size: 8, color: '#f59e0b', line: { width: 2, color: '#b45309' } },
        hoverinfo: 'skip' as const,
        showlegend: true,
      })
    }

    // High outlier scatter overlay
    const highOuts = outlierData.filter(o => o.type === 'High Outlier')
    if (highOuts.length > 0) {
      traces.push({
        type: 'scatter' as const,
        mode: 'markers' as const,
        name: 'High Outlier',
        x: highOuts.map(o => o.month),
        y: highOuts.map(o => o.revenue),
        customdata: highOuts.map(o => [o.storeName, o.state, o.storeId, fmtInrFull(o.distance)]),
        marker: { symbol: 'circle', size: 9, color: '#ef4444', opacity: 0.9, line: { width: 1.5, color: '#b91c1c' } },
        hovertemplate: [
          '<b>%{customdata[0]}</b>',
          'Store Code: %{customdata[2]}',
          'State: %{customdata[1]}',
          'Month: %{x}',
          'Revenue: <b>₹%{y:,.0f}</b>',
          'Above upper fence by: <b>%{customdata[3]}</b>',
          '<i>▲ High Outlier</i>',
        ].join('<br>') + '<extra></extra>',
        showlegend: true,
      })
    }

    // Low outlier scatter overlay
    const lowOuts = outlierData.filter(o => o.type === 'Low Outlier')
    if (lowOuts.length > 0) {
      traces.push({
        type: 'scatter' as const,
        mode: 'markers' as const,
        name: 'Low Outlier',
        x: lowOuts.map(o => o.month),
        y: lowOuts.map(o => o.revenue),
        customdata: lowOuts.map(o => [o.storeName, o.state, o.storeId, fmtInrFull(o.distance)]),
        marker: { symbol: 'triangle-down', size: 9, color: '#f97316', opacity: 0.9, line: { width: 1.5, color: '#c2410c' } },
        hovertemplate: [
          '<b>%{customdata[0]}</b>',
          'Store Code: %{customdata[2]}',
          'State: %{customdata[1]}',
          'Month: %{x}',
          'Revenue: <b>₹%{y:,.0f}</b>',
          'Below lower fence by: <b>%{customdata[3]}</b>',
          '<i>▼ Low Outlier</i>',
        ].join('<br>') + '<extra></extra>',
        showlegend: true,
      })
    }

    return traces
  }, [fs, fm, outlierData])

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
          Revenue spread across active stores each month. IQR outlier fences: Q1 − 1.5×IQR (low) and Q3 + 1.5×IQR (high).
          {boxScaleIsLog ? ' Log scale — extreme outliers detected.' : ''}
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
            margin: { l: 90, r: 16, t: 12, b: 100 },
            height: 460,
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
          Active stores only (inactive excluded) &nbsp;·&nbsp;
          Box = Q1–Q3 &nbsp;·&nbsp;
          Line = Median &nbsp;·&nbsp;
          <span className="font-semibold text-amber-500">♦</span> = Mean &nbsp;·&nbsp;
          Whiskers = non-outlier min/max &nbsp;·&nbsp;
          <span className="font-semibold text-red-500">● High Outlier</span> &nbsp;·&nbsp;
          <span className="font-semibold text-orange-500">▼ Low Outlier</span>
          {boxScaleIsLog && (
            <span className="ml-2 font-semibold text-indigo-500">· Log scale active (extreme outliers detected)</span>
          )}
        </div>

        {/* ── Outlier summary cards ── */}
        {outliersKpi.total > 0 && (
          <div className="mt-4 border-t border-gray-100 pt-4">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-3">
              Outlier Summary
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 mb-1">Total Outlier Stores</p>
                <p className="text-2xl font-bold text-gray-800">{outliersKpi.total}</p>
              </div>
              <div className="rounded-lg border border-red-100 bg-red-50 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-red-500 mb-1">High Outliers</p>
                <p className="text-2xl font-bold text-red-700">{outliersKpi.high}</p>
              </div>
              <div className="rounded-lg border border-orange-100 bg-orange-50 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-orange-500 mb-1">Low Outliers</p>
                <p className="text-2xl font-bold text-orange-700">{outliersKpi.low}</p>
              </div>
              {outliersKpi.topOutlier && (
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 mb-1">Highest Revenue Outlier</p>
                  <p className="text-xs font-semibold text-gray-800 truncate" title={outliersKpi.topOutlier.storeName}>
                    {outliersKpi.topOutlier.storeName}
                  </p>
                  <p className="text-[11px] text-gray-600 mt-0.5">
                    {fmtInr(outliersKpi.topOutlier.revenue)} · {outliersKpi.topOutlier.month}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </motion.div>

      {/* ── Outlier Stores Table ── */}
      {outlierData.length > 0 && (
        <motion.div {...panelSpring(0.30)} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-800 mb-0.5">Outlier Stores</h3>
          <p className="text-[11px] text-gray-500 mb-3">
            Stores whose monthly revenue falls outside Q1 − 1.5×IQR (low) or Q3 + 1.5×IQR (high) for that month.
            Updates dynamically with all active filters and date ranges.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] text-gray-700 border-collapse">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left px-3 py-2 font-semibold text-gray-600 whitespace-nowrap">Store Name</th>
                  <th className="text-left px-3 py-2 font-semibold text-gray-600 whitespace-nowrap">Store Code</th>
                  <th className="text-left px-3 py-2 font-semibold text-gray-600 whitespace-nowrap">State</th>
                  <th className="text-left px-3 py-2 font-semibold text-gray-600 whitespace-nowrap">Month</th>
                  <th className="text-right px-3 py-2 font-semibold text-gray-600 whitespace-nowrap">Revenue</th>
                  <th className="text-center px-3 py-2 font-semibold text-gray-600 whitespace-nowrap">Outlier Type</th>
                  <th className="text-right px-3 py-2 font-semibold text-gray-600 whitespace-nowrap">Distance from Bound</th>
                </tr>
              </thead>
              <tbody>
                {outlierData.map((row, i) => (
                  <tr
                    key={`${row.storeId}-${row.month}`}
                    className={cn('border-b border-gray-100', i % 2 === 0 ? 'bg-white' : 'bg-gray-50/60')}
                  >
                    <td className="px-3 py-2 font-medium text-gray-800 max-w-[180px] truncate" title={row.storeName}>
                      {row.storeName}
                    </td>
                    <td className="px-3 py-2 text-gray-500 font-mono">{row.storeId}</td>
                    <td className="px-3 py-2">{row.state}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{row.month}</td>
                    <td className="px-3 py-2 text-right font-medium">{fmtInrFull(row.revenue)}</td>
                    <td className="px-3 py-2 text-center">
                      <span className={cn(
                        'px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap',
                        row.type === 'High Outlier'
                          ? 'bg-red-100 text-red-700'
                          : 'bg-orange-100 text-orange-700',
                      )}>
                        {row.type === 'High Outlier' ? '▲ High Outlier' : '▼ Low Outlier'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right text-gray-600 whitespace-nowrap">{fmtInrFull(row.distance)}</td>
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
