import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  TrendingUp,
  MapPin,
  Store as StoreIcon,
  PieChart as PieChartIcon,
} from 'lucide-react'
// eslint-disable-next-line @typescript-eslint/no-require-imports
import createPlotlyComponent from 'react-plotly.js/factory'
// @ts-ignore
import Plotly from 'plotly.js-dist-min'
import { useDataContext } from '@/contexts/DataContext'
import type { FilterState } from '@/hooks/useFilters'
import { transformStoresByPlanCategory } from '@/lib/filterHelpers'
import { cn } from '@/lib/utils'
import { fmtInr, fmtPct, plotlyInrTickVals, plotlyInrLogTickVals } from '@/lib/formatting'
import { kpiContainer, kpiItem, panelSpring } from '@/lib/animations'
import { PLOTLY_BASE, PT_AXIS } from '@/lib/plotlyTheme'
import type { StoreRecord } from '@/lib/api'

const Plot = createPlotlyComponent(Plotly)

// ── Types ─────────────────────────────────────────────────────────────────────

type TableSortKey = 'name' | 'state' | 'total' | 'sp' | 'adld' | 'combo' | 'ew'

interface StorePlanRow {
  store: StoreRecord
  totalSales: number
  spSales: number
  adldSales: number
  comboSales: number
  ewSales: number
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function PlanLevelInsight({ filters }: { filters: FilterState }) {
  const { stores, months } = useDataContext()
  const [logScale, setLogScale] = useState(true)

  // 1. Filter Data
  const targetStores = useMemo(() => {
    return transformStoresByPlanCategory(stores, filters.planCategory)
  }, [stores, filters.planCategory])

  // Determine active months based on global filters
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

  // Determine the primary month for snapshot views
  const primaryMonth = useMemo(() => {
    return filters.targetMonth || fm[fm.length - 1] || 'Jun-2026'
  }, [filters.targetMonth, fm])

  // 2. Compute Aggregates for the primary month
  const { planAggs, stateAggs, storeRows } = useMemo(() => {
    let spTotal = 0
    let adldTotal = 0
    let comboTotal = 0
    let ewTotal = 0
    let overallTotal = 0

    let spPlansTotal = 0
    let adldPlansTotal = 0
    let comboPlansTotal = 0
    let ewPlansTotal = 0
    let overallPlansTotal = 0

    const stateMap = new Map<string, { 
      sp: number; adld: number; combo: number; ew: number; total: number;
      spPlans: number; adldPlans: number; comboPlans: number; ewPlans: number; totalPlans: number;
    }>()
    const rows: StorePlanRow[] = []

    for (const st of targetStores) {
      const sp = st.monthly_sales_sp?.[primaryMonth] || 0
      const adld = st.monthly_sales_adld?.[primaryMonth] || 0
      const combo = st.monthly_sales_combo?.[primaryMonth] || 0
      const ew = st.monthly_sales_ew?.[primaryMonth] || 0
      const tot = sp + adld + combo + ew

      const spPlans = st.monthly_plans_sp?.[primaryMonth] || 0
      const adldPlans = st.monthly_plans_adld?.[primaryMonth] || 0
      const comboPlans = st.monthly_plans_combo?.[primaryMonth] || 0
      const ewPlans = st.monthly_plans_ew?.[primaryMonth] || 0
      const totPlans = spPlans + adldPlans + comboPlans + ewPlans

      spTotal += sp
      adldTotal += adld
      comboTotal += combo
      ewTotal += ew
      overallTotal += tot

      spPlansTotal += spPlans
      adldPlansTotal += adldPlans
      comboPlansTotal += comboPlans
      ewPlansTotal += ewPlans
      overallPlansTotal += totPlans

      const sName = st.state || 'Unknown'
      if (!stateMap.has(sName)) {
        stateMap.set(sName, { 
          sp: 0, adld: 0, combo: 0, ew: 0, total: 0,
          spPlans: 0, adldPlans: 0, comboPlans: 0, ewPlans: 0, totalPlans: 0
        })
      }
      const sAgg = stateMap.get(sName)!
      sAgg.sp += sp
      sAgg.adld += adld
      sAgg.combo += combo
      sAgg.ew += ew
      sAgg.total += tot

      sAgg.spPlans += spPlans
      sAgg.adldPlans += adldPlans
      sAgg.comboPlans += comboPlans
      sAgg.ewPlans += ewPlans
      sAgg.totalPlans += totPlans

      rows.push({ store: st, totalSales: tot, spSales: sp, adldSales: adld, comboSales: combo, ewSales: ew })
    }

    const sAggs = Array.from(stateMap.entries())
      .map(([state, data]) => ({ state, ...data }))
      .sort((a, b) => b.total - a.total)

    return {
      planAggs: { 
        sp: spTotal, adld: adldTotal, combo: comboTotal, ew: ewTotal, total: overallTotal,
        spPlans: spPlansTotal, adldPlans: adldPlansTotal, comboPlans: comboPlansTotal, ewPlans: ewPlansTotal, totalPlans: overallPlansTotal
      },
      stateAggs: sAggs,
      storeRows: rows,
    }
  }, [targetStores, primaryMonth])

  // 3. Compute 6-Month Trend
  const trendData = useMemo(() => {
    // Get last 6 months from fm
    const trendMonths = fm.slice(Math.max(0, fm.length - 6))
    const spTrend = trendMonths.map(m => targetStores.reduce((acc, st) => acc + (st.monthly_sales_sp?.[m] || 0), 0))
    const adldTrend = trendMonths.map(m => targetStores.reduce((acc, st) => acc + (st.monthly_sales_adld?.[m] || 0), 0))
    const comboTrend = trendMonths.map(m => targetStores.reduce((acc, st) => acc + (st.monthly_sales_combo?.[m] || 0), 0))
    const ewTrend = trendMonths.map(m => targetStores.reduce((acc, st) => acc + (st.monthly_sales_ew?.[m] || 0), 0))

    const spPlansTrend = trendMonths.map(m => targetStores.reduce((acc, st) => acc + (st.monthly_plans_sp?.[m] || 0), 0))
    const adldPlansTrend = trendMonths.map(m => targetStores.reduce((acc, st) => acc + (st.monthly_plans_adld?.[m] || 0), 0))
    const comboPlansTrend = trendMonths.map(m => targetStores.reduce((acc, st) => acc + (st.monthly_plans_combo?.[m] || 0), 0))
    const ewPlansTrend = trendMonths.map(m => targetStores.reduce((acc, st) => acc + (st.monthly_plans_ew?.[m] || 0), 0))

    return { 
      months: trendMonths, 
      sp: spTrend, adld: adldTrend, combo: comboTrend, ew: ewTrend,
      spPlans: spPlansTrend, adldPlans: adldPlansTrend, comboPlans: comboPlansTrend, ewPlans: ewPlansTrend
    }
  }, [targetStores, fm])

  const maxStateVal = useMemo(() => {
    if (stateAggs.length === 0) return 100000
    return Math.max(...stateAggs.flatMap(s => [s.sp, s.adld, s.combo, s.ew]))
  }, [stateAggs])

  const maxTrendVal = useMemo(() => {
    const allVals = [...trendData.sp, ...trendData.adld, ...trendData.combo, ...trendData.ew]
    if (allVals.length === 0) return 100000
    return Math.max(...allVals)
  }, [trendData])

  // ── Table State ─────────────────────────────────────────────────────────────

  const [tableSearch, setTableSearch] = useState('')
  const [tableSortKey, setTableSortKey] = useState<TableSortKey>('total')
  const [tableSortDir, setTableSortDir] = useState<'asc' | 'desc'>('desc')
  const [tablePage, setTablePage] = useState(1)
  const TABLE_PAGE_SIZE = 15

  const sortedStoreRows = useMemo(() => {
    let res = [...storeRows]
    const q = tableSearch.toLowerCase().trim()
    if (q) res = res.filter(r => (r.store.store_name || '').toLowerCase().includes(q) || (r.store.state || '').toLowerCase().includes(q))
    
    res.sort((a, b) => {
      let diff = 0
      switch (tableSortKey) {
        case 'name': diff = (a.store.store_name || '').localeCompare(b.store.store_name || ''); break
        case 'state': diff = (a.store.state || '').localeCompare(b.store.state || ''); break
        case 'total': diff = a.totalSales - b.totalSales; break
        case 'sp': diff = a.spSales - b.spSales; break
        case 'adld': diff = a.adldSales - b.adldSales; break
        case 'combo': diff = a.comboSales - b.comboSales; break
        case 'ew': diff = a.ewSales - b.ewSales; break
      }
      return tableSortDir === 'asc' ? diff : -diff
    })
    return res
  }, [storeRows, tableSearch, tableSortKey, tableSortDir])

  const totalPages = Math.ceil(sortedStoreRows.length / TABLE_PAGE_SIZE)
  const paginatedRows = sortedStoreRows.slice((tablePage - 1) * TABLE_PAGE_SIZE, tablePage * TABLE_PAGE_SIZE)

  const handleSort = (key: TableSortKey) => {
    if (tableSortKey === key) setTableSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setTableSortKey(key); setTableSortDir('desc') }
  }

