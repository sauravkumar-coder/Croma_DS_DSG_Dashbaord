import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Activity, Building2, MapPin, Search, Tag,
  TrendingDown, TrendingUp,
} from 'lucide-react'
// eslint-disable-next-line @typescript-eslint/no-require-imports
import createPlotlyComponent from 'react-plotly.js/factory'
// @ts-ignore — plotly.js-dist-min does not ship its own .d.ts
import Plotly from 'plotly.js-dist-min'
import { useDataContext } from '@/contexts/DataContext'
import type { FilterState } from '@/hooks/useFilters'
import type { StoreRecord } from '@/lib/api'
import { cn } from '@/lib/utils'

const Plot = createPlotlyComponent(Plotly)

// ── Types ─────────────────────────────────────────────────────────────────────

type HealthTier = 'Healthy' | 'Recovering' | 'Declining' | 'Dormant' | 'Underperforming'
type JourneyTag = 'Surging' | 'Rising' | 'Stable' | 'Sliding' | 'Falling'

// ── Constants ─────────────────────────────────────────────────────────────────

const PLOTLY_AXES = {
  gridcolor: '#1f2937',
  linecolor: '#374151',
  tickcolor: '#374151',
  automargin: true,
} as const

const HEALTH_HEX: Record<HealthTier, string> = {
  Healthy:        '#10b981',
  Recovering:     '#3b82f6',
  Declining:      '#f59e0b',
  Dormant:        '#f97316',
  Underperforming:'#ef4444',
}

const HEALTH_BADGE: Record<HealthTier, string> = {
  Healthy:        'bg-emerald-500/15 text-emerald-400',
  Recovering:     'bg-blue-500/15 text-blue-400',
  Declining:      'bg-amber-500/15 text-amber-400',
  Dormant:        'bg-orange-500/15 text-orange-400',
  Underperforming:'bg-red-500/15 text-red-400',
}

const JOURNEY_BADGE: Record<JourneyTag, string> = {
  Surging: 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30',
  Rising:  'bg-blue-500/20 text-blue-300 border border-blue-500/30',
  Stable:  'bg-gray-500/20 text-gray-300 border border-gray-600/40',
  Sliding: 'bg-amber-500/20 text-amber-300 border border-amber-500/30',
  Falling: 'bg-red-500/20 text-red-300 border border-red-500/30',
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

function fmtInr(n: number): string {
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(2)}Cr`
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(2)}L`
  if (abs >= 1e3) return `${sign}₹${(abs / 1e3).toFixed(1)}K`
  return `${sign}₹${abs.toFixed(0)}`
}

