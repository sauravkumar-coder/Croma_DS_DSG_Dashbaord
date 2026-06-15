import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertCircle, Archive, CheckCircle, Clock,
  FileSpreadsheet, RefreshCw, Star, Upload, X,
} from 'lucide-react'
import {
  archiveTarget, listTargets, setActiveTarget, uploadManagedTarget,
  type TargetFileRecord,
} from '@/lib/api'
import { cn } from '@/lib/utils'

const MONTH_RE = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-\d{4}$/i

const MONTH_NAMES: Record<string, string> = {
  january: 'Jan', february: 'Feb', march: 'Mar', april: 'Apr',
  may: 'May', june: 'Jun', july: 'Jul', august: 'Aug',
  september: 'Sep', october: 'Oct', november: 'Nov', december: 'Dec',
}

function detectMonthFromFilename(name: string): string {
  const lower = name.toLowerCase()
  const yearMatch = lower.match(/20\d{2}/)
  if (!yearMatch) return ''
  const year = yearMatch[0]
  for (const [full, abbr] of Object.entries(MONTH_NAMES)) {
    if (lower.includes(full)) return `${abbr}-${year}`
  }
  return ''
}

const STATUS_CFG = {
  active:   { label: 'Active',   cls: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' },
  inactive: { label: 'Inactive', cls: 'bg-gray-700/40 text-gray-400 border border-gray-600/30' },
  archived: { label: 'Archived', cls: 'bg-amber-500/10 text-amber-500 border border-amber-500/20' },
} as const

interface Props {
  open: boolean
  onClose: () => void
  onTargetChanged: () => void
}

export default function TargetManagementDrawer({ open, onClose, onTargetChanged }: Props) {
  const [targets, setTargets]     = useState<TargetFileRecord[]>([])
  const [loading, setLoading]     = useState(false)
  const [loadErr, setLoadErr]     = useState<string | null>(null)

  const [monthLabel, setMonthLabel] = useState('')
  const [file, setFile]             = useState<File | null>(null)
  const [uploading, setUploading]   = useState(false)
  const [uploadPct, setUploadPct]   = useState(0)
  const [uploadErr, setUploadErr]   = useState<string | null>(null)
  const [uploadOk, setUploadOk]     = useState(false)

  const [actionBusy, setActionBusy] = useState<string | null>(null)
  const [actionErr, setActionErr]   = useState<string | null>(null)

  const fileRef = useRef<HTMLInputElement>(null)

  const fetchTargets = useCallback(async () => {
    setLoading(true)
    setLoadErr(null)
    try {
      const { data } = await listTargets()
      setTargets(data.targets)
    } catch {
      setLoadErr('Could not reach the server.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) fetchTargets()
  }, [open, fetchTargets])

  // ── Upload ─────────────────────────────────────────────────────────────────

  const handleUpload = async () => {
    if (!file) return
    const trimmed = monthLabel.trim()
    if (!MONTH_RE.test(trimmed)) {
      setUploadErr('Month must be MMM-YYYY format, e.g. Jul-2025')
      return
    }
    setUploading(true)
    setUploadPct(0)
    setUploadErr(null)
    setUploadOk(false)
    try {
      await uploadManagedTarget(file, trimmed, setUploadPct)
      setUploadOk(true)
      setFile(null)
      if (fileRef.current) fileRef.current.value = ''
      fetchTargets()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })
        ?.response?.data?.detail
      setUploadErr(detail ?? 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  // ── Row actions ────────────────────────────────────────────────────────────

  const handleSetActive = async (month: string) => {
    setActionBusy(month)
    setActionErr(null)
    try {
      await setActiveTarget(month)
      await fetchTargets()
      onTargetChanged()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })
        ?.response?.data?.detail
      setActionErr(detail ?? 'Failed to set active')
    } finally {
      setActionBusy(null)
    }
  }

  const handleArchive = async (month: string) => {
    setActionBusy(month)
    setActionErr(null)
    try {
      await archiveTarget(month)
      await fetchTargets()
      onTargetChanged()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })
        ?.response?.data?.detail
      setActionErr(detail ?? 'Failed to archive')
    } finally {
      setActionBusy(null)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm"
            onClick={onClose}
          />

          {/* Drawer */}
          <motion.aside
            key="drawer"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 320, damping: 32 }}
            className="fixed right-0 top-0 bottom-0 z-[70] w-full max-w-[520px] bg-gray-950 border-l border-gray-800 flex flex-col shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800 shrink-0">
              <div>
                <h2 className="text-base font-bold text-gray-100">Manage Targets</h2>
                <p className="text-[11px] text-gray-500 mt-0.5">Upload, activate, and archive monthly target files</p>
              </div>
              <button
                onClick={onClose}
                className="h-8 w-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">

              {/* ── Upload section ── */}
              <div className="rounded-xl border border-gray-800 bg-gray-900 p-4 space-y-3.5">
                <div className="flex items-center gap-2">
                  <Upload className="h-4 w-4 text-blue-400" />
                  <h3 className="text-sm font-semibold text-gray-200">Upload New Target</h3>
                </div>

                {/* Month label */}
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">Month Label</label>
                  <input
                    type="text"
                    value={monthLabel}
                    onChange={e => { setMonthLabel(e.target.value); setUploadErr(null); setUploadOk(false) }}
                    placeholder="e.g. Jul-2025"
                    className="w-full h-9 px-3 rounded-lg bg-gray-800 border border-gray-700 text-sm text-gray-200 placeholder:text-gray-600 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition-colors"
                  />
                  <p className="text-[10px] text-gray-600 mt-1">Format: MMM-YYYY · Jan-2025, Jul-2025, Dec-2024 …</p>
                </div>

                {/* File picker */}
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">Target File (.xlsx)</label>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => fileRef.current?.click()}
                    onKeyDown={e => e.key === 'Enter' && fileRef.current?.click()}
                    className={cn(
                      'flex items-center gap-3 h-10 px-3 rounded-lg border cursor-pointer transition-colors select-none',
                      file
                        ? 'bg-blue-500/10 border-blue-500/30 text-blue-300'
                        : 'bg-gray-800 border-gray-700 text-gray-500 hover:border-gray-600'
                    )}
                  >
                    <FileSpreadsheet className="h-4 w-4 shrink-0" />
                    <span className="text-xs truncate flex-1">{file ? file.name : 'Click to select .xlsx file'}</span>
                    {file && <span className="text-[10px] text-gray-500 shrink-0">{(file.size / 1024).toFixed(1)} KB</span>}
                  </div>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".xlsx,.xls"
                    className="hidden"
                    onChange={e => {
                      const picked = e.target.files?.[0] ?? null
                      setFile(picked)
                      setUploadErr(null)
                      setUploadOk(false)
                      if (picked) {
                        const detected = detectMonthFromFilename(picked.name)
                        if (detected) setMonthLabel(detected)
                      }
                    }}
                  />
                </div>

                {/* Progress bar */}
                {uploading && (
                  <div className="space-y-1">
                    <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-500 rounded-full transition-all duration-150"
                        style={{ width: `${uploadPct}%` }}
                      />
                    </div>
                    <p className="text-[10px] text-gray-500 text-right">{uploadPct}%</p>
                  </div>
                )}

                {/* Feedback */}
                {uploadErr && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" />{uploadErr}
                  </div>
                )}
                {uploadOk && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-400">
                    <CheckCircle className="h-3.5 w-3.5 shrink-0" />
                    <span>Uploaded successfully for <span className="font-semibold">{monthLabel.trim()}</span></span>
                  </div>
                )}

                <button
                  onClick={handleUpload}
                  disabled={!file || !monthLabel.trim() || uploading}
                  className="w-full h-9 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors flex items-center justify-center gap-2"
                >
                  {uploading
                    ? <><RefreshCw className="h-4 w-4 animate-spin" />Uploading…</>
                    : <><Upload className="h-4 w-4" />Upload Target</>
                  }
                </button>
              </div>

              {/* ── Targets library ── */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-200">Targets Library</h3>
                  <button
                    onClick={fetchTargets}
                    disabled={loading}
                    className="flex items-center gap-1.5 text-[11px] text-gray-500 hover:text-gray-300 transition-colors disabled:opacity-50"
                  >
                    <RefreshCw className={cn('h-3 w-3', loading && 'animate-spin')} />
                    Refresh
                  </button>
                </div>

                {actionErr && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" />{actionErr}
                  </div>
                )}
                {loadErr && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" />{loadErr}
                  </div>
                )}

                {loading && targets.length === 0 ? (
                  <div className="flex items-center justify-center py-12">
                    <RefreshCw className="h-5 w-5 animate-spin text-gray-600" />
                  </div>
                ) : targets.length === 0 ? (
                  <div className="flex flex-col items-center gap-3 py-12 text-center">
                    <FileSpreadsheet className="h-9 w-9 text-gray-700" />
                    <p className="text-sm text-gray-600">No targets uploaded yet.</p>
                    <p className="text-xs text-gray-700">Upload a file above to get started.</p>
                  </div>
                ) : (
                  <div className="rounded-xl border border-gray-800 overflow-hidden">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-gray-800 bg-gray-800/40">
                          {['Month', 'Stores', 'Uploaded', 'Status', 'Actions'].map(h => (
                            <th key={h} className="px-3 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {targets.map(t => {
                          const busy = actionBusy === t.month
                          const cfg  = STATUS_CFG[t.status]
                          return (
                            <tr
                              key={t.month}
                              className={cn(
                                'border-b border-gray-800/50 transition-colors',
                                t.status === 'active' ? 'bg-emerald-500/5' : 'hover:bg-gray-800/30'
                              )}
                            >
                              {/* Month */}
                              <td className="px-3 py-2.5">
                                <div className="flex items-center gap-1.5">
                                  {t.status === 'active' && (
                                    <Star className="h-3 w-3 text-emerald-400 fill-emerald-400 shrink-0" />
                                  )}
                                  <span className={cn(
                                    'text-xs font-semibold',
                                    t.status === 'active' ? 'text-emerald-300' : 'text-gray-200'
                                  )}>
                                    {t.month}
                                  </span>
                                </div>
                                <p className="text-[10px] text-gray-600 mt-0.5 ml-4.5">{t.file_size_kb} KB</p>
                              </td>

                              {/* Store count */}
                              <td className="px-3 py-2.5 text-gray-400 tabular-nums text-xs">{t.store_count}</td>

                              {/* Uploaded at */}
                              <td className="px-3 py-2.5">
                                <div className="flex items-center gap-1.5">
                                  <Clock className="h-3 w-3 text-gray-600 shrink-0" />
                                  <span className="text-[11px] text-gray-400 whitespace-nowrap">
                                    {new Date(t.uploaded_at).toLocaleDateString('en-IN', {
                                      day: '2-digit', month: 'short', year: 'numeric',
                                    })}
                                  </span>
                                </div>
                              </td>

                              {/* Status badge */}
                              <td className="px-3 py-2.5">
                                <span className={cn(
                                  'inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap',
                                  cfg.cls
                                )}>
                                  {cfg.label}
                                </span>
                              </td>

                              {/* Actions */}
                              <td className="px-3 py-2.5">
                                <div className="flex items-center gap-1.5">
                                  {t.status === 'inactive' && (
                                    <button
                                      onClick={() => handleSetActive(t.month)}
                                      disabled={busy}
                                      className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium text-blue-400 bg-blue-500/10 hover:bg-blue-500/20 disabled:opacity-40 transition-colors whitespace-nowrap"
                                    >
                                      {busy
                                        ? <RefreshCw className="h-3 w-3 animate-spin" />
                                        : <Star className="h-3 w-3" />
                                      }
                                      Set Active
                                    </button>
                                  )}
                                  {(t.status === 'active' || t.status === 'inactive') && (
                                    <button
                                      onClick={() => handleArchive(t.month)}
                                      disabled={busy}
                                      className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium text-gray-400 bg-gray-800 hover:text-amber-400 hover:bg-amber-500/10 disabled:opacity-40 transition-colors whitespace-nowrap"
                                    >
                                      {busy
                                        ? <RefreshCw className="h-3 w-3 animate-spin" />
                                        : <Archive className="h-3 w-3" />
                                      }
                                      Archive
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="px-5 py-3 border-t border-gray-800 shrink-0">
              <p className="text-[10px] text-gray-700 text-center">
                Active files stored in{' '}
                <span className="font-mono text-gray-600">backend/data/targets/</span>
                {' · '}
                Archives in{' '}
                <span className="font-mono text-gray-600">backend/data/archive/</span>
              </p>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}
