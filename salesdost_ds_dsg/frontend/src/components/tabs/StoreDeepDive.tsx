import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, useMotionValue, useTransform, animate, AnimatePresence } from 'framer-motion'
import { Building2, Search } from 'lucide-react'
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
import { PT } from '@/lib/plotlyTheme'

const Plot = createPlotlyComponent(Plotly)

// ── Types ─────────────────────────────────────────────────────────────────────

type HealthTier     = 'Healthy' | 'Recovering' | 'Declining' | 'Dormant' | 'Underperforming'
type JourneyTag     = 'Surging' | 'Rising' | 'Stable' | 'Sliding' | 'Falling'
type ActivityStatus = 'Active' | 'Growing' | 'Declining' | 'Inactive'

// ── Animation helpers ─────────────────────────────────────────────────────────

// Intentionally tighter than the shared panelSpring — this page uses a compact
// card layout where a smaller y-travel and subtle scale feel more polished.
const panelSpring = (delay = 0) => ({
  initial:    { opacity: 0, y: 22, scale: 0.98 },
  animate:    { opacity: 1, y: 0,  scale: 1    },
  transition: { type: 'spring' as const, stiffness: 310, damping: 28, delay },
})

// ── Style maps ────────────────────────────────────────────────────────────────

const HEALTH_HEX: Record<HealthTier, string> = {
  Healthy:         '#10b981',
  Recovering:      '#0ea5e9',
  Declining:       '#f59e0b',
  Dormant:         '#f97316',
  Underperforming: '#ef4444',
}

const HEALTH_BADGE: Record<HealthTier, string> = {
  Healthy:         'bg-emerald-50 text-emerald-700 border border-emerald-200',
  Recovering:      'bg-sky-50 text-sky-700 border border-sky-200',
  Declining:       'bg-amber-50 text-amber-700 border border-amber-200',
  Dormant:         'bg-orange-50 text-orange-700 border border-orange-200',
  Underperforming: 'bg-red-50 text-red-700 border border-red-200',
}

const HEALTH_BADGE_DARK: Record<HealthTier, string> = {
  Healthy:         'bg-emerald-400/20 text-emerald-300 border border-emerald-400/35',
  Recovering:      'bg-sky-400/20 text-sky-300 border border-sky-400/35',
  Declining:       'bg-amber-400/20 text-amber-300 border border-amber-400/35',
  Dormant:         'bg-orange-400/20 text-orange-300 border border-orange-400/35',
  Underperforming: 'bg-red-400/20 text-red-300 border border-red-400/35',
}

const HEALTH_LABEL: Record<HealthTier, string> = {
  Healthy:         'Green · Healthy. Strong, stable contributor — protect and learn from it.',
  Recovering:      'Recovering. Positive trajectory — monitor and support growth.',
  Declining:       'Declining. Revenue weakening — investigate root cause.',
  Dormant:         'Dormant. Minimal activity — assess viability.',
  Underperforming: 'Critical. Immediate intervention needed.',
}

const HEALTH_LABEL_COLOR: Record<HealthTier, string> = {
  Healthy:         'text-emerald-600',
  Recovering:      'text-sky-600',
  Declining:       'text-amber-600',
  Dormant:         'text-orange-600',
  Underperforming: 'text-red-600',
}

const JOURNEY_BADGE_DARK: Record<JourneyTag, string> = {
  Surging: 'bg-emerald-400/20 text-emerald-300 border border-emerald-400/35',
  Rising:  'bg-blue-400/20 text-blue-300 border border-blue-400/35',
  Stable:  'bg-slate-400/20 text-slate-300 border border-slate-400/35',
  Sliding: 'bg-amber-400/20 text-amber-300 border border-amber-400/35',
  Falling: 'bg-red-400/20 text-red-300 border border-red-400/35',
}

const CATEGORY_BADGE_DARK: Record<StoreCategory, string> = {
  'New Bloomer':    'bg-emerald-400/20 text-emerald-300 border border-emerald-400/35',
  'Rising Star':    'bg-yellow-400/20 text-yellow-300 border border-yellow-400/35',
  'Growing Store':  'bg-blue-400/20 text-blue-300 border border-blue-400/35',
  'Constant Store': 'bg-violet-400/20 text-violet-300 border border-violet-400/35',
  'Declining Store':'bg-orange-400/20 text-orange-300 border border-orange-400/35',
  'Fallen Star':    'bg-red-400/20 text-red-300 border border-red-400/35',
  'Inactive Store': 'bg-gray-400/20 text-gray-300 border border-gray-400/35',
}

