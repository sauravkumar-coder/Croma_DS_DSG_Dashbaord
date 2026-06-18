import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
// eslint-disable-next-line @typescript-eslint/no-require-imports
import createPlotlyComponent from 'react-plotly.js/factory'
// @ts-ignore
import Plotly from 'plotly.js-dist-min'
import axios from 'axios'
import { cn } from '@/lib/utils'
import { fmtInr } from '@/lib/formatting'
import { PT, PLOTLY_BASE, PT_AXIS } from '@/lib/plotlyTheme'

const Plot = createPlotlyComponent(Plotly)

interface StoreDetail {
  store_id: string
  store_name?: string
  state?: string
  category?: string
  monthly_sales: Record<string, number>
  target?: number | null
}

function InfoChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="text-xs text-gray-500 bg-white border border-gray-200 rounded-lg px-3 py-1.5 whitespace-nowrap">
      <span className="font-semibold text-gray-700">{label}:</span> {value}
    </span>
  )
}

export default function StoreDeepDivePage() {
  const { storeId } = useParams<{ storeId: string }>()
  const navigate    = useNavigate()

  const [store,   setStore]   = useState<StoreDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  useEffect(() => {
    if (!storeId) return
    setLoading(true)
    setError(null)
    axios
      .get<StoreDetail>(`/api/stores/${encodeURIComponent(storeId)}`)
      .then(res => setStore(res.data))
      .catch(err => setError(err.response?.data?.detail ?? 'Failed to load store'))
      .finally(() => setLoading(false))
  }, [storeId])

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
          <p className="text-sm text-gray-400">Loading store data…</p>
        </div>
      </div>
    )
  }

  if (error || !store) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center space-y-3">
          <p className="text-base font-medium text-red-500">{error ?? 'Store not found'}</p>
          <button
            onClick={() => navigate('/')}
            className="text-sm text-blue-600 hover:text-blue-500 transition-colors"
          >
            ← Back to Dashboard
          </button>
        </div>
      </div>
    )
  }

  const months   = Object.keys(store.monthly_sales).sort()
  const revenues = months.map(m => store.monthly_sales[m] ?? 0)
  const totalRev = revenues.reduce((a, b) => a + b, 0)
  const avgMo    = months.length ? totalRev / months.length : 0
  const activeMo = revenues.filter(v => v > 0).length

  const target      = store.target ?? null
  const targetTotal = target != null ? target * months.length : null
  const achievement = target != null && targetTotal ? (totalRev / targetTotal) * 100 : null

  // Gradient bar colours: older months grey, recent months dark navy
  const barColors = revenues.map((_, i) => {
    const t = i / Math.max(months.length - 1, 1)
    const r = Math.round(148 - t * (148 - 30))
    const g = Math.round(163 - t * (163 - 58))
    const b = Math.round(184 - t * (184 - 95))
    return `rgb(${r},${g},${b})`
  })

  const maxIdx = revenues.indexOf(Math.max(...revenues))
  const minIdx = revenues.indexOf(Math.min(...revenues.filter(v => v > 0)))

  barColors[maxIdx] = '#10b981'
  if (minIdx >= 0 && minIdx !== maxIdx) barColors[minIdx] = '#ef4444'

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">

      {/* ── Header ── */}
      <header className="sticky top-0 z-50 h-16 border-b border-gray-200 bg-white/95 backdrop-blur-sm">
        <div className="flex items-center h-full px-4 max-w-screen-xl mx-auto gap-4">
          <button
            onClick={() => navigate('/')}
            className="inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Dashboard
          </button>
          <div className="h-5 w-px bg-gray-200 shrink-0" />
          <div className="flex items-center gap-3 min-w-0">
            <span className="shrink-0 inline-flex items-center justify-center px-3 h-8 rounded-full bg-gradient-to-r from-blue-600 to-cyan-400 text-white text-sm font-bold tracking-wide select-none shadow-sm">
              CR
            </span>
            <div className="min-w-0">
              <p className="text-base font-bold text-gray-900 leading-none truncate">
                {store.store_name ?? store.store_id}
              </p>
              <p className="text-[10px] text-gray-500 leading-tight mt-0.5">Store Deep Dive</p>
            </div>
          </div>
        </div>
      </header>

      <main className="px-4 py-6 pb-14 max-w-screen-xl mx-auto space-y-5">

        {/* ── Info chips ── */}
        <div className="flex flex-wrap gap-2 items-center">
          <InfoChip label="ID"      value={store.store_id} />
          {store.state    && <InfoChip label="State"    value={store.state} />}
          {store.category && <InfoChip label="Category" value={store.category} />}
          <InfoChip label="Total Revenue"  value={fmtInr(totalRev)} />
          <InfoChip label="Monthly Avg"    value={fmtInr(avgMo)} />
          <InfoChip label="Active Months"  value={`${activeMo} / ${months.length}`} />
          {target != null && <InfoChip label="Monthly Target" value={fmtInr(target)} />}
        </div>

        {/* ── Monthly Revenue Chart ── */}
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-800">Monthly Revenue</h3>
          <p className="text-[11px] text-gray-500 mt-0.5 mb-3">
            Revenue per month
            {target != null ? ` · dashed line = monthly target (${fmtInr(target)})` : ''}
          </p>
          <Plot
            data={[
              {
                type: 'bar',
                name: 'Revenue',
                x: months,
                y: revenues,
                marker: { color: barColors, opacity: 0.88 },
                hovertemplate: '<b>%{x}</b><br>Revenue: ₹%{y:,.0f}<extra></extra>',
              },
              ...(target != null
                ? [{
                    type:  'scatter' as const,
                    mode:  'lines' as const,
                    name:  'Target',
                    x:     months,
                    y:     months.map(() => target),
                    line:  { color: '#f59e0b', width: 2, dash: 'dash' as const },
                    hovertemplate: `<b>Target</b>: ₹${target.toLocaleString('en-IN')}<extra></extra>`,
                  }]
                : []),
            ]}
            layout={{
              ...PLOTLY_BASE,
              legend: {
                bgcolor: 'rgba(0,0,0,0)', font: { color: PT.font, size: 10 },
                orientation: 'h' as const, x: 0, y: -0.22,
              },
              xaxis: { ...PT_AXIS },
              yaxis: { ...PT_AXIS, tickformat: ',.0s' },
              hovermode: 'x unified' as const,
              margin: { l: 52, r: 12, t: 12, b: 80 },
              height: 340,
            }}
            config={{ displayModeBar: false, responsive: true }}
            style={{ width: '100%' }}
          />
        </div>

        {/* ── Target vs Actual ── */}
        {target != null && targetTotal != null && achievement != null && (
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-800 mb-4">Target vs Actual</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">

              <div className="text-center p-4 rounded-xl bg-gray-50 border border-gray-100">
                <p className="text-[10px] uppercase tracking-wider text-gray-400 font-bold mb-1">Actual Total</p>
                <p className="text-2xl font-bold text-gray-900">{fmtInr(totalRev)}</p>
                <p className="text-[11px] text-gray-400 mt-0.5">{months.length} months</p>
              </div>

              <div className="text-center p-4 rounded-xl bg-amber-50 border border-amber-100">
                <p className="text-[10px] uppercase tracking-wider text-amber-600 font-bold mb-1">Target Total</p>
                <p className="text-2xl font-bold text-amber-700">{fmtInr(targetTotal)}</p>
                <p className="text-[11px] text-amber-500 mt-0.5">
                  {fmtInr(target)}/mo × {months.length}
                </p>
              </div>

              <div className={cn(
                'text-center p-4 rounded-xl border',
                achievement >= 100
                  ? 'bg-emerald-50 border-emerald-100'
                  : achievement >= 80
                    ? 'bg-yellow-50 border-yellow-100'
                    : 'bg-red-50 border-red-100',
              )}>
                <p className={cn(
                  'text-[10px] uppercase tracking-wider font-bold mb-1',
                  achievement >= 100 ? 'text-emerald-600'
                    : achievement >= 80 ? 'text-yellow-600' : 'text-red-600',
                )}>Achievement</p>
                <p className={cn(
                  'text-2xl font-bold',
                  achievement >= 100 ? 'text-emerald-700'
                    : achievement >= 80 ? 'text-yellow-700' : 'text-red-700',
                )}>
                  {achievement.toFixed(1)}%
                </p>
                <p className={cn(
                  'text-[11px] mt-0.5',
                  achievement >= 100 ? 'text-emerald-500'
                    : achievement >= 80 ? 'text-yellow-500' : 'text-red-500',
                )}>
                  {achievement >= 100 ? 'On target' : `Gap: ${fmtInr(targetTotal - totalRev)}`}
                </p>
              </div>

            </div>
          </div>
        )}

      </main>

      {/* ── Footer ── */}
      <footer
        className="fixed bottom-0 inset-x-0 z-20 h-10 flex items-center justify-center border-t border-white/5"
        style={{ background: 'linear-gradient(90deg, #080f20 0%, #1e3a5f 50%, #080f20 100%)' }}
      >
        <span className="text-[11px] font-medium tracking-[0.18em] uppercase text-gray-500 select-none">
          Croma Analytics · DS &amp; DSG Store Intelligence Platform
        </span>
      </footer>

    </div>
  )
}
