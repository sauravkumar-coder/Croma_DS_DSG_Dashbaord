import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ChevronUp, ChevronDown,
  TrendingUp, TrendingDown,
  Star, ShieldAlert, Zap, MapPin, Store, Info,
} from 'lucide-react'
import createPlotlyComponent from 'react-plotly.js/factory'
// @ts-ignore — plotly.js-dist-min does not ship its own .d.ts
import Plotly from 'plotly.js-dist-min'
import { useDataContext } from '@/contexts/DataContext'
import type { FilterState } from '@/hooks/useFilters'
import type { StoreRecord } from '@/lib/api'
import { allocatePhases, type StoreCategory } from '@/lib/classificationEngine'
import { cn } from '@/lib/utils'
import { getTabClassification } from '@/lib/filterHelpers'
import { fmtInr, fmtPct } from '@/lib/formatting'
import { exportCsv } from '@/lib/tableExport'
import { PT, PLOTLY_BASE } from '@/lib/plotlyTheme'
import DataTable from '@/components/ui/DataTable'

const Plot = createPlotlyComponent(Plotly)

// ── Types ─────────────────────────────────────────────────────────────────────

type SortKey = 'state' | 'stores' | 'active' | 'inactive' | 'growth' | 'revenue' | 'health' | 'risk' | 'opp'

interface StateRow {
  state:      string
  total:      number
  active:     number
  inactive:   number
  earlyRev:   number
  recentRev:  number
  totalRevV:  number
  growthPct:  number | null
  avgStore:   number
  netPct:     number | null
  newBloomer:    number
  rising:        number
  growing:       number
  constant:      number
  declining:     number
  fallen:        number
  inactiveStore: number
  health:     number
  risk:       number
  opp:        number
  topStore:   { store: StoreRecord; rev: number } | null
  worstStore: { store: StoreRecord; rev: number } | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sumRev(store: StoreRecord, months: string[]): number {
  return months.reduce((s, m) => s + (store.monthly_sales[m] ?? 0), 0)
}

// Health score per category (used for color encoding in drill-down charts)
const HEALTH_BY_CAT: Record<string, number> = {
  'Rising Star':     90,
  'New Bloomer':     78,
  'Growing Store':   65,
  'Constant Store':  50,
  'Declining Store': 30,
  'Fallen Star':     10,
  'Inactive Store':   5,
}

const COLORSCALE_HEALTH: [number, string][] = [
  [0,    '#991b1b'],
  [0.25, '#c2410c'],
  [0.5,  '#b45309'],
  [0.75, '#15803d'],
  [1,    '#064e3b'],
]

const COLORSCALE_HEALTH_PASTEL: [number, string][] = [
  [0,   '#ef4444'],
  [0.5, '#f59e0b'],
  [1,   '#10b981'],
]

// ── NetworkFunnel ─────────────────────────────────────────────────────────────

const POSITIVE_STEPS = [
  {
    label: 'All Tracked Stores',
    color: '#0f172a',
    desc:  'All stores in the network for the selected period',
  },
  {
    label: 'Active Stores',
    color: '#0369a1',
    desc:  'Stores with revenue recorded in the recent period',
  },
  {
    label: 'Growing Stores',
    color: '#059669',
    desc:  'Rising Stars + Growing Stores — on a clear upward trajectory',
  },
  {
    label: 'Rising Stars',
    color: '#d97706',
    desc:  'Stores with >15% avg revenue growth vs the early period',
  },
]

const FALLEN_META = {
  label: 'Fallen Stars',
  color: '#dc2626',
  desc:  'Stores with >15% avg revenue decline vs the early period',
}

function NetworkFunnel({ counts, total }: {
  counts: { all: number; active: number; growing: number; rising: number; fallen: number }
  total: number
}) {
  const [hovered, setHovered] = useState<number | null>(null)
  const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0)

  const positive = [
    { ...POSITIVE_STEPS[0], count: counts.all,     pct: 100 },
    { ...POSITIVE_STEPS[1], count: counts.active,  pct: pct(counts.active) },
    { ...POSITIVE_STEPS[2], count: counts.growing, pct: pct(counts.growing) },
    { ...POSITIVE_STEPS[3], count: counts.rising,  pct: pct(counts.rising) },
  ]
  const fallen = { ...FALLEN_META, count: counts.fallen, pct: pct(counts.fallen) }

  const allSteps = [...positive, fallen]

