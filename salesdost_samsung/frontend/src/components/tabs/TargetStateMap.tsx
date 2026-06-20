import { useEffect, useMemo, useState } from 'react'
// eslint-disable-next-line @typescript-eslint/no-require-imports
import createPlotlyComponent from 'react-plotly.js/factory'
// @ts-ignore ΓÇö plotly.js-dist-min does not ship its own .d.ts
import Plotly from 'plotly.js-dist-min'
import { Map as MapIcon } from 'lucide-react'
import { fmtInr } from '@/lib/formatting'
import { cn } from '@/lib/utils'

const Plot = createPlotlyComponent(Plotly)

// Resolve against Vite's base ('/dsg/') so the asset is found in both local
// dev and the subpath production deploy. A root-absolute '/india-states.geojson'
// 404s because the file is served under the base path, not the domain root.
const GEO_URL = `${import.meta.env.BASE_URL}india-states.geojson`

// ΓöÇΓöÇ State centroids for bubble placement ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
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

// Achievement heat scale ΓÇö red (well below target) ΓåÆ amber (~75%) ΓåÆ green (100%+).
// z is the achievement %, clamped to [0, 120]; 100% lands on the green pivot so
// states at-or-above target read green and shortfalls read warm/red at a glance.
const ACH_MIN = 0
const ACH_MAX = 120
const ACH_CS: [number, string][] = [
  [0,                            '#b91c1c'],  // 0%   deep red
  [50  / (ACH_MAX - ACH_MIN),    '#ef4444'],  // 50%  red
  [75  / (ACH_MAX - ACH_MIN),    '#f59e0b'],  // 75%  amber
  [90  / (ACH_MAX - ACH_MIN),    '#fbbf24'],  // 90%  light amber
  [100 / (ACH_MAX - ACH_MIN),    '#10b981'],  // 100% green
  [1,                            '#047857'],  // 120%+ deep green
]

// Plotly geo layout ΓÇö shared across renders; never changes
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

// ΓöÇΓöÇ Types ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

export interface TargetStateRow {
  state:      string
  target:     number
  achieved:   number   // actual sales
  expected:   number   // pro-rated expected sales till date
  gap:        number   // target ΓêÆ achieved (negative = exceeded)
  achPct:     number
  storeCount: number
  status:     string
}

type BubbleMetric = 'sales' | 'target'

interface Props {
  data:        TargetStateRow[]
  targetMonth: string
  effectiveDay: number
  totalDays:    number
}

// ΓöÇΓöÇ Component ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

