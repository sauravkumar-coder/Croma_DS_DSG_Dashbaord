import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { getDashboardData, getTrackerData, type StoreRecord, type TrackerSalesRow } from '@/lib/api'
import { classifyAllStores, type ClassificationResult } from '@/lib/classificationEngine'
import { useRetailerContext } from '@/contexts/RetailerContext'

function getDaysInMonth(monthStr: string): number {
  const DAYS: Record<string, number> = {
    Jan: 31, Feb: 28, Mar: 31, Apr: 30, May: 31, Jun: 30,
    Jul: 31, Aug: 31, Sep: 30, Oct: 31, Nov: 30, Dec: 31,
  }
  const parts = monthStr.split('-')
  if (parts.length !== 2) return 31
  const [abbr, yearStr] = parts
  const year = parseInt(yearStr, 10)
  if (abbr === 'Feb' && !isNaN(year)) {
    if ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0) return 29
  }
  return DAYS[abbr] ?? 31
}

// ── Context shape ─────────────────────────────────────────────────────────────

export interface DataContextValue {
  // Raw data mirrored from /api/data
  stores: StoreRecord[]
  months: string[]
  states: string[]
  categories: string[]
  hasTargets: boolean
  targetMonth: string | null  // month the active target file covers, e.g. 'Jun-2026'
  warnings: string[]

  // Loading / error state
  isLoading: boolean
  error: string | null

  // Derived — true once stores have been uploaded and parsed
  hasData: boolean

  // Phase split — derived from the classification engine's allocatePhases()
  earlyMonths:  string[]   // first third of the time range
  midMonths:    string[]   // middle third of the time range
  recentMonths: string[]   // last third of the time range

  // Centralized classification — single source of truth for all tabs
  classification: ClassificationResult

  // Actions
  refetchData: () => Promise<void>

  // Shared Target Tracker / Daily Sales state
  activeTrackerMonth: string | null
  trackerSalesRows: TrackerSalesRow[]
  isTrackerLoading: boolean
  dayOfMonth: number
  setDayOfMonth: (day: number) => void
  elapsed: number
  totalDays: number
  loadTrackerForMonth: (month: string) => Promise<void>
}

// ── Context + hook ────────────────────────────────────────────────────────────

const DataContext = createContext<DataContextValue | null>(null)

export function useDataContext(): DataContextValue {
  const ctx = useContext(DataContext)
  if (!ctx) throw new Error('useDataContext must be called inside <DataProvider>')
  return ctx
}

// ── Provider ──────────────────────────────────────────────────────────────────

export function DataProvider({ children }: { children: React.ReactNode }) {
  const { retailer } = useRetailerContext()
  const [stores, setStores] = useState<StoreRecord[]>([])
  const [months, setMonths] = useState<string[]>([])
  const [states, setStates] = useState<string[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [hasTargets, setHasTargets] = useState(false)
  const [targetMonth, setTargetMonth] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Shared Target Tracker states
  const [activeTrackerMonth, setActiveTrackerMonth] = useState<string | null>(null)
  const [dayOfMonth, setDayOfMonth] = useState<number>(() => new Date().getDate())
  const [trackerSalesRows, setTrackerSalesRows] = useState<TrackerSalesRow[]>([])
  const [isTrackerLoading, setIsTrackerLoading] = useState(false)

  const refetchData = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const { data } = await getDashboardData(retailer)
      if (data.no_data) {
        // Reset to empty
        setStores([])
        setMonths([])
        setStates([])
        setCategories([])
        setHasTargets(false)
        setTargetMonth(null)
        setWarnings([])
        setError('MongoDB connection is not active. Make sure the database is running.')
      } else {
        setStores(data.stores)
        setMonths(data.months)
        setStates(data.states)
        setCategories(data.categories)
        setHasTargets(data.has_targets)
        setTargetMonth(data.target_month ?? null)
        setWarnings(data.warnings)
      }
    } catch {
      setError('Could not reach the backend. Make sure the server is running.')
    } finally {
      setIsLoading(false)
    }
  }, [retailer])

  // Re-fetch on mount AND whenever the active retailer changes
  useEffect(() => { refetchData() }, [refetchData])

  const hasData = stores.length > 0

  // Centralized classification engine — single source of truth for all tabs
  const classification = useMemo(
    () => classifyAllStores(stores, months),
    [stores, months],
  )

  const totalDays = useMemo(() => {
    return activeTrackerMonth ? getDaysInMonth(activeTrackerMonth) : 31
  }, [activeTrackerMonth])

  const elapsed = useMemo(() => {
    return Math.min(dayOfMonth, totalDays)
  }, [dayOfMonth, totalDays])

  const loadTrackerForMonth = useCallback(async (month: string) => {
    if (!month) return
    if (month === activeTrackerMonth && trackerSalesRows.length > 0) {
      return
    }

    setIsTrackerLoading(true)
    setTrackerSalesRows([]) // Clear old rows to avoid caching/flicker
    setActiveTrackerMonth(month)

    const now = new Date()
    const currentMonthStr = now.toLocaleString('en-US', { month: 'short' }) + '-' + now.getFullYear()
    if (month === currentMonthStr) {
      setDayOfMonth(now.getDate())
    } else {
      setDayOfMonth(getDaysInMonth(month))
    }

    try {
      const { data } = await getTrackerData(month)
      if (data.sales_rows) {
        setTrackerSalesRows(data.sales_rows)
      }
    } catch (err) {
      console.error("Failed to load tracker data in context", err)
    } finally {
      setIsTrackerLoading(false)
    }
  }, [activeTrackerMonth, trackerSalesRows.length])

  const value: DataContextValue = {
    stores,
    months,
    states,
    categories,
    hasTargets,
    targetMonth,
    warnings,
    isLoading,
    error,
    hasData,
    earlyMonths:  classification.phases.earlyMonths,
    midMonths:    classification.phases.midMonths,
    recentMonths: classification.phases.recentMonths,
    classification,
    refetchData,
    activeTrackerMonth,
    trackerSalesRows,
    isTrackerLoading,
    dayOfMonth,
    setDayOfMonth,
    elapsed,
    totalDays,
    loadTrackerForMonth,
  }

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}
