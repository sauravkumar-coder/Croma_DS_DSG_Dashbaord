import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  TrendingUp,
  Store as StoreIcon,
  Target,
  Activity,
  AlertTriangle,
} from 'lucide-react'
// eslint-disable-next-line @typescript-eslint/no-require-imports
import createPlotlyComponent from 'react-plotly.js/factory'
// @ts-ignore
import Plotly from 'plotly.js-dist-min'
import { useDataContext } from '@/contexts/DataContext'
import type { FilterState } from '@/hooks/useFilters'
import { cn } from '@/lib/utils'
import { fmtPct, plotlyInrTickVals } from '@/lib/formatting'
import { kpiContainer, kpiItem, panelSpring } from '@/lib/animations'
import { PLOTLY_BASE, PT_AXIS, PT } from '@/lib/plotlyTheme'
import type { StoreRecord } from '@/lib/api'

const Plot = createPlotlyComponent(Plotly)

// ── Constants ──────────────────────────────────────────────────────────────────
const ATTACH_GOOD   = 0.20  // ≥ 20% = good (green)
const ATTACH_MED    = 0.10  // 10-20% = medium (amber)
// < 10% = poor (red)

type SortKey = 'name' | 'state' | 'attach' | 'plans' | 'devices' | 'mom'

interface StoreAttachRow {
  store: StoreRecord
  attach: number      // current month attach %
  plans: number       // current month plans sold
  devices: number     // current month device units
  prevAttach: number  // prior month attach %
  mom: number         // MoM change in pp
}

