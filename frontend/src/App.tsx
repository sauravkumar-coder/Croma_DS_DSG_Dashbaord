import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Database, Moon, RotateCcw, Sun } from 'lucide-react'
import { useDataContext } from './contexts/DataContext'
import { useFilters, type FilterState } from './hooks/useFilters'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './components/ui/select'
import UploadScreen from './components/UploadScreen'
import ExecutiveOverview from './components/tabs/ExecutiveOverview'
import MonthlyRevenue from './components/tabs/MonthlyRevenue'
import StoreJourneyMap from './components/tabs/StoreJourneyMap'
import GeoAnalytics from './components/tabs/GeoAnalytics'
import StateAnalytics from './components/tabs/StateAnalytics'
import RisingStars from './components/tabs/RisingStars'
import FallenStars from './components/tabs/FallenStars'
import RevenueMovers from './components/tabs/RevenueMovers'
import StoreDeepDive from './components/tabs/StoreDeepDive'
import { cn } from './lib/utils'

// ── Tab registry ──────────────────────────────────────────────────────────────

const TABS = [
  { id: 'executive',       label: 'Executive Overview' },
  { id: 'monthly-revenue', label: 'Monthly Revenue' },
  { id: 'store-journey',   label: 'Store Journey Map' },
  { id: 'geo',             label: 'Geo Analytics' },
  { id: 'state',           label: 'State Analytics' },
  { id: 'rising-stars',    label: 'Rising Stars' },
  { id: 'fallen-stars',    label: 'Fallen Stars' },
  { id: 'revenue-movers',  label: 'Revenue Movers' },
  { id: 'store-deep-dive', label: 'Store Deep Dive' },
  { id: 'target-command',  label: 'Target Command Center' },
] as const

type TabId = typeof TABS[number]['id']