const ACTIVITY_BADGE: Record<ActivityStatus, string> = {
  Active:   'text-emerald-600',
  Growing:  'text-sky-600',
  Declining:'text-red-500',
  Inactive: 'text-gray-400',
}
const ACTIVITY_DOT: Record<ActivityStatus, string> = {
  Active:   'bg-emerald-500',
  Growing:  'bg-sky-500',
  Declining:'bg-red-500',
  Inactive: 'bg-gray-300',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function revForMonths(store: StoreRecord, ms: string[]): number {
  return ms.reduce((s, m) => s + (store.monthly_sales[m] ?? 0), 0)
}

function avgRev(store: StoreRecord, ms: string[]): number {
  return ms.length ? revForMonths(store, ms) / ms.length : 0
}

function daysInMonth(monthLabel: string): number {
  const parts = monthLabel.split('-')
  if (parts.length !== 2) return 30
  const [mon, yr] = parts
  const idx = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec']
    .indexOf(mon.toLowerCase())
  const year = parseInt(yr, 10)
  if (idx === -1 || isNaN(year)) return 30
  return new Date(year, idx + 1, 0).getDate()
}

function avgDailyRevenue(months: string[], revenues: number[]): number[] {
  return revenues.map((rev, i) => {
    const days = daysInMonth(months[i])
    return rev > 0 ? rev / days : 0
  })
}

function pctileOf(rev: number, sorted: number[]): number {
  if (!sorted.length) return 0
  return (sorted.filter(r => r <= rev).length / sorted.length) * 100
}

function computeRank(storeRev: number, allRevs: number[]): number {
  return allRevs.filter(r => r > storeRev).length + 1
}

function journeyTag(g: number | null): JourneyTag {
  if (g === null) return 'Stable'
  if (g > 30)   return 'Surging'
  if (g > 10)   return 'Rising'
  if (g >= -5)  return 'Stable'
  if (g >= -20) return 'Sliding'
  return 'Falling'
}

function activityStatus(rev: number, mom: number | null): ActivityStatus {
  if (rev === 0)                        return 'Inactive'
  if (mom !== null && mom > 15)         return 'Growing'
  if (mom !== null && mom < -15)        return 'Declining'
  return 'Active'
}

function tier(score: number): HealthTier {
  if (score >= 70) return 'Healthy'
  if (score >= 50) return 'Recovering'
  if (score >= 30) return 'Declining'
  if (score >= 15) return 'Dormant'
  return 'Underperforming'
}

interface HealthScore { total: number; strength: number; consistency: number; growth: number; activity: number }

function computeHealthScore(
  store: StoreRecord,
  ms: string[],
  allStores: StoreRecord[],
): HealthScore {
  const revs = ms.map(m => store.monthly_sales[m] ?? 0)
  const n    = revs.length
  if (n === 0 || revs.every(v => v === 0)) return { total: 0, strength: 0, consistency: 0, growth: 0, activity: 0 }

  const allTotals = allStores.map(s => revForMonths(s, ms)).sort((a, b) => a - b)
  const strength  = Math.round(pctileOf(revForMonths(store, ms), allTotals))

  const mean = revs.reduce((a, b) => a + b, 0) / n
  const coV  = mean === 0 ? 1 : Math.sqrt(revs.reduce((s, v) => s + (v - mean) ** 2, 0) / n) / mean
  const consistency = Math.round(Math.max(0, 100 * (1 - Math.min(coV, 1))))

  const half = Math.max(1, Math.floor(n / 2))
  const earlyAvg  = revs.slice(0, half).reduce((a, b) => a + b, 0) / half
  const recentAvg = revs.slice(-half).reduce((a, b) => a + b, 0) / half
  const growthPct = earlyAvg === 0 ? null : (recentAvg - earlyAvg) / earlyAvg * 100

  const allGrowths = allStores.map(s => {
    const sRevs   = ms.map(m => s.monthly_sales[m] ?? 0)
    const sEarly  = sRevs.slice(0, half).reduce((a, b) => a + b, 0) / half
    const sRecent = sRevs.slice(-half).reduce((a, b) => a + b, 0) / half
    return sEarly === 0 ? 0 : (sRecent - sEarly) / sEarly * 100
  }).sort((a, b) => a - b)
  const growth = Math.round(pctileOf(growthPct ?? 0, allGrowths))

  const activeMonths = revs.filter(v => v > 0).length
  const activity     = Math.round((activeMonths / n) * 100)

  const total = Math.round(0.40 * strength + 0.25 * consistency + 0.20 * growth + 0.15 * activity)
  return { total, strength, consistency, growth, activity }
}

// ── AnimatedNumber ────────────────────────────────────────────────────────────

function AnimatedNumber({ value, className, decimals = 0 }: { value: number; className?: string; decimals?: number }) {
  const mv      = useMotionValue(0)
  const display = useTransform(mv, (v: number) =>
    decimals > 0 ? v.toFixed(decimals) : Math.round(v).toLocaleString()
  )
  useEffect(() => {
    const ctrl = animate(mv, value, { duration: 1.1, ease: [0.22, 1, 0.36, 1] })
    return () => ctrl.stop()
  }, [mv, value])
  return <motion.span className={className}>{display}</motion.span>
}

// ── Score Donut ───────────────────────────────────────────────────────────────

function ScoreDonut({ score, color, size = 120 }: { score: number; color: string; size?: number }) {
  const r             = 38
  const circumference = 2 * Math.PI * r
  const filled        = (score / 100) * circumference
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className="shrink-0">
      <defs>
        <filter id="donut-glow">
          <feGaussianBlur stdDeviation="1.5" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <circle cx={50} cy={50} r={r} fill="none" stroke="#e2e8f0" strokeWidth="9" />
      <motion.circle
        cx={50} cy={50} r={r} fill="none" stroke={color} strokeWidth="9"
        strokeLinecap="round" filter="url(#donut-glow)"
        initial={{ strokeDasharray: `0 ${circumference}`, strokeDashoffset: circumference * 0.25 }}
        animate={{ strokeDasharray: `${filled} ${circumference}`, strokeDashoffset: circumference * 0.25 }}
        transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
      />
      <text x={50} y={45} textAnchor="middle" fill="#0f172a" fontSize="20"
        fontWeight="800" fontFamily="Inter,sans-serif">{score.toFixed(0)}</text>
      <text x={50} y={58} textAnchor="middle" fill="#94a3b8" fontSize="8"
        fontFamily="Inter,sans-serif">out of 100</text>
    </svg>
  )
}

// ── Score Dimension Bar ───────────────────────────────────────────────────────

function ScoreDimBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-[11px] text-gray-500 w-44 shrink-0">{label}</span>
      <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          style={{ background: `linear-gradient(to right, ${color}80, ${color})` }}
          initial={{ width: 0 }}
          animate={{ width: `${value}%` }}
          transition={{ duration: 1.0, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>
      <span className="text-[11px] font-bold tabular-nums w-8 text-right" style={{ color }}>
        {value}
      </span>
    </div>
  )
}

// ── Store Selector ────────────────────────────────────────────────────────────

