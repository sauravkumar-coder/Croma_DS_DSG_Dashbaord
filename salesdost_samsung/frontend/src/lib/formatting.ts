/**
 * Shared number-formatting helpers used across every dashboard tab.
 * Centralise here so all pages render amounts and percentages identically.
 */

import type { StoreRecord } from './api'

// ── Currency ──────────────────────────────────────────────────────────────────

/** Format ₹ with magnitude suffix: Cr / L / K. Negative gets minus before ₹. */
export function fmtInr(n: number): string {
  const abs  = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(2)}Cr`
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(2)}L`
  if (abs >= 1e3) return `${sign}₹${(abs / 1e3).toFixed(1)}K`
  return `${sign}₹${abs.toFixed(0)}`
}

/** 
 * Format ₹ specifically for chart axes (shorter, max 1 decimal). 
 * e.g., ₹1.2Cr, ₹45L, ₹8K 
 */
export function fmtInrAxis(n: number): string {
  const abs  = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (abs >= 1e7) return `${sign}₹${Number((abs / 1e7).toFixed(1))}Cr`
  if (abs >= 1e5) return `${sign}₹${Number((abs / 1e5).toFixed(1))}L`
  if (abs >= 1e3) return `${sign}₹${Number((abs / 1e3).toFixed(0))}K`
  return `${sign}₹${abs.toFixed(0)}`
}

/** 
 * Generate Plotly tickvals and ticktext for a given max value using INR units.
 */
export function plotlyInrTickVals(maxVal: number, count = 5): { tickvals: number[], ticktext: string[] } {
  // Simple step calculation
  const roughStep = maxVal / count
  const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)))
  let step = Math.ceil(roughStep / magnitude) * magnitude
  
  // Make the step a "nice" number if possible (1, 2, 5, 10...)
  const normalizedStep = step / magnitude
  if (normalizedStep > 5) step = 10 * magnitude
  else if (normalizedStep > 2) step = 5 * magnitude
  else if (normalizedStep > 1) step = 2 * magnitude

  const tickvals: number[] = []
  const ticktext: string[] = []
  
  for (let i = 0; i <= Math.ceil(maxVal / step); i++) {
    const val = i * step
    tickvals.push(val)
    ticktext.push(fmtInrAxis(val))
  }
  
  return { tickvals, ticktext }
}

/** 
 * Generate Plotly tickvals and ticktext for a log scale using INR units.
 */
export function plotlyInrLogTickVals(maxVal: number): { tickvals: number[], ticktext: string[] } {
  const tickvals: number[] = []
  const ticktext: string[] = []
  
  let current = 1e4 // Start at 10K
  while (current <= maxVal * 10) {
    tickvals.push(current)
    ticktext.push(fmtInrAxis(current))
    // Also add intermediate ticks like 20K, 50K for better log grid
    if (current * 2 <= maxVal * 10) { tickvals.push(current * 2); ticktext.push(fmtInrAxis(current * 2)) }
    if (current * 5 <= maxVal * 10) { tickvals.push(current * 5); ticktext.push(fmtInrAxis(current * 5)) }
    current *= 10
  }
  
  return { tickvals, ticktext }
}

/** Format ₹ using full Indian comma notation: ₹2,98,450. */
export function fmtInrFull(n: number): string {
  const abs  = Math.round(Math.abs(n))
  const sign = n < 0 ? '-' : ''
  const s    = abs.toString()
  if (s.length <= 3) return `${sign}₹${s}`
  const last3 = s.slice(-3)
  const rest  = s.slice(0, -3)
  const groups: string[] = []
  for (let i = rest.length; i > 0; i -= 2) {
    groups.unshift(rest.slice(Math.max(0, i - 2), i))
  }
  return `${sign}₹${groups.join(',')},${last3}`
}

// ── Percentage ────────────────────────────────────────────────────────────────

/** Format a signed percentage: +12.3%, -5.7%. */
export function fmtPct(n: number, decimals = 1): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(decimals)}%`
}

// ── Count / plans ─────────────────────────────────────────────────────────────

/** Format a large integer count with K / L suffix (e.g. plan counts). */
export function fmtCount(n: number): string {
  if (n >= 1e5) return `${(n / 1e5).toFixed(1)}L`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return n.toLocaleString('en-IN')
}

// ── Month labels ──────────────────────────────────────────────────────────────

/** Shorten "Jan-2024" → "Jan'24" for use in tight chart labels. */
export function monthAbbr(m: string): string {
  return m.replace(/-20(\d{2})$/, "'$1")
}

// ── Store identification ──────────────────────────────────────────────────────

/**
 * Full store label: "Store Name (STORE_ID)".
 * Falls back to just the ID when store_name is absent.
 * Use everywhere a store identity must be unambiguous.
 */
export function fmtStore(store: Pick<StoreRecord, 'store_id' | 'store_name'>): string {
  if (store.store_name) return `${store.store_name} (${store.store_id})`
  return store.store_id
}

/**
 * Compact store label for chart axes / tight spaces.
 * Truncates the name to maxNameLen chars before appending the ID.
 */
export function fmtStoreShort(
  store: Pick<StoreRecord, 'store_id' | 'store_name'>,
  maxNameLen = 18,
): string {
  if (!store.store_name) return store.store_id
  const name = store.store_name.length > maxNameLen
    ? `${store.store_name.slice(0, maxNameLen)}…`
    : store.store_name
  return `${name} (${store.store_id})`
}
