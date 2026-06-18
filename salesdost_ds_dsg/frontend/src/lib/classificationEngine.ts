import type { StoreRecord } from './api'
import { CLASSIFICATION_CONFIG as C } from './classificationConfig'

// ── Public types ──────────────────────────────────────────────────────────────

export type StoreCategory =
  | 'New Bloomer'
  | 'Rising Star'
  | 'Growing Store'
  | 'Constant Store'
  | 'Declining Store'
  | 'Fallen Star'
  | 'Inactive Store'

// Display order — emergence → positive trajectory → stable → negative trajectory → terminal
export const CATEGORY_ORDER: StoreCategory[] = [
  'New Bloomer',
  'Rising Star',
  'Growing Store',
  'Constant Store',
  'Declining Store',
  'Fallen Star',
  'Inactive Store',
]

export interface PhaseInfo {
  earlyMonths:  string[]
  midMonths:    string[]
  recentMonths: string[]
}

// All revenue/policy fields are CUMULATIVE TOTALS (sum over the phase's months).
// In this dashboard, monthly_sales represents policies sold; totals serve as both
// the revenue and policies-sold metric for classification purposes.
export interface StoreMetrics {
  store:          StoreRecord
  earlyTotal:     number        // policies sold during early phase
  midTotal:       number        // policies sold during mid phase
  recentTotal:    number        // policies sold during recent phase
  totalRevenue:   number        // total policies sold across all months
  growthPct:      number | null // (recentTotal - earlyTotal) / earlyTotal × 100
  momentumPct:    number | null // (recentTotal - midTotal)   / midTotal   × 100
  trendScore:     number        // normalised linear slope (positive = upward)
  stabilityScore: number        // CoV as % — lower is more stable
  category:       StoreCategory
  earlyRank:      number        // 1 = highest earlyTotal in scope
  recentRank:     number        // 1 = highest recentTotal in scope
  overallRank:    number        // 1 = highest totalRevenue in scope
}

export interface ClassificationResult {
  phases:              PhaseInfo
  metrics:             StoreMetrics[]
  counts:              Record<StoreCategory, number>
  medianEarlyRevenue:  number   // median earlyTotal across all stores — used for Fallen Star check
  medianRecentRevenue: number   // median recentTotal across all stores — used for Rising Star check
  isValid:             boolean  // true when sum(counts) === stores.length
}

// ── Phase allocation ──────────────────────────────────────────────────────────
//
// Divides months into three equal phases, distributing any remainder:
//   remainder 0 → Early = base, Mid = base, Recent = base
//   remainder 1 → Recent += 1
//   remainder 2 → Early += 1, Recent += 1

export function allocatePhases(months: string[]): PhaseInfo {
  const total = months.length
  if (total === 0) return { earlyMonths: [], midMonths: [], recentMonths: [] }

  const base      = Math.floor(total / 3)
  const remainder = total % 3

  let earlyCount  = base
  const midCount  = base
  let recentCount = base

  if (remainder === 1) {
    recentCount += 1
  } else if (remainder === 2) {
    earlyCount  += 1
    recentCount += 1
  }

  return {
    earlyMonths:  months.slice(0, earlyCount),
    midMonths:    months.slice(earlyCount, earlyCount + midCount),
    recentMonths: months.slice(earlyCount + midCount),
  }
}

// ── Internal metric helpers ───────────────────────────────────────────────────

function phaseTotal(store: StoreRecord, phaseMonths: string[]): number {
  return phaseMonths.reduce((s, m) => s + (store.monthly_sales[m] ?? 0), 0)
}

function medianOf(sorted: number[]): number {
  if (!sorted.length) return 0
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2
}

function computeTrendScore(store: StoreRecord, months: string[]): number {
  const n = months.length
  if (n < 2) return 0
  const y    = months.map(m => store.monthly_sales[m] ?? 0)
  const x    = Array.from({ length: n }, (_, i) => i + 1)
  const sumX = x.reduce((a, b) => a + b, 0)
  const sumY = y.reduce((a, b) => a + b, 0)
  const sumXY = x.reduce((s, xi, i) => s + xi * y[i], 0)
  const sumX2 = x.reduce((s, xi) => s + xi * xi, 0)
  const denom = n * sumX2 - sumX * sumX
  if (denom === 0) return 0
  const slope = (n * sumXY - sumX * sumY) / denom
  const mean  = sumY / n
  return mean === 0 ? 0 : (slope / mean) * 100
}

function computeStabilityScore(store: StoreRecord, months: string[]): number {
  const n = months.length
  if (n < 2) return 0
  const vals = months.map(m => store.monthly_sales[m] ?? 0)
  const mean = vals.reduce((a, b) => a + b, 0) / n
  if (mean === 0) return 100
  const variance = vals.reduce((s, v) => s + (v - mean) ** 2, 0) / n
  return (Math.sqrt(variance) / mean) * 100
}

// ── Classification rules — single source of truth ────────────────────────────
//
// Priority order (evaluated in sequence; first match wins):
//   1. New Bloomer    — store just entering the market; negligible early activity
//   2. Fallen Star    — established store with strict monotone decline ≥ 30% + above median
//   3. Rising Star    — established store with strict monotone growth ≥ 30% + above median
//   4. Declining Store — weakening (not severe enough for Fallen Star)
//   5. Growing Store   — improving (not strong enough for Rising Star)
//   6. Constant Store  — all remaining stores (stable or no strong trend)

