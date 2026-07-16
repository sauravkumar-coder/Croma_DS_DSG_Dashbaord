import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { Routes, Route, Link } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Database, ExternalLink, RotateCcw, Target, X, Filter, PieChart, ChevronDown } from 'lucide-react'
import { useDataContext } from './contexts/DataContext'
import { useRetailerContext } from './contexts/RetailerContext'
import { useFilters, type FilterState } from './hooks/useFilters'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './components/ui/select'
import { AppSkeleton } from './components/Skeleton'
import StoreDeepDivePage from './pages/StoreDeepDivePage'
import TargetTrackerPage from './pages/TargetTrackerPage'
import ExecutiveOverview from './components/tabs/ExecutiveOverview'
import StoreJourneyMap from './components/tabs/StoreJourneyMap'
import PlanLevelInsight from './components/tabs/PlanLevelInsight'
import StoreDeepDive from './components/tabs/StoreDeepDive'
import TargetCommandCenter from './components/tabs/TargetCommandCenter'
import StateJourneyAnalysis from './components/tabs/StateJourneyAnalysis'
import AttachPerformance from './components/tabs/AttachPerformance'
import { cn } from './lib/utils'
import type { StoreCategory } from './lib/classificationEngine'
import { RETAILER_IDS, getRetailerConfig } from './retailers/retailerFactory'
import { ScreenshotButton } from './components/ScreenshotButton'

// ── Tab registry ──────────────────────────────────────────────────────────────

// Narrative order — each section answers a business question:
//  1-2  Business Snapshot:    "What is happening overall?"
//  3-5  Performance Breakdown: "Where is performance coming from?"
//  6-8  Momentum & Risk:      "What is changing, and where should we act?"
const TABS = [
  { id: 'executive',      label: 'Overview' },
  { id: 'plan_insights',  label: 'Plan Insights' },
  { id: 'attach_perf',   label: 'Attach Performance' },
  { id: 'state-journey', label: 'State Level Performance' },
  { id: 'store-journey', label: 'Store Level Insight' },
] as const

type TabId = typeof TABS[number]['id']

// Radix Select requires non-empty values; use a sentinel for "all / no filter"
const ALL = '__all__'
const toSel = (v: string) => v || ALL
const fromSel = (v: string) => (v === ALL ? '' : v)

import { RetailerToggle } from './components/RetailerToggle'

// ── Sub-components ────────────────────────────────────────────────────────────

function DataStatusChip({
  storeCount,
  monthCount,
}: {
  storeCount: number
  monthCount: number
}) {
  if (storeCount === 0) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium bg-gray-100 text-gray-500">
        <span className="h-1.5 w-1.5 rounded-full bg-gray-400" />
        No Data
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
      {storeCount} store{storeCount !== 1 ? 's' : ''} &middot;{' '}
      {monthCount} month{monthCount !== 1 ? 's' : ''} loaded
    </span>
  )
}

