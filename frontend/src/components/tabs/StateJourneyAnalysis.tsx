import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ChevronUp, ChevronDown,
  TrendingUp, TrendingDown,
  Star, ShieldAlert, Zap, MapPin, Store,
} from 'lucide-react'
import createPlotlyComponent from 'react-plotly.js/factory'
// @ts-ignore — plotly.js-dist-min does not ship its own .d.ts
import Plotly from 'plotly.js-dist-min'
import { useDataContext } from '@/contexts/DataContext'
import type { FilterState } from '@/hooks/useFilters'
import type { StoreRecord } from '@/lib/api'
import { allocatePhases, type StoreCategory } from '@/lib/classificationEngine'
import { cn } from '@/lib/utils'
import { fmtInr, fmtPct } from '@/lib/formatting'
import { PT, PLOTLY_BASE } from '@/lib/plotlyTheme'

const Plot = createPlotlyComponent(Plotly)

// ── Types ─────────────────────────────────────────────────────────────────────

type SortKey = 'state' | 'stores' | 'active' | 'growth' | 'revenue' | 'health' | 'risk' | 'opp'

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
  const { stores, months, classification } = useDataContext()
  const [sortKey, setSortKey] = useState<SortKey>('revenue')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [compState, setCompState] = useState<string | null>(null)

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
    let scope = classification.metrics
    if (filters.category) scope = scope.filter(m => m.store.category === filters.category)

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
  }, [classification.metrics, filters.category, fm, early, recent])

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
      const active    = data.filter(d => d.isRecentActive).length
      const inactive  = total - active
      const earlyRev  = data.reduce((s, d) => s + d.earlyR, 0)
      const recentRev = data.reduce((s, d) => s + d.recentR, 0)
      const totalRevV = data.reduce((s, d) => s + d.rev, 0)

      const growthPct = earlyRev > 0 ? (recentRev - earlyRev) / earlyRev * 100 : null
      const netPct    = totalPortfolioRev > 0 ? totalRevV / totalPortfolioRev * 100 : null
      const avgStore  = total > 0 ? totalRevV / total : 0

      const newBloomer    = data.filter(d => d.category === 'New Bloomer').length
      const rising        = data.filter(d => d.category === 'Rising Star').length
      const growing       = data.filter(d => d.category === 'Growing Store').length
      const constant      = data.filter(d => d.category === 'Constant Store').length
      const declining     = data.filter(d => d.category === 'Declining Store').length
      const fallen        = data.filter(d => d.category === 'Fallen Star').length
      const inactiveStore = data.filter(d => d.category === 'Inactive Store').length

      const activeRatio  = total > 0 ? active / total : 0
      const growthHealth = growthPct !== null
        ? Math.max(0, Math.min(1, (growthPct + 100) / 200))
        : 0.5
      const risingRatio  = total > 0 ? rising / total : 0
      const health = Math.round((activeRatio * 0.5 + growthHealth * 0.3 + risingRatio * 0.2) * 100 * 10) / 10

      const risk = Math.round(
        total > 0 ? (fallen * 1.0 + inactive * 0.5) / total * 100 * 10 / 10 : 0
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

  // ── Store Revenue by State chart ───────────────────────────────────────────
  const storeCompData = useMemo(() => {
    const largestState = stateMetrics[0]?.state ?? null
    // Global state filter takes priority over the local dropdown
    const effectiveSt  = filters.state || compState || largestState
    if (!effectiveSt) return { traces: [], stateName: '', count: 0, chartHeight: 320 }

    const stateStores = classifiedStores
      .filter(c => (c.store.state ?? 'Unknown') === effectiveSt)
      .sort((a, b) => a.rev - b.rev)

    if (!stateStores.length) return { traces: [], stateName: effectiveSt, count: 0, chartHeight: 320 }

    const labels = stateStores.map(c => c.store.store_name ?? c.store.store_id)

    const recentColors = stateStores.map(c =>
      c.growthPct === null ? '#94a3b8'
      : c.growthPct >= 15  ? '#15803d'
      : c.growthPct >= 0   ? '#4ade80'
      : c.growthPct >= -15 ? '#f97316'
      :                      '#dc2626'
    )

    const growthLabels = stateStores.map(c =>
      c.growthPct !== null
        ? `  ${c.growthPct >= 0 ? '▲' : '▼'} ${Math.abs(c.growthPct).toFixed(1)}%`
        : ''
    )

    const growthLabelColors = stateStores.map(c =>
      c.growthPct === null ? '#94a3b8'
      : c.growthPct >= 0   ? '#15803d'
      :                      '#dc2626'
    )

    const chartHeight = Math.max(320, stateStores.length * 30 + 80)

    return {
      stateName: effectiveSt,
      count: stateStores.length,
      chartHeight,
      traces: [
        {
          type:        'bar' as const,
          orientation: 'h' as const,
          name:        'Early',
          y:           labels,
          x:           stateStores.map(c => c.earlyR),
          marker:      { color: '#bfdbfe', opacity: 0.9 },
          hovertemplate: '<b>%{y}</b><br>Early period: ₹%{x:,.0f}<extra></extra>',
        },
        {
          type:        'bar' as const,
          orientation: 'h' as const,
          name:        'Recent',
          y:           labels,
          x:           stateStores.map(c => c.recentR),
          marker:      { color: recentColors, opacity: 0.92 },
          text:        growthLabels,
          textposition: 'outside' as const,
          textfont:    { size: 9, color: growthLabelColors },
          cliponaxis:  false,
          hovertemplate:
            '<b>%{y}</b><br>Recent period: ₹%{x:,.0f}'
            + '<br>Growth: %{text}<extra></extra>',
        },
      ],
    }
  }, [classifiedStores, compState, stateMetrics, filters.state])

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

  // ── Risk vs Opportunity: state scatter OR store drill-down ─────────────────
  const rvoData = useMemo(() => {
    if (filters.state && stateScopedStores.length > 0) {
      // Drill-down: individual stores within selected state
      const stores = stateScopedStores
      const maxRev = Math.max(...stores.map(c => c.rev), 1)
      const minRev = Math.min(...stores.map(c => c.rev), 0)
      const bSize  = (r: number) => 10 + ((r - minRev) / ((maxRev - minRev) || 1)) * 28

      return [{
        type:         'scatter' as const,
        mode:         'text+markers' as const,
        // x = decline exposure (0 when growing, magnitude of decline when falling)
        x:            stores.map(c => c.growthPct !== null ? Math.max(0, -c.growthPct) : 50),
        // y = growth opportunity (0 when declining, magnitude of growth when rising)
        y:            stores.map(c => c.growthPct !== null ? Math.max(0, c.growthPct) : 0),
        text:         stores.map(c => c.store.store_name ?? c.store.store_id),
        textposition: 'top center' as const,
        textfont:     { color: '#9ca3af', size: 8 },
        customdata:   stores.map(c => [c.category, c.rev, c.growthPct?.toFixed(1) ?? 'N/A']),
        marker: {
          size:       stores.map(c => bSize(c.rev)),
          color:      stores.map(c => HEALTH_BY_CAT[c.category] ?? 50),
          colorscale: COLORSCALE_HEALTH_PASTEL,
          cmin:       0,
          cmax:       100,
          opacity:    0.85,
          line:       { color: '#ffffff', width: 1.5 },
          colorbar: {
            thickness: 10,
            len:       0.75,
            tickfont:  { color: '#6b7280', size: 9 },
            title:     { text: 'Health', side: 'right' as const, font: { color: '#6b7280', size: 9 } },
          },
        },
        hovertemplate:
          '<b>%{text}</b><br>Category: %{customdata[0]}'
          + '<br>Growth: %{customdata[2]}%<br>Revenue: ₹%{customdata[1]:,.0f}<extra></extra>',
      }]
    }

    // Default: state-level scatter
    if (!stateMetrics.length) return []
    const maxRev = Math.max(...stateMetrics.map(m => m.totalRevV), 1)
    const minRev = Math.min(...stateMetrics.map(m => m.totalRevV), 0)
    const bSize  = (r: number) => 12 + ((r - minRev) / ((maxRev - minRev) || 1)) * 34

    return [{
      type:   'scatter' as const,
      mode:   'text+markers' as const,
      x:      stateMetrics.map(m => m.risk),
      y:      stateMetrics.map(m => m.opp),
      text:   stateMetrics.map(m => m.state),
      textposition: 'top center' as const,
      textfont: { color: '#9ca3af', size: 9 },
      customdata: stateMetrics.map(m => [
        m.health, m.totalRevV, m.total,
        m.growthPct?.toFixed(1) ?? 'N/A',
      ]),
      marker: {
        size:       stateMetrics.map(m => bSize(m.totalRevV)),
        color:      stateMetrics.map(m => m.health),
        colorscale: COLORSCALE_HEALTH_PASTEL,
        cmin:       0,
        cmax:       100,
        opacity:    0.85,
        line:       { color: '#ffffff', width: 1.5 },
        colorbar: {
          thickness: 10,
          len:       0.75,
          tickfont:  { color: '#6b7280', size: 9 },
          title:     { text: 'Health', side: 'right' as const, font: { color: '#6b7280', size: 9 } },
        },
      },
      hovertemplate:
        '<b>%{text}</b><br>Risk Index: %{x:.1f}<br>Rising Stars: %{y}<br>'
        + 'Health: %{customdata[0]:.1f}<br>Revenue: ₹%{customdata[1]:,.0f}'
        + '<br>Stores: %{customdata[2]}<br>Growth: %{customdata[3]}%<extra></extra>',
    }]
  }, [stateMetrics, stateScopedStores, filters.state])

  // ── Quadrant reference lines for the state-level scatter ──────────────────
  const rvoMeta = useMemo(() => {
    if (filters.state || !stateMetrics.length) return null
    const avgRisk = stateMetrics.reduce((s, m) => s + m.risk, 0) / stateMetrics.length
    const avgOpp  = stateMetrics.reduce((s, m) => s + m.opp,  0) / stateMetrics.length
    return { avgRisk, avgOpp }
  }, [stateMetrics, filters.state])

  // ── Sorted table rows ─────────────────────────────────────────────────────
  const tableRows = useMemo(() =>
    [...stateMetrics].sort((a, b) => {
      let d = 0
      switch (sortKey) {
        case 'state':   d = a.state.localeCompare(b.state); break
        case 'stores':  d = a.total     - b.total;          break
        case 'active':  d = a.active    - b.active;         break
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

        {/* Store Revenue by State */}
        <motion.div
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.18, duration: 0.4 }}
          className={card}
        >
          <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
            <div>
              <h3 className="text-sm font-semibold text-gray-800">Store Revenue by State</h3>
              <p className="text-[11px] text-gray-400 mt-0.5">
                All {storeCompData.count} stores in{' '}
                <span className="font-semibold text-blue-600">{storeCompData.stateName}</span>
                {' '}· bar colour = growth direction
              </p>
            </div>
            {filters.state ? (
              <div className="text-xs border border-blue-200 rounded-lg px-2.5 py-1.5 bg-blue-50 text-blue-700 shrink-0">
                {filters.state} (filtered)
              </div>
            ) : (
              <select
                value={storeCompData.stateName}
                onChange={e => setCompState(e.target.value)}
                className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white text-gray-700 cursor-pointer focus:outline-none focus:ring-1 focus:ring-blue-400 shrink-0"
              >
                {stateMetrics.map(m => (
                  <option key={m.state} value={m.state}>
                    {m.state} ({m.total} stores)
                  </option>
                ))}
              </select>
            )}
          </div>

          {storeCompData.traces.length > 0 ? (
            <div className="overflow-y-auto" style={{ maxHeight: 520 }}>
              <Plot
                data={storeCompData.traces}
                layout={{
                  ...PLOTLY_BASE,
                  barmode: 'group' as const,
                  legend: {
                    bgcolor: 'rgba(0,0,0,0)',
                    font:    { color: PT.font, size: 10 },
                    orientation: 'h' as const,
                    y: -0.06,
                  },
                  xaxis: {
                    gridcolor: PT.grid,
                    linecolor: PT.line,
                    tickcolor: PT.line,
                    automargin: true,
                    title:      { text: 'Revenue (₹)' },
                    tickformat: '.3s',
                    tickprefix: '₹',
                  },
                  yaxis: {
                    gridcolor:  PT.grid,
                    linecolor:  PT.line,
                    tickcolor:  PT.line,
                    automargin: true,
                    tickfont:   { size: 10 },
                  },
                  margin: { l: 160, r: 90, t: 8, b: 50 },
                  height: storeCompData.chartHeight,
                }}
                config={{ displayModeBar: false, responsive: true }}
                style={{ width: '100%' }}
              />
            </div>
          ) : (
            <div className="flex items-center justify-center h-48 text-gray-400 text-sm">
              No store data for selected state
            </div>
          )}
        </motion.div>
      </div>

      {/* ── Row 3: Treemap + Risk vs Opportunity ── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">

        {/* Store Distribution by State */}
        <motion.div
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.22, duration: 0.4 }}
          className={card}
        >
          <h3 className="text-sm font-semibold text-gray-800 mb-0.5">
            {filters.state ? `Store Distribution — ${filters.state}` : 'Store Distribution by State'}
          </h3>
          <p className="text-[11px] text-gray-400 mb-2">
            {filters.state
              ? `Tile size = revenue · colour = health · ${stateScopedStores.length} stores`
              : 'Tile size = store count · colour = health score (green healthy → red at-risk)'
            }
          </p>
          <Plot
            data={treemapData}
            layout={{
              ...PLOTLY_BASE,
              margin: { l: 0, r: 0, t: 0, b: 0 },
              height: 360,
            }}
            config={{ displayModeBar: false, responsive: true }}
            style={{ width: '100%' }}
          />
        </motion.div>

        {/* Risk vs Opportunity Scatter */}
        <motion.div
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.26, duration: 0.4 }}
          className={card}
        >
          <h3 className="text-sm font-semibold text-gray-800 mb-0.5">
            {filters.state ? `Risk vs Opportunity — ${filters.state} Stores` : 'Risk vs Opportunity'}
          </h3>
          <p className="text-[11px] text-gray-400 mb-2">
            {filters.state
              ? 'X = decline exposure · Y = growth opportunity · size = revenue · colour = health'
              : 'X = risk index · Y = opportunity (rising stars) · size = revenue · colour = health'
            }
          </p>
          <Plot
            data={rvoData}
            layout={{
              ...PLOTLY_BASE,
              showlegend: false,
              shapes: rvoMeta ? [
                {
                  type: 'line' as const, x0: rvoMeta.avgRisk, x1: rvoMeta.avgRisk,
                  y0: 0, y1: 1, yref: 'paper' as const,
                  line: { color: '#d1d5db', width: 1, dash: 'dot' },
                },
                {
                  type: 'line' as const, x0: 0, x1: 1, xref: 'paper' as const,
                  y0: rvoMeta.avgOpp, y1: rvoMeta.avgOpp,
                  line: { color: '#d1d5db', width: 1, dash: 'dot' },
                },
              ] : [],
              annotations: rvoMeta ? [
                {
                  text: 'Stars ✦', showarrow: false,
                  x: 0, xanchor: 'left' as const, xref: 'paper' as const,
                  y: rvoMeta.avgOpp * 1.25, yref: 'y' as const,
                  font: { color: '#10b981', size: 9 }, opacity: 0.7,
                },
                {
                  text: 'At Risk ⚠', showarrow: false,
                  x: 1, xanchor: 'right' as const, xref: 'paper' as const,
                  y: 0, yanchor: 'bottom' as const, yref: 'paper' as const,
                  font: { color: '#ef4444', size: 9 }, opacity: 0.7,
                },
              ] : [],
              xaxis: {
                gridcolor: PT.grid,
                linecolor: PT.line,
                tickcolor: PT.line,
                automargin: true,
                title: { text: filters.state ? 'Decline Exposure (%)' : 'Risk Index →' },
              },
              yaxis: {
                gridcolor: PT.grid,
                linecolor: PT.line,
                tickcolor: PT.line,
                automargin: true,
                title: { text: filters.state ? 'Growth Opportunity (%)' : 'Opportunity (Rising Stars)' },
              },
              hovermode: 'closest' as const,
              margin: { l: 60, r: 80, t: 16, b: 60 },
              height: 360,
            }}
            config={{ displayModeBar: false, responsive: true }}
            style={{ width: '100%' }}
          />
        </motion.div>
      </div>

      {/* ── State Ranking Table ── */}
      <motion.div
        initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.30, duration: 0.4 }}
        className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden"
      >
        <div className="px-4 py-3 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-800">
            State Ranking Table
            <span className="ml-2 text-[10px] font-normal text-gray-400 uppercase tracking-wider">
              — click a column to sort
            </span>
          </h3>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs whitespace-nowrap">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="px-3 py-2.5 text-left text-gray-400 w-8 sticky left-0 bg-gray-50">#</th>

                <th className="px-3 py-2.5 text-left sticky left-8 bg-gray-50 z-10 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)]">
                  <button onClick={() => toggleSort('state')} className="flex items-center gap-1 font-semibold uppercase tracking-wider text-gray-500 hover:text-gray-800 transition-colors">
                    State{sortIcon('state')}
                  </button>
                </th>

                {['Stores', 'Active', 'Inactive'].map(col => (
                  <th key={col} className="px-3 py-2.5 text-center">
                    <button
                      onClick={() => toggleSort(col.toLowerCase() as SortKey)}
                      className="flex items-center gap-1 font-semibold uppercase tracking-wider text-gray-500 hover:text-gray-800 transition-colors mx-auto"
                    >
                      {col}{sortIcon(col.toLowerCase() as SortKey)}
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

                <th className="px-3 py-2.5 text-right font-semibold uppercase tracking-wider text-gray-500">Net%</th>

                <th className="px-3 py-2.5 text-center font-semibold uppercase tracking-wider text-emerald-600">New</th>
                <th className="px-3 py-2.5 text-center font-semibold uppercase tracking-wider text-amber-600">Rising</th>
                <th className="px-3 py-2.5 text-center font-semibold uppercase tracking-wider text-blue-500">Growing</th>
                <th className="px-3 py-2.5 text-center font-semibold uppercase tracking-wider text-violet-500">Stable</th>
                <th className="px-3 py-2.5 text-center font-semibold uppercase tracking-wider text-orange-500">Decline</th>
                <th className="px-3 py-2.5 text-center font-semibold uppercase tracking-wider text-red-500">Fallen</th>
                <th className="px-3 py-2.5 text-center font-semibold uppercase tracking-wider text-gray-400">Inactive</th>

                <th className="px-3 py-2.5 text-right">
                  <button onClick={() => toggleSort('health')} className="flex items-center gap-1 font-semibold uppercase tracking-wider text-gray-500 hover:text-gray-800 transition-colors ml-auto">
                    Health{sortIcon('health')}
                  </button>
                </th>
                <th className="px-3 py-2.5 text-right">
                  <button onClick={() => toggleSort('risk')} className="flex items-center gap-1 font-semibold uppercase tracking-wider text-gray-500 hover:text-gray-800 transition-colors ml-auto">
                    Risk{sortIcon('risk')}
                  </button>
                </th>
                <th className="px-3 py-2.5 text-right">
                  <button onClick={() => toggleSort('opp')} className="flex items-center gap-1 font-semibold uppercase tracking-wider text-gray-500 hover:text-gray-800 transition-colors ml-auto">
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
                  <td className="px-3 py-2.5 text-center text-red-400 tabular-nums">{row.inactive}</td>

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
                  <td className="px-3 py-2.5 text-center text-gray-400 tabular-nums">{row.inactiveStore > 0 ? row.inactiveStore : <span className="text-gray-200">0</span>}</td>

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
        </div>
      </motion.div>

    </div>
  )
}
