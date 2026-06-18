import { useEffect, useMemo, useState } from 'react'
import {
  motion,
  useMotionValue,
  useTransform,
  animate,
} from 'framer-motion'
import { TrendingUp, TrendingDown, Users, Star, Moon, IndianRupee } from 'lucide-react'
// eslint-disable-next-line @typescript-eslint/no-require-imports
import createPlotlyComponent from 'react-plotly.js/factory'
// @ts-ignore — plotly.js-dist-min does not ship its own .d.ts
import Plotly from 'plotly.js-dist-min'
import { useDataContext } from '@/contexts/DataContext'
import type { FilterState } from '@/hooks/useFilters'
import type { StoreRecord } from '@/lib/api'
import { allocatePhases, type StoreCategory } from '@/lib/classificationEngine'
import { cn } from '@/lib/utils'
import { fmtInr, fmtPct, plotlyInrTickVals } from '@/lib/formatting'
import { kpiContainer, kpiItem, panelSpring } from '@/lib/animations'
import { PT } from '@/lib/plotlyTheme'

const Plot = createPlotlyComponent(Plotly)

// ── Types ─────────────────────────────────────────────────────────────────────

type EarlyTier      = 'Top Performer' | 'Mid-tier' | 'Low Tier'
type RecentCategory = 'Consistent Performer' | 'Fallen Star' | 'Average' | 'Consistently Low' | 'Rising Star'
type HealthStatus   = 'Healthy' | 'Recovering' | 'Declining' | 'Underperforming' | 'Dormant' | 'Stable'

// ── Color palette ─────────────────────────────────────────────────────────────

const HEALTH_COLORS: Record<HealthStatus, string> = {
  Healthy:         '#10b981',
  Recovering:      '#0ea5e9',
  Declining:       '#f59e0b',
  Underperforming: '#ef4444',
  Dormant:         '#94a3b8',
  Stable:          '#8b5cf6',
}

const EARLY_TIERS: EarlyTier[] = ['Top Performer', 'Mid-tier', 'Low Tier']

const EARLY_NODE_COLORS = ['#0ea5e9', '#8b5cf6', '#94a3b8']

// Target nodes for Sankey — keyed to the central classification engine categories
const SANKEY_TARGETS: StoreCategory[] = [
  'Rising Star', 'New Bloomer', 'Growing Store', 'Constant Store',
  'Declining Store', 'Fallen Star', 'Inactive Store',
]
// Colors aligned with categoryStyles.ts (hex equivalents of Tailwind classes)
const SANKEY_TARGET_COLORS: Record<StoreCategory, string> = {
  'Rising Star':    '#eab308',
  'New Bloomer':    '#059669',
  'Growing Store':  '#3b82f6',
  'Constant Store': '#8b5cf6',
  'Declining Store':'#f97316',
  'Fallen Star':    '#dc2626',
  'Inactive Store': '#9ca3af',
}

const SANKEY_LINK_COLORS = [
  'rgba(14,165,233,0.20)',
  'rgba(139,92,246,0.20)',
  'rgba(148,163,184,0.20)',
]

// nodeBorder re-uses the shared line token
const nodeBorder = PT.line

// ── Helpers ───────────────────────────────────────────────────────────────────

function winRev(store: StoreRecord, months: string[]): number {
  return months.reduce((s, m) => s + (store.monthly_sales[m] ?? 0), 0)
}

function pctileOf(rev: number, sorted: number[]): number {
  if (!sorted.length) return 0
  return (sorted.filter(r => r <= rev).length / sorted.length) * 100
}

function classifyEarlyTier(pct: number): EarlyTier {
  if (pct >= 67) return 'Top Performer'
  if (pct >= 33) return 'Mid-tier'
  return 'Low Tier'
}

function classifyRecentCategory(
  earlyTier: EarlyTier, recentPct: number, recentRev: number,
): RecentCategory {
  if (recentRev === 0) return 'Consistently Low'
  const band = recentPct >= 67 ? 'Top' : recentPct >= 33 ? 'Mid' : 'Low'
  if (earlyTier === 'Top Performer') {
    if (band === 'Top') return 'Consistent Performer'
    if (band === 'Low') return 'Fallen Star'
    return 'Average'
  }
  if (earlyTier === 'Low Tier') {
    if (band === 'Top') return 'Rising Star'
    if (band === 'Low') return 'Consistently Low'
    return 'Average'
  }
  if (band === 'Top') return 'Consistent Performer'
  if (band === 'Low') return 'Consistently Low'
  return 'Average'
}

function classifyHealth(ePct: number, rPct: number, rRev: number): HealthStatus {
  if (rRev === 0)           return 'Dormant'
  const diff = rPct - ePct
  if (rPct >= 67 && diff >= 0) return 'Healthy'
  if (diff >= 20)           return 'Recovering'
  if (diff <= -25)          return 'Declining'
  if (rPct < 20)            return 'Underperforming'
  return 'Stable'
}

// ── AnimatedNumber ────────────────────────────────────────────────────────────

function AnimatedNumber({ value, className }: { value: number; className?: string }) {
  const mv      = useMotionValue(0)
  const display = useTransform(mv, (v: number) => Math.round(v).toLocaleString())

  useEffect(() => {
    const ctrl = animate(mv, value, { duration: 1.1, ease: [0.22, 1, 0.36, 1] })
    return () => ctrl.stop()
  }, [mv, value])

  return <motion.span className={className}>{display}</motion.span>
}