  // ── Rendering ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* ── Header ── */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="flex items-center justify-between gap-3 flex-wrap pb-1 border-b border-gray-100"
      >
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-purple-600 bg-purple-50 px-2 py-0.5 rounded-full">Plan Level Insight</span>
          </div>
          <h2 className="text-xl font-bold text-gray-950">How are individual plans performing?</h2>
          <p className="text-sm text-gray-500 mt-0.5 max-w-2xl leading-relaxed">
            Target month: <span className="text-purple-600 font-semibold">{primaryMonth}</span>
            {' · '}{targetStores.length} stores
          </p>
        </div>
      </motion.div>

      {/* ── KPI Row ── */}
      <motion.div
        className="grid grid-cols-2 gap-3 sm:grid-cols-5"
        variants={kpiContainer}
        initial="hidden"
        animate="show"
      >
        {[
          { label: 'Total Revenue', value: planAggs.total, color: 'text-gray-900', bg: 'bg-gray-100' },
          { label: 'SP Sales', value: planAggs.sp, color: 'text-blue-600', bg: 'bg-blue-100' },
          { label: 'ADLD Sales', value: planAggs.adld, color: 'text-indigo-600', bg: 'bg-indigo-100' },
          { label: 'Combo Sales', value: planAggs.combo, color: 'text-purple-600', bg: 'bg-purple-100' },
          { label: 'EW Sales', value: planAggs.ew, color: 'text-pink-600', bg: 'bg-pink-100' },
        ].map((kpi, i) => (
          <motion.div
            key={kpi.label}
            variants={kpiItem}
            className="flex flex-col justify-center rounded-xl bg-white border border-gray-100 p-4 shadow-sm"
          >
            <p className="text-[10px] font-medium uppercase tracking-widest text-gray-500">{kpi.label}</p>
            <p className={cn('text-2xl font-bold tabular-nums mt-1', kpi.color)}>{fmtInr(kpi.value)}</p>
            {kpi.value > 0 && planAggs.total > 0 && i > 0 && (
              <p className="text-xs text-gray-400 mt-1">{fmtPct((kpi.value / planAggs.total) * 100)} contribution</p>
            )}
          </motion.div>
        ))}
      </motion.div>

