import { useCallback, useEffect, useMemo, useState } from 'react'
import { TrendingUp, Info, ArrowRight } from 'lucide-react'
// eslint-disable-next-line @typescript-eslint/no-require-imports
import createPlotlyComponent from 'react-plotly.js/factory'
// @ts-ignore — plotly.js-dist-min does not ship its own .d.ts
import Plotly from 'plotly.js-dist-min'
import { useDataContext } from '@/contexts/DataContext'
import type { FilterState } from '@/hooks/useFilters'
import type { StoreMetrics, StoreCategory } from '@/lib/classificationEngine'
import { cn } from '@/lib/utils'
import { fmtInr, fmtPct, fmtStore } from '@/lib/formatting'
import { exportCsv } from '@/lib/tableExport'
import { CATEGORY_TEXT_COLOR } from '@/lib/categoryStyles'
import DataTable from '@/components/ui/DataTable'
import StarsStateMap from './StarsStateMap'

const Plot = createPlotlyComponent(Plotly)

// ── Types ─────────────────────────────────────────────────────────────────────

type SortKey = 'growth' | 'earlyRev' | 'recentRev' | 'earlyRank' | 'recentRank' | 'health' | 'state'
type SortDir = 'asc' | 'desc'

const POSITIVE_CATEGORIES: StoreCategory[] = ['Rising Star']

// ── Table columns ─────────────────────────────────────────────────────────────

const TABLE_COLS: { key: SortKey | null; label: string; align: 'left' | 'right' | 'center' }[] = [
  { key: null,          label: '#',            align: 'center' },
  { key: null,          label: 'Store',        align: 'left'   },
  { key: 'state',       label: 'State',        align: 'left'   },
  { key: null,          label: 'Category',     align: 'left'   },
  { key: 'earlyRev',   label: 'Early Rev',    align: 'right'  },
  { key: 'recentRev',  label: 'Recent Rev',   align: 'right'  },
  { key: 'growth',      label: 'Growth %',     align: 'right'  },
  { key: null,          label: 'Early Plans',  align: 'right'  },
  { key: null,          label: 'Mid Plans',    align: 'right'  },
  { key: null,          label: 'Recent Plans', align: 'right'  },
  { key: 'earlyRank',  label: 'Early Rank',   align: 'center' },
  { key: 'recentRank', label: 'Recent Rank',  align: 'center' },
  { key: 'health',      label: 'Health',       align: 'right'  },
  { key: null,          label: 'Bar',          align: 'left'   },
]

// ── Component ─────────────────────────────────────────────────────────────────

