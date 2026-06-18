import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Activity, AlertTriangle, ArrowLeft, BarChart2, ChevronDown, ChevronUp,
  Crosshair, Download, FileSpreadsheet, Loader2,
  RefreshCw, Search, Settings, Target, TrendingDown, TrendingUp, Trophy,
  UploadCloud, X, XCircle, Zap,
} from 'lucide-react'
// eslint-disable-next-line @typescript-eslint/no-require-imports
import createPlotlyComponent from 'react-plotly.js/factory'
// @ts-ignore
import Plotly from 'plotly.js-dist-min'
import * as XLSX from 'xlsx'
import { Link } from 'react-router-dom'
import { cn } from '@/lib/utils'
import {
  getTrackerStatus, getTrackerData, uploadTrackerSales,
  type TrackerStatus, type TrackerData,
} from '@/lib/api'
import TargetManagementDrawer from '@/components/tabs/TargetManagementDrawer'

const Plot = createPlotlyComponent(Plotly)

// ─────────────────────────────────────────────────────────────────────────────
// Design tokens
// ─────────────────────────────────────────────────────────────────────────────

const C = {
  bg:        '#f8fafc',
  surface:   '#ffffff',
  surfaceHi: '#f8fafc',
  border:    '#e2e8f0',
  borderHi:  '#cbd5e1',
  text:      '#0f172a',
  muted:     '#475569',
  dim:       '#94a3b8',
  blue:      '#2563eb',
  emerald:   '#059669',
  emeraldDk: '#047857',
  amber:     '#d97706',
  amberDk:   '#b45309',
  crimson:   '#dc2626',
  crimsonDk: '#b91c1c',
  violet:    '#7c3aed',
}