      {/* ── Charts Row 1 ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Donut Chart */}
        <motion.div
          className="lg:col-span-1 rounded-xl bg-white border border-gray-100 p-4 shadow-sm flex flex-col h-[380px]"
          {...panelSpring()}
        >
          <div className="flex items-center gap-2 mb-2">
            <div className="p-1.5 rounded-lg bg-blue-50 text-blue-600"><PieChartIcon className="h-4 w-4" /></div>
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Plan Contribution</h3>
              <p className="text-[11px] text-gray-500">Revenue split for {primaryMonth}</p>
            </div>
          </div>
          <div className="flex-1 relative -mx-4 -mb-4">
            <Plot
              data={[{
                type: 'pie',
                hole: 0.6,
                labels: ['SP', 'ADLD', 'Combo', 'EW'],
                values: [planAggs.sp, planAggs.adld, planAggs.combo, planAggs.ew],
                customdata: [
                  [fmtInr(planAggs.sp), planAggs.spPlans],
                  [fmtInr(planAggs.adld), planAggs.adldPlans],
                  [fmtInr(planAggs.combo), planAggs.comboPlans],
                  [fmtInr(planAggs.ew), planAggs.ewPlans],
                ],
                hovertemplate: '<b>%{label}</b><br>Sales: %{customdata[0]}<br>Plans Sold: %{customdata[1]}<br>Share: %{percent}<extra></extra>',
                marker: { colors: ['#3b82f6', '#4f46e5', '#9333ea', '#db2777'] },
                textinfo: 'label+percent',
              }]}
              layout={{
                ...PLOTLY_BASE,
                showlegend: false,
                margin: { t: 20, b: 20, l: 20, r: 20 },
              }}
              config={{ displayModeBar: false }}
              style={{ width: '100%', height: '100%' }}
              useResizeHandler
            />
          </div>
        </motion.div>

