import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import createPlotlyComponent from 'react-plotly.js/factory'
// @ts-ignore — plotly.js-dist-min does not ship its own .d.ts
import Plotly from 'plotly.js-dist-min'
import { useRetailerContext } from '@/contexts/RetailerContext'
import { getModelInsights, ModelInsightRecord } from '@/lib/api'
import { fmtInr } from '@/lib/formatting'
import { cn } from '@/lib/utils'
import {
  Activity,
  TrendingUp,
  AlertTriangle,
  Search,
  MapPin
} from 'lucide-react'

const Plot = createPlotlyComponent(Plotly)

const GEO_URL = `${import.meta.env.BASE_URL}india-states.geojson`

const STATE_CENTROIDS: Record<string, [number, number]> = {
  'Andhra Pradesh':             [15.9,  79.7],
  'Arunachal Pradesh':          [27.5,  94.0],
  'Assam':                      [26.2,  92.9],
  'Bihar':                      [25.4,  85.3],
  'Chhattisgarh':               [21.3,  81.9],
  'Goa':                        [15.4,  74.0],
  'Gujarat':                    [22.3,  71.2],
  'Haryana':                    [29.1,  76.1],
  'Himachal Pradesh':           [31.5,  77.2],
  'Jammu and Kashmir':          [33.5,  75.5],
  'Jammu & Kashmir':            [33.5,  75.5],
  'Jharkhand':                  [23.6,  85.3],
  'Karnataka':                  [15.3,  75.7],
  'Kerala':                     [10.5,  76.3],
  'Ladakh':                     [34.1,  77.6],
  'Madhya Pradesh':             [23.5,  78.7],
  'Maharashtra':                [19.2,  75.7],
  'Manipur':                    [24.7,  93.9],
  'Meghalaya':                  [25.5,  91.4],
  'Mizoram':                    [23.2,  92.9],
  'Nagaland':                   [26.2,  94.6],
  'Odisha':                     [20.5,  84.5],
  'Punjab':                     [31.1,  75.3],
  'Rajasthan':                  [26.4,  73.9],
  'Sikkim':                     [27.5,  88.5],
  'Tamil Nadu':                 [11.1,  78.7],
  'Telangana':                  [17.5,  79.1],
  'Tripura':                    [23.9,  91.9],
  'Uttar Pradesh':              [26.8,  80.7],
  'Uttarakhand':                [30.1,  79.3],
  'West Bengal':                [23.5,  87.9],
  'Delhi':                      [28.7,  77.1],
  'Chandigarh':                 [30.7,  76.8],
  'Puducherry':                 [11.9,  79.8],
  'Andaman and Nicobar Islands':[11.7,  92.7],
  'Lakshadweep':                [10.6,  72.6],
  'Dadra and Nagar Haveli':     [20.1,  73.0],
  'Daman and Diu':              [20.4,  72.8],
}

// Centered layout for maps
const GEO_LAYOUT = {
  fitbounds:      false,
  bgcolor:        'rgba(0,0,0,0)',
  showframe:      false,
  showcoastlines: true,
  coastlinecolor: '#cbd5e1',
  coastlinewidth: 0.6,
  showland:       true,
  landcolor:      '#F8FAFC',
  showocean:      true,
  oceancolor:     '#E2E8F0',
  showlakes:      true,
  lakecolor:      '#E2E8F0',
  showcountries:  true,
  countrycolor:   '#94a3b8',
  countrywidth:   0.8,
  showsubunits:   true,
  subunitcolor:   '#CBD5E1',
  subunitwidth:   0.5,
  projection:     { type: 'mercator' },
  lonaxis:        { range: [67, 98] },
  lataxis:        { range: [6, 38] },
} as const

function matchGeoName(ourName: string, geoNames: string[]): string | null {
  if (geoNames.includes(ourName)) return ourName
  const lower = ourName.toLowerCase()
  return (
    geoNames.find(g => g.toLowerCase() === lower) ??
    geoNames.find(g => g.toLowerCase().startsWith(lower.split(' ')[0])) ??
    null
  )
}

