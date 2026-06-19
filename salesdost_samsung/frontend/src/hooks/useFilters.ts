import { useCallback, useState } from 'react'

export interface FilterState {
  state: string              // '' = all states
  planCategory: string       // '' = all plan categories
  productSubcategory: string // '' = all product subcategories
  fromMonth: string          // '' = earliest
  toMonth: string            // '' = latest
}

const DEFAULT_FILTERS: FilterState = {
  state: '',
  planCategory: '',
  productSubcategory: '',
  fromMonth: '',
  toMonth: '',
}

export function useFilters() {
  const [filtersByTab, setFiltersByTab] = useState<Record<string, FilterState>>({})

  const getFilters = useCallback(
    (tabId: string): FilterState => filtersByTab[tabId] ?? DEFAULT_FILTERS,
    [filtersByTab]
  )

  const setFilter = useCallback(
    (tabId: string, key: keyof FilterState, value: string) => {
      setFiltersByTab(prev => ({
        ...prev,
        [tabId]: { ...(prev[tabId] ?? DEFAULT_FILTERS), [key]: value },
      }))
    },
    []
  )

  const resetFilters = useCallback((tabId: string) => {
    setFiltersByTab(prev => ({ ...prev, [tabId]: DEFAULT_FILTERS }))
  }, [])

  const getActiveCount = useCallback(
    (tabId: string): number => {
      const f = filtersByTab[tabId]
      if (!f) return 0
      return [f.state, f.planCategory, f.productSubcategory, f.fromMonth, f.toMonth].filter(Boolean).length
    },
    [filtersByTab]
  )

  return { getFilters, setFilter, resetFilters, getActiveCount }
}