function StoreSelector({ stores, selectedId, selectedLabel, onSelect }: {
  stores: StoreRecord[]
  selectedId: string | null
  selectedLabel?: string
  onSelect: (id: string) => void
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen]   = useState(false)
  const ref               = useRef<HTMLDivElement>(null)
  const inputRef          = useRef<HTMLInputElement>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return stores.slice(0, 80)
    return stores.filter(s =>
      (s.store_name ?? '').toLowerCase().includes(q) ||
      s.store_id.toLowerCase().includes(q) ||
      (s.state ?? '').toLowerCase().includes(q)
    ).slice(0, 80)
  }, [stores, query])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 0) }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={cn(
          'flex items-center gap-2 h-9 pl-3 pr-2.5 rounded-xl border bg-white text-left transition-all shadow-sm',
          open
            ? 'border-indigo-400 ring-2 ring-indigo-100 shadow-indigo-100'
            : 'border-gray-200 hover:border-indigo-300 hover:shadow-md',
        )}
      >
        <Search className="h-3.5 w-3.5 text-indigo-400 shrink-0" />
        <span className="text-sm max-w-[220px] truncate">
          {selectedLabel
            ? <span className="text-gray-800 font-medium">{selectedLabel}</span>
            : <span className="text-gray-400">Search stores…</span>}
        </span>
        <svg className={cn('h-3.5 w-3.5 text-gray-400 shrink-0 ml-1 transition-transform', open && 'rotate-180')} viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
        </svg>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 z-50 mt-1.5 w-72 rounded-xl border border-gray-200 bg-white shadow-xl overflow-hidden"
          >
            <div className="p-2 border-b border-gray-100 bg-gray-50/50">
              <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-white border border-gray-200 shadow-sm">
                <Search className="h-3.5 w-3.5 text-indigo-400 shrink-0" />
                <input
                  ref={inputRef}
                  className="flex-1 bg-transparent text-sm text-gray-800 placeholder:text-gray-400 outline-none"
                  placeholder="Name, ID or state…"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                />
              </div>
            </div>
            <div className="max-h-72 overflow-y-auto">
              {filtered.length === 0
                ? <div className="px-4 py-6 text-center text-sm text-gray-400">No stores found</div>
                : filtered.map(s => (
                  <button key={s.store_id} type="button"
                    className={cn(
                      'w-full px-4 py-2.5 text-left hover:bg-indigo-50/60 transition-colors flex gap-3 items-center',
                      s.store_id === selectedId && 'bg-indigo-50',
                    )}
                    onClick={() => { onSelect(s.store_id); setOpen(false); setQuery('') }}>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-gray-800 truncate">{s.store_name ?? s.store_id}</div>
                      <div className="text-[11px] text-gray-400 mt-0.5 flex gap-2">
                        <span className="font-mono">{s.store_id}</span>
                        {s.state && <span>· {s.state}</span>}
                        {s.category && <span>· {s.category}</span>}
                      </div>
                    </div>
                    {s.store_id === selectedId && (
                      <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 shrink-0" />
                    )}
                  </button>
                ))}
            </div>
            <div className="px-4 py-1.5 border-t border-gray-100 bg-gray-50/50 text-[10px] text-gray-400">
              {filtered.length} of {stores.length} stores
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

interface Props { filters: FilterState; initialStoreId?: string | null }

