import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  motion,
  useMotionValue,
  useTransform,
  animate,
} from 'framer-motion'
import {
  ChevronUp, ChevronDown,
  TrendingUp, TrendingDown,
  Star, Activity, BarChart2, Zap, ChevronRight, Minus, Download,
} from 'lucide-react'
// eslint-disable-next-line @typescript-eslint/no-require-imports
import createPlotlyComponent from 'react-plotly.js/factory'
// @ts-ignore — plotly.js-dist-min does not ship its own .d.ts
import Plotly from 'plotly.js-dist-min'
import { useDataContext } from '@/contexts/DataContext'
import type { FilterState } from '@/hooks/useFilters'
import { type StoreCategory, CATEGORY_ORDER } from '@/lib/classificationEngine'
import { getTabClassification, getStorePlanCategories, transformStoresByPlanCategory } from '@/lib/filterHelpers'
import { cn } from '@/lib/utils'
import { fmtInr, fmtPct, plotlyInrTickVals, plotlyInrLogTickVals } from '@/lib/formatting'
import { exportCsv } from '@/lib/tableExport'
import { kpiContainer, kpiItem, panelSpring } from '@/lib/animations'
import { PT } from '@/lib/plotlyTheme'

const Plot = createPlotlyComponent(Plotly)

// ── Constants ─────────────────────────────────────────────────────────────────

type SortKey = 'name' | 'early' | 'mid' | 'recent' | 'growth'

const CATEGORY_COLOR: Record<StoreCategory, string> = {
  'New Bloomer':    '#10b981',
  'Rising Star':    '#eab308',
  'Growing Store':  '#3b82f6',
  'Constant Store': '#8b5cf6',
  'Declining Store':'#f97316',
  'Fallen Star':    '#dc2626',
  'Inactive Store': '#9ca3af',
}

const CATEGORY_BADGE: Record<StoreCategory, string> = {
  'New Bloomer':    'bg-emerald-100 text-emerald-700',
  'Rising Star':    'bg-yellow-100 text-yellow-700',
  'Growing Store':  'bg-blue-100 text-blue-700',
  'Constant Store': 'bg-violet-100 text-violet-700',
  'Declining Store':'bg-orange-100 text-orange-700',
  'Fallen Star':    'bg-red-100 text-red-700',
  'Inactive Store': 'bg-gray-100 text-gray-500',
}

const CATEGORY_DESC: Record<StoreCategory, string> = {
  'New Bloomer':    `Early activity ≤ 10 and ≤ 10% of recent — store just entering the market`,
  'Rising Star':    `Strict early < mid < recent, growth ≥ 30%, recent above network median`,
  'Growing Store':  `Recent > early, growth ≥ 15% — steady improvement, not yet Rising Star`,
  'Constant Store': `No strong directional trend — stable or low-activity store`,
  'Declining Store':`Recent < early, decline ≥ 15% — performance weakening`,
  'Fallen Star':    `Strict early > mid > recent, decline ≥ 30%, early above network median`,
  'Inactive Store': `Zero revenue in both mid and recent phases — store has gone dormant`,
}

const CATEGORY_ICON: Record<StoreCategory, React.ReactNode> = {
  'New Bloomer':    <Zap          className="h-4 w-4" />,
  'Rising Star':    <Star         className="h-4 w-4" />,
  'Growing Store':  <TrendingUp   className="h-4 w-4" />,
  'Constant Store': <BarChart2    className="h-4 w-4" />,
  'Declining Store':<Activity     className="h-4 w-4" />,
  'Fallen Star':    <TrendingDown className="h-4 w-4" />,
  'Inactive Store': <Minus        className="h-4 w-4" />,
}

const CATEGORY_INSIGHT: Record<StoreCategory, string> = {
  'New Bloomer':    'Minimal early Revenue and Plans Sold, now showing measurable traction in both.',
  'Rising Star':    'Strong and consistent growth in both Revenue and Plans Sold across all phases.',
  'Growing Store':  'Positive momentum in Revenue and Plans Sold with room for further acceleration.',
  'Constant Store': 'Stable Revenue and Plans Sold with no strong directional trend across phases.',
  'Declining Store':'Revenue and Plans Sold are weakening — store requires monitoring and intervention.',
  'Fallen Star':    'Previously strong in Revenue and Plans Sold, now in sustained decline across phases.',
  'Inactive Store': 'No Revenue or Plans Sold recorded in mid and recent phases — store is dormant.',
}