const PLOTLY_BASE = {
  paper_bgcolor: 'rgba(0,0,0,0)',
  plot_bgcolor:  'rgba(0,0,0,0)',
  font: { color: '#64748b', family: 'Inter,sans-serif', size: 11 },
}
const PLOTLY_AXIS = {
  gridcolor: '#e2e8f0',
  linecolor: '#e2e8f0',
  tickcolor: '#e2e8f0',
  tickfont:  { color: '#94a3b8' },
  automargin: true,
  zeroline: false,
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface StoreRow {
  storeName:             string
  monthlyTarget:         number
  currentSales:          number
  dailyTarget:           number
  elapsedDays:           number
  expectedSalesTillDate: number
  runRateAchPct:         number
  monthlyAchPct:         number
  remainingTarget:       number
  projectedMonthEnd:     number
  projectedAchPct:       number
}

type ChartFilter = 'all' | 'top' | 'bottom'
type SortKey  = keyof StoreRow
type SortDir  = 'asc' | 'desc'
type InitStatus = 'loading' | 'ready' | 'needs_upload'
type SalesPhase =
  | { kind: 'idle' }
  | { kind: 'uploading'; progress: number }
  | { kind: 'done'; month: string; storeCount: number }
  | { kind: 'error'; message: string }

// ─────────────────────────────────────────────────────────────────────────────
// Business logic
// ─────────────────────────────────────────────────────────────────────────────

function buildRows(
  targetMap: Map<string, number>,
  salesMap:  Map<string, number>,
  elapsed:   number,
): StoreRow[] {
  return [...targetMap.entries()].map(([storeName, monthlyTarget]) => {
    const currentSales          = salesMap.get(storeName) ?? 0
    const dailyTarget           = monthlyTarget / 30
    const expectedSalesTillDate = dailyTarget * elapsed
    const runRateAchPct         = expectedSalesTillDate > 0 ? (currentSales / expectedSalesTillDate) * 100 : 0
    const monthlyAchPct         = monthlyTarget > 0 ? (currentSales / monthlyTarget) * 100 : 0
    const remainingTarget       = Math.max(0, monthlyTarget - currentSales)
    const projectedMonthEnd     = elapsed > 0 ? (currentSales / elapsed) * 30 : 0
    const projectedAchPct       = monthlyTarget > 0 ? (projectedMonthEnd / monthlyTarget) * 100 : 0
    return {
      storeName, monthlyTarget, currentSales, dailyTarget, elapsedDays: elapsed,
      expectedSalesTillDate, runRateAchPct, monthlyAchPct, remainingTarget,
      projectedMonthEnd, projectedAchPct,
    }
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Formatters
// ─────────────────────────────────────────────────────────────────────────────

function fmtInr(n: number): string {
  const abs = Math.abs(n), s = n < 0 ? '-' : ''
  if (abs >= 1e7) return `${s}₹${(abs / 1e7).toFixed(2)}Cr`
  if (abs >= 1e5) return `${s}₹${(abs / 1e5).toFixed(2)}L`
  if (abs >= 1e3) return `${s}₹${(abs / 1e3).toFixed(1)}K`
  return `${s}₹${abs.toFixed(0)}`
}
const fmtPct = (n: number) => `${n.toFixed(1)}%`

// ─────────────────────────────────────────────────────────────────────────────
// Color helpers
// ─────────────────────────────────────────────────────────────────────────────

function rrColorSet(pct: number) {
  if (pct >= 110) return { fill: `linear-gradient(90deg,${C.emeraldDk},${C.emerald})`, glow: C.emerald, text: C.emerald, label: 'LEADING' }
  if (pct >= 100) return { fill: `linear-gradient(90deg,${C.emeraldDk},#34d399)`,       glow: '#34d399', text: '#34d399', label: 'ON PACE' }
  if (pct >= 90)  return { fill: `linear-gradient(90deg,${C.amberDk},${C.amber})`,       glow: C.amber,   text: C.amber,   label: 'CLOSE'   }
  return              { fill: `linear-gradient(90deg,${C.crimsonDk},${C.crimson})`,      glow: C.crimson, text: C.crimson, label: 'BEHIND'  }
}

function maColorSet(pct: number) {
  if (pct >= 100) return { fill: `linear-gradient(90deg,${C.emeraldDk},${C.emerald})`, text: C.emerald }
  if (pct >= 75)  return { fill: `linear-gradient(90deg,#1d4ed8,${C.blue})`,            text: C.blue    }
  if (pct >= 50)  return { fill: `linear-gradient(90deg,${C.amberDk},${C.amber})`,      text: C.amber   }
  return              { fill: `linear-gradient(90deg,${C.crimsonDk},${C.crimson})`,     text: C.crimson }
}

function projColor(pct: number): string {
  if (pct >= 100) return C.emerald
  if (pct >= 90)  return C.amber
  return C.crimson
}

const QUADRANT_COLORS: Record<string, string> = {
  'Target Achievers': C.emerald,
  'Fast Movers':      C.blue,
  'At Risk':          C.amber,
  'Critical Stores':  C.crimson,
}

// ─────────────────────────────────────────────────────────────────────────────
// Chart 1: Target Pace Leaderboard
// ─────────────────────────────────────────────────────────────────────────────

const MAX_PCT = 135

function PaceRow({ row, rank, delay }: { row: StoreRow; rank: number; delay: number }) {
  const actualPct   = Math.min(MAX_PCT, (row.currentSales / row.monthlyTarget) * 100)
  const expectedPct = Math.min(MAX_PCT, (row.expectedSalesTillDate / row.monthlyTarget) * 100)
  const cs          = rrColorSet(row.runRateAchPct)
  return (
    <div className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-slate-50 transition-colors group">
      <span className="text-[11px] tabular-nums font-bold w-5 text-center shrink-0" style={{ color: C.dim }}>{rank}</span>
      <span className="text-[11px] w-40 truncate shrink-0" style={{ color: C.muted }} title={row.storeName}>{row.storeName}</span>
      <div className="flex-1 relative h-5 rounded overflow-visible">
        <div className="absolute inset-0 rounded" style={{ backgroundColor: '#f1f5f9' }} />
        {[25, 50, 75].map(m => (
          <div key={m} className="absolute top-0 bottom-0 w-px z-10"
            style={{ left: `${(m / MAX_PCT) * 100}%`, backgroundColor: '#e2e8f0' }} />
        ))}
        <div className="absolute top-[-3px] bottom-[-3px] w-0.5 z-20"
          style={{ left: `${(100 / MAX_PCT) * 100}%`, backgroundColor: 'rgba(71,85,105,0.4)' }} />
        <motion.div className="absolute left-0 top-0.5 bottom-0.5 rounded z-5"
          initial={{ width: 0 }} animate={{ width: `${(actualPct / MAX_PCT) * 100}%` }}
          transition={{ duration: 0.4, ease: 'easeOut', delay }} style={{ background: cs.fill }} />
        {expectedPct > 0 && (
          <div className="absolute top-1/2 z-30 w-2.5 h-2.5 rotate-45"
            style={{ left: `${(expectedPct / MAX_PCT) * 100}%`,
              transform: 'translateX(-50%) translateY(-50%) rotate(45deg)',
              backgroundColor: '#94a3b8', boxShadow: '0 0 4px rgba(148,163,184,0.4)' }} />
        )}
        <motion.div className="absolute top-1/2 z-40 w-3.5 h-3.5 rounded-full"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: delay + 0.35 }}
          style={{ left: `${(actualPct / MAX_PCT) * 100}%`,
            transform: 'translateX(-50%) translateY(-50%)',
            backgroundColor: cs.glow, boxShadow: `0 0 8px ${cs.glow}90, 0 0 16px ${cs.glow}40`,
            border: `2px solid ${cs.glow}50` }} />
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <span className="text-[10px] font-bold tracking-wider px-1.5 py-0.5 rounded"
          style={{ color: cs.label === 'LEADING' || cs.label === 'ON PACE' ? C.emerald : cs.label === 'CLOSE' ? C.amber : C.crimson,
                   backgroundColor: cs.label === 'LEADING' || cs.label === 'ON PACE' ? 'rgba(16,185,129,0.1)' : cs.label === 'CLOSE' ? 'rgba(245,158,11,0.1)' : 'rgba(220,38,38,0.1)' }}>
          {cs.label}
        </span>
        <span className="text-xs font-bold tabular-nums w-14 text-right" style={{ color: cs.text }}>
          {fmtPct(row.runRateAchPct)}
        </span>
      </div>
    </div>
  )
}

function FilterToggle({ value, onChange }: { value: ChartFilter; onChange: (f: ChartFilter) => void }) {
  return (
    <div className="flex items-center rounded-lg p-0.5" style={{ backgroundColor: '#f1f5f9', border: `1px solid ${C.border}` }}>
      {(['top', 'bottom', 'all'] as ChartFilter[]).map(f => (
        <button key={f} onClick={() => onChange(f)}
          className="h-7 px-3 rounded-md text-xs font-medium transition-all duration-150"
          style={value === f
            ? { backgroundColor: C.blue, color: '#fff', boxShadow: `0 2px 8px ${C.blue}40` }
            : { color: C.muted }}>
          {f === 'top' ? 'Top 15' : f === 'bottom' ? 'Bottom 15' : 'All'}
        </button>
      ))}
    </div>
  )
}

function PaceLeaderboard({ rows, filter, onFilter }: { rows: StoreRow[]; filter: ChartFilter; onFilter: (f: ChartFilter) => void }) {
  const sorted  = useMemo(() => [...rows].sort((a, b) => b.runRateAchPct - a.runRateAchPct), [rows])
  const visible = filter === 'top' ? sorted.slice(0, 15) : filter === 'bottom' ? sorted.slice(-15).reverse() : sorted
  return (
    <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.surface, borderColor: C.border }}>
      <div className="px-5 py-4 border-b flex items-center justify-between gap-3 flex-wrap" style={{ borderColor: C.border }}>
        <div>
          <p className="text-sm font-bold" style={{ color: C.text }}>Target Pace Leaderboard</p>
          <p className="text-xs mt-0.5" style={{ color: C.muted }}>
            ◆ = Expected by Day {rows[0]?.elapsedDays ?? '–'} · ● = Actual · Track = 0–135% of monthly target
          </p>
        </div>
        <FilterToggle value={filter} onChange={onFilter} />
      </div>
      <div className="px-5 py-2 border-b flex flex-wrap gap-4" style={{ borderColor: C.border, backgroundColor: '#f8fafc' }}>
        {[{ label: '>110% — Leading', color: C.emeraldDk },{ label: '100–110% — On Pace', color: C.emerald },
          { label: '90–99% — Close', color: C.amber },{ label: '<90% — Behind', color: C.crimson }].map(l => (
          <div key={l.label} className="flex items-center gap-1.5">
            <span className="h-2 w-4 rounded-sm shrink-0" style={{ backgroundColor: l.color }} />
            <span className="text-[10px]" style={{ color: C.dim }}>{l.label}</span>
          </div>
        ))}
      </div>
      <div className="px-3 py-2 max-h-[500px] overflow-y-auto space-y-0.5">
        {visible.map((r, i) => <PaceRow key={r.storeName} row={r} rank={i + 1} delay={i * 0.018} />)}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Chart 2: Target Achievement Thermometer
// ─────────────────────────────────────────────────────────────────────────────

const THERM_MAX = 125

function ThermRow({ row, rank, delay }: { row: StoreRow; rank: number; delay: number }) {
  const fillPct = Math.min(THERM_MAX, row.monthlyAchPct)
  const cs      = maColorSet(row.monthlyAchPct)
  return (
    <div className="flex items-center gap-3 px-2 py-2.5 rounded-lg hover:bg-slate-50 transition-colors">
      <span className="text-[11px] tabular-nums font-bold w-5 text-center shrink-0" style={{ color: C.dim }}>{rank}</span>
      <span className="text-[11px] w-40 truncate shrink-0" style={{ color: C.muted }} title={row.storeName}>{row.storeName}</span>
      <div className="flex-1 relative h-4 rounded overflow-hidden">
        <div className="absolute inset-0 rounded" style={{ backgroundColor: '#f1f5f9' }} />
        <div className="absolute inset-0 flex">
          <div style={{ width: `${(25/THERM_MAX)*100}%`, background: 'rgba(220,38,38,0.07)' }} />
          <div style={{ width: `${(25/THERM_MAX)*100}%`, background: 'rgba(217,119,6,0.07)' }} />
          <div style={{ width: `${(25/THERM_MAX)*100}%`, background: 'rgba(37,99,235,0.07)' }} />
          <div style={{ width: `${(25/THERM_MAX)*100}%`, background: 'rgba(5,150,105,0.07)' }} />
          <div style={{ flex: 1, background: 'rgba(5,150,105,0.04)' }} />
        </div>
        {[25, 50, 75, 100].map(m => (
          <div key={m} className="absolute top-0 bottom-0 w-px z-10"
            style={{ left: `${(m/THERM_MAX)*100}%`, backgroundColor: '#cbd5e1' }} />
        ))}
        <div className="absolute top-[-2px] bottom-[-2px] w-0.5 z-20"
          style={{ left: `${(100/THERM_MAX)*100}%`, backgroundColor: 'rgba(71,85,105,0.5)' }} />
        <motion.div className="absolute left-0 top-0 bottom-0 z-5 rounded"
          initial={{ width: 0 }} animate={{ width: `${(fillPct/THERM_MAX)*100}%` }}
          transition={{ duration: 0.4, ease: 'easeOut', delay }} style={{ background: cs.fill }} />
        {[25, 50, 75, 100].map(m => (
          <span key={m} className="absolute top-1/2 text-[8px] z-30 pointer-events-none select-none"
            style={{ left: `${(m/THERM_MAX)*100}%`, transform: 'translateX(-50%) translateY(-50%)', color: 'rgba(255,255,255,0.65)' }}>
            {m}%
          </span>
        ))}
      </div>
      <span className="text-xs font-bold tabular-nums w-14 text-right shrink-0" style={{ color: cs.text }}>{fmtPct(row.monthlyAchPct)}</span>
      <span className="text-[10px] w-20 text-right shrink-0 tabular-nums"
        style={{ color: row.remainingTarget <= 0 ? C.emerald : C.dim }}>
        {row.remainingTarget <= 0 ? '✓ HIT' : `-${fmtInr(row.remainingTarget)}`}
      </span>
    </div>
  )
}

function ThermometerChart({ rows, filter, onFilter }: { rows: StoreRow[]; filter: ChartFilter; onFilter: (f: ChartFilter) => void }) {
  const sorted  = useMemo(() => [...rows].sort((a, b) => b.monthlyAchPct - a.monthlyAchPct), [rows])
  const visible = filter === 'top' ? sorted.slice(0, 15) : filter === 'bottom' ? sorted.slice(-15).reverse() : sorted
  return (
    <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.surface, borderColor: C.border }}>
      <div className="px-5 py-4 border-b flex items-center justify-between gap-3 flex-wrap" style={{ borderColor: C.border }}>
        <div>
          <p className="text-sm font-bold" style={{ color: C.text }}>Monthly Achievement Thermometer</p>
          <p className="text-xs mt-0.5" style={{ color: C.muted }}>Milestone marks at 25 · 50 · 75 · 100% · White line = target</p>
        </div>
        <FilterToggle value={filter} onChange={onFilter} />
      </div>
      <div className="px-4 py-2 border-b flex flex-wrap gap-4" style={{ borderColor: C.border, backgroundColor: '#f8fafc' }}>
        {[{ label: '100%+ — Hit', color: C.emerald },{ label: '75–100% — Close', color: C.blue },
          { label: '50–75% — Mid', color: C.amber },{ label: '<50% — Low', color: C.crimson }].map(l => (
          <div key={l.label} className="flex items-center gap-1.5">
            <span className="h-2 w-4 rounded-sm shrink-0" style={{ backgroundColor: l.color }} />
            <span className="text-[10px]" style={{ color: C.dim }}>{l.label}</span>
          </div>
        ))}
      </div>
      <div className="px-3 py-2 max-h-[500px] overflow-y-auto space-y-0.5">
        {visible.map((r, i) => <ThermRow key={r.storeName} row={r} rank={i + 1} delay={i * 0.018} />)}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Chart 3: Target Risk Matrix
// ─────────────────────────────────────────────────────────────────────────────

function RiskMatrix({ rows, elapsed }: { rows: StoreRow[]; elapsed: number }) {
  const midX = (elapsed / 30) * 100
  const minS = Math.max(1, Math.min(...rows.map(r => r.currentSales)))
  const maxS = Math.max(1, Math.max(...rows.map(r => r.currentSales)))
  const sz   = (s: number) => 8 + ((Math.log(Math.max(1, s)) - Math.log(minS)) / (Math.log(maxS) - Math.log(minS) || 1)) * 30
  const maxX = Math.max(130, ...rows.map(r => r.monthlyAchPct + 5))
  const maxY = Math.max(180, ...rows.map(r => r.runRateAchPct + 10))
  const byQuadrant = {
    'Target Achievers': rows.filter(r => r.monthlyAchPct >= midX && r.runRateAchPct >= 100),
    'Fast Movers':      rows.filter(r => r.monthlyAchPct <  midX && r.runRateAchPct >= 100),
    'At Risk':          rows.filter(r => r.monthlyAchPct >= midX && r.runRateAchPct <  100),
    'Critical Stores':  rows.filter(r => r.monthlyAchPct <  midX && r.runRateAchPct <  100),
  }
  const traces = Object.entries(byQuadrant).map(([name, data]) => ({
    type: 'scatter' as const, mode: 'markers' as const,
    name: `${name} (${data.length})`,
    x: data.map(r => r.monthlyAchPct), y: data.map(r => r.runRateAchPct),
    marker: { size: data.map(r => sz(r.currentSales)), color: QUADRANT_COLORS[name], opacity: 0.8,
              line: { color: `${QUADRANT_COLORS[name]}60`, width: 1.5 } },
    customdata: data.map(r => [r.storeName, fmtInr(r.currentSales), fmtPct(r.monthlyAchPct), fmtPct(r.runRateAchPct)]),
    hovertemplate: '<b>%{customdata[0]}</b><br>Current Sales: %{customdata[1]}<br>Monthly Ach: %{customdata[2]}<br>Run Rate Ach: %{customdata[3]}<extra></extra>',
  }))
  const shapes = [
    { type:'rect' as const, xref:'x' as const, yref:'y' as const, x0:midX, x1:maxX, y0:100, y1:maxY, fillcolor:`${C.emerald}08`, line:{width:0} },
    { type:'rect' as const, xref:'x' as const, yref:'y' as const, x0:0,    x1:midX, y0:100, y1:maxY, fillcolor:`${C.blue}08`,    line:{width:0} },
    { type:'rect' as const, xref:'x' as const, yref:'y' as const, x0:midX, x1:maxX, y0:0,   y1:100,  fillcolor:`${C.amber}08`,   line:{width:0} },
    { type:'rect' as const, xref:'x' as const, yref:'y' as const, x0:0,    x1:midX, y0:0,   y1:100,  fillcolor:`${C.crimson}08`, line:{width:0} },
    { type:'line' as const, xref:'x' as const, yref:'paper' as const, x0:midX, x1:midX, y0:0, y1:1,
      line:{color:`${C.blue}40`, width:1.5, dash:'dash' as const} },
    { type:'line' as const, xref:'paper' as const, yref:'y' as const, x0:0, x1:1, y0:100, y1:100,
      line:{color:`${C.muted}40`, width:1.5, dash:'dash' as const} },
  ]
  const annotations = [
    { x:(midX+maxX)/2, y:maxY*0.93, text:'TARGET ACHIEVERS', color:C.emerald },
    { x:midX/2,        y:maxY*0.93, text:'FAST MOVERS',      color:C.blue    },
    { x:(midX+maxX)/2, y:maxY*0.06, text:'AT RISK',          color:C.amber   },
    { x:midX/2,        y:maxY*0.06, text:'CRITICAL STORES',  color:C.crimson },
  ].map(a => ({ x:a.x, y:a.y, xref:'x' as const, yref:'y' as const, text:a.text, showarrow:false,
    font:{color:`${a.color}70`, size:10, family:'Inter,sans-serif'}, xanchor:'center' as const, yanchor:'middle' as const }))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const annWithLine: any[] = [...annotations,
    { x:midX, y:maxY, xref:'x', yref:'y', text:`Exp. ${fmtPct(midX)}`, showarrow:false,
      font:{color:`${C.blue}80`, size:9}, yanchor:'top', xanchor:'center' }]
  return (
    <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.surface, borderColor: C.border }}>
      <div className="px-5 py-4 border-b" style={{ borderColor: C.border }}>
        <p className="text-sm font-bold" style={{ color: C.text }}>Target Risk Matrix</p>
        <p className="text-xs mt-0.5" style={{ color: C.muted }}>
          X = Monthly Achievement % · Y = Run Rate Achievement % · Bubble size = Current Sales · Vertical line = Expected position for Day {elapsed}
        </p>
      </div>
      <div className="p-4">
        <Plot data={traces}
          layout={{ ...PLOTLY_BASE,
            xaxis: { ...PLOTLY_AXIS, title:{text:'Monthly Achievement %'}, range:[0,maxX] },
            yaxis: { ...PLOTLY_AXIS, title:{text:'Run Rate Achievement %'}, range:[0,maxY] },
            legend: { bgcolor:'rgba(0,0,0,0)', font:{color:C.muted,size:10}, orientation:'h' as const, y:-0.2 },
            hovermode:'closest' as const, margin:{l:64,r:24,t:16,b:80}, height:440,
            shapes, annotations:annWithLine }}
          config={{ displayModeBar:false, responsive:true }} style={{ width:'100%' }} />
      </div>
      <div className="px-5 pb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {Object.entries(byQuadrant).map(([name, data]) => (
          <div key={name} className="rounded-lg p-3"
            style={{ backgroundColor:`${QUADRANT_COLORS[name]}08`, border:`1px solid ${QUADRANT_COLORS[name]}25` }}>
            <p className="text-[9px] font-bold uppercase tracking-wider" style={{ color:QUADRANT_COLORS[name] }}>{name}</p>
            <p className="text-xl font-bold tabular-nums mt-1" style={{ color:C.text }}>{data.length}</p>
            <p className="text-[10px] mt-0.5" style={{ color:C.dim }}>stores</p>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Chart 4: Month-End Projection
// ─────────────────────────────────────────────────────────────────────────────

function ProjectionChart({ rows }: { rows: StoreRow[] }) {
  const sorted = useMemo(() => [...rows].sort((a,b) => b.projectedAchPct - a.projectedAchPct).slice(0,30), [rows])
  const names = sorted.map(r => r.storeName)
  const targets = sorted.map(() => 100)
  const projected = sorted.map(r => r.projectedAchPct)
  const lineTrace = { type:'scatter' as const, mode:'lines' as const, showlegend:false, hoverinfo:'skip' as const,
    x: sorted.flatMap(r => [100, r.projectedAchPct, null as unknown as number]),
    y: sorted.flatMap(r => [r.storeName, r.storeName, null as unknown as string]),
    line: { color:`${C.border}`, width:2 } }
  const targetTrace = { type:'scatter' as const, mode:'markers' as const, name:'Monthly Target (100%)',
    x:targets, y:names, marker:{color:C.amber, size:10, symbol:'diamond' as const, line:{color:`${C.amber}60`, width:1.5}},
    hovertemplate:'<b>%{y}</b><br>Target: 100%<extra>Target</extra>' }
  const projTrace = { type:'scatter' as const, mode:'markers' as const, name:'Projected Month-End',
    x:projected, y:names,
    marker:{ color:sorted.map(r=>projColor(r.projectedAchPct)), size:12, symbol:'circle' as const,
             line:{color:sorted.map(r=>`${projColor(r.projectedAchPct)}60`), width:1.5} },
    customdata:sorted.map(r=>[fmtInr(r.projectedMonthEnd), fmtInr(r.monthlyTarget), fmtPct(r.projectedAchPct)]),
    hovertemplate:'<b>%{y}</b><br>Projected: %{customdata[0]} (%{customdata[2]})<br>Target: %{customdata[1]}<extra>Projected</extra>' }
  const maxX = Math.max(130, ...projected.filter(v=>isFinite(v))) + 10
  return (
    <div className="rounded-xl border overflow-hidden" style={{ backgroundColor:C.surface, borderColor:C.border }}>
      <div className="px-5 py-4 border-b" style={{ borderColor:C.border }}>
        <p className="text-sm font-bold" style={{ color:C.text }}>Month-End Projection</p>
        <p className="text-xs mt-0.5" style={{ color:C.muted }}>◆ = Monthly Target (100%) · ● = Projected at current pace · Top 30 stores</p>
      </div>
      <div className="px-4 py-2 border-b flex flex-wrap gap-4" style={{ borderColor:C.border, backgroundColor:'#f8fafc' }}>
        {[{label:'Projected ≥ 100% — Will Hit',color:C.emerald},{label:'Projected 90–100% — Within Range',color:C.amber},
          {label:'Projected < 90% — At Risk',color:C.crimson}].map(l=>(
          <div key={l.label} className="flex items-center gap-1.5">
            <span className="h-2 w-4 rounded-full shrink-0" style={{backgroundColor:l.color}} />
            <span className="text-[10px]" style={{color:C.dim}}>{l.label}</span>
          </div>
        ))}
      </div>
      <div className="p-4">
        <Plot data={[lineTrace, targetTrace, projTrace]}
          layout={{ ...PLOTLY_BASE,
            xaxis:{...PLOTLY_AXIS, title:{text:'Achievement % vs Target'}, range:[0,maxX], ticksuffix:'%'},
            yaxis:{...PLOTLY_AXIS, autorange:'reversed' as const},
            legend:{bgcolor:'rgba(0,0,0,0)', font:{color:C.muted,size:10}, orientation:'h' as const, y:-0.18},
            hovermode:'y unified' as const, margin:{l:180,r:24,t:8,b:70},
            height:Math.max(380, sorted.length*24+100),
            shapes:[{type:'line' as const, xref:'x' as const, yref:'paper' as const,
              x0:100,x1:100,y0:0,y1:1, line:{color:`${C.muted}40`, width:1.5, dash:'dash' as const}}] }}
          config={{displayModeBar:false,responsive:true}} style={{width:'100%'}} />
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Chart 5: Performance Distribution
// ─────────────────────────────────────────────────────────────────────────────

const BANDS = [
  { label:'0–25%',   min:0,   max:25,       color:C.crimson,  name:'Critical'   },
  { label:'25–50%',  min:25,  max:50,        color:'#b45309',  name:'Lagging'    },
  { label:'50–75%',  min:50,  max:75,        color:'#1d4ed8',  name:'Developing' },
  { label:'75–100%', min:75,  max:100,       color:'#065f46',  name:'On Track'   },
  { label:'100%+',   min:100, max:Infinity,  color:C.emerald,  name:'Champions'  },
]

function DistributionChart({ rows }: { rows: StoreRow[] }) {
  const counts = BANDS.map(b => rows.filter(r => r.monthlyAchPct >= b.min && r.monthlyAchPct < b.max).length)
  const trace = { type:'bar' as const, x:BANDS.map(b=>b.label), y:counts,
    marker:{color:BANDS.map(b=>b.color), opacity:0.85, line:{color:BANDS.map(b=>`${b.color}60`), width:1}},
    text:counts.map(c=>String(c)), textposition:'outside' as const, textfont:{color:C.muted, size:12},
    hovertemplate:'<b>%{x}</b><br>%{y} stores<extra></extra>' }
  return (
    <div className="rounded-xl border overflow-hidden" style={{backgroundColor:C.surface, borderColor:C.border}}>
      <div className="px-5 py-4 border-b" style={{borderColor:C.border}}>
        <p className="text-sm font-bold" style={{color:C.text}}>Achievement Distribution</p>
        <p className="text-xs mt-0.5" style={{color:C.muted}}>Network health — store count per achievement band</p>
      </div>
      <div className="p-4">
        <Plot data={[trace]}
          layout={{ ...PLOTLY_BASE,
            xaxis:{...PLOTLY_AXIS, title:{text:'Monthly Achievement Band'}},
            yaxis:{...PLOTLY_AXIS, title:{text:'Number of Stores'}},
            hovermode:'closest' as const, margin:{l:50,r:24,t:24,b:60}, height:300, bargap:0.25 }}
          config={{displayModeBar:false,responsive:true}} style={{width:'100%'}} />
      </div>
      <div className="px-5 pb-4 flex flex-wrap gap-2">
        {BANDS.map((b,i)=>(
          <div key={b.label} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg"
            style={{backgroundColor:`${b.color}10`, border:`1px solid ${b.color}20`}}>
            <span className="h-2 w-2 rounded-full shrink-0" style={{backgroundColor:b.color}} />
            <span className="text-[10px] font-medium" style={{color:b.color}}>{b.name}</span>
            <span className="text-[10px] font-bold tabular-nums ml-1" style={{color:C.text}}>{counts[i]}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Insights
// ─────────────────────────────────────────────────────────────────────────────

function InsightCard({ title, stores, accentColor, icon, metric }: {
  title: string; stores: StoreRow[]; accentColor: string
  icon: React.ReactNode; metric: (r: StoreRow) => string
}) {
  return (
    <div className="rounded-xl border p-4" style={{ backgroundColor:C.surface, borderColor:`${accentColor}20`,
      boxShadow:`0 0 20px ${accentColor}08` }}>
      <div className="flex items-center gap-2 mb-3">
        <span style={{color:accentColor}}>{icon}</span>
        <p className="text-xs font-bold uppercase tracking-wider" style={{color:accentColor}}>{title}</p>
        <span className="ml-auto text-xs font-bold tabular-nums px-2 py-0.5 rounded"
          style={{color:accentColor, backgroundColor:`${accentColor}10`}}>{stores.length}</span>
      </div>
      {stores.length === 0
        ? <p className="text-xs italic" style={{color:C.dim}}>No stores in this group.</p>
        : <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
            {stores.map((r,i) => (
              <div key={r.storeName} className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[10px] tabular-nums w-4 shrink-0" style={{color:C.dim}}>{i+1}.</span>
                  <span className="text-xs truncate" style={{color:C.muted}}>{r.storeName}</span>
                </div>
                <span className="text-xs font-semibold tabular-nums shrink-0" style={{color:accentColor}}>
                  {metric(r)}
                </span>
              </div>
            ))}
          </div>
      }
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Export helpers
// ─────────────────────────────────────────────────────────────────────────────

function doExportCsv(rows: StoreRow[]) {
  const hdr = ['Store Name','Current Sales','Monthly Target','Daily Target','Expected Sales Till Date','Run Rate Ach %','Monthly Ach %','Remaining Target','Projected Month End','Projected Ach %']
  const lines = rows.map(r => [r.storeName,r.currentSales.toFixed(0),r.monthlyTarget.toFixed(0),r.dailyTarget.toFixed(0),r.expectedSalesTillDate.toFixed(0),r.runRateAchPct.toFixed(1)+'%',r.monthlyAchPct.toFixed(1)+'%',r.remainingTarget.toFixed(0),r.projectedMonthEnd.toFixed(0),r.projectedAchPct.toFixed(1)+'%'])
  const csv = [hdr,...lines].map(row=>row.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob(['﻿'+csv],{type:'text/csv;charset=utf-8;'}))
  a.download = 'target-tracker.csv'
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
  URL.revokeObjectURL(a.href)
}

function doExportXlsx(rows: StoreRow[]) {
  const data = rows.map(r => ({
    'Store Name': r.storeName, 'Current Sales': r.currentSales, 'Monthly Target': r.monthlyTarget,
    'Daily Target': +r.dailyTarget.toFixed(2), 'Expected Sales Till Date': +r.expectedSalesTillDate.toFixed(2),
    'Run Rate Ach %': +r.runRateAchPct.toFixed(2), 'Monthly Ach %': +r.monthlyAchPct.toFixed(2),
    'Remaining Target': r.remainingTarget, 'Projected Month End': +r.projectedMonthEnd.toFixed(2),
    'Projected Ach %': +r.projectedAchPct.toFixed(2),
  }))
  const ws = XLSX.utils.json_to_sheet(data)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Target Tracker')
  XLSX.writeFile(wb, 'target-tracker.xlsx')
}

// ─────────────────────────────────────────────────────────────────────────────
// Section header
// ─────────────────────────────────────────────────────────────────────────────

function SectionHeader({ title, sub, accent = C.blue }: { title: string; sub?: string; accent?: string }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <div className="w-1 h-8 rounded-full" style={{ background:`linear-gradient(180deg,${accent},${accent}40)` }} />
      <div>
        <h2 className="text-sm font-bold tracking-wide uppercase" style={{ color:C.text }}>{title}</h2>
        {sub && <p className="text-xs mt-0.5" style={{ color:C.muted }}>{sub}</p>}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// KPI Card
// ─────────────────────────────────────────────────────────────────────────────

function KPICard({ label, value, sub, glowColor, icon }: {
  label: string; value: string; sub?: string; glowColor?: string; icon: React.ReactNode
}) {
  return (
    <motion.div initial={{ opacity:0, y:16 }} animate={{ opacity:1, y:0 }}
      className="rounded-xl border p-4 flex flex-col gap-1.5"
      style={{ backgroundColor:C.surface, borderColor:glowColor ? `${glowColor}30` : C.border,
        boxShadow:glowColor ? `0 0 24px ${glowColor}10, inset 0 0 0 1px ${glowColor}15` : undefined }}>
      <div className="flex items-center justify-between">
        <p className="text-[9px] font-bold uppercase tracking-[0.2em]" style={{color:C.dim}}>{label}</p>
        <span style={{color:C.dim}}>{icon}</span>
      </div>
      <p className="text-2xl font-bold tabular-nums truncate" style={{color:C.text}}>{value}</p>
      {sub && <p className="text-[11px] truncate" style={{color:C.muted}}>{sub}</p>}
    </motion.div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Tracker Sales Upload Zone
// ─────────────────────────────────────────────────────────────────────────────

function SalesUploadZone({ phase, onFile, onReset }: {
  phase: SalesPhase
  onFile: (f: File) => void
  onReset: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const dragRef  = useRef(0)
  const [drag, setDrag] = useState(false)
  const canInteract = phase.kind === 'idle' || phase.kind === 'error'

  return (
    <div
      onClick={() => canInteract && inputRef.current?.click()}
      onDragEnter={e => { e.preventDefault(); dragRef.current++; setDrag(true) }}
      onDragLeave={e => { e.preventDefault(); dragRef.current--; if (dragRef.current <= 0) { dragRef.current = 0; setDrag(false) } }}
      onDragOver={e => e.preventDefault()}
      onDrop={e => { e.preventDefault(); dragRef.current = 0; setDrag(false); const f = e.dataTransfer.files[0]; if (f) onFile(f) }}
      className={cn(
        'relative rounded-2xl border-2 border-dashed transition-all duration-200 p-6 min-h-[200px] flex flex-col',
        canInteract && 'cursor-pointer',
        phase.kind === 'idle' && !drag && 'border-slate-200 bg-slate-50 hover:border-blue-400 hover:bg-blue-50/50',
        drag              && 'border-blue-500 bg-blue-50 ring-2 ring-blue-400/20',
        phase.kind === 'uploading' && 'border-blue-300 bg-blue-50/50',
        phase.kind === 'done'    && 'border-emerald-400 bg-emerald-50/60',
        phase.kind === 'error'   && 'border-red-300 bg-red-50/50',
      )}
    >
      <input ref={inputRef} type="file" accept=".xlsx,.xls,.XLSX,.XLS" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = '' }} />

      <div className="flex items-center gap-2.5 mb-4">
        <FileSpreadsheet className="h-5 w-5 text-slate-400" />
        <div>
          <p className="text-sm font-semibold text-slate-800">Monthly Sales File</p>
          <p className="text-xs text-slate-500">Required · .xlsx</p>
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center gap-3">
        <AnimatePresence mode="wait">
          {phase.kind === 'idle' && (
            <motion.div key="idle" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}
              className="flex flex-col items-center gap-2.5 text-center">
              <div className={cn('h-12 w-12 rounded-xl flex items-center justify-center', drag ? 'bg-blue-100' : 'bg-slate-100')}>
                <UploadCloud className={cn('h-6 w-6', drag ? 'text-blue-500' : 'text-slate-400')} />
              </div>
              <p className="text-sm text-slate-500">{drag ? 'Drop to upload' : 'Drag & drop or click to browse'}</p>
              <div className="flex flex-wrap justify-center gap-1 mt-1">
                {['Store Name', 'Sales', 'Date'].map(h => (
                  <span key={h} className="text-[10px] px-2 py-0.5 rounded-full bg-slate-200 text-slate-500 font-mono">{h}</span>
                ))}
              </div>
            </motion.div>
          )}
          {phase.kind === 'uploading' && (
            <motion.div key="uploading" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}
              className="flex flex-col items-center gap-2 w-full">
              <Loader2 className="h-8 w-8 text-blue-500 animate-spin" />
              <p className="text-sm text-slate-500">Uploading… {phase.progress}%</p>
              <div className="w-full max-w-[180px] h-1.5 rounded-full bg-slate-200 overflow-hidden">
                <div className="h-full rounded-full bg-blue-500 transition-all" style={{width:`${phase.progress}%`}} />
              </div>
            </motion.div>
          )}
          {phase.kind === 'done' && (
            <motion.div key="done" initial={{opacity:0, scale:0.9}} animate={{opacity:1, scale:1}} exit={{opacity:0}}
              className="flex flex-col items-center gap-2 text-center">
              <div className="h-12 w-12 rounded-xl bg-emerald-100 flex items-center justify-center">
                <FileSpreadsheet className="h-6 w-6 text-emerald-600" />
              </div>
              <p className="text-sm font-semibold text-emerald-700">Saved to server</p>
              <p className="text-xs text-slate-500">{phase.storeCount} stores · {phase.month}</p>
              <button onClick={e => { e.stopPropagation(); onReset() }}
                className="mt-1 text-xs text-slate-400 hover:text-red-500 flex items-center gap-1 transition-colors">
                <X className="h-3 w-3" /> Upload new file
              </button>
            </motion.div>
          )}
          {phase.kind === 'error' && (
            <motion.div key="error" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}
              className="flex flex-col items-center gap-2 text-center">
              <XCircle className="h-10 w-10 text-red-400" />
              <p className="text-sm font-semibold text-red-600">Upload failed</p>
              <p className="text-xs text-slate-500 max-w-[220px] leading-relaxed">{phase.message}</p>
              <button onClick={e => { e.stopPropagation(); onReset() }} className="text-xs text-blue-500 underline">Try again</button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────

export default function TargetTrackerPage() {

  // ── Init state ──────────────────────────────────────────────────────────────
  const [initStatus,    setInitStatus]    = useState<InitStatus>('loading')
  const [currentMonth,  setCurrentMonth]  = useState<string | null>(null)
  const [trackerStatus, setTrackerStatus] = useState<TrackerStatus | null>(null)
  const [managerOpen,   setManagerOpen]   = useState(false)

  // ── Upload state (upload screen) ───────────────────────────────────────────
  const [salesPhase, setSalesPhase] = useState<SalesPhase>({ kind: 'idle' })

  // ── Computed data state ────────────────────────────────────────────────────
  const [targetMap,     setTargetMap]     = useState<Map<string, number>>(new Map())
  const [salesMap,      setSalesMap]      = useState<Map<string, number>>(new Map())
  const [elapsed,       setElapsed]       = useState(0)
  const [rawSalesRows,  setRawSalesRows]  = useState<{ storeName: string; sales: number; day: number }[]>([])
  const [maxElapsed,    setMaxElapsed]    = useState(0)
  const [sliderDay,     setSliderDay]     = useState(0)
  const [storeStateMap, setStoreStateMap] = useState<Map<string, string>>(new Map())
  const [statesList,    setStatesList]    = useState<string[]>([])
  const [selectedState, setSelectedState] = useState('')

  // ── Table state ────────────────────────────────────────────────────────────
  const [search,  setSearch]  = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('runRateAchPct')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [page,    setPage]    = useState(1)
  const PAGE = 20

  // ── Chart filters ──────────────────────────────────────────────────────────
  const [rrFilter, setRrFilter] = useState<ChartFilter>('all')
  const [maFilter, setMaFilter] = useState<ChartFilter>('all')

  // ── Apply backend data to local state ──────────────────────────────────────

  const applyTrackerData = useCallback((data: TrackerData) => {
    const tm = new Map<string, number>()
    for (const t of data.targets) {
      tm.set(t.store_name, t.target)
    }
    setTargetMap(tm)

    const rawRows: { storeName: string; sales: number; day: number }[] = []
    const stateMapNew = new Map<string, string>()

    for (const r of data.sales_rows) {
      rawRows.push({ storeName: r.store_name, sales: r.sales, day: r.day })
      if (r.state) stateMapNew.set(r.store_name, r.state)
    }

    const sm = new Map<string, number>()
    for (const r of rawRows) {
      sm.set(r.storeName, (sm.get(r.storeName) ?? 0) + r.sales)
    }

    setSalesMap(sm)
    setRawSalesRows(rawRows)
    setElapsed(data.max_elapsed)
    setMaxElapsed(data.max_elapsed)
    setSliderDay(data.max_elapsed)
    setStoreStateMap(stateMapNew)
    setStatesList([...new Set(stateMapNew.values())].sort())
  }, [])

  // ── Initialize: check backend, auto-load if data exists ───────────────────

  const refreshStatus = useCallback(async () => {
    try {
      const { data: status } = await getTrackerStatus()
      setTrackerStatus(status)
      return status
    } catch {
      return null
    }
  }, [])

  const loadMonth = useCallback(async (month: string) => {
    try {
      const { data } = await getTrackerData(month)
      if (data.has_target && data.has_sales) {
        applyTrackerData(data)
        setCurrentMonth(month)
        setInitStatus('ready')
        return true
      }
    } catch {
      // fall through
    }
    return false
  }, [applyTrackerData])

  const initTracker = useCallback(async () => {
    setInitStatus('loading')
    const status = await refreshStatus()
    if (!status) { setInitStatus('needs_upload'); return }

    // Auto-load the most recent month that has both target and sales
    const ready = status.months.find(m => m.has_target && m.has_sales)
    if (ready) {
      const ok = await loadMonth(ready.month)
      if (ok) return
    }
    setInitStatus('needs_upload')
  }, [refreshStatus, loadMonth])

  useEffect(() => { initTracker() }, [initTracker])

  // ── Upload handler ─────────────────────────────────────────────────────────

  const handleSalesUpload = useCallback(async (file: File) => {
    setSalesPhase({ kind: 'uploading', progress: 0 })
    try {
      const { data: result } = await uploadTrackerSales(file, pct =>
        setSalesPhase({ kind: 'uploading', progress: pct })
      )
      setSalesPhase({ kind: 'done', month: result.month, storeCount: result.store_count })

      // Re-initialize to pick up the new data
      const status = await refreshStatus()
      if (status) {
        const ready = status.months.find(m => m.month === result.month && m.has_target && m.has_sales)
          ?? status.months.find(m => m.has_target && m.has_sales)
        if (ready) {
          await loadMonth(ready.month)
        }
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        ?? 'Upload failed. Check file format.'
      setSalesPhase({ kind: 'error', message: msg })
    }
  }, [refreshStatus, loadMonth])

  // ── Computed rows ──────────────────────────────────────────────────────────

  const activeSalesMap = useMemo(() => {
    if (!rawSalesRows.length) return salesMap
    const hasDateInfo = rawSalesRows.some(r => r.day > 0)
    if (!hasDateInfo) return salesMap
    const map = new Map<string, number>()
    for (const r of rawSalesRows) {
      if (r.day === 0 || r.day <= sliderDay) {
        map.set(r.storeName, (map.get(r.storeName) ?? 0) + r.sales)
      }
    }
    return map
  }, [rawSalesRows, sliderDay, salesMap])

  const rows = useMemo<StoreRow[]>(() => {
    if (!targetMap.size || !activeSalesMap.size) return []
    return buildRows(targetMap, activeSalesMap, sliderDay > 0 ? sliderDay : elapsed)
  }, [targetMap, activeSalesMap, sliderDay, elapsed])

  const filteredRows = useMemo(() => {
    if (!selectedState || !storeStateMap.size) return rows
    return rows.filter(r => storeStateMap.get(r.storeName) === selectedState)
  }, [rows, selectedState, storeStateMap])

  const kpis = useMemo(() => {
    if (!filteredRows.length) return null
    const totTarget  = filteredRows.reduce((s, r) => s + r.monthlyTarget, 0)
    const totSales   = filteredRows.reduce((s, r) => s + r.currentSales,  0)
    const totExp     = filteredRows.reduce((s, r) => s + r.expectedSalesTillDate, 0)
    const overallAch = totTarget > 0 ? (totSales / totTarget) * 100 : 0
    const rrAch      = totExp   > 0 ? (totSales / totExp)    * 100 : 0
    return { totTarget, totSales, overallAch, totExp, rrAch }
  }, [filteredRows])

  const insights = useMemo(() => {
    const byRR  = [...filteredRows].sort((a, b) => b.runRateAchPct - a.runRateAchPct)
    const byMA  = [...filteredRows].sort((a, b) => b.monthlyAchPct - a.monthlyAchPct)
    const byGap = [...filteredRows].sort((a, b) => a.remainingTarget - b.remainingTarget)
    return {
      aheadOfPace:  byRR.filter(r => r.runRateAchPct >= 100).slice(0, 10),
      behindPace:   byRR.filter(r => r.runRateAchPct <  100).slice(-10).reverse(),
      aboveMonthly: byMA.filter(r => r.monthlyAchPct >= 100),
      atRisk:       byRR.filter(r => r.runRateAchPct <  80).slice(-10).reverse(),
      closestToHit: byGap.filter(r => r.remainingTarget > 0).slice(0, 10),
    }
  }, [filteredRows])

  const tableData = useMemo(() => {
    let r = [...filteredRows]
    const q = search.trim().toLowerCase()
    if (q) r = r.filter(x => x.storeName.toLowerCase().includes(q))
    r.sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey]
      const d  = typeof av === 'string' ? (av as string).localeCompare(bv as string) : (av as number) - (bv as number)
      return sortDir === 'asc' ? d : -d
    })
    return r
  }, [filteredRows, search, sortKey, sortDir])

  const totalPages = Math.max(1, Math.ceil(tableData.length / PAGE))
  const paged      = tableData.slice((page - 1) * PAGE, page * PAGE)
  useEffect(() => setPage(1), [search, sortKey, sortDir])
  const toggleSort = (col: SortKey) => {
    if (sortKey === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(col); setSortDir('desc') }
  }

  // ── Loading screen ─────────────────────────────────────────────────────────

  if (initStatus === 'loading') {
    return (
      <div className="fixed inset-0 bg-gradient-to-br from-slate-50 to-blue-50/40 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="h-12 w-12 rounded-2xl bg-blue-600 flex items-center justify-center">
            <Target className="h-6 w-6 text-white" />
          </div>
          <Loader2 className="h-6 w-6 text-blue-500 animate-spin" />
          <p className="text-sm text-slate-500">Loading persisted tracker data…</p>
        </div>
      </div>
    )
  }

  // ── Upload screen (needs_upload) ───────────────────────────────────────────

  if (initStatus === 'needs_upload') {
    const activeMonth = trackerStatus?.active_target_month
    const hasActiveTarget = !!activeMonth

    return (
      <>
        <TargetManagementDrawer
          open={managerOpen}
          onClose={() => setManagerOpen(false)}
          onTargetChanged={async () => {
            await initTracker()
          }}
        />

        <div className="fixed inset-0 overflow-y-auto bg-gradient-to-br from-slate-50 to-blue-50/40">
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute top-1/4 -left-24 h-[500px] w-[500px] rounded-full opacity-[0.06] blur-[120px] bg-blue-500" />
            <div className="absolute bottom-1/3 -right-24 h-[400px] w-[400px] rounded-full opacity-[0.05] blur-[100px] bg-emerald-500" />
          </div>

          <div className="relative z-10 flex min-h-full items-center justify-center p-6">
            <motion.div initial={{ opacity:0, y:32 }} animate={{ opacity:1, y:0 }}
              transition={{ duration:0.4, ease:'easeOut' }} className="w-full max-w-2xl">

              {/* Back + Manage Targets */}
              <div className="flex items-center justify-between mb-6">
                <Link to="/"
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-medium transition-colors"
                  style={{ color:C.blue, border:`1px solid ${C.blue}30`, backgroundColor:`${C.blue}08` }}>
                  <ArrowLeft className="h-3.5 w-3.5" /> Back to Dashboard
                </Link>
                <button
                  onClick={() => setManagerOpen(true)}
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-medium border border-slate-200 text-slate-600 hover:border-blue-400 hover:text-blue-600 transition-colors bg-white shadow-sm">
                  <Settings className="h-3.5 w-3.5" /> Manage Targets
                </button>
              </div>

              {/* Title */}
              <div className="text-center mb-8">
                <div className="inline-flex items-center justify-center h-16 w-16 rounded-2xl mb-5 shadow-lg"
                  style={{ background:`linear-gradient(135deg,#1d4ed8,${C.blue})`, boxShadow:`0 8px 32px ${C.blue}30` }}>
                  <Target className="h-8 w-8 text-white" />
                </div>
                <h1 className="text-2xl font-bold tracking-tight text-slate-900">Target Command Center</h1>
                <p className="mt-2 text-sm max-w-md mx-auto text-slate-500">
                  Files are stored on the server — upload once, access from any session.
                </p>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-200/60 space-y-5">

                {/* Active Target Status */}
                <div className={cn(
                  'rounded-xl border p-4',
                  hasActiveTarget
                    ? 'border-emerald-200 bg-emerald-50'
                    : 'border-amber-200 bg-amber-50'
                )}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        'h-9 w-9 rounded-lg flex items-center justify-center shrink-0',
                        hasActiveTarget ? 'bg-emerald-100' : 'bg-amber-100'
                      )}>
                        <Target className={cn('h-5 w-5', hasActiveTarget ? 'text-emerald-600' : 'text-amber-600')} />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-slate-800">Monthly Target File</p>
                        {hasActiveTarget
                          ? <p className="text-xs text-emerald-700 mt-0.5">Active: <span className="font-semibold">{activeMonth}</span></p>
                          : <p className="text-xs text-amber-700 mt-0.5">No active target configured</p>
                        }
                      </div>
                    </div>
                    <button
                      onClick={() => setManagerOpen(true)}
                      className="text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors"
                      style={hasActiveTarget
                        ? { borderColor:'#6ee7b7', color:'#047857', backgroundColor:'#d1fae5' }
                        : { borderColor:'#fcd34d', color:'#92400e', backgroundColor:'#fef3c7' }
                      }>
                      {hasActiveTarget ? 'Change' : 'Upload Target'}
                    </button>
                  </div>
                </div>

                {/* Sales Upload */}
                <SalesUploadZone
                  phase={salesPhase}
                  onFile={handleSalesUpload}
                  onReset={() => setSalesPhase({ kind: 'idle' })}
                />

                {!hasActiveTarget && (
                  <div className="rounded-lg px-3 py-2.5 text-xs bg-blue-50 border border-blue-100 text-blue-700">
                    <span className="font-semibold">Tip:</span> Click "Upload Target" above to add this month's target file before uploading sales.
                  </div>
                )}

                <div className="rounded-lg p-3 text-xs space-y-1 bg-slate-50 border border-slate-100">
                  <p className="font-semibold text-slate-700">Sales file format</p>
                  <p className="text-slate-500">Columns: <span className="font-mono">Store Name · Sales / Amount · Date (for day detection) · State (optional)</span></p>
                  <p className="text-slate-500">Month is auto-detected from the Date column.</p>
                </div>
              </div>

              {/* Stored months */}
              {trackerStatus && trackerStatus.months.length > 0 && (
                <div className="mt-5 rounded-xl border border-slate-200 bg-white overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
                    <p className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Stored Months</p>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {trackerStatus.months.slice(0, 6).map(m => (
                      <div key={m.month} className="flex items-center justify-between px-4 py-3">
                        <div className="flex items-center gap-3">
                          <span className="text-xs font-semibold text-slate-700">{m.month}</span>
                          <div className="flex items-center gap-1.5">
                            <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full font-medium',
                              m.has_target ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400')}>
                              {m.has_target ? '✓ Target' : '– Target'}
                            </span>
                            <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full font-medium',
                              m.has_sales ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400')}>
                              {m.has_sales ? '✓ Sales' : '– Sales'}
                            </span>
                          </div>
                        </div>
                        {m.has_target && m.has_sales && (
                          <button
                            onClick={() => loadMonth(m.month)}
                            className="text-xs font-medium text-blue-600 hover:text-blue-800 transition-colors">
                            Load →
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          </div>
        </div>
      </>
    )
  }

  // ── Dashboard ──────────────────────────────────────────────────────────────

  const rrAchColor = kpis!.rrAch >= 100 ? C.emerald : kpis!.rrAch >= 90 ? C.amber : C.crimson
  const maAchColor = kpis!.overallAch >= 100 ? C.emerald : kpis!.overallAch >= 80 ? C.amber : C.crimson

  return (
    <>
      <TargetManagementDrawer
        open={managerOpen}
        onClose={() => setManagerOpen(false)}
        onTargetChanged={initTracker}
      />

      <div className="min-h-screen bg-gray-50 text-gray-900">

        {/* ── Header ── */}
        <header className="sticky top-0 z-50 h-16 border-b border-gray-200 bg-white/95 backdrop-blur-sm shadow-sm">
          <div className="flex items-center justify-between h-full px-6 max-w-screen-2xl mx-auto">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-xl flex items-center justify-center shadow shrink-0"
                style={{ background:`linear-gradient(135deg,#1d4ed8,${C.blue})` }}>
                <Target className="h-5 w-5 text-white" />
              </div>
              <div>
                <p className="text-sm font-bold leading-none" style={{ color:C.text }}>Target Command Center</p>
                <p className="text-[10px] mt-0.5" style={{ color:C.dim }}>
                  {filteredRows.length} stores{selectedState ? ` · ${selectedState}` : ''}{currentMonth ? ` · ${currentMonth}` : ''} · Day {sliderDay || elapsed} of 30
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {statesList.length > 0 && (
                <select value={selectedState} onChange={e => setSelectedState(e.target.value)}
                  className="h-8 pl-2.5 pr-7 rounded-lg text-xs outline-none cursor-pointer"
                  style={{ border:`1px solid ${C.border}`, color:C.muted, backgroundColor:C.surface,
                    backgroundImage:`url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
                    backgroundRepeat:'no-repeat', backgroundPosition:'right 8px center', appearance:'none' }}>
                  <option value="">All States</option>
                  {statesList.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              )}
              <button onClick={() => setManagerOpen(true)}
                className="flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-medium transition-colors"
                style={{ color:C.muted, border:`1px solid ${C.border}`, backgroundColor:'transparent' }}>
                <Settings className="h-3.5 w-3.5" /> Targets
              </button>
              <button onClick={() => { setInitStatus('needs_upload'); setSalesPhase({ kind:'idle' }) }}
                className="flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-medium transition-colors"
                style={{ color:C.muted, border:`1px solid ${C.border}`, backgroundColor:'transparent' }}>
                <RefreshCw className="h-3.5 w-3.5" /> New Sales
              </button>
              <Link to="/"
                className="flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-medium transition-colors"
                style={{ color:C.blue, border:`1px solid ${C.blue}30`, backgroundColor:`${C.blue}08` }}>
                <ArrowLeft className="h-3.5 w-3.5" /> Dashboard
              </Link>
            </div>
          </div>
        </header>

        <main className="px-6 py-7 pb-16 max-w-screen-2xl mx-auto space-y-10">

          {/* ── KPI Row ── */}
          <section>
            <SectionHeader title="Mission Control" sub={`Real-time KPIs · ${currentMonth ?? ''}`} />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
              <KPICard label="Total Monthly Target" value={fmtInr(kpis!.totTarget)}
                sub={`${filteredRows.length} stores${selectedState ? ` · ${selectedState}` : ''}`}
                glowColor={C.blue} icon={<Target className="h-4 w-4" />} />
              <KPICard label="Current Sales" value={fmtInr(kpis!.totSales)}
                sub={`Day ${sliderDay || elapsed} of 30`} icon={<BarChart2 className="h-4 w-4" />} />
              <KPICard label="Overall Achievement" value={fmtPct(kpis!.overallAch)}
                sub="vs monthly target" glowColor={maAchColor}
                icon={kpis!.overallAch >= 100 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />} />
              <KPICard label="Expected Till Date" value={fmtInr(kpis!.totExp)}
                sub={`Daily target × ${sliderDay || elapsed} days`} glowColor={C.amber}
                icon={<Zap className="h-4 w-4" />} />
              <KPICard label="Run Rate Achievement" value={fmtPct(kpis!.rrAch)}
                sub="actual vs required pace" glowColor={rrAchColor}
                icon={<Activity className="h-4 w-4" />} />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {[
                { label:`Run Rate ${fmtPct(kpis!.rrAch)}`, color:rrAchColor, hint:kpis!.rrAch >= 100 ? 'Ahead of required pace' : kpis!.rrAch >= 90 ? 'Slightly behind pace' : 'Intervention needed' },
                { label:`Monthly Ach ${fmtPct(kpis!.overallAch)}`, color:maAchColor, hint:`${fmtInr(kpis!.totSales)} of ${fmtInr(kpis!.totTarget)}` },
                { label:`${filteredRows.filter(r => r.runRateAchPct >= 100).length} stores on pace`, color:C.emerald, hint:`${filteredRows.filter(r => r.runRateAchPct < 100).length} behind` },
              ].map(chip => (
                <div key={chip.label} className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium"
                  style={{ border:`1px solid ${chip.color}25`, backgroundColor:`${chip.color}08`, color:chip.color }}>
                  {chip.label}
                  <span style={{ color:C.dim }}>· {chip.hint}</span>
                </div>
              ))}
            </div>
          </section>

          {/* ── Date Slider ── */}
          {maxElapsed > 0 && rawSalesRows.some(r => r.day > 0) && (
            <section>
              <SectionHeader title="Time Travel" sub={`Replay month progress · Viewing Day ${sliderDay} of ${maxElapsed}`} accent={C.violet} />
              <div className="rounded-xl border p-5" style={{ backgroundColor:C.surface, borderColor:C.border }}>
                <div className="flex items-start justify-between gap-4 mb-4 flex-wrap">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium" style={{ color:C.muted }}>Jump to:</span>
                    {[7, 14, 21].filter(d => d <= maxElapsed).map(d => (
                      <button key={d} onClick={() => setSliderDay(d)}
                        className="h-7 px-2.5 rounded-lg text-xs font-medium transition-all"
                        style={sliderDay === d
                          ? { backgroundColor:C.blue, color:'#fff', boxShadow:`0 2px 8px ${C.blue}40` }
                          : { backgroundColor:'#f1f5f9', color:C.dim, border:`1px solid ${C.border}` }}>
                        Day {d}
                      </button>
                    ))}
                    <button onClick={() => setSliderDay(maxElapsed)}
                      className="h-7 px-2.5 rounded-lg text-xs font-medium transition-all"
                      style={sliderDay === maxElapsed
                        ? { backgroundColor:C.emerald, color:'#fff', boxShadow:`0 2px 8px ${C.emerald}40` }
                        : { backgroundColor:'#f1f5f9', color:C.dim, border:`1px solid ${C.border}` }}>
                      Latest (Day {maxElapsed})
                    </button>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-3xl font-bold tabular-nums leading-none" style={{ color:C.blue }}>Day {sliderDay}</p>
                    <p className="text-[10px] mt-1" style={{ color:C.dim }}>{Math.round((sliderDay / 30) * 100)}% through month</p>
                  </div>
                </div>
                <input type="range" min={1} max={maxElapsed} value={sliderDay}
                  onChange={e => setSliderDay(Number(e.target.value))}
                  className="w-full h-2 rounded-full appearance-none cursor-pointer"
                  style={{ accentColor:C.blue }} />
                <div className="flex justify-between mt-2">
                  <span className="text-[10px]" style={{ color:C.dim }}>Day 1</span>
                  {[7, 14, 21].filter(d => d < maxElapsed - 1).map(d => (
                    <span key={d} className="text-[10px]" style={{ color:C.dim }}>Day {d}</span>
                  ))}
                  <span className="text-[10px]" style={{ color:C.dim }}>Day {maxElapsed}</span>
                </div>
              </div>
            </section>
          )}

          {/* ── Charts ── */}
          <section>
            <SectionHeader title="Pace Intelligence" sub="Is each store on track for month-end target?" accent={C.emerald} />
            <PaceLeaderboard rows={filteredRows} filter={rrFilter} onFilter={setRrFilter} />
          </section>

          <section>
            <SectionHeader title="Achievement Thermometer" sub="How far each store has travelled toward monthly target" accent={C.blue} />
            <ThermometerChart rows={filteredRows} filter={maFilter} onFilter={setMaFilter} />
          </section>

          <section className="grid grid-cols-1 gap-6 xl:grid-cols-3">
            <div className="xl:col-span-2">
              <SectionHeader title="Target Risk Matrix" sub="The primary management view — where to intervene" accent={C.violet} />
              <RiskMatrix rows={filteredRows} elapsed={sliderDay || elapsed} />
            </div>
            <div>
              <SectionHeader title="Network Distribution" sub="Achievement band breakdown" accent={C.amber} />
              <DistributionChart rows={filteredRows} />
            </div>
          </section>

          <section>
            <SectionHeader title="Month-End Projections" sub="Based on current pace — which stores will hit target?" accent={C.crimson} />
            <ProjectionChart rows={filteredRows} />
          </section>

          {/* ── Insights ── */}
          <section>
            <SectionHeader title="Intelligence Briefing" sub="Auto-generated store groupings from uploaded data" accent={C.muted} />
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              <InsightCard title="Ahead of Pace — Top 10" stores={insights.aheadOfPace} accentColor={C.emerald}
                icon={<TrendingUp className="h-4 w-4" />} metric={r => fmtPct(r.runRateAchPct)} />
              <InsightCard title="Behind Pace — Needs Attention" stores={insights.behindPace} accentColor={C.crimson}
                icon={<TrendingDown className="h-4 w-4" />} metric={r => fmtPct(r.runRateAchPct)} />
              <InsightCard title="Monthly Target Hit" stores={insights.aboveMonthly} accentColor={C.emerald}
                icon={<Trophy className="h-4 w-4" />} metric={r => fmtPct(r.monthlyAchPct)} />
              <InsightCard title="Critical — RR Below 80%" stores={insights.atRisk} accentColor={C.amber}
                icon={<AlertTriangle className="h-4 w-4" />} metric={r => fmtPct(r.runRateAchPct)} />
              <InsightCard title="Closest to Hitting Target" stores={insights.closestToHit} accentColor={C.violet}
                icon={<Crosshair className="h-4 w-4" />} metric={r => fmtInr(r.remainingTarget)} />
            </div>
          </section>

          {/* ── Store Table ── */}
          <section>
            <SectionHeader title="Store Command Table" sub="Full detail — sortable, searchable, exportable" />
            <div className="rounded-xl border overflow-hidden" style={{ backgroundColor:C.surface, borderColor:C.border }}>
              <div className="px-5 py-4 border-b flex items-center justify-between flex-wrap gap-3" style={{ borderColor:C.border }}>
                <p className="text-xs" style={{ color:C.muted }}>{tableData.length} store{tableData.length !== 1 ? 's' : ''} · Page {page} of {totalPages}</p>
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="relative flex items-center">
                    <Search className="absolute left-2.5 h-3.5 w-3.5 pointer-events-none" style={{ color:C.dim }} />
                    <input type="text" placeholder="Search store…" value={search}
                      onChange={e => setSearch(e.target.value)}
                      className="h-8 pl-8 pr-7 rounded-lg text-xs outline-none w-44"
                      style={{ backgroundColor:'#f8fafc', border:`1px solid ${C.border}`, color:C.text }}
                      onFocus={e => (e.currentTarget.style.borderColor = C.blue)}
                      onBlur={e => (e.currentTarget.style.borderColor = C.border)} />
                    {search && (
                      <button onClick={() => setSearch('')} className="absolute right-2" style={{ color:C.dim }}>
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  <button onClick={() => doExportCsv(tableData)}
                    className="flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs transition-colors"
                    style={{ border:`1px solid ${C.border}`, color:C.muted, backgroundColor:'transparent' }}>
                    <Download className="h-3.5 w-3.5" /> CSV
                  </button>
                  <button onClick={() => doExportXlsx(tableData)}
                    className="flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs transition-colors"
                    style={{ border:`1px solid ${C.emerald}30`, color:C.emerald, backgroundColor:`${C.emerald}08` }}>
                    <Download className="h-3.5 w-3.5" /> Excel
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b" style={{ borderColor:C.border, backgroundColor:'#f8fafc' }}>
                      <th className="px-3 py-2.5 text-left text-xs w-8" style={{ color:C.dim }}>#</th>
                      {([
                        { key:'storeName' as SortKey,             label:'Store Name'         },
                        { key:'currentSales' as SortKey,          label:'Current Sales'       },
                        { key:'monthlyTarget' as SortKey,         label:'Monthly Target'      },
                        { key:'dailyTarget' as SortKey,           label:'Daily Target'        },
                        { key:'expectedSalesTillDate' as SortKey, label:'Expected Till Date'  },
                        { key:'runRateAchPct' as SortKey,         label:'Run Rate Ach %'      },
                        { key:'monthlyAchPct' as SortKey,         label:'Monthly Ach %'       },
                        { key:'remainingTarget' as SortKey,       label:'Remaining'           },
                        { key:'projectedAchPct' as SortKey,       label:'Projected Ach %'     },
                      ]).map(({ key, label }) => (
                        <th key={key} className="px-3 py-2.5 text-left">
                          <button onClick={() => toggleSort(key)}
                            className="flex items-center gap-1 text-xs font-medium uppercase tracking-wider whitespace-nowrap transition-colors"
                            style={{ color:sortKey === key ? C.blue : C.dim }}>
                            {label}
                            {sortKey === key
                              ? sortDir === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
                              : <ChevronUp className="h-3 w-3 opacity-20" />}
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {paged.length === 0
                      ? <tr><td colSpan={10} className="px-3 py-10 text-center text-sm" style={{ color:C.dim }}>No stores match "{search}"</td></tr>
                      : paged.map((r, i) => {
                          const idx  = (page - 1) * PAGE + i + 1
                          const rrC  = rrColorSet(r.runRateAchPct).text
                          const maC  = maColorSet(r.monthlyAchPct).text
                          const prC  = projColor(r.projectedAchPct)
                          return (
                            <tr key={r.storeName} className="border-b transition-colors"
                              style={{ borderColor:C.border }}
                              onMouseEnter={e => (e.currentTarget.style.backgroundColor = C.surfaceHi)}
                              onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}>
                              <td className="px-3 py-2.5 text-xs tabular-nums" style={{ color:C.dim }}>{idx}</td>
                              <td className="px-3 py-2.5 text-xs font-medium max-w-[160px] truncate" style={{ color:C.text }} title={r.storeName}>{r.storeName}</td>
                              <td className="px-3 py-2.5 text-xs tabular-nums whitespace-nowrap" style={{ color:C.muted }}>{fmtInr(r.currentSales)}</td>
                              <td className="px-3 py-2.5 text-xs tabular-nums whitespace-nowrap" style={{ color:C.muted }}>{fmtInr(r.monthlyTarget)}</td>
                              <td className="px-3 py-2.5 text-xs tabular-nums whitespace-nowrap" style={{ color:C.dim }}>{fmtInr(r.dailyTarget)}</td>
                              <td className="px-3 py-2.5 text-xs tabular-nums whitespace-nowrap" style={{ color:C.dim }}>{fmtInr(r.expectedSalesTillDate)}</td>
                              <td className="px-3 py-2.5 text-xs font-bold tabular-nums whitespace-nowrap" style={{ color:rrC }}>{fmtPct(r.runRateAchPct)}</td>
                              <td className="px-3 py-2.5 text-xs font-bold tabular-nums whitespace-nowrap" style={{ color:maC }}>{fmtPct(r.monthlyAchPct)}</td>
                              <td className="px-3 py-2.5 text-xs tabular-nums whitespace-nowrap"
                                style={{ color:r.remainingTarget <= 0 ? C.emerald : C.dim }}>
                                {r.remainingTarget <= 0 ? '✓ Hit' : fmtInr(r.remainingTarget)}
                              </td>
                              <td className="px-3 py-2.5 text-xs font-bold tabular-nums whitespace-nowrap" style={{ color:prC }}>{fmtPct(r.projectedAchPct)}</td>
                            </tr>
                          )
                        })
                    }
                  </tbody>
                </table>
              </div>

              {totalPages > 1 && (
                <div className="px-5 py-3 border-t flex items-center justify-between flex-wrap gap-3" style={{ borderColor:C.border }}>
                  <p className="text-xs" style={{ color:C.dim }}>
                    {(page - 1) * PAGE + 1}–{Math.min(page * PAGE, tableData.length)} of {tableData.length}
                  </p>
                  <div className="flex items-center gap-1">
                    {[
                      { l:'«', fn:() => setPage(1),                              dis:page === 1          },
                      { l:'‹', fn:() => setPage(p => Math.max(1, p - 1)),        dis:page === 1          },
                      { l:'›', fn:() => setPage(p => Math.min(totalPages,p+1)),  dis:page === totalPages },
                      { l:'»', fn:() => setPage(totalPages),                     dis:page === totalPages },
                    ].map((b, i) => (
                      <button key={i} onClick={b.fn} disabled={b.dis}
                        className="h-7 px-2.5 rounded text-xs transition-colors disabled:opacity-25"
                        style={{ color:C.dim }}>{b.l}
                      </button>
                    ))}
                    {Array.from({ length:Math.min(5, totalPages) }, (_, k) => {
                      let pg: number
                      if (totalPages <= 5) pg = k + 1
                      else if (page <= 3) pg = k + 1
                      else if (page >= totalPages - 2) pg = totalPages - 4 + k
                      else pg = page - 2 + k
                      return (
                        <button key={pg} onClick={() => setPage(pg)}
                          className="h-7 w-7 rounded text-xs transition-colors"
                          style={pg === page
                            ? { backgroundColor:C.blue, color:'#fff', boxShadow:`0 0 10px ${C.blue}50` }
                            : { color:C.dim }}>
                          {pg}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          </section>
        </main>

        <footer className="fixed bottom-0 inset-x-0 z-20 h-9 flex items-center justify-center border-t backdrop-blur-sm"
          style={{ backgroundColor:`${C.surface}f0`, borderColor:C.border }}>
          <span className="text-[10px] font-medium tracking-[0.2em] uppercase select-none" style={{ color:C.dim }}>
            Target Command Center · Files persisted on server · {currentMonth ?? ''}
          </span>
        </footer>
      </div>
    </>
  )
}