export default function StoreDeepDive({ filters, initialStoreId }: Props) {
  const { stores, months, classification } = useDataContext()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const lastFilterKey = useRef('')
  const autoSelected = useRef(false)
  const filtersRef = useRef(filters)
  filtersRef.current = filters

  // Stores narrowed by the global state + category filters
  const filteredStores = useMemo(() => {
    let result = stores
    if (filters.state)    result = result.filter(s => s.state    === filters.state)
    if (filters.category) result = result.filter(s => s.category === filters.category)
    return result
  }, [stores, filters.state, filters.category])

  // Track previous initialStoreId to detect cross-tab navigation changes
  const prevInitialStoreId = useRef<string | null | undefined>(undefined)

  // Auto-select store; re-runs when filters change or a new store is pushed from another tab
  useEffect(() => {
    const { state, category } = filtersRef.current
    const filterKey = `${state}|${category}`
    const filtersChanged = lastFilterKey.current !== filterKey
    lastFilterKey.current = filterKey

    // initialStoreId changed (or first mount with a value) → apply it immediately
    // This must be checked before the early-return so re-navigation always works
    if (initialStoreId !== prevInitialStoreId.current) {
      prevInitialStoreId.current = initialStoreId
      if (initialStoreId) {
        setSelectedId(initialStoreId)
        autoSelected.current = true
        return
      }
    }

    // Nothing changed and already selected — keep current selection
    if (!filtersChanged && autoSelected.current) return

    // Auto-select highest-revenue store from the filtered list
    if (filteredStores.length > 0) {
      const top = [...filteredStores].sort((a, b) => {
        const aRev = Object.values(a.monthly_sales).reduce((s, v) => s + v, 0)
        const bRev = Object.values(b.monthly_sales).reduce((s, v) => s + v, 0)
        return bRev - aRev
      })[0]
      setSelectedId(top.store_id)
      autoSelected.current = true
    } else {
      setSelectedId(null)
    }
  // filteredStores already encodes filters.state + filters.category
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredStores, initialStoreId])

  const fm = useMemo(() => {
    let m = months
    if (filters.fromMonth) { const i = months.indexOf(filters.fromMonth); if (i >= 0) m = m.slice(i) }
    if (filters.toMonth)   { const i = months.indexOf(filters.toMonth);   if (i >= 0) m = m.slice(0, i + 1) }
    return m
  }, [months, filters])

  const selectedStore = useMemo(
    () => stores.find(s => s.store_id === selectedId) ?? null,
    [stores, selectedId],
  )

  // Engine category for the selected store (global classification, independent of date filters)
  const engineCategory = useMemo(
    () => classification.metrics.find(m => m.store.store_id === selectedId)?.category ?? null,
    [classification.metrics, selectedId],
  )

  const derived = useMemo(() => {
    if (!selectedStore || fm.length === 0) return null

    // Use the same 3-phase allocator as the classification engine
    const { earlyMonths: earlyMs, midMonths: midMs, recentMonths: recentMs } = allocatePhases(fm)
    const earlyHalf  = earlyMs
    const recentHalf = recentMs

    const revByMonth   = fm.map(m => selectedStore.monthly_sales[m] ?? 0)
    const totalRev     = revByMonth.reduce((a, b) => a + b, 0)
    const avgMonthRev  = totalRev / fm.length
    const activeMonths = revByMonth.filter(v => v > 0).length
    const dailyRevByMonth = avgDailyRevenue(fm, revByMonth)

    // Current / previous month avg daily revenue for KPI display
    const lastIdx         = fm.length - 1
    const currMonthLabel  = fm[lastIdx]
    const prevMonthLabel  = lastIdx > 0 ? fm[lastIdx - 1] : null
    const currDailyRev    = dailyRevByMonth[lastIdx] ?? 0
    const prevDailyRev    = prevMonthLabel !== null ? (dailyRevByMonth[lastIdx - 1] ?? 0) : null
    const dailyRevMoM     = prevDailyRev !== null && prevDailyRev > 0
      ? (currDailyRev - prevDailyRev) / prevDailyRev * 100
      : null

    let maxIdx = 0, minIdx = 0
    revByMonth.forEach((v, i) => {
      if (v > revByMonth[maxIdx]) maxIdx = i
      if (v < revByMonth[minIdx]) minIdx = i
    })

    const earlyAvgVal  = avgRev(selectedStore, earlyHalf)
    const recentAvgVal = avgRev(selectedStore, recentHalf)
    const growthVal    = earlyAvgVal === 0 ? null : (recentAvgVal - earlyAvgVal) / earlyAvgVal * 100
    const tag          = journeyTag(growthVal)

    const hs = computeHealthScore(selectedStore, fm, stores)
    const t  = tier(hs.total)

    const rankEarly  = computeRank(avgRev(selectedStore, earlyMs),  stores.map(s => avgRev(s, earlyMs)))
    const rankMid    = computeRank(avgRev(selectedStore, midMs),    stores.map(s => avgRev(s, midMs)))
    const rankRecent = computeRank(avgRev(selectedStore, recentMs), stores.map(s => avgRev(s, recentMs)))
    const rankImprovement = rankEarly - rankRecent

    const allRevs     = stores.map(s => revForMonths(s, fm))
    const networkRank = computeRank(totalRev, allRevs)
    const stateStores = stores.filter(s => s.state === selectedStore.state)
    const stateRevs   = stateStores.map(s => revForMonths(s, fm))
    const stateRank   = computeRank(totalRev, stateRevs)

    const tableRows = fm.map((m, i) => {
      const rev  = selectedStore.monthly_sales[m] ?? 0
      const prev = i > 0 ? (selectedStore.monthly_sales[fm[i - 1]] ?? 0) : null
      const mom  = prev === null || prev === 0 ? null : (rev - prev) / prev * 100
      const mRevs    = stores.map(s => s.monthly_sales[m] ?? 0)
      const rank     = computeRank(rev, mRevs)
      const activity = activityStatus(rev, mom)
      return { month: m, rev, mom, rank, total: stores.length, activity }
    })

    const waterfallData = fm.map((m, i) => {
      const rev  = selectedStore.monthly_sales[m] ?? 0
      const prev = i > 0 ? (selectedStore.monthly_sales[fm[i - 1]] ?? 0) : 0
      return { month: m, rev, change: i === 0 ? rev : rev - prev, isFirst: i === 0 }
    })

    const selectorLabel = `${selectedStore.store_id} · ${fmtInr(totalRev)} · ${tag}`

    return {
      revByMonth, dailyRevByMonth, maxIdx, minIdx, hs, t, growthVal, tag,
      totalRev, avgMonthRev, activeMonths,
      earlyAvgVal, recentAvgVal, earlyHalf, recentHalf,
      rankEarly, rankMid, rankRecent, rankImprovement,
      networkRank, stateRank, stateTotal: stateStores.length,
      tableRows, waterfallData, selectorLabel,
      currMonthLabel, prevMonthLabel, currDailyRev, prevDailyRev, dailyRevMoM,
    }
  }, [selectedStore, stores, fm])

  const cardBase = 'rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden'

  // ── Empty / loading state ─────────────────────────────────────────────────

  if (!selectedStore || !derived) {
    const topStores = [...filteredStores]
      .sort((a, b) => {
        const aRev = Object.values(a.monthly_sales).reduce((s, v) => s + v, 0)
        const bRev = Object.values(b.monthly_sales).reduce((s, v) => s + v, 0)
        return bRev - aRev
      })
      .slice(0, 6)

    return (
      <div className="space-y-5">
        <motion.div
          initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="flex items-start justify-between gap-4 flex-wrap"
        >
          <div>
            <h2 className="text-base font-bold text-gray-900">Store Spotlight — Full Profile</h2>
            <p className="text-[11px] text-gray-500 mt-0.5">
              Revenue trend, rank journey across three phases, health score breakdown, and month-by-month waterfall
            </p>
          </div>
          <StoreSelector stores={filteredStores} selectedId={null} onSelect={setSelectedId} />
        </motion.div>

        {topStores.length > 0 ? (
          <div>
            <p className="text-xs text-gray-400 mb-3 font-medium">Top stores by revenue — click to explore</p>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              {topStores.map((s, i) => {
                const rev = Object.values(s.monthly_sales).reduce((a, b) => a + b, 0)
                return (
                  <motion.button
                    key={s.store_id}
                    initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.06, type: 'spring', stiffness: 300, damping: 26 }}
                    onClick={() => setSelectedId(s.store_id)}
                    className="flex flex-col items-start gap-1.5 p-3.5 rounded-xl border border-gray-200 bg-white hover:border-indigo-300 hover:bg-indigo-50/40 hover:shadow-md transition-all text-left group"
                  >
                    <div className="h-7 w-7 rounded-lg bg-indigo-50 flex items-center justify-center group-hover:bg-indigo-100 transition-colors">
                      <Building2 className="h-3.5 w-3.5 text-indigo-500" />
                    </div>
                    <div className="min-w-0 w-full">
                      <div className="text-xs font-bold text-gray-800 truncate">{s.store_name ?? s.store_id}</div>
                      <div className="text-[10px] text-gray-400 font-mono mt-0.5">{s.store_id}</div>
                    </div>
                    <div className="text-sm font-bold text-indigo-600">{fmtInr(rev)}</div>
                  </motion.button>
                )
              })}
            </div>
          </div>
        ) : (
          <div className={cn(cardBase, 'min-h-[320px] flex flex-col items-center justify-center gap-4 p-8')}>
            <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-indigo-50 to-indigo-100 flex items-center justify-center">
              <Building2 className="h-6 w-6 text-indigo-400" />
            </div>
            <div className="text-center">
              <h3 className="text-base font-semibold text-gray-700">No stores loaded</h3>
              <p className="mt-1 text-sm text-gray-400">Upload data to explore store analytics</p>
            </div>
          </div>
        )}
      </div>
    )
  }

  const {
    revByMonth, dailyRevByMonth, maxIdx, minIdx, hs, t, growthVal, tag,
    totalRev, avgMonthRev, activeMonths,
    rankEarly, rankMid, rankRecent, rankImprovement,
    networkRank, stateRank, stateTotal,
    tableRows, waterfallData, selectorLabel,
    currMonthLabel, prevMonthLabel, currDailyRev, prevDailyRev, dailyRevMoM,
  } = derived

  const healthColor = HEALTH_HEX[t]

  // Bar colours: slate-400 (#94a3b8) → indigo-500 (#6366f1) by recency
  const barColors = fm.map((_, i) => {
    if (i === maxIdx) return '#10b981'
    if (i === minIdx && revByMonth[i] > 0) return '#ef4444'
    const recency = i / Math.max(fm.length - 1, 1)
    const r = Math.round(148 - recency * 49)
    const g = Math.round(163 - recency * 61)
    const b = Math.round(184 + recency * 57)
    return `rgb(${r},${g},${b})`
  })

  const annotations: object[] = []
  if (fm.length > 0) {
    annotations.push({
      x: fm[maxIdx], y: revByMonth[maxIdx],
      text: `Peak: ${fmtInr(revByMonth[maxIdx])}`,
      showarrow: true, arrowhead: 2, arrowsize: 0.8, arrowcolor: '#10b981',
      font: { color: '#10b981', size: 10 },
      bgcolor: 'rgba(16,185,129,0.08)', bordercolor: '#10b981', borderwidth: 1, borderpad: 3,
      ax: 0, ay: -38,
    })
    if (maxIdx !== minIdx && revByMonth[minIdx] > 0) {
      annotations.push({
        x: fm[minIdx], y: revByMonth[minIdx],
        text: `Low: ${fmtInr(revByMonth[minIdx])}`,
        showarrow: true, arrowhead: 2, arrowsize: 0.8, arrowcolor: '#ef4444',
        font: { color: '#ef4444', size: 10 },
        bgcolor: 'rgba(239,68,68,0.08)', bordercolor: '#ef4444', borderwidth: 1, borderpad: 3,
        ax: 0, ay: -38,
      })
    }
  }

  const revPattern = (() => {
    const nonZero = revByMonth.filter(v => v > 0)
    if (nonZero.length < 2) return 'Sparse data'
    const mean = nonZero.reduce((a, b) => a + b, 0) / nonZero.length
    const coV  = Math.sqrt(nonZero.reduce((s, v) => s + (v - mean) ** 2, 0) / nonZero.length) / mean
    return coV > 0.5 ? 'High volatility' : coV > 0.25 ? 'Moderate variance' : 'Consistent'
  })()

  return (
    <div className="space-y-4">

      {/* ── Page Header ── */}
      <motion.div
        initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28 }}
        className="flex items-start justify-between gap-4 flex-wrap"
      >
        <div>
          <h2 className="text-base font-bold text-gray-900">Store Journey — Deep Dive</h2>
          <p className="text-[11px] text-gray-500 mt-0.5">
            Full analytical profile, rank journey, health score and recommended actions
          </p>
        </div>
        <StoreSelector
          stores={filteredStores} selectedId={selectedId}
          selectedLabel={selectorLabel} onSelect={setSelectedId}
        />
      </motion.div>

      {/* ── Animate entire content when store changes ── */}
      <AnimatePresence mode="wait">
        <motion.div
          key={selectedId}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="space-y-4"
        >

          {/* ── Store Hero Banner ── */}
          <motion.div
            initial={{ opacity: 0, y: -14 }} animate={{ opacity: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 30, delay: 0.04 }}
            className="rounded-2xl overflow-hidden shadow-lg"
            style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 55%, #1e3a5f 100%)' }}
          >
            {/* health-color top strip */}
            <div className="h-[3px]" style={{ background: `linear-gradient(to right, ${healthColor}, ${healthColor}40)` }} />

            <div className="px-6 py-5">
              <div className="flex flex-col lg:flex-row items-start lg:items-center gap-5">

                {/* Identity */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 flex-wrap">
                    <div
                      className="h-9 w-9 rounded-xl flex items-center justify-center shrink-0"
                      style={{ background: `${healthColor}20`, border: `1px solid ${healthColor}35` }}
                    >
                      <Building2 className="h-4.5 w-4.5" style={{ color: healthColor }} />
                    </div>
                    <h2 className="text-xl font-bold text-white leading-tight">
                      {selectedStore.store_name ?? selectedStore.store_id}
                    </h2>
                    {engineCategory && (
                      <span className={cn('text-xs font-bold px-2.5 py-1 rounded-full shrink-0', CATEGORY_BADGE_DARK[engineCategory])}>
                        {engineCategory}
                      </span>
                    )}
                    <span className={cn('text-xs font-bold px-2.5 py-1 rounded-full shrink-0', HEALTH_BADGE_DARK[t])}>
                      {t}
                    </span>
                    <span className={cn('text-xs font-bold px-2.5 py-1 rounded-full shrink-0', JOURNEY_BADGE_DARK[tag])}>
                      {tag}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-2 text-xs text-white/40 flex-wrap">
                    <span className="font-mono text-white/50">{selectedStore.store_id}</span>
                    {selectedStore.state    && <><span>·</span><span>{selectedStore.state}</span></>}
                    {selectedStore.category && <><span>·</span><span>{selectedStore.category}</span></>}
                  </div>
                </div>

                {/* Key stats */}
                <div className="flex gap-2.5 flex-wrap">
                  {/* Total Revenue */}
                  <div className="flex flex-col px-4 py-3 rounded-xl bg-white/10 border border-white/10 min-w-[90px]">
                    <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-white/40 whitespace-nowrap">Total Revenue</span>
                    <span className="text-[17px] font-bold text-white mt-1 tabular-nums leading-none">{fmtInr(totalRev)}</span>
                  </div>
                  {/* Network Rank */}
                  <div className="flex flex-col px-4 py-3 rounded-xl bg-white/10 border border-white/10 min-w-[90px]">
                    <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-white/40 whitespace-nowrap">Network Rank</span>
                    <span className="text-[17px] font-bold text-white mt-1 tabular-nums leading-none">#{networkRank}</span>
                    <span className="text-[10px] text-white/30 mt-0.5">of {stores.length}</span>
                  </div>
                  {/* State Rank */}
                  {selectedStore.state && (
                    <div className="flex flex-col px-4 py-3 rounded-xl bg-white/10 border border-white/10 min-w-[90px]">
                      <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-white/40 whitespace-nowrap">State Rank</span>
                      <span className="text-[17px] font-bold text-white mt-1 tabular-nums leading-none">#{stateRank}</span>
                      <span className="text-[10px] text-white/30 mt-0.5">of {stateTotal}</span>
                    </div>
                  )}
                  {/* Growth */}
                  {growthVal !== null && (
                    <div className="flex flex-col px-4 py-3 rounded-xl bg-white/10 border border-white/10 min-w-[90px]">
                      <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-white/40 whitespace-nowrap">Growth</span>
                      <span
                        className="text-[17px] font-bold mt-1 tabular-nums leading-none"
                        style={{ color: growthVal >= 0 ? '#34d399' : '#f87171' }}
                      >{fmtPct(growthVal)}</span>
                    </div>
                  )}
                  {/* Active Months */}
                  <div className="flex flex-col px-4 py-3 rounded-xl bg-white/10 border border-white/10 min-w-[90px]">
                    <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-white/40 whitespace-nowrap">Active Months</span>
                    <span className="text-[17px] font-bold text-white mt-1 tabular-nums leading-none">{activeMonths}</span>
                    <span className="text-[10px] text-white/30 mt-0.5">of {fm.length}</span>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>

          {/* ── Row 1: Revenue Trend | Rank Journey ── */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">

            {/* Revenue Trend */}
            <motion.div {...panelSpring(0.08)} className={cardBase}>
              <div className="h-[3px] bg-gradient-to-r from-indigo-500 to-indigo-300" />
              <div className="p-4">
                <h3 className="text-sm font-semibold text-gray-800">Revenue Trend & Avg Daily Revenue</h3>
                <p className="text-[11px] text-gray-500 mt-0.5 mb-3">
                  Monthly revenue (bars) with avg daily revenue line · selling days normalised
                </p>
                <Plot
                  data={[
                    {
                      type: 'bar',
                      name: 'Monthly Revenue',
                      x: fm,
                      y: revByMonth,
                      marker: { color: barColors, opacity: 0.9 },
                      hovertemplate: '<b>%{x}</b><br>Revenue: ₹%{y:,.0f}<extra></extra>',
                    },
                    {
                      type: 'scatter',
                      mode: 'lines+markers',
                      name: 'Avg Daily Rev',
                      x: fm,
                      y: dailyRevByMonth,
                      yaxis: 'y2' as const,
                      line: { color: '#f59e0b', width: 2.5, shape: 'spline' as const },
                      marker: { color: '#f59e0b', size: 5 },
                      hovertemplate: '<b>%{x}</b><br>Daily Avg: ₹%{y:,.0f}<extra></extra>',
                    },
                  ]}
                  layout={{
                    paper_bgcolor: 'rgba(0,0,0,0)',
                    plot_bgcolor:  'rgba(0,0,0,0)',
                    font:   { color: PT.font, family: 'Inter, sans-serif', size: 11 },
                    legend: {
                      bgcolor: 'rgba(0,0,0,0)', font: { color: PT.font, size: 10 },
                      orientation: 'h' as const, x: 0, y: -0.22,
                    },
                    xaxis:  { gridcolor: PT.grid, linecolor: PT.line, tickcolor: PT.line, automargin: true },
                    yaxis:  { gridcolor: PT.grid, linecolor: PT.line, tickcolor: PT.line, automargin: true, title: { text: 'Monthly Rev (₹)' }, ...plotlyInrTickVals(revByMonth.length ? Math.max(...revByMonth) : 0) },
                    yaxis2: { gridcolor: 'transparent', linecolor: PT.line, tickcolor: PT.line, overlaying: 'y' as const, side: 'right' as const, title: { text: 'Daily Avg (₹)' }, ...plotlyInrTickVals(dailyRevByMonth.length ? Math.max(...dailyRevByMonth) : 0, 4) },
                    hovermode: 'x unified' as const,
                    margin: { l: 52, r: 62, t: 12, b: 80 },
                    height: 270,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    annotations: annotations as any[],
                  }}
                  config={{ displayModeBar: false, responsive: true }}
                  style={{ width: '100%' }}
                />

                {/* Avg Daily Revenue KPIs */}
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <div className="rounded-lg bg-amber-50 border border-amber-100 px-2.5 py-2">
                    <p className="text-[9px] font-bold uppercase tracking-wider text-amber-600">{currMonthLabel}</p>
                    <p className="text-sm font-bold text-amber-800 mt-0.5">{fmtInr(currDailyRev)}</p>
                    <p className="text-[9px] text-amber-500 mt-0.5">avg / day</p>
                  </div>
                  {prevMonthLabel !== null && prevDailyRev !== null ? (
                    <div className="rounded-lg bg-slate-50 border border-slate-100 px-2.5 py-2">
                      <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500">{prevMonthLabel}</p>
                      <p className="text-sm font-bold text-slate-700 mt-0.5">{fmtInr(prevDailyRev)}</p>
                      <p className="text-[9px] text-slate-400 mt-0.5">avg / day</p>
                    </div>
                  ) : (
                    <div className="rounded-lg bg-slate-50 border border-slate-100 px-2.5 py-2 flex items-center justify-center">
                      <p className="text-[9px] text-slate-400">No prev month</p>
                    </div>
                  )}
                  <div className={cn(
                    'rounded-lg border px-2.5 py-2',
                    dailyRevMoM === null ? 'bg-gray-50 border-gray-100' :
                    dailyRevMoM >= 0 ? 'bg-emerald-50 border-emerald-100' : 'bg-red-50 border-red-100',
                  )}>
                    <p className="text-[9px] font-bold uppercase tracking-wider text-gray-500">MoM Change</p>
                    <p className={cn(
                      'text-sm font-bold mt-0.5',
                      dailyRevMoM === null ? 'text-gray-400' :
                      dailyRevMoM >= 0 ? 'text-emerald-700' : 'text-red-600',
                    )}>
                      {dailyRevMoM !== null ? fmtPct(dailyRevMoM) : '—'}
                    </p>
                    <p className="text-[9px] text-gray-400 mt-0.5">daily avg</p>
                  </div>
                </div>

                <div className="flex items-center gap-4 mt-2 text-[11px] text-gray-500 flex-wrap">
                  <span>Trend: <span className={cn('font-semibold',
                    growthVal !== null && growthVal >= 0 ? 'text-emerald-600' : 'text-red-500')}>
                    {growthVal !== null ? (growthVal >= 0 ? '↑ Upward' : '↓ Downward') : 'N/A'}
                  </span></span>
                  <span>Pattern: <span className="font-medium text-gray-600">{revPattern}</span></span>
                  <span>Peak: <span className="font-medium text-gray-700">{fm[maxIdx]}</span></span>
                </div>
              </div>
            </motion.div>

            {/* Rank Journey */}
            <motion.div {...panelSpring(0.13)} className={cardBase}>
              <div className="h-[3px] bg-gradient-to-r from-emerald-500 to-emerald-300" />
              <div className="p-4">
                <h3 className="text-sm font-semibold text-gray-800">Rank Journey — Early → Mid → Recent</h3>
                <p className="text-[11px] text-gray-500 mt-0.5 mb-1">
                  How the store's network rank moved across phases
                  {rankImprovement > 0 && (
                    <span className="ml-2 font-semibold text-emerald-600">
                      ▲ improved {rankImprovement} positions
                    </span>
                  )}
                  {rankImprovement < 0 && (
                    <span className="ml-2 font-semibold text-red-500">
                      ▼ dropped {Math.abs(rankImprovement)} positions
                    </span>
                  )}
                </p>
                {/* Rank calculation explanation */}
                <div className="mb-3 px-3 py-2 rounded-lg bg-slate-50 border border-slate-100 text-[10.5px] text-gray-500 leading-relaxed">
                  <span className="font-semibold text-gray-600">Rank #1</span> = highest-revenue store in the network.
                  Each phase rank compares this store's <span className="font-medium text-gray-700">average monthly revenue</span> in
                  that time slice against every other store — stores with higher average revenue rank above.
                  {' '}<span className="font-semibold text-emerald-600">Rank moving up on this chart = climbing toward #1</span>{' '}
                  (axis is inverted so better rank always appears higher).
                </div>
                <Plot
                  data={[{
                    type: 'scatter',
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    mode: 'lines+markers+text' as any,
                    x: ['Early', 'Mid', 'Recent'],
                    y: [rankEarly, rankMid, rankRecent],
                    text: [`#${rankEarly}`, `#${rankMid}`, `#${rankRecent}`],
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    textposition: ['top center', 'top center', 'bottom center'] as any,
                    textfont: { color: '#374151', size: 11, family: 'Inter, sans-serif' },
                    line: { color: '#10b981', width: 3, shape: 'spline' as const },
                    marker: {
                      color: ['#6366f1', '#8b5cf6', '#10b981'],
                      size: 14,
                      line: { color: '#ffffff', width: 2.5 },
                    },
                    hovertemplate: '<b>%{x}</b><br>Rank #%{y}<extra></extra>',
                  }]}
                  layout={{
                    paper_bgcolor: 'rgba(0,0,0,0)',
                    plot_bgcolor:  'rgba(0,0,0,0)',
                    font:   { color: PT.font, family: 'Inter, sans-serif', size: 11 },
                    xaxis:  { gridcolor: PT.grid, linecolor: PT.line, tickcolor: PT.line, automargin: true },
                    yaxis:  {
                      gridcolor: PT.grid, linecolor: PT.line, tickcolor: PT.line, automargin: true,
                      autorange: 'reversed' as const,
                      title: { text: 'Network Rank' },
                    },
                    showlegend: false,
                    margin: { l: 70, r: 32, t: 24, b: 50 },
                    height: 270,
                  }}
                  config={{ displayModeBar: false, responsive: true }}
                  style={{ width: '100%' }}
                />
              </div>
            </motion.div>
          </div>

          {/* ── Row 2: Health Score | Waterfall ── */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">

            {/* Store Health Score */}
            <motion.div {...panelSpring(0.18)} className={cn(cardBase, 'lg:col-span-2')}>
              <div className="h-[3px]" style={{ background: `linear-gradient(to right, ${healthColor}, ${healthColor}50)` }} />
              <div className="p-5">
                <h3 className="text-sm font-semibold text-gray-800">Store Health Score</h3>
                <p className="text-[11px] text-gray-500 mt-0.5 mb-4">
                  40% revenue · 25% consistency · 20% growth · 15% activity
                </p>

                <div className="flex items-center gap-5">
                  <div className="relative">
                    <ScoreDonut score={hs.total} color={healthColor} size={116} />
                    <div
                      className="absolute inset-0 rounded-full opacity-20 blur-lg"
                      style={{ background: healthColor }}
                    />
                  </div>
                  <div className="flex-1 space-y-3.5">
                    <ScoreDimBar label="Revenue Strength (40%)" value={hs.strength}    color="#6366f1" />
                    <ScoreDimBar label="Consistency (25%)"      value={hs.consistency} color="#8b5cf6" />
                    <ScoreDimBar label="Growth (20%)"           value={hs.growth}      color="#10b981" />
                    <ScoreDimBar label="Activity (15%)"         value={hs.activity}    color="#f59e0b" />
                  </div>
                </div>

                <div className="mt-4 flex items-center gap-2">
                  <span className={cn('text-xs font-bold px-2.5 py-1 rounded-full', HEALTH_BADGE[t])}>
                    {t}
                  </span>
                  <p className={cn('text-[11px] font-medium', HEALTH_LABEL_COLOR[t])}>
                    {HEALTH_LABEL[t]}
                  </p>
                </div>

                {/* Health score calculation breakdown */}
                <div className="mt-3 px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-100 space-y-1.5">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2">How it's scored</p>
                  {([
                    { dot: '#6366f1', label: 'Revenue Strength · 40%', desc: 'Revenue percentile vs all stores in the period — ranks your total output' },
                    { dot: '#8b5cf6', label: 'Consistency · 25%',      desc: 'Inverse of revenue volatility (CoV) — steady month-on-month = higher score' },
                    { dot: '#10b981', label: 'Growth · 20%',           desc: 'Half-period growth-rate percentile — compares your trajectory to every store' },
                    { dot: '#f59e0b', label: 'Activity · 15%',         desc: '% of months with non-zero revenue — penalises dormant periods' },
                  ] as const).map(({ dot, label, desc }) => (
                    <div key={label} className="flex items-start gap-2 text-[10.5px]">
                      <span className="mt-0.5 h-2 w-2 rounded-full shrink-0" style={{ background: dot }} />
                      <div>
                        <span className="font-semibold text-gray-600">{label}:</span>
                        <span className="text-gray-400 ml-1">{desc}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>

            {/* Revenue Journey Waterfall */}
            <motion.div {...panelSpring(0.23)} className={cn(cardBase, 'lg:col-span-3')}>
              <div className="h-[3px] bg-gradient-to-r from-blue-500 to-sky-400" />
              <div className="p-4">
                <h3 className="text-sm font-semibold text-gray-800">Revenue Journey Waterfall</h3>
                <p className="text-[11px] text-gray-500 mt-0.5 mb-3">
                  How the store moved from early baseline to recent revenue, month by month
                </p>
                <Plot
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  data={[{
                    type:        'waterfall',
                    orientation: 'v',
                    x:           waterfallData.map(d => d.month),
                    y:           waterfallData.map(d => d.change),
                    measure:     waterfallData.map((_, i) => i === 0 ? 'absolute' : 'relative'),
                    connector:   { line: { color: '#e2e8f0', width: 1 } },
                    increasing:  { marker: { color: '#10b981', opacity: 0.88 } },
                    decreasing:  { marker: { color: '#ef4444', opacity: 0.88 } },
                    totals:      { marker: { color: '#6366f1', opacity: 0.88 } },
                    text:        waterfallData.map(d => fmtInr(d.change)),
                    textposition: 'outside',
                    textfont:    { size: 9, color: '#374151' },
                    hovertemplate: '<b>%{x}</b><br>%{text}<extra></extra>',
                  } as any]}
                  layout={{
                    paper_bgcolor: 'rgba(0,0,0,0)',
                    plot_bgcolor:  'rgba(0,0,0,0)',
                    font:   { color: PT.font, family: 'Inter, sans-serif', size: 11 },
                    xaxis:  { gridcolor: PT.grid, linecolor: PT.line, tickcolor: PT.line, automargin: true },
                    yaxis:  { gridcolor: PT.grid, linecolor: PT.line, tickcolor: PT.line, automargin: true, ...plotlyInrTickVals(waterfallData.length ? Math.max(...waterfallData.map(d => d.rev)) : 0) },
                    showlegend: false,
                    margin: { l: 52, r: 12, t: 12, b: 80 },
                    height: 320,
                  }}
                  config={{ displayModeBar: false, responsive: true }}
                  style={{ width: '100%' }}
                />
              </div>
            </motion.div>
          </div>

          {/* ── Store Journey Timeline ── */}
          <motion.div {...panelSpring(0.28)} className={cardBase}>
            <div className="h-[3px] bg-gradient-to-r from-slate-600 to-slate-400" />
            <div className="px-5 py-3 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-800">Store Journey Timeline</h3>
              <p className="text-[11px] text-gray-500 mt-0.5">
                Month-wise revenue, MoM growth, network rank and activity status
              </p>
            </div>
            <div className="overflow-x-auto" style={{ maxHeight: 380, overflowY: 'auto' }}>
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10">
                  <tr style={{ background: 'linear-gradient(to right, #0f172a, #1e1b4b)' }}>
                    <th className="px-5 py-2.5 text-left text-xs font-semibold tracking-wider text-amber-400 whitespace-nowrap">Month</th>
                    <th className="px-5 py-2.5 text-left text-xs font-semibold tracking-wider text-slate-300 whitespace-nowrap">Revenue</th>
                    <th className="px-5 py-2.5 text-left text-xs font-semibold tracking-wider text-slate-300 whitespace-nowrap">MoM %</th>
                    <th className="px-5 py-2.5 text-left text-xs font-semibold tracking-wider text-slate-300 whitespace-nowrap">Network Rank</th>
                    <th className="px-5 py-2.5 text-left text-xs font-semibold tracking-wider text-slate-300 whitespace-nowrap">Activity</th>
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map((row, idx) => (
                    <tr
                      key={row.month}
                      className={cn(
                        'border-b border-gray-100 hover:bg-indigo-50/40 transition-colors',
                        idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50',
                      )}
                    >
                      <td className="px-5 py-2.5 text-gray-700 font-semibold whitespace-nowrap">{row.month}</td>
                      <td className="px-5 py-2.5 text-gray-800 tabular-nums whitespace-nowrap">
                        {row.rev > 0 ? fmtInr(row.rev) : <span className="text-gray-300">—</span>}
                      </td>
                      <td className={cn(
                        'px-5 py-2.5 tabular-nums text-sm font-semibold whitespace-nowrap',
                        row.mom === null ? 'text-gray-300'
                          : row.mom >= 0 ? 'text-emerald-600' : 'text-red-500',
                      )}>
                        {row.mom === null ? '—' : fmtPct(row.mom)}
                      </td>
                      <td className="px-5 py-2.5 whitespace-nowrap">
                        {row.rev > 0 ? (
                          <span className="text-sm text-gray-600 tabular-nums">
                            #{row.rank} / {row.total}
                          </span>
                        ) : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-5 py-2.5">
                        <span className={cn(
                          'inline-flex items-center gap-1.5 text-[11px] font-semibold whitespace-nowrap',
                          ACTIVITY_BADGE[row.activity],
                        )}>
                          <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', ACTIVITY_DOT[row.activity])} />
                          {row.activity}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-5 py-2 border-t border-gray-100 bg-slate-50/60 flex items-center gap-6 text-[11px] text-gray-500">
              <span>Avg / Month: <span className="font-semibold text-gray-700">{fmtInr(avgMonthRev)}</span></span>
              <span>Active months: <span className="font-semibold text-gray-700">{activeMonths} / {fm.length}</span></span>
            </div>
          </motion.div>

        </motion.div>
      </AnimatePresence>

    </div>
  )
}