export default function TargetStateMap({ data, targetMonth, effectiveDay, totalDays }: Props) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [geojson, setGeojson]     = useState<any>(null)
  const [geoLoading, setGeoLoading] = useState(true)
  const [geoError, setGeoError]   = useState<string | null>(null)
  const [bubbleMetric, setBubbleMetric] = useState<BubbleMetric>('sales')
  const [selectedState, setSelectedState] = useState<string | null>(null)

  useEffect(() => {
    fetch(GEO_URL)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(d => { setGeojson(d); setGeoLoading(false) })
      .catch(e => { setGeoError(e?.message ?? 'Failed to load map'); setGeoLoading(false) })
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return geojson.features.map((f: any) => f.properties[pk] as string).filter(Boolean)
  }, [geojson, featureidkey])

  // Resolve each state row to a GeoJSON feature name + centroid, dropping the
  // synthetic "Unknown" bucket which has no place on the map.
  const rows = useMemo(() => {
    if (!geoStateNames.length) return []
    return data
      .filter(d => d.state && d.state !== 'Unknown')
      .map(d => ({
        ...d,
        geoName:  matchGeoName(d.state, geoStateNames),
        centroid: matchCentroid(d.state),
      }))
  }, [data, geoStateNames])

  // ΓöÇΓöÇ Rich tooltip text ΓÇö shared by choropleth and bubble traces ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
  const buildHoverText = (d: TargetStateRow): string => {
    const gapLine = d.gap > 0
      ? `<span style="color:#fca5a5">Gap to Target: ${fmtInr(d.gap)}</span>`
      : `<span style="color:#6ee7b7">Exceeded by: ${fmtInr(-d.gap)}</span>`
    const achColor = d.achPct >= 100 ? '#6ee7b7' : d.achPct >= 75 ? '#fcd34d' : '#fca5a5'
    return (
      `<span style="font-size:13px;font-weight:700;color:#f8fafc">${d.state}</span>`
      + `<br><span style="color:${achColor};font-weight:600">Achievement: ${d.achPct.toFixed(1)}%</span>`
      + `<br><span style="color:#cbd5e1">Target: ${fmtInr(d.target)}</span>`
      + `<br><span style="color:#cbd5e1">Actual Sales: ${fmtInr(d.achieved)}</span>`
      + `<br><span style="color:#94a3b8">Expected Sales: ${fmtInr(d.expected)}</span>`
      + `<br>${gapLine}`
      + `<br><span style="color:#64748b">${d.storeCount} store${d.storeCount !== 1 ? 's' : ''} ┬╖ ${d.status}</span>`
    )
  }

  // ΓöÇΓöÇ Base traces ΓÇö stable; only invalidate on data/geo/bubble-metric change ΓöÇ
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const baseTraces = useMemo((): any[] | null => {
    if (!geojson) return null

    const matched         = rows.filter(d => d.geoName !== null)
    const matchedGeoNames = matched.map(d => d.geoName as string)
    const unmatched       = geoStateNames.filter(n => !matchedGeoNames.includes(n))

    // Grey base layer for states with no stores in the current scope
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

    // Achievement choropleth
    const choroTrace = {
      type:         'choropleth',
      geojson,
      featureidkey,
      locations:    matched.map(d => d.geoName),
      z:            matched.map(d => Math.max(ACH_MIN, Math.min(ACH_MAX, d.achPct))),
      zmin:         ACH_MIN,
      zmax:         ACH_MAX,
      text:         matched.map(d => buildHoverText(d)),
      hovertemplate: '%{text}<extra></extra>',
      colorscale:    ACH_CS,
      autocolorscale: false,
      colorbar: {
        title:     { text: 'Achievement %', font: { color: '#6b7280', size: 11 } },
        thickness: 12,
        len:       0.7,
        bgcolor:   'rgba(0,0,0,0)',
        tickfont:  { color: '#6b7280', size: 10 },
        tickvals:  [0, 25, 50, 75, 100, 120],
        ticktext:  ['0%', '25%', '50%', '75%', '100%', '120%+'],
      },
      marker: { line: { color: 'rgba(255,255,255,0.8)', width: 1 } },
    }

    // Bubble overlay ΓÇö sized by the chosen volume metric (sales or target)
    const bubbles = matched.filter(d => d.centroid !== null)
    const volOf   = (d: typeof bubbles[number]) => bubbleMetric === 'sales' ? d.achieved : d.target
    const maxVol  = bubbles.length > 0 ? Math.max(...bubbles.map(volOf), 1) : 1
    const sz      = (v: number) => Math.max(8, Math.sqrt(Math.max(v, 0) / maxVol) * 46)

    const glowTrace = {
      type: 'scattergeo',
      lat:  bubbles.map(d => d.centroid![0]),
      lon:  bubbles.map(d => d.centroid![1]),
      mode: 'markers',
      hoverinfo: 'skip',
      showlegend: false,
      marker: {
        size:       bubbles.map(d => sz(volOf(d)) * 1.5),
        color:      bubbles.map(d => Math.max(ACH_MIN, Math.min(ACH_MAX, d.achPct))),
        colorscale: ACH_CS,
        cmin: ACH_MIN, cmax: ACH_MAX,
        opacity:    0.16,
        line:       { width: 0 },
        showscale:  false,
      },
    }

    const bubbleTrace = {
      type: 'scattergeo',
      lat:  bubbles.map(d => d.centroid![0]),
      lon:  bubbles.map(d => d.centroid![1]),
      mode: 'markers',
      text: bubbles.map(d => buildHoverText(d)),
      hovertemplate: '%{text}<extra></extra>',
      showlegend: false,
      marker: {
        size:       bubbles.map(d => sz(volOf(d))),
        color:      bubbles.map(d => Math.max(ACH_MIN, Math.min(ACH_MAX, d.achPct))),
        colorscale: ACH_CS,
        cmin: ACH_MIN, cmax: ACH_MAX,
        opacity:    0.7,
        line:       { width: 1.5, color: 'rgba(255,255,255,0.95)' },
        showscale:  false,
      },
    }

    return [bgTrace, choroTrace, glowTrace, bubbleTrace]
    // buildHoverText is a stable inline closure over fmtInr only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geojson, featureidkey, rows, geoStateNames, bubbleMetric])

  // ΓöÇΓöÇ Selection ring ΓÇö cheap; only this trace updates on click ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const selectionTrace = useMemo((): any => {
    const base = {
      type:       'choropleth',
      geojson,
      featureidkey,
      locations:  [] as string[],
      z:          [] as number[],
      colorscale: [[0, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0)']],
      showscale:  false,
      hoverinfo:  'skip',
      marker:     { line: { color: '#1e293b', width: 2.5 } },
    }
    if (!selectedState || !geojson) return base
    const sel = rows.find(d => d.state === selectedState && d.geoName !== null)
    if (!sel) return base
    return { ...base, locations: [sel.geoName as string], z: [1] }
  }, [geojson, featureidkey, rows, selectedState])

  // ΓöÇΓöÇ Final trace order: [bg, choro, selectionRing, glow, bubbles] ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allTraces = useMemo((): any[] => {
    if (!baseTraces) return []
    const [bg, choro, glow, bubbles] = baseTraces
    return [bg, choro, selectionTrace, glow, bubbles]
  }, [baseTraces, selectionTrace])

  const hasData = rows.some(d => d.geoName !== null)
  const selected = selectedState ? rows.find(d => d.state === selectedState) ?? null : null

  return (
    <div className="rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_1px_3px_rgba(15,23,42,0.04)] overflow-hidden">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 px-5 pt-4 pb-3.5 border-b border-slate-100 flex-wrap">
        <div className="flex items-start gap-2.5">
          <span className="grid place-items-center h-8 w-8 rounded-lg bg-blue-50 text-blue-500 shrink-0">
            <MapIcon className="h-4 w-4" />
          </span>
          <div>
            <h3 className="text-sm font-semibold text-slate-800">Geographic Performance <span className="text-slate-400 font-normal">┬╖ India</span></h3>
            <p className="text-[11px] text-slate-400 mt-0.5 max-w-xl">
              States shaded by achievement % ┬╖ bubble size Γê¥ {bubbleMetric === 'sales' ? 'actual sales' : 'target'} volume ┬╖
              {' '}{targetMonth || 'ΓÇö'} ┬╖ Day {effectiveDay} of {totalDays}
            </p>
          </div>
        </div>

        {/* Bubble-size metric toggle */}
        <div className="flex items-center border border-slate-200/80 rounded-xl overflow-hidden text-[11px] shrink-0 shadow-sm">
          <button
            onClick={() => setBubbleMetric('sales')}
            className={cn(
              'px-3 py-1.5 transition-colors whitespace-nowrap font-medium',
              bubbleMetric === 'sales' ? 'bg-blue-600 text-white' : 'bg-white text-slate-500 hover:text-slate-700',
            )}
          >
            Bubble: Sales
          </button>
          <button
            onClick={() => setBubbleMetric('target')}
            className={cn(
              'px-3 py-1.5 transition-colors border-l border-slate-200/80 whitespace-nowrap font-medium',
              bubbleMetric === 'target' ? 'bg-blue-600 text-white border-l-blue-600' : 'bg-white text-slate-500 hover:text-slate-700',
            )}
          >
            Bubble: Target
          </button>
        </div>
      </div>

      {/* Hint bar */}
      <div className="px-5 py-2 border-b border-slate-100 flex items-center gap-1.5 bg-slate-50/50">
        <span className="h-1.5 w-1.5 rounded-full shrink-0 bg-blue-400" />
        <p className="text-[10.5px] text-slate-400">
          Hover a state or bubble for target, sales, achievement and gap details ┬╖ click a state to spotlight it
        </p>
      </div>

      {/* Map */}
      <div className="px-2">
        {geoLoading && (
          <div className="flex items-center justify-center h-[460px] gap-3 text-slate-400 text-sm">
            <div className="h-5 w-5 rounded-full border-2 border-slate-200 border-t-blue-500 animate-spin" />
            Loading India mapΓÇª
          </div>
        )}
        {geoError && (
          <div className="flex items-center justify-center h-[460px] text-red-500 text-sm">
            {geoError} ΓÇö check your network connection.
          </div>
        )}
        {!geoLoading && !geoError && !hasData && (
          <div className="flex items-center justify-center h-[460px] text-slate-400 text-sm">
            No states with targets match the current filters.
          </div>
        )}
        {!geoLoading && !geoError && hasData && (
          <Plot
            data={allTraces}
            layout={{
              paper_bgcolor: 'rgba(0,0,0,0)',
              plot_bgcolor:  'rgba(0,0,0,0)',
              font:          { color: '#64748b', family: 'Inter, sans-serif', size: 11 },
              uirevision:    'target-state-map',
              geo:           GEO_LAYOUT,
              hoverlabel:    { bgcolor: '#0f172a', bordercolor: '#0f172a', font: { color: '#f8fafc', family: 'Inter, sans-serif', size: 12 } },
              margin:        { l: 0, r: 0, t: 0, b: 0 },
              height:        460,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any}
            config={{ displayModeBar: false, responsive: true, scrollZoom: true }}
            style={{ width: '100%' }}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            onClick={(evt: any) => {
              const pt = evt?.points?.[0]
              if (!pt) return
              // Choropleth points carry `location`; bubble points carry an index.
              const entry = pt.location
                ? rows.find(d => d.geoName === pt.location)
                : rows.filter(d => d.geoName !== null && d.centroid !== null)[pt.pointNumber as number]
              if (entry) setSelectedState(s => s === entry.state ? null : entry.state)
            }}
          />
        )}
      </div>

      {/* Selected-state detail strip */}
      {selected && (
        <div className="px-5 py-2.5 border-t border-slate-100 bg-slate-50/60 flex items-center gap-4 flex-wrap text-[11px]">
          <span className="font-semibold text-slate-800">{selected.state}</span>
          <span className="text-slate-400">Ach: <span className={cn('font-semibold', selected.achPct >= 100 ? 'text-emerald-600' : selected.achPct >= 75 ? 'text-amber-600' : 'text-red-600')}>{selected.achPct.toFixed(1)}%</span></span>
          <span className="text-slate-400">Target: <span className="font-medium text-slate-700">{fmtInr(selected.target)}</span></span>
          <span className="text-slate-400">Sales: <span className="font-medium text-slate-700">{fmtInr(selected.achieved)}</span></span>
          <span className="text-slate-400">{selected.gap > 0 ? <>Gap: <span className="font-medium text-red-600">{fmtInr(selected.gap)}</span></> : <>Exceeded: <span className="font-medium text-emerald-600">{fmtInr(-selected.gap)}</span></>}</span>
          <button onClick={() => setSelectedState(null)} className="ml-auto text-slate-400 hover:text-slate-600 transition-colors">Γ£ò Clear</button>
        </div>
      )}

      {/* Legend / color scale */}
      <div className="px-5 py-3.5 border-t border-slate-100">
        <div className="flex items-center justify-between text-[10px] font-medium text-slate-400 mb-1.5">
          <span>Below target</span>
          <span>75%</span>
          <span>100% ┬╖ On target</span>
          <span>Exceeded</span>
        </div>
        <div
          className="h-2 rounded-full w-full"
          style={{
            background: 'linear-gradient(to right, #b91c1c, #ef4444 42%, #f59e0b 62%, #fbbf24 75%, #10b981 83%, #047857)',
            boxShadow: '0 1px 2px rgba(15,23,42,0.08)',
          }}
        />
      </div>

    </div>
  )
}