        {/* Regional Performance */}
        <motion.div
          className="lg:col-span-2 rounded-xl bg-white border border-gray-100 p-4 shadow-sm flex flex-col h-[380px]"
          {...panelSpring(0.1)}
        >
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-indigo-50 text-indigo-600"><MapPin className="h-4 w-4" /></div>
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Regional Performance</h3>
                <p className="text-[11px] text-gray-500">Plan sales across top states for {primaryMonth}</p>
              </div>
            </div>
            <button
              onClick={() => setLogScale(s => !s)}
              className={cn(
                'text-[11px] px-2.5 py-1 rounded-full border transition-colors whitespace-nowrap cursor-pointer',
                logScale
                  ? 'bg-violet-600 text-white border-violet-600'
                  : 'bg-white text-gray-500 border-gray-200 hover:text-gray-700 hover:border-gray-300'
              )}
            >
              Log Scale
            </button>
          </div>
          <div className="flex-1 relative -mx-4 -mb-4">
            <Plot
              data={[
                { 
                  type: 'bar', name: 'SP', 
                  x: stateAggs.map(s => s.state), 
                  y: stateAggs.map(s => s.sp), 
                  customdata: stateAggs.map(s => [fmtInr(s.sp), s.spPlans]),
                  hovertemplate: '<b>%{x} (SP)</b><br>Sales: %{customdata[0]}<br>Plans Sold: %{customdata[1]}<extra></extra>',
                  marker: { color: '#3b82f6' } 
                },
                { 
                  type: 'bar', name: 'ADLD', 
                  x: stateAggs.map(s => s.state), 
                  y: stateAggs.map(s => s.adld), 
                  customdata: stateAggs.map(s => [fmtInr(s.adld), s.adldPlans]),
                  hovertemplate: '<b>%{x} (ADLD)</b><br>Sales: %{customdata[0]}<br>Plans Sold: %{customdata[1]}<extra></extra>',
                  marker: { color: '#4f46e5' } 
                },
                { 
                  type: 'bar', name: 'Combo', 
                  x: stateAggs.map(s => s.state), 
                  y: stateAggs.map(s => s.combo), 
                  customdata: stateAggs.map(s => [fmtInr(s.combo), s.comboPlans]),
                  hovertemplate: '<b>%{x} (Combo)</b><br>Sales: %{customdata[0]}<br>Plans Sold: %{customdata[1]}<extra></extra>',
                  marker: { color: '#9333ea' } 
                },
                { 
                  type: 'bar', name: 'EW', 
                  x: stateAggs.map(s => s.state), 
                  y: stateAggs.map(s => s.ew), 
                  customdata: stateAggs.map(s => [fmtInr(s.ew), s.ewPlans]),
                  hovertemplate: '<b>%{x} (EW)</b><br>Sales: %{customdata[0]}<br>Plans Sold: %{customdata[1]}<extra></extra>',
                  marker: { color: '#db2777' } 
                },
              ]}
              layout={{
                ...PLOTLY_BASE,
                barmode: 'group',
                margin: { t: 20, b: 40, l: 50, r: 20 },
                xaxis: { ...PT_AXIS, tickangle: -45 },
                yaxis: {
                  ...PT_AXIS,
                  type: logScale ? 'log' as const : 'linear' as const,
                  ...(logScale ? plotlyInrLogTickVals(maxStateVal) : plotlyInrTickVals(maxStateVal * 1.1))
                },
                legend: { orientation: 'h', y: 1.1, x: 0.5, xanchor: 'center' },
              }}
              config={{ displayModeBar: false }}
              style={{ width: '100%', height: '100%' }}
              useResizeHandler
            />
          </div>
        </motion.div>
      </div>

