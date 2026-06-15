import { useEffect, useMemo, useState } from 'react'
// eslint-disable-next-line @typescript-eslint/no-require-imports
import createPlotlyComponent from 'react-plotly.js/factory'
// @ts-ignore — plotly.js-dist-min does not ship its own .d.ts
import Plotly from 'plotly.js-dist-min'
import { fmtInr, fmtPct } from '@/lib/formatting'

const Plot = createPlotlyComponent(Plotly)

const GEO_URL = '/india-states.geojson'

const RISING_CS: [number, string][] = [
  [0,    '#f0fdf4'],
  [0.33, '#86efac'],
  [0.67, '#22c55e'],
  [1,    '#15803d'],
]

const FALLEN_CS: [number, string][] = [
  [0,    '#fff1f2'],
  [0.33, '#fca5a5'],
  [0.67, '#ef4444'],
  [1,    '#b91c1c'],
]

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

function matchGeoName(name: string, geoNames: string[]): string | null {
  if (geoNames.includes(name)) return name
  const lo = name.toLowerCase()
  return (
    geoNames.find(g => g.toLowerCase() === lo) ??
    geoNames.find(g => g.toLowerCase().startsWith(lo.split(' ')[0])) ??
    null
  )
}

// Minimal subset of StoreMetrics needed by the map
interface StarRow {
  store: { state?: string | null }
  recentTotal: number
  growthPct: number | null
}

interface Props {
  rows: StarRow[]
  variant: 'rising' | 'fallen'
  selectedState: string | null
  onStateClick: (state: string | null) => void
}