const CATEGORY_REASON: Record<StoreCategory, string> = {
  'New Bloomer':    'Low early activity (Revenue & Plans) — now gaining traction.',
  'Rising Star':    'Early < Mid < Recent in Revenue & Plans, growth ≥ 30%, above network median.',
  'Growing Store':  'Recent Revenue & Plans > Early, growth ≥ 15% — improving but not yet Rising Star.',
  'Constant Store': 'No strong directional trend in Revenue or Plans Sold — stable.',
  'Declining Store':'Recent Revenue & Plans < Early by ≥ 15% — performance weakening.',
  'Fallen Star':    'Early > Mid > Recent in Revenue & Plans, decline ≥ 30%, was above network median.',
  'Inactive Store': 'Mid and recent phase Revenue both zero — store has gone dormant.',
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

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  filters: FilterState
  onNavigateToStore?: (storeId: string) => void
  initialCategory?: StoreCategory | null
}

export default function StoreJourneyMap({ filters, onNavigateToStore, initialCategory }: Props) {
  const { classification, stores, months } = useDataContext()
  const navigate = useNavigate()

  const [activeCategory, setActiveCategory] = useState<StoreCategory | null>(initialCategory ?? null)
  const [sortKey, setSortKey]               = useState<SortKey>('recent')
  const [sortDir, setSortDir]               = useState<'asc' | 'desc'>('desc')
  const [hintStoreId, setHintStoreId]       = useState<string | null>(null)
  const [auditOpen, setAuditOpen]           = useState(false)
  const [logScale, setLogScale]             = useState(false)
  const [viewMode, setViewMode]             = useState<'overall' | 'breakdown'>('overall')

  // Sync when App navigates here with a pre-selected category
  useEffect(() => {
    if (initialCategory !== undefined) setActiveCategory(initialCategory ?? null)
  }, [initialCategory])

  const lastClickedStoreRef = useRef<string | null>(null)
  const hintTimerRef        = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (hintTimerRef.current) clearTimeout(hintTimerRef.current) }, [])

  const tabClassification = useMemo(() => {
    return getTabClassification(stores, months, filters.planCategory);
  }, [stores, months, filters.planCategory]);

  // ── Apply store-level filters to engine results ───────────────────────────

  const classified = useMemo(() => {
    let scope = tabClassification.metrics

    if (filters.state)              scope = scope.filter(m => m.store.state === filters.state)
    if (filters.productSubcategory) scope = scope.filter(m => m.store.category?.toLowerCase() === filters.productSubcategory.toLowerCase())

    const { earlyMonths, midMonths, recentMonths } = tabClassification.phases

    return scope.map(m => ({
      ...m,
      totalRev:     m.totalRevenue,
      earlyPlans:   earlyMonths.reduce((s, mo) => s + (m.store.monthly_plans_count?.[mo] ?? 0), 0),
      midPlans:     midMonths.reduce((s, mo) => s + (m.store.monthly_plans_count?.[mo] ?? 0), 0),
      recentPlans:  recentMonths.reduce((s, mo) => s + (m.store.monthly_plans_count?.[mo] ?? 0), 0),
    }))
  }, [tabClassification, filters])

  // ── Summary counts ────────────────────────────────────────────────────────

  const counts = useMemo(() => {
    const c = Object.fromEntries(CATEGORY_ORDER.map(cat => [cat, 0])) as Record<StoreCategory, number>
    for (const m of classified) c[m.category]++
    return c
  }, [classified])

  // ── Scatter traces ────────────────────────────────────────────────────────

  const maxAxis = useMemo(() => {
    if (classified.length === 0) return 0
    return Math.max(...classified.map(c => Math.max(c.earlyTotal, c.recentTotal)), 1) * 1.15
  }, [classified])

  const scatterTraces = useMemo(() => {
    if (classified.length === 0) return []

    const maxRev  = Math.max(...classified.map(c => c.totalRev), 1)

    // For log scale the reference line must start at a positive value
    const posVals = classified
      .flatMap(c => [c.earlyTotal, c.recentTotal])
      .filter(v => v > 0)
    const minPos = logScale && posVals.length > 0
      ? Math.max(1, Math.min(...posVals) * 0.7)
      : 0

    const refLine = {
      type:       'scatter' as const,
      mode:       'lines' as const,
      name:       'No Change (Y = X)',
      x:          [minPos, maxAxis],
      y:          [minPos, maxAxis],
      line:       { dash: 'dot' as const, color: '#cbd5e1', width: 1.5 },
      hoverinfo:  'skip' as const,
      showlegend: true,
    }

    const dataTraces = CATEGORY_ORDER.map(cat => {
      const group = classified.filter(c => c.category === cat)
      return {
        type: 'scatter' as const,
        mode: 'markers' as const,
        name: cat,
        x:          group.map(c => Math.max(c.earlyTotal,  logScale ? 0.01 : 0)),
        y:          group.map(c => Math.max(c.recentTotal, logScale ? 0.01 : 0)),
        customdata: group.map(c => c.store.store_id),
        text: group.map(c =>
          `${c.store.store_name ?? c.store.store_id}`
          + `<br>${c.store.state ?? ''}${c.store.category ? ` · ${c.store.category}` : ''}`
          + `<br>Growth: ${c.growthPct != null ? fmtPct(c.growthPct) : 'N/A'}`
        ),
        marker: {
          size:     group.map(c => c.totalRev),
          sizemode: 'area' as const,
          sizeref:  (2 * maxRev) / (36 ** 2),  // max bubble ~36px diameter
          sizemin:  5,
          color:    CATEGORY_COLOR[cat],
          opacity:  0.82,
          line:     { color: '#ffffff', width: 1.2 },
        },
        hovertemplate:
          '<b>%{text}</b><br>Early: ₹%{x:,.0f}<br>Recent: ₹%{y:,.0f}<extra></extra>',
      }
    })

    return [refLine, ...dataTraces]
  }, [classified, logScale])

  // ── Per-category mini scatter traces (breakdown view) ────────────────────

  const breakdownData = useMemo(() => {
    if (classified.length === 0) return [] as { cat: StoreCategory; traces: object[] }[]
    const maxRev = Math.max(...classified.map(c => c.totalRev), 1)

    return CATEGORY_ORDER.map(cat => {
      const group = classified.filter(c => c.category === cat)
      if (group.length === 0) return { cat, traces: [] as object[] }

      const vals   = group.flatMap(c => [c.earlyTotal, c.recentTotal])
      const maxVal = Math.max(...vals, 1) * 1.15
      const posVals = vals.filter(v => v > 0)
      const minPos  = logScale && posVals.length > 0 ? Math.max(1, Math.min(...posVals) * 0.7) : 0

      const refLine = {
        type: 'scatter' as const,
        mode: 'lines' as const,
        name: 'Y = X',
        x: [minPos, maxVal],
        y: [minPos, maxVal],
        line:      { dash: 'dot' as const, color: '#cbd5e1', width: 1.5 },
        hoverinfo: 'skip' as const,
        showlegend: false,
      }

      const dataTrace = {
        type: 'scatter' as const,
        mode: 'markers' as const,
        name: cat,
        x:          group.map(c => Math.max(c.earlyTotal,  logScale ? 0.01 : 0)),
        y:          group.map(c => Math.max(c.recentTotal, logScale ? 0.01 : 0)),
        customdata: group.map(c => c.store.store_id),
        text: group.map(c =>
          `${c.store.store_name ?? c.store.store_id}`
          + `<br>${c.store.state ?? ''}${c.store.category ? ` · ${c.store.category}` : ''}`
          + `<br>Growth: ${c.growthPct != null ? fmtPct(c.growthPct) : 'N/A'}`
        ),
        marker: {
          size:     group.map(c => c.totalRev),
          sizemode: 'area' as const,
          sizeref:  (2 * maxRev) / (28 ** 2),
          sizemin:  4,
          color:    CATEGORY_COLOR[cat],
          opacity:  0.82,
          line:     { color: '#ffffff', width: 1 },
        },
        hovertemplate:
          '<b>%{text}</b><br>Early: ₹%{x:,.0f}<br>Recent: ₹%{y:,.0f}<extra></extra>',
      }

      return { cat, traces: [refLine, dataTrace] as object[] }
    })
  }, [classified, logScale])

  // ── Scatter click handlers ────────────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handlePlotClick = useCallback((event: any) => {
    const pt = event?.points?.[0]
    if (!pt) return

    let storeId = pt.customdata as string | undefined
    if (!storeId) {
      const curveNum = pt.curveNumber as number
      if (curveNum === 0) return   // reference line
      const cat   = CATEGORY_ORDER[curveNum - 1]
      if (!cat) return
      const group = classified.filter(c => c.category === cat)
      storeId     = group[pt.pointIndex as number]?.store?.store_id
    }
    if (!storeId) return

    if (lastClickedStoreRef.current === storeId && onNavigateToStore) {
      onNavigateToStore(storeId)
      lastClickedStoreRef.current = null
      setHintStoreId(null)
      if (hintTimerRef.current) clearTimeout(hintTimerRef.current)
    } else {
      lastClickedStoreRef.current = storeId
      setHintStoreId(storeId)
      if (hintTimerRef.current) clearTimeout(hintTimerRef.current)
      hintTimerRef.current = setTimeout(() => {
        lastClickedStoreRef.current = null
        setHintStoreId(null)
      }, 5000)
    }
  }, [classified, onNavigateToStore])

  const handlePlotDoubleClick = useCallback(() => {
    const storeId = lastClickedStoreRef.current
    if (storeId) navigate(`/store/${encodeURIComponent(storeId)}`)
  }, [navigate])

  // ── Table ─────────────────────────────────────────────────────────────────

  const tableRows = useMemo(() => {
    const rows = activeCategory
      ? classified.filter(c => c.category === activeCategory)
      : classified

    return [...rows].sort((a, b) => {
      let d = 0
      if      (sortKey === 'early')  d = a.earlyTotal  - b.earlyTotal
      else if (sortKey === 'mid')    d = a.midTotal     - b.midTotal
      else if (sortKey === 'recent') d = a.recentTotal  - b.recentTotal
      else if (sortKey === 'growth') d = (a.growthPct ?? -1e9) - (b.growthPct ?? -1e9)
      else d = (a.store.store_name ?? '').localeCompare(b.store.store_name ?? '')
      return sortDir === 'asc' ? d : -d
    })
  }, [classified, activeCategory, sortKey, sortDir])

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }

  const sortIcon = (col: SortKey) =>
    sortKey !== col
      ? <ChevronUp className="h-3 w-3 opacity-25" />
      : sortDir === 'asc'
        ? <ChevronUp   className="h-3 w-3 text-blue-600" />
        : <ChevronDown className="h-3 w-3 text-blue-600" />

  const handleExportCsv = useCallback(() => {
    const headers = ['#','Store ID','Store Name','State','Classification','Early Rev','Mid Rev','Recent Rev','Growth %','Early Plans','Mid Plans','Recent Plans']
    const rows = tableRows.map(({ store, earlyTotal, midTotal, recentTotal, growthPct, category, earlyPlans, midPlans, recentPlans }, i) => [
      i + 1,
      store.store_id,
      store.store_name ?? store.store_id,
      store.state ?? '',
      category,
      earlyTotal,
      midTotal,
      recentTotal,
      growthPct != null ? parseFloat(growthPct.toFixed(2)) : '',
      earlyPlans,
      midPlans,
      recentPlans,
    ])
    const suffix = activeCategory ? `-${activeCategory.replace(/\s+/g, '-').toLowerCase()}` : ''
    exportCsv(`store-journey${suffix}.csv`, headers, rows)
  }, [tableRows, activeCategory])

  const { phases, counts: globalCounts } = tabClassification
  const cardCls  = 'rounded-xl border border-gray-200 bg-white p-4 shadow-sm'
  const emptyMsg = 'flex items-center justify-center h-64 text-gray-400 text-sm'

  if (classified.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white min-h-96 flex items-center justify-center">
        <p className="text-gray-400 text-sm">No data for selected filters</p>
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">

      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
      >
        <h2 className="text-base font-bold text-gray-900">Every Store's Journey</h2>
        <p className="text-[11px] text-gray-500 mt-0.5 max-w-xl leading-relaxed">
          Each store classified by a single centralized engine using growth, momentum, trend, and stability.
          Click a category card to isolate that segment.
        </p>
      </motion.div>

      {/* Category Cards */}
      <motion.div
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6"
        variants={kpiContainer}
        initial="hidden"
        animate="show"
      >
        {CATEGORY_ORDER.map(cat => {
          const count    = counts[cat]
          const ratio    = classified.length > 0 ? count / classified.length : 0
          const isActive = activeCategory === cat
          return (
            <motion.button
              key={cat}
              variants={kpiItem}
              whileHover={{ scale: 1.035, y: -4, transition: { type: 'spring', stiffness: 420, damping: 26 } }}
              whileTap={{ scale: 0.97, transition: { duration: 0.1 } }}
              onClick={() => setActiveCategory(isActive ? null : cat)}
              className={cn(
                'rounded-xl border bg-white p-4 text-left flex flex-col gap-0.5 min-w-0 cursor-pointer',
                'shadow-sm hover:shadow-md transition-shadow duration-200',
                isActive ? 'ring-1' : 'border-gray-200',
              )}
              style={isActive ? {
                borderColor:     CATEGORY_COLOR[cat],
                backgroundColor: `${CATEGORY_COLOR[cat]}12`,
                outlineColor:    CATEGORY_COLOR[cat],
              } : undefined}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-bold uppercase tracking-widest truncate"
                   style={{ color: CATEGORY_COLOR[cat] }}>
                  {cat}
                </p>
                <span style={{ color: CATEGORY_COLOR[cat] }} className="shrink-0">
                  {CATEGORY_ICON[cat]}
                </span>
              </div>
              <AnimatedNumber value={count} className="text-2xl font-bold tabular-nums block text-gray-900" />
              <p className="text-[11px] text-gray-500">{Math.round(ratio * 100)}% of portfolio</p>
              <p className="text-[10px] text-gray-400 mt-0.5 leading-tight line-clamp-2">
                {CATEGORY_DESC[cat]}
              </p>
              <MiniBar ratio={ratio} color={CATEGORY_COLOR[cat]} />
            </motion.button>
          )
        })}
      </motion.div>

      {/* Scatter Plot / Category Breakdown */}
      <motion.div {...panelSpring(0.12)} className={cardCls}>
        <div className="flex items-start justify-between gap-2 flex-wrap mb-3">
          <div>
            <h3 className="mb-0.5 text-sm font-semibold text-gray-800">Store Journey Scatter</h3>
            <p className="text-[11px] text-gray-500">
              X = early phase · Y = recent phase · bubble size ∝ total revenue · dotted = no change
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap shrink-0">
            {/* View mode toggle */}
            <div className="flex items-center border border-gray-200 rounded-full overflow-hidden text-[11px]">
              <button
                onClick={() => setViewMode('overall')}
                className={cn(
                  'px-3 py-1 transition-colors whitespace-nowrap',
                  viewMode === 'overall'
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-500 hover:text-gray-700',
                )}
              >
                Overall View
              </button>
              <button
                onClick={() => setViewMode('breakdown')}
                className={cn(
                  'px-3 py-1 transition-colors border-l border-gray-200 whitespace-nowrap',
                  viewMode === 'breakdown'
                    ? 'bg-blue-600 text-white border-l-blue-600'
                    : 'bg-white text-gray-500 hover:text-gray-700',
                )}
              >
                Category Breakdown
              </button>
            </div>
            {/* Log scale */}
            <button
              onClick={() => setLogScale(s => !s)}
              className={cn(
                'text-[11px] px-2.5 py-1 rounded-full border transition-colors whitespace-nowrap',
                logScale
                  ? 'bg-violet-600 text-white border-violet-600'
                  : 'bg-white text-gray-500 border-gray-200 hover:border-violet-300 hover:text-violet-600',
              )}
            >
              {logScale ? 'Log scale ✓' : 'Log scale'}
            </button>
          </div>
        </div>

        {viewMode === 'overall' ? (
          /* ── Overall scatter ─────────────────────────────────────────── */
          scatterTraces.length > 0 ? (
            <>
              <Plot
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                data={scatterTraces as any}
                layout={{
                  paper_bgcolor: 'rgba(0,0,0,0)',
                  plot_bgcolor:  'rgba(0,0,0,0)',
                  font:   { color: PT.font, family: 'Inter, sans-serif', size: 11 },
                  legend: { bgcolor: 'rgba(0,0,0,0)', font: { color: PT.font, size: 10 }, orientation: 'h' as const, y: -0.18 },
                  xaxis:  {
                    type:        logScale ? 'log' as const : 'linear' as const,
                    gridcolor:   PT.grid, linecolor: PT.line, tickcolor: PT.line, automargin: true,
                    title:       { text: 'Early Phase Revenue (₹)' },
                    ...(logScale ? plotlyInrLogTickVals(maxAxis) : plotlyInrTickVals(maxAxis)),
                  },
                  yaxis:  {
                    type:        logScale ? 'log' as const : 'linear' as const,
                    gridcolor:   PT.grid, linecolor: PT.line, tickcolor: PT.line, automargin: true,
                    title:       { text: 'Recent Phase Revenue (₹)' },
                    ...(logScale ? plotlyInrLogTickVals(maxAxis) : plotlyInrTickVals(maxAxis)),
                  },
                  hovermode:  'closest' as const,
                  margin:     { l: 80, r: 20, t: 8, b: 90 },
                  height:     460,
                  uirevision: 'constant',
                  annotations: [
                    {
                      x: 0.02, y: 0.98, xref: 'paper' as const, yref: 'paper' as const,
                      text: '▲ Growth Zone', showarrow: false,
                      font: { color: '#10b981', size: 11, family: 'Inter, sans-serif' },
                      align: 'left' as const, xanchor: 'left' as const, yanchor: 'top' as const,
                    },
                    {
                      x: 0.98, y: 0.02, xref: 'paper' as const, yref: 'paper' as const,
                      text: '▼ Decline Zone', showarrow: false,
                      font: { color: '#dc2626', size: 11, family: 'Inter, sans-serif' },
                      align: 'right' as const, xanchor: 'right' as const, yanchor: 'bottom' as const,
                    },
                  ],
                }}
                config={{ displayModeBar: false, responsive: true }}
                style={{ width: '100%', cursor: 'pointer' }}
                onClick={handlePlotClick}
                onDoubleClick={handlePlotDoubleClick}
              />

              <motion.div
                initial={false}
                animate={{ opacity: hintStoreId ? 1 : 0, y: hintStoreId ? 0 : 4 }}
                transition={{ duration: 0.15 }}
                className="mt-2 flex items-center gap-2 text-[11px] text-blue-600 bg-blue-50 border border-blue-100 rounded-lg px-3 py-1.5"
                style={{ pointerEvents: 'none' }}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse shrink-0" />
                <span>
                  <span className="font-semibold">{hintStoreId}</span>
                  {hintStoreId && ' selected — double-click to open Store Spotlight'}
                </span>
              </motion.div>
            </>
          ) : (
            <div className={emptyMsg}>Not enough data to render scatter plot</div>
          )
        ) : (
          /* ── Category Breakdown grid ─────────────────────────────────── */
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {CATEGORY_ORDER.map(cat => {
              const catEntry = breakdownData.find(d => d.cat === cat)
              const count    = counts[cat]
              const pct      = classified.length > 0 ? Math.round((count / classified.length) * 100) : 0
              return (
                <div
                  key={cat}
                  className="rounded-xl border border-gray-200 bg-white p-4 flex flex-col gap-2 shadow-sm"
                  style={{ borderTopColor: CATEGORY_COLOR[cat], borderTopWidth: 3 }}
                >
                  {/* Header */}
                  <div className="flex items-center gap-2">
                    <span style={{ color: CATEGORY_COLOR[cat] }}>{CATEGORY_ICON[cat]}</span>
                    <h4 className="text-sm font-semibold" style={{ color: CATEGORY_COLOR[cat] }}>
                      {cat}
                    </h4>
                  </div>

                  {/* KPI */}
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-xl font-bold text-gray-900 tabular-nums">{count}</span>
                    <span className="text-[11px] text-gray-500">Stores ({pct}%)</span>
                  </div>

                  {/* Mini scatter */}
                  {catEntry && catEntry.traces.length > 0 ? (
                    <Plot
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      data={catEntry.traces as any}
                      layout={{
                        paper_bgcolor: 'rgba(0,0,0,0)',
                        plot_bgcolor:  'rgba(0,0,0,0)',
                        font:       { color: PT.font, family: 'Inter, sans-serif', size: 10 },
                        showlegend: false,
                        xaxis: {
                          type:       logScale ? 'log' as const : 'linear' as const,
                          gridcolor:  PT.grid, linecolor: PT.line, tickcolor: PT.line, automargin: true,
                          title:      { text: 'Early (₹)', font: { size: 9 } },
                          ...(logScale ? plotlyInrLogTickVals(catEntry.traces.length ? Math.max(...(catEntry.traces[1] as any).x) : 1) : plotlyInrTickVals(catEntry.traces.length ? Math.max(...(catEntry.traces[1] as any).x) : 1)),
                        },
                        yaxis: {
                          type:       logScale ? 'log' as const : 'linear' as const,
                          gridcolor:  PT.grid, linecolor: PT.line, tickcolor: PT.line, automargin: true,
                          title:      { text: 'Recent (₹)', font: { size: 9 } },
                          ...(logScale ? plotlyInrLogTickVals(catEntry.traces.length ? Math.max(...(catEntry.traces[1] as any).y) : 1) : plotlyInrTickVals(catEntry.traces.length ? Math.max(...(catEntry.traces[1] as any).y) : 1)),
                        },
                        hovermode:  'closest' as const,
                        margin:     { l: 65, r: 8, t: 8, b: 55 },
                        height:     210,
                        uirevision: `mini-${cat}`,
                      }}
                      config={{ displayModeBar: false, responsive: true }}
                      style={{ width: '100%', cursor: 'pointer' }}
                      onClick={handlePlotClick}
                      onDoubleClick={handlePlotDoubleClick}
                    />
                  ) : (
                    <div className="h-[210px] flex items-center justify-center text-gray-400 text-xs">
                      No stores in this category
                    </div>
                  )}

                  {/* Insight footer */}
                  <p className="text-[11px] text-gray-400 italic">{CATEGORY_INSIGHT[cat]}</p>
                </div>
              )
            })}
          </div>
        )}
      </motion.div>

      {/* Filterable Table */}
      <motion.div {...panelSpring(0.2)} className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
          <div>
            <h3 className="text-sm font-semibold text-gray-800">All Stores</h3>
            <p className="text-[11px] text-gray-500 mt-0.5">
              {tableRows.length} stores
              {activeCategory ? ` · filtered to "${activeCategory}"` : ' · all categories'}
              {onNavigateToStore ? ' · click any row to open Store Spotlight' : ''}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleExportCsv}
              className="flex items-center gap-1 text-xs text-emerald-700 hover:text-emerald-600 transition-colors px-2 py-1.5 rounded border border-emerald-200 bg-emerald-50 whitespace-nowrap"
              title="Download CSV"
            >
              <Download className="h-3 w-3" /> CSV
            </button>
            <select
              value={activeCategory ?? ''}
              onChange={e => setActiveCategory((e.target.value as StoreCategory) || null)}
              className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-400 cursor-pointer"
            >
              <option value="">All categories ({classified.length})</option>
              {CATEGORY_ORDER.map(cat => (
                <option key={cat} value={cat}>
                  {cat} ({counts[cat]})
                </option>
              ))}
            </select>
            {activeCategory && (
              <button
                onClick={() => setActiveCategory(null)}
                className="text-xs text-blue-600 hover:text-blue-500 transition-colors px-2 py-1 rounded border border-blue-200 bg-blue-50 whitespace-nowrap"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="px-3 py-2.5 text-left text-xs text-gray-400 w-8">#</th>
                <th className="px-3 py-2.5 text-left">
                  <button onClick={() => toggleSort('name')}
                    className="flex items-center gap-1 text-xs font-medium uppercase tracking-wider text-gray-500 hover:text-gray-700 transition-colors">
                    Store Name{sortIcon('name')}
                  </button>
                </th>
                <th className="px-3 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-gray-500">State</th>
                <th className="px-3 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Plan Category</th>
                <th className="px-3 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Product Subcategory</th>
                <th className="px-3 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Classification</th>
                <th className="px-3 py-2.5 text-right">
                  <button onClick={() => toggleSort('early')}
                    className="flex items-center gap-1 text-xs font-medium uppercase tracking-wider text-gray-500 hover:text-gray-700 transition-colors ml-auto">
                    Early Rev{sortIcon('early')}
                  </button>
                </th>
                <th className="px-3 py-2.5 text-right">
                  <button onClick={() => toggleSort('mid')}
                    className="flex items-center gap-1 text-xs font-medium uppercase tracking-wider text-gray-500 hover:text-gray-700 transition-colors ml-auto">
                    Mid Rev{sortIcon('mid')}
                  </button>
                </th>
                <th className="px-3 py-2.5 text-right">
                  <button onClick={() => toggleSort('recent')}
                    className="flex items-center gap-1 text-xs font-medium uppercase tracking-wider text-gray-500 hover:text-gray-700 transition-colors ml-auto">
                    Recent Rev{sortIcon('recent')}
                  </button>
                </th>
                <th className="px-3 py-2.5 text-right">
                  <button onClick={() => toggleSort('growth')}
                    className="flex items-center gap-1 text-xs font-medium uppercase tracking-wider text-gray-500 hover:text-gray-700 transition-colors ml-auto">
                    Growth %{sortIcon('growth')}
                  </button>
                </th>
                <th className="px-3 py-2.5 text-right text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">Early Plans</th>
                <th className="px-3 py-2.5 text-right text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">Mid Plans</th>
                <th className="px-3 py-2.5 text-right text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">Recent Plans</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.length === 0 ? (
                <tr>
                  <td colSpan={13} className="px-3 py-10 text-center text-gray-400 text-sm">No stores match</td>
                </tr>
              ) : (
                tableRows.map(({ store, earlyTotal, midTotal, recentTotal, growthPct, category, earlyPlans, midPlans, recentPlans }, i) => (
                  <tr
                    key={store.store_id}
                    onClick={() => onNavigateToStore?.(store.store_id)}
                    className={cn(
                      'border-b border-gray-100 transition-colors',
                      onNavigateToStore
                        ? 'cursor-pointer hover:bg-blue-50/40'
                        : 'hover:bg-gray-50',
                    )}
                  >
                    <td className="px-3 py-2.5 text-gray-400 tabular-nums text-xs">{i + 1}</td>
                    <td className="px-3 py-2.5">
                      <span className="text-gray-800 font-medium block truncate max-w-[180px]" title={store.store_name ?? store.store_id}>
                        {store.store_name ?? store.store_id}
                      </span>
                      <span className="text-[10px] text-gray-400">{store.store_id}</span>
                    </td>
                    <td className="px-3 py-2.5 text-gray-500 text-xs whitespace-nowrap">{store.state ?? '—'}</td>
                    <td className="px-3 py-2.5 text-gray-500 text-xs whitespace-nowrap">
                      {filters.planCategory || getStorePlanCategories(store)}
                    </td>
                    <td className="px-3 py-2.5 text-gray-500 text-xs whitespace-nowrap">
                      {store.category ? (store.category.charAt(0).toUpperCase() + store.category.slice(1)) : '—'}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={cn('inline-block text-[11px] px-2 py-0.5 rounded-full font-medium whitespace-nowrap', CATEGORY_BADGE[category])}>
                        {category}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right text-gray-400 tabular-nums text-xs whitespace-nowrap">
                      {fmtInr(earlyTotal)}
                    </td>
                    <td className="px-3 py-2.5 text-right text-violet-600 tabular-nums text-xs whitespace-nowrap">
                      {fmtInr(midTotal)}
                    </td>
                    <td className="px-3 py-2.5 text-right text-gray-800 font-medium tabular-nums text-xs whitespace-nowrap">
                      {fmtInr(recentTotal)}
                    </td>
                    <td className={cn(
                      'px-3 py-2.5 text-right tabular-nums font-medium text-xs whitespace-nowrap',
                      growthPct === null ? 'text-gray-400' : growthPct > 0 ? 'text-emerald-600' : 'text-red-500',
                    )}>
                      {growthPct === null ? 'N/A' : fmtPct(growthPct)}
                    </td>
                    <td className="px-3 py-2.5 text-right text-gray-400 tabular-nums text-xs whitespace-nowrap">
                      {earlyPlans.toLocaleString()}
                    </td>
                    <td className="px-3 py-2.5 text-right text-violet-500 tabular-nums text-xs whitespace-nowrap">
                      {midPlans.toLocaleString()}
                    </td>
                    <td className="px-3 py-2.5 text-right text-gray-700 font-medium tabular-nums text-xs whitespace-nowrap">
                      {recentPlans.toLocaleString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </motion.div>

      {/* Classification Audit / Validation Panel */}
      <motion.div {...panelSpring(0.3)} className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <button
          onClick={() => setAuditOpen(o => !o)}
          className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 transition-colors"
        >
          <div>
            <h3 className="text-sm font-semibold text-gray-700">Classification Audit Panel</h3>
            <p className="text-[11px] text-gray-400 mt-0.5">Phase metadata · engine outputs · for debugging and validation</p>
          </div>
          <ChevronRight
            className={cn('h-4 w-4 text-gray-400 transition-transform', auditOpen && 'rotate-90')}
          />
        </button>

        {auditOpen && (
          <div className="border-t border-gray-100 px-4 py-4 space-y-4">

            {/* Phase months */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {(
                [
                  { label: 'Early Phase', months: phases.earlyMonths, color: 'bg-slate-50 border-slate-200 text-slate-700' },
                  { label: 'Mid Phase',   months: phases.midMonths,   color: 'bg-violet-50 border-violet-200 text-violet-700' },
                  { label: 'Recent Phase',months: phases.recentMonths,color: 'bg-blue-50 border-blue-200 text-blue-700' },
                ] as const
              ).map(({ label, months, color }) => (
                <div key={label} className={cn('rounded-lg border p-3', color)}>
                  <p className="text-[10px] font-bold uppercase tracking-wider mb-2">{label} ({months.length} months)</p>
                  {months.length === 0 ? (
                    <p className="text-[11px] opacity-60">No months</p>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {months.map(m => (
                        <span key={m} className="text-[10px] px-1.5 py-0.5 rounded bg-white/60 font-mono border border-current/20">
                          {m}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Category counts — global (full dataset, no filter) */}
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-2">
                Classification Counts — Full Dataset
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                {CATEGORY_ORDER.map(cat => (
                  <div key={cat} className="rounded-lg border border-gray-200 bg-gray-50 p-2.5">
                    <p className="text-[10px] font-semibold truncate" style={{ color: CATEGORY_COLOR[cat] }}>
                      {cat}
                    </p>
                    <p className="text-xl font-bold text-gray-900 tabular-nums mt-0.5">
                      {globalCounts[cat]}
                    </p>
                    <p className="text-[10px] text-gray-400">
                      {classification.metrics.length > 0
                        ? `${((globalCounts[cat] / classification.metrics.length) * 100).toFixed(1)}%`
                        : '—'}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <p className="text-[10px] text-gray-400">
              Total months detected: <span className="font-semibold">{phases.earlyMonths.length + phases.midMonths.length + phases.recentMonths.length}</span>
              {' · '}Total stores: <span className="font-semibold">{classification.metrics.length}</span>
              {' · '}Engine: classificationEngine.ts · Thresholds: classificationConfig.ts
            </p>
          </div>
        )}
      </motion.div>

    </div>
  )
}