/**
 * Abbreviate a model name: keep base model token only.
 * e.g. "S26 Violet Jetblack" → "S26"
 *      "S26 Ultra White"     → "S26 Ultra"
 *      "Fold 7 GB Silver"    → "Fold 7"
 *      "A17 BLUE N"          → "A17"
 */
function abbreviateModel(name: string): string {
  if (!name) return name
  // Well-known two-word prefixes that should be kept together
  const twoWordPrefixes = ['S26 Ultra', 'S25 Ultra', 'S24 Ultra', 'S23 Ultra', 'Fold 7', 'Fold 6', 'Flip 7', 'Flip 6']
  for (const prefix of twoWordPrefixes) {
    if (name.toUpperCase().startsWith(prefix.toUpperCase())) return prefix
  }
  // Otherwise return first token
  return name.split(' ')[0]
}

// Framer motion variants for premium load animations
const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.05,
    },
  },
}

const cardItem = {
  hidden: { opacity: 0, y: 15 },
  show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 100, damping: 15 } },
}

export default function ModelInsights({ filters: globalFilters }: { filters: any }) {
  const { retailerCfg } = useRetailerContext()
  const [data, setData] = useState<ModelInsightRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Local state: only map click state (all other filtering via global filters)
  const [selectedState, setSelectedState] = useState<string | null>(null)

  // GeoJSON state
  const [geojson, setGeojson] = useState<any>(null)
  const [geoLoading, setGeoLoading] = useState(true)

  // Table search / sort
  const [searchQuery, setSearchQuery] = useState('')
  const [sortKey, setSortKey] = useState<'state' | 'city' | 'store' | 'model' | 'subcat' | 'plans_sold'>('plans_sold')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 12

  // 1. Fetch raw insights payload from endpoint
  useEffect(() => {
    setLoading(true)
    setError(null)
    getModelInsights(retailerCfg.apiRetailerId)
      .then(res => {
        setData(res.data)
        setLoading(false)
      })
      .catch(err => {
        console.error("Failed to load model insights", err)
        setError("Failed to load model insights. Please check database connectivity.")
        setLoading(false)
      })
  }, [retailerCfg.apiRetailerId])

  // 2. Fetch GeoJSON for Indian Heatmap
  useEffect(() => {
    setGeoLoading(true)
    fetch(GEO_URL)
      .then(r => { if (!r.ok) throw new Error(); return r.json() })
      .then(d => {
        setGeojson(d)
        setGeoLoading(false)
      })
      .catch(() => {
        setGeoLoading(false)
      })
  }, [])

  // 3. Extract unique values for derivation
  const months = useMemo(() => {
    const set = new Set(data.map(d => d.month))
    const list = Array.from(set)
    const monthOrder = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    return list.sort((a, b) => {
      const [aAbbr, aYear] = a.split('-')
      const [bAbbr, bYear] = b.split('-')
      if (aYear !== bYear) return aYear.localeCompare(bYear)
      return monthOrder.indexOf(aAbbr) - monthOrder.indexOf(bAbbr)
    })
  }, [data])

  const subcats = useMemo(() => {
    const set = new Set(data.map(d => d.subcat))
    return Array.from(set).filter(Boolean).sort()
  }, [data])

  // ── Derive active filter values from globalFilters ──────────────────────────
  const activeMonth: string = useMemo(() => {
    if (globalFilters?.targetMonth) return globalFilters.targetMonth
    return months.length > 0 ? months[months.length - 1] : 'all'
  }, [globalFilters, months])

  const activePlan: string = globalFilters?.planCategory ?? ''
  const activeSubcat: string = globalFilters?.productSubcategory ?? ''
  const activeGlobalState: string = globalFilters?.state ?? ''

  // Combined state filter: global state OR map-click state
  const effectiveState = activeGlobalState || selectedState || ''

  // ── Filter records based on active global + map filters ────────────────────
  const filteredRecords = useMemo(() => {
    return data.filter(d => {
      if (activeMonth && activeMonth !== 'all' && d.month !== activeMonth) return false
      if (activePlan && d.plan !== activePlan) return false
      if (activeSubcat && d.subcat.toLowerCase() !== activeSubcat.toLowerCase()) return false
      if (effectiveState && d.state !== effectiveState) return false
      return true
    })
  }, [data, activeMonth, activePlan, activeSubcat, effectiveState])

  // 4. KPI Card metrics
  const kpis = useMemo(() => {
    const subcatPlans: Record<string, number> = {}
    const modelPlans: Record<string, number> = {}
    const planBreakdown: Record<string, { plans: number; revenue: number }> = {}
    let totalPlans = 0
    let totalRevenue = 0

    for (const r of filteredRecords) {
      totalPlans += r.plans_sold
      totalRevenue += r.revenue
      subcatPlans[r.subcat] = (subcatPlans[r.subcat] || 0) + r.plans_sold
      const abbr = abbreviateModel(r.model)
      modelPlans[abbr] = (modelPlans[abbr] || 0) + r.plans_sold
      if (!planBreakdown[r.plan]) planBreakdown[r.plan] = { plans: 0, revenue: 0 }
      planBreakdown[r.plan].plans += r.plans_sold
      planBreakdown[r.plan].revenue += r.revenue
    }

    const sortedSubcats = Object.entries(subcatPlans).sort((a, b) => b[1] - a[1])
    const sortedModels = Object.entries(modelPlans).sort((a, b) => b[1] - a[1])

    const topSubcat = sortedSubcats[0]?.[0] ?? '—'
    const topSubcatQty = sortedSubcats[0]?.[1] ?? 0
    const topModel = sortedModels[0]?.[0] ?? '—'
    const topModelQty = sortedModels[0]?.[1] ?? 0

    const nonZeroModels = sortedModels.filter(m => m[1] > 0)
    const worstModel = nonZeroModels[nonZeroModels.length - 1]?.[0] ?? '—'
    const worstModelQty = nonZeroModels[nonZeroModels.length - 1]?.[1] ?? 0

    return { totalPlans, totalRevenue, topSubcat, topSubcatQty, topModel, topModelQty, worstModel, worstModelQty, planBreakdown }
  }, [filteredRecords])

  // 5. 6 Months Trend Graph data (uses last 6 months, respects plan + state filters only)
  const trendData = useMemo(() => {
    const last6Months = months.slice(-6)
    const matrix: Record<string, Record<string, number>> = {}
    for (const m of last6Months) {
      matrix[m] = {}
      for (const s of subcats) matrix[m][s] = 0
    }
    for (const r of data) {
      if (!last6Months.includes(r.month)) continue
      if (activePlan && r.plan !== activePlan) continue
      if (effectiveState && r.state !== effectiveState) continue
      matrix[r.month][r.subcat] = (matrix[r.month][r.subcat] || 0) + r.plans_sold
    }
    return last6Months.map(m => {
      const row: Record<string, any> = { month: m }
      for (const s of subcats) row[s] = matrix[m][s]
      return row
    })
  }, [data, months, subcats, activePlan, effectiveState])

  // 6. Pie Chart — Plans sold per plan type (with revenue for hover)
  const PIE_PLAN_TYPES = ['SP', 'ADLD', 'COMBO', 'EW']
  const PIE_PLAN_COLORS = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b']

  const pieData = useMemo(() => {
    const planPlans: Record<string, number> = {}
    const planRevenue: Record<string, number> = {}
    for (const p of PIE_PLAN_TYPES) { planPlans[p] = 0; planRevenue[p] = 0 }

    for (const r of data) {
      if (activeMonth && activeMonth !== 'all' && r.month !== activeMonth) continue
      if (effectiveState && r.state !== effectiveState) continue
      if (PIE_PLAN_TYPES.includes(r.plan)) {
        planPlans[r.plan] += r.plans_sold
        planRevenue[r.plan] += r.revenue
      }
    }

    const labels = PIE_PLAN_TYPES.filter(p => planPlans[p] > 0)
    const values = labels.map(p => planPlans[p])
    const revenues = labels.map(p => planRevenue[p])
    const colors = labels.map(p => PIE_PLAN_COLORS[PIE_PLAN_TYPES.indexOf(p)])

    return { labels, values, revenues, colors }
  }, [data, activeMonth, effectiveState])

  // 7. Heatmap State Metrics
  const geoStateNames = useMemo<string[]>(() => {
    if (!geojson) return []
    let pk = 'NAME_1'
    const props = geojson.features?.[0]?.properties ?? {}
    for (const k of ['NAME_1', 'ST_NM', 'name', 'Name', 'STATE', 'statename']) {
      if (props[k] !== undefined) { pk = k; break }
    }
    return geojson.features.map((f: any) => f.properties[pk] as string).filter(Boolean)
  }, [geojson])

  const heatmapTraces = useMemo(() => {
    if (!geojson) return []
    const statePlans: Record<string, number> = {}
    for (const r of filteredRecords) {
      statePlans[r.state] = (statePlans[r.state] || 0) + r.plans_sold
    }

    const locations: string[] = []
    const zValues: number[] = []
    const hoverTexts: string[] = []
    const matchedStates = new Set<string>()

    // Also sum revenue per state
    const stateRevenue: Record<string, number> = {}
    for (const r of filteredRecords) {
      stateRevenue[r.state] = (stateRevenue[r.state] || 0) + r.revenue
    }

    for (const [ourState, qty] of Object.entries(statePlans)) {
      const geoName = matchGeoName(ourState, geoStateNames)
      if (geoName) {
        locations.push(geoName)
        zValues.push(qty)
        const rev = stateRevenue[ourState] ?? 0
        hoverTexts.push(
          `<b>${ourState}</b><br>Plans Sold: ${qty.toLocaleString()}<br>Revenue: ₹${rev.toLocaleString('en-IN')}<br><i>Click to filter table</i>`
        )
        matchedStates.add(geoName)
      }
    }

    const unmatched = geoStateNames.filter(n => !matchedStates.has(n))
    const bgTrace = {
      type: 'choropleth',
      geojson,
      featureidkey: 'properties.NAME_1',
      locations: unmatched,
      z: unmatched.map(() => 0),
      colorscale: [[0, '#f1f5f9'], [1, '#f1f5f9']],
      showscale: false,
      hovertemplate: '<b>%{location}</b><br>No active sales<extra></extra>',
      marker: { line: { color: '#ffffff', width: 0.8 } },
    }
    const valueTrace = {
      type: 'choropleth',
      geojson,
      featureidkey: 'properties.NAME_1',
      locations,
      z: zValues,
      text: hoverTexts,
      hovertemplate: '%{text}<extra></extra>',
      colorscale: [
        [0,   '#eff6ff'],
        [0.2, '#bfdbfe'],
        [0.4, '#60a5fa'],
        [0.6, '#3b82f6'],
        [0.8, '#1d4ed8'],
        [1.0, '#1e3a8a'],
      ],
      colorbar: { thickness: 10, len: 0.5, tickfont: { size: 9, color: '#64748b' }, bgcolor: 'rgba(0,0,0,0)' },
      marker: { line: { color: '#ffffff', width: 0.8 } },
    }

    let ringTrace = null
    if (selectedState) {
      const geoSel = matchGeoName(selectedState, geoStateNames)
      if (geoSel) {
        ringTrace = {
          type: 'choropleth',
          geojson,
          featureidkey: 'properties.NAME_1',
          locations: [geoSel],
          z: [1],
          colorscale: [[0, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0)']],
          showscale: false,
          hoverinfo: 'skip',
          marker: { line: { color: '#ef4444', width: 2 } },
        }
      }
    }

    return ringTrace ? [bgTrace, valueTrace, ringTrace] : [bgTrace, valueTrace]
  }, [geojson, geoStateNames, filteredRecords, selectedState])

  // 8. Detailed Table — State | City | Store | Plans | Model | Subcategory
  const tableRows = useMemo(() => {
    // Aggregate by (state, city, store, model, subcat)
    const aggs: Record<string, {
      state: string; city: string; store: string;
      model: string; subcat: string;
      plans_sold: number; revenue: number
    }> = {}

    for (const r of filteredRecords) {
      const abbr = abbreviateModel(r.model)
      // city & store fields: API may not provide them; gracefully fallback
      const city = (r as any).city ?? ''
      const store = (r as any).store ?? ''
      const key = `${r.state}|||${city}|||${store}|||${abbr}|||${r.subcat}`
      if (!aggs[key]) {
        aggs[key] = { state: r.state, city, store, model: abbr, subcat: r.subcat, plans_sold: 0, revenue: 0 }
      }
      aggs[key].plans_sold += r.plans_sold
      aggs[key].revenue += r.revenue
    }

    let rows = Object.values(aggs)

    const q = searchQuery.toLowerCase().trim()
    if (q) {
      rows = rows.filter(r =>
        r.model.toLowerCase().includes(q) ||
        r.subcat.toLowerCase().includes(q) ||
        r.state.toLowerCase().includes(q) ||
        r.city.toLowerCase().includes(q) ||
        r.store.toLowerCase().includes(q)
      )
    }

    rows.sort((a, b) => {
      const valA = (a as any)[sortKey]
      const valB = (b as any)[sortKey]
      if (typeof valA === 'string') {
        return sortDir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA)
      }
      return sortDir === 'asc' ? valA - valB : valB - valA
    })

    return rows
  }, [filteredRecords, searchQuery, sortKey, sortDir])

  const paginatedRows = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE
    return tableRows.slice(start, start + PAGE_SIZE)
  }, [tableRows, page])

  const totalPages = Math.ceil(tableRows.length / PAGE_SIZE) || 1

  const handleSort = (key: typeof sortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
    setPage(1)
  }

  const handleMapClick = (evt: any) => {
    const pt = evt?.points?.[0]
    if (!pt) return
    const matched = data.find(r => matchGeoName(r.state, geoStateNames) === pt.location)
    if (matched) {
      setSelectedState(s => s === matched.state ? null : matched.state)
      setPage(1)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[500px] gap-3 text-gray-400 text-sm">
        <div className="h-6 w-6 rounded-full border-2 border-gray-200 border-t-blue-600 animate-spin" />
        Aggregating Model and Subcategory insights…
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-[500px] text-red-500 text-sm">
        <AlertTriangle className="h-5 w-5 text-red-500 mr-2" />
        {error}
      </div>
    )
  }

  const CHART_COLORS = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ec4899', '#06b6d4', '#f97316', '#84cc16', '#a855f7']

  return (
    <div className="space-y-6">

      {/* Active Filter Badge (map click state) */}
      {selectedState && (
        <div className="flex items-center gap-2 text-xs">
          <MapPin className="h-3.5 w-3.5 text-blue-500" />
          <span className="text-gray-600 font-medium">Filtered by state:</span>
          <span className="bg-blue-50 border border-blue-200 text-blue-700 px-2.5 py-0.5 rounded-full font-semibold">{selectedState}</span>
          <button
            onClick={() => setSelectedState(null)}
            className="text-gray-400 hover:text-red-500 transition-colors text-[11px]"
          >✕ Clear</button>
        </div>
      )}

      {/* KPI Row */}
      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4"
      >
        <motion.div variants={cardItem} className="rounded-xl bg-white border border-gray-100 shadow-sm p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold tracking-wider text-gray-500 uppercase">Plans Sold</p>
            <Activity className="h-4 w-4 text-blue-500" />
          </div>
          <div className="mt-3">
            <h3 className="text-2xl font-bold text-gray-900">{kpis.totalPlans.toLocaleString()}</h3>
            <p className="text-[10px] text-gray-400 mt-1">{activeMonth && activeMonth !== 'all' ? `For ${activeMonth}` : 'Across all months'}</p>
          </div>
        </motion.div>

        <motion.div variants={cardItem} className="rounded-xl bg-white border border-gray-100 shadow-sm p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold tracking-wider text-gray-500 uppercase">Top Subcategory</p>
            <Activity className="h-4 w-4 text-emerald-500" />
          </div>
          <div className="mt-3">
            <h3 className="text-lg font-bold text-gray-900 truncate">{kpis.topSubcat}</h3>
            <p className="text-xs font-semibold text-emerald-600 mt-0.5">{kpis.topSubcatQty.toLocaleString()} units sold</p>
          </div>
        </motion.div>

        <motion.div variants={cardItem} className="rounded-xl bg-white border border-gray-100 shadow-sm p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold tracking-wider text-gray-500 uppercase">Top Model Focus</p>
            <TrendingUp className="h-4 w-4 text-purple-500" />
          </div>
          <div className="mt-3">
            <h3 className="text-lg font-bold text-gray-900 truncate">{kpis.topModel}</h3>
            <p className="text-xs font-semibold text-purple-600 mt-0.5">{kpis.topModelQty.toLocaleString()} units sold</p>
          </div>
        </motion.div>

        <motion.div variants={cardItem} className="rounded-xl bg-white border border-gray-100 shadow-sm p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold tracking-wider text-gray-500 uppercase">Least Selling Model</p>
            <AlertTriangle className="h-4 w-4 text-amber-500" />
          </div>
          <div className="mt-3">
            <h3 className="text-lg font-bold text-gray-900 truncate">{kpis.worstModel}</h3>
            <p className="text-xs font-semibold text-amber-600 mt-0.5">{kpis.worstModelQty.toLocaleString()} units sold</p>
          </div>
        </motion.div>
      </motion.div>

      {/* ── Row 1: Trend (left) + Radar (right) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Past 6 Months Trend */}
        <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
          <div className="border-b border-gray-50 pb-3 mb-4">
            <h3 className="text-sm font-bold text-gray-900">Past 6 Months Trend — Plan Category Sales</h3>
            <p className="text-[10px] text-gray-400 mt-0.5">Plan sales volume trend split by product subcategories.</p>
          </div>
          <div className="h-[340px]">
            {trendData.length === 0 ? (
              <div className="flex items-center justify-center h-full text-xs text-gray-400">
                No historical data in scope.
              </div>
            ) : (
              <Plot
                data={subcats.map((s, idx) => {
                  // Build revenue array in parallel for hover
                  const revByMonth: Record<string, number> = {}
                  for (const r of data) {
                    if (months.slice(-6).includes(r.month) && r.subcat === s) {
                      if (activePlan && r.plan !== activePlan) continue
                      if (effectiveState && r.state !== effectiveState) continue
                      revByMonth[r.month] = (revByMonth[r.month] || 0) + r.revenue
                    }
                  }
                  return {
                    type: 'bar',
                    name: s,
                    x: trendData.map(d => d.month),
                    y: trendData.map(d => d[s] ?? 0),
                    marker: { color: CHART_COLORS[idx % CHART_COLORS.length] },
                    customdata: trendData.map(d => (revByMonth[d.month] ?? 0)),
                    hovertemplate:
                      `<b>${s}</b><br>Month: %{x}<br>Plans Sold: <b>%{y:,}</b><br>Revenue: <b>₹%{customdata:,.0f}</b><extra></extra>`,
                  }
                })}
                layout={{
                  barmode: 'stack',
                  paper_bgcolor: 'rgba(0,0,0,0)',
                  plot_bgcolor: 'rgba(0,0,0,0)',
                  font: { family: 'Inter, sans-serif', size: 10 },
                  margin: { l: 40, r: 10, t: 10, b: 40 },
                  height: 340,
                  xaxis: { gridcolor: '#f1f5f9', tickfont: { size: 9 } },
                  yaxis: { gridcolor: '#f1f5f9', tickfont: { size: 9 }, title: { text: 'Plans Sold', font: { size: 9 } } },
                  legend: { orientation: 'h', y: -0.18, font: { size: 9 } },
                  hoverlabel: { bgcolor: '#1e293b', bordercolor: '#1e293b', font: { color: '#f8fafc', size: 11 } },
                } as any}
                config={{ displayModeBar: false, responsive: true }}
                style={{ width: '100%', height: '100%' }}
              />
            )}
          </div>
        </div>

        {/* Pie Chart — Plan Type Distribution */}
        <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
          <div className="border-b border-gray-50 pb-3 mb-4">
            <h3 className="text-sm font-bold text-gray-900">Plan Type Distribution</h3>
            <p className="text-[10px] text-gray-400 mt-0.5">Share of total plans sold across SP, ADLD, COMBO and EW plan types.</p>
          </div>
          <div className="h-[340px]">
            {pieData.labels.length === 0 ? (
              <div className="flex items-center justify-center h-full text-xs text-gray-400">
                No data available for filters.
              </div>
            ) : (
              <Plot
                data={[{
                  type: 'pie',
                  labels: pieData.labels,
                  values: pieData.values,
                  hole: 0.45,
                  marker: {
                    colors: pieData.colors,
                    line: { color: '#ffffff', width: 2 },
                  },
                  textinfo: 'label+percent',
                  textfont: { size: 11, family: 'Inter, sans-serif' },
                  customdata: pieData.revenues,
                  hovertemplate:
                    '<b>%{label}</b><br>' +
                    'Plans Sold: <b>%{value:,}</b><br>' +
                    'Share: <b>%{percent}</b><br>' +
                    'Revenue: <b>₹%{customdata:,.0f}</b>' +
                    '<extra></extra>',
                  pull: pieData.labels.map(() => 0.02),
                }]}
                layout={{
                  paper_bgcolor: 'rgba(0,0,0,0)',
                  plot_bgcolor: 'rgba(0,0,0,0)',
                  font: { family: 'Inter, sans-serif', size: 10 },
                  margin: { l: 10, r: 10, t: 10, b: 10 },
                  height: 340,
                  showlegend: true,
                  legend: { orientation: 'h', y: -0.08, font: { size: 10 } },
                  hoverlabel: { bgcolor: '#1e293b', bordercolor: '#1e293b', font: { color: '#f8fafc', size: 11 } },
                } as any}
                config={{ displayModeBar: false, responsive: true }}
                style={{ width: '100%', height: '100%' }}
              />
            )}
          </div>
        </div>
      </div>

      {/* ── Row 2: Indian Heatmap (full width) ── */}
      <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
        <div className="flex items-center justify-between border-b border-gray-50 pb-3 mb-4">
          <div>
            <h3 className="text-sm font-bold text-gray-900">Geographical Performance Heatmap</h3>
            <p className="text-[10px] text-gray-400 mt-0.5">Plan units sold state-wise. Click a state to filter the table below.</p>
          </div>
          {selectedState && (
            <button
              onClick={() => setSelectedState(null)}
              className="text-[10px] font-medium px-2 py-0.5 rounded bg-blue-50 text-blue-600 hover:bg-blue-100"
            >
              Clear State filter
            </button>
          )}
        </div>
        <div className="h-[480px] flex items-center justify-center relative">
          {geoLoading ? (
            <div className="text-xs text-gray-400">Loading map...</div>
          ) : heatmapTraces.length === 0 ? (
            <div className="text-xs text-gray-400">No geographical matches for filters.</div>
          ) : (
            <Plot
              data={heatmapTraces as any}
              layout={{
                paper_bgcolor: 'rgba(0,0,0,0)',
                plot_bgcolor: 'rgba(0,0,0,0)',
                font: { family: 'Inter, sans-serif', size: 10 },
                geo: GEO_LAYOUT,
                margin: { l: 0, r: 0, t: 0, b: 0 },
                height: 480,
              } as any}
              config={{ displayModeBar: false, responsive: true }}
              onClick={handleMapClick}
              style={{ width: '100%', height: '100%' }}
            />
          )}
        </div>
      </div>

      {/* ── Row 3: Drilldown Table ── */}
      <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">

        {/* Table Header & Search */}
        <div className="px-5 py-4 border-b border-gray-50 flex flex-wrap gap-4 items-center justify-between bg-gray-50/50">
          <div>
            <h3 className="text-sm font-bold text-gray-900">Detailed Sales Drilldown</h3>
            <p className="text-[10px] text-gray-500 mt-0.5">State → City → Store → Plans → Model → Subcategory. Click column headers to sort.</p>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-gray-400" />
            <input
              type="text"
              placeholder="Search state, model, subcat..."
              value={searchQuery}
              onChange={e => { setSearchQuery(e.target.value); setPage(1) }}
              className="pl-8 pr-4 py-1.5 text-xs bg-white border border-gray-200 rounded-lg w-64 focus:outline-none focus:ring-1 focus:ring-blue-500 font-medium"
            />
          </div>
        </div>

        {/* Table content */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                <th className="px-5 py-3 cursor-pointer select-none hover:bg-gray-100" onClick={() => handleSort('state')}>
                  State {sortKey === 'state' && (sortDir === 'asc' ? '▲' : '▼')}
                </th>
                <th className="px-5 py-3 cursor-pointer select-none hover:bg-gray-100" onClick={() => handleSort('city')}>
                  City {sortKey === 'city' && (sortDir === 'asc' ? '▲' : '▼')}
                </th>
                <th className="px-5 py-3 cursor-pointer select-none hover:bg-gray-100" onClick={() => handleSort('store')}>
                  Store {sortKey === 'store' && (sortDir === 'asc' ? '▲' : '▼')}
                </th>
                <th className="px-5 py-3 text-right cursor-pointer select-none hover:bg-gray-100" onClick={() => handleSort('plans_sold')}>
                  Plans {sortKey === 'plans_sold' && (sortDir === 'asc' ? '▲' : '▼')}
                </th>
                <th className="px-5 py-3 cursor-pointer select-none hover:bg-gray-100" onClick={() => handleSort('model')}>
                  Model Name {sortKey === 'model' && (sortDir === 'asc' ? '▲' : '▼')}
                </th>
                <th className="px-5 py-3 cursor-pointer select-none hover:bg-gray-100" onClick={() => handleSort('subcat')}>
                  Product Subcategory {sortKey === 'subcat' && (sortDir === 'asc' ? '▲' : '▼')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-xs text-gray-700">
              {paginatedRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-10 text-center text-gray-400">
                    No records match the current filters.
                  </td>
                </tr>
              ) : (
                paginatedRows.map((r, idx) => (
                  <tr key={idx} className="hover:bg-gray-50/70 transition-colors font-medium">
                    <td className="px-5 py-3.5 text-gray-700 font-semibold">{r.state || '—'}</td>
                    <td className="px-5 py-3.5 text-gray-500">{r.city || '—'}</td>
                    <td className="px-5 py-3.5 text-gray-500 max-w-[160px] truncate" title={r.store}>{r.store || '—'}</td>
                    <td className="px-5 py-3.5 text-right font-bold text-gray-900">{r.plans_sold.toLocaleString()}</td>
                    <td className="px-5 py-3.5 text-gray-900 font-semibold">{r.model}</td>
                    <td className="px-5 py-3.5">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-100">
                        {r.subcat}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500 bg-gray-50/50">
            <span>Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, tableRows.length)} of {tableRows.length} entries</span>
            <div className="flex items-center gap-1">
              <button
                disabled={page === 1}
                onClick={() => setPage(p => p - 1)}
                className="px-2.5 py-1 rounded border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >Previous</button>
              <span className="px-3 py-1 font-semibold text-gray-700 bg-gray-100 rounded">{page} / {totalPages}</span>
              <button
                disabled={page === totalPages}
                onClick={() => setPage(p => p + 1)}
                className="px-2.5 py-1 rounded border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >Next</button>
            </div>
          </div>
        )}
      </div>

    </div>
  )
}