export default function StarsStateMap({ rows, variant, selectedState, onStateClick }: Props) {
  const [geojson, setGeojson]       = useState<any>(null)
  const [geoLoading, setGeoLoading] = useState(true)
  const [geoError, setGeoError]     = useState<string | null>(null)

  useEffect(() => {
    fetch(GEO_URL)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(d => { setGeojson(d); setGeoLoading(false) })
      .catch(e => { setGeoError(e?.message ?? 'Failed'); setGeoLoading(false) })
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

  // Aggregate Rising/Fallen Star stores by state
  const stateAgg = useMemo(() => {
    const totalCount = rows.length
    const map: Record<string, { count: number; recentTotal: number; growths: number[] }> = {}
    for (const row of rows) {
      const s = row.store.state ?? 'Unknown'
      if (!map[s]) map[s] = { count: 0, recentTotal: 0, growths: [] }
      map[s].count++
      map[s].recentTotal += row.recentTotal
      if (row.growthPct != null) map[s].growths.push(row.growthPct)
    }
    return Object.entries(map).map(([state, d]) => ({
      state,
      geoName:    geoStateNames.length ? matchGeoName(state, geoStateNames) : state,
      count:      d.count,
      recentTotal: d.recentTotal,
      avgGrowth:  d.growths.length
        ? d.growths.reduce((a, b) => a + b, 0) / d.growths.length
        : null,
      sharePct: totalCount > 0 ? (d.count / totalCount) * 100 : 0,
    }))
  }, [rows, geoStateNames])

  const colorscale = variant === 'rising' ? RISING_CS : FALLEN_CS

  // Base traces — only re-renders on data/filter changes, not on state clicks
  const baseTraces = useMemo((): any[] | null => {
    if (!geojson) return null

    const storeLabel   = variant === 'rising' ? 'Rising Star' : 'Fallen Star'
    const matched      = stateAgg.filter(m => m.geoName !== null)
    const matchedNames = matched.map(m => m.geoName as string)
    const unmatched    = geoStateNames.filter(n => !matchedNames.includes(n))
    const maxCount     = matched.length > 0 ? Math.max(...matched.map(m => m.count), 1) : 1

    const bgTrace = {
      type:         'choropleth',
      geojson,
      featureidkey,
      locations:    unmatched,
      z:            unmatched.map(() => 0),
      colorscale:   [[0, '#E9EEF4'], [1, '#E9EEF4']],
      showscale:    false,
      hovertemplate: '<b>%{location}</b><br><span style="color:#9CA3AF">No stores</span><extra></extra>',
      marker:       { line: { color: '#ffffff', width: 1 } },
    }

    const choroTrace = {
      type:         'choropleth',
      geojson,
      featureidkey,
      locations:    matched.map(m => m.geoName),
      z:            matched.map(m => m.count),
      zmin:         0,
      zmax:         maxCount,
      text:         matched.map(m =>
        `<b>${m.state}</b>`
        + `<br>${storeLabel} Stores: ${m.count}`
        + `<br>Total Recent Revenue: ${fmtInr(m.recentTotal)}`
        + `<br>Avg Growth: ${m.avgGrowth != null ? fmtPct(m.avgGrowth) : 'N/A'}`
        + `<br>Share of ${storeLabel}s: ${m.sharePct.toFixed(1)}%`
      ),
      hovertemplate:   '%{text}<extra></extra>',
      colorscale,
      autocolorscale:  false,
      colorbar: {
        title:     { text: 'Stores', font: { color: '#6b7280', size: 11 } },
        thickness: 12,
        len:       0.5,
        bgcolor:   'rgba(0,0,0,0)',
        tickfont:  { color: '#6b7280', size: 10 },
      },
      marker: { line: { color: 'rgba(255,255,255,0.8)', width: 1 } },
    }

    return [bgTrace, choroTrace]
  }, [geojson, featureidkey, stateAgg, geoStateNames, colorscale, variant])

  // Selection ring — cheap; only updates on state click
  const selTrace = useMemo((): any => {
    const base = {
      type:       'choropleth',
      geojson,
      featureidkey,
      locations:  [] as string[],
      z:          [] as number[],
      colorscale: [[0, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0)']],
      showscale:  false,
      hoverinfo:  'skip',
      marker:     { line: { color: '#F59E0B', width: 3 } },
    }
    if (!selectedState || !geojson) return base
    const sel = stateAgg.find(m => m.state === selectedState)
    if (!sel?.geoName) return base
    return { ...base, locations: [sel.geoName], z: [1] }
  }, [geojson, featureidkey, stateAgg, selectedState])

  const allTraces = useMemo((): any[] => {
    if (!baseTraces) return []
    return [...baseTraces, selTrace]
  }, [baseTraces, selTrace])

  const hasData = allTraces.length > 0 && (allTraces[1]?.locations?.length ?? 0) > 0

  const isRising   = variant === 'rising'
  const hintColor  = isRising ? 'text-emerald-700/80' : 'text-red-700/80'
  const hintBg     = isRising ? 'bg-emerald-50/40' : 'bg-red-50/40'
  const dotColor   = isRising ? 'bg-emerald-400/60' : 'bg-red-400/60'
  const gradientBg = isRising
    ? 'linear-gradient(to right, #f0fdf4, #86efac, #22c55e, #15803d)'
    : 'linear-gradient(to right, #fff1f2, #fca5a5, #ef4444, #b91c1c)'
  const legendLabel = isRising ? 'Rising Stars' : 'Fallen Stars'
  const storeLabel  = isRising ? 'Rising Star' : 'Fallen Star'

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 px-5 pt-4 pb-3 border-b border-gray-100">
        <div>
          <h3 className="text-sm font-bold text-gray-900">
            {storeLabel} Distribution — India
          </h3>
          <p className="text-[11px] text-gray-500 mt-0.5 max-w-lg">
            States shaded by number of {storeLabel} stores. Click a state to filter the chart and table below.
          </p>
        </div>
        {selectedState && (
          <button
            onClick={() => onStateClick(null)}
            className="shrink-0 text-xs text-amber-600 hover:text-amber-500 transition-colors px-2.5 py-1 rounded-full border border-amber-200 bg-amber-50 font-medium"
          >
            ✕ {selectedState}
          </button>
        )}
      </div>

      {/* Hint bar */}
      <div className={`px-5 py-2 border-b border-gray-100 flex items-center gap-1.5 ${hintBg}`}>
        <span className={`h-2 w-2 rounded-sm shrink-0 ${dotColor}`} />
        <p className={`text-[10.5px] ${hintColor}`}>
          Hover for store count, revenue and growth details · click a state to filter the chart and table
        </p>
      </div>

      {/* Map */}
      <div className="px-2">
        {geoLoading && (
          <div className="flex items-center justify-center h-[420px] gap-3 text-gray-400 text-sm">
            <div className="h-5 w-5 rounded-full border-2 border-gray-200 border-t-blue-500 animate-spin" />
            Loading India map…
          </div>
        )}
        {geoError && (
          <div className="flex items-center justify-center h-[420px] text-red-500 text-sm">
            {geoError} — check your network connection.
          </div>
        )}
        {!geoLoading && !geoError && !hasData && (
          <div className="flex items-center justify-center h-[420px] text-gray-400 text-sm">
            No data matches the selected filters.
          </div>
        )}
        {!geoLoading && !geoError && hasData && (
          <Plot
            data={allTraces}
            layout={{
              paper_bgcolor: 'rgba(0,0,0,0)',
              plot_bgcolor:  'rgba(0,0,0,0)',
              font:          { color: '#6b7280', family: 'Inter, sans-serif', size: 11 },
              uirevision:    `stars-map-${variant}`,
              geo:           GEO_LAYOUT,
              margin:        { l: 0, r: 0, t: 0, b: 0 },
              height:        420,
            } as any}
            config={{ displayModeBar: false, responsive: true, scrollZoom: true }}
            style={{ width: '100%' }}
            onClick={(evt: any) => {
              const pt = evt?.points?.[0]
              if (!pt) return
              const entry = stateAgg.find(m => m.geoName === pt.location)
              if (entry) onStateClick(selectedState === entry.state ? null : entry.state)
            }}
          />
        )}
      </div>

      {/* Legend */}
      <div className="px-5 py-3 border-t border-gray-100">
        <div className="flex items-center justify-between text-[10px] font-medium text-gray-500 mb-1.5">
          <span>Fewer {legendLabel}</span>
          <span>More {legendLabel}</span>
        </div>
        <div
          className="h-2 rounded-full w-full"
          style={{ background: gradientBg, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}
        />
      </div>

    </div>
  )
}
