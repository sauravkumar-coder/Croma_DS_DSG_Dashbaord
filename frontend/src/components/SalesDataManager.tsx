import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  X,
  UploadCloud,
  RefreshCw,
  Trash2,
  FileSpreadsheet,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Database,
  Calendar,
  TrendingUp,
  Hash,
  Clock,
  HardDrive,
} from 'lucide-react'
import {
  getSalesMeta,
  uploadSales,
  reloadSales,
  deleteCombinedSales,
  loadDemoData,
  type SalesMetaResult,
  type UploadSalesResult,
  type SalesFileMeta,
} from '@/lib/api'
import { cn } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

type PanelState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'uploading'; progress: number }
  | { kind: 'reloading' }
  | { kind: 'clearing' }
  | { kind: 'confirm-replace'; pendingFile: File; existing: SalesFileMeta }
  | { kind: 'confirm-clear' }
  | { kind: 'success'; message: string }
  | { kind: 'error'; message: string }

function fmtRevenue(n: number): string {
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)}Cr`
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(1)}L`
  if (n >= 1e3) return `₹${(n / 1e3).toFixed(0)}K`
  return `₹${n.toFixed(0)}`
}

function fmtTimestamp(iso: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

// ── Dataset Summary Panel ─────────────────────────────────────────────────────

function DatasetSummary({ meta }: { meta: SalesMetaResult }) {
  if (!meta.loaded) {
    return (
      <div className="flex flex-col items-center justify-center py-8 gap-3 text-center">
        <div className="h-12 w-12 rounded-xl bg-gray-100 flex items-center justify-center">
          <Database className="h-5 w-5 text-gray-400" />
        </div>
        <div>
          <p className="text-sm font-medium text-gray-600">No dataset loaded</p>
          <p className="text-xs text-gray-400 mt-0.5">Upload a sales file to begin</p>
        </div>
      </div>
    )
  }

  const items = [
    { icon: FileSpreadsheet, label: 'File', value: meta.filename ?? '—', mono: true },
    { icon: Clock, label: 'Loaded At', value: fmtTimestamp(meta.uploaded_at ?? '') },
    { icon: Hash, label: 'Store Count', value: (meta.store_count ?? 0).toLocaleString('en-IN') },
    { icon: Calendar, label: 'Date Range', value: meta.date_from && meta.date_to ? `${meta.date_from} → ${meta.date_to}` : '—' },
    { icon: Hash, label: 'Months', value: (meta.month_count ?? 0).toString() },
    { icon: TrendingUp, label: 'Total Revenue', value: fmtRevenue(meta.total_revenue ?? 0) },
    { icon: HardDrive, label: 'File Size', value: `${meta.file_size_kb ?? 0} KB` },
  ]

  return (
    <div className="space-y-2">
      {meta.is_demo && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-xs font-medium">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          Demo dataset — generated sample data
        </div>
      )}
      <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 overflow-hidden">
        {items.map(({ icon: Icon, label, value, mono }) => (
          <div key={label} className="flex items-center justify-between px-3.5 py-2.5 bg-white">
            <div className="flex items-center gap-2 text-xs text-gray-500 min-w-0">
              <Icon className="h-3.5 w-3.5 shrink-0 text-gray-400" />
              <span>{label}</span>
            </div>
            <span className={cn(
              'text-xs font-medium text-gray-800 text-right truncate max-w-[55%]',
              mono && 'font-mono text-[11px]',
            )}>
              {value}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────

interface SalesDataManagerProps {
  onClose: () => void
  onDataChanged: () => void
}

export default function SalesDataManager({ onClose, onDataChanged }: SalesDataManagerProps) {
  const [panelState, setPanelState] = useState<PanelState>({ kind: 'loading' })
  const [meta, setMeta] = useState<SalesMetaResult>({ loaded: false })
  const fileInputRef = useRef<HTMLInputElement>(null)

  const fetchMeta = useCallback(async () => {
    try {
      const { data } = await getSalesMeta()
      setMeta(data)
    } catch {
      setMeta({ loaded: false })
    }
  }, [])

  useEffect(() => {
    fetchMeta().then(() => setPanelState({ kind: 'idle' }))
  }, [fetchMeta])

  const handleFileSelected = useCallback(async (file: File, force = false) => {
    if (!file.name.match(/\.(xlsx|xls)$/i)) {
      setPanelState({ kind: 'error', message: 'Only .xlsx / .xls files are accepted.' })
      return
    }

    setPanelState({ kind: 'uploading', progress: 0 })
    try {
      const { data } = await uploadSales(file, pct =>
        setPanelState({ kind: 'uploading', progress: pct }), force,
      )
      if ((data as UploadSalesResult & { needs_confirm?: boolean }).needs_confirm && (data as UploadSalesResult & { existing?: SalesFileMeta }).existing) {
        setPanelState({ kind: 'confirm-replace', pendingFile: file, existing: (data as UploadSalesResult & { existing: SalesFileMeta }).existing })
        return
      }
      await fetchMeta()
      onDataChanged()
      setPanelState({ kind: 'success', message: `Loaded ${data.stores} stores across ${data.months.length} months.` })
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } }).response?.data?.detail ??
        'Upload failed. Check the file format.'
      setPanelState({ kind: 'error', message: msg })
    }
  }, [fetchMeta, onDataChanged])

  const handleReload = useCallback(async () => {
    setPanelState({ kind: 'reloading' })
    try {
      const { data } = await reloadSales()
      await fetchMeta()
      onDataChanged()
      setPanelState({ kind: 'success', message: `Reloaded ${data.stores} stores across ${data.months.length} months.` })
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } }).response?.data?.detail ??
        'Reload failed.'
      setPanelState({ kind: 'error', message: msg })
    }
  }, [fetchMeta, onDataChanged])

  const handleClear = useCallback(async () => {
    setPanelState({ kind: 'clearing' })
    try {
      await deleteCombinedSales()
      setMeta({ loaded: false })
      onDataChanged()
      setPanelState({ kind: 'success', message: 'Sales dataset cleared. Upload a new file to continue.' })
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } }).response?.data?.detail ??
        'Clear failed.'
      setPanelState({ kind: 'error', message: msg })
    }
  }, [onDataChanged])

  const handleLoadDemo = useCallback(async () => {
    setPanelState({ kind: 'uploading', progress: 60 })
    try {
      const { data } = await loadDemoData()
      await fetchMeta()
      onDataChanged()
      setPanelState({ kind: 'success', message: `Loaded demo data: ${data.stores} stores across ${data.months.length} months.` })
    } catch {
      setPanelState({ kind: 'error', message: 'Could not reach backend.' })
    }
  }, [fetchMeta, onDataChanged])

  const isBusy =
    panelState.kind === 'loading' ||
    panelState.kind === 'uploading' ||
    panelState.kind === 'reloading' ||
    panelState.kind === 'clearing'

  return (
    <>
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Drawer */}
      <motion.div
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', stiffness: 340, damping: 32 }}
        className="fixed right-0 top-0 z-50 h-full w-[420px] max-w-full bg-white shadow-2xl flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-400 flex items-center justify-center shadow-sm">
              <Database className="h-4 w-4 text-white" />
            </div>
            <div>
              <p className="text-sm font-bold text-gray-900">Sales Data Management</p>
              <p className="text-[10px] text-gray-400 leading-tight">Upload · Replace · Reload · Clear</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="h-8 w-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

          {/* Status feedback */}
          <AnimatePresence mode="wait">
            {(panelState.kind === 'success' || panelState.kind === 'error') && (
              <motion.div
                key={panelState.kind}
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className={cn(
                  'flex items-start gap-2.5 px-3.5 py-3 rounded-xl text-sm',
                  panelState.kind === 'success'
                    ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
                    : 'bg-red-50 border border-red-200 text-red-800',
                )}
              >
                {panelState.kind === 'success'
                  ? <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-emerald-600" />
                  : <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-red-500" />}
                <span className="flex-1 text-xs leading-relaxed">{panelState.message}</span>
                <button
                  onClick={() => setPanelState({ kind: 'idle' })}
                  className="shrink-0 text-current opacity-50 hover:opacity-100"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </motion.div>
            )}

            {panelState.kind === 'confirm-replace' && (
              <motion.div
                key="confirm-replace"
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                className="px-4 py-4 rounded-xl border border-amber-200 bg-amber-50 space-y-3"
              >
                <div className="flex items-center gap-2 text-amber-700">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <p className="text-sm font-semibold">Replace current dataset?</p>
                </div>
                <p className="text-xs text-amber-700 leading-relaxed">
                  A dataset is already loaded ({panelState.existing.filename}).
                  This will replace it with <strong>{panelState.pendingFile.name}</strong>.
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPanelState({ kind: 'idle' })}
                    className="flex-1 py-2 rounded-lg border border-gray-200 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => handleFileSelected(panelState.pendingFile, true)}
                    className="flex-1 py-2 rounded-lg bg-amber-500 text-xs font-semibold text-white hover:bg-amber-600 transition-colors"
                  >
                    Replace
                  </button>
                </div>
              </motion.div>
            )}

            {panelState.kind === 'confirm-clear' && (
              <motion.div
                key="confirm-clear"
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                className="px-4 py-4 rounded-xl border border-red-200 bg-red-50 space-y-3"
              >
                <div className="flex items-center gap-2 text-red-700">
                  <Trash2 className="h-4 w-4 shrink-0" />
                  <p className="text-sm font-semibold">Clear current dataset?</p>
                </div>
                <p className="text-xs text-red-700 leading-relaxed">
                  All KPIs, charts, and rankings will be cleared. You will need to upload a new file to continue.
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPanelState({ kind: 'idle' })}
                    className="flex-1 py-2 rounded-lg border border-gray-200 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleClear}
                    className="flex-1 py-2 rounded-lg bg-red-500 text-xs font-semibold text-white hover:bg-red-600 transition-colors"
                  >
                    Clear Dataset
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Upload progress */}
          {panelState.kind === 'uploading' && (
            <div className="space-y-2">
              <p className="text-xs text-gray-500 font-medium">Uploading… {panelState.progress}%</p>
              <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                <motion.div
                  className="h-full rounded-full bg-gradient-to-r from-blue-500 to-cyan-400"
                  initial={{ width: 0 }}
                  animate={{ width: `${panelState.progress}%` }}
                  transition={{ ease: 'linear', duration: 0.1 }}
                />
              </div>
            </div>
          )}

          {/* Dataset Summary */}
          <div>
            <p className="text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2.5">Dataset Summary</p>
            {panelState.kind === 'loading' ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
              </div>
            ) : (
              <DatasetSummary meta={meta} />
            )}
          </div>

          {/* Action buttons */}
          <div>
            <p className="text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2.5">Actions</p>
            <div className="space-y-2">

              {/* Upload / Replace */}
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={e => {
                  const file = e.target.files?.[0]
                  if (file) handleFileSelected(file)
                  e.target.value = ''
                }}
              />
              <button
                disabled={isBusy}
                onClick={() => fileInputRef.current?.click()}
                className={cn(
                  'w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-all',
                  'border-blue-200 bg-blue-50 hover:bg-blue-100 hover:border-blue-300',
                  isBusy && 'opacity-50 cursor-not-allowed',
                )}
              >
                <div className="h-8 w-8 rounded-lg bg-blue-500 flex items-center justify-center shrink-0">
                  <UploadCloud className="h-4 w-4 text-white" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-blue-700">
                    {meta.loaded ? 'Upload New / Replace File' : 'Upload Sales File'}
                  </p>
                  <p className="text-[11px] text-blue-500 mt-0.5">
                    {meta.loaded
                      ? 'Replaces current dataset and recalculates all KPIs'
                      : '.xlsx / .xls · validates and recalculates everything'}
                  </p>
                </div>
              </button>

              {/* Reload */}
              <button
                disabled={isBusy || !meta.loaded}
                onClick={handleReload}
                className={cn(
                  'w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-all',
                  'border-emerald-200 bg-emerald-50 hover:bg-emerald-100 hover:border-emerald-300',
                  (isBusy || !meta.loaded) && 'opacity-40 cursor-not-allowed',
                )}
              >
                <div className="h-8 w-8 rounded-lg bg-emerald-500 flex items-center justify-center shrink-0">
                  {panelState.kind === 'reloading'
                    ? <Loader2 className="h-4 w-4 text-white animate-spin" />
                    : <RefreshCw className="h-4 w-4 text-white" />}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-emerald-700">Reload Dataset</p>
                  <p className="text-[11px] text-emerald-600 mt-0.5">
                    Force recalculation from current file — no upload needed
                  </p>
                </div>
              </button>

              {/* Load Demo */}
              <button
                disabled={isBusy}
                onClick={handleLoadDemo}
                className={cn(
                  'w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-all',
                  'border-violet-200 bg-violet-50 hover:bg-violet-100 hover:border-violet-300',
                  isBusy && 'opacity-50 cursor-not-allowed',
                )}
              >
                <div className="h-8 w-8 rounded-lg bg-violet-500 flex items-center justify-center shrink-0">
                  <Database className="h-4 w-4 text-white" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-violet-700">Load Sample Data</p>
                  <p className="text-[11px] text-violet-600 mt-0.5">
                    30 demo stores · 12 months · useful for testing
                  </p>
                </div>
              </button>

              {/* Clear */}
              <button
                disabled={isBusy || !meta.loaded}
                onClick={() => setPanelState({ kind: 'confirm-clear' })}
                className={cn(
                  'w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-all',
                  'border-red-200 bg-red-50 hover:bg-red-100 hover:border-red-300',
                  (isBusy || !meta.loaded) && 'opacity-40 cursor-not-allowed',
                )}
              >
                <div className="h-8 w-8 rounded-lg bg-red-500 flex items-center justify-center shrink-0">
                  <Trash2 className="h-4 w-4 text-white" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-red-700">Clear Dataset</p>
                  <p className="text-[11px] text-red-500 mt-0.5">
                    Remove all loaded sales data and return to upload screen
                  </p>
                </div>
              </button>

            </div>
          </div>

        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-100 bg-gray-50">
          <p className="text-[10px] text-gray-400 leading-relaxed text-center">
            All operations refresh charts and KPIs automatically — no backend restart needed
          </p>
        </div>
      </motion.div>
    </>
  )
}
