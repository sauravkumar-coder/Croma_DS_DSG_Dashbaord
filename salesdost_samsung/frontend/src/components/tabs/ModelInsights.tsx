import { useEffect, useMemo, useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import createPlotlyComponent from 'react-plotly.js/factory'
// @ts-ignore — plotly.js-dist-min does not ship its own .d.ts
import Plotly from 'plotly.js-dist-min'
import { useRetailerContext } from '@/contexts/RetailerContext'
import { getModelInsights, ModelInsightRecord } from '@/lib/api'
import { fmtInr } from '@/lib/formatting'
import { cn } from '@/lib/utils'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select'
import {
  Activity,
  TrendingUp,
  AlertTriangle,
  Search,
  Filter,
  Calendar,
  Layers,
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
  
  // Local filters
  const [selectedMonth, setSelectedMonth] = useState<string>('all')
  const [selectedPlan, setSelectedPlan] = useState<string>('all')
  const [selectedSubcat, setSelectedSubcat] = useState<string>('all')
  const [selectedState, setSelectedState] = useState<string | null>(null)
  
  // GeoJSON state
  const [geojson, setGeojson] = useState<any>(null)
  const [geoLoading, setGeoLoading] = useState(true)
  
  // Search input for model list
  const [searchQuery, setSearchQuery] = useState('')
  const [sortKey, setSortKey] = useState<'model' | 'subcat' | 'plan' | 'plans_sold' | 'revenue'>('plans_sold')
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

  // 3. Extract unique dropdown items chronologically
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

  const plans = useMemo(() => {
    const set = new Set(data.map(d => d.plan))
    return Array.from(set).filter(Boolean).sort()
  }, [data])

  // Set default month when data loads
  useEffect(() => {
    if (months.length > 0 && selectedMonth === 'all') {
      setSelectedMonth(months[months.length - 1]) // Default to latest month
    }
  }, [months, selectedMonth])

  // ── Data aggregations ──────────────────────────────────────────────────────
  
  // Filter records based on UI controls
  const filteredRecords = useMemo(() => {
    return data.filter(d => {
      if (selectedMonth !== 'all' && d.month !== selectedMonth) return false
      if (selectedPlan !== 'all' && d.plan !== selectedPlan) return false
      if (selectedSubcat !== 'all' && d.subcat !== selectedSubcat) return false
      if (selectedState && d.state !== selectedState) return false
      return true
    })
  }, [data, selectedMonth, selectedPlan, selectedSubcat, selectedState])

  // 4. KPI Card metrics
  const kpis = useMemo(() => {
    // Sum plans by subcat
    const subcatPlans: Record<string, number> = {}
    const modelPlans: Record<string, number> = {}
    let totalPlans = 0
    let totalRevenue = 0

    for (const r of filteredRecords) {
      totalPlans += r.plans_sold
      totalRevenue += r.revenue
      
      subcatPlans[r.subcat] = (subcatPlans[r.subcat] || 0) + r.plans_sold
      modelPlans[r.model] = (modelPlans[r.model] || 0) + r.plans_sold
    }

    const sortedSubcats = Object.entries(subcatPlans).sort((a, b) => b[1] - a[1])
    const sortedModels = Object.entries(modelPlans).sort((a, b) => b[1] - a[1])

    const topSubcat = sortedSubcats[0]?.[0] ?? '—'
    const topSubcatQty = sortedSubcats[0]?.[1] ?? 0
    const topModel = sortedModels[0]?.[0] ?? '—'
    const topModelQty = sortedModels[0]?.[1] ?? 0
    
    // Worst model (least plans sold, excluding 0)
    const nonZeroModels = sortedModels.filter(m => m[1] > 0)
    const worstModel = nonZeroModels[nonZeroModels.length - 1]?.[0] ?? '—'
    const worstModelQty = nonZeroModels[nonZeroModels.length - 1]?.[1] ?? 0

    return {
      totalPlans,
      totalRevenue,
      topSubcat,
      topSubcatQty,
      topModel,
      topModelQty,
      worstModel,
      worstModelQty
    }
  }, [filteredRecords])

  // 5. 6 Months Trend Graph data
  const trendData = useMemo(() => {
    // Get last 6 months list
    const last6Months = months.slice(-6)
    
    // Group plans by month and subcategory
    const matrix: Record<string, Record<string, number>> = {}
    for (const m of last6Months) {
      matrix[m] = {}
      for (const s of subcats) {
        matrix[m][s] = 0
      }
    }

    for (const r of data) {
      if (last6Months.includes(r.month)) {
        if (selectedPlan !== 'all' && r.plan !== selectedPlan) continue
        if (selectedState && r.state !== selectedState) continue
        matrix[r.month][r.subcat] = (matrix[r.month][r.subcat] || 0) + r.plans_sold
      }
    }

    return last6Months.map(m => {
      const row: Record<string, any> = { month: m }
      for (const s of subcats) {
        row[s] = matrix[m][s]
      }
      return row
    })
  }, [data, months, subcats, selectedPlan, selectedState])

  // 6. Radar Graph data (Plan Type distribution by Subcategory)
  const radarTraces = useMemo(() => {
    const radarPlanTypes = ['SP', 'ADLD', 'COMBO', 'EW']
    
    // Group plans by subcat and planType
    const matrix: Record<string, Record<string, number>> = {}
    for (const s of subcats) {
      matrix[s] = {}
      for (const p of radarPlanTypes) {
        matrix[s][p] = 0
      }
    }

    // Accumulate filtered by month/state
    for (const r of data) {
      if (selectedMonth !== 'all' && r.month !== selectedMonth) continue
      if (selectedState && r.state !== selectedState) continue
      if (matrix[r.subcat] && r.plan in matrix[r.subcat]) {
        matrix[r.subcat][r.plan] += r.plans_sold
      }
    }

    return subcats.map((s, idx) => {
      const rValues = radarPlanTypes.map(p => matrix[s][p])
      // Plotly polar graphs require closed loop
      const closedR = [...rValues, rValues[0]]
      const closedTheta = [...radarPlanTypes, radarPlanTypes[0]]

      const colors = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ec4899']
      
      return {
        type: 'scatterpolar',
        r: closedR,
        theta: closedTheta,
        fill: 'toself',
        name: s,
        line: { color: colors[idx % colors.length], width: 1.5 },
        marker: { size: 4 },
        opacity: 0.6
      }
    })
  }, [data, subcats, selectedMonth, selectedState])

  // 7. Heatmap State Metrics
  const geoStateNames = useMemo<string[]>(() => {
    if (!geojson) return []
    // Detect feature ID key dynamically
    let pk = 'NAME_1'
    const props = geojson.features?.[0]?.properties ?? {}
    for (const k of ['NAME_1', 'ST_NM', 'name', 'Name', 'STATE', 'statename']) {
      if (props[k] !== undefined) {
        pk = k
        break
      }
    }
    return geojson.features.map((f: any) => f.properties[pk] as string).filter(Boolean)
  }, [geojson])

  const heatmapTraces = useMemo(() => {
    if (!geojson) return []

    // Sum plans by state
    const statePlans: Record<string, number> = {}
    for (const r of filteredRecords) {
      statePlans[r.state] = (statePlans[r.state] || 0) + r.plans_sold
    }

    // Map database states to GeoJSON states
    const locations: string[] = []
    const zValues: number[] = []
    const hoverTexts: string[] = []

    const matchedStates = new Set<string>()

    for (const [ourState, qty] of Object.entries(statePlans)) {
      const geoName = matchGeoName(ourState, geoStateNames)
      if (geoName) {
        locations.push(geoName)
        zValues.push(qty)
        hoverTexts.push(`<b>${ourState}</b><br>Plans Sold: ${qty.toLocaleString()} units<br>Click to filter table`)
        matchedStates.add(geoName)
      }
    }

    // Add unmapped states as light gray background
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
      marker: { line: { color: '#ffffff', width: 0.8 } }
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
        [0, '#eff6ff'],
        [0.2, '#bfdbfe'],
        [0.4, '#60a5fa'],
        [0.6, '#3b82f6'],
        [0.8, '#1d4ed8'],
        [1.0, '#1e3a8a']
      ],
      colorbar: {
        thickness: 10,
        len: 0.5,
        tickfont: { size: 9, color: '#64748b' },
        bgcolor: 'rgba(0,0,0,0)'
      },
      marker: { line: { color: '#ffffff', width: 0.8 } }
    }

    // Optional ring for currently selected state
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
          marker: { line: { color: '#ef4444', width: 2 } }
        }
      }
    }

    return ringTrace ? [bgTrace, valueTrace, ringTrace] : [bgTrace, valueTrace]
  }, [geojson, geoStateNames, filteredRecords, selectedState])

  // 8. Detailed Table data
  const tableRows = useMemo(() => {
    // Aggregate by model/subcat/plan
    const aggs: Record<string, { model: string; subcat: string; plan: string; plans_sold: number; revenue: number }> = {}
    
    for (const r of filteredRecords) {
      const key = `${r.model}|||${r.subcat}|||${r.plan}`
      if (!aggs[key]) {
        aggs[key] = {
          model: r.model,
          subcat: r.subcat,
          plan: r.plan,
          plans_sold: 0,
          revenue: 0.0
        }
      }
      aggs[key].plans_sold += r.plans_sold
      aggs[key].revenue += r.revenue
    }

    let rows = Object.values(aggs)

    // Search query filter
    const q = searchQuery.toLowerCase().trim()
    if (q) {
      rows = rows.filter(r => 
        r.model.toLowerCase().includes(q) || 
        r.subcat.toLowerCase().includes(q)
      )
    }

    // Sorting
    rows.sort((a, b) => {
      let valA = a[sortKey]
      let valB = b[sortKey]
      
      if (typeof valA === 'string') {
        return sortDir === 'asc' ? valA.localeCompare(valB as string) : (valB as string).localeCompare(valA)
      } else {
        return sortDir === 'asc' ? (valA as number) - (valB as number) : (valB as number) - (valA as number)
      }
    })

    return rows
  }, [filteredRecords, searchQuery, sortKey, sortDir])

  const paginatedRows = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE
    return tableRows.slice(start, start + PAGE_SIZE)
  }, [tableRows, page])

  const totalPages = Math.ceil(tableRows.length / PAGE_SIZE) || 1

  const handleSort = (key: any) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
    setPage(1)
  }

  // Handle heatmap click to filter table/state
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

  return (
    <div className="space-y-6">
      
      {/* Filters Toolbar */}
      <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm flex flex-wrap gap-4 items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-semibold text-gray-700">
          <Filter className="h-3.5 w-3.5 text-gray-500" />
          <span>INSIGHT FILTERS</span>
        </div>
        
        <div className="flex items-center gap-3 flex-wrap">
          
          {/* Month */}
          <div className="flex items-center gap-1.5">
            <Calendar className="h-3.5 w-3.5 text-gray-400" />
            <Select value={selectedMonth} onValueChange={v => { setSelectedMonth(v); setPage(1); }}>
              <SelectTrigger className="h-8 w-36 text-xs bg-gray-50 font-medium">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Months</SelectItem>
                {months.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* Subcat */}
          <div className="flex items-center gap-1.5">
            <Layers className="h-3.5 w-3.5 text-gray-400" />
            <Select value={selectedSubcat} onValueChange={v => { setSelectedSubcat(v); setPage(1); }}>
              <SelectTrigger className="h-8 w-44 text-xs bg-gray-50 font-medium">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Subcategories</SelectItem>
                {subcats.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* Plan Type */}
          <div className="flex items-center gap-1.5">
            <Activity className="h-3.5 w-3.5 text-gray-400" />
            <Select value={selectedPlan} onValueChange={v => { setSelectedPlan(v); setPage(1); }}>
              <SelectTrigger className="h-8 w-36 text-xs bg-gray-50 font-medium">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Plan Types</SelectItem>
                {plans.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* State Filter Indicator */}
          {selectedState && (
            <div className="flex items-center gap-1 bg-blue-50 text-blue-700 text-xs px-2.5 py-1 rounded-full border border-blue-200">
              <MapPin className="h-3 w-3 shrink-0" />
              <span>{selectedState}</span>
              <button onClick={() => setSelectedState(null)} className="ml-1 text-[10px] text-blue-500 hover:text-blue-700">✕</button>
            </div>
          )}
        </div>
      </div>

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
            <p className="text-[10px] text-gray-400 mt-1">{selectedMonth === 'all' ? 'Across all months' : `For ${selectedMonth}`}</p>
          </div>
        </motion.div>

        <motion.div variants={cardItem} className="rounded-xl bg-white border border-gray-100 shadow-sm p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold tracking-wider text-gray-500 uppercase">Top Subcategory</p>
            <Layers className="h-4 w-4 text-emerald-500" />
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

      {/* Visualizations Row 1: Heatmap + Radar */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Heatmap */}
        <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
          <div className="flex items-center justify-between border-b border-gray-50 pb-3 mb-4">
            <div>
              <h3 className="text-sm font-bold text-gray-900">Geographical Performance Heatmap</h3>
              <p className="text-[10px] text-gray-400 mt-0.5">Plan units sold state-wise. Click a state to filter down metrics.</p>
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
          
          <div className="h-[420px] flex items-center justify-center relative">
            {geoLoading ? (
              <div className="text-xs text-gray-400">Loading map...</div>
            ) : heatmapTraces.length === 0 ? (
              <div className="text-xs text-gray-400">No geographical matches for filters.</div>
            ) : (
              <Plot
                data={heatmapTraces as any}
                layout={{
                  paper_bgcolor: 'rgba(0,0,0,0)',
                  plot_bgcolor:  'rgba(0,0,0,0)',
                  font: { family: 'Inter, sans-serif', size: 10 },
                  geo: GEO_LAYOUT,
                  margin: { l: 0, r: 0, t: 0, b: 0 },
                  height: 420
                } as any}
                config={{ displayModeBar: false, responsive: true }}
                onClick={handleMapClick}
                style={{ width: '100%', height: '100%' }}
              />
            )}
          </div>
        </div>

        {/* Radar Graph */}
        <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
          <div className="border-b border-gray-50 pb-3 mb-4">
            <h3 className="text-sm font-bold text-gray-900">Plan Type Radar Distribution</h3>
            <p className="text-[10px] text-gray-400 mt-0.5">Compares distribution of plan types sold under each subcategory.</p>
          </div>
          
          <div className="h-[420px]">
            {radarTraces.length === 0 ? (
              <div className="flex items-center justify-center h-full text-xs text-gray-400">
                No data available for filters.
              </div>
            ) : (
              <Plot
                data={radarTraces as any}
                layout={{
                  paper_bgcolor: 'rgba(0,0,0,0)',
                  plot_bgcolor:  'rgba(0,0,0,0)',
                  font: { family: 'Inter, sans-serif', size: 10 },
                  polar: {
                    radialaxis: { visible: true, showticklabels: true, tickfont: { size: 8 } },
                    angularaxis: { tickfont: { size: 9, color: '#64748b' } }
                  },
                  margin: { l: 40, r: 40, t: 20, b: 40 },
                  height: 420,
                  legend: { orientation: 'h', y: -0.1 }
                } as any}
                config={{ displayModeBar: false, responsive: true }}
                style={{ width: '100%', height: '100%' }}
              />
            )}
          </div>
        </div>
      </div>

      {/* Visualizations Row 2: 6 Months Trend */}
      <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
        <div className="border-b border-gray-50 pb-3 mb-4">
          <h3 className="text-sm font-bold text-gray-900">Past 6 Months Trend — Plan Category Sales</h3>
          <p className="text-[10px] text-gray-400 mt-0.5">Plan Sales volume trend split by product subcategories.</p>
        </div>

        <div className="h-[300px]">
          {trendData.length === 0 ? (
            <div className="flex items-center justify-center h-full text-xs text-gray-400">
              No historical data in scope.
            </div>
          ) : (
            <Plot
              data={subcats.map((s, idx) => {
                const colors = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ec4899']
                return {
                  type: 'bar',
                  name: s,
                  x: trendData.map(d => d.month),
                  y: trendData.map(d => d[s] ?? 0),
                  marker: { color: colors[idx % colors.length] }
                }
              })}
              layout={{
                barmode: 'stack',
                paper_bgcolor: 'rgba(0,0,0,0)',
                plot_bgcolor:  'rgba(0,0,0,0)',
                font: { family: 'Inter, sans-serif', size: 10 },
                margin: { l: 40, r: 20, t: 10, b: 40 },
                height: 300,
                xaxis: { gridcolor: '#f1f5f9', tickfont: { size: 9 } },
                yaxis: { gridcolor: '#f1f5f9', tickfont: { size: 9 } },
                legend: { orientation: 'h', y: -0.15 }
              } as any}
              config={{ displayModeBar: false, responsive: true }}
              style={{ width: '100%', height: '100%' }}
            />
          )}
        </div>
      </div>

      {/* Model List Table */}
      <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
        
        {/* Table Header & Search */}
        <div className="px-5 py-4 border-b border-gray-50 flex flex-wrap gap-4 items-center justify-between bg-gray-50/50">
          <div>
            <h3 className="text-sm font-bold text-gray-900">Detailed Sales Performance List</h3>
            <p className="text-[10px] text-gray-500 mt-0.5">Granular model performance under the active filters.</p>
          </div>
          
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-gray-400" />
            <input
              type="text"
              placeholder="Search model name..."
              value={searchQuery}
              onChange={e => { setSearchQuery(e.target.value); setPage(1); }}
              className="pl-8 pr-4 py-1.5 text-xs bg-white border border-gray-200 rounded-lg w-56 focus:outline-none focus:ring-1 focus:ring-blue-500 font-medium"
            />
          </div>
        </div>

        {/* Table content */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                <th className="px-6 py-3 cursor-pointer select-none hover:bg-gray-100" onClick={() => handleSort('model')}>
                  Model {sortKey === 'model' && (sortDir === 'asc' ? '▲' : '▼')}
                </th>
                <th className="px-6 py-3 cursor-pointer select-none hover:bg-gray-100" onClick={() => handleSort('subcat')}>
                  Subcategory {sortKey === 'subcat' && (sortDir === 'asc' ? '▲' : '▼')}
                </th>
                <th className="px-6 py-3 cursor-pointer select-none hover:bg-gray-100" onClick={() => handleSort('plan')}>
                  Plan Type {sortKey === 'plan' && (sortDir === 'asc' ? '▲' : '▼')}
                </th>
                <th className="px-6 py-3 text-right cursor-pointer select-none hover:bg-gray-100" onClick={() => handleSort('plans_sold')}>
                  Plans Sold {sortKey === 'plans_sold' && (sortDir === 'asc' ? '▲' : '▼')}
                </th>
                <th className="px-6 py-3 text-right cursor-pointer select-none hover:bg-gray-100" onClick={() => handleSort('revenue')}>
                  Revenue {sortKey === 'revenue' && (sortDir === 'asc' ? '▲' : '▼')}
                </th>
                <th className="px-6 py-3 text-right font-bold uppercase">Avg ticket price</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-xs text-gray-700">
              {paginatedRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-10 text-center text-gray-400">
                    No models found matching the search query or filters.
                  </td>
                </tr>
              ) : (
                paginatedRows.map((r, idx) => {
                  const avgPrice = r.plans_sold > 0 ? r.revenue / r.plans_sold : 0
                  return (
                    <tr key={idx} className="hover:bg-gray-50/70 transition-colors font-medium">
                      <td className="px-6 py-3.5 text-gray-900 font-semibold">{r.model}</td>
                      <td className="px-6 py-3.5 text-gray-500">{r.subcat}</td>
                      <td className="px-6 py-3.5">
                        <span className={cn(
                          "px-2 py-0.5 rounded text-[9px] font-bold border",
                          r.plan === 'SP' && "bg-blue-50 text-blue-700 border-blue-200",
                          r.plan === 'ADLD' && "bg-purple-50 text-purple-700 border-purple-200",
                          r.plan === 'COMBO' && "bg-emerald-50 text-emerald-700 border-emerald-200",
                          r.plan === 'EW' && "bg-amber-50 text-amber-700 border-amber-200"
                        )}>
                          {r.plan}
                        </span>
                      </td>
                      <td className="px-6 py-3.5 text-right font-bold text-gray-900">{r.plans_sold.toLocaleString()}</td>
                      <td className="px-6 py-3.5 text-right text-gray-800 font-semibold">{fmtInr(r.revenue)}</td>
                      <td className="px-6 py-3.5 text-right text-gray-500 font-semibold">{fmtInr(avgPrice)}</td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Table Pagination */}
        {totalPages > 1 && (
          <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500 bg-gray-50/50">
            <span>Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, tableRows.length)} of {tableRows.length} entries</span>
            
            <div className="flex items-center gap-1">
              <button
                disabled={page === 1}
                onClick={() => setPage(p => p - 1)}
                className="px-2.5 py-1 rounded border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Previous
              </button>
              <span className="px-3 py-1 font-semibold text-gray-700 bg-gray-100 rounded">
                {page} / {totalPages}
              </span>
              <button
                disabled={page === totalPages}
                onClick={() => setPage(p => p + 1)}
                className="px-2.5 py-1 rounded border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

    </div>
  )
}
