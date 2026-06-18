import type { ReactNode } from 'react'
import { Search, X, Download, FileSpreadsheet } from 'lucide-react'
import { cn } from '@/lib/utils'

interface DataTableProps {
  title?: string
  subtitle?: string
  headerRight?: ReactNode
  searchQuery?: string
  onSearchChange?: (q: string) => void
  searchPlaceholder?: string
  onExportCsv?: () => void
  onExportExcel?: () => void
  page?: number
  totalPages?: number
  totalRows?: number
  pageSize?: number
  onPageChange?: (p: number) => void
  className?: string
  children: ReactNode
}

export default function DataTable({
  title, subtitle, headerRight,
  searchQuery, onSearchChange, searchPlaceholder = 'Search…',
  onExportCsv, onExportExcel,
  page, totalPages = 1, totalRows, pageSize = 20, onPageChange,
  className,
  children,
}: DataTableProps) {
  const hasHeader = !!(
    title || subtitle || headerRight
    || onSearchChange || onExportCsv || onExportExcel
  )
  const hasPagination = !!(
    page !== undefined && totalPages > 1 && onPageChange && totalRows !== undefined
  )

  const pages: number[] = (() => {
    if (!page || totalPages <= 5) return Array.from({ length: totalPages }, (_, i) => i + 1)
    if (page <= 3)               return [1, 2, 3, 4, 5]
    if (page >= totalPages - 2)  return [totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages]
    return [page - 2, page - 1, page, page + 1, page + 2]
  })()

  return (
    <div className={cn('rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm', className)}>

      {hasHeader && (
        <div className="px-4 py-3 border-b border-gray-100 flex items-start justify-between gap-3 flex-wrap">
          {(title || subtitle) && (
            <div className="min-w-0 flex-1">
              {title   && <h3 className="text-sm font-semibold text-gray-800">{title}</h3>}
              {subtitle && <p className="text-[11px] text-gray-400 mt-0.5">{subtitle}</p>}
            </div>
          )}
          <div className="flex items-center gap-2 flex-wrap shrink-0">
            {headerRight}
            {onSearchChange && (
              <div className="relative flex items-center">
                <Search className="absolute left-2.5 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
                <input
                  type="text"
                  placeholder={searchPlaceholder}
                  value={searchQuery ?? ''}
                  onChange={e => onSearchChange(e.target.value)}
                  className="h-8 pl-8 pr-7 rounded-lg bg-gray-50 border border-gray-200 text-xs text-gray-900 placeholder:text-gray-400 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400/30 w-44"
                />
                {searchQuery && (
                  <button onClick={() => onSearchChange('')} className="absolute right-2 text-gray-400 hover:text-gray-600">
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            )}
            {onExportCsv && (
              <button
                onClick={onExportCsv}
                className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-white border border-gray-200 text-xs text-gray-600 hover:text-gray-900 hover:border-gray-400 shadow-sm transition-colors"
                title="Download CSV"
              >
                <Download className="h-3.5 w-3.5" />
                CSV
              </button>
            )}
            {onExportExcel && (
              <button
                onClick={onExportExcel}
                className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-white border border-emerald-200 text-xs text-emerald-700 hover:text-emerald-900 hover:border-emerald-400 shadow-sm transition-colors"
                title="Download Excel"
              >
                <FileSpreadsheet className="h-3.5 w-3.5" />
                Excel
              </button>
            )}
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        {children}
      </div>

      {hasPagination && page !== undefined && onPageChange && totalRows !== undefined && (
        <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-xs text-gray-500">
            Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, totalRows)} of {totalRows}
          </p>
          <div className="flex items-center gap-1">
            <PgBtn label="«" onClick={() => onPageChange(1)}              disabled={page === 1}          />
            <PgBtn label="‹" onClick={() => onPageChange(page - 1)}      disabled={page === 1}          />
            {pages.map(p => (
              <button
                key={p}
                onClick={() => onPageChange(p)}
                className={cn(
                  'h-7 w-7 rounded text-xs transition-colors',
                  p === page
                    ? 'bg-blue-500 text-white font-bold'
                    : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100',
                )}
              >{p}</button>
            ))}
            <PgBtn label="›" onClick={() => onPageChange(page + 1)}      disabled={page === totalPages} />
            <PgBtn label="»" onClick={() => onPageChange(totalPages)}    disabled={page === totalPages} />
          </div>
        </div>
      )}

    </div>
  )
}

function PgBtn({ label, onClick, disabled }: {
  label: string; onClick: () => void; disabled: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="h-7 px-2.5 rounded text-xs text-gray-500 hover:text-gray-900 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-default transition-colors"
    >{label}</button>
  )
}