function fmtPct(n: number): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`
}

function revForMonths(store: StoreRecord, ms: string[]): number {
  return ms.reduce((s, m) => s + (store.monthly_sales[m] ?? 0), 0)
}

function avgRev(store: StoreRecord, ms: string[]): number {
  return ms.length ? revForMonths(store, ms) / ms.length : 0
}

function growthPct(store: StoreRecord, early: string[], recent: string[]): number | null {
  if (!early.length || !recent.length) return null
  const e = avgRev(store, early)
  return e === 0 ? null : (avgRev(store, recent) - e) / e * 100
}

function rollingAvg(values: number[], window: number): (number | null)[] {
  return values.map((_, i) => {
    if (i < window - 1) return null
    const sl = values.slice(i - window + 1, i + 1)
    return sl.reduce((a, b) => a + b, 0) / window
  })
}

interface HealthScore { total: number; trend: number; consistency: number; momentum: number }

function computeHealthScore(store: StoreRecord, ms: string[]): HealthScore {
  const revs = ms.map(m => store.monthly_sales[m] ?? 0)
  const n = revs.length
  if (n === 0 || revs.every(v => v === 0)) return { total: 0, trend: 0, consistency: 0, momentum: 0 }

  const half = Math.max(1, Math.floor(n / 2))
  const earlyAvg = revs.slice(0, half).reduce((a, b) => a + b, 0) / half
  const recentAvg = revs.slice(-half).reduce((a, b) => a + b, 0) / half

  // Revenue trend: 0–40 pts
  const ratio = earlyAvg === 0 ? 1 : recentAvg / earlyAvg
  const trendScore = Math.min(40, Math.max(0, 20 + (ratio - 1) * 40))

  // Consistency: 0–30 pts
  const mean = revs.reduce((a, b) => a + b, 0) / n
  const coV = mean === 0 ? 1 : Math.sqrt(revs.reduce((s, v) => s + (v - mean) ** 2, 0) / n) / mean
  const consistencyScore = Math.max(0, 30 * (1 - Math.min(coV, 1)))

  // Growth momentum: 0–30 pts (MoM acceleration in last 3 months)
  const last3 = revs.slice(-Math.min(3, n))
  let momentumScore = 15
  if (last3.length >= 2) {
    const changes: number[] = []
    for (let i = 1; i < last3.length; i++) {
      if (last3[i - 1] > 0) changes.push((last3[i] - last3[i - 1]) / last3[i - 1])
    }
    if (changes.length > 0) {
      const avg = changes.reduce((a, b) => a + b, 0) / changes.length
      momentumScore = Math.min(30, Math.max(0, 15 + avg * 60))
    }
  }

  const total = trendScore + consistencyScore + momentumScore
  return {
    total:       Math.round(Math.min(100, total)),
    trend:       Math.round(trendScore),
    consistency: Math.round(consistencyScore),
    momentum:    Math.round(momentumScore),
  }
}

function tier(score: number): HealthTier {
  if (score >= 70) return 'Healthy'
  if (score >= 50) return 'Recovering'
  if (score >= 30) return 'Declining'
  if (score >= 15) return 'Dormant'
  return 'Underperforming'
}

function journeyTag(g: number | null): JourneyTag {
  if (g === null) return 'Stable'
  if (g > 30)  return 'Surging'
  if (g > 10)  return 'Rising'
  if (g >= -5) return 'Stable'
  if (g >= -20) return 'Sliding'
  return 'Falling'
}

// ── SVG Health Score Donut ────────────────────────────────────────────────────

function ScoreDonut({ score, color, size = 110 }: { score: number; color: string; size?: number }) {
  const r = 38
  const circumference = 2 * Math.PI * r
  const filled = (score / 100) * circumference

  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className="shrink-0">
      <circle cx={50} cy={50} r={r} fill="none" stroke="#1f2937" strokeWidth="10" />
      <circle
        cx={50} cy={50} r={r}
        fill="none"
        stroke={color}
        strokeWidth="10"
        strokeLinecap="round"
        strokeDasharray={`${filled} ${circumference}`}
        strokeDashoffset={circumference * 0.25}
        style={{ transition: 'stroke-dasharray 0.9s ease' }}
      />
      <text x={50} y={46} textAnchor="middle" fill="white" fontSize="20" fontWeight="bold" fontFamily="Inter,sans-serif">
        {score}
      </text>
      <text x={50} y={60} textAnchor="middle" fill="#6b7280" fontSize="9" fontFamily="Inter,sans-serif">
        / 100
      </text>
    </svg>
  )
}

// ── Score Dimension Bar ───────────────────────────────────────────────────────

function ScoreDimBar({
  label, value, max, color, description,
}: { label: string; value: number; max: number; color: string; description: string }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-300">{label}</span>
        <span className="text-xs font-bold tabular-nums" style={{ color }}>{value} / {max}</span>
      </div>
      <div className="h-2 rounded-full bg-gray-800 overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${(value / max) * 100}%` }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
          className="h-full rounded-full"
          style={{ backgroundColor: color }}
        />
      </div>
      <p className="text-[10px] text-gray-600">{description}</p>
    </div>
  )
}

// ── Inline KPI pill ───────────────────────────────────────────────────────────

function KPIPill({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="rounded-lg bg-gray-800 px-3 py-1.5">
      <p className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</p>
      <p className={cn('text-base font-bold text-white', valueClass)}>{value}</p>
    </div>
  )
}

// ── Insight Card ──────────────────────────────────────────────────────────────

