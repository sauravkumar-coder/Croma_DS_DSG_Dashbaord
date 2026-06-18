import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

function Pulse({ className }: { className?: string }) {
  return <div className={cn('skeleton-pulse rounded', className)} />
}

/** Returns true for at least `minMs` after `ready` becomes true. */
export function useMinSkeleton(ready: boolean, minMs = 400): boolean {
  const [showing, setShowing] = useState(!ready)

  useEffect(() => {
    if (!ready) {
      setShowing(true)
      return
    }
    const t = setTimeout(() => setShowing(false), minMs)
    return () => clearTimeout(t)
  }, [ready, minMs])

  return showing || !ready
}

export function SkeletonKPICards() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="rounded-xl border border-gray-200 bg-white p-4 space-y-3 shadow-sm"
        >
          <Pulse className="h-2.5 w-20" />
          <Pulse className="h-7 w-28" />
          <Pulse className="h-2 w-16" />
        </div>
      ))}
    </div>
  )
}

export function SkeletonChart({ tall = false }: { tall?: boolean }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-4 shadow-sm">
      <Pulse className="h-4 w-36" />
      <Pulse className={cn('w-full', tall ? 'h-80' : 'h-64')} />
    </div>
  )
}

export function SkeletonTable() {
  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm">
      {/* Header row */}
      <div className="flex gap-3 px-4 py-3 bg-gray-50 border-b border-gray-200">
        {Array.from({ length: 5 }).map((_, i) => (
          <Pulse key={i} className="h-3 flex-1" />
        ))}
      </div>
      {/* Data rows */}
      {Array.from({ length: 7 }).map((_, i) => (
        <div
          key={i}
          className={cn('flex gap-3 px-4 py-3 border-b border-gray-100', i % 2 === 1 ? 'bg-gray-50/50' : 'bg-white')}
        >
          {Array.from({ length: 5 }).map((_, j) => (
            <Pulse key={j} className="h-3 flex-1" />
          ))}
        </div>
      ))}
    </div>
  )
}

export function AppSkeleton() {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Fake header — mirrors real app header */}
      <div className="h-16 border-b border-gray-200 bg-white/95 flex items-center px-4 gap-4">
        <Pulse className="h-8 w-10 rounded-full" />
        <div className="space-y-1.5">
          <Pulse className="h-4 w-24" />
          <Pulse className="h-2.5 w-36" />
        </div>
      </div>
      {/* Fake tab bar */}
      <div className="h-12 border-b border-gray-200 bg-white/95 flex items-center px-4 gap-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <Pulse key={i} className="h-6 w-20 rounded-md" />
        ))}
      </div>
      {/* Fake filter bar */}
      <div className="h-11 border-b border-gray-200 bg-white/90 flex items-center px-4 gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Pulse key={i} className="h-8 w-32 rounded-md" />
        ))}
      </div>
      {/* Fake content — mirrors Overview KPIs + charts + table */}
      <div className="px-4 py-6 max-w-screen-2xl mx-auto space-y-4">
        <SkeletonKPICards />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <SkeletonChart tall />
          <SkeletonChart />
        </div>
        <SkeletonTable />
      </div>
    </div>
  )
}