      {/* ── Charts Row 2 ── */}
      <motion.div
        className="rounded-xl bg-white border border-gray-100 p-4 shadow-sm flex flex-col h-[380px]"
        {...panelSpring(0.2)}
      >
        <div className="flex items-center gap-2 mb-2">
          <div className="p-1.5 rounded-lg bg-purple-50 text-purple-600"><TrendingUp className="h-4 w-4" /></div>
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Past 6 Months Trend</h3>
            <p className="text-[11px] text-gray-500">Plan sales trajectory over time</p>
          </div>
        </div>
        <div className="flex-1 relative -mx-4 -mb-4">
          <Plot
            data={[
              { 
                type: 'scatter', mode: 'lines+markers', name: 'SP', 
                x: trendData.months, y: trendData.sp, 
                customdata: trendData.sp.map((val, idx) => [fmtInr(val), trendData.spPlans[idx]]),
                hovertemplate: '<b>%{x} (SP)</b><br>Sales: %{customdata[0]}<br>Plans Sold: %{customdata[1]}<extra></extra>',
                line: { color: '#3b82f6', width: 3 }, marker: { size: 6 } 
              },
              { 
                type: 'scatter', mode: 'lines+markers', name: 'ADLD', 
                x: trendData.months, y: trendData.adld, 
                customdata: trendData.adld.map((val, idx) => [fmtInr(val), trendData.adldPlans[idx]]),
                hovertemplate: '<b>%{x} (ADLD)</b><br>Sales: %{customdata[0]}<br>Plans Sold: %{customdata[1]}<extra></extra>',
                line: { color: '#4f46e5', width: 3 }, marker: { size: 6 } 
              },
              { 
                type: 'scatter', mode: 'lines+markers', name: 'Combo', 
                x: trendData.months, y: trendData.combo, 
                customdata: trendData.combo.map((val, idx) => [fmtInr(val), trendData.comboPlans[idx]]),
                hovertemplate: '<b>%{x} (Combo)</b><br>Sales: %{customdata[0]}<br>Plans Sold: %{customdata[1]}<extra></extra>',
                line: { color: '#9333ea', width: 3 }, marker: { size: 6 } 
              },
              { 
                type: 'scatter', mode: 'lines+markers', name: 'EW', 
                x: trendData.months, y: trendData.ew, 
                customdata: trendData.ew.map((val, idx) => [fmtInr(val), trendData.ewPlans[idx]]),
                hovertemplate: '<b>%{x} (EW)</b><br>Sales: %{customdata[0]}<br>Plans Sold: %{customdata[1]}<extra></extra>',
                line: { color: '#db2777', width: 3 }, marker: { size: 6 } 
              },
            ]}
            layout={{
              ...PLOTLY_BASE,
              margin: { t: 20, b: 40, l: 50, r: 20 },
              xaxis: { ...PT_AXIS },
              yaxis: {
                ...PT_AXIS,
                ...plotlyInrTickVals(maxTrendVal * 1.1)
              },
              legend: { orientation: 'h', y: 1.1, x: 0.5, xanchor: 'center' },
            }}
            config={{ displayModeBar: false }}
            style={{ width: '100%', height: '100%' }}
            useResizeHandler
          />
        </div>
      </motion.div>

