import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import createPlotlyComponent from 'react-plotly.js/factory'
// @ts-ignore — plotly.js-dist-min does not ship its own .d.ts
import Plotly from 'plotly.js-dist-min'
import { useDataContext } from '@/contexts/DataContext'
import type { FilterState } from '@/hooks/useFilters'
import type { StoreRecord } from '@/lib/api'
import { allocatePhases } from '@/lib/classificationEngine'
import type { StoreCategory } from '@/lib/classificationEngine'
import { fmtInr, fmtPct } from '@/lib/formatting'

const Plot = createPlotlyComponent(Plotly)

const GEO_URL = '/india-states.geojson'

// ── State centroids for bubble placement ──────────────────────────────────────
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

// ── Premium diverging growth colorscale ───────────────────────────────────────
const GROWTH_CS = [
  [0,    '#8B1E3F'],
  [0.25, '#D97757'],
  [0.5,  '#E5E7EB'],
  [0.75, '#7CC576'],
  [1,    '#145A32'],
]

// Plotly geo layout constants — shared across renders; never changes
const GEO_LAYOUT = {
  fitbounds:      false,
  bgcolor:        'rgba(0,0,0,0)',
  showframe:      false,
  showcoastlines: true,
  coastlinecolor: '#94a3b8',
  coastlinewidth: 0.6,
  showland:       true,
  landcolor:      '#EFF3F8',
  showocean:      true,
  oceancolor:     '#C7DFF7',
  showlakes:      true,
  lakecolor:      '#BAE6FD',
  showcountries:  true,
  countrycolor:   '#64748B',
  countrywidth:   0.8,
  showsubunits:   true,
  subunitcolor:   '#CBD5E1',
  subunitwidth:   0.5,
  projection:     { type: 'mercator' },
  lonaxis:        { range: [65, 100] },
  lataxis:        { range: [5, 40] },
} as const