// ── MiniBar ───────────────────────────────────────────────────────────────────

function MiniBar({ ratio, color }: { ratio: number; color: string }) {
  return (
    <div className="h-[3px] w-full rounded-full bg-gray-100 overflow-hidden mt-1.5">
      <motion.div
        className="h-full rounded-full"
        style={{ backgroundColor: color }}
        initial={{ scaleX: 0, originX: 0 }}
        animate={{ scaleX: Math.min(Math.max(ratio, 0), 1) }}
        transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1], delay: 0.25 }}
      />
    </div>
  )
}

// ── KPI Card ──────────────────────────────────────────────────────────────────

interface KPICardProps {
  label:          string
  value:          number
  sub:            string
  icon:           React.ReactNode
  barRatio?:      number
  barColor?:      string
  danger?:        boolean
  formattedValue?: string
}

function KPICard({ label, value, sub, icon, barRatio, barColor, danger, formattedValue }: KPICardProps) {
  return (
    <motion.div
      variants={kpiItem}
      whileHover={{
        scale: 1.035, y: -4,
        transition: { type: 'spring', stiffness: 420, damping: 26 },
      }}
      whileTap={{ scale: 0.97, transition: { duration: 0.1 } }}
      className={cn(
        'rounded-xl border bg-white p-4 flex flex-col gap-0.5 min-w-0 cursor-default',
        'shadow-sm hover:shadow-md transition-shadow duration-200',
        danger ? 'border-red-200' : 'border-gray-200',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-medium uppercase tracking-widest text-gray-500 truncate">
          {label}
        </p>
        <motion.span
          className={cn('shrink-0', danger ? 'text-red-400' : 'text-gray-400')}
          animate={danger ? { rotate: [0, -8, 8, -4, 0] } : {}}
          transition={{ duration: 0.5, delay: 0.6 }}
        >
          {icon}
        </motion.span>
      </div>

      {formattedValue !== undefined ? (
        <motion.span
          key={formattedValue}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
          className={cn(
            'text-2xl font-bold tabular-nums block',
            danger ? 'text-red-600' : 'text-gray-900',
          )}
        >
          {formattedValue}
        </motion.span>
      ) : (
        <AnimatedNumber
          value={value}
          className={cn(
            'text-2xl font-bold tabular-nums block',
            danger ? 'text-red-600' : 'text-gray-900',
          )}
        />
      )}

      <p className="text-[11px] text-gray-500 truncate">{sub}</p>

      {barRatio !== undefined && barColor && (
        <MiniBar ratio={barRatio} color={barColor} />
      )}
    </motion.div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

interface Props { filters: FilterState }

export default function ExecutiveOverview({ filters }: Props) {
  const { stores, months, classification } = useDataContext()

  // ── Filter + split ─────────────────────────────────────────────────────────
  const { fs, fm, early, mid, recent } = useMemo(() => {
    let fs = stores
    if (filters.state)    fs = fs.filter(s => s.state    === filters.state)
    if (filters.category) fs = fs.filter(s => s.category === filters.category)
    let fm = months
    if (filters.fromMonth) {
      const i = months.indexOf(filters.fromMonth); if (i >= 0) fm = fm.slice(i)
    }
    if (filters.toMonth) {
      const i = months.indexOf(filters.toMonth); if (i >= 0) fm = fm.slice(0, i + 1)
    }
    const { earlyMonths: early, midMonths: mid, recentMonths: recent } = allocatePhases(fm)
    return { fs, fm, early, mid, recent }
  }, [stores, months, filters])

  // ── Journey data ───────────────────────────────────────────────────────────
  const journeys = useMemo(() => {
    if (!fs.length || !early.length || !recent.length) return []
    const eSorted = fs.map(s => winRev(s, early)).sort((a, b) => a - b)
    const rSorted = fs.map(s => winRev(s, recent)).sort((a, b) => a - b)
    return fs.map(store => {
      const eRev = winRev(store, early)
      const rRev = winRev(store, recent)
      const ePct = pctileOf(eRev, eSorted)
      const rPct = pctileOf(rRev, rSorted)
      const earlyTier      = classifyEarlyTier(ePct)
      const recentCategory = classifyRecentCategory(earlyTier, rPct, rRev)
      const health         = classifyHealth(ePct, rPct, rRev)
      return { store, eRev, rRev, ePct, rPct, earlyTier, recentCategory, health }
    })
  }, [fs, early, recent])

  // ── KPIs ───────────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    // Always show the state/category filtered store count, regardless of whether
    // the date window is wide enough for phase analysis. This keeps "Stores in Scope"
    // consistent with the count shown on every other dashboard page.
    const scope    = fs.length
    const improved = journeys.filter(j => j.rPct > j.ePct).length
    const declined = journeys.filter(j => j.rPct <= j.ePct).length
    const dormant  = journeys.filter(j => j.rRev === 0).length

    // Use the central classification engine so counts match the detail pages
    let engineScope = classification.metrics
    if (filters.state)    engineScope = engineScope.filter(m => m.store.state    === filters.state)
    if (filters.category) engineScope = engineScope.filter(m => m.store.category === filters.category)
    const rising = engineScope.filter(m => m.category === 'Rising Star').length
    const fallen = engineScope.filter(m => m.category === 'Fallen Star').length

    return { scope, improved, declined, rising, fallen, dormant }
  }, [fs, journeys, classification, filters])

  // ── Sankey (uses the same engineScope as the KPI cards) ────────────────────
  const sankeyTrace = useMemo(() => {
    // Mirror the exact filter the KPI cards apply so counts stay in sync
    let engineScope = classification.metrics
    if (filters.state)    engineScope = engineScope.filter(m => m.store.state    === filters.state)
    if (filters.category) engineScope = engineScope.filter(m => m.store.category === filters.category)

    if (!engineScope.length) return null

    // Early tier derived from earlyTotal percentile within filtered scope
    const sortedEarlyTotals = engineScope.map(m => m.earlyTotal).sort((a, b) => a - b)
    const earlyTierOf = (earlyTotal: number): EarlyTier => {
      const pct = sortedEarlyTotals.filter(t => t <= earlyTotal).length / sortedEarlyTotals.length * 100
      if (pct >= 67) return 'Top Performer'
      if (pct >= 33) return 'Mid-tier'
      return 'Low Tier'
    }

    const labels = [...EARLY_TIERS, ...SANKEY_TARGETS]
    const colors = [...EARLY_NODE_COLORS, ...SANKEY_TARGETS.map(c => SANKEY_TARGET_COLORS[c])]

    const flowMap: Record<string, number> = {}
    for (const m of engineScope) {
      const src = EARLY_TIERS.indexOf(earlyTierOf(m.earlyTotal))
      const tgt = EARLY_TIERS.length + SANKEY_TARGETS.indexOf(m.category)
      const key = `${src}_${tgt}`
      flowMap[key] = (flowMap[key] ?? 0) + 1
    }

    const sources: number[] = [], targets: number[] = []
    const values: number[]  = [], linkColors: string[] = []
    for (const [k, v] of Object.entries(flowMap)) {
      const [s, t] = k.split('_').map(Number)
      sources.push(s); targets.push(t); values.push(v)
      linkColors.push(SANKEY_LINK_COLORS[s % SANKEY_LINK_COLORS.length])
    }

    // ── Debug validation ──────────────────────────────────────────────────────
    const totalInScope  = engineScope.length
    const sankeyTotal   = values.reduce((s, v) => s + v, 0)
    const fallenTotal   = engineScope.filter(m => m.category === 'Fallen Star').length
    const risingTotal   = engineScope.filter(m => m.category === 'Rising Star').length
    const missingStores = totalInScope - sankeyTotal

    console.group('[Sankey Debug]')
    console.log('Stores in Scope      :', totalInScope)
    console.log('Sankey Source Total  :', sankeyTotal)
    console.log('Sankey Target Total  :', sankeyTotal)
    console.log('Fallen Star Total    :', fallenTotal)
    console.log('Rising Star Total    :', risingTotal)
    console.log('Missing Stores       :', missingStores)
    console.groupEnd()

    return { labels, colors, sources, targets, values, linkColors }
  }, [classification, filters])

  // ── Donut ──────────────────────────────────────────────────────────────────
  const donutCounts = useMemo(() => {
    const c: Record<HealthStatus, number> = {
      Healthy: 0, Recovering: 0, Declining: 0, Underperforming: 0, Dormant: 0, Stable: 0,
    }
    for (const j of journeys) c[j.health]++
    return c
  }, [journeys])

  // ── Bar data ───────────────────────────────────────────────────────────────
  const barEarly = useMemo(() =>
    early.map(m => ({ m, rev: fs.reduce((s, st) => s + (st.monthly_sales[m] ?? 0), 0) })),
  [fs, early])

  const barMid = useMemo(() =>
    mid.map(m => ({ m, rev: fs.reduce((s, st) => s + (st.monthly_sales[m] ?? 0), 0) })),
  [fs, mid])

  const barRecent = useMemo(() =>
    recent.map(m => ({ m, rev: fs.reduce((s, st) => s + (st.monthly_sales[m] ?? 0), 0) })),
  [fs, recent])

  const totalEarly  = barEarly.reduce((s, d)  => s + d.rev, 0)
  const totalMid    = barMid.reduce((s, d)    => s + d.rev, 0)
  const totalRecent = barRecent.reduce((s, d) => s + d.rev, 0)
  const phaseShift  = totalEarly > 0 ? (totalRecent - totalEarly) / totalEarly * 100 : null

  const earlyLabel  = early.length   ? `${early[0]} – ${early[early.length - 1]}`     : ''
  const midLabel    = mid.length     ? `${mid[0]} – ${mid[mid.length - 1]}`            : ''
  const recentLabel = recent.length  ? `${recent[0]} – ${recent[recent.length - 1]}`  : ''

  // ── Revenue Context Narrative ───────────────────────────────────────────────
  const phaseNarrative = useMemo(() => {
    const totalAll = totalEarly + totalMid + totalRecent
    if (totalAll === 0 || fs.length === 0) return null

    const earlyShare  = totalAll > 0 ? (totalEarly / totalAll * 100) : 0
    const midShare    = totalAll > 0 ? (totalMid   / totalAll * 100) : 0
    const recentShare = totalAll > 0 ? (totalRecent / totalAll * 100) : 0

    const earlyMonthAvg  = early.length  ? totalEarly  / early.length  : 0
    const midMonthAvg    = mid.length    ? totalMid    / mid.length    : 0
    const recentMonthAvg = recent.length ? totalRecent / recent.length : 0

    // How many stores contributed revenue in each phase
    const earlyActive  = fs.filter(s => early.some(m => (s.monthly_sales[m] ?? 0) > 0)).length
    const midActive    = fs.filter(s => mid.some(m => (s.monthly_sales[m] ?? 0) > 0)).length
    const recentActive = fs.filter(s => recent.some(m => (s.monthly_sales[m] ?? 0) > 0)).length

    // Month-over-month momentum within early phase
    const earlyMomArr = barEarly.map((d, i) => i === 0 ? null : earlyMonthAvg === 0 ? null : (d.rev - barEarly[i-1].rev) / Math.max(barEarly[i-1].rev, 1) * 100)
    const earlyMomAvg = earlyMomArr.filter((v): v is number => v !== null).reduce((s, v) => s + v, 0) / Math.max(earlyMomArr.filter(v => v !== null).length, 1)

    const recentMomArr = barRecent.map((d, i) => i === 0 ? null : (d.rev - barRecent[i-1].rev) / Math.max(barRecent[i-1].rev, 1) * 100)
    const recentMomAvg = recentMomArr.filter((v): v is number => v !== null).reduce((s, v) => s + v, 0) / Math.max(recentMomArr.filter(v => v !== null).length, 1)

    const earlyPeak  = barEarly.length  ? Math.max(...barEarly.map(d => d.rev))  : 0
    const recentPeak = barRecent.length ? Math.max(...barRecent.map(d => d.rev)) : 0

    const earlyLow   = barEarly.filter(d => d.rev > 0).length ? Math.min(...barEarly.filter(d => d.rev > 0).map(d => d.rev))  : 0
    const recentLow  = barRecent.filter(d => d.rev > 0).length ? Math.min(...barRecent.filter(d => d.rev > 0).map(d => d.rev)) : 0

    const networkGrowthPct = phaseShift

    // Mid vs early
    const midGrowth    = earlyMonthAvg > 0 ? (midMonthAvg    - earlyMonthAvg) / earlyMonthAvg * 100 : null
    const recentGrowth = earlyMonthAvg > 0 ? (recentMonthAvg - earlyMonthAvg) / earlyMonthAvg * 100 : null

    return { earlyShare, midShare, recentShare, earlyMonthAvg, midMonthAvg, recentMonthAvg, earlyActive, midActive, recentActive, earlyMomAvg, recentMomAvg, earlyPeak, recentPeak, earlyLow, recentLow, networkGrowthPct, midGrowth, recentGrowth, totalAll }
  }, [barEarly, barMid, barRecent, totalEarly, totalMid, totalRecent, fs, early, mid, recent, phaseShift])

  const n       = kpis.scope || 1
  const cardCls = 'rounded-xl border border-gray-200 bg-white p-4 shadow-sm'
  const emptyMsg = 'flex items-center justify-center h-64 text-gray-400 text-sm'

  return (
    <div className="space-y-5">

      {/* ── Header ── */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="pb-1 border-b border-gray-100"
      >
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">Business Snapshot</span>
        </div>
        <h2 className="text-xl font-bold text-gray-900">What is happening across the network?</h2>
        <p className="text-sm text-gray-500 mt-0.5 max-w-2xl leading-relaxed">
          Store trajectory from early phase{earlyLabel ? ` (${earlyLabel})` : ''} to recent phase{recentLabel ? ` (${recentLabel})` : ''}.
          Revenue trend provides financial context; the Sankey shows how stores moved in performance tier.
        </p>
      </motion.div>

      {/* ── KPI Row — staggered spring entrance ── */}
      <motion.div
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-7"
        variants={kpiContainer}
        initial="hidden"
        animate="show"
      >
        <KPICard
          label="Total Revenue"
          value={totalEarly + totalMid + totalRecent}
          formattedValue={fmtInr(totalEarly + totalMid + totalRecent)}
          sub="Revenue in current scope"
          icon={<IndianRupee className="h-4 w-4 text-emerald-500" />}
        />
        <KPICard
          label="Stores in Scope" value={kpis.scope}
          sub={`of ${stores.length} tracked`}
          icon={<Users className="h-4 w-4" />}
          barRatio={kpis.scope / (stores.length || 1)} barColor="#6b7280"
        />
        <KPICard
          label="Improved Rank" value={kpis.improved}
          sub="Climbed in percentile"
          icon={<TrendingUp className="h-4 w-4 text-emerald-500" />}
          barRatio={kpis.improved / n} barColor="#10b981"
        />
        <KPICard
          label="Declined Rank" value={kpis.declined}
          sub="Slipped in percentile"
          icon={<TrendingDown className="h-4 w-4" />}
          barRatio={kpis.declined / n} barColor="#ef4444"
          danger
        />
        <KPICard
          label="Rising Stars" value={kpis.rising}
          sub="Bottom→top movers"
          icon={<Star className="h-4 w-4 text-amber-500" />}
          barRatio={kpis.rising / n} barColor="#f59e0b"
        />
        <KPICard
          label="Fallen Stars" value={kpis.fallen}
          sub="Top→bottom movers"
          icon={<Star className="h-4 w-4" />}
          barRatio={kpis.fallen / n} barColor="#ef4444"
          danger
        />
        <KPICard
          label="Dormant Now" value={kpis.dormant}
          sub="Zero recent revenue"
          icon={<Moon className="h-4 w-4 text-slate-400" />}
          barRatio={kpis.dormant / n} barColor="#94a3b8"
        />
      </motion.div>

      {/* ── Sankey + Donut ── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">

        {/* Store Journey Flow */}
        <motion.div {...panelSpring(0.12)} className={cn(cardCls, 'lg:col-span-3')}>
          <h3 className="text-sm font-semibold text-gray-800">Store Journey Flow</h3>
          <p className="text-[11px] text-gray-500 mt-0.5 mb-3">
            How early-phase tiers flowed into recent performance categories
          </p>
          {sankeyTrace ? (
            <Plot
              data={[{
                type: 'sankey' as const,
                orientation: 'h' as const,
                node: {
                  pad: 20,
                  thickness: 24,
                  line: { color: nodeBorder, width: 0.5 },
                  label: sankeyTrace.labels,
                  color: sankeyTrace.colors,
                },
                link: {
                  source:     sankeyTrace.sources,
                  target:     sankeyTrace.targets,
                  value:      sankeyTrace.values,
                  color:      sankeyTrace.linkColors,
                },
              }]}
              layout={{
                paper_bgcolor: 'rgba(0,0,0,0)',
                plot_bgcolor:  'rgba(0,0,0,0)',
                font:  { color: PT.font, family: 'Inter, sans-serif', size: 11 },
                margin: { l: 8, r: 8, t: 8, b: 8 },
                height: 300,
                uirevision: 'constant',
              }}
              config={{ displayModeBar: false, responsive: true }}
              style={{ width: '100%' }}
            />
          ) : (
            <div className={emptyMsg}>No data for selected filters</div>
          )}
        </motion.div>

        {/* Store Movement Summary */}
        <motion.div {...panelSpring(0.2)} className={cn(cardCls, 'lg:col-span-2')}>
          <h3 className="text-sm font-semibold text-gray-800">Store Movement Summary</h3>
          <p className="text-[11px] text-gray-500 mt-0.5 mb-3">
            Performance & status distribution of in-scope stores
          </p>
          {journeys.length > 0 ? (
            <Plot
              data={[{
                type: 'pie' as const,
                hole: 0.55,
                labels: Object.keys(donutCounts),
                values: Object.values(donutCounts),
                marker: {
                  colors: (Object.keys(donutCounts) as HealthStatus[]).map(k => HEALTH_COLORS[k]),
                  line: { color: '#ffffff', width: 2 },
                },
                textinfo:      'percent' as const,
                textfont:      { size: 10, color: '#ffffff' },
                hovertemplate: '<b>%{label}</b><br>%{value} stores · %{percent}<extra></extra>',
                sort: false,
              }]}
              layout={{
                paper_bgcolor: 'rgba(0,0,0,0)',
                plot_bgcolor:  'rgba(0,0,0,0)',
                font:  { color: PT.font, family: 'Inter, sans-serif', size: 10 },
                showlegend: true,
                legend: {
                  bgcolor: 'rgba(0,0,0,0)',
                  font: { size: 10, color: PT.font },
                  orientation: 'h' as const,
                  x: 0, y: -0.1,
                },
                margin: { l: 10, r: 10, t: 10, b: 80 },
                height: 300,
                uirevision: 'constant',
              }}
              config={{ displayModeBar: false, responsive: true }}
              style={{ width: '100%' }}
            />
          ) : (
            <div className={emptyMsg}>No data for selected filters</div>
          )}
        </motion.div>
      </div>

      {/* ── Revenue bar chart ── */}
      <motion.div {...panelSpring(0.28)} className={cardCls}>
        <div className="flex items-start justify-between gap-2 flex-wrap mb-1">
          <div>
            <h3 className="text-sm font-semibold text-gray-800">Revenue Context — Network Trend</h3>
            <p className="text-[11px] text-gray-500 mt-0.5">
              Monthly gross revenue · early / mid / recent phases
              {totalEarly + totalMid + totalRecent > 0
                ? ` · ${fmtInr(totalEarly + totalMid + totalRecent)} total`
                : ''}
            </p>
          </div>
          {phaseShift !== null && (
            <motion.span
              key={Math.round(phaseShift)}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: 'spring', stiffness: 400, damping: 28 }}
              className={cn(
                'text-xs font-semibold px-2.5 py-1 rounded-full border',
                phaseShift >= 0
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : 'bg-red-50 text-red-700 border-red-200',
              )}
            >
              {fmtPct(phaseShift)} phase shift
            </motion.span>
          )}
        </div>

        {(barEarly.length + barMid.length + barRecent.length) === 0 ? (
          <div className="flex items-center justify-center h-48 text-gray-400 text-sm">
            No data for selected filters
          </div>
        ) : (
          <Plot
            data={[
              {
                type: 'bar' as const,
                name: 'Early Phase',
                x: barEarly.map(d => d.m),
                y: barEarly.map(d => d.rev),
                marker: { color: '#94a3b8' },
                hovertemplate: '<b>%{x}</b><br>₹%{y:,.0f}<extra>Early Phase</extra>',
              },
              ...(barMid.length > 0 ? [{
                type: 'bar' as const,
                name: 'Mid Phase',
                x: barMid.map(d => d.m),
                y: barMid.map(d => d.rev),
                marker: { color: '#8b5cf6' },
                hovertemplate: '<b>%{x}</b><br>₹%{y:,.0f}<extra>Mid Phase</extra>',
              }] : []),
              {
                type: 'bar' as const,
                name: 'Recent Phase',
                x: barRecent.map(d => d.m),
                y: barRecent.map(d => d.rev),
                marker: { color: '#3b82f6' },
                hovertemplate: '<b>%{x}</b><br>₹%{y:,.0f}<extra>Recent Phase</extra>',
              },
            ]}
            layout={{
              paper_bgcolor: 'rgba(0,0,0,0)',
              plot_bgcolor:  'rgba(0,0,0,0)',
              font:   { color: PT.font, family: 'Inter, sans-serif', size: 11 },
              xaxis:  { gridcolor: PT.grid, linecolor: PT.line, tickcolor: PT.line, automargin: true },
              yaxis:  {
                gridcolor: PT.grid, linecolor: PT.line, tickcolor: PT.line,
                automargin: true,
                title: { text: 'Revenue (₹)' },
                ...plotlyInrTickVals(Math.max(0, ...barEarly.map(d=>d.rev), ...barMid.map(d=>d.rev), ...barRecent.map(d=>d.rev))),
              },
              legend: {
                bgcolor: 'rgba(0,0,0,0)',
                font: { color: PT.font, size: 10 },
                orientation: 'h' as const,
                x: 0, y: 1.08,
              },
              margin:     { l: 70, r: 16, t: 36, b: 70 },
              height:     260,
              bargap:     0.25,
              uirevision: 'constant',
            }}
            config={{ displayModeBar: false, responsive: true }}
            style={{ width: '100%' }}
          />
        )}
      </motion.div>

      {/* ── Revenue Context Narrative ── */}
      {phaseNarrative && (totalEarly + totalMid + totalRecent) > 0 && (
        <motion.div {...panelSpring(0.36)} className={cardCls}>
          <h3 className="text-sm font-semibold text-gray-800 mb-1">Revenue Context — Executive Narrative</h3>
          <p className="text-[11px] text-gray-500 mb-4">
            Phase-by-phase business interpretation of network revenue performance · Early → Mid → Recent
          </p>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">

            {/* Early Phase */}
            {barEarly.length > 0 && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="inline-block h-2.5 w-2.5 rounded-full bg-slate-400 shrink-0" />
                  <p className="text-xs font-bold text-slate-700 uppercase tracking-wider">Early Phase</p>
                </div>
                {earlyLabel && <p className="text-[10px] text-slate-500 font-mono">{earlyLabel}</p>}

                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-white border border-slate-100 px-2.5 py-2">
                    <p className="text-[9px] text-slate-400 uppercase tracking-wider">Revenue</p>
                    <p className="text-sm font-bold text-slate-800">{fmtInr(totalEarly)}</p>
                  </div>
                  <div className="rounded-lg bg-white border border-slate-100 px-2.5 py-2">
                    <p className="text-[9px] text-slate-400 uppercase tracking-wider">Network Share</p>
                    <p className="text-sm font-bold text-slate-800">{phaseNarrative.earlyShare.toFixed(1)}%</p>
                  </div>
                  <div className="rounded-lg bg-white border border-slate-100 px-2.5 py-2">
                    <p className="text-[9px] text-slate-400 uppercase tracking-wider">Active Stores</p>
                    <p className="text-sm font-bold text-slate-800">{phaseNarrative.earlyActive} / {fs.length}</p>
                  </div>
                  <div className="rounded-lg bg-white border border-slate-100 px-2.5 py-2">
                    <p className="text-[9px] text-slate-400 uppercase tracking-wider">Avg / Month</p>
                    <p className="text-sm font-bold text-slate-800">{fmtInr(phaseNarrative.earlyMonthAvg)}</p>
                  </div>
                </div>

                <div className="space-y-2 text-[11px] text-slate-600 leading-relaxed">
                  <p><span className="font-semibold text-slate-700">Performance:</span>{' '}
                    {phaseNarrative.earlyMomAvg > 5
                      ? 'The early phase showed accelerating momentum with positive month-on-month growth across most months.'
                      : phaseNarrative.earlyMomAvg > 0
                        ? 'The early phase maintained modest but consistent growth, establishing a stable revenue baseline.'
                        : 'The early phase reflected a contracting trend with revenue declining month-on-month in most periods.'}
                  </p>
                  <p><span className="font-semibold text-slate-700">Store Contribution:</span>{' '}
                    {phaseNarrative.earlyActive === fs.length
                      ? 'All stores in scope contributed revenue — full network activation in this phase.'
                      : `${phaseNarrative.earlyActive} of ${fs.length} stores were active, suggesting ${fs.length - phaseNarrative.earlyActive} store${fs.length - phaseNarrative.earlyActive > 1 ? 's were' : ' was'} yet to ramp up.`}
                  </p>
                  <p><span className="font-semibold text-slate-700">Key Drivers:</span>{' '}
                    Revenue range spanned {fmtInr(phaseNarrative.earlyLow)}–{fmtInr(phaseNarrative.earlyPeak)} across early months.
                    {phaseNarrative.earlyPeak > phaseNarrative.earlyMonthAvg * 1.3
                      ? ' Significant month spikes indicate event-driven or seasonal peaks in this window.'
                      : ' Revenue was broadly stable without sharp seasonal distortion.'}
                  </p>
                  <p><span className="font-semibold text-slate-700">Risk:</span>{' '}
                    {phaseNarrative.earlyShare > 40
                      ? 'A high early-phase revenue share relative to other phases may indicate the network is past its peak growth window.'
                      : phaseNarrative.earlyShare < 25
                        ? 'Lower early share suggests the network was still ramping — subsequent phases carry more weight in evaluation.'
                        : 'Early share is balanced, indicating a normal ramp across the dataset period.'}
                  </p>
                </div>
              </div>
            )}

            {/* Mid Phase */}
            {barMid.length > 0 && (
              <div className="rounded-xl border border-violet-200 bg-violet-50 p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="inline-block h-2.5 w-2.5 rounded-full bg-violet-400 shrink-0" />
                  <p className="text-xs font-bold text-violet-700 uppercase tracking-wider">Mid Phase</p>
                </div>
                {midLabel && <p className="text-[10px] text-violet-500 font-mono">{midLabel}</p>}

                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-white border border-violet-100 px-2.5 py-2">
                    <p className="text-[9px] text-violet-400 uppercase tracking-wider">Revenue</p>
                    <p className="text-sm font-bold text-violet-800">{fmtInr(totalMid)}</p>
                  </div>
                  <div className="rounded-lg bg-white border border-violet-100 px-2.5 py-2">
                    <p className="text-[9px] text-violet-400 uppercase tracking-wider">Network Share</p>
                    <p className="text-sm font-bold text-violet-800">{phaseNarrative.midShare.toFixed(1)}%</p>
                  </div>
                  <div className="rounded-lg bg-white border border-violet-100 px-2.5 py-2">
                    <p className="text-[9px] text-violet-400 uppercase tracking-wider">Active Stores</p>
                    <p className="text-sm font-bold text-violet-800">{phaseNarrative.midActive} / {fs.length}</p>
                  </div>
                  <div className="rounded-lg bg-white border border-violet-100 px-2.5 py-2">
                    <p className="text-[9px] text-violet-400 uppercase tracking-wider">Avg / Month</p>
                    <p className="text-sm font-bold text-violet-800">{fmtInr(phaseNarrative.midMonthAvg)}</p>
                  </div>
                </div>

                <div className="space-y-2 text-[11px] text-violet-700 leading-relaxed">
                  <p><span className="font-semibold text-violet-800">vs Early Phase:</span>{' '}
                    {phaseNarrative.midGrowth === null ? 'No early phase data for comparison.' :
                     phaseNarrative.midGrowth > 10
                       ? `Mid-phase average monthly revenue grew ${fmtPct(phaseNarrative.midGrowth)} over early phase — a strong acceleration signal.`
                       : phaseNarrative.midGrowth > 0
                         ? `Mid-phase saw modest improvement of ${fmtPct(phaseNarrative.midGrowth)} over early — steady but not accelerating.`
                         : `Mid-phase contracted by ${fmtPct(Math.abs(phaseNarrative.midGrowth))} vs early — the network faced headwinds during this window.`}
                  </p>
                  <p><span className="font-semibold text-violet-800">Network Engagement:</span>{' '}
                    {phaseNarrative.midActive > phaseNarrative.earlyActive
                      ? `Mid phase brought ${phaseNarrative.midActive - phaseNarrative.earlyActive} additional store${phaseNarrative.midActive - phaseNarrative.earlyActive > 1 ? 's' : ''} online compared to the early window — network expansion in progress.`
                      : phaseNarrative.midActive === phaseNarrative.earlyActive
                        ? 'Same number of stores active as early phase — stable network coverage.'
                        : `${phaseNarrative.earlyActive - phaseNarrative.midActive} fewer stores active than early phase — some stores may have gone dormant mid-period.`}
                  </p>
                  <p><span className="font-semibold text-violet-800">Observation:</span>{' '}
                    Mid-phase revenue share of {phaseNarrative.midShare.toFixed(1)}% of the full-period total
                    {phaseNarrative.midShare > phaseNarrative.earlyShare && phaseNarrative.midShare > phaseNarrative.recentShare
                      ? ' represents the peak phase — the network performed best in this window.'
                      : phaseNarrative.midShare > phaseNarrative.earlyShare
                        ? ' shows improvement from early phase, though recent phase has overtaken it.'
                        : ' reflects a transitional period — performance will be judged by whether the recent phase recovers or further contracts.'}
                  </p>
                </div>
              </div>
            )}

            {/* Recent Phase */}
            {barRecent.length > 0 && (
              <div className={`rounded-xl border p-4 space-y-3 ${
                phaseNarrative.recentGrowth !== null && phaseNarrative.recentGrowth >= 0
                  ? 'border-blue-200 bg-blue-50'
                  : 'border-orange-200 bg-orange-50'
              }`}>
                <div className="flex items-center gap-2">
                  <span className={`inline-block h-2.5 w-2.5 rounded-full shrink-0 ${
                    phaseNarrative.recentGrowth !== null && phaseNarrative.recentGrowth >= 0
                      ? 'bg-blue-500'
                      : 'bg-orange-400'
                  }`} />
                  <p className={`text-xs font-bold uppercase tracking-wider ${
                    phaseNarrative.recentGrowth !== null && phaseNarrative.recentGrowth >= 0
                      ? 'text-blue-700'
                      : 'text-orange-700'
                  }`}>Recent Phase</p>
                </div>
                {recentLabel && <p className={`text-[10px] font-mono ${
                  phaseNarrative.recentGrowth !== null && phaseNarrative.recentGrowth >= 0
                    ? 'text-blue-500'
                    : 'text-orange-500'
                }`}>{recentLabel}</p>}

                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: 'Revenue', val: fmtInr(totalRecent) },
                    { label: 'Network Share', val: `${phaseNarrative.recentShare.toFixed(1)}%` },
                    { label: 'Active Stores', val: `${phaseNarrative.recentActive} / ${fs.length}` },
                    { label: 'Avg / Month', val: fmtInr(phaseNarrative.recentMonthAvg) },
                  ].map(({ label, val }) => (
                    <div key={label} className="rounded-lg bg-white border border-white/70 px-2.5 py-2">
                      <p className="text-[9px] text-gray-400 uppercase tracking-wider">{label}</p>
                      <p className="text-sm font-bold text-gray-800">{val}</p>
                    </div>
                  ))}
                </div>

                <div className="space-y-2 text-[11px] leading-relaxed text-gray-700">
                  <p><span className="font-semibold text-gray-800">vs Early Phase:</span>{' '}
                    {phaseNarrative.recentGrowth === null
                      ? 'Insufficient data for cross-phase comparison.'
                      : phaseNarrative.recentGrowth > 20
                        ? `Exceptional trajectory — recent average monthly revenue is ${fmtPct(phaseNarrative.recentGrowth)} higher than early phase. Management should identify and replicate these drivers.`
                        : phaseNarrative.recentGrowth > 5
                          ? `Positive momentum — recent phase average is ${fmtPct(phaseNarrative.recentGrowth)} ahead of early baseline, indicating healthy network progression.`
                          : phaseNarrative.recentGrowth > -5
                            ? 'Revenue is broadly flat versus the early phase. Growth has stalled — further diagnosis needed to distinguish structural ceiling from temporary slowdown.'
                            : `Concerning reversal — recent phase is ${fmtPct(Math.abs(phaseNarrative.recentGrowth))} below early baseline. Immediate review of underperforming stores is recommended.`}
                  </p>
                  <p><span className="font-semibold text-gray-800">MoM Trend:</span>{' '}
                    {phaseNarrative.recentMomAvg > 3
                      ? `Within the recent phase, month-on-month growth averaged ${phaseNarrative.recentMomAvg.toFixed(1)}% — an accelerating close to the period.`
                      : phaseNarrative.recentMomAvg > -3
                        ? 'Month-on-month variation within recent phase was minimal — the network is in a holding pattern.'
                        : `Recent phase showed a declining month-on-month trajectory averaging ${phaseNarrative.recentMomAvg.toFixed(1)}% — momentum is fading and proactive intervention is advisable.`}
                  </p>
                  <p><span className="font-semibold text-gray-800">Store Health Signal:</span>{' '}
                    {phaseNarrative.recentActive === fs.length
                      ? `All ${fs.length} stores are active in recent phase — full network engagement, a positive indicator.`
                      : phaseNarrative.recentActive >= phaseNarrative.earlyActive
                        ? `${phaseNarrative.recentActive} stores active in recent phase — same or better coverage than early period.`
                        : `${fs.length - phaseNarrative.recentActive} store${fs.length - phaseNarrative.recentActive > 1 ? 's have' : ' has'} gone dormant since the early phase — review store viability and re-engagement strategies.`}
                  </p>
                  <p><span className="font-semibold text-gray-800">Peak vs Low:</span>{' '}
                    Recent phase revenue swung from {fmtInr(phaseNarrative.recentLow)} to {fmtInr(phaseNarrative.recentPeak)}.
                    {(phaseNarrative.recentPeak / Math.max(phaseNarrative.recentLow, 1)) > 1.4
                      ? ' High intra-phase volatility suggests uneven store performance or seasonal demand patterns — investigate outlier months.'
                      : ' Intra-phase revenue was broadly consistent, suggesting stable demand without sharp seasonal swings.'}
                  </p>
                  {phaseNarrative.networkGrowthPct !== null && (
                    <p><span className="font-semibold text-gray-800">Overall Verdict:</span>{' '}
                      {phaseNarrative.networkGrowthPct > 15
                        ? `The network has grown significantly — ${fmtPct(phaseNarrative.networkGrowthPct)} improvement from early to recent phase. Protect and scale the top performers driving this result.`
                        : phaseNarrative.networkGrowthPct > 0
                          ? `Moderate network growth of ${fmtPct(phaseNarrative.networkGrowthPct)} over the period. Focus on converting mid-tier stores to outperformers to accelerate the trajectory.`
                          : `Network revenue has declined ${fmtPct(Math.abs(phaseNarrative.networkGrowthPct))} from early to recent phase. Immediate diagnosis of structural vs operational causes is critical.`}
                    </p>
                  )}
                </div>
              </div>
            )}

          </div>
        </motion.div>
      )}

    </div>
  )
}