function InsightCard({ tag, tagCls, title, body, delay }: {
  tag: string; tagCls: string; title: string; body: string; delay: number
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className="rounded-xl border border-gray-800 bg-gray-900 p-5 flex flex-col gap-3"
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span className={cn('text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full', tagCls)}>
          {tag}
        </span>
        <span className="text-sm font-semibold text-gray-200">{title}</span>
      </div>
      <p className="text-sm text-gray-400 leading-relaxed">{body}</p>
    </motion.div>
  )
}

// ── Searchable Store Dropdown ─────────────────────────────────────────────────

function StoreSelector({
  stores, selectedId, onSelect,
}: {
  stores: StoreRecord[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const [query, setQuery]   = useState('')
  const [open, setOpen]     = useState(false)
  const ref                 = useRef<HTMLDivElement>(null)
  const inputRef            = useRef<HTMLInputElement>(null)

  const selected = stores.find(s => s.store_id === selectedId)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return stores.slice(0, 60)
    return stores.filter(s =>
      (s.store_name ?? '').toLowerCase().includes(q) ||
      s.store_id.toLowerCase().includes(q) ||
      (s.state ?? '').toLowerCase().includes(q)
    ).slice(0, 60)
  }, [stores, query])

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0)
  }, [open])

  return (
    <div ref={ref} className="relative w-full max-w-lg">
      <button
        type="button"
        className={cn(
          'w-full flex items-center gap-2 h-10 px-3 rounded-lg border bg-gray-900 text-left transition-colors',
          open ? 'border-blue-500 ring-1 ring-blue-500/30' : 'border-gray-700 hover:border-gray-600',
        )}
        onClick={() => setOpen(o => !o)}
      >
        <Search className="h-4 w-4 text-gray-500 shrink-0" />
        <span className="flex-1 text-sm truncate">
          {selected
            ? <span className="text-gray-200">{selected.store_name ?? selected.store_id}</span>
            : <span className="text-gray-600">Select a store to begin deep dive…</span>}
        </span>
        {selected && (
          <span className="shrink-0 text-[10px] text-gray-600 pr-1 tabular-nums">
            {selected.store_id}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border border-gray-700 bg-gray-900 shadow-2xl overflow-hidden">
          <div className="p-2 border-b border-gray-800">
            <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-gray-800">
              <Search className="h-3.5 w-3.5 text-gray-500 shrink-0" />
              <input
                ref={inputRef}
                className="flex-1 bg-transparent text-sm text-gray-200 placeholder:text-gray-600 outline-none"
                placeholder="Search by name, ID, or state…"
                value={query}
                onChange={e => setQuery(e.target.value)}
              />
            </div>
          </div>
          <div className="max-h-64 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-gray-600">No stores found</div>
            ) : (
              filtered.map(s => (
                <button
                  key={s.store_id}
                  type="button"
                  className={cn(
                    'w-full px-4 py-2.5 text-left flex items-center gap-3 hover:bg-gray-800 transition-colors',
                    s.store_id === selectedId && 'bg-blue-500/10',
                  )}
                  onClick={() => { onSelect(s.store_id); setOpen(false); setQuery('') }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-gray-200 font-medium truncate">
                      {s.store_name ?? s.store_id}
                    </div>
                    <div className="text-[11px] text-gray-500 flex gap-2 mt-0.5">
                      <span>{s.store_id}</span>
                      {s.state && <span>· {s.state}</span>}
                      {s.category && <span>· {s.category}</span>}
                    </div>
                  </div>
                  {s.store_id === selectedId && (
                    <span className="shrink-0 h-1.5 w-1.5 rounded-full bg-blue-400" />
                  )}
                </button>
              ))
            )}
          </div>
          <div className="px-4 py-1.5 border-t border-gray-800 text-[10px] text-gray-600">
            {filtered.length} of {stores.length} stores
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props { filters: FilterState }

export default function StoreDeepDive({ filters }: Props) {
  const { stores, months } = useDataContext()
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // Apply month-range filters
  const fm = useMemo(() => {
    let m = months
    if (filters.fromMonth) {
      const i = months.indexOf(filters.fromMonth)
      if (i >= 0) m = m.slice(i)
    }
    if (filters.toMonth) {
      const i = months.indexOf(filters.toMonth)
      if (i >= 0) m = m.slice(0, i + 1)
    }
    return m
  }, [months, filters])

  const selectedStore = useMemo(
    () => stores.find(s => s.store_id === selectedId) ?? null,
    [stores, selectedId],
  )

  // All heavy computation
  const derived = useMemo(() => {
    if (!selectedStore || fm.length === 0) return null

    const n = fm.length
    const half = Math.max(1, Math.floor(n / 2))
    const early  = fm.slice(0, half)
    const recent = n % 2 === 0 ? fm.slice(half) : fm.slice(half + 1)

    const revByMonth = fm.map(m => selectedStore.monthly_sales[m] ?? 0)
    const totalRev   = revByMonth.reduce((a, b) => a + b, 0)
    const avgMonthRev = totalRev / n

    // Rolling 3-month average
    const rolling = rollingAvg(revByMonth, 3)

    // High / low annotation indices
    let maxIdx = 0, minIdx = 0
    revByMonth.forEach((v, i) => {
      if (v > revByMonth[maxIdx]) maxIdx = i
      if (v < revByMonth[minIdx]) minIdx = i
    })

    // Health score
    const hs    = computeHealthScore(selectedStore, fm)
    const t     = tier(hs.total)
    const growth = growthPct(selectedStore, early, recent)
    const tag    = journeyTag(growth)

    // Peer data per month
    const storeState  = selectedStore.state ?? null
    const stateStores = storeState
      ? stores.filter(s => s.state === storeState && s.store_id !== selectedStore.store_id)
      : []
    const allOthers = stores.filter(s => s.store_id !== selectedStore.store_id)

    const peerData = fm.map(m => {
      const storeRev   = selectedStore.monthly_sales[m] ?? 0
      const stateAvg   = stateStores.length
        ? stateStores.reduce((s, st) => s + (st.monthly_sales[m] ?? 0), 0) / stateStores.length
        : null
      const nationalAvg = allOthers.length
        ? allOthers.reduce((s, st) => s + (st.monthly_sales[m] ?? 0), 0) / allOthers.length
        : null
      return { month: m, storeRev, stateAvg, nationalAvg }
    })

    // Month-by-month table
    const tableRows = fm.map((m, i) => {
      const rev   = selectedStore.monthly_sales[m] ?? 0
      const prev  = i > 0 ? (selectedStore.monthly_sales[fm[i - 1]] ?? 0) : null
      const vsPrev = prev === null || prev === 0 ? null : (rev - prev) / prev * 100
      const sa     = peerData[i].stateAvg
      const na     = peerData[i].nationalAvg
      const vsState = sa === null || sa === 0 ? null : (rev - sa) / sa * 100
      const vsNat   = na === null || na === 0 ? null : (rev - na) / na * 100
      const rank    = stores.map(s => s.monthly_sales[m] ?? 0).filter(r => r > rev).length + 1
      return { month: m, rev, vsPrev, vsState, vsNat, rank, total: stores.length }
    })

    // Insight narrative
    const recentSlice = revByMonth.slice(-3)
    const recentDir = recentSlice.length >= 2
      ? (recentSlice[recentSlice.length - 1] > recentSlice[0] ? 'risen' : 'fallen')
      : 'held steady'

    const latestPeer   = peerData[peerData.length - 1]
    const latestDelta  = latestPeer.stateAvg
      ? latestPeer.storeRev - latestPeer.stateAvg
      : null

    const peerCtx = latestDelta !== null && storeState
      ? latestDelta >= 0
        ? ` It sits ${fmtInr(Math.abs(latestDelta))} above the ${storeState} state average in the latest month.`
        : ` It is ${fmtInr(Math.abs(latestDelta))} below the ${storeState} state average in the latest month.`
      : ''

    const recommendationText = tag === 'Surging' || tag === 'Rising'
      ? `Replicate this store's playbook${storeState ? ` across the ${storeState} region` : ''}. Consider raising the monthly target to match the current growth trajectory${growth !== null ? ` (${fmtPct(growth)})` : ''}.`
      : tag === 'Stable'
        ? `Explore category-mix optimisation and localised promotions to push this store from stable into a growth trajectory.`
        : `Initiate a recovery programme. Review staffing levels, inventory freshness, and the local competitive landscape to diagnose the root cause of the ${growth !== null ? fmtPct(growth) : 'negative'} trend.`

    const insight = {
      summary:     `${selectedStore.store_name ?? selectedStore.store_id} generated ${fmtInr(totalRev)} over ${n} month${n !== 1 ? 's' : ''}, averaging ${fmtInr(avgMonthRev)}/month. Revenue has ${recentDir} in recent months.`,
      observation: `Peak revenue was ${fmtInr(revByMonth[maxIdx])} in ${fm[maxIdx]}; lowest was ${fmtInr(revByMonth[minIdx])} in ${fm[minIdx]}.${peerCtx} Overall health score is ${hs.total}/100 (${t}).`,
      recommendation: recommendationText,
    }

    return { revByMonth, rolling, maxIdx, minIdx, hs, t, growth, tag, totalRev, avgMonthRev, peerData, tableRows, insight }
  }, [selectedStore, stores, fm])

  // ── Empty state ───────────────────────────────────────────────────────────

  if (!selectedStore || !derived) {
    return (
      <div className="space-y-4">
        <StoreSelector stores={stores} selectedId={selectedId} onSelect={setSelectedId} />
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 min-h-[420px] flex flex-col items-center justify-center gap-4 p-8">
          <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-blue-500/15 to-cyan-400/15 flex items-center justify-center">
            <Building2 className="h-6 w-6 text-blue-400" />
          </div>
          <div className="text-center">
            <h3 className="text-lg font-semibold text-gray-100">Store Deep Dive</h3>
            <p className="mt-1 text-sm text-gray-500 max-w-xs">
              Select any store from the dropdown above to explore its full revenue history,
              health score, and peer comparison.
            </p>
          </div>
        </div>
      </div>
    )
  }

  const {
    revByMonth, rolling, maxIdx, minIdx,
    hs, t, growth, tag,
    totalRev, avgMonthRev,
    peerData, tableRows, insight,
  } = derived

  const healthColor  = HEALTH_HEX[t]
  const hasStateAvg  = peerData.some(d => d.stateAvg !== null)
  const hasNatAvg    = peerData.some(d => d.nationalAvg !== null)

  // Annotations for timeline chart
  const annotations: object[] = []
  if (fm.length > 0) {
    annotations.push({
      x: fm[maxIdx], y: revByMonth[maxIdx],
      text: `Peak: ${fmtInr(revByMonth[maxIdx])}`,
      showarrow: true, arrowhead: 2, arrowcolor: '#10b981',
      font: { color: '#10b981', size: 11 }, bgcolor: 'rgba(16,185,129,0.1)',
      bordercolor: '#10b981', borderwidth: 1, borderpad: 3, ax: 0, ay: -40,
    })
    if (maxIdx !== minIdx) {
      annotations.push({
        x: fm[minIdx], y: revByMonth[minIdx],
        text: `Low: ${fmtInr(revByMonth[minIdx])}`,
        showarrow: true, arrowhead: 2, arrowcolor: '#ef4444',
        font: { color: '#ef4444', size: 11 }, bgcolor: 'rgba(239,68,68,0.1)',
        bordercolor: '#ef4444', borderwidth: 1, borderpad: 3, ax: 0, ay: 40,
      })
    }
  }

  return (
    <div className="space-y-6">

      {/* ── Store Selector ── */}
      <StoreSelector stores={stores} selectedId={selectedId} onSelect={setSelectedId} />

      {/* ── Store Header ── */}
      <motion.div
        key={selectedId}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-xl border border-gray-800 bg-gray-900 p-5"
      >
        <div className="flex items-start gap-5 flex-wrap">
          <ScoreDonut score={hs.total} color={healthColor} size={110} />

          <div className="flex-1 min-w-0 space-y-3">
            {/* Name + badges */}
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-xl font-bold text-gray-100 truncate">
                  {selectedStore.store_name ?? selectedStore.store_id}
                </h2>
                <span className={cn('text-[11px] font-semibold px-2.5 py-0.5 rounded-full', JOURNEY_BADGE[tag])}>
                  {tag}
                </span>
                <span className={cn('text-[11px] font-semibold px-2.5 py-0.5 rounded-full', HEALTH_BADGE[t])}>
                  {t}
                </span>
              </div>
              <p className="text-xs text-gray-600 mt-0.5">{selectedStore.store_id}</p>
            </div>

            {/* Meta row */}
            <div className="flex flex-wrap gap-4">
              {selectedStore.state && (
                <div className="flex items-center gap-1.5 text-sm text-gray-400">
                  <MapPin className="h-3.5 w-3.5 text-gray-600 shrink-0" />
                  {selectedStore.state}
                </div>
              )}
              {selectedStore.category && (
                <div className="flex items-center gap-1.5 text-sm text-gray-400">
                  <Tag className="h-3.5 w-3.5 text-gray-600 shrink-0" />
                  {selectedStore.category}
                </div>
              )}
              <div className="flex items-center gap-1.5 text-sm text-gray-400">
                <Activity className="h-3.5 w-3.5 text-gray-600 shrink-0" />
                {fm.length} month window
              </div>
            </div>

            {/* KPI pills */}
            <div className="flex flex-wrap gap-3">
              <KPIPill label="Total Revenue" value={fmtInr(totalRev)} />
              <KPIPill label="Avg / Month"   value={fmtInr(avgMonthRev)} />
              {growth !== null && (
                <KPIPill
                  label="Growth"
                  value={fmtPct(growth)}
                  valueClass={growth >= 0 ? 'text-emerald-400' : 'text-red-400'}
                />
              )}
            </div>
          </div>
        </div>
      </motion.div>

      {/* ── Full Revenue Timeline ── */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="rounded-xl border border-gray-800 bg-gray-900 p-4"
      >
        <h3 className="mb-1 text-sm font-semibold text-gray-200">Full Revenue Timeline</h3>
        <p className="mb-3 text-[11px] text-gray-500">
          Bars = monthly revenue · Dotted line = 3-month rolling average ·
          <span className="text-emerald-500"> Green</span> = peak ·
          <span className="text-red-500"> Red</span> = lowest
        </p>
        <Plot
          data={[
            {
              type: 'bar',
              name: 'Monthly Revenue',
              x: fm,
              y: revByMonth,
              marker: {
                color: fm.map((_, i) =>
                  i === maxIdx ? '#10b981' : i === minIdx ? '#ef4444' : '#3b82f6'
                ),
                opacity: 0.82,
              },
              hovertemplate: '%{x}<br>Revenue: ₹%{y:,.0f}<extra></extra>',
            },
            {
              type: 'scatter',
              mode: 'lines+markers',
              name: '3M Rolling Avg',
              x: fm.filter((_, i) => rolling[i] !== null),
              y: rolling.filter((v): v is number => v !== null),
              line: { color: '#f59e0b', width: 2.5, dash: 'dot' as const },
              marker: { color: '#f59e0b', size: 5 },
              hovertemplate: '%{x}<br>3M Avg: ₹%{y:,.0f}<extra></extra>',
            },
          ]}
          layout={{
            paper_bgcolor: 'rgba(0,0,0,0)',
            plot_bgcolor:  'rgba(0,0,0,0)',
            font: { color: '#9ca3af', family: 'Inter, sans-serif', size: 11 },
            legend: { bgcolor: 'rgba(0,0,0,0)', font: { color: '#9ca3af', size: 10 }, orientation: 'h' as const, y: -0.18 },
            xaxis: { ...PLOTLY_AXES },
            yaxis: { ...PLOTLY_AXES, tickformat: ',.0f', title: { text: 'Revenue (₹)' } },
            hovermode: 'x unified' as const,
            margin: { l: 70, r: 20, t: 32, b: 90 },
            height: 320,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            annotations: annotations as any[],
          }}
          config={{ displayModeBar: false, responsive: true }}
          style={{ width: '100%' }}
        />
      </motion.div>

      {/* ── Health Score Breakdown ── */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="rounded-xl border border-gray-800 bg-gray-900 p-5"
      >
        <h3 className="mb-1 text-sm font-semibold text-gray-200">Health Score Breakdown</h3>
        <p className="mb-5 text-[11px] text-gray-500">
          Weighted composite: revenue trend (40 pts) + consistency (30 pts) + growth momentum (30 pts) = 100
        </p>
        <div className="flex items-start gap-8 flex-wrap">
          <div className="flex flex-col items-center gap-2.5">
            <ScoreDonut score={hs.total} color={healthColor} size={100} />
            <span className={cn('text-xs font-semibold px-2.5 py-0.5 rounded-full', HEALTH_BADGE[t])}>
              {t}
            </span>
          </div>
          <div className="flex-1 min-w-[240px] space-y-5">
            <ScoreDimBar
              label="Revenue Trend"
              value={hs.trend}
              max={40}
              color="#3b82f6"
              description="Recent-period avg vs early-period avg. Upward trend scores higher."
            />
            <ScoreDimBar
              label="Consistency"
              value={hs.consistency}
              max={30}
              color="#8b5cf6"
              description="Inverse of revenue volatility (CoV). Steady month-to-month performance = higher score."
            />
            <ScoreDimBar
              label="Growth Momentum"
              value={hs.momentum}
              max={30}
              color="#f59e0b"
              description="Month-over-month acceleration in the last 3 months. Positive MoM slope = higher score."
            />
          </div>
        </div>
      </motion.div>

      {/* ── Peer Comparison ── */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="rounded-xl border border-gray-800 bg-gray-900 p-4"
      >
        <h3 className="mb-1 text-sm font-semibold text-gray-200">Peer Comparison</h3>
        <p className="mb-3 text-[11px] text-gray-500">
          Monthly revenue: this store vs
          {hasStateAvg && selectedStore.state && ` ${selectedStore.state} average`}
          {hasStateAvg && hasNatAvg && ' &'}
          {hasNatAvg && ' national average'}
        </p>
        <Plot
          data={[
            {
              type: 'bar',
              name: selectedStore.store_name ?? selectedStore.store_id,
              x: fm,
              y: peerData.map(d => d.storeRev),
              marker: { color: '#3b82f6', opacity: 0.85 },
              hovertemplate: `<b>${selectedStore.store_name ?? selectedStore.store_id}</b><br>%{x}: ₹%{y:,.0f}<extra></extra>`,
            },
            ...(hasStateAvg ? [{
              type: 'bar' as const,
              name: `${selectedStore.state ?? 'State'} Avg`,
              x: fm,
              y: peerData.map(d => d.stateAvg ?? 0),
              marker: { color: '#8b5cf6', opacity: 0.70 },
              hovertemplate: `<b>${selectedStore.state ?? 'State'} Avg</b><br>%{x}: ₹%{y:,.0f}<extra></extra>`,
            }] : []),
            ...(hasNatAvg ? [{
              type: 'bar' as const,
              name: 'National Avg',
              x: fm,
              y: peerData.map(d => d.nationalAvg ?? 0),
              marker: { color: '#f59e0b', opacity: 0.65 },
              hovertemplate: `<b>National Avg</b><br>%{x}: ₹%{y:,.0f}<extra></extra>`,
            }] : []),
          ]}
          layout={{
            paper_bgcolor: 'rgba(0,0,0,0)',
            plot_bgcolor:  'rgba(0,0,0,0)',
            barmode: 'group' as const,
            font: { color: '#9ca3af', family: 'Inter, sans-serif', size: 11 },
            legend: { bgcolor: 'rgba(0,0,0,0)', font: { color: '#9ca3af', size: 10 }, orientation: 'h' as const, y: -0.18 },
            xaxis: { ...PLOTLY_AXES },
            yaxis: { ...PLOTLY_AXES, tickformat: ',.0f', title: { text: 'Revenue (₹)' } },
            hovermode: 'x unified' as const,
            margin: { l: 70, r: 20, t: 8, b: 90 },
            height: 320,
          }}
          config={{ displayModeBar: false, responsive: true }}
          style={{ width: '100%' }}
        />
      </motion.div>

      {/* ── Month-by-Month Table ── */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="rounded-xl border border-gray-800 bg-gray-900 overflow-hidden"
      >
        <div className="px-4 py-3 border-b border-gray-800">
          <h3 className="text-sm font-semibold text-gray-200">Month-by-Month Breakdown</h3>
          <p className="text-[11px] text-gray-500 mt-0.5">
            Revenue vs previous month, state avg, national avg, and store rank
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-800/40">
                <th className="px-3 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-gray-400">Month</th>
                <th className="px-3 py-2.5 text-right text-xs font-medium uppercase tracking-wider text-gray-400">Revenue</th>
                <th className="px-3 py-2.5 text-right text-xs font-medium uppercase tracking-wider text-gray-400">vs Prev Month</th>
                <th className="px-3 py-2.5 text-right text-xs font-medium uppercase tracking-wider text-gray-400">vs State Avg</th>
                <th className="px-3 py-2.5 text-right text-xs font-medium uppercase tracking-wider text-gray-400">vs National Avg</th>
                <th className="px-3 py-2.5 text-right text-xs font-medium uppercase tracking-wider text-gray-400">Rank</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map(row => (
                <tr key={row.month} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                  <td className="px-3 py-2.5 text-gray-300 font-medium whitespace-nowrap">{row.month}</td>
                  <td className="px-3 py-2.5 text-right text-gray-200 tabular-nums font-medium whitespace-nowrap">
                    {fmtInr(row.rev)}
                  </td>
                  <td className={cn(
                    'px-3 py-2.5 text-right tabular-nums text-xs whitespace-nowrap',
                    row.vsPrev === null ? 'text-gray-600' : row.vsPrev >= 0 ? 'text-emerald-400' : 'text-red-400',
                  )}>
                    {row.vsPrev === null ? '—' : (
                      <span className="flex items-center justify-end gap-0.5">
                        {row.vsPrev >= 0
                          ? <TrendingUp className="h-3 w-3" />
                          : <TrendingDown className="h-3 w-3" />}
                        {fmtPct(row.vsPrev)}
                      </span>
                    )}
                  </td>
                  <td className={cn(
                    'px-3 py-2.5 text-right tabular-nums text-xs whitespace-nowrap',
                    row.vsState === null ? 'text-gray-600' : row.vsState >= 0 ? 'text-emerald-400' : 'text-red-400',
                  )}>
                    {row.vsState === null ? '—' : fmtPct(row.vsState)}
                  </td>
                  <td className={cn(
                    'px-3 py-2.5 text-right tabular-nums text-xs whitespace-nowrap',
                    row.vsNat === null ? 'text-gray-600' : row.vsNat >= 0 ? 'text-emerald-400' : 'text-red-400',
                  )}>
                    {row.vsNat === null ? '—' : fmtPct(row.vsNat)}
                  </td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap">
                    <span className="text-xs tabular-nums">
                      <span className={cn(
                        'font-bold',
                        row.rank === 1 ? 'text-amber-400' :
                        row.rank <= 3 ? 'text-yellow-500' :
                        row.rank <= Math.ceil(row.total * 0.25) ? 'text-emerald-400' : 'text-gray-400',
                      )}>
                        #{row.rank}
                      </span>
                      <span className="text-gray-600"> / {row.total}</span>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </motion.div>

      {/* ── Insight Cards ── */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <InsightCard
          tag="Summary"
          tagCls="bg-blue-500/15 text-blue-400"
          title={selectedStore.store_name ?? selectedStore.store_id}
          body={insight.summary}
          delay={0.25}
        />
        <InsightCard
          tag="Key Observation"
          tagCls="bg-purple-500/15 text-purple-400"
          title="Performance Highlights"
          body={insight.observation}
          delay={0.3}
        />
        <InsightCard
          tag="Recommendation"
          tagCls="bg-emerald-500/15 text-emerald-400"
          title="Next Steps"
          body={insight.recommendation}
          delay={0.35}
        />
      </div>

    </div>
  )
}