function FilterBar({
  states,
  categories,
  months,
  filters,
  onFilterChange,
  onReset,
  activeCount,
  showEW,
}: {
  states: string[]
  categories: string[]
  months: string[]
  filters: FilterState
  onFilterChange: (key: keyof FilterState, value: string) => void
  onReset: () => void
  activeCount: number
  showEW: boolean
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* State */}
      <Select
        value={toSel(filters.state)}
        onValueChange={v => onFilterChange('state', fromSel(v))}
      >
        <SelectTrigger className="h-8 w-36 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All States</SelectItem>
          {states.map(s => (
            <SelectItem key={s} value={s}>{s}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Plan Category */}
      <Select
        value={toSel(filters.planCategory)}
        onValueChange={v => onFilterChange('planCategory', fromSel(v))}
      >
        <SelectTrigger className="h-8 w-44 text-xs">
          <SelectValue placeholder="All Plan Categories" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All Plan Categories</SelectItem>
          <SelectItem value="SP">SP</SelectItem>
          <SelectItem value="ADLD">ADLD</SelectItem>
          <SelectItem value="Combo">Combo</SelectItem>
          {showEW && <SelectItem value="EW">EW</SelectItem>}
        </SelectContent>
      </Select>

      {/* Product Subcategory */}
      <Select
        value={toSel(filters.productSubcategory)}
        onValueChange={v => onFilterChange('productSubcategory', fromSel(v))}
      >
        <SelectTrigger className="h-8 w-48 text-xs">
          <SelectValue placeholder="All Product Subcategories" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All Product Subcategories</SelectItem>
          {categories.map(c => (
            <SelectItem key={c} value={c.toLowerCase()}>{c}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Target Month */}
      <div className="flex items-center gap-1.5 ml-2">
        <span className="text-xs text-gray-500 font-medium select-none">Target Month:</span>
        <Select
          value={toSel(filters.targetMonth)}
          onValueChange={v => onFilterChange('targetMonth', fromSel(v))}
        >
          <SelectTrigger className="h-8 w-32 text-xs font-semibold bg-white border-blue-200">
            <SelectValue placeholder="Latest" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Latest (Default)</SelectItem>
            {months.map(m => (
              <SelectItem key={m} value={m}>{m}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* From Month */}
      <div className="flex items-center gap-1.5 ml-4">
        <span className="text-xs text-gray-500 select-none">From</span>
        <Select
          value={toSel(filters.fromMonth)}
          onValueChange={v => onFilterChange('fromMonth', fromSel(v))}
        >
          <SelectTrigger className="h-8 w-32 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Earliest</SelectItem>
            {months.map(m => (
              <SelectItem key={m} value={m}>{m}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* To Month */}
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-gray-500 select-none">To</span>
        <Select
          value={toSel(filters.toMonth)}
          onValueChange={v => onFilterChange('toMonth', fromSel(v))}
        >
          <SelectTrigger className="h-8 w-32 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Latest</SelectItem>
            {months.map(m => (
              <SelectItem key={m} value={m}>{m}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Reset + active filter count badge */}
      <button
        onClick={onReset}
        disabled={activeCount === 0}
        className={cn(
          'inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium transition-colors',
          activeCount > 0
            ? 'bg-blue-50 text-blue-600 hover:bg-blue-100'
            : 'text-gray-400 cursor-default',
        )}
      >
        <RotateCcw className="h-3 w-3" />
        Reset
        {activeCount > 0 && (
          <span className="ml-0.5 inline-flex items-center justify-center h-4 w-4 rounded-full bg-blue-500 text-white text-[10px] font-bold leading-none">
            {activeCount}
          </span>
        )}
      </button>
    </div>
  )
}

function TabPlaceholder({ label, filters }: { label: string; filters: FilterState }) {
  const active = Object.entries(filters).filter(([, v]) => Boolean(v))
  return (
    <div className="rounded-xl border border-gray-200 bg-white min-h-[420px] flex flex-col items-center justify-center gap-4 p-8">
      <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-blue-500/15 to-cyan-400/15 flex items-center justify-center">
        <Database className="h-6 w-6 text-blue-500" />
      </div>
      <div className="text-center">
        <h3 className="text-lg font-semibold text-gray-900">{label}</h3>
        <p className="mt-1 text-sm text-gray-500 max-w-xs">
          Tab content coming soon.
        </p>
      </div>
      {active.length > 0 && (
        <div className="flex flex-wrap justify-center gap-1.5 mt-1">
          {active.map(([k, v]) => (
            <span
              key={k}
              className="inline-flex items-center rounded-full px-2 py-0.5 text-xs bg-blue-50 text-blue-700 border border-blue-200"
            >
              {k}: {v}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

const TOPICS = [
  {
    tabId: 'executive',
    tabLabel: 'Overview',
    items: [
      { id: 'daily-performance-vs-required-pace', label: 'Daily Performance vs Required Pace' },
      { id: 'geographic-performance-india', label: 'Geographic Performance' },
      { id: 'state-target-analysis', label: 'State Target Analysis' },
      { id: 'achievement-distribution', label: 'Achievement Distribution' },
      { id: 'store-command-center', label: 'Store Command Center' },
    ]
  },
  {
    tabId: 'plan_insights',
    tabLabel: 'Plan Insights',
    items: [
      { id: 'plan-contribution', label: 'Plan Contribution' },
      { id: 'regional-performance', label: 'Regional Performance' },
      { id: 'past-6-months-trend', label: 'Past 6 Months Trend' },
      { id: 'store-level-plan-performance', label: 'Store Level Plan Performance' },
    ]
  },
  {
    tabId: 'attach_perf',
    tabLabel: 'Attach Performance',
    items: [
      { id: 'month-on-month-attach-lift-or-drop', label: 'Month-on-Month Attach % Lift/Drop' },
      { id: 'monthly-plan-units-attach-pct', label: 'Monthly Plan Units + Attach %' },
      { id: 'state-wise-attach-pct', label: 'State-wise Attach %' },
      { id: 'attach-pct-vs-plans-sold-scatter', label: 'Attach % vs Plans Sold Scatter' },
      { id: 'store-attach-performance', label: 'Store Attach Performance' },
    ]
  },
  {
    tabId: 'state-journey',
    tabLabel: 'State Level Performance',
    items: [
      { id: 'network-store-journey-funnel', label: 'Network Store Journey Funnel' },
      { id: 'state-performance-leaderboard', label: 'State Performance Leaderboard' },
    ]
  },
  {
    tabId: 'store-journey',
    tabLabel: 'Store Level Insight',
    items: [
      { id: 'store-journey-scatter', label: 'Store Journey Scatter' },
      { id: 'all-stores-insight', label: 'All Stores' },
    ]
  }
] as const

function GlobalNavDropdown({
  activeTab,
  onSelectTab,
  accentFrom,
  accentTo,
  hasAttachPerformance,
}: {
  activeTab: TabId
  onSelectTab: (id: TabId) => void
  accentFrom: string
  accentTo: string
  hasAttachPerformance: boolean
}) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const visibleTopics = TOPICS.filter(t => t.tabId !== 'attach_perf' || hasAttachPerformance)

  useEffect(() => {
    if (!open) return
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    const handleEscape = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [open])

  const currentLabel = TABS.find(t => t.id === activeTab)?.label ?? 'Navigate'

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          'inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-semibold border transition-colors',
          open
            ? 'bg-blue-50 text-blue-600 border-blue-200'
            : 'bg-white text-gray-600 border-gray-200 hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200',
        )}
      >
        <PieChart className="h-3.5 w-3.5" />
        <span className="hidden sm:inline max-w-[10rem] truncate">{currentLabel}</span>
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            role="menu"
            className="absolute right-0 top-full mt-2 w-80 rounded-xl border border-gray-200 bg-white shadow-lg overflow-hidden z-50"
          >
            <div className="max-h-[400px] overflow-y-auto divide-y divide-gray-100">
              {visibleTopics.map(category => (
                <div key={category.tabId} className="p-1.5">
                  <p className="px-2.5 pt-1.5 pb-1 text-[10px] font-bold uppercase tracking-wider text-gray-400">
                    {category.tabLabel}
                  </p>
                  <div className="space-y-0.5">
                    {category.items.map(item => {
                      return (
                        <button
                          key={item.id}
                          role="menuitem"
                          onClick={() => {
                            onSelectTab(category.tabId)
                            setOpen(false)
                            
                            // Scroll to target element with highlight
                            setTimeout(() => {
                              const el = document.getElementById(item.id)
                              if (el) {
                                el.scrollIntoView({ behavior: 'smooth', block: 'start' })
                                
                                // Flash ring highlight effect
                                el.classList.add('ring-2', 'ring-blue-500', 'ring-offset-2', 'transition-all', 'duration-500')
                                setTimeout(() => {
                                  el.classList.remove('ring-2', 'ring-blue-500', 'ring-offset-2')
                                }, 2000)
                              }
                            }, 200)
                          }}
                          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[11px] text-left text-gray-700 hover:bg-blue-50 hover:text-blue-600 transition-colors cursor-pointer"
                        >
                          <span className="h-1 w-1 shrink-0 rounded-full bg-gray-300" />
                          {item.label}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>

            <p className="px-3.5 pt-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400 border-t border-gray-100">
              Tools
            </p>
            <div className="px-1.5 pb-1.5">
              <Link
                to="/target-tracker"
                role="menuitem"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <Target className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                Target Tracker
                <ExternalLink className="h-3 w-3 text-gray-300 ml-auto shrink-0" />
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Main App ──────────────────────────────────────────────────────────────────

export default function App() {
  const { isLoading, hasData, stores, months, states, categories, refetchData, error } =
    useDataContext()
  const { retailer, retailerCfg, setRetailer: _sr } = useRetailerContext()
  void _sr // consumed via RetailerToggle

  const [activeTab, setActiveTab]         = useState<TabId>('executive')
  const [isFiltersOpen, setIsFiltersOpen] = useState(true)
  const [selectedSpotlightStoreId, setSelectedSpotlightStoreId] = useState<string | null>(null)
  const [isSyncing, setIsSyncing] = useState(false)
  const [, startTransition] = useTransition()

  // Manual sync handler with spinner
  const handleSync = useCallback(async () => {
    setIsSyncing(true)
    startTransition(() => {})
    try {
      await refetchData()
    } finally {
      setIsSyncing(false)
    }
  }, [refetchData])

  // Auto-refresh has been disabled to prevent background refetches from disrupting the UI with skeleton states.
  // useEffect(() => {
  //   const interval = setInterval(() => { refetchData() }, 5 * 60 * 1000)
  //   return () => clearInterval(interval)
  // }, [refetchData])
  const [journeyPrefilter, setJourneyPrefilter] = useState<StoreCategory | null>(null)

  const handleNavigateToStore = useCallback((storeId: string) => {
    setSelectedSpotlightStoreId(storeId)
  }, [])

  const handleNavigateToJourneyCategory = useCallback((category: StoreCategory) => {
    setJourneyPrefilter(category)
    setActiveTab('store-journey')
  }, [])

  // Show skeleton for at least 400 ms to prevent content flash on fast loads
  const [skeletonDone, setSkeletonDone] = useState(false)
  const skeletonTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (isLoading) {
      setSkeletonDone(false)
    } else {
      skeletonTimer.current = setTimeout(() => setSkeletonDone(true), 400)
      return () => { if (skeletonTimer.current) clearTimeout(skeletonTimer.current) }
    }
  }, [isLoading])

  // Always light mode — remove dark class on mount
  useEffect(() => { document.documentElement.classList.remove('dark') }, [])

  // Attach Performance only applies to Croma / Vijay Sales — bounce off it
  // if the user switches to a retailer where it doesn't exist.
  useEffect(() => {
    if (activeTab === 'attach_perf' && !retailerCfg.hasAttachPerformance) {
      setActiveTab('executive')
    }
  }, [activeTab, retailerCfg.hasAttachPerformance])

  const visibleTabs = TABS.filter(t => t.id !== 'attach_perf' || retailerCfg.hasAttachPerformance)

  const { getFilters, setFilter, resetFilters, getActiveCount } = useFilters()

  const filters = getFilters(activeTab)
  const activeCount = getActiveCount(activeTab)

  const handleFilterChange = useCallback(
    (key: keyof FilterState, value: string) => setFilter(activeTab, key, value),
    [activeTab, setFilter],
  )
  const handleReset = useCallback(
    () => resetFilters(activeTab),
    [activeTab, resetFilters],
  )

  const currentTab = TABS.find(t => t.id === activeTab)!

  function renderTab() {
    switch (activeTab) {
      case 'executive':     return <ExecutiveOverview filters={filters} />
      case 'plan_insights': return <PlanLevelInsight filters={filters} />
      case 'attach_perf':  return <AttachPerformance filters={filters} />
      case 'state-journey': return <StateJourneyAnalysis filters={filters} />
      case 'store-journey': return <StoreJourneyMap filters={filters} onNavigateToStore={handleNavigateToStore} initialCategory={journeyPrefilter} />
      default:              return <TabPlaceholder label={currentTab.label} filters={filters} />
    }
  }

  // ── Loading skeleton (initial server check + 400 ms min) ─────────────────

  if (isLoading || !skeletonDone) {
    return <AppSkeleton />
  }

  // ── Backend connection error ───────────────────────────────────────────────

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-8">
        <div className="max-w-md w-full rounded-2xl border border-red-200 bg-white p-8 shadow-sm text-center space-y-4">
          <div className="h-12 w-12 rounded-full bg-red-50 border border-red-100 flex items-center justify-center mx-auto">
            <Database className="h-6 w-6 text-red-400" />
          </div>
          <h2 className="text-lg font-bold text-gray-900">Unable to Connect</h2>
          <p className="text-sm text-gray-500">{error}</p>
          <button
            onClick={() => refetchData()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            <RotateCcw className="h-4 w-4" /> Retry
          </button>
        </div>
      </div>
    )
  }

  // ── Main dashboard ────────────────────────────────────────────────────────

  return (
    <Routes>
      <Route path="/store/:storeId" element={<StoreDeepDivePage />} />
      <Route path="/target-tracker" element={<TargetTrackerPage />} />
      <Route path="/*" element={
    <div className="min-h-screen bg-gray-50 text-gray-900">

      {/* ── Top Nav ── */}
      <header className="sticky top-0 z-50 h-16 border-b border-gray-200 bg-white/95 backdrop-blur-sm">
        <div className="flex items-center justify-between h-full px-4 max-w-screen-2xl mx-auto gap-4">
          <div className="flex items-center gap-3 min-w-0">
            {retailerCfg.logoPath ? (
              <img
                src={`${import.meta.env.BASE_URL}${retailerCfg.logoPath.replace(/^\//, '')}`}
                alt={`${retailerCfg.label} Logo`}
                className="h-9 w-auto max-w-[140px] object-contain shrink-0 rounded"
              />
            ) : (
              <span
                className="shrink-0 inline-flex items-center justify-center px-3 h-8 rounded-full text-white text-sm font-bold tracking-wide select-none shadow-sm"
                style={{ background: `linear-gradient(to right, ${retailerCfg.brandFrom}, ${retailerCfg.brandTo})` }}
              >
                {retailerCfg.short}
              </span>
            )}
            <div className="min-w-0">
              <p className="text-base font-bold text-gray-900 leading-none truncate">
                {retailerCfg.tagline}
              </p>
              <p className="text-[10px] text-gray-400 leading-tight mt-0.5 tracking-wide">
                {retailerCfg.sub}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {/* Global Navigation */}
            <GlobalNavDropdown
              activeTab={activeTab}
              onSelectTab={setActiveTab}
              accentFrom={retailerCfg.brandFrom}
              accentTo={retailerCfg.brandTo}
              hasAttachPerformance={retailerCfg.hasAttachPerformance}
            />

            {/* Retailer Toggle */}
            <RetailerToggle />

            <DataStatusChip
              storeCount={stores.length}
              monthCount={months.length}
            />

            {/* Sync Data button */}
            <button
              onClick={handleSync}
              disabled={isSyncing}
              title="Sync latest data from database"
              className={cn(
                'inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-semibold border transition-all',
                isSyncing
                  ? 'bg-blue-50 text-blue-400 border-blue-200 cursor-not-allowed'
                  : 'bg-white text-gray-600 border-gray-200 hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200',
              )}
            >
              <RotateCcw className={cn('h-3.5 w-3.5', isSyncing && 'animate-spin')} />
              {isSyncing ? 'Syncing…' : 'Sync Data'}
            </button>
          </div>
        </div>
      </header>

      {/* ── Tab Bar ── */}
      <div className="sticky top-16 z-40 border-b border-gray-200 bg-white/95 backdrop-blur-sm overflow-x-auto scrollbar-hide">
        <div className="flex items-center h-12 px-4 gap-0.5 min-w-max max-w-screen-2xl mx-auto">
          {visibleTabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'relative px-3 py-1.5 text-sm font-medium rounded-md whitespace-nowrap transition-colors',
                activeTab === tab.id
                  ? 'bg-blue-50'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100',
              )}
              style={activeTab === tab.id ? { color: retailerCfg.brandFrom } : {}}
            >
              {tab.label}
              {activeTab === tab.id && (
                <motion.span
                  layoutId="tab-underline"
                  className="absolute inset-x-0 -bottom-[1px] h-0.5 rounded-t"
                  style={{ background: `linear-gradient(to right, ${retailerCfg.brandFrom}, ${retailerCfg.brandTo})` }}
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                />
              )}
            </button>
          ))}
          <div className="ml-auto flex items-center pr-2">
            <button
              onClick={() => setIsFiltersOpen(!isFiltersOpen)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border transition-colors',
                isFiltersOpen ? 'bg-blue-50 text-blue-600 border-blue-200 shadow-sm' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
              )}
            >
              <Filter className="h-3.5 w-3.5" />
              {isFiltersOpen ? 'Hide Filters' : 'Show Filters'}
              {activeCount > 0 && !isFiltersOpen && (
                <span className="flex items-center justify-center h-4 w-4 rounded-full bg-blue-500 text-white text-[10px] font-bold leading-none ml-1">
                  {activeCount}
                </span>
              )}
            </button>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {isFiltersOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="sticky top-28 z-30 border-b border-gray-200 bg-white/90 backdrop-blur-sm overflow-hidden"
          >
            <div className="px-4 py-2 max-w-screen-2xl mx-auto">
              <FilterBar
                states={states}
                categories={categories}
                months={months}
                filters={filters}
                onFilterChange={handleFilterChange}
                onReset={handleReset}
                activeCount={activeCount}
                showEW={retailer !== 'croma'}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Tab Content ── */}
      <main className="px-4 py-6 pb-14 max-w-screen-2xl mx-auto">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
          >
            {renderTab()}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* ── Footer ── */}
      <footer className="fixed bottom-0 inset-x-0 z-20 h-10 flex items-center justify-center border-t border-gray-200 bg-white/95 backdrop-blur-sm">
        <span className="text-[11px] font-medium tracking-[0.18em] uppercase text-gray-400 select-none">
          {retailerCfg.footer}
        </span>
      </footer>

      {/* ── Store Spotlight Modal ── */}
      <AnimatePresence>
        {selectedSpotlightStoreId && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-7xl h-[90vh] overflow-hidden flex flex-col border border-slate-200 relative">
              <button
                onClick={() => setSelectedSpotlightStoreId(null)}
                className="absolute top-4 right-4 z-50 text-slate-400 hover:text-slate-600 transition-colors p-1.5 rounded-lg bg-white/80 hover:bg-slate-100 shadow-sm border border-slate-200/50"
                title="Close"
              >
                <X className="h-5 w-5" />
              </button>
              <div className="overflow-y-auto flex-1 p-6">
                <StoreDeepDive filters={filters} initialStoreId={selectedSpotlightStoreId} isModal={true} />
              </div>
            </div>
          </div>
        )}
      </AnimatePresence>

      {/* ── Screenshot FAB ── */}
      <ScreenshotButton />

    </div>
      } />
    </Routes>
  )
}
