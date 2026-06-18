import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { getDashboardData, type StoreRecord } from '@/lib/api'
import { classifyAllStores, type ClassificationResult } from '@/lib/classificationEngine'
import { useRetailerContext } from '@/contexts/RetailerContext'

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

  const refetchData = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const { data } = await getDashboardData(retailer)
      if (data.no_data) {
        // Reset to empty — triggers upload screen
        setStores([])
        setMonths([])
        setStates([])
        setCategories([])
        setHasTargets(false)
        setTargetMonth(null)
        setWarnings([])
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
  }

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}