  const FunnelBar = ({
    step, idx,
  }: {
    step: typeof positive[0]
    idx: number
  }) => {
    const displayW = Math.max(step.pct, 8)
    const showFull = displayW >= 26
    const isHov    = hovered === idx

    return (
      <div
        className="rounded-xl flex items-center justify-between px-4 cursor-pointer select-none relative overflow-hidden"
        style={{ backgroundColor: step.color, height: 50, width: `${displayW}%` }}
        onMouseEnter={() => setHovered(idx)}
        onMouseLeave={() => setHovered(null)}
      >
        <div
          className="absolute inset-0 bg-white pointer-events-none rounded-xl transition-opacity duration-150"
          style={{ opacity: isHov ? 0.13 : 0 }}
        />
        <div
          className="absolute inset-0 rounded-xl pointer-events-none transition-all duration-150"
          style={{ boxShadow: isHov ? `0 0 0 2px ${step.color}, 0 0 10px 2px ${step.color}66` : 'none' }}
        />

        {showFull ? (
          <>
            <div className="relative min-w-0 flex-1 z-10">
              <p className="text-white font-bold text-sm leading-tight truncate">{step.label}</p>
              <p className="text-white/55 text-xs tabular-nums">{step.count.toLocaleString()} stores</p>
            </div>
            <span className="relative z-10 text-white/75 font-bold text-sm tabular-nums ml-3 shrink-0">
              {step.pct.toFixed(0)}%
            </span>
          </>
        ) : (
          <div className="relative z-10 w-full text-center">
            <span className="text-white font-bold text-xs tabular-nums">{step.pct.toFixed(0)}%</span>
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      <div className="space-y-1.5 flex flex-col items-center">
        {positive.map((step, i) => (
          <div key={step.label} className="w-full flex flex-col items-center">
            <FunnelBar step={step} idx={i} />
            {i < positive.length - 1 && (
              <div className="w-px h-2 bg-gray-300" />
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 my-3">
        <div className="flex-1 border-t border-dashed border-gray-300" />
        <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">at risk</span>
        <div className="flex-1 border-t border-dashed border-gray-300" />
      </div>

      <div className="flex flex-col items-center">
        <FunnelBar step={fallen} idx={4} />
      </div>

      <AnimatePresence>
        {hovered !== null && (
          <motion.div
            key="tooltip"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
            className="mt-3 rounded-xl border border-gray-200 bg-white shadow-sm px-4 py-3"
          >
            <div className="flex items-center gap-2 mb-1">
              <span
                className="inline-block h-3 w-3 rounded shrink-0"
                style={{ backgroundColor: allSteps[hovered].color }}
              />
              <span className="text-sm font-bold text-gray-800">{allSteps[hovered].label}</span>
            </div>
            <p className="text-sm text-gray-700">
              <span className="font-bold tabular-nums text-gray-900">
                {allSteps[hovered].count.toLocaleString()}
              </span>{' '}
              stores
              {' · '}
              <span className="font-bold tabular-nums" style={{ color: allSteps[hovered].color }}>
                {allSteps[hovered].pct.toFixed(1)}%
              </span>{' '}
              of total
            </p>
            <p className="text-xs text-gray-400 mt-0.5">{allSteps[hovered].desc}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── HealthBadge ────────────────────────────────────────────────────────────────

function HealthBadge({ value }: { value: number }) {
  const color =
    value >= 75 ? 'text-emerald-600' :
    value >= 50 ? 'text-amber-600'   :
                  'text-red-500'
  return <span className={cn('tabular-nums font-semibold', color)}>{value.toFixed(1)}</span>
}

// ── RiskBadge ─────────────────────────────────────────────────────────────────

function RiskBadge({ value }: { value: number }) {
  const color =
    value <= 10 ? 'text-emerald-600' :
    value <= 25 ? 'text-amber-600'   :
                  'text-red-500'
  return <span className={cn('tabular-nums font-semibold', color)}>{value.toFixed(1)}</span>
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props { filters: FilterState }

export default function StateJourneyAnalysis({ filters }: Props) {
  const { stores, months } = useDataContext()
  const [sortKey, setSortKey] = useState<SortKey>('revenue')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const tabClassification = useMemo(() => {
    return getTabClassification(stores, months, filters.planCategory);
  }, [stores, months, filters.planCategory]);

  // ── Month range ────────────────────────────────────────────────────────────
  const { fm, early, mid, recent } = useMemo(() => {
    let fm = months
    if (filters.fromMonth) {
      const i = months.indexOf(filters.fromMonth)
      if (i >= 0) fm = fm.slice(i)
    }
    if (filters.toMonth) {
      const i = months.indexOf(filters.toMonth)
      if (i >= 0) fm = fm.slice(0, i + 1)
    }
    const { earlyMonths: early, midMonths: mid, recentMonths: recent } = allocatePhases(fm)
    return { fm, early, mid, recent }
  }, [months, filters.fromMonth, filters.toMonth])

  // ── Per-store data (category + revenue, no state filter here) ─────────────
  const classifiedStores = useMemo(() => {
    let scope = tabClassification.metrics
    if (filters.productSubcategory) scope = scope.filter(m => m.store.category?.toLowerCase() === filters.productSubcategory.toLowerCase())

    return scope.map(m => {
      const store      = m.store
      const earlyR     = sumRev(store, early)
      const recentR    = sumRev(store, recent)
      const rev        = sumRev(store, fm)
      const growthPct  = earlyR > 0 ? (recentR - earlyR) / earlyR * 100 : null
      const isRecentActive = recent.length
        ? recent.some(mo => (store.monthly_sales[mo] ?? 0) > 0)
        : fm.some(mo => (store.monthly_sales[mo] ?? 0) > 0)
      return { store, rev, earlyR, recentR, growthPct, isRecentActive, category: m.category as StoreCategory }
    })
  }, [tabClassification, filters.productSubcategory, fm, early, recent])

  // ── State-scoped stores: apply state filter for funnel + KPI cards ─────────
  const stateScopedStores = useMemo(() => {
    if (!filters.state) return classifiedStores
    return classifiedStores.filter(c => (c.store.state ?? 'Unknown') === filters.state)
  }, [classifiedStores, filters.state])

  // ── Funnel counts — respects state filter ─────────────────────────────────
  const funnel = useMemo(() => ({
    all:     stateScopedStores.length,
    active:  stateScopedStores.filter(c => c.isRecentActive).length,
    growing: stateScopedStores.filter(c =>
      c.category === 'Rising Star' || c.category === 'Growing Store'
    ).length,
    rising:  stateScopedStores.filter(c => c.category === 'Rising Star').length,
    fallen:  stateScopedStores.filter(c => c.category === 'Fallen Star').length,
  }), [stateScopedStores])

  // ── Per-state aggregations (always across all states for the table/treemap) ─
  const stateMetrics = useMemo((): StateRow[] => {
    const map = new Map<string, typeof classifiedStores>()
    for (const c of classifiedStores) {
      const st = c.store.state ?? 'Unknown'
      if (!map.has(st)) map.set(st, [])
      map.get(st)!.push(c)
    }

    const totalPortfolioRev = classifiedStores.reduce((s, c) => s + c.rev, 0)

    const rows: StateRow[] = []
    for (const [state, data] of map) {
      const total     = data.length
      const earlyRev  = data.reduce((s, d) => s + d.earlyR, 0)
      const recentRev = data.reduce((s, d) => s + d.recentR, 0)
      const totalRevV = data.reduce((s, d) => s + d.rev, 0)

      const growthPct = earlyRev > 0 ? (recentRev - earlyRev) / earlyRev * 100 : null
      const netPct    = totalPortfolioRev > 0 ? totalRevV / totalPortfolioRev * 100 : null
      const avgStore  = total > 0 ? totalRevV / total : 0

      // Lifecycle categories are exhaustive and mutually exclusive — they always sum to total
      const newBloomer    = data.filter(d => d.category === 'New Bloomer').length
      const rising        = data.filter(d => d.category === 'Rising Star').length
      const growing       = data.filter(d => d.category === 'Growing Store').length
      const constant      = data.filter(d => d.category === 'Constant Store').length
      const declining     = data.filter(d => d.category === 'Declining Store').length
      const fallen        = data.filter(d => d.category === 'Fallen Star').length
      const inactiveStore = data.filter(d => d.category === 'Inactive Store').length

      // Active = all stores except the "Inactive Store" classification
      // Equivalent to: newBloomer + rising + growing + constant + declining + fallen
      const active   = total - inactiveStore
      const inactive = inactiveStore

      const activeRatio  = total > 0 ? active / total : 0
      const growthHealth = growthPct !== null
        ? Math.max(0, Math.min(1, (growthPct + 100) / 200))
        : 0.5
      const risingRatio  = total > 0 ? rising / total : 0
      const health = Math.round((activeRatio * 0.5 + growthHealth * 0.3 + risingRatio * 0.2) * 100 * 10) / 10

      const risk = Math.round(
        total > 0 ? (fallen * 1.0 + inactiveStore * 0.5) / total * 100 * 10 / 10 : 0
      )

      const opp = rising

      let topStore:   StateRow['topStore']   = null
      let worstStore: StateRow['worstStore'] = null
      for (const d of data) {
        if (!topStore   || d.rev > topStore.rev)   topStore   = { store: d.store, rev: d.rev }
        if (!worstStore || d.rev < worstStore.rev) worstStore = { store: d.store, rev: d.rev }
      }

      rows.push({
        state, total, active, inactive,
        earlyRev, recentRev, totalRevV,
        growthPct, avgStore, netPct,
        newBloomer, rising, growing, constant, declining, fallen, inactiveStore,
        health, risk, opp,
        topStore, worstStore,
      })
    }

    return rows.sort((a, b) => b.totalRevV - a.totalRevV)
  }, [classifiedStores])

  // ── KPI heroes (all-states view) ──────────────────────────────────────────
  const kpis = useMemo(() => {
    const totalRevAll    = stateMetrics.reduce((s, m) => s + m.totalRevV, 0)
    const largest        = stateMetrics[0] ?? null
    const largestPct     = totalRevAll > 0 ? (largest?.totalRevV ?? 0) / totalRevAll * 100 : 0
    const fastestGrowing = [...stateMetrics]
      .filter(m => m.growthPct !== null)
      .sort((a, b) => (b.growthPct ?? 0) - (a.growthPct ?? 0))[0] ?? null
    const highestRisk    = [...stateMetrics]
      .sort((a, b) => b.risk - a.risk)[0] ?? null
    return { statesInScope: stateMetrics.length, totalStores: classifiedStores.length,
             largest, largestPct, fastestGrowing, highestRisk }
  }, [stateMetrics, classifiedStores])

  // ── KPI heroes (state-selected view: store-level) ─────────────────────────
  const stateKpis = useMemo(() => {
    if (!filters.state) return null
    const stores = stateScopedStores
    if (!stores.length) return null

    const byRev = [...stores].sort((a, b) => b.rev - a.rev)
    const largestStore = byRev[0]

    const fastestGrowing = [...stores]
      .filter(c => c.growthPct !== null)
      .sort((a, b) => (b.growthPct ?? 0) - (a.growthPct ?? 0))[0] ?? null

    // Risk priority: Fallen Star > Declining > Inactive > others, then by worst growth
    const riskPriority = (cat: string) => {
      if (cat === 'Fallen Star')     return 0
      if (cat === 'Declining Store') return 1
      if (cat === 'Inactive Store')  return 2
      return 3
    }
    const highestRisk = [...stores]
      .sort((a, b) => {
        const diff = riskPriority(a.category) - riskPriority(b.category)
        if (diff !== 0) return diff
        return (a.growthPct ?? 0) - (b.growthPct ?? 0)
      })[0] ?? null

    return {
      stateName:      filters.state,
      totalStores:    stores.length,
      largestStore,
      largestRev:     largestStore?.rev ?? 0,
      fastestGrowing,
      highestRisk,
    }
  }, [filters.state, stateScopedStores])

  // ── Store Revenue Ranking data (drill-down: only when state filter active) ──
  const storeCompData = useMemo(() => {
    if (!filters.state) return { stores: [], stateName: '', count: 0, totalRev: 0, maxRev: 0, growing: 0, atRisk: 0 }

    const stateStores = classifiedStores
      .filter(c => (c.store.state ?? 'Unknown') === filters.state)
      .sort((a, b) => b.rev - a.rev)

    if (!stateStores.length) return { stores: [], stateName: filters.state, count: 0, totalRev: 0, maxRev: 0, growing: 0, atRisk: 0 }

    const totalRev = stateStores.reduce((s, c) => s + c.rev, 0)
    const maxRev   = stateStores[0]?.rev ?? 0
    const growing  = stateStores.filter(c =>
      c.category === 'Rising Star' || c.category === 'New Bloomer' || c.category === 'Growing Store'
    ).length
    const atRisk = stateStores.filter(c =>
      c.category === 'Declining Store' || c.category === 'Fallen Star' || c.category === 'Inactive Store'
    ).length

    return { stores: stateStores, stateName: filters.state, count: stateStores.length, totalRev, maxRev, growing, atRisk }
  }, [classifiedStores, filters.state])

  // ── State Performance Leaderboard derived data ────────────────────────────
  const leaderboardData = useMemo(() => {
    if (filters.state || !stateMetrics.length) return null
    const maxRev = stateMetrics.reduce((m, s) => Math.max(m, s.totalRevV), 0)
    const withGrowth = stateMetrics.filter(m => m.growthPct !== null)
    const growthSorted = [...withGrowth].sort((a, b) => (b.growthPct ?? 0) - (a.growthPct ?? 0))
    const growthRankMap = new Map<string, number>(growthSorted.map((m, i) => [m.state, i + 1]))
    return {
      maxRev,
      topGrowth:    growthSorted.slice(0, 5),
      bottomGrowth: growthSorted.slice(-5).reverse(),
      growthRankMap,
    }
  }, [stateMetrics, filters.state])


  // ── Category breakdown bar for store distribution (state drill-down) ───────
  const stateCatData = useMemo(() => {
    if (!filters.state || !stateScopedStores.length) return null

    const CAT_COLOR: Record<string, string> = {
      'New Bloomer':    '#10b981',
      'Rising Star':    '#eab308',
      'Growing Store':  '#3b82f6',
      'Constant Store': '#8b5cf6',
      'Declining Store':'#f97316',
      'Fallen Star':    '#dc2626',
      'Inactive Store': '#9ca3af',
    }
    const ALL_CATS = ['New Bloomer','Rising Star','Growing Store','Constant Store','Declining Store','Fallen Star','Inactive Store']
    const total = stateScopedStores.length

    const bars = ALL_CATS
      .map(cat => ({
        cat,
        count: stateScopedStores.filter(c => c.category === cat).length,
        color: CAT_COLOR[cat] ?? '#9ca3af',
      }))
      .filter(d => d.count > 0)
      .sort((a, b) => a.count - b.count)  // ascending → largest at top

    return {
      traces: [{
        type: 'bar' as const,
        orientation: 'h' as const,
        y: bars.map(d => d.cat),
        x: bars.map(d => d.count),
        marker: { color: bars.map(d => d.color), opacity: 0.88 },
        text: bars.map(d => `  ${d.count} — ${((d.count / total) * 100).toFixed(0)}%`),
        textposition: 'outside' as const,
        textfont: { size: 10, color: '#374151' },
        cliponaxis: false,
        hovertemplate: '<b>%{y}</b><br>%{x} stores (%{text})<extra></extra>',
      }],
      height: Math.max(220, bars.length * 46 + 60),
    }
  }, [stateScopedStores, filters.state])

  // ── Treemap: states overview OR store drill-down when state is selected ────
  const treemapData = useMemo(() => {
    if (filters.state && stateScopedStores.length > 0) {
      // Drill-down: individual stores within the selected state
      const sorted = [...stateScopedStores].sort((a, b) => b.rev - a.rev)
      return [{
        type:    'treemap' as const,
        labels:  sorted.map(c => c.store.store_name ?? c.store.store_id),
        parents: sorted.map(() => ''),
        values:  sorted.map(c => Math.max(c.rev, 1)),
        customdata: sorted.map(c => [
          c.category,
          c.growthPct !== null ? (c.growthPct >= 0 ? '+' : '') + c.growthPct.toFixed(1) + '%' : 'N/A',
          HEALTH_BY_CAT[c.category] ?? 50,
        ]),
        marker: {
          colorscale: COLORSCALE_HEALTH,
          colors:     sorted.map(c => HEALTH_BY_CAT[c.category] ?? 50),
          cmin:       0,
          cmax:       100,
          colorbar: {
            thickness: 10,
            len:       0.75,
            tickfont:  { color: '#6b7280', size: 9 },
            title:     { text: 'Health', side: 'right' as const, font: { color: '#6b7280', size: 9 } },
          },
          line: { width: 2, color: '#ffffff' },
        },
        texttemplate: '<b>%{label}</b><br>%{customdata[0]}<br>%{customdata[1]}',
        hovertemplate:
          '<b>%{label}</b>'
          + '<br>Category: %{customdata[0]}'
          + '<br>Growth: %{customdata[1]}'
          + '<br>Revenue: ₹%{value:,.0f}'
          + '<extra></extra>',
        textfont: { color: '#ffffff', size: 10 },
      }]
    }

    // Default: state-level treemap
    return [{
      type:    'treemap' as const,
      labels:  stateMetrics.map(m => m.state),
      parents: stateMetrics.map(() => ''),
      values:  stateMetrics.map(m => m.total),
      customdata: stateMetrics.map(m => [
        m.active, m.total, m.health.toFixed(1),
        m.rising + m.growing, m.fallen,
        fmtInr(m.totalRevV),
      ]),
      marker: {
        colorscale: COLORSCALE_HEALTH,
        colors:     stateMetrics.map(m => m.health),
        cmin:       0,
        cmax:       100,
        colorbar: {
          thickness: 10,
          len:       0.75,
          tickfont:  { color: '#6b7280', size: 9 },
          title:     { text: 'Health', side: 'right' as const, font: { color: '#6b7280', size: 9 } },
        },
        line: { width: 2, color: '#ffffff' },
      },
      texttemplate: '<b>%{label}</b><br>%{customdata[0]}/%{value} active<br>↑%{customdata[3]} ↓%{customdata[4]}<br>%{customdata[5]}',
      hovertemplate:
        '<b>%{label}</b>'
        + '<br>Total stores: %{value}'
        + '<br>Active: %{customdata[0]}/%{customdata[1]}'
        + '<br>Health score: %{customdata[2]}'
        + '<br>Rising+Growing: %{customdata[3]}'
        + '<br>Fallen Stars: %{customdata[4]}'
        + '<br>Revenue: %{customdata[5]}'
        + '<extra></extra>',
      textfont: { color: '#ffffff', size: 11 },
    }]
  }, [stateMetrics, stateScopedStores, filters.state])

  // ── Pareto: Store Footprint Concentration (no-state view) ─────────────────
  const paretoData = useMemo(() => {
    const sorted = [...stateMetrics]
      .filter(m => m.total > 0)
      .sort((a, b) => b.total - a.total)

    if (!sorted.length) return null

    const totalStores = sorted.reduce((s, m) => s + m.total, 0)

    // Plans sold per state from raw store records (respects all existing filters)
    const plansMap = new Map<string, number>()
    for (const c of classifiedStores) {
      const st = c.store.state ?? 'Unknown'
      const p  = fm.reduce((s, mo) => s + (c.store.monthly_plans_count?.[mo] ?? 0), 0)
      plansMap.set(st, (plansMap.get(st) ?? 0) + p)
    }

    let runningPct = 0
    const rows = sorted.map(m => {
      const contrib = totalStores > 0 ? (m.total / totalStores) * 100 : 0
      runningPct = Math.min(runningPct + contrib, 100)
      return {
        state:       m.state,
        count:       m.total,
        contrib:     Math.round(contrib * 10) / 10,
        cumulative:  Math.round(runningPct * 10) / 10,
        rev:         m.totalRevV,
        growthPct:   m.growthPct,
        revPerStore: m.total > 0 ? m.totalRevV / m.total : 0,
        plans:       plansMap.get(m.state) ?? 0,
      }
    })

    const paretoIdx   = rows.findIndex(r => r.cumulative >= 80)
    const statesFor80 = paretoIdx >= 0 ? paretoIdx + 1 : rows.length
    const top5cum     = rows[Math.min(4, rows.length - 1)]?.cumulative  ?? 0
    const top10cum    = rows[Math.min(9, rows.length - 1)]?.cumulative ?? 0
    const isConc      = statesFor80 <= Math.ceil(rows.length * 0.4)

    const barColors = rows.map((_, i) =>
      paretoIdx < 0 || i <= paretoIdx ? '#3b82f6' : '#bfdbfe'
    )

    const traces = [
      {
        type: 'bar' as const,
        name: 'Store Count',
        x: rows.map(r => r.state),
        y: rows.map(r => r.count),
        marker: { color: barColors, opacity: 0.88, line: { width: 0 } },
        yaxis: 'y' as const,
        customdata: rows.map(r => [
          r.contrib.toFixed(1),
          r.cumulative.toFixed(1),
          fmtInr(r.rev),
          fmtInr(r.revPerStore),
          r.growthPct !== null ? fmtPct(r.growthPct) : 'N/A',
          r.plans.toLocaleString('en-IN'),
        ]),
        hovertemplate:
          '<b>%{x}</b>'
          + '<br>Stores: <b>%{y}</b>'
          + '<br>Contribution: %{customdata[0]}%'
          + '<br>Cumulative: %{customdata[1]}%'
          + '<br>Revenue: %{customdata[2]}'
          + '<br>Rev / Store: %{customdata[3]}'
          + '<br>Growth: %{customdata[4]}'
          + '<br>Plans Sold: %{customdata[5]}'
          + '<extra></extra>',
      },
      {
        type: 'scatter' as const,
        mode: 'lines+markers' as const,
        name: 'Cumulative %',
        x: rows.map(r => r.state),
        y: rows.map(r => r.cumulative),
        yaxis: 'y2' as const,
        line:   { color: '#f59e0b', width: 2.5 },
        marker: { size: 5, color: '#f59e0b' },
        hovertemplate: '<b>%{x}</b><br>Cumulative: %{y:.1f}%<extra></extra>',
      },
      {
        type: 'scatter' as const,
        mode: 'lines' as const,
        name: '80% Pareto line',
        x: [rows[0]?.state, rows[rows.length - 1]?.state],
        y: [80, 80],
        yaxis: 'y2' as const,
        line: { color: '#ef4444', width: 1.5, dash: 'dash' as const },
        hoverinfo: 'skip' as const,
        showlegend: true,
      },
    ]

    return { rows, totalStores, statesFor80, top5cum, top10cum, isConc, traces }
  }, [stateMetrics, classifiedStores, fm])

  // ── Sorted table rows ─────────────────────────────────────────────────────
  const tableRows = useMemo(() =>
    [...stateMetrics].sort((a, b) => {
      let d = 0
      switch (sortKey) {
        case 'state':   d = a.state.localeCompare(b.state); break
        case 'stores':  d = a.total     - b.total;          break
        case 'active':  d = a.active        - b.active;         break
        case 'inactive':d = a.inactiveStore - b.inactiveStore; break
        case 'growth':  d = (a.growthPct ?? -1e9) - (b.growthPct ?? -1e9); break
        case 'revenue': d = a.totalRevV - b.totalRevV;      break
        case 'health':  d = a.health    - b.health;         break
        case 'risk':    d = a.risk      - b.risk;           break
        case 'opp':     d = a.opp       - b.opp;            break
        default:        d = a.totalRevV - b.totalRevV
      }
      return sortDir === 'asc' ? d : -d
    }),
  [stateMetrics, sortKey, sortDir])

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }

  // ── Temporary validation: reconciliation check per state ──────────────────
  useEffect(() => {
    if (!stateMetrics.length) return
    console.group('[StateRanking] Reconciliation Validation')
    let totalPortfolioRev = 0
    stateMetrics.forEach(r => { totalPortfolioRev += r.totalRevV })
    stateMetrics.forEach(r => {
      const activeFromCats = r.newBloomer + r.rising + r.growing + r.constant + r.declining + r.fallen
      const activeFromTotal = r.total - r.inactiveStore
      const catSum  = activeFromCats + r.inactiveStore
      const catDiff = r.total - catSum
      const activeDiff = r.active - activeFromCats
      const netPctCalc = totalPortfolioRev > 0 ? (r.totalRevV / totalPortfolioRev * 100).toFixed(2) + '%' : 'N/A'
      if (catDiff !== 0 || activeDiff !== 0) {
        console.warn(`[MISMATCH] ${r.state}`, {
          stores:          r.total,
          active:          r.active,
          inactive:        r.inactiveStore,
          activeFromTotal,
          activeFromCats,
          activeDiff,
          new:      r.newBloomer,
          rising:   r.rising,
          growing:  r.growing,
          stable:   r.constant,
          decline:  r.declining,
          fallen:   r.fallen,
          catSum,
          catDiff,
          netPctCalc,
        })
      } else {
        console.log(`[OK] ${r.state}`, {
          stores: r.total, active: r.active, inactive: r.inactiveStore, catSum, netPctCalc,
        })
      }
    })
    console.groupEnd()
  }, [stateMetrics])

  const handleExportCsv = useCallback(() => {
    const headers = [
      'State', 'Stores', 'Active',
      'Early Rev', 'Recent Rev', 'Growth %', 'Avg/Store', 'Net %',
      'New Bloomer', 'Rising Star', 'Growing', 'Stable', 'Declining', 'Fallen', 'Inactive',
      'Health Score', 'Risk Index', 'Opportunity',
    ]
    const rows = tableRows.map(r => [
      r.state, r.total, r.active,
      r.earlyRev.toFixed(0), r.recentRev.toFixed(0),
      r.growthPct != null ? r.growthPct.toFixed(1) + '%' : 'N/A',
      r.avgStore.toFixed(0),
      r.netPct != null ? r.netPct.toFixed(1) + '%' : '—',
      r.newBloomer, r.rising, r.growing, r.constant, r.declining, r.fallen, r.inactiveStore,
      r.health.toFixed(1), r.risk.toFixed(1), r.opp,
    ])
    exportCsv('state-health', headers, rows)
  }, [tableRows])

  const sortIcon = (col: SortKey) =>
    sortKey !== col
      ? <ChevronUp className="h-3 w-3 opacity-25" />
      : sortDir === 'asc'
        ? <ChevronUp className="h-3 w-3 text-blue-600" />
        : <ChevronDown className="h-3 w-3 text-blue-600" />

  const card = 'rounded-xl border border-gray-200 bg-white p-4 shadow-sm'

  if (!stateMetrics.length) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white min-h-96 flex items-center justify-center">
        <p className="text-gray-400 text-sm">No data for selected filters</p>
      </div>
    )
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">

      {/* ── Page Header ── */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
      >
        <h2 className="text-base font-bold text-gray-900">State Health &amp; Risk</h2>
        <p className="text-[11px] text-gray-500 mt-0.5">
          {filters.state
            ? `${filters.state} · ${stateKpis?.totalStores ?? 0} stores · store-level detail`
            : `${kpis.statesInScope} states · ${kpis.totalStores} stores`
          }
          {mid.length > 0 ? ` · mid ${mid[0]}–${mid[mid.length - 1]}` : ''}
          {' · store journey funnel, health score, risk &amp; growth opportunity by geography'}
        </p>
      </motion.div>

      {/* ── KPI Hero Cards ── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stateKpis ? (
          // ── State-selected view: store-level KPIs ──
          <>
            {/* Total Stores in State */}
            <motion.div
              initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05, type: 'spring', stiffness: 280, damping: 24 }}
              className={cn(card, 'border-l-4 border-l-blue-500')}
            >
              <div className="flex items-center justify-between gap-2 mb-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-blue-600">Total Stores</p>
                <Store className="h-4 w-4 text-blue-400 shrink-0" />
              </div>
              <p className="text-3xl font-bold text-gray-900 tabular-nums">{stateKpis.totalStores}</p>
              <p className="text-[11px] text-gray-500 mt-1">in {stateKpis.stateName}</p>
            </motion.div>

            {/* Largest Contributing Store */}
            <motion.div
              initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.10, type: 'spring', stiffness: 280, damping: 24 }}
              className={cn(card, 'border-l-4 border-l-emerald-500')}
            >
              <div className="flex items-center justify-between gap-2 mb-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-600">Largest Store</p>
                <TrendingUp className="h-4 w-4 text-emerald-500 shrink-0" />
              </div>
              <p
                className="text-sm font-bold text-gray-900 truncate"
                title={stateKpis.largestStore?.store.store_name ?? stateKpis.largestStore?.store.store_id ?? ''}
              >
                {stateKpis.largestStore?.store.store_id ?? '—'}
              </p>
              <p className="text-[11px] text-gray-500 mt-1">{fmtInr(stateKpis.largestRev)}</p>
            </motion.div>

            {/* Fastest Growing Store */}
            <motion.div
              initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15, type: 'spring', stiffness: 280, damping: 24 }}
              className={cn(card, 'border-l-4 border-l-amber-400')}
            >
              <div className="flex items-center justify-between gap-2 mb-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-amber-600">Fastest Growing</p>
                <Star className="h-4 w-4 text-amber-500 shrink-0" />
              </div>
              <p
                className="text-sm font-bold text-gray-900 truncate"
                title={stateKpis.fastestGrowing?.store.store_name ?? stateKpis.fastestGrowing?.store.store_id ?? ''}
              >
                {stateKpis.fastestGrowing?.store.store_id ?? '—'}
              </p>
              <p className="text-[11px] text-emerald-600 mt-1 font-semibold">
                {stateKpis.fastestGrowing?.growthPct != null
                  ? fmtPct(stateKpis.fastestGrowing.growthPct)
                  : '—'}
              </p>
            </motion.div>

            {/* Highest Risk Store */}
            <motion.div
              initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.20, type: 'spring', stiffness: 280, damping: 24 }}
              className={cn(card, 'border-l-4 border-l-red-500')}
            >
              <div className="flex items-center justify-between gap-2 mb-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-red-600">Highest Risk Store</p>
                <ShieldAlert className="h-4 w-4 text-red-500 shrink-0" />
              </div>
              <p
                className="text-sm font-bold text-gray-900 truncate"
                title={stateKpis.highestRisk?.store.store_name ?? stateKpis.highestRisk?.store.store_id ?? ''}
              >
                {stateKpis.highestRisk?.store.store_id ?? '—'}
              </p>
              <p className="text-[11px] text-red-500 mt-1 font-semibold">
                {stateKpis.highestRisk?.category ?? '—'}
                {stateKpis.highestRisk?.growthPct != null
                  ? ` · ${fmtPct(stateKpis.highestRisk.growthPct)}`
                  : ''}
              </p>
            </motion.div>
          </>
        ) : (
          // ── All-states view: existing state-level KPIs ──
          <>
            {/* States in Scope */}
            <motion.div
              initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05, type: 'spring', stiffness: 280, damping: 24 }}
              className={cn(card, 'border-l-4 border-l-gray-400')}
            >
              <div className="flex items-center justify-between gap-2 mb-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">States in Scope</p>
                <MapPin className="h-4 w-4 text-gray-400 shrink-0" />
              </div>
              <p className="text-3xl font-bold text-gray-900 tabular-nums">{kpis.statesInScope}</p>
              <p className="text-[11px] text-gray-500 mt-1">{kpis.totalStores} stores total</p>
            </motion.div>

            {/* Largest Contributor */}
            <motion.div
              initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.10, type: 'spring', stiffness: 280, damping: 24 }}
              className={cn(card, 'border-l-4 border-l-emerald-500')}
            >
              <div className="flex items-center justify-between gap-2 mb-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-600">Largest Contributor</p>
                <TrendingUp className="h-4 w-4 text-emerald-500 shrink-0" />
              </div>
              <p className="text-xl font-bold text-gray-900 truncate" title={kpis.largest?.state ?? ''}>
                {kpis.largest?.state ?? '—'}
              </p>
              <p className="text-[11px] text-gray-500 mt-1">
                {kpis.largestPct.toFixed(1)}% · {fmtInr(kpis.largest?.totalRevV ?? 0)}
              </p>
            </motion.div>