// Empty choropleth for the selection ring when nothing is selected
const EMPTY_SEL_TRACE = {
  type:       'choropleth',
  locations:  [] as string[],
  z:          [] as number[],
  colorscale: [[0, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0)']],
  showscale:  false,
  hoverinfo:  'skip',
  marker:     { line: { color: '#F59E0B', width: 3 } },
} as const

// ── Helpers ───────────────────────────────────────────────────────────────────

function winRev(store: StoreRecord, months: string[]): number {
  return months.reduce((s, m) => s + (store.monthly_sales[m] ?? 0), 0)
}

function mAvg(store: StoreRecord, months: string[]): number {
  return months.length ? winRev(store, months) / months.length : 0
}

function matchGeoName(ourName: string, geoNames: string[]): string | null {
  if (geoNames.includes(ourName)) return ourName
  const lower = ourName.toLowerCase()
  return (
    geoNames.find(g => g.toLowerCase() === lower) ??
    geoNames.find(g => g.toLowerCase().startsWith(lower.split(' ')[0])) ??
    null
  )
}

function matchCentroid(state: string): [number, number] | null {
  if (STATE_CENTROIDS[state]) return STATE_CENTROIDS[state]
  const lower = state.toLowerCase()
  const key = Object.keys(STATE_CENTROIDS).find(k =>
    k.toLowerCase() === lower ||
    k.toLowerCase().replace(/[^a-z]/g, '').includes(lower.replace(/[^a-z]/g, '').slice(0, 5)),
  )
  return key ? STATE_CENTROIDS[key] : null
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface StateMetric {
  ourState:   string
  geoName:    string | null
  rev:        number
  count:      number
  topStore:   StoreRecord | null
  growth:     number | null
  earlyRev:   number
  midRev:     number
  recentRev:  number
  totalPlans: number
  catMix:     Partial<Record<StoreCategory, number>>
}

// ── Rich hover text builder ────────────────────────────────────────────────────
function buildHoverText(m: StateMetric): string {
  const growthColor = m.growth === null ? '#94a3b8'
    : m.growth > 10  ? '#4ade80'
    : m.growth > 0   ? '#86efac'
    : m.growth > -10 ? '#fca5a5'
    : '#f87171'

  const catParts = [
    m.catMix['Rising Star']     ? `⭐ Rising Stars: <b>${m.catMix['Rising Star']}</b>`    : '',
    m.catMix['New Bloomer']     ? `🌱 New Bloomers: <b>${m.catMix['New Bloomer']}</b>`    : '',
    m.catMix['Growing Store']   ? `📈 Growing: <b>${m.catMix['Growing Store']}</b>`        : '',
    m.catMix['Constant Store']  ? `➡️ Constant: <b>${m.catMix['Constant Store']}</b>`     : '',
    m.catMix['Declining Store'] ? `📉 Declining: <b>${m.catMix['Declining Store']}</b>`   : '',
    m.catMix['Fallen Star']     ? `💫 Fallen Stars: <b>${m.catMix['Fallen Star']}</b>`    : '',
    m.catMix['Inactive Store']  ? `⚪ Inactive: <b>${m.catMix['Inactive Store']}</b>`     : '',
  ].filter(Boolean)

  const divider = `<br><span style="color:#475569">──────────────────</span>`

  return (
    `<span style="font-size:14px;font-weight:700;color:#f8fafc;letter-spacing:0.01em">${m.ourState}</span>`
    + divider
    + `<br><span style="color:#94a3b8">Stores</span>  <span style="color:#f1f5f9;font-weight:600">${m.count}</span>`
    + `  <span style="color:#475569">·</span>  <span style="color:#94a3b8">Growth</span>  <span style="color:${growthColor};font-weight:700">${m.growth !== null ? fmtPct(m.growth) : 'N/A'}</span>`
    + `<br><span style="color:#94a3b8">Revenue</span>  <span style="color:#e2e8f0;font-weight:600">${fmtInr(m.rev)}</span>`
    + (m.totalPlans > 0
      ? `<br><span style="color:#94a3b8">Plans Sold</span>  <span style="color:#e2e8f0;font-weight:600">${m.totalPlans.toLocaleString()}</span>`
      : '')
    + divider
    + `<br><span style="color:#64748b;font-size:10px">PHASE BREAKDOWN</span>`
    + `<br><span style="color:#94a3b8">Early</span> <span style="color:#cbd5e1">${fmtInr(m.earlyRev)}</span>`
    + `  <span style="color:#475569">·</span>  <span style="color:#94a3b8">Mid</span> <span style="color:#cbd5e1">${fmtInr(m.midRev)}</span>`
    + `  <span style="color:#475569">·</span>  <span style="color:#94a3b8">Recent</span> <span style="color:#cbd5e1">${fmtInr(m.recentRev)}</span>`
    + (catParts.length
      ? divider
        + `<br><span style="color:#64748b;font-size:10px">STORE MIX</span>`
        + catParts.map(p => `<br><span style="color:#cbd5e1">${p}</span>`).join('')
      : '')
  )
}

// ── Component ─────────────────────────────────────────────────────────────────
interface Props { filters: FilterState }

export default function GeoAnalytics({ filters }: Props) {
  const { stores, months, classification } = useDataContext()

  const [geojson, setGeojson]       = useState<any>(null)
  const [geoLoading, setGeoLoading] = useState(true)
  const [geoError, setGeoError]     = useState<string | null>(null)
  const [selectedState, setSelectedState] = useState<string | null>(null)

  useEffect(() => {
    fetch(GEO_URL)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(data => { setGeojson(data); setGeoLoading(false) })
      .catch(e  => { setGeoError(e?.message ?? 'Failed'); setGeoLoading(false) })
  }, [])

  const featureidkey = useMemo(() => {
    if (!geojson?.features?.[0]) return 'properties.NAME_1'
    const props = geojson.features[0].properties ?? {}
    for (const k of ['NAME_1', 'ST_NM', 'name', 'Name', 'STATE', 'statename']) {
      if (props[k] !== undefined) return `properties.${k}`
    }
    return 'properties.NAME_1'
  }, [geojson])

  const geoStateNames = useMemo<string[]>(() => {
    if (!geojson) return []
    const pk = featureidkey.replace('properties.', '')
    return geojson.features.map((f: any) => f.properties[pk] as string).filter(Boolean)
  }, [geojson, featureidkey])

  // ── Filtered stores + months ───────────────────────────────────────────────
  const { fs, fm, early, mid, recent } = useMemo(() => {
    let fs = stores
    if (filters.state)    fs = fs.filter(s => s.state    === filters.state)
    if (filters.category) fs = fs.filter(s => s.category === filters.category)
    let fm = months
    if (filters.fromMonth) { const i = months.indexOf(filters.fromMonth); if (i >= 0) fm = fm.slice(i) }
    if (filters.toMonth)   { const i = months.indexOf(filters.toMonth);   if (i >= 0) fm = fm.slice(0, i + 1) }
    const { earlyMonths: early, midMonths: mid, recentMonths: recent } = allocatePhases(fm)
    return { fs, fm, early, mid, recent }
  }, [stores, months, filters])

  // ── Store classification for tooltip category mix ──────────────────────────
  // Uses the central classification (computed on full date range) so category
  // counts in tooltips are consistent with the Rising Stars / Fallen Stars pages.
  const stateCatMix = useMemo(() => {
    const mix: Record<string, Partial<Record<StoreCategory, number>>> = {}
    for (const m of classification.metrics) {
      const store = m.store
      if (filters.state && store.state !== filters.state) continue
      if (filters.category && store.category !== filters.category) continue
      const s = store.state ?? 'Unknown'
      if (!mix[s]) mix[s] = {}
      mix[s][m.category] = (mix[s][m.category] ?? 0) + 1
    }
    return mix
  }, [classification, filters.state, filters.category])

  // ── Per-state aggregations ─────────────────────────────────────────────────
  const stateMetrics = useMemo((): StateMetric[] => {
    const map: Record<string, {
      rev: number; count: number; topStore: StoreRecord | null;
      earlyRev: number; midRev: number; recentRev: number; totalPlans: number;
    }> = {}
    for (const store of fs) {
      const s = store.state ?? 'Unknown'
      if (!map[s]) map[s] = { rev: 0, count: 0, topStore: null, earlyRev: 0, midRev: 0, recentRev: 0, totalPlans: 0 }
      const r = winRev(store, fm)
      map[s].rev += r; map[s].count++
      if (!map[s].topStore || r > winRev(map[s].topStore!, fm)) map[s].topStore = store
      map[s].earlyRev  += winRev(store, early)
      map[s].midRev    += winRev(store, mid)
      map[s].recentRev += winRev(store, recent)
      const pc = store.monthly_plans_count ?? {}
      map[s].totalPlans += fm.reduce((sum, mo) => sum + (pc[mo] ?? 0), 0)
    }
    return Object.entries(map).map(([ourState, d]) => ({
      ourState,
      geoName:    geoStateNames.length ? matchGeoName(ourState, geoStateNames) : ourState,
      rev:        d.rev,
      count:      d.count,
      topStore:   d.topStore,
      growth:     d.earlyRev > 0 ? (d.recentRev - d.earlyRev) / d.earlyRev * 100 : null,
      earlyRev:   d.earlyRev,
      midRev:     d.midRev,
      recentRev:  d.recentRev,
      totalPlans: d.totalPlans,
      catMix:     stateCatMix[ourState] ?? {},
    }))
  }, [fs, fm, early, mid, recent, geoStateNames, stateCatMix])

  // ── Base traces — stable; does NOT depend on selectedState ────────────────
  // This memo only invalidates on data/filter changes, not on state clicks.
  // Keeps the expensive choropleth and bubble traces stable between selections.
  const baseTraces = useMemo((): any[] | null => {
    if (!geojson) return null

    const matched         = stateMetrics.filter(m => m.geoName !== null)
    const matchedGeoNames = matched.map(m => m.geoName as string)
    const unmatched       = geoStateNames.filter(n => !matchedGeoNames.includes(n))

    const bgTrace = {
      type:         'choropleth',
      geojson,
      featureidkey,
      locations:    unmatched,
      z:            unmatched.map(() => 0),
      colorscale:   [[0, '#E9EEF4'], [1, '#E9EEF4']],
      showscale:    false,
      hovertemplate: '<span style="font-size:13px;font-weight:700;color:#f8fafc">%{location}</span><br><span style="color:#64748b">No stores in scope</span><extra></extra>',
      marker:       { line: { color: '#ffffff', width: 1 } },
    }

    const choroTrace = {
      type:         'choropleth',
      geojson,
      featureidkey,
      locations:    matched.map(m => m.geoName),
      z:            matched.map(m => m.growth ?? 0),
      zmin:  -40, zmax: 40,
      text:         matched.map(m => buildHoverText(m)),
      hovertemplate: '%{text}<extra></extra>',
      colorscale:    GROWTH_CS,
      autocolorscale: false,
      colorbar: {
        title:     { text: 'Growth %', font: { color: '#6b7280', size: 11 } },
        thickness: 12,
        len:       0.6,
        bgcolor:   'rgba(0,0,0,0)',
        tickfont:  { color: '#6b7280', size: 10 },
        tickvals:  [-40, -20, 0, 20, 40],
        ticktext:  ['−40%', '−20%', '0%', '+20%', '+40%'],
      },
      marker: { line: { color: 'rgba(255,255,255,0.8)', width: 1 } },
    }

    const bubbles = matched
      .map(m => ({ ...m, centroid: matchCentroid(m.ourState) }))
      .filter(m => m.centroid !== null)

    const maxCount = bubbles.length > 0 ? Math.max(...bubbles.map(b => b.count), 1) : 1
    const sz = (n: number) => Math.max(8, Math.sqrt(n / maxCount) * 46)

    const glowTrace = {
      type: 'scattergeo',
      lat:  bubbles.map(b => b.centroid![0]),
      lon:  bubbles.map(b => b.centroid![1]),
      mode: 'markers',
      hoverinfo: 'skip',
      showlegend: false,
      marker: {
        size:       bubbles.map(b => sz(b.count) * 1.5),
        color:      bubbles.map(b => b.growth ?? 0),
        colorscale: GROWTH_CS,
        cmin: -40, cmax: 40,
        opacity:    0.18,
        line:       { width: 0 },
        showscale:  false,
      },
    }

    const bubbleTrace = {
      type: 'scattergeo',
      lat:  bubbles.map(b => b.centroid![0]),
      lon:  bubbles.map(b => b.centroid![1]),
      mode: 'markers',
      text: bubbles.map(b => buildHoverText(b)),
      hovertemplate: '%{text}<extra></extra>',
      showlegend: false,
      marker: {
        size:       bubbles.map(b => sz(b.count)),
        color:      bubbles.map(b => b.growth ?? 0),
        colorscale: GROWTH_CS,
        cmin: -40, cmax: 40,
        opacity:    0.65,
        line:       { width: 1.5, color: 'rgba(255,255,255,0.95)' },
        showscale:  false,
      },
    }

    return [bgTrace, choroTrace, glowTrace, bubbleTrace]
  }, [geojson, featureidkey, stateMetrics, geoStateNames])

  // ── Selection ring — cheap; only this trace updates on click ──────────────
  const selectionTrace = useMemo((): any => {
    const base = {
      ...EMPTY_SEL_TRACE,
      geojson,
      featureidkey,
    }
    if (!selectedState || !geojson) return base
    const sel = stateMetrics.filter(m => m.geoName !== null).find(m => m.ourState === selectedState)
    if (!sel) return base
    return { ...base, locations: [sel.geoName as string], z: [1] }
  }, [geojson, featureidkey, stateMetrics, selectedState])

  // ── Final trace array: [bg, choro, selectionRing, glow, bubbles] ──────────
  // Order is fixed so Plotly can diff by index; only selectionTrace changes on click.
  const allTraces = useMemo((): any[] => {
    if (!baseTraces) return []
    const [bg, choro, glow, bubbles] = baseTraces
    return [bg, choro, selectionTrace, glow, bubbles]
  }, [baseTraces, selectionTrace])

  const hasData = allTraces.length > 0 && (
    (allTraces[1]?.locations?.length ?? 0) > 0 ||
    (allTraces[0]?.locations?.length ?? 0) > 0
  )

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.12, ease: 'easeOut' }}
      className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-4 px-5 pt-4 pb-3 border-b border-gray-100">
        <div>
          <h2 className="text-sm font-bold text-gray-900">Growth Heat Map — India</h2>
          <p className="text-[11px] text-gray-500 mt-0.5 leading-relaxed max-w-lg">
            States shaded by early→recent revenue growth momentum.
            {mid.length > 0 ? ` Mid phase: ${mid[0]}${mid.length > 1 ? `–${mid[mid.length - 1]}` : ''}. ` : ' '}
            Bubble size = store count. Click a state to inspect its stores.
          </p>
        </div>
        {selectedState && (
          <motion.button
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.1 }}
            onClick={() => setSelectedState(null)}
            className="shrink-0 text-xs text-blue-600 hover:text-blue-500 transition-colors px-2.5 py-1 rounded-full border border-blue-200 bg-blue-50 font-medium"
          >
            ✕ {selectedState}
          </motion.button>
        )}
      </div>

      {/* Hint bar */}
      <div className="px-5 py-2 bg-gray-50 border-b border-gray-100 flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-sm bg-blue-400/60 shrink-0" />
        <p className="text-[10.5px] text-blue-700/80">
          Hover a state for revenue phase breakdown and store mix · click to drill into state stores
        </p>
      </div>

      {/* Map */}
      <div className="px-2">
        {geoLoading && (
          <div className="flex items-center justify-center h-[560px] gap-3 text-gray-400 text-sm">
            <div className="h-5 w-5 rounded-full border-2 border-gray-200 border-t-blue-500 animate-spin" />
            Loading India map…
          </div>
        )}
        {geoError && (
          <div className="flex items-center justify-center h-[560px] text-red-500 text-sm">
            {geoError} — check your network connection.
          </div>
        )}
        {!geoLoading && !geoError && !hasData && (
          <div className="flex items-center justify-center h-[560px] text-gray-400 text-sm">
            No data matches the selected filters.
          </div>
        )}
        {!geoLoading && !geoError && hasData && (
          <Plot
            data={allTraces}
            layout={{
              paper_bgcolor: 'rgba(0,0,0,0)',
              plot_bgcolor:  'rgba(0,0,0,0)',
              font: { color: '#6b7280', family: 'Inter, sans-serif', size: 11 },
              // uirevision keeps zoom/rotation intact across filter-driven re-renders
              uirevision:    'geo-stable',
              geo:           GEO_LAYOUT,
              margin:        { l: 0, r: 0, t: 0, b: 0 },
              height:        560,
              hoverlabel: {
                bgcolor:    'rgba(15, 23, 42, 0.97)',
                bordercolor: 'rgba(100, 116, 139, 0.55)',
                font: {
                  color:  '#f1f5f9',
                  size:   12,
                  family: 'Inter, system-ui, sans-serif',
                },
                align: 'left',
                namelength: -1,
              },
            } as any}
            config={{
              displayModeBar: false,
              responsive:     true,
              scrollZoom:     true,
            }}
            style={{ width: '100%' }}
            onClick={(evt: any) => {
              const pt = evt?.points?.[0]
              if (!pt) return
              const entry = stateMetrics.find(m => m.geoName === pt.location)
              if (entry) setSelectedState(p => p === entry.ourState ? null : entry.ourState)
            }}
          />
        )}
      </div>

      {/* Gradient legend bar */}
      <div className="px-5 py-3.5 border-t border-gray-100">
        <div className="flex items-center justify-between text-[10px] font-medium text-gray-500 mb-1.5">
          <span>Strong Decline</span>
          <span>Decline</span>
          <span>Stable</span>
          <span>Growth</span>
          <span>Strong Growth</span>
        </div>
        <div
          className="h-2.5 rounded-full w-full"
          style={{
            background: 'linear-gradient(to right, #8B1E3F, #D97757, #E5E7EB, #7CC576, #145A32)',
            boxShadow:  '0 1px 3px rgba(0,0,0,0.08)',
          }}
        />
        <div className="flex justify-between text-[10px] text-gray-400 mt-1.5">
          <span>−40%</span>
          <span>−20%</span>
          <span>0%</span>
          <span>+20%</span>
          <span>+40%</span>
        </div>
        <div className="mt-2 flex items-center gap-1.5 text-[10px] text-gray-400">
          <span className="h-3 w-3 rounded-full border border-gray-300 bg-gray-200/60 shrink-0" />
          Bubble size = store count · colour = growth direction
        </div>
      </div>
    </motion.div>
  )
}
