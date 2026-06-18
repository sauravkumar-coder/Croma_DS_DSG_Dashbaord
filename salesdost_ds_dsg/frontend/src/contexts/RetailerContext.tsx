// ── RetailerContext ──────────────────────────────────────────────────────────
//
// Holds the active retailer selection and persists it to localStorage.
// Wraps the entire app so that any component can read/switch retailers.

import { createContext, useCallback, useContext, useState } from 'react'
import {
  type RetailerId,
  DEFAULT_RETAILER,
  getRetailerConfig,
  isValidRetailerId,
  type RetailerConfig,
} from '@/retailers/retailerFactory'

// ── Context shape ─────────────────────────────────────────────────────────────

interface RetailerContextValue {
  retailer:    RetailerId
  retailerCfg: RetailerConfig
  setRetailer: (id: RetailerId) => void
}

const RetailerContext = createContext<RetailerContextValue | null>(null)

export function useRetailerContext(): RetailerContextValue {
  const ctx = useContext(RetailerContext)
  if (!ctx) throw new Error('useRetailerContext must be called inside <RetailerProvider>')
  return ctx
}

// ── Provider ──────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'cv_retailer'

function readStoredRetailer(): RetailerId {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v && isValidRetailerId(v)) return v
  } catch { /* ignore */ }
  return DEFAULT_RETAILER
}

export function RetailerProvider({ children }: { children: React.ReactNode }) {
  const [retailer, setRetailerState] = useState<RetailerId>(readStoredRetailer)

  const setRetailer = useCallback((id: RetailerId) => {
    setRetailerState(id)
    try { localStorage.setItem(STORAGE_KEY, id) } catch { /* ignore */ }
  }, [])

  const value: RetailerContextValue = {
    retailer,
    retailerCfg: getRetailerConfig(retailer),
    setRetailer,
  }

  return (
    <RetailerContext.Provider value={value}>
      {children}
    </RetailerContext.Provider>
  )
}
