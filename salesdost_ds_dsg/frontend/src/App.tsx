import { useCallback, useEffect, useRef, useState } from 'react'
import { Routes, Route } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Database, RotateCcw } from 'lucide-react'
import { useDataContext } from './contexts/DataContext'
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
import MonthlyRevenue from './components/tabs/MonthlyRevenue'
import StoreJourneyMap from './components/tabs/StoreJourneyMap'
import GeoAnalytics from './components/tabs/GeoAnalytics'
import RisingStars from './components/tabs/RisingStars'
import FallenStars from './components/tabs/FallenStars'
import RevenueMovers from './components/tabs/RevenueMovers'
import StoreDeepDive from './components/tabs/StoreDeepDive'
import TargetCommandCenter from './components/tabs/TargetCommandCenter'
import StateJourneyAnalysis from './components/tabs/StateJourneyAnalysis'
import { cn } from './lib/utils'
import type { StoreCategory } from './lib/classificationEngine'

// ── Tab registry ──────────────────────────────────────────────────────────────

const TABS = [
  { id: 'executive',       label: 'Overview'        },
  { id: 'monthly-revenue', label: 'Revenue Trend'   },
  { id: 'store-journey',   label: 'Store Journeys'  },
  { id: 'state-journey',   label: 'State Health'    },
  { id: 'geo',             label: 'Geo Map'         },
  { id: 'revenue-movers',  label: 'Top Movers'      },
  { id: 'rising-stars',    label: 'Rising Stores'   },
  { id: 'fallen-stars',    label: 'Fallen Stores'   },
  { id: 'store-deep-dive', label: 'Store Spotlight' },
  { id: 'target-command',  label: 'Target Pulse'    },
] as const

type TabId = typeof TABS[number]['id']

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

// ── Main App ──────────────────────────────────────────────────────────────────

export default function App() {
  const { isLoading, hasData, stores, months, states, categories, refetchData, error } =
    useDataContext()

  const [activeTab, setActiveTab]           = useState<TabId>('executive')
  const [deepDiveStoreId, setDeepDiveStoreId] = useState<string | null>(null)
  const [journeyPrefilter, setJourneyPrefilter] = useState<StoreCategory | null>(null)

  const handleNavigateToStore = useCallback((storeId: string) => {
    setDeepDiveStoreId(storeId)
    setActiveTab('store-deep-dive')
  }, [])

  const handleNavigateToJourneyCategory = useCallback((category: StoreCategory) => {
    setJourneyPrefilter(category)
    setActiveTab('store-journey')
  }, [])

  // Show skeleton for at least 400 ms to prevent content flash on fast loads
  const [skeletonDone, setSkeletonDone] = useState(false)
  const skeletonTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!isLoading) {
      skeletonTimer.current = setTimeout(() => setSkeletonDone(true), 400)
      return () => { if (skeletonTimer.current) clearTimeout(skeletonTimer.current) }
    }
  }, [isLoading])

  // Always light mode
  useEffect(() => { document.documentElement.classList.remove('dark') }, [])

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
      case 'executive':       return <ExecutiveOverview filters={filters} />
      case 'monthly-revenue': return <MonthlyRevenue filters={filters} />
      case 'store-journey':   return <StoreJourneyMap filters={filters} onNavigateToStore={handleNavigateToStore} initialCategory={journeyPrefilter} />
      case 'state-journey':   return <StateJourneyAnalysis filters={filters} />
      case 'geo':             return <GeoAnalytics filters={filters} />
      case 'revenue-movers':  return <RevenueMovers filters={filters} />
      case 'rising-stars':    return <RisingStars filters={filters} onNavigateToStore={handleNavigateToStore} onNavigateToJourneyCategory={handleNavigateToJourneyCategory} />
      case 'fallen-stars':    return <FallenStars filters={filters} onNavigateToStore={handleNavigateToStore} onNavigateToJourneyCategory={handleNavigateToJourneyCategory} />
      case 'store-deep-dive': return <StoreDeepDive filters={filters} initialStoreId={deepDiveStoreId} />
      case 'target-command':  return <TargetCommandCenter />
      default:                return null
    }
  }

  // ── Loading skeleton ─────────────────────────────────────────────────────

  if (isLoading || !skeletonDone) {
    return <AppSkeleton />
  }

  // ── Backend / MongoDB connection error ───────────────────────────────────

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

  // ── No data in MongoDB ───────────────────────────────────────────────────

  if (!hasData) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-8">
        <div className="max-w-md w-full rounded-2xl border border-gray-200 bg-white p-8 shadow-sm text-center space-y-4">
          <div className="h-12 w-12 rounded-full bg-blue-50 border border-blue-100 flex items-center justify-center mx-auto">
            <Database className="h-6 w-6 text-blue-400" />
          </div>
          <h2 className="text-lg font-bold text-gray-900">No Data in MongoDB</h2>
          <p className="text-sm text-gray-500">
            The dashboard is connected to MongoDB but no sales records were found for the current year.
            Please ensure the database is populated with store sales data.
          </p>
          <button
            onClick={() => refetchData()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            <RotateCcw className="h-4 w-4" /> Refresh
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
            <span className="shrink-0 inline-flex items-center justify-center px-3 h-8 rounded-full bg-gradient-to-r from-blue-600 to-cyan-400 text-white text-sm font-bold tracking-wide select-none shadow-sm">
              CR
            </span>
            <div className="min-w-0">
              <p className="text-base font-bold text-gray-900 leading-none truncate">
                Croma Analytics
              </p>
              <p className="text-[10px] text-gray-400 leading-tight mt-0.5 tracking-wide">
                DS · DSG Store Intelligence
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <DataStatusChip
              storeCount={stores.length}
              monthCount={months.length}
            />
          </div>
        </div>
      </header>

      {/* ── Tab Bar ── */}
      <div className="sticky top-16 z-40 border-b border-gray-200 bg-white/95 backdrop-blur-sm overflow-x-auto scrollbar-hide">
        <div className="flex items-center h-12 px-4 gap-0.5 min-w-max max-w-screen-2xl mx-auto">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'relative px-3 py-1.5 text-sm font-medium rounded-md whitespace-nowrap transition-colors',
                activeTab === tab.id
                  ? 'text-blue-600 bg-blue-50'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100',
              )}
            >
              {tab.label}
              {activeTab === tab.id && (
                <motion.span
                  layoutId="tab-underline"
                  className="absolute inset-x-0 -bottom-[1px] h-0.5 bg-blue-500 rounded-t"
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── Filter Bar — hidden for Target Command Center ── */}
      {activeTab !== 'target-command' && (
        <div className="sticky top-28 z-30 border-b border-gray-200 bg-white/90 backdrop-blur-sm">
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
      )}

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
          Croma Analytics · DS &amp; DSG Store Intelligence Platform
        </span>
      </footer>

    </div>
      } />
    </Routes>
  )
}