function attachColor(pct: number): string {
  if (pct >= ATTACH_GOOD) return '#10b981'
  if (pct >= ATTACH_MED)  return '#f59e0b'
  return '#ef4444'
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function AttachPerformance({ filters }: { filters: FilterState }) {
  const { stores, months } = useDataContext()

  // ── Active months (respecting global from/to filters) ─────────────────────
  const fm = useMemo(() => {
    let m = months
    if (filters.fromMonth) {
      const i = months.indexOf(filters.fromMonth)
      if (i >= 0) m = m.slice(i)
    }
    if (filters.toMonth) {
      const i = months.indexOf(filters.toMonth)
      if (i >= 0) m = m.slice(0, i + 1)
    }
    return m
  }, [months, filters])

  // ── Filtered stores ────────────────────────────────────────────────────────
  const filteredStores = useMemo(() => {
    let s = stores
    if (filters.state)        s = s.filter(st => st.state === filters.state)
    if (filters.planCategory) s = s.filter(st =>
      !st.category || st.category.toLowerCase().includes(filters.planCategory.toLowerCase())
    )
    return s
  }, [stores, filters.state, filters.planCategory])

  // ── Primary month ─────────────────────────────────────────────────────────
  const primaryMonth = useMemo(() => {
    return filters.targetMonth || fm[fm.length - 1] || ''
  }, [filters.targetMonth, fm])

  const prevMonth = useMemo(() => {
    const idx = fm.indexOf(primaryMonth)
    return idx > 0 ? fm[idx - 1] : null
  }, [fm, primaryMonth])

  // ── Trend months (last 6) ─────────────────────────────────────────────────
  const trendMonths = useMemo(() => fm.slice(Math.max(0, fm.length - 6)), [fm])

  // ── Per-store attach rows ──────────────────────────────────────────────────
  const storeRows = useMemo<StoreAttachRow[]>(() => {
    return filteredStores.map(st => {
      const plans   = st.monthly_plans_count?.[primaryMonth] || 0
      const devices = st.monthly_main_qty?.[primaryMonth]   || 0
      const attach  = devices > 0 ? plans / devices : 0
      const pPlans   = st.monthly_plans_count?.[prevMonth ?? ''] || 0
      const pDevices = st.monthly_main_qty?.[prevMonth ?? '']   || 0
      const prevAttach = pDevices > 0 ? pPlans / pDevices : 0
      return { store: st, attach, plans, devices, prevAttach, mom: attach - prevAttach }
    })
  }, [filteredStores, primaryMonth, prevMonth])

  // ── National KPIs ─────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const totalPlans   = storeRows.reduce((a, r) => a + r.plans, 0)
    const totalDevices = storeRows.reduce((a, r) => a + r.devices, 0)
    const overallAttach = totalDevices > 0 ? totalPlans / totalDevices : 0
    const goodCount = storeRows.filter(r => r.attach >= ATTACH_GOOD).length
    const poorCount = storeRows.filter(r => r.attach < ATTACH_MED && r.devices > 0).length
    return { totalPlans, totalDevices, overallAttach, goodCount, poorCount, total: storeRows.length }
  }, [storeRows])

  // ── MoM trend data ─────────────────────────────────────────────────────────
  const trendData = useMemo(() => {
    return trendMonths.map(m => {
      const plans   = filteredStores.reduce((a, st) => a + (st.monthly_plans_count?.[m] || 0), 0)
      const devices = filteredStores.reduce((a, st) => a + (st.monthly_main_qty?.[m]   || 0), 0)
      return { month: m, attach: devices > 0 ? plans / devices : 0, plans, devices }
    })
  }, [filteredStores, trendMonths])

  const momData = useMemo(() => {
    return trendData.map((d, i) => ({
      ...d,
      mom: i === 0 ? 0 : d.attach - trendData[i - 1].attach,
    }))
  }, [trendData])

  // ── State-level aggregates ─────────────────────────────────────────────────
  const stateAggs = useMemo(() => {
    const map: Record<string, { plans: number; devices: number }> = {}
    for (const r of storeRows) {
      const s = r.store.state || 'Unknown'
      if (!map[s]) map[s] = { plans: 0, devices: 0 }
      map[s].plans   += r.plans
      map[s].devices += r.devices
    }
    return Object.entries(map)
      .map(([state, d]) => ({
        state,
        attach: d.devices > 0 ? d.plans / d.devices : 0,
        plans: d.plans,
        devices: d.devices,
      }))
      .sort((a, b) => b.attach - a.attach)
  }, [storeRows])

  // ── Table state ────────────────────────────────────────────────────────────
  const [search, setSearch]       = useState('')
  const [sortKey, setSortKey]     = useState<SortKey>('attach')
  const [sortDir, setSortDir]     = useState<'asc' | 'desc'>('desc')
  const [page, setPage]           = useState(1)
  const PAGE_SIZE = 15

  const filteredRows = useMemo(() => {
    let rows = [...storeRows]
    const q = search.toLowerCase().trim()
    if (q) rows = rows.filter(r =>
      (r.store.store_name || '').toLowerCase().includes(q) ||
      (r.store.state || '').toLowerCase().includes(q)
    )
    rows.sort((a, b) => {
      let d = 0
      switch (sortKey) {
        case 'name':    d = (a.store.store_name || '').localeCompare(b.store.store_name || ''); break
        case 'state':   d = (a.store.state || '').localeCompare(b.store.state || ''); break
        case 'attach':  d = a.attach - b.attach; break
        case 'plans':   d = a.plans - b.plans; break
        case 'devices': d = a.devices - b.devices; break
        case 'mom':     d = a.mom - b.mom; break
      }
      return sortDir === 'asc' ? d : -d
    })
    return rows
  }, [storeRows, search, sortKey, sortDir])

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE))
  const pagedRows  = filteredRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const toggleSort = (col: SortKey) => {
    if (sortKey === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(col); setSortDir('desc') }
  }
  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <span className="opacity-30 ml-0.5">↕</span>
    return <span className="ml-0.5">{sortDir === 'asc' ? '↑' : '↓'}</span>
  }

  // ── Scatter data ───────────────────────────────────────────────────────────
  const scatterData = useMemo(() => {
    const activeRows = storeRows.filter(r => r.devices > 0)
    const buckets = [
      { label: '≥ 20% (Good)',   color: '#10b981', rows: activeRows.filter(r => r.attach >= ATTACH_GOOD) },
      { label: '10–20% (Medium)', color: '#f59e0b', rows: activeRows.filter(r => r.attach >= ATTACH_MED && r.attach < ATTACH_GOOD) },
      { label: '< 10% (Poor)',   color: '#ef4444', rows: activeRows.filter(r => r.attach < ATTACH_MED) },
    ]
    return buckets.map(bk => ({
      type: 'scatter' as const,
      mode: 'markers' as const,
      name: bk.label,
      x: bk.rows.map(r => r.plans),
      y: bk.rows.map(r => +(r.attach * 100).toFixed(1)),
      text: bk.rows.map(r => r.store.store_name || r.store.store_id),
      customdata: bk.rows.map(r => [
        r.store.store_name || r.store.store_id,
        (r.attach * 100).toFixed(1),
        r.plans,
        r.devices,
        r.store.state || '—',
      ]),
      marker: {
        color: bk.color,
        size: bk.rows.map(r => Math.min(30, Math.max(6, Math.sqrt(r.devices) * 1.4))),
        opacity: 0.75,
        line: { color: '#ffffff', width: 0.8 },
      },
      hovertemplate:
        '<b>%{customdata[0]}</b><br>' +
        'State: %{customdata[4]}<br>' +
        'Attach: %{customdata[1]}%<br>' +
        'Plans Sold: %{customdata[2]}<br>' +
        'Devices Sold: %{customdata[3]}<extra></extra>',
    }))
  }, [storeRows])

  const maxPlans = useMemo(() => Math.max(1, ...storeRows.map(r => r.plans)), [storeRows])

  if (!primaryMonth) {
    return <div className="p-8 text-center text-gray-400">No data loaded yet.</div>
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">

      {/* ── KPI Row ────────────────────────────────────────────────────────── */}
      <motion.div
        variants={kpiContainer}
        initial="hidden"
        animate="show"
        className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3"
      >

        {/* Overall Attach % */}
        <motion.div variants={kpiItem} className="rounded-xl bg-white border border-gray-100 shadow-sm p-4 flex flex-col gap-1">
          <div className="flex items-center gap-1.5">
            <div className="p-1.5 rounded-lg bg-blue-50 text-blue-600"><Activity className="h-3.5 w-3.5" /></div>
            <p className="text-[10px] font-medium uppercase tracking-widest text-gray-500">Overall Attach %</p>
          </div>
          <p className={cn('text-2xl font-bold tabular-nums mt-1', kpis.overallAttach >= ATTACH_GOOD ? 'text-emerald-600' : kpis.overallAttach >= ATTACH_MED ? 'text-amber-600' : 'text-red-600')}>
            {(kpis.overallAttach * 100).toFixed(1)}%
          </p>
          <p className="text-[10px] text-gray-400">{primaryMonth}</p>
        </motion.div>

        {/* Plans Sold */}
        <motion.div variants={kpiItem} className="rounded-xl bg-white border border-gray-100 shadow-sm p-4 flex flex-col gap-1">
          <div className="flex items-center gap-1.5">
            <div className="p-1.5 rounded-lg bg-indigo-50 text-indigo-600"><TrendingUp className="h-3.5 w-3.5" /></div>
            <p className="text-[10px] font-medium uppercase tracking-widest text-gray-500">Plans Sold</p>
          </div>
          <p className="text-2xl font-bold tabular-nums mt-1 text-gray-900">{kpis.totalPlans.toLocaleString('en-IN')}</p>
          <p className="text-[10px] text-gray-400">units</p>
        </motion.div>

        {/* Devices Sold */}
        <motion.div variants={kpiItem} className="rounded-xl bg-white border border-gray-100 shadow-sm p-4 flex flex-col gap-1">
          <div className="flex items-center gap-1.5">
            <div className="p-1.5 rounded-lg bg-purple-50 text-purple-600"><StoreIcon className="h-3.5 w-3.5" /></div>
            <p className="text-[10px] font-medium uppercase tracking-widest text-gray-500">Devices Sold</p>
          </div>
          <p className="text-2xl font-bold tabular-nums mt-1 text-gray-900">{kpis.totalDevices.toLocaleString('en-IN')}</p>
          <p className="text-[10px] text-gray-400">Samsung units</p>
        </motion.div>

        {/* Stores ≥ 20% */}
        <motion.div variants={kpiItem} className="rounded-xl bg-white border border-gray-100 shadow-sm p-4 flex flex-col gap-1">
          <div className="flex items-center gap-1.5">
            <div className="p-1.5 rounded-lg bg-emerald-50 text-emerald-600"><Target className="h-3.5 w-3.5" /></div>
            <p className="text-[10px] font-medium uppercase tracking-widest text-gray-500">Stores ≥ 20%</p>
          </div>
          <p className="text-2xl font-bold tabular-nums mt-1 text-emerald-600">{kpis.goodCount}</p>
          <p className="text-[10px] text-gray-400">of {kpis.total} stores</p>
        </motion.div>

        {/* Stores < 10% */}
        <motion.div variants={kpiItem} className="rounded-xl bg-white border border-gray-100 shadow-sm p-4 flex flex-col gap-1">
          <div className="flex items-center gap-1.5">
            <div className="p-1.5 rounded-lg bg-red-50 text-red-600"><AlertTriangle className="h-3.5 w-3.5" /></div>
            <p className="text-[10px] font-medium uppercase tracking-widest text-gray-500">Stores &lt; 10%</p>
          </div>
          <p className="text-2xl font-bold tabular-nums mt-1 text-red-600">{kpis.poorCount}</p>
          <p className="text-[10px] text-gray-400">need attention</p>
        </motion.div>

      </motion.div>

      {/* ── Charts Row 1: MoM Trend + Monthly Movement ─────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* MoM Attach Lift/Drop */}
        <motion.div {...panelSpring()} id="month-on-month-attach-lift-or-drop" className="rounded-xl bg-white border border-gray-100 p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-900">Month-on-Month Attach % Lift or Drop</h3>
          <p className="text-[11px] text-gray-500 mt-0.5 mb-3">MoM change (bars) vs rolling attach % (line) · Dual axis</p>
          <Plot
            data={[
              {
                type: 'bar',
                name: 'MoM Change (pp)',
                x: momData.map(d => d.month),
                y: momData.map(d => +(d.mom * 100).toFixed(2)),
                marker: { color: momData.map(d => d.mom >= 0 ? '#10b981' : '#ef4444'), opacity: 0.8 },
                hovertemplate: '<b>%{x}</b><br>MoM Change: %{y:+.2f} pp<extra></extra>',
                yaxis: 'y',
              },
              {
                type: 'scatter',
                mode: 'lines+markers',
                name: 'Attach %',
                x: momData.map(d => d.month),
                y: momData.map(d => +(d.attach * 100).toFixed(1)),
                line: { color: '#3b82f6', width: 2.5, dash: 'solid' as const },
                marker: { size: 6, color: '#3b82f6' },
                hovertemplate: '<b>%{x}</b><br>Attach: %{y:.1f}%<extra></extra>',
                yaxis: 'y2',
              },
            ]}
            layout={{
              ...PLOTLY_BASE,
              height: 280,
              margin: { l: 50, r: 55, t: 8, b: 50 },
              xaxis: { ...PT_AXIS },
              yaxis:  { ...PT_AXIS, title: { text: 'MoM Change (pp)' }, zeroline: true, zerolinecolor: PT.line },
              yaxis2: { ...PT_AXIS, title: { text: 'Attach %' }, overlaying: 'y' as const, side: 'right' as const, ticksuffix: '%', showgrid: false },
              legend: { bgcolor: 'rgba(0,0,0,0)', font: { color: PT.font, size: 10 }, orientation: 'h' as const, y: -0.22 },
            }}
            config={{ displayModeBar: false, responsive: true }}
            style={{ width: '100%' }}
          />
        </motion.div>

        {/* Monthly Plan Units + Attach % */}
        <motion.div {...panelSpring(0.05)} id="monthly-plan-units-attach-pct" className="rounded-xl bg-white border border-gray-100 p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-900">Monthly Plan Units + Attach %</h3>
          <p className="text-[11px] text-gray-500 mt-0.5 mb-3">Bars = plan units sold · Line = attach % on right axis</p>
          <Plot
            data={[
              {
                type: 'bar',
                name: 'Plan Units',
                x: trendData.map(d => d.month),
                y: trendData.map(d => d.plans),
                marker: { color: '#818cf8', opacity: 0.85 },
                hovertemplate: '<b>%{x}</b><br>Plans: %{y}<extra></extra>',
                yaxis: 'y',
              },
              {
                type: 'scatter',
                mode: 'lines+markers',
                name: 'Attach %',
                x: trendData.map(d => d.month),
                y: trendData.map(d => +(d.attach * 100).toFixed(1)),
                line: { color: '#10b981', width: 2.5 },
                marker: { size: 6, color: '#10b981' },
                hovertemplate: '<b>%{x}</b><br>Attach: %{y:.1f}%<extra></extra>',
                yaxis: 'y2',
              },
            ]}
            layout={{
              ...PLOTLY_BASE,
              height: 280,
              margin: { l: 50, r: 55, t: 8, b: 50 },
              xaxis: { ...PT_AXIS },
              yaxis:  { ...PT_AXIS, title: { text: 'Plan Units' }, ...plotlyInrTickVals(Math.max(1, ...trendData.map(d => d.plans)) * 1.15, 5) },
              yaxis2: { ...PT_AXIS, title: { text: 'Attach %' }, overlaying: 'y' as const, side: 'right' as const, ticksuffix: '%', showgrid: false },
              legend: { bgcolor: 'rgba(0,0,0,0)', font: { color: PT.font, size: 10 }, orientation: 'h' as const, y: -0.22 },
            }}
            config={{ displayModeBar: false, responsive: true }}
            style={{ width: '100%' }}
          />
        </motion.div>

      </div>

      {/* ── Row 2: State Bar Chart + Scatter ──────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* State-level attach % bar chart */}
        <motion.div {...panelSpring(0.1)} id="state-wise-attach-pct" className="rounded-xl bg-white border border-gray-100 p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-900">State-wise Attach %</h3>
          <p className="text-[11px] text-gray-500 mt-0.5 mb-3">Ranked by attach % for {primaryMonth} · Dashed line = 20% target</p>
          <Plot
            data={[{
              type: 'bar',
              orientation: 'h' as const,
              name: 'Attach %',
              x: [...stateAggs].reverse().map(s => +(s.attach * 100).toFixed(1)),
              y: [...stateAggs].reverse().map(s => s.state),
              marker: { color: [...stateAggs].reverse().map(s => attachColor(s.attach)), opacity: 0.85 },
              customdata: [...stateAggs].reverse().map(s => [s.plans, s.devices]),
              hovertemplate: '<b>%{y}</b><br>Attach: %{x:.1f}%<br>Plans: %{customdata[0]}<br>Devices: %{customdata[1]}<extra></extra>',
            }]}
            layout={{
              ...PLOTLY_BASE,
              height: Math.max(280, stateAggs.length * 28 + 60),
              margin: { l: 110, r: 20, t: 8, b: 40 },
              xaxis: { ...PT_AXIS, ticksuffix: '%', range: [0, Math.max(30, ...stateAggs.map(s => s.attach * 100)) * 1.15] },
              yaxis: { ...PT_AXIS },
              shapes: [{
                type: 'line' as const, xref: 'x', yref: 'paper',
                x0: 20, x1: 20, y0: 0, y1: 1,
                line: { color: '#6366f180', width: 1.5, dash: 'dash' as const },
              }],
              annotations: [{
                x: 20, y: 1, xref: 'x' as const, yref: 'paper' as const,
                text: '20% target', showarrow: false,
                font: { color: '#6366f1', size: 10 }, yanchor: 'bottom' as const,
              }],
            }}
            config={{ displayModeBar: false, responsive: true }}
            style={{ width: '100%' }}
          />
        </motion.div>

        {/* Scatter: Plans vs Attach % */}
        <motion.div {...panelSpring(0.1)} id="attach-pct-vs-plans-sold-scatter" className="rounded-xl bg-white border border-gray-100 p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-900">Attach % vs Plans Sold — Store Scatter</h3>
          <p className="text-[11px] text-gray-500 mt-0.5 mb-3">
            Each bubble = one store · Size = device units ·
            <span className="text-emerald-600 font-semibold"> Green</span> ≥ 20% ·
            <span className="text-amber-500 font-semibold"> Amber</span> 10–20% ·
            <span className="text-red-500 font-semibold"> Red</span> &lt; 10%
          </p>
          <Plot
            data={scatterData}
            layout={{
              ...PLOTLY_BASE,
              height: Math.max(280, stateAggs.length * 28 + 60),
              margin: { l: 55, r: 20, t: 8, b: 50 },
              xaxis: { ...PT_AXIS, title: { text: 'Plans Sold' } },
              yaxis: { ...PT_AXIS, title: { text: 'Attach %' }, ticksuffix: '%' },
              legend: { bgcolor: 'rgba(0,0,0,0)', font: { color: PT.font, size: 10 }, orientation: 'h' as const, y: -0.22 },
              hovermode: 'closest' as const,
              shapes: [{
                type: 'line' as const, xref: 'paper', yref: 'y',
                x0: 0, x1: 1, y0: 20, y1: 20,
                line: { color: '#6366f150', width: 1.5, dash: 'dash' as const },
              }],
            }}
            config={{ displayModeBar: false, responsive: true }}
            style={{ width: '100%' }}
          />
        </motion.div>

      </div>

      {/* ── Row 3: Store Action Table ──────────────────────────────────────── */}
      <motion.div {...panelSpring(0.2)} id="store-attach-performance" className="rounded-xl bg-white border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center gap-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Store Attach Performance</h3>
            <p className="text-[11px] text-gray-500 mt-0.5">{filteredRows.length} stores · {primaryMonth}</p>
          </div>
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }}
            placeholder="Search store / state…"
            className="ml-auto h-8 w-52 rounded-md border border-gray-200 bg-gray-50 px-3 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 text-left">
                {([
                  ['name',    'Store'],
                  ['state',   'State'],
                  ['attach',  'Attach %'],
                  ['plans',   'Plans'],
                  ['devices', 'Devices'],
                  ['mom',     'MoM Δ (pp)'],
                ] as [SortKey, string][]).map(([col, lbl]) => (
                  <th
                    key={col}
                    onClick={() => toggleSort(col)}
                    className="px-3 py-2.5 font-semibold text-gray-600 cursor-pointer select-none whitespace-nowrap hover:text-gray-900 transition-colors"
                  >
                    {lbl}<SortIcon col={col} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {pagedRows.map(r => {
                const color = attachColor(r.attach)
                return (
                  <tr key={r.store.store_id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-3 py-2.5 font-medium text-gray-900 whitespace-nowrap max-w-[180px] truncate">
                      {r.store.store_name || r.store.store_id}
                    </td>
                    <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap">{r.store.state || '—'}</td>
                    <td className="px-3 py-2.5 font-bold tabular-nums whitespace-nowrap" style={{ color }}>
                      {r.devices > 0 ? `${(r.attach * 100).toFixed(1)}%` : '—'}
                    </td>
                    <td className="px-3 py-2.5 tabular-nums text-gray-700">{r.plans}</td>
                    <td className="px-3 py-2.5 tabular-nums text-gray-700">{r.devices}</td>
                    <td className={cn('px-3 py-2.5 tabular-nums font-semibold whitespace-nowrap', r.mom > 0 ? 'text-emerald-600' : r.mom < 0 ? 'text-red-600' : 'text-gray-400')}>
                      {r.devices > 0 ? fmtPct(r.mom * 100) + ' pp' : '—'}
                    </td>
                  </tr>
                )
              })}
              {pagedRows.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-400">No stores match the current filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 text-xs text-gray-500">
            <span>{filteredRows.length} stores, page {page} of {totalPages}</span>
            <div className="flex gap-1">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="px-2.5 py-1 rounded border border-gray-200 disabled:opacity-40 hover:bg-gray-50 transition-colors">‹ Prev</button>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                className="px-2.5 py-1 rounded border border-gray-200 disabled:opacity-40 hover:bg-gray-50 transition-colors">Next ›</button>
            </div>
          </div>
        )}
      </motion.div>

    </div>
  )
}