// Radix Select requires non-empty values; use a sentinel for "all / no filter"
const ALL = '__all__'
const toSel = (v: string) => v || ALL
const fromSel = (v: string) => (v === ALL ? '' : v)

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
      <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
        <span className="h-1.5 w-1.5 rounded-full bg-gray-400 dark:bg-gray-600" />
        No Data
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium bg-emerald-50 dark:bg-emerald-900/25 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/50">
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
}: {
  states: string[]
  categories: string[]
  months: string[]
  filters: FilterState
  onFilterChange: (key: keyof FilterState, value: string) => void
  onReset: () => void
  activeCount: number
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

      {/* Category */}
      <Select
        value={toSel(filters.category)}
        onValueChange={v => onFilterChange('category', fromSel(v))}
      >
        <SelectTrigger className="h-8 w-40 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All Categories</SelectItem>
          {categories.map(c => (
            <SelectItem key={c} value={c}>{c}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* From Month */}
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-gray-500 dark:text-gray-400 select-none">From</span>
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
        <span className="text-xs text-gray-500 dark:text-gray-400 select-none">To</span>
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
            ? 'bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-500/20'
            : 'text-gray-400 dark:text-gray-600 cursor-default',
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
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/50 min-h-[420px] flex flex-col items-center justify-center gap-4 p-8">
      <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-blue-500/15 to-cyan-400/15 dark:from-blue-500/20 dark:to-cyan-400/20 flex items-center justify-center">
        <Database className="h-6 w-6 text-blue-500 dark:text-blue-400" />
      </div>
      <div className="text-center">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{label}</h3>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 max-w-xs">
          Tab content coming soon.
        </p>
      </div>
      {active.length > 0 && (
        <div className="flex flex-wrap justify-center gap-1.5 mt-1">
          {active.map(([k, v]) => (
            <span
              key={k}
              className="inline-flex items-center rounded-full px-2 py-0.5 text-xs bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-500/20"
            >
              {k}: {v}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main App ──────────────────────────────────────────────────────────────────

export default function App() {
  const { isLoading, hasData, stores, months, states, categories, refetchData } =
    useDataContext()

  const [isDark, setIsDark] = useState(true)
  const [activeTab, setActiveTab] = useState<TabId>('executive')

  const { getFilters, setFilter, resetFilters, getActiveCount } = useFilters()

  // Keep <html class="dark"> in sync with toggle state
  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark)
  }, [isDark])

  // Ensure dark mode is applied before the first paint
  useEffect(() => {
    document.documentElement.classList.add('dark')
  }, [])

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

  // ── Loading spinner (initial server check) ────────────────────────────────

  if (isLoading) {
    return (
      <div className="fixed inset-0 bg-[#080f20] flex items-center justify-center">
        <div className="h-8 w-8 rounded-full border-2 border-white/10 border-t-blue-500 animate-spin" />
      </div>
    )
  }

  // ── Upload / onboarding screen ────────────────────────────────────────────

  if (!hasData) {
    return <UploadScreen onReady={refetchData} />
  }

  // ── Main dashboard ────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100 transition-colors duration-200">

      {/* ── Top Nav ── */}
      <header className="sticky top-0 z-50 h-16 border-b border-gray-200 dark:border-gray-800 bg-white/95 dark:bg-gray-950/95 backdrop-blur-sm">
        <div className="flex items-center justify-between h-full px-4 max-w-screen-2xl mx-auto gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <span className="shrink-0 inline-flex items-center justify-center px-3 h-8 rounded-full bg-gradient-to-r from-blue-600 to-cyan-400 text-white text-sm font-bold tracking-wide select-none shadow-sm">
              SW
            </span>
            <div className="min-w-0">
              <p className="text-base font-bold text-gray-900 dark:text-white leading-none truncate">
                StoreWise
              </p>
              <p className="text-[10px] text-gray-500 dark:text-gray-400 leading-tight mt-0.5">
                Store Analytics Platform
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <DataStatusChip
              storeCount={stores.length}
              monthCount={months.length}
            />
            <button
              onClick={() => setIsDark(d => !d)}
              aria-label="Toggle dark mode"
              className="flex items-center justify-center h-8 w-8 rounded-md text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </header>

      {/* ── Tab Bar (sticky top-16 = 64 px) ── */}
      <div className="sticky top-16 z-40 border-b border-gray-200 dark:border-gray-800 bg-white/95 dark:bg-gray-950/95 backdrop-blur-sm overflow-x-auto scrollbar-hide">
        <div className="flex items-center h-12 px-4 gap-0.5 min-w-max max-w-screen-2xl mx-auto">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'relative px-3 py-1.5 text-sm font-medium rounded-md whitespace-nowrap transition-colors',
                activeTab === tab.id
                  ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800/60',
              )}
            >
              {tab.label}
              {activeTab === tab.id && (
                <motion.span
                  layoutId="tab-underline"
                  className="absolute inset-x-0 -bottom-[1px] h-0.5 bg-blue-500 dark:bg-blue-400 rounded-t"
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── Filter Bar (sticky top-28 = 112 px = 64+48) ── */}
      <div className="sticky top-28 z-30 border-b border-gray-200 dark:border-gray-800 bg-white/90 dark:bg-gray-950/90 backdrop-blur-sm">
        <div className="px-4 py-2 max-w-screen-2xl mx-auto">
          <FilterBar
            states={states}
            categories={categories}
            months={months}
            filters={filters}
            onFilterChange={handleFilterChange}
            onReset={handleReset}
            activeCount={activeCount}
          />
        </div>
      </div>

      {/* ── Tab Content ── */}
      <main className="px-4 py-6 max-w-screen-2xl mx-auto">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
          >
            {activeTab === 'executive'
              ? <ExecutiveOverview filters={filters} />
              : activeTab === 'monthly-revenue'
                ? <MonthlyRevenue filters={filters} />
                : activeTab === 'store-journey'
                  ? <StoreJourneyMap filters={filters} />
                  : activeTab === 'geo'
                    ? <GeoAnalytics filters={filters} />
                    : activeTab === 'state'
                      ? <StateAnalytics filters={filters} />
                      : activeTab === 'rising-stars'
                        ? <RisingStars filters={filters} />
                        : activeTab === 'fallen-stars'
                          ? <FallenStars filters={filters} />
                          : activeTab === 'revenue-movers'
                            ? <RevenueMovers filters={filters} />
                            : activeTab === 'store-deep-dive'
                              ? <StoreDeepDive filters={filters} />
                              : <TabPlaceholder label={currentTab.label} filters={filters} />
            }
          </motion.div>
        </AnimatePresence>
      </main>

    </div>
  )
}