export default function RisingStars({
  filters,
  onNavigateToStore,
  onNavigateToJourneyCategory,
}: {
  filters: FilterState
  onNavigateToStore?: (storeId: string) => void
  onNavigateToJourneyCategory?: (category: StoreCategory) => void
}) {
  const { classification } = useDataContext()
  const [sortKey, setSortKey] = useState<SortKey>('growth')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [mapStateFilter, setMapStateFilter] = useState<string | null>(null)

  // Reset map selection whenever parent filters change
  useEffect(() => { setMapStateFilter(null) }, [filters])

  // ── Filter engine results ─────────────────────────────────────────────────

  const { rows, kpi, top15 } = useMemo(() => {
    try {
    let scope = classification.metrics

    // Apply store-level filters
    if (filters.state)    scope = scope.filter(m => m.store.state    === filters.state)
    if (filters.category) scope = scope.filter(m => m.store.category === filters.category)

    // Keep only positive-trajectory categories
    const rows = scope.filter(m => POSITIVE_CATEGORIES.includes(m.category))
    const growingCount = scope.filter(m => m.category === 'Growing Store').length

    const total = scope.length   // all visible stores for health % computation

    // Compute health % relative to visible scope
    const byRecent = [...scope].sort((a, b) => b.recentTotal - a.recentTotal)
    const localRecentRank = new Map(byRecent.map((m, i) => [m.store.store_id, i + 1]))

    const { earlyMonths, midMonths, recentMonths } = classification.phases

    const enriched = rows.map(m => ({
      ...m,
      localHealth: total > 0
        ? +((total - (localRecentRank.get(m.store.store_id) ?? total)) / total * 100).toFixed(1)
        : 0,
      earlyPlans:  earlyMonths.reduce((s, mo) => s + (m.store.monthly_plans_count?.[mo] ?? 0), 0),
      midPlans:    midMonths.reduce((s, mo) => s + (m.store.monthly_plans_count?.[mo] ?? 0), 0),
      recentPlans: recentMonths.reduce((s, mo) => s + (m.store.monthly_plans_count?.[mo] ?? 0), 0),
    }))

    const topRiser = enriched.length > 0
      ? enriched.reduce((best, r) => (r.growthPct ?? -Infinity) > (best.growthPct ?? -Infinity) ? r : best)
      : null

    // Median growth % — more robust than average for skewed distributions
    const growthsSorted = [...enriched]
      .map(r => r.growthPct ?? 0)
      .sort((a, b) => a - b)
    const mid = Math.floor(growthsSorted.length / 2)
    const medianGrowth = growthsSorted.length === 0 ? 0
      : growthsSorted.length % 2 !== 0
        ? growthsSorted[mid]
        : (growthsSorted[mid - 1] + growthsSorted[mid]) / 2

    // Network revenue share — Rising Stars' recent total vs full network
    const networkRecentTotal = scope.reduce((s, m) => s + m.recentTotal, 0)
    const risingRecentTotal  = enriched.reduce((s, r) => s + r.recentTotal, 0)
    const networkSharePct = networkRecentTotal > 0
      ? risingRecentTotal / networkRecentTotal * 100
      : 0

    const top15 = [...enriched]
      .sort((a, b) => b.recentTotal - a.recentTotal)
      .slice(0, 15)

    return {
      rows: enriched,
      kpi: { count: enriched.length, growingCount, topRiser, medianGrowth, networkSharePct },
      top15,
    }
    } catch (e) {
      console.error('[RisingStars] computation error:', e)
      return { rows: [], kpi: { count: 0, growingCount: 0, topRiser: null, medianGrowth: 0, networkSharePct: 0 }, top15: [] }
    }
  }, [classification, filters])

  // ── Sort ─────────────────────────────────────────────────────────────────────

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      if (sortKey === 'state') {
        const sa = a.store.state ?? '', sb = b.store.state ?? ''
        return sortDir === 'asc' ? sa.localeCompare(sb) : sb.localeCompare(sa)
      }
      const map: Record<string, [number, number]> = {
        growth:      [a.growthPct ?? 0,  b.growthPct ?? 0],
        earlyRev:   [a.earlyTotal,   b.earlyTotal],
        recentRev:  [a.recentTotal,  b.recentTotal],
        earlyRank:  [a.earlyRank,  b.earlyRank],
        recentRank: [a.recentRank, b.recentRank],
        health:      [a.localHealth, b.localHealth],
      }
      const [va, vb] = map[sortKey] ?? [0, 0]
      return sortDir === 'desc' ? vb - va : va - vb
    })
  }, [rows, sortKey, sortDir])

  // Apply map state selection on top of existing sort/filter (no change to core computations)
  const displayRows = useMemo(() =>
    mapStateFilter ? sorted.filter(r => r.store.state === mapStateFilter) : sorted,
    [sorted, mapStateFilter],
  )

  const displayTop15 = useMemo(() =>
    mapStateFilter ? top15.filter(r => r.store.state === mapStateFilter) : top15,
    [top15, mapStateFilter],
  )

  // ── Dumbbell chart ────────────────────────────────────────────────────────────

  const { chartTraces, chartCategories } = useMemo(() => {
    if (displayTop15.length === 0) return { chartTraces: [] as object[], chartCategories: [] as string[] }

    const { earlyMonths, midMonths, recentMonths } = classification.phases
    const ec = earlyMonths.length  || 1
    const mc = midMonths.length    || 1
    const rc = recentMonths.length || 1

    const ordered = [...displayTop15].sort((a, b) => a.recentTotal / rc - b.recentTotal / rc)
    const storeLabel = (r: typeof ordered[0]) => fmtStore(r.store)
    const chartCategories = ordered.map(r => fmtStore(r.store))

    // Connector line spanning early avg → recent avg (mid dot sits on this line)
    const lines = ordered.map(row => ({
      type: 'scatter' as const,
      mode: 'lines' as const,
      x: [row.earlyTotal / ec, row.recentTotal / rc],
      y: [storeLabel(row), storeLabel(row)],
      showlegend: false,
      line:  { color: '#d1d5db', width: 2 },
      hoverinfo: 'none' as const,
    }))

    const earlyTrace = {
      type: 'scatter' as const,
      mode: 'markers' as const,
      name: 'Early',
      x:    ordered.map(r => r.earlyTotal / ec),
      y:    ordered.map(r => storeLabel(r)),
      marker: { symbol: 'circle', size: 10, color: '#9ca3af' },
      hovertemplate: '<b>%{y}</b><br>Early avg: ₹%{x:,.0f}<extra></extra>',
    }

    const midTrace = {
      type: 'scatter' as const,
      mode: 'markers' as const,
      name: 'Mid',
      x:    ordered.map(r => r.midTotal / mc),
      y:    ordered.map(r => storeLabel(r)),
      marker: { symbol: 'diamond', size: 9, color: '#8b5cf6' },
      hovertemplate: '<b>%{y}</b><br>Mid avg: ₹%{x:,.0f}<extra></extra>',
    }

    const recentTrace = {
      type: 'scatter' as const,
      mode: 'markers' as const,
      name: 'Recent',
      x:    ordered.map(r => r.recentTotal / rc),
      y:    ordered.map(r => storeLabel(r)),
      marker: { symbol: 'circle', size: 10, color: '#3b82f6' },
      hovertemplate: '<b>%{y}</b><br>Recent avg: ₹%{x:,.0f}<extra></extra>',
    }

    return { chartTraces: [...lines, earlyTrace, midTrace, recentTrace], chartCategories }
  }, [displayTop15, classification.phases])

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }

  const handleExportCsv = useCallback(() => {
    const headers = [
      '#', 'Store ID', 'Store Name', 'State', 'Category',
      'Early Revenue', 'Recent Revenue', 'Growth %',
      'Early Plans', 'Mid Plans', 'Recent Plans',
      'Early Rank', 'Recent Rank', 'Health %',
    ]
    const exportRows = displayRows.map((r, i) => [
      i + 1, r.store.store_id, r.store.store_name ?? '', r.store.state ?? '',
      r.category,
      r.earlyTotal.toFixed(0), r.recentTotal.toFixed(0),
      r.growthPct != null ? r.growthPct.toFixed(1) : '',
      r.earlyPlans, r.midPlans, r.recentPlans,
      r.earlyRank, r.recentRank, r.localHealth.toFixed(1),
    ])
    exportCsv('rising-stores', headers, exportRows)
  }, [displayRows])

  // ── Empty state ───────────────────────────────────────────────────────────────

  if (!rows.length) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white min-h-[320px] flex flex-col items-center justify-center gap-3 p-8 text-center">
        <TrendingUp className="h-8 w-8 text-gray-300" />
        <p className="text-base font-semibold text-gray-700">No Rising Stars in Scope</p>
        <p className="text-sm text-gray-400 max-w-sm">
          No stores meet the Rising Star criteria{filters.state ? ` in ${filters.state}` : ''}{filters.category ? ` for ${filters.category}` : ''}.
          Rising Stars require strict phase-over-phase growth (Early → Mid → Recent) with ≥ 30% total growth.
        </p>
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* Page Header */}
      <div className="pb-1 border-b border-gray-100">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">Momentum &amp; Movement</span>
        </div>
        <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-emerald-500 shrink-0" />
          Which stores are consistently growing?
        </h2>
        <p className="text-sm text-gray-500 mt-1 max-w-2xl">
          {rows.length} Rising Star store{rows.length !== 1 ? 's' : ''}{filters.state ? ` in ${filters.state}` : ''} — strict phase-over-phase growth
          (Early → Mid → Recent) with ≥ 30% total increase and above-network-median recent revenue.
          These are the bright spots to protect, learn from, and scale.
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
          <p className="text-[10px] font-semibold text-emerald-600 uppercase tracking-wider mb-2">Rising Stars</p>
          <p className="text-3xl font-bold text-emerald-700">{kpi.count}</p>
          <p className="text-xs text-emerald-500 mt-1">in current scope</p>
        </div>

        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 shadow-sm">
          <p className="text-[10px] font-semibold text-blue-600 uppercase tracking-wider mb-2">Growing Stores</p>
          <p className="text-3xl font-bold text-blue-700">{kpi.growingCount}</p>
          <button
            onClick={() => onNavigateToJourneyCategory?.('Growing Store')}
            className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-800 font-medium transition-colors"
          >
            View all <ArrowRight className="h-3 w-3" />
          </button>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Top Riser</p>
          {kpi.topRiser ? (
            <>
              <p className="text-sm font-bold text-gray-900 truncate">{kpi.topRiser.store.store_name ?? kpi.topRiser.store.store_id}</p>
              <p className="text-[10px] text-gray-400 mt-0.5">{kpi.topRiser.store.store_id}</p>
              <p className="text-xl font-bold text-emerald-600 mt-1 tabular-nums">
                {kpi.topRiser.growthPct != null ? `${fmtPct(kpi.topRiser.growthPct)} growth` : '—'}
              </p>
            </>
          ) : (
            <p className="text-2xl font-bold text-gray-900">—</p>
          )}
        </div>

        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
          <p className="text-[10px] font-semibold text-amber-600 uppercase tracking-wider mb-2">Median Growth</p>
          <p className="text-2xl font-bold text-amber-700">{fmtPct(kpi.medianGrowth)}</p>
          <p className="text-xs text-amber-500 mt-1">Typical rising star</p>
        </div>

        <div className="rounded-xl border border-violet-200 bg-violet-50 p-4 shadow-sm">
          <p className="text-[10px] font-semibold text-violet-600 uppercase tracking-wider mb-2">Network Share</p>
          <p className="text-2xl font-bold text-violet-700">{kpi.networkSharePct.toFixed(1)}%</p>
          <p className="text-xs text-violet-500 mt-1">of recent revenue</p>
        </div>
      </div>

      {/* Click hint */}
      {onNavigateToStore && (
        <div className="flex items-center gap-2 bg-blue-50 border border-blue-100 rounded-lg px-4 py-2.5">
          <Info className="w-4 h-4 text-blue-400 shrink-0" />
          <span className="text-xs text-blue-600">
            Click any row to open that store's Store Spotlight
          </span>
        </div>
      )}

      {/* State-level Rising Stars map */}
      <StarsStateMap
        rows={rows}
        variant="rising"
        selectedState={mapStateFilter}
        onStateClick={setMapStateFilter}
      />

      {/* Dumbbell chart */}
      {displayTop15.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-700">Early → Mid → Recent Revenue</h3>
          <p className="text-xs text-gray-400 mt-0.5 mb-4">Top {displayTop15.length} by recent phase total · ● Early · ◆ Mid · ● Recent</p>
          <Plot
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            data={chartTraces as any}
            layout={{
              paper_bgcolor: 'rgba(0,0,0,0)',
              plot_bgcolor:  'rgba(0,0,0,0)',
              height: Math.max(320, top15.length * 30 + 90),
              margin: { l: 70, r: 20, t: 20, b: 60 },
              font:   { color: '#6b7280', family: 'Inter, sans-serif', size: 11 },
              xaxis: {
                gridcolor: '#f3f4f6', linecolor: '#e5e7eb',
                tickprefix: '₹', tickformat: ',.0f', automargin: true,
                title: { text: 'Revenue — phase total (₹)', font: { color: '#9ca3af', size: 11 } },
              },
              yaxis: {
                gridcolor: '#f3f4f6', linecolor: '#e5e7eb',
                type: 'category' as const,
                categoryorder: 'array' as const,
                categoryarray: chartCategories,
                automargin: true,
              },
              legend: {
                bgcolor: 'rgba(0,0,0,0)',
                font: { color: '#6b7280', size: 10 },
                orientation: 'h' as const, x: 0, y: 1.08,
              },
              hovermode: 'closest' as const,
            }}
            config={{ displayModeBar: false, responsive: true }}
            style={{ width: '100%' }}
          />
        </div>
      )}

      {/* Detail table */}
      <DataTable
        title="Rising Stores Detail"
        subtitle={`${displayRows.length} store${displayRows.length !== 1 ? 's' : ''} · click column headers to sort`}
        onExportCsv={handleExportCsv}
      >
        <table className="w-full text-xs min-w-[700px]">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                {TABLE_COLS.map(({ key, label, align }) => (
                  <th
                    key={label}
                    onClick={key ? () => toggleSort(key) : undefined}
                    className={cn(
                      'px-4 py-3 font-semibold uppercase tracking-wider whitespace-nowrap text-gray-500',
                      align === 'left' ? 'text-left' : align === 'right' ? 'text-right' : 'text-center',
                      key ? 'cursor-pointer hover:text-gray-800 select-none' : '',
                      key && sortKey === key ? 'text-gray-800' : '',
                    )}
                  >
                    {label}
                    {key && sortKey === key && (
                      <span className="ml-1">{sortDir === 'desc' ? '↓' : '↑'}</span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(() => {
                const maxGrowth = Math.max(...displayRows.map(r => r.growthPct ?? 0), 1)
                return displayRows.map((row, i) => {
                  const barW = ((row.growthPct ?? 0) / maxGrowth) * 100
                  return (
                    <tr
                      key={row.store.store_id}
                      onClick={() => onNavigateToStore?.(row.store.store_id)}
                      className={cn(
                        'border-b border-gray-100 transition-colors',
                        i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50',
                        onNavigateToStore ? 'cursor-pointer hover:bg-emerald-50/30' : 'hover:bg-gray-50',
                      )}
                    >
                      <td className="px-3 py-2.5 text-center text-gray-400 text-xs">{i + 1}</td>
                      <td className="px-3 py-2.5">
                        <div className="font-semibold text-gray-800 truncate max-w-[160px]">{row.store.store_name ?? row.store.store_id}</div>
                        <div className="text-[10px] text-gray-400 font-mono mt-0.5">{row.store.store_id}</div>
                      </td>
                      <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap text-xs">
                        {row.store.state ?? '—'}
                      </td>
                      <td className={cn('px-3 py-2.5 text-[11px] font-semibold whitespace-nowrap', CATEGORY_TEXT_COLOR[row.category])}>
                        {row.category}
                      </td>
                      <td className="px-3 py-2.5 text-right text-gray-400 tabular-nums text-xs">
                        {fmtInr(row.earlyTotal)}
                      </td>
                      <td className="px-3 py-2.5 text-right text-gray-700 font-medium tabular-nums text-xs">
                        {fmtInr(row.recentTotal)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-semibold text-emerald-600 tabular-nums text-xs">
                        {row.growthPct != null ? fmtPct(row.growthPct) : '—'}
                      </td>
                      <td className="px-3 py-2.5 text-right text-gray-400 tabular-nums text-xs">
                        {row.earlyPlans.toLocaleString()}
                      </td>
                      <td className="px-3 py-2.5 text-right text-violet-500 tabular-nums text-xs">
                        {row.midPlans.toLocaleString()}
                      </td>
                      <td className="px-3 py-2.5 text-right text-gray-700 font-medium tabular-nums text-xs">
                        {row.recentPlans.toLocaleString()}
                      </td>
                      <td className="px-3 py-2.5 text-center text-gray-400 tabular-nums text-xs">
                        {row.earlyRank}
                      </td>
                      <td className="px-3 py-2.5 text-center text-gray-600 tabular-nums text-xs">
                        {row.recentRank}
                      </td>
                      <td className="px-3 py-2.5 text-right text-gray-600 tabular-nums text-xs">
                        {row.localHealth.toFixed(1)}%
                      </td>
                      <td className="px-3 py-2.5 w-24 hidden lg:table-cell">
                        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full bg-emerald-500"
                            style={{ width: `${Math.min(barW, 100)}%` }}
                          />
                        </div>
                      </td>
                    </tr>
                  )
                })
              })()}
            </tbody>
          </table>
      </DataTable>
    </div>
  )
}