            {/* Fastest Growing */}
            <motion.div
              initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15, type: 'spring', stiffness: 280, damping: 24 }}
              className={cn(card, 'border-l-4 border-l-amber-400')}
            >
              <div className="flex items-center justify-between gap-2 mb-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-amber-600">Fastest Growing</p>
                <Star className="h-4 w-4 text-amber-500 shrink-0" />
              </div>
              <p className="text-xl font-bold text-gray-900 truncate" title={kpis.fastestGrowing?.state ?? ''}>
                {kpis.fastestGrowing?.state ?? '—'}
              </p>
              <p className="text-[11px] text-emerald-600 mt-1 font-semibold">
                {kpis.fastestGrowing?.growthPct != null
                  ? fmtPct(kpis.fastestGrowing.growthPct)
                  : '—'}
              </p>
            </motion.div>

            {/* Highest Risk */}
            <motion.div
              initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.20, type: 'spring', stiffness: 280, damping: 24 }}
              className={cn(card, 'border-l-4 border-l-red-500')}
            >
              <div className="flex items-center justify-between gap-2 mb-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-red-600">Highest Risk</p>
                <ShieldAlert className="h-4 w-4 text-red-500 shrink-0" />
              </div>
              <p className="text-xl font-bold text-gray-900 truncate" title={kpis.highestRisk?.state ?? ''}>
                {kpis.highestRisk?.state ?? '—'}
              </p>
              <p className="text-[11px] text-red-500 mt-1 font-semibold">
                Risk {kpis.highestRisk?.risk?.toFixed(1) ?? '—'} ·{' '}
                {kpis.highestRisk?.fallen ?? 0}/{kpis.highestRisk?.total ?? 0} fallen
              </p>
            </motion.div>
          </>
        )}
      </div>

      {/* ── Row 2: Funnel + Revenue Comparison ── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">

        {/* Network Store Journey Funnel */}
        <motion.div
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.12, duration: 0.4 }}
          className={card}
        >
          <h3 className="text-sm font-semibold text-gray-800 mb-0.5">Network Store Journey Funnel</h3>
          <p className="text-[11px] text-gray-400 mb-4">
            {filters.state
              ? `From all stores down to rising stars · ${filters.state} only (${funnel.all} stores)`
              : 'From all stores down to rising stars · across in-scope states'
            }
          </p>
          <NetworkFunnel counts={funnel} total={funnel.all} />
        </motion.div>

        {/* Revenue Contribution by State / Store Revenue by State */}
        <motion.div
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.18, duration: 0.4 }}
          className={card}
        >
          {filters.state ? (
            /* ── Drill-down: store revenue ranking leaderboard ── */
            (() => {
              const CAT_CFG: Record<string, { bar: string; badge: string; text: string; label: string }> = {
                'Rising Star':     { bar: '#f59e0b', badge: '#fef3c7', text: '#92400e', label: 'Rising Star'     },
                'New Bloomer':     { bar: '#4ade80', badge: '#dcfce7', text: '#166534', label: 'New Bloomer'     },
                'Growing Store':   { bar: '#22c55e', badge: '#dcfce7', text: '#166534', label: 'Growing'         },
                'Constant Store':  { bar: '#f97316', badge: '#ffedd5', text: '#9a3412', label: 'Stable'          },
                'Declining Store': { bar: '#ef4444', badge: '#fee2e2', text: '#991b1b', label: 'Declining'       },
                'Fallen Star':     { bar: '#dc2626', badge: '#fee2e2', text: '#7f1d1d', label: 'Fallen Star'     },
                'Inactive Store':  { bar: '#9ca3af', badge: '#f3f4f6', text: '#6b7280', label: 'Inactive'        },
              }

              const growthCfg = (g: number | null) =>
                g === null           ? { bg: '#f3f4f6', fg: '#6b7280', label: 'N/A'            } :
                g >= 15              ? { bg: '#dcfce7', fg: '#15803d', label: `▲ ${g.toFixed(1)}%` } :
                g >= 0               ? { bg: '#f0fdf4', fg: '#15803d', label: `▲ ${g.toFixed(1)}%` } :
                g >= -15             ? { bg: '#ffedd5', fg: '#c2410c', label: `▼ ${Math.abs(g).toFixed(1)}%` } :
                                       { bg: '#fee2e2', fg: '#dc2626', label: `▼ ${Math.abs(g).toFixed(1)}%` }

              const { stores, totalRev, maxRev, growing, atRisk, count, stateName } = storeCompData

              return (
                <>
                  {/* Header */}
                  <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
                    <div>
                      <h3 className="text-sm font-semibold text-gray-800">Store Revenue Ranking</h3>
                      <p className="text-[11px] text-gray-400 mt-0.5">
                        {count} stores in{' '}
                        <span className="font-semibold text-blue-600">{stateName}</span>
                        {' · ranked by total revenue'}
                      </p>
                    </div>
                    <div className="text-xs border border-blue-200 rounded-lg px-2.5 py-1.5 bg-blue-50 text-blue-700 shrink-0">
                      {filters.state} (filtered)
                    </div>
                  </div>

                  {/* 3 summary stat pills */}
                  {count > 0 && (
                    <div className="grid grid-cols-3 gap-2 mb-3">
                      <div className="rounded-lg bg-gray-50 border border-gray-100 px-2.5 py-2 text-center">
                        <p className="text-[9px] font-bold uppercase tracking-widest text-gray-400 mb-0.5">State Revenue</p>
                        <p className="text-[13px] font-bold text-gray-900 tabular-nums">{fmtInr(totalRev)}</p>
                      </div>
                      <div className="rounded-lg bg-emerald-50 border border-emerald-100 px-2.5 py-2 text-center">
                        <p className="text-[9px] font-bold uppercase tracking-widest text-emerald-600 mb-0.5">Growing</p>
                        <p className="text-[13px] font-bold text-emerald-700 tabular-nums">
                          {growing} <span className="text-[10px] font-normal text-emerald-500">/ {count}</span>
                        </p>
                      </div>
                      <div className="rounded-lg bg-red-50 border border-red-100 px-2.5 py-2 text-center">
                        <p className="text-[9px] font-bold uppercase tracking-widest text-red-500 mb-0.5">At-Risk</p>
                        <p className="text-[13px] font-bold text-red-600 tabular-nums">
                          {atRisk} <span className="text-[10px] font-normal text-red-400">/ {count}</span>
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Column headers */}
                  {count > 0 && (
                    <div className="flex items-center gap-2 px-3 mb-1">
                      <span className="w-7 shrink-0" />
                      <span className="flex-1 text-[9px] font-bold uppercase tracking-wider text-gray-400">Store</span>
                      <span className="text-[9px] font-bold uppercase tracking-wider text-gray-400 shrink-0 w-16 text-right">Revenue</span>
                      <span className="text-[9px] font-bold uppercase tracking-wider text-gray-400 shrink-0 w-12 text-right">Share</span>
                      <span className="text-[9px] font-bold uppercase tracking-wider text-gray-400 shrink-0 w-16 text-right">Growth</span>
                    </div>
                  )}

                  {/* Ranked rows */}
                  {count > 0 ? (
                    <div className="overflow-y-auto space-y-1" style={{ maxHeight: 380 }}>
                      {stores.map((c, i) => {
                        const cfg      = CAT_CFG[c.category] ?? CAT_CFG['Constant Store']
                        const gCfg     = growthCfg(c.growthPct)
                        const barPct   = maxRev > 0 ? Math.max((c.rev / maxRev) * 100, 2) : 2
                        const revShare = totalRev > 0 ? (c.rev / totalRev * 100) : 0
                        const name     = c.store.store_name ?? c.store.store_id
                        const rank     = i + 1

                        return (
                          <div
                            key={c.store.store_id}
                            className="rounded-lg px-3 py-2 bg-gray-50/80 hover:bg-blue-50/60 transition-colors cursor-default"
                            title={`${name} · ${c.category} · Revenue: ${fmtInr(c.rev)} · Growth: ${c.growthPct !== null ? fmtPct(c.growthPct) : 'N/A'}`}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              {/* Rank badge */}
                              <span className={cn(
                                'w-7 text-center text-[10px] font-bold tabular-nums shrink-0',
                                rank === 1 ? 'text-amber-500' : rank === 2 ? 'text-gray-400' : rank === 3 ? 'text-orange-400' : 'text-gray-300',
                              )}>
                                #{rank}
                              </span>

                              {/* Store name + category chip */}
                              <div className="flex-1 min-w-0 flex items-center gap-1.5 overflow-hidden">
                                <span className="text-[11px] font-semibold text-gray-800 truncate">{name}</span>
                                <span
                                  className="shrink-0 px-1.5 py-0.5 rounded-full text-[8px] font-bold whitespace-nowrap"
                                  style={{ backgroundColor: cfg.badge, color: cfg.text }}
                                >
                                  {cfg.label}
                                </span>
                              </div>

                              {/* Revenue */}
                              <span className="text-[11px] font-bold text-gray-900 tabular-nums shrink-0 w-16 text-right">
                                {fmtInr(c.rev)}
                              </span>

                              {/* Revenue share of state */}
                              <span className="text-[9px] text-gray-400 tabular-nums shrink-0 w-12 text-right">
                                {revShare.toFixed(1)}%
                              </span>

                              {/* Growth badge */}
                              <span
                                className="shrink-0 px-1.5 py-0.5 rounded-full text-[9px] font-bold tabular-nums w-16 text-right"
                                style={{ backgroundColor: gCfg.bg, color: gCfg.fg }}
                              >
                                {gCfg.label}
                              </span>
                            </div>

                            {/* Revenue bar */}
                            <div className="mt-1.5 h-1 w-full rounded-full bg-gray-200 overflow-hidden">
                              <motion.div
                                className="h-full rounded-full"
                                style={{ backgroundColor: cfg.bar }}
                                initial={{ width: 0 }}
                                animate={{ width: `${barPct}%` }}
                                transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1], delay: i * 0.02 }}
                              />
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-48 text-gray-400 text-sm">
                      No store data for selected state
                    </div>
                  )}
                </>
              )
            })()
          ) : (
            /* ── Executive overview: state performance leaderboard ── */
            <>
              <div className="mb-3">
                <h3 className="text-sm font-semibold text-gray-800">State Performance Leaderboard</h3>
                <p className="text-[11px] text-gray-400 mt-0.5">
                  Ranked by revenue · bar = revenue share · colour = health score
                </p>
              </div>

              {leaderboardData && stateMetrics.length > 0 ? (
                <div className="space-y-3">

                  {/* ── Quick-scan summary cards ── */}
                  <div className="grid grid-cols-3 gap-2">

                    {/* Top 5 Revenue */}
                    <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-2.5">
                      <p className="text-[9px] font-bold uppercase tracking-widest text-emerald-700 mb-2">Top Revenue</p>
                      {stateMetrics.slice(0, 5).map((m, i) => (
                        <div key={m.state} className="flex items-center gap-1 py-0.5">
                          <span className="text-[9px] font-bold text-emerald-600 tabular-nums shrink-0 w-5">#{i + 1}</span>
                          <span className="text-[9px] text-gray-700 truncate flex-1">{m.state}</span>
                          <span className="text-[9px] font-semibold text-gray-800 tabular-nums shrink-0">{fmtInr(m.totalRevV)}</span>
                        </div>
                      ))}
                    </div>

                    {/* Top 5 Growth */}
                    <div className="rounded-lg border border-blue-100 bg-blue-50 p-2.5">
                      <p className="text-[9px] font-bold uppercase tracking-widest text-blue-700 mb-2">Top Growth</p>
                      {leaderboardData.topGrowth.map((m, i) => (
                        <div key={m.state} className="flex items-center gap-1 py-0.5">
                          <span className="text-[9px] font-bold text-blue-500 tabular-nums shrink-0 w-5">#{i + 1}</span>
                          <span className="text-[9px] text-gray-700 truncate flex-1">{m.state}</span>
                          <span className="text-[9px] font-semibold text-emerald-600 tabular-nums shrink-0">{fmtPct(m.growthPct!)}</span>
                        </div>
                      ))}
                    </div>

                    {/* Bottom 5 Growth (risk) */}
                    <div className="rounded-lg border border-red-100 bg-red-50 p-2.5">
                      <p className="text-[9px] font-bold uppercase tracking-widest text-red-700 mb-2">Growth Risk</p>
                      {leaderboardData.bottomGrowth.map((m, i) => (
                        <div key={m.state} className="flex items-center gap-1 py-0.5">
                          <span className="text-[9px] font-bold text-red-400 tabular-nums shrink-0 w-5">#{i + 1}</span>
                          <span className="text-[9px] text-gray-700 truncate flex-1">{m.state}</span>
                          <span className="text-[9px] font-semibold text-red-600 tabular-nums shrink-0">{fmtPct(m.growthPct!)}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* ── Leaderboard rows ── */}
                  <div className="overflow-y-auto space-y-1" style={{ maxHeight: 230 }}>
                    {stateMetrics.map((m, i) => {
                      const barPct = leaderboardData.maxRev > 0
                        ? Math.max((m.totalRevV / leaderboardData.maxRev) * 100, 2)
                        : 2
                      const gRank = leaderboardData.growthRankMap.get(m.state)
                      return (
                        <div
                          key={m.state}
                          className="rounded-lg px-3 py-2 bg-gray-50/80 hover:bg-blue-50 transition-colors cursor-default"
                          title={`${m.state}  ·  Revenue: ${fmtInr(m.totalRevV)}  ·  Growth: ${m.growthPct != null ? fmtPct(m.growthPct) : 'N/A'}  ·  Health: ${m.health.toFixed(1)}  ·  Stores: ${m.total} (${m.active} active)  ·  Rev rank: #${i + 1}  ·  Growth rank: ${gRank != null ? `#${gRank}` : '—'}`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            {/* Revenue rank */}
                            <span className="text-[9px] font-bold text-gray-400 tabular-nums shrink-0 w-5">
                              #{i + 1}
                            </span>
                            {/* State name */}
                            <span className="text-[11px] font-semibold text-gray-800 truncate flex-1 min-w-0">
                              {m.state}
                            </span>
                            {/* Revenue */}
                            <span className="text-[10px] font-bold text-gray-900 tabular-nums shrink-0">
                              {fmtInr(m.totalRevV)}
                            </span>
                            {/* Growth badge */}
                            <span className={cn(
                              'text-[9px] font-bold px-1.5 py-0.5 rounded-full tabular-nums shrink-0',
                              m.growthPct === null
                                ? 'bg-gray-100 text-gray-500'
                                : m.growthPct >= 0
                                  ? 'bg-emerald-100 text-emerald-700'
                                  : 'bg-red-100 text-red-700',
                            )}>
                              {m.growthPct === null ? 'N/A' : fmtPct(m.growthPct)}
                            </span>
                            {/* Health badge */}
                            <span className={cn(
                              'text-[9px] font-bold px-1.5 py-0.5 rounded tabular-nums shrink-0',
                              m.health >= 75 ? 'bg-emerald-100 text-emerald-700'
                              : m.health >= 50 ? 'bg-amber-100 text-amber-700'
                              : 'bg-red-100 text-red-700',
                            )}>
                              H{m.health.toFixed(0)}
                            </span>
                            {/* Store count */}
                            <span className="text-[9px] text-gray-400 tabular-nums shrink-0">
                              {m.total} sts
                            </span>
                            {/* Growth rank (dimmed) */}
                            <span className="text-[8px] text-gray-300 tabular-nums shrink-0 w-7 text-right">
                              G#{gRank ?? '—'}
                            </span>
                          </div>
                          {/* Revenue bar */}
                          <div className="mt-1.5 h-1.5 w-full rounded-full bg-gray-200 overflow-hidden">
                            <motion.div
                              className="h-full rounded-full"
                              style={{
                                backgroundColor:
                                  m.health >= 75 ? '#10b981'
                                  : m.health >= 50 ? '#f59e0b'
                                  : '#ef4444',
                              }}
                              initial={{ width: 0 }}
                              animate={{ width: `${barPct}%` }}
                              transition={{ duration: 0.75, ease: [0.22, 1, 0.36, 1], delay: i * 0.03 }}
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>

                </div>
              ) : (
                <div className="flex items-center justify-center h-48 text-gray-400 text-sm">
                  No state data available
                </div>
              )}
            </>
          )}
        </motion.div>
      </div>

      {/* ── Store Distribution / Store Footprint Concentration ── */}
      <motion.div
        initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.22, duration: 0.4 }}
        className={card}
      >
        <h3 className="text-sm font-semibold text-gray-800 mb-0.5">
          {filters.state ? `Store Distribution — ${filters.state}` : 'Store Footprint Concentration'}
        </h3>
        <p className="text-[11px] text-gray-400 mb-3">
          {filters.state
            ? `Category health breakdown · ${stateScopedStores.length} stores total · bar colour = category`
            : 'Shows how the store network is distributed across states and highlights concentration risk'
          }
        </p>

        {filters.state && stateCatData ? (
          /* ── Existing category drill-down (unchanged) ── */
          <div className="overflow-y-auto" style={{ maxHeight: 560 }}>
            <Plot
              data={stateCatData.traces}
              layout={{
                ...PLOTLY_BASE,
                xaxis: {
                  gridcolor: PT.grid, linecolor: PT.line, tickcolor: PT.line,
                  title: { text: 'Number of Stores', font: { size: 10, color: '#6b7280' } },
                  automargin: true,
                },
                yaxis: {
                  gridcolor: PT.grid, linecolor: PT.line,
                  tickfont: { size: 12 }, automargin: true,
                },
                margin: { l: 140, r: 110, t: 8, b: 50 },
                height: stateCatData.height,
                showlegend: false,
              }}
              config={{ displayModeBar: false, responsive: true }}
              style={{ width: '100%' }}
            />
          </div>
        ) : paretoData ? (
          /* ── Pareto: Store Footprint Concentration ── */
          <>
            {/* Dynamic insight chips */}
            <div className="flex flex-wrap gap-2 mb-4">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 border border-blue-100 px-3 py-1 text-[10px] font-semibold text-blue-700">
                Top {Math.min(5, paretoData.rows.length)} states →{' '}
                <span className="font-bold">{paretoData.top5cum.toFixed(0)}%</span> of stores
              </span>
              {paretoData.rows.length > 5 && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 border border-blue-100 px-3 py-1 text-[10px] font-semibold text-blue-700">
                  Top {Math.min(10, paretoData.rows.length)} states →{' '}
                  <span className="font-bold">{paretoData.top10cum.toFixed(0)}%</span> of stores
                </span>
              )}
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 border border-amber-100 px-3 py-1 text-[10px] font-semibold text-amber-700">
                <span className="font-bold">{paretoData.statesFor80}</span> of{' '}
                {paretoData.rows.length} states reach the 80% threshold
              </span>
              <span className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-semibold border',
                paretoData.isConc
                  ? 'bg-red-50 border-red-100 text-red-700'
                  : 'bg-emerald-50 border-emerald-100 text-emerald-700',
              )}>
                {paretoData.isConc ? 'Highly Concentrated' : 'Broadly Distributed'}
              </span>
            </div>

            {/* Pareto chart */}
            <Plot
              data={paretoData.traces}
              layout={{
                ...PLOTLY_BASE,
                yaxis: {
                  gridcolor: PT.grid, linecolor: PT.line, tickcolor: PT.line,
                  title: { text: 'Store Count', font: { size: 10, color: '#6b7280' } },
                  automargin: true,
                },
                yaxis2: {
                  title: { text: 'Cumulative %', font: { size: 10, color: '#6b7280' } },
                  overlaying: 'y' as const,
                  side: 'right' as const,
                  range: [0, 106],
                  ticksuffix: '%',
                  gridcolor: 'transparent',
                  linecolor: PT.line,
                  automargin: true,
                  fixedrange: true,
                },
                xaxis: {
                  gridcolor: PT.grid, linecolor: PT.line, tickcolor: PT.line,
                  tickangle: -40,
                  tickfont: { size: 10 },
                  automargin: true,
                },
                legend: {
                  orientation: 'h' as const,
                  y: -0.22,
                  font: { size: 10, color: PT.font },
                  bgcolor: 'rgba(0,0,0,0)',
                },
                height: 400,
                margin: { l: 50, r: 60, t: 10, b: 90 },
              }}
              config={{ displayModeBar: false, responsive: true }}
              style={{ width: '100%' }}
            />

            {/* Legend note */}
            <p className="text-[10px] text-gray-400 mt-1">
              Blue bars = states within 80% threshold · Light bars = remaining states ·
              Hover for revenue, growth and plans detail
            </p>
          </>
        ) : (
          <div className="flex items-center justify-center h-48 text-gray-400 text-sm">
            No state data available
          </div>
        )}
      </motion.div>

      {/* ── Metric Definitions ── */}
      <motion.div
        initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.28, duration: 0.4 }}
        className="rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-3"
      >
        <p className="text-[11px] font-semibold uppercase tracking-wider text-blue-500 mb-2.5">Metric Definitions</p>
        <div className="grid grid-cols-2 gap-x-8 gap-y-2 sm:grid-cols-3">
          {([
            {
              label: 'Active Stores',
              formula: 'Stores with ≥ 1 sale in the recent period',
              color: 'text-emerald-700',
            },
            {
              label: 'Inactive Stores',
              formula: 'Classified as "Inactive Store" — no revenue in both mid & recent periods',
              color: 'text-gray-500',
            },
            {
              label: 'Net %',
              formula: 'State Revenue ÷ Total Portfolio Revenue × 100 — share of all-India sales',
              color: 'text-blue-700',
            },
            {
              label: 'Health Score (0–100)',
              formula: '(Active % × 50) + (Growth Health × 30) + (Rising Star % × 20) — higher is better',
              color: 'text-emerald-700',
            },
            {
              label: 'Risk Index (0–100)',
              formula: '(Fallen Stars × 1.0 + Inactive Stores × 0.5) ÷ Total Stores × 100 — higher is worse',
              color: 'text-red-600',
            },
            {
              label: 'Opportunity (Opp.)',
              formula: 'Count of Rising Star stores — stores with strong upward revenue momentum',
              color: 'text-amber-700',
            },
          ] as const).map(({ label, formula, color }) => (
            <div key={label} className="flex gap-1.5 items-start min-w-0">
              <Info className={cn('h-3 w-3 mt-0.5 shrink-0', color)} />
              <div className="min-w-0">
                <span className={cn('text-[11px] font-semibold', color)}>{label}: </span>
                <span className="text-[11px] text-gray-500">{formula}</span>
              </div>
            </div>
          ))}
        </div>
      </motion.div>

      {/* ── State Ranking Table ── */}
      <motion.div
        initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.30, duration: 0.4 }}
      >
        <DataTable
          title="State Ranking Table"
          subtitle="Click a column header to sort"
          onExportCsv={handleExportCsv}
        >
        <table className="w-full text-xs whitespace-nowrap">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="px-3 py-2.5 text-left text-gray-400 w-8 sticky left-0 bg-gray-50">#</th>

                <th className="px-3 py-2.5 text-left sticky left-8 bg-gray-50 z-10 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)]">
                  <button onClick={() => toggleSort('state')} className="flex items-center gap-1 font-semibold uppercase tracking-wider text-gray-500 hover:text-gray-800 transition-colors">
                    State{sortIcon('state')}
                  </button>
                </th>

                {([
                  { col: 'Stores', key: 'stores', tip: 'Total stores in this state' },
                  { col: 'Active', key: 'active', tip: 'Stores with ≥ 1 sale in the recent period' },
                ] as const).map(({ col, key, tip }) => (
                  <th key={col} className="px-3 py-2.5 text-center">
                    <button
                      onClick={() => toggleSort(key)}
                      title={tip}
                      className="flex items-center gap-1 font-semibold uppercase tracking-wider text-gray-500 hover:text-gray-800 transition-colors mx-auto"
                    >
                      {col}{sortIcon(key)}
                    </button>
                  </th>
                ))}

                <th className="px-3 py-2.5 text-right font-semibold uppercase tracking-wider text-gray-500">Early</th>
                <th className="px-3 py-2.5 text-right font-semibold uppercase tracking-wider text-gray-500">Recent</th>

                <th className="px-3 py-2.5 text-right">
                  <button onClick={() => toggleSort('growth')} className="flex items-center gap-1 font-semibold uppercase tracking-wider text-gray-500 hover:text-gray-800 transition-colors ml-auto">
                    Growth%{sortIcon('growth')}
                  </button>
                </th>

                <th className="px-3 py-2.5 text-right">
                  <button onClick={() => toggleSort('revenue')} className="flex items-center gap-1 font-semibold uppercase tracking-wider text-gray-500 hover:text-gray-800 transition-colors ml-auto">
                    Avg/Store{sortIcon('revenue')}
                  </button>
                </th>

                <th className="px-3 py-2.5 text-right font-semibold uppercase tracking-wider text-gray-500">
                  <span title="State Revenue ÷ Total Portfolio Revenue × 100 — share of all-India sales" className="cursor-help">Net%</span>
                </th>

                <th className="px-3 py-2.5 text-center font-semibold uppercase tracking-wider text-emerald-600" title="New Bloomer stores">New</th>
                <th className="px-3 py-2.5 text-center font-semibold uppercase tracking-wider text-amber-600" title="Rising Star stores">Rising</th>
                <th className="px-3 py-2.5 text-center font-semibold uppercase tracking-wider text-blue-500" title="Growing Store stores">Growing</th>
                <th className="px-3 py-2.5 text-center font-semibold uppercase tracking-wider text-violet-500" title="Constant (Stable) stores">Stable</th>
                <th className="px-3 py-2.5 text-center font-semibold uppercase tracking-wider text-orange-500" title="Declining Store stores">Decline</th>
                <th className="px-3 py-2.5 text-center font-semibold uppercase tracking-wider text-red-500" title="Fallen Star stores">Fallen</th>
                <th className="px-3 py-2.5 text-center font-semibold uppercase tracking-wider text-gray-400" title="Stores classified as 'Inactive Store' — no revenue in both mid & recent periods">Inactive</th>

                <th className="px-3 py-2.5 text-right">
                  <button
                    onClick={() => toggleSort('health')}
                    title="Health Score (0–100): (Active % × 50) + (Growth Health × 30) + (Rising Star % × 20). Higher is better."
                    className="flex items-center gap-1 font-semibold uppercase tracking-wider text-gray-500 hover:text-gray-800 transition-colors ml-auto"
                  >
                    Health{sortIcon('health')}
                  </button>
                </th>
                <th className="px-3 py-2.5 text-right">
                  <button
                    onClick={() => toggleSort('risk')}
                    title="Risk Index (0–100): (Fallen Stars × 1.0 + Inactive Stores × 0.5) ÷ Total Stores × 100. Higher is worse."
                    className="flex items-center gap-1 font-semibold uppercase tracking-wider text-gray-500 hover:text-gray-800 transition-colors ml-auto"
                  >
                    Risk{sortIcon('risk')}
                  </button>
                </th>
                <th className="px-3 py-2.5 text-right">
                  <button
                    onClick={() => toggleSort('opp')}
                    title="Opportunity: count of Rising Star stores — stores with strong upward revenue momentum"
                    className="flex items-center gap-1 font-semibold uppercase tracking-wider text-gray-500 hover:text-gray-800 transition-colors ml-auto"
                  >
                    <Zap className="h-3 w-3 text-amber-500" />Opp.{sortIcon('opp')}
                  </button>
                </th>

                <th className="px-3 py-2.5 text-left font-semibold uppercase tracking-wider text-gray-400">Top</th>
                <th className="px-3 py-2.5 text-left font-semibold uppercase tracking-wider text-gray-400">Worst</th>
              </tr>
            </thead>

            <tbody>
              {tableRows.map((row, i) => (
                <tr key={row.state} className="border-b border-gray-100 hover:bg-blue-50/40 transition-colors">
                  <td className="px-3 py-2.5 text-gray-400 tabular-nums sticky left-0 bg-white">{i + 1}</td>

                  <td className="px-3 py-2.5 sticky left-8 bg-white z-10 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)]">
                    <span className="font-semibold text-gray-800">{row.state}</span>
                  </td>

                  <td className="px-3 py-2.5 text-center text-gray-700 tabular-nums font-medium">{row.total}</td>
                  <td className="px-3 py-2.5 text-center text-emerald-600 tabular-nums font-medium">{row.active}</td>

                  <td className="px-3 py-2.5 text-right text-gray-600 tabular-nums">{fmtInr(row.earlyRev)}</td>
                  <td className="px-3 py-2.5 text-right text-gray-800 tabular-nums font-medium">{fmtInr(row.recentRev)}</td>

                  <td className={cn(
                    'px-3 py-2.5 text-right tabular-nums font-semibold',
                    row.growthPct === null ? 'text-gray-400'
                      : row.growthPct >= 0  ? 'text-emerald-600' : 'text-red-500',
                  )}>
                    {row.growthPct === null ? 'N/A' : fmtPct(row.growthPct)}
                  </td>

                  <td className="px-3 py-2.5 text-right text-gray-700 tabular-nums">{fmtInr(row.avgStore)}</td>

                  <td className={cn(
                    'px-3 py-2.5 text-right tabular-nums',
                    row.netPct === null ? 'text-gray-400' : 'text-blue-600 font-medium',
                  )}>
                    {row.netPct === null ? '—' : `${row.netPct.toFixed(1)}%`}
                  </td>

                  <td className="px-3 py-2.5 text-center">
                    {row.newBloomer > 0
                      ? <span className="inline-flex items-center justify-center h-5 min-w-[20px] rounded-full bg-emerald-100 text-emerald-700 font-bold px-1.5">{row.newBloomer}</span>
                      : <span className="text-gray-300">0</span>}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    {row.rising > 0
                      ? <span className="inline-flex items-center justify-center h-5 min-w-[20px] rounded-full bg-amber-100 text-amber-700 font-bold px-1.5">{row.rising}</span>
                      : <span className="text-gray-300">0</span>}
                  </td>
                  <td className="px-3 py-2.5 text-center text-blue-500 tabular-nums">{row.growing}</td>
                  <td className="px-3 py-2.5 text-center text-violet-500 tabular-nums">{row.constant}</td>
                  <td className="px-3 py-2.5 text-center text-orange-500 tabular-nums">{row.declining}</td>
                  <td className="px-3 py-2.5 text-center">
                    {row.fallen > 0
                      ? <span className="inline-flex items-center justify-center h-5 min-w-[20px] rounded-full bg-red-100 text-red-600 font-bold px-1.5">{row.fallen}</span>
                      : <span className="text-gray-300">0</span>}
                  </td>
                  <td className="px-3 py-2.5 text-center text-gray-400 tabular-nums">
                    {row.inactiveStore > 0 ? row.inactiveStore : <span className="text-gray-200">0</span>}
                  </td>

                  <td className="px-3 py-2.5 text-right"><HealthBadge value={row.health} /></td>
                  <td className="px-3 py-2.5 text-right"><RiskBadge value={row.risk} /></td>

                  <td className="px-3 py-2.5 text-right">
                    <span className="inline-flex items-center gap-0.5 text-amber-600 font-semibold tabular-nums">
                      <Zap className="h-3 w-3" />{row.opp}
                    </span>
                  </td>

                  <td className="px-3 py-2.5 max-w-[120px]">
                    <span className="block truncate text-gray-600" title={row.topStore?.store.store_name ?? row.topStore?.store.store_id ?? ''}>
                      {row.topStore?.store.store_id ?? '—'}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 max-w-[120px]">
                    <span className="block truncate text-gray-400" title={row.worstStore?.store.store_name ?? row.worstStore?.store.store_id ?? ''}>
                      {row.worstStore?.store.store_id ?? '—'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataTable>
      </motion.div>

    </div>
  )
}