      {/* ── Store Drill-Down Table ── */}
      <motion.div className="rounded-xl bg-white shadow-sm border border-gray-100 overflow-hidden flex flex-col" {...panelSpring(0.3)}>
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/50 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-pink-50 text-pink-600"><StoreIcon className="h-4 w-4" /></div>
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Store Level Plan Performance</h3>
              <p className="text-[11px] text-gray-500">Drill down into individual store plan sales for {primaryMonth}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Search stores..."
              className="h-8 px-3 rounded-md border border-gray-200 text-xs w-48 focus:outline-none focus:ring-1 focus:ring-blue-500"
              value={tableSearch}
              onChange={e => { setTableSearch(e.target.value); setTablePage(1) }}
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-white border-b border-gray-100">
                <th className="px-3 py-2 text-[10px] font-semibold text-gray-500 uppercase tracking-wider w-8">#</th>
                {[
                  { col: 'name', label: 'Store Name' },
                  { col: 'state', label: 'State' },
                  { col: 'total', label: 'Total Sales' },
                  { col: 'sp', label: 'SP' },
                  { col: 'adld', label: 'ADLD' },
                  { col: 'combo', label: 'Combo' },
                  { col: 'ew', label: 'EW' },
                ].map(h => (
                  <th key={h.col} className="px-3 py-2 text-[10px] font-semibold text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-50 select-none transition-colors" onClick={() => handleSort(h.col as TableSortKey)}>
                    <div className="flex items-center gap-1">
                      {h.label}
                      {tableSortKey === h.col && (
                        <span className="text-blue-500">{tableSortDir === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {paginatedRows.map((row, idx) => {
                const globalIdx = (tablePage - 1) * TABLE_PAGE_SIZE + idx + 1
                return (
                  <tr key={row.store.store_id} className="hover:bg-blue-50/30 transition-colors group">
                    <td className="px-3 py-2.5 text-gray-400 tabular-nums text-xs">{globalIdx}</td>
                    <td className="px-3 py-2.5">
                      <p className="text-gray-950 font-semibold text-xs truncate max-w-[180px]">{row.store.store_name}</p>
                    </td>
                    <td className="px-3 py-2.5 text-gray-500 text-xs whitespace-nowrap">{row.store.state || '—'}</td>
                    <td className="px-3 py-2.5 text-gray-900 font-semibold tabular-nums text-xs whitespace-nowrap">{fmtInr(row.totalSales)}</td>
                    <td className="px-3 py-2.5 text-blue-600 font-medium tabular-nums text-xs whitespace-nowrap">{row.spSales > 0 ? fmtInr(row.spSales) : '—'}</td>
                    <td className="px-3 py-2.5 text-indigo-600 font-medium tabular-nums text-xs whitespace-nowrap">{row.adldSales > 0 ? fmtInr(row.adldSales) : '—'}</td>
                    <td className="px-3 py-2.5 text-purple-600 font-medium tabular-nums text-xs whitespace-nowrap">{row.comboSales > 0 ? fmtInr(row.comboSales) : '—'}</td>
                    <td className="px-3 py-2.5 text-pink-600 font-medium tabular-nums text-xs whitespace-nowrap">{row.ewSales > 0 ? fmtInr(row.ewSales) : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between gap-3 flex-wrap">
            <p className="text-xs text-gray-500">
              Showing {(tablePage - 1) * TABLE_PAGE_SIZE + 1}–{Math.min(tablePage * TABLE_PAGE_SIZE, sortedStoreRows.length)} of {sortedStoreRows.length} stores
            </p>
            <div className="flex items-center gap-1">
              <button onClick={() => setTablePage(p => Math.max(1, p - 1))} disabled={tablePage === 1} className="h-7 px-2.5 rounded text-xs text-gray-500 hover:bg-gray-100 disabled:opacity-30">‹</button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, k) => {
                let page: number
                if (totalPages <= 5) page = k + 1
                else if (tablePage <= 3) page = k + 1
                else if (tablePage >= totalPages - 2) page = totalPages - 4 + k
                else page = tablePage - 2 + k
                return (
                  <button key={page} onClick={() => setTablePage(page)} className={cn('h-7 w-7 rounded text-xs transition-colors', page === tablePage ? 'bg-blue-500 text-white font-bold' : 'text-gray-500 hover:bg-gray-100')}>
                    {page}
                  </button>
                )
              })}
              <button onClick={() => setTablePage(p => Math.min(totalPages, p + 1))} disabled={tablePage === totalPages} className="h-7 px-2.5 rounded text-xs text-gray-500 hover:bg-gray-100 disabled:opacity-30">›</button>
            </div>
          </div>
        )}
      </motion.div>
    </div>
  )
}