function classifyStore(
  earlyTotal:          number,
  midTotal:            number,
  recentTotal:         number,
  growthPct:           number | null,
  medianEarlyRevenue:  number,
  medianRecentRevenue: number,
): StoreCategory {
  // 1. New Bloomer — essentially inactive early, now contributing
  if (
    earlyTotal <= C.NEW_BLOOMER_EARLY_CEILING &&
    (earlyTotal === 0 || earlyTotal <= recentTotal * C.NEW_BLOOMER_REVENUE_RATIO) &&
    recentTotal > earlyTotal &&
    recentTotal > 0
  ) return 'New Bloomer'

  // 2. Inactive Store — no revenue in both mid and recent phases
  if (midTotal === 0 && recentTotal === 0) return 'Inactive Store'

  // 3. Fallen Star — strict monotone revenue decline from an established base
  if (
    earlyTotal > midTotal && midTotal > recentTotal &&
    growthPct !== null && growthPct <= -C.FALLEN_STAR_DECLINE &&
    earlyTotal > medianEarlyRevenue
  ) return 'Fallen Star'

  // 4. Rising Star — strict monotone revenue growth, commercially significant now
  if (
    earlyTotal < midTotal && midTotal < recentTotal &&
    growthPct !== null && growthPct >= C.RISING_STAR_GROWTH &&
    recentTotal > medianRecentRevenue
  ) return 'Rising Star'

  // 5. Declining Store — weakening store; not severe or structured enough for Fallen Star
  if (
    growthPct !== null &&
    recentTotal < earlyTotal &&
    (earlyTotal - recentTotal) / earlyTotal * 100 >= C.DECLINING_THRESHOLD
  ) return 'Declining Store'

  // 6. Growing Store — improving store; not structured or large enough for Rising Star
  if (
    growthPct !== null &&
    recentTotal > earlyTotal &&
    growthPct >= C.GROWING_THRESHOLD
  ) return 'Growing Store'

  // 7. Constant Store — stable, low-volume, or no strong directional trend
  return 'Constant Store'
}

// ── Main engine entry point ───────────────────────────────────────────────────

export function classifyAllStores(
  stores: StoreRecord[],
  months: string[],
): ClassificationResult {
  const phases = allocatePhases(months)
  const { earlyMonths, midMonths, recentMonths } = phases

  const raw = stores.map(store => {
    const earlyTotal   = phaseTotal(store, earlyMonths)
    const midTotal     = phaseTotal(store, midMonths)
    const recentTotal  = phaseTotal(store, recentMonths)
    const totalRevenue = phaseTotal(store, months)
    const growthPct    = earlyTotal > 0 ? (recentTotal - earlyTotal) / earlyTotal * 100 : null
    const momentumPct  = midTotal   > 0 ? (recentTotal - midTotal)   / midTotal   * 100 : null
    const trend        = computeTrendScore(store, months)
    const stability    = computeStabilityScore(store, months)
    return { store, earlyTotal, midTotal, recentTotal, totalRevenue, growthPct, momentumPct, trend, stability }
  })

  // Medians used for Rising Star / Fallen Star significance checks
  const medianEarlyRevenue  = medianOf([...raw].map(r => r.earlyTotal).sort((a, b) => a - b))
  const medianRecentRevenue = medianOf([...raw].map(r => r.recentTotal).sort((a, b) => a - b))

  const byEarly  = [...raw].sort((a, b) => b.earlyTotal   - a.earlyTotal)
  const byRecent = [...raw].sort((a, b) => b.recentTotal  - a.recentTotal)
  const byTotal  = [...raw].sort((a, b) => b.totalRevenue - a.totalRevenue)

  const earlyRankMap   = new Map(byEarly.map((r, i)  => [r.store.store_id, i + 1]))
  const recentRankMap  = new Map(byRecent.map((r, i) => [r.store.store_id, i + 1]))
  const overallRankMap = new Map(byTotal.map((r, i)  => [r.store.store_id, i + 1]))

  const metrics: StoreMetrics[] = raw.map(r => ({
    store:          r.store,
    earlyTotal:     r.earlyTotal,
    midTotal:       r.midTotal,
    recentTotal:    r.recentTotal,
    totalRevenue:   r.totalRevenue,
    growthPct:      r.growthPct,
    momentumPct:    r.momentumPct,
    trendScore:     r.trend,
    stabilityScore: r.stability,
    category:       classifyStore(
      r.earlyTotal, r.midTotal, r.recentTotal, r.growthPct,
      medianEarlyRevenue, medianRecentRevenue,
    ),
    earlyRank:      earlyRankMap.get(r.store.store_id)  ?? 0,
    recentRank:     recentRankMap.get(r.store.store_id) ?? 0,
    overallRank:    overallRankMap.get(r.store.store_id) ?? 0,
  }))

  const counts = Object.fromEntries(
    CATEGORY_ORDER.map(c => [c, 0])
  ) as Record<StoreCategory, number>
  for (const m of metrics) counts[m.category]++

  // Validate: every store must land in exactly one category
  const totalCategorized = Object.values(counts).reduce((s, c) => s + c, 0)
  const isValid = totalCategorized === stores.length
  if (!isValid) {
    console.error(
      `[ClassificationEngine] Validation FAILED: ${totalCategorized} categorized vs ${stores.length} stores`,
      counts,
    )
  }

  return { phases, metrics, counts, medianEarlyRevenue, medianRecentRevenue, isValid }
}
