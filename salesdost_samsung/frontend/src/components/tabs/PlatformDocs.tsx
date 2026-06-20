import { useRef, useState, useEffect } from 'react'
import { cn } from '../../lib/utils'

// ── Section IDs for TOC ───────────────────────────────────────────────────────
const SECTIONS = [
  { id: 'overview',        label: 'Platform Overview'        },
  { id: 'folder-structure',label: 'Folder Structure'         },
  { id: 'file-reference',  label: 'File Reference'           },
  { id: 'dashboard-pages', label: 'Dashboard Pages'          },
  { id: 'kpi-dictionary',  label: 'KPI Dictionary'           },
  { id: 'calc-engine',     label: 'Calculation Engine'       },
  { id: 'classification',  label: 'Classification Logic'     },
  { id: 'data-flow',       label: 'Data Flow'                },
  { id: 'function-registry','label': 'Function Registry'     },
  { id: 'data-policy',     label: 'Data Policy'              },
  { id: 'input-formats',   label: 'Input File Formats'       },
]

// ── Reusable primitives ───────────────────────────────────────────────────────

function SectionAnchor({ id }: { id: string }) {
  return <div id={id} className="-mt-6 pt-6 block" />
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xl font-bold text-gray-900 mb-4 pb-2 border-b border-gray-200">
      {children}
    </h2>
  )
}

function SubTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-base font-semibold text-gray-800 mt-6 mb-3">{children}</h3>
}

function InfoCard({
  title,
  badge,
  badgeColor = 'blue',
  children,
}: {
  title: string
  badge?: string
  badgeColor?: 'blue' | 'green' | 'amber' | 'red' | 'purple' | 'gray'
  children: React.ReactNode
}) {
  const colors = {
    blue:   'bg-blue-50 text-blue-700 border-blue-200',
    green:  'bg-emerald-50 text-emerald-700 border-emerald-200',
    amber:  'bg-amber-50 text-amber-700 border-amber-200',
    red:    'bg-red-50 text-red-700 border-red-200',
    purple: 'bg-purple-50 text-purple-700 border-purple-200',
    gray:   'bg-gray-100 text-gray-600 border-gray-200',
  }
  return (
    <div className="border border-gray-200 rounded-xl bg-white overflow-hidden mb-4">
      <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 border-b border-gray-200">
        <span className="font-semibold text-sm text-gray-900">{title}</span>
        {badge && (
          <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full border', colors[badgeColor])}>
            {badge}
          </span>
        )}
      </div>
      <div className="px-4 py-3 text-sm text-gray-700 space-y-1.5">{children}</div>
    </div>
  )
}

function CodeBlock({ children }: { children: React.ReactNode }) {
  return (
    <pre className="bg-gray-950 text-gray-100 text-xs rounded-lg p-4 overflow-x-auto leading-relaxed font-mono my-3">
      {children}
    </pre>
  )
}

function FormulaBlock({ label, formula, inputs, output, example }: {
  label: string; formula: string; inputs: string; output: string; example?: string
}) {
  return (
    <div className="border border-blue-100 rounded-lg bg-blue-50/40 p-4 mb-3">
      <div className="font-semibold text-blue-900 mb-2">{label}</div>
      <div className="bg-white rounded border border-blue-200 px-3 py-2 font-mono text-sm text-blue-800 mb-2">{formula}</div>
      <div className="grid grid-cols-2 gap-2 text-xs text-gray-600">
        <div><span className="font-medium text-gray-700">Inputs: </span>{inputs}</div>
        <div><span className="font-medium text-gray-700">Output: </span>{output}</div>
        {example && <div className="col-span-2"><span className="font-medium text-gray-700">Example: </span>{example}</div>}
      </div>
    </div>
  )
}

function CategoryBadge({ name, color }: { name: string; color: string }) {
  return (
    <span className={cn('inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border', color)}>
      {name}
    </span>
  )
}

function Table({ headers, rows }: { headers: string[]; rows: (string | React.ReactNode)[][] }) {
  return (
    <div className="overflow-x-auto my-3">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="bg-gray-100">
            {headers.map((h, i) => (
              <th key={i} className="text-left px-3 py-2 font-semibold text-gray-700 border border-gray-200 whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className={ri % 2 === 0 ? 'bg-white' : 'bg-gray-50/60'}>
              {row.map((cell, ci) => (
                <td key={ci} className="px-3 py-2 text-gray-700 border border-gray-200 align-top">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function FlowStep({ step, label, sublabel, connector = true }: {
  step: string; label: string; sublabel?: string; connector?: boolean
}) {
  return (
    <div className="flex flex-col items-center">
      <div className="flex items-center gap-3 w-full max-w-xs">
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold">
          {step}
        </div>
        <div className="flex-1 border border-blue-200 rounded-lg bg-blue-50 px-3 py-2">
          <div className="font-semibold text-blue-900 text-sm">{label}</div>
          {sublabel && <div className="text-xs text-blue-700 mt-0.5">{sublabel}</div>}
        </div>
      </div>
      {connector && (
        <div className="w-0.5 h-5 bg-gray-300 my-0.5" />
      )}
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function PlatformDocs() {
  const [activeSection, setActiveSection] = useState('overview')
  const contentRef = useRef<HTMLDivElement>(null)

  // Track active section via IntersectionObserver
  useEffect(() => {
    const observers: IntersectionObserver[] = []
    SECTIONS.forEach(({ id }) => {
      const el = document.getElementById(id)
      if (!el) return
      const obs = new IntersectionObserver(
        ([entry]) => { if (entry.isIntersecting) setActiveSection(id) },
        { rootMargin: '-20% 0px -70% 0px' },
      )
      obs.observe(el)
      observers.push(obs)
    })
    return () => observers.forEach(o => o.disconnect())
  }, [])

  const scrollTo = (id: string) => {
    const el = document.getElementById(id)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="flex gap-6 relative">

      {/* ── Sticky TOC sidebar ───────────────────────────────────────────────── */}
      <aside className="hidden xl:block w-52 shrink-0">
        <div className="sticky top-44 space-y-0.5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 px-3 mb-2">
            Contents
          </p>
          {SECTIONS.map(s => (
            <button
              key={s.id}
              onClick={() => scrollTo(s.id)}
              className={cn(
                'w-full text-left px-3 py-1.5 rounded-md text-xs transition-colors',
                activeSection === s.id
                  ? 'bg-blue-50 text-blue-700 font-semibold'
                  : 'text-gray-500 hover:text-gray-800 hover:bg-gray-100',
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      </aside>

      {/* ── Main content ─────────────────────────────────────────────────────── */}
      <div ref={contentRef} className="flex-1 min-w-0 space-y-10">

        {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 1. PLATFORM OVERVIEW */}
        <section>
          <SectionAnchor id="overview" />
          <SectionTitle>Platform Overview</SectionTitle>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            {[
              { label: 'Platform',   value: 'Croma Analytics — DS & DSG Store Intelligence' },
              { label: 'Purpose',    value: 'Analytics for Device Secure (DS) & Device Secure Gold (DSG) plan sales across Croma retail stores in India' },
              { label: 'Stack',      value: 'FastAPI (Python) backend · React + TypeScript + Vite frontend · Plotly charts · Tailwind CSS' },
            ].map(item => (
              <div key={item.label} className="border border-gray-200 rounded-xl bg-white p-4">
                <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">{item.label}</div>
                <div className="text-sm text-gray-800">{item.value}</div>
              </div>
            ))}
          </div>
          <InfoCard title="Design Principles" badge="Core Rules" badgeColor="blue">
            <ul className="space-y-1.5 list-none">
              {[
                'Raw files (sales + targets) are the single source of truth.',
                'All KPIs, rankings, classifications and projections are derived dynamically — nothing is persisted.',
                'Backend holds uploaded sales in memory only (cleared on restart); targets are persisted to disk.',
                'Every metric is traceable: output → calculation function → input columns → source file.',
                'No duplicated business logic across tabs — all tabs read from the shared classification result.',
              ].map((p, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-blue-500 font-bold mt-0.5 shrink-0">→</span>
                  <span>{p}</span>
                </li>
              ))}
            </ul>
          </InfoCard>
        </section>

        {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 2. FOLDER STRUCTURE */}
        <section>
          <SectionAnchor id="folder-structure" />
          <SectionTitle>Folder Structure</SectionTitle>

          <SubTitle>Backend</SubTitle>
          <Table
            headers={['Path', 'Type', 'Purpose', 'Key Outputs']}
            rows={[
              ['backend/main.py',             'FastAPI app',   'API server, endpoint routing, in-memory sales state',         'REST endpoints, merged dashboard payload'],
              ['backend/parser.py',           'Python module', 'Parse XLSX files (sales + targets), detect format automatically', 'List[StoreRecord], Dict[store_id → target]'],
              ['backend/storage.py',          'Python module', 'File I/O abstraction for targets & tracker sales on disk',    'target_registry.json, XLSX files in data/'],
              ['backend/tracker.py',          'Python module', 'Parse Target Tracker XLSX (different format from main dashboard)', 'List[target rows], sales rows + month metadata'],
              ['backend/generate_sample.py',  'Python script', 'Generate deterministic 80-store 6-month demo dataset',       'sample_sales.xlsx, sample_targets.xlsx'],
              ['backend/data/targets/',       'Folder',        'Persisted monthly target XLSX files (YYYY-MM_target.xlsx)',   'Active and inactive target files'],
              ['backend/data/sales/monthly/', 'Folder',        'Persisted tracker monthly sales XLSX files',                 'YYYY-MM_tracker_sales.xlsx'],
              ['backend/data/metadata/',      'Folder',        'Registry JSON (target_registry.json) — metadata index',      'target_registry.json'],
              ['backend/data/archive/',       'Folder',        'Archived target files (moved, not deleted)',                  'Archived XLSX copies'],
            ]}
          />

          <SubTitle>Frontend</SubTitle>
          <Table
            headers={['Path', 'Type', 'Purpose']}
            rows={[
              ['frontend/src/App.tsx',                        'Root component',  'Tab router, filter bar, global layout, sticky nav'],
              ['frontend/src/contexts/DataContext.tsx',       'React context',   'Global store data + classification result, shared across all tabs'],
              ['frontend/src/hooks/useFilters.ts',            'React hook',      'Per-tab independent filter state (state, category, fromMonth, toMonth)'],
              ['frontend/src/lib/api.ts',                     'HTTP client',     'Axios API client + TypeScript interfaces for all data models'],
              ['frontend/src/lib/classificationEngine.ts',   'Core engine',     'Store taxonomy: computes phase totals, growth %, trend score, and assigns 1 of 7 categories'],
              ['frontend/src/lib/classificationConfig.ts',   'Config',          'Threshold constants for classification (e.g. RISING_STAR_GROWTH = 30)'],
              ['frontend/src/lib/categoryStyles.ts',         'Style map',       'Color + border CSS classes per store category'],
              ['frontend/src/lib/formatting.ts',             'Utilities',       'INR currency formatting, percentage formatting'],
              ['frontend/src/lib/plotlyTheme.ts',            'Utilities',       'Shared Plotly chart styling (fonts, colors, paper_bgcolor)'],
              ['frontend/src/lib/animations.ts',             'Utilities',       'Framer Motion animation presets used across tabs'],
              ['frontend/src/components/tabs/*.tsx',         'Tab components',  '10 individual dashboard tab components (see Dashboard Pages section)'],
              ['frontend/src/components/UploadScreen.tsx',   'Page',            'Initial data upload UI shown when no sales data is loaded'],
              ['frontend/src/components/SalesDataManager.tsx','Drawer',         'Slide-in drawer for managing uploaded data and targets'],
              ['frontend/src/pages/StoreDeepDivePage.tsx',   'Route page',      'Full-page route (/store/:storeId) for individual store analysis'],
              ['frontend/src/pages/TargetTrackerPage.tsx',   'Route page',      'Full-page route (/target-tracker) for the Target Tracker tool'],
            ]}
          />
        </section>

        {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 3. FILE REFERENCE */}
        <section>
          <SectionAnchor id="file-reference" />
          <SectionTitle>File Reference</SectionTitle>

          {/* main.py */}
          <InfoCard title="backend/main.py" badge="FastAPI Server" badgeColor="purple">
            <p><strong>Purpose:</strong> FastAPI application entry point. Manages in-memory sales state and exposes all REST endpoints consumed by the frontend.</p>
            <p className="mt-1"><strong>Key State:</strong></p>
            <ul className="ml-4 list-disc space-y-0.5">
              <li><code className="bg-gray-100 px-1 rounded">_in_memory_sales</code> — List of parsed store records (lost on server restart)</li>
              <li><code className="bg-gray-100 px-1 rounded">_in_memory_sales_raw</code> — Raw XLSX bytes (allows re-parse without re-upload)</li>
              <li><code className="bg-gray-100 px-1 rounded">_sales_session_meta</code> — Upload metadata (filename, timestamp, record count)</li>
            </ul>
            <p className="mt-2"><strong>Key Functions:</strong></p>
            <Table
              headers={['Function', 'Purpose']}
              rows={[
                ['_validate_excel(file)',       'Validates .xlsx/.xls extension before processing'],
                ['_sort_months(months)',        'Sorts MMM-YYYY format chronologically (Jan-2024 < Feb-2024)'],
                ['_extract_months(stores)',     'Extracts unique month keys from store records'],
                ['_parse_bytes_as_sales(bytes)','Writes bytes to temp file, calls parser.parse_sales(), cleans up'],
                ['_read_active_targets()',      'Loads active target XLSX from disk and parses it'],
              ]}
            />
            <p className="mt-1"><strong>Used By:</strong> All frontend API calls (GET /api/data, POST /api/upload/sales, etc.)</p>
          </InfoCard>

          {/* parser.py */}
          <InfoCard title="backend/parser.py" badge="XLSX Parser" badgeColor="green">
            <p><strong>Purpose:</strong> Parses uploaded XLSX files into structured Python dicts. Auto-detects file format (pre-aggregated vs transactional for sales; legacy vs OW Budget for targets).</p>
            <p className="mt-2"><strong>Key Functions:</strong></p>
            <Table
              headers={['Function', 'Input', 'Output', 'Notes']}
              rows={[
                ['parse_sales(filepath)',         'XLSX path', 'list[StoreRecord dict]', 'Dispatches to pre-agg or transactional parser based on columns'],
                ['parse_targets(filepath)',       'XLSX path', 'dict[store_id → target_dict]', 'Handles legacy and OW Budget formats'],
                ['_parse_transactional(df)',      'DataFrame', 'list[StoreRecord dict]', 'Groups GROSS_AMOUNT by store + month + Sub Classification'],
                ['_parse_ow_targets(df)',         'DataFrame', 'dict[store_id → target_dict]', 'Uses OOW column as monthly target; parses manager hierarchy'],
                ['get_month_columns(df)',         'DataFrame', 'list[str]',              'Returns columns matching MMM-YYYY pattern'],
                ['detect_month_from_filename(f)','String',    '"Jun-2026" or None',      'Extracts month from filename using regex'],
                ['validate_store_match(s,t)',     'Two DFs',   'list[str] warnings',     'Checks Store_ID overlap between sales and target files'],
              ]}
            />
            <p className="mt-1"><strong>Used By:</strong> main.py (all upload endpoints)</p>
          </InfoCard>

          {/* storage.py */}
          <InfoCard title="backend/storage.py" badge="File I/O" badgeColor="amber">
            <p><strong>Purpose:</strong> Centralized disk I/O layer for persistent data (targets, tracker sales). Designed for easy migration to cloud storage (S3) in future.</p>
            <p className="mt-2"><strong>Key Functions:</strong></p>
            <Table
              headers={['Function', 'Purpose']}
              rows={[
                ['save_target_file(content, month)', 'Write target XLSX bytes to disk, update registry'],
                ['load_target_file(month)',           'Read target file bytes for a given month'],
                ['list_target_files()',              'Return all registered targets + their metadata'],
                ['set_active_target(month)',         'Mark a month\'s target as active in registry'],
                ['archive_target_file(month)',       'Move target to archive folder'],
                ['save_tracker_sales(content, month)','Write tracker monthly sales XLSX to disk'],
                ['list_tracker_sales()',             'List all persisted tracker sales files'],
              ]}
            />
          </InfoCard>

          {/* classificationEngine.ts */}
          <InfoCard title="frontend/src/lib/classificationEngine.ts" badge="Core Engine" badgeColor="blue">
            <p><strong>Purpose:</strong> The central analytics engine. Takes all store records + month list, divides months into 3 phases, computes store-level metrics, and assigns each store one of 7 categories.</p>
            <p className="mt-2"><strong>Key Functions:</strong></p>
            <Table
              headers={['Function', 'Input', 'Output', 'Purpose']}
              rows={[
                ['classifyAllStores(stores, months)', 'stores[], months[]', 'ClassificationResult', 'Master function — orchestrates all metrics and classification'],
                ['allocatePhases(months)',             'months[]',           '{early, mid, recent}', 'Splits months into 3 equal phases'],
                ['computeStoreMetrics(store, phases)','StoreRecord, phases','StoreMetrics',          'Computes growthPct, momentumPct, trendScore, stabilityScore, ranks'],
                ['classifyStore(metrics, medians)',   'StoreMetrics',       'StoreCategory',         'Applies 7-category classification rules in priority order'],
                ['computeTrendScore(store, months)',  'StoreRecord, months[]','number',              'Linear regression slope / mean × 100'],
                ['computeStabilityScore(store, months)','StoreRecord, months[]','number',            'Coefficient of variation (std dev / mean × 100)'],
              ]}
            />
            <p className="mt-1"><strong>Used By:</strong> DataContext.tsx → all 10 dashboard tabs</p>
          </InfoCard>

          {/* DataContext.tsx */}
          <InfoCard title="frontend/src/contexts/DataContext.tsx" badge="Global State" badgeColor="gray">
            <p><strong>Purpose:</strong> React context that fetches data from <code className="bg-gray-100 px-1 rounded">GET /api/data</code>, runs the classification engine, and provides the result to all tabs.</p>
            <p className="mt-2"><strong>Exposed Values:</strong> <code className="bg-gray-100 px-1 rounded">stores, months, states, categories, classification, hasData, isLoading, refetchData</code></p>
            <p className="mt-1"><strong>Used By:</strong> All 10 tab components via <code className="bg-gray-100 px-1 rounded">useDataContext()</code></p>
          </InfoCard>
        </section>

        {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 4. DASHBOARD PAGES */}
        <section>
          <SectionAnchor id="dashboard-pages" />
          <SectionTitle>Dashboard Pages</SectionTitle>

          <Table
            headers={['Tab', 'File', 'Purpose', 'Charts', 'Key Business Question']}
            rows={[
              [
                'Overview',
                'ExecutiveOverview.tsx',
                'Network-level health snapshot — what is happening across all stores at a glance',
                'Sankey (store tier migration), KPI counter cards',
                'Are more stores growing or declining? How has the network shifted?',
              ],
              [
                'Revenue Trend',
                'MonthlyRevenue.tsx',
                'Month-by-month distribution of store revenues across the entire network',
                'Box plots (Q1/median/Q3/IQR) per month, phase comparison cards',
                'Is network revenue improving over time? Which months were outlier peaks or troughs?',
              ],
              [
                'Store Level Insight',
                'StoreJourneyMap.tsx',
                'Visualise where each store started vs where it is now; filter by category',
                'Scatter/bubble (early vs recent), funnel, category donut',
                'Which stores have changed trajectory? How are stores distributed across categories?',
              ],
              [
                'State Level Performance',
                'StateJourneyAnalysis.tsx',
                'State-level rollup — health, risk, and opportunity by geography',
                'Stacked bar (categories per state), state scatter, heatmap',
                'Which states are growing vs declining? Where are the high-risk concentrations?',
              ],
              [
                'Store Spotlight',
                'StoreDeepDive.tsx',
                'Full detail view of a single selected store across all time periods',
                'Time-series line, phase bars, plan count chart, metric cards',
                'What is the complete story for this store — trend, rank, category, projections?',
              ],
              [
                'Target Tracker',
                'TargetCommandCenter.tsx',
                'Current-month target vs actual tracking with daily run rate projections',
                'Progress bars, pace gauge, risk zone chart',
                'Are stores on track to hit this month\'s target? Who needs attention today?',
              ],
            ]}
          />

          <SubTitle>Filter System</SubTitle>
          <p className="text-sm text-gray-600 mb-3">
            Every tab has its own independent filter state managed by <code className="bg-gray-100 px-1 rounded">useFilters.ts</code>.
            Changing filters on one tab does not affect other tabs.
          </p>
          <Table
            headers={['Filter', 'Type', 'Effect']}
            rows={[
              ['State',     'Dropdown — all Indian states present in data', 'Shows only stores in the selected state'],
              ['Category',  'Dropdown — all store categories',              'Shows only stores matching the selected category'],
              ['From Month','Dropdown — all months in dataset',             'Trims the analysis window start date'],
              ['To Month',  'Dropdown — all months in dataset',             'Trims the analysis window end date'],
            ]}
          />
        </section>

        {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 5. KPI DICTIONARY */}
        <section>
          <SectionAnchor id="kpi-dictionary" />
          <SectionTitle>KPI Dictionary</SectionTitle>

          <SubTitle>Store-Level KPIs</SubTitle>
          <Table
            headers={['KPI', 'Business Meaning', 'Formula', 'Input Columns', 'Unit']}
            rows={[
              ['Early Total',      'Baseline revenue — revenue in the first third of the analysis period',          'Sum of monthly_sales for early-phase months',                           'monthly_sales (GROSS_AMOUNT or pre-agg columns)', '₹'],
              ['Mid Total',        'Mid-period performance — revenue in the middle third',                          'Sum of monthly_sales for mid-phase months',                             'monthly_sales',                                   '₹'],
              ['Recent Total',     'Latest performance — revenue in the most recent third of the period',           'Sum of monthly_sales for recent-phase months',                          'monthly_sales',                                   '₹'],
              ['Total Revenue',    'Lifetime revenue within the loaded dataset',                                    'Sum of all monthly_sales values across all months',                     'monthly_sales',                                   '₹'],
              ['Growth %',         'Overall directional change from baseline to current — positive = improving',   '(recentTotal − earlyTotal) / earlyTotal × 100',                         'earlyTotal, recentTotal',                         '%'],
              ['Momentum %',       'Acceleration — how much has performance changed from mid to recent phase',     '(recentTotal − midTotal) / midTotal × 100',                             'midTotal, recentTotal',                           '%'],
              ['Trend Score',      'Directional velocity — positive = upward slope, negative = downward',          'Linear regression slope / mean × 100',                                  'All monthly_sales values',                        'Normalized'],
              ['Stability Score',  'Revenue volatility — lower = more predictable, higher = erratic',              '(std dev / mean) × 100  [Coefficient of Variation]',                   'All monthly_sales values',                        '%'],
              ['Early Rank',       'Store\'s rank by earlyTotal revenue among all stores in the dataset',          'Dense rank descending by earlyTotal',                                   'earlyTotal across all stores',                    'Rank #'],
              ['Recent Rank',      'Store\'s current rank by recentTotal revenue',                                 'Dense rank descending by recentTotal',                                  'recentTotal across all stores',                   'Rank #'],
              ['Overall Rank',     'Store\'s overall rank by totalRevenue',                                        'Dense rank descending by totalRevenue',                                 'totalRevenue across all stores',                  'Rank #'],
            ]}
          />

          <SubTitle>Network-Level KPIs (Overview & State tabs)</SubTitle>
          <Table
            headers={['KPI', 'Business Meaning', 'Formula', 'Unit']}
            rows={[
              ['Network Share (category)', 'What % of total recent network revenue comes from stores in this category', 'Sum(recent for category) / Sum(all recent) × 100', '%'],
              ['Median Early Revenue',     'The median store\'s early revenue — used as the Rising/Fallen Star significance threshold', 'Median of all earlyTotal values across stores', '₹'],
              ['Median Recent Revenue',    'The median store\'s recent revenue — used as the Rising Star significance threshold',       'Median of all recentTotal values across stores', '₹'],
              ['State Health %',           'Share of growing or rising stores in a state — higher is healthier',        'Count(Rising + Growing) / total stores in state × 100',  '%'],
              ['State Risk %',             'Share of declining or fallen stores in a state — higher is riskier',        'Count(Fallen + Declining) / total stores in state × 100', '%'],
            ]}
          />

          <SubTitle>Target Tracker KPIs</SubTitle>
          <Table
            headers={['KPI', 'Business Meaning', 'Formula', 'Unit']}
            rows={[
              ['Achievement %',      'How much of the monthly target has been achieved so far',                   'Current Sales / Target × 100',                     '%'],
              ['Gap Amount',         'Absolute shortfall from target',                                            'Target − Current Sales',                            '₹'],
              ['Gap %',             'Relative shortfall as a percentage of target',                               '(Target − Current Sales) / Target × 100',          '%'],
              ['Days Elapsed',       'Calendar days passed since the start of the month',                         'Current day of month (auto-calculated)',             'days'],
              ['Required DRR',       'Daily revenue per store needed for the rest of the month to hit target',    'Gap / (31 − Days Elapsed)',                         '₹/day'],
              ['Projected Sales',    'Estimated month-end sales if current pace continues',                       '(Current Sales / Days Elapsed) × 31',               '₹'],
              ['Projected Ach %',    'Estimated final achievement percentage at current pace',                    'Projected Sales / Target × 100',                   '%'],
            ]}
          />

          <SubTitle>Box Plot Statistics (Revenue Trend tab)</SubTitle>
          <Table
            headers={['Statistic', 'Formula', 'Meaning']}
            rows={[
              ['Q1 (25th pct)',   'Median of lower half of sorted values',             '25% of stores earn below this value in the month'],
              ['Median (Q2)',     'Middle value of sorted revenue list',               'Typical store revenue for the month'],
              ['Q3 (75th pct)',   'Median of upper half of sorted values',             '75% of stores earn below this value in the month'],
              ['IQR',            'Q3 − Q1',                                           'Spread of the middle 50% of stores'],
              ['Lower Fence',    'Q1 − 1.5 × IQR',                                   'Outlier threshold (low side)'],
              ['Upper Fence',    'Q3 + 1.5 × IQR',                                   'Outlier threshold (high side)'],
              ['Outliers',       'Revenue < Lower Fence OR > Upper Fence',            'Unusually low or high performing stores for that month'],
            ]}
          />
        </section>

        {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 6. CALCULATION ENGINE */}
        <section>
          <SectionAnchor id="calc-engine" />
          <SectionTitle>Calculation Engine</SectionTitle>

          <p className="text-sm text-gray-600 mb-4">
            All calculations originate in <code className="bg-gray-100 px-1 rounded">classificationEngine.ts</code> and are computed fresh on every data load.
            No calculated values are stored or cached.
          </p>

          <FormulaBlock
            label="Growth %"
            formula="growthPct = (recentTotal − earlyTotal) / earlyTotal × 100"
            inputs="recentTotal, earlyTotal (from phase allocation)"
            output="Percentage — positive = growth, negative = decline"
            example="earlyTotal = ₹10L, recentTotal = ₹14L → growthPct = 40%"
          />

          <FormulaBlock
            label="Momentum %"
            formula="momentumPct = (recentTotal − midTotal) / midTotal × 100"
            inputs="recentTotal, midTotal (from phase allocation)"
            output="Percentage — measures recent acceleration vs mid-period"
            example="midTotal = ₹12L, recentTotal = ₹14L → momentumPct = 16.7%"
          />

          <FormulaBlock
            label="Trend Score (Linear Regression)"
            formula="slope = (n·ΣxᵢYᵢ − ΣxᵢΣYᵢ) / (n·Σxᵢ² − (Σxᵢ)²)   |   trendScore = slope / mean × 100"
            inputs="All monthly_sales values (Y) over time indices 1,2,...,n (X)"
            output="Normalized score — positive = upward slope, negative = downward"
            example="4 months: [10L, 11L, 12L, 13L] → slope = 1L/month → trendScore ≈ 8.7"
          />

          <FormulaBlock
            label="Stability Score (Coefficient of Variation)"
            formula="CV = (std_dev / mean) × 100   where   std_dev = √(Σ(vᵢ − mean)² / n)"
            inputs="All monthly_sales values across the dataset period"
            output="Percentage — 0% = perfectly flat revenue, higher = more volatile"
            example="[10L, 10L, 10L, 10L] → CV = 0%   |   [5L, 15L, 5L, 15L] → CV = 44.7%"
          />

          <FormulaBlock
            label="Phase Allocation"
            formula="phase_size = floor(n / 3)   |   remainder distributed: r=1 → recent+1; r=2 → early+1, recent+1"
            inputs="Ordered list of months in the dataset"
            output="Three lists: earlyMonths[], midMonths[], recentMonths[]"
            example="12 months → 4 early, 4 mid, 4 recent   |   10 months → 3 early, 3 mid, 4 recent"
          />

          <FormulaBlock
            label="Projected Achievement % (Target Tracker)"
            formula="dailyRate = currentSales / daysElapsed   |   projected = dailyRate × 31   |   projAch = projected / target × 100"
            inputs="currentSales (sum of tracker sales), daysElapsed (auto-calculated), target (from active target file)"
            output="Estimated final month achievement percentage"
            example="Sales so far = ₹15L, Day 10 of month, Target = ₹50L → daily rate = ₹1.5L → projected = ₹46.5L → projAch = 93%"
          />

          <FormulaBlock
            label="Required Daily Run Rate"
            formula="requiredDRR = (target − currentSales) / (31 − daysElapsed)"
            inputs="target, currentSales, daysElapsed"
            output="₹ per day needed to close the gap"
            example="Target = ₹50L, Sales = ₹15L, Day 10 → DRR = ₹35L / 21 days = ₹1.67L/day"
          />

          <SubTitle>Sankey — Store Tier Migration (Overview)</SubTitle>
          <p className="text-sm text-gray-700 mb-2">
            Visualises how stores have moved between performance tiers from the early phase to the recent phase.
          </p>
          <Table
            headers={['Step', 'Logic']}
            rows={[
              ['Early Tier',   'Stores ranked by earlyTotal. Top 33% = Top Tier, 34–66% = Mid Tier, bottom 33% = Low Tier'],
              ['Recent Tier',  'Same percentile logic applied to recentTotal'],
              ['Flow Paths',   'Each store creates a link from its early tier to its recent tier (e.g. "Mid → Top Tier")'],
              ['Sankey Links', 'Width of each flow = number of stores that made that transition'],
            ]}
          />
        </section>

        {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 7. CLASSIFICATION LOGIC */}
        <section>
          <SectionAnchor id="classification" />
          <SectionTitle>Store Classification Logic</SectionTitle>

          <p className="text-sm text-gray-600 mb-4">
            Every store is assigned exactly one category by <code className="bg-gray-100 px-1 rounded">classificationEngine.ts → classifyStore()</code>.
            Rules are evaluated in the priority order below — the first matching rule wins.
            Thresholds live in <code className="bg-gray-100 px-1 rounded">classificationConfig.ts</code> and can be adjusted without touching business logic.
          </p>

          <div className="space-y-4">

            <InfoCard title="1. New Bloomer" badge="Priority 1" badgeColor="green">
              <div className="flex items-center gap-2 flex-wrap mb-2">
                <CategoryBadge name="New Bloomer" color="bg-emerald-50 text-emerald-700 border-emerald-200" />
              </div>
              <p><strong>Business Meaning:</strong> A new market entrant or recently opened store that is gaining traction. Minimal baseline, clear early-stage growth.</p>
              <p className="mt-1"><strong>Conditions:</strong></p>
              <CodeBlock>{`earlyTotal ≤ 10 (near-zero baseline)
AND (earlyTotal = 0 OR earlyTotal ≤ 10% of recentTotal)
AND recentTotal > earlyTotal`}</CodeBlock>
              <p><strong>Config constant:</strong> <code className="bg-gray-100 px-1 rounded">NEW_BLOOMER_EARLY_CEILING = 10</code>, <code className="bg-gray-100 px-1 rounded">NEW_BLOOMER_REVENUE_RATIO = 0.10</code></p>
              <p><strong>Example:</strong> earlyTotal = ₹0, recentTotal = ₹8L → classified as New Bloomer</p>
            </InfoCard>

            <InfoCard title="2. Inactive Store" badge="Priority 2" badgeColor="gray">
              <div className="flex items-center gap-2 flex-wrap mb-2">
                <CategoryBadge name="Inactive Store" color="bg-gray-100 text-gray-600 border-gray-300" />
              </div>
              <p><strong>Business Meaning:</strong> Store has had no sales activity in the mid and recent phases — dormant or closed.</p>
              <CodeBlock>{`midTotal = 0 AND recentTotal = 0`}</CodeBlock>
              <p><strong>Action:</strong> Investigate whether the store is closed, data is missing, or a systematic issue exists.</p>
            </InfoCard>

            <InfoCard title="3. Fallen Star" badge="Priority 3" badgeColor="red">
              <div className="flex items-center gap-2 flex-wrap mb-2">
                <CategoryBadge name="Fallen Star" color="bg-red-50 text-red-700 border-red-200" />
              </div>
              <p><strong>Business Meaning:</strong> A formerly strong store in sustained, monotone decline across all three phases. Significant revenue at risk.</p>
              <p className="mt-1"><strong>Conditions:</strong></p>
              <CodeBlock>{`earlyTotal > midTotal > recentTotal   (strict monotone decline)
AND growthPct ≤ −30%
AND earlyTotal > medianEarlyRevenue  (was a significant store)`}</CodeBlock>
              <p><strong>Config constant:</strong> <code className="bg-gray-100 px-1 rounded">FALLEN_STAR_DECLINE = 30</code></p>
              <p><strong>Example:</strong> earlyTotal = ₹20L, midTotal = ₹14L, recentTotal = ₹8L → decline = 60% → Fallen Star</p>
            </InfoCard>

            <InfoCard title="4. Rising Star" badge="Priority 4" badgeColor="blue">
              <div className="flex items-center gap-2 flex-wrap mb-2">
                <CategoryBadge name="Rising Star" color="bg-blue-50 text-blue-700 border-blue-200" />
              </div>
              <p><strong>Business Meaning:</strong> A high-performing store with consistent, strong growth across all three phases. These are the network's success stories.</p>
              <p className="mt-1"><strong>Conditions:</strong></p>
              <CodeBlock>{`earlyTotal < midTotal < recentTotal   (strict monotone growth)
AND growthPct ≥ 30%
AND recentTotal > medianRecentRevenue  (materially significant now)`}</CodeBlock>
              <p><strong>Config constant:</strong> <code className="bg-gray-100 px-1 rounded">RISING_STAR_GROWTH = 30</code></p>
              <p><strong>Example:</strong> earlyTotal = ₹6L, midTotal = ₹9L, recentTotal = ₹13L → growth = 117% → Rising Star</p>
            </InfoCard>

            <InfoCard title="5. Declining Store" badge="Priority 5" badgeColor="amber">
              <div className="flex items-center gap-2 flex-wrap mb-2">
                <CategoryBadge name="Declining Store" color="bg-orange-50 text-orange-700 border-orange-200" />
              </div>
              <p><strong>Business Meaning:</strong> Store performance is weakening but not yet at Fallen Star severity. Requires attention before it worsens.</p>
              <CodeBlock>{`recentTotal < earlyTotal
AND decline% ≥ 15%
(But does NOT meet Fallen Star strict-monotone + magnitude criteria)`}</CodeBlock>
              <p><strong>Config constant:</strong> <code className="bg-gray-100 px-1 rounded">DECLINING_THRESHOLD = 15</code></p>
            </InfoCard>

            <InfoCard title="6. Growing Store" badge="Priority 6" badgeColor="green">
              <div className="flex items-center gap-2 flex-wrap mb-2">
                <CategoryBadge name="Growing Store" color="bg-teal-50 text-teal-700 border-teal-200" />
              </div>
              <p><strong>Business Meaning:</strong> Positive momentum — store is growing but hasn't yet met the Rising Star threshold for magnitude or monotone consistency.</p>
              <CodeBlock>{`recentTotal > earlyTotal
AND growthPct ≥ 15%
(But does NOT meet Rising Star strict-monotone + scale criteria)`}</CodeBlock>
              <p><strong>Config constant:</strong> <code className="bg-gray-100 px-1 rounded">GROWING_THRESHOLD = 15</code></p>
            </InfoCard>

            <InfoCard title="7. Constant Store" badge="Default" badgeColor="gray">
              <div className="flex items-center gap-2 flex-wrap mb-2">
                <CategoryBadge name="Constant Store" color="bg-slate-100 text-slate-600 border-slate-300" />
              </div>
              <p><strong>Business Meaning:</strong> No strong directional trend in either direction. Baseline, stable performance. May have seasonal swings but no clear trajectory.</p>
              <CodeBlock>{`All other cases — catches stores with < 15% growth or decline, or volatile patterns without strong direction`}</CodeBlock>
            </InfoCard>

          </div>

          <SubTitle>Classification Thresholds Reference</SubTitle>
          <Table
            headers={['Constant', 'Default Value', 'Used In', 'Effect of Increasing']}
            rows={[
              ['NEW_BLOOMER_EARLY_CEILING',  '10 (₹)',   'New Bloomer check',   'Fewer stores qualify as New Bloomer'],
              ['NEW_BLOOMER_REVENUE_RATIO',  '0.10 (10%)','New Bloomer check',  'Stricter — early must be a smaller fraction of recent'],
              ['FALLEN_STAR_DECLINE',        '30%',      'Fallen Star check',   'Fewer stores classified as Fallen Stars'],
              ['RISING_STAR_GROWTH',         '30%',      'Rising Star check',   'Fewer stores classified as Rising Stars'],
              ['DECLINING_THRESHOLD',        '15%',      'Declining check',     'Fewer stores classified as Declining'],
              ['GROWING_THRESHOLD',          '15%',      'Growing check',       'Fewer stores classified as Growing'],
            ]}
          />
        </section>

        {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 8. DATA FLOW */}
        <section>
          <SectionAnchor id="data-flow" />
          <SectionTitle>Data Flow</SectionTitle>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div>
              <SubTitle>Sales Upload → Dashboard</SubTitle>
              <div className="flex flex-col items-start">
                <FlowStep step="1" label="User uploads Sales XLSX" sublabel="Via UploadScreen or SalesDataManager drawer" />
                <FlowStep step="2" label="POST /api/upload/sales" sublabel="Frontend sends file bytes to FastAPI" />
                <FlowStep step="3" label="parser.parse_sales()" sublabel="Auto-detects format. Extracts store_id, state, category, monthly_sales by month" />
                <FlowStep step="4" label="In-memory storage" sublabel="_in_memory_sales = list[StoreRecord]. Lost on restart. Raw bytes kept for reload." />
                <FlowStep step="5" label="GET /api/data" sublabel="Returns merged payload: stores[], months[], states[], categories[], target data" />
                <FlowStep step="6" label="DataContext.tsx" sublabel="Stores response in React global state. Triggers classification." />
                <FlowStep step="7" label="classifyAllStores()" sublabel="Phase allocation → metric computation → 7-category classification for every store" />
                <FlowStep step="8" label="All 10 tabs render" sublabel="Each tab reads from classification.metrics — no tab recomputes KPIs itself" connector={false} />
              </div>
            </div>
            <div>
              <SubTitle>Target Upload → Tracker</SubTitle>
              <div className="flex flex-col items-start">
                <FlowStep step="1" label="User uploads Target XLSX" sublabel="OW Budget or legacy format" />
                <FlowStep step="2" label="POST /api/upload/targets" sublabel="Month auto-detected from filename or content" />
                <FlowStep step="3" label="parser.parse_targets()" sublabel="Extracts store_id → {target, store_name, managers}" />
                <FlowStep step="4" label="storage.save_target_file()" sublabel="Written to data/targets/YYYY-MM_target.xlsx. Registry updated." />
                <FlowStep step="5" label="GET /api/data enrichment" sublabel="Active target merged into store records (store.target field)" />
                <FlowStep step="6" label="Target Tracker tab" sublabel="Reads store.target + tracker sales to compute achievement, gaps, projections" connector={false} />
              </div>
            </div>
          </div>

          <SubTitle>Data Transformation Steps</SubTitle>
          <Table
            headers={['Step', 'Location', 'Transformation', 'Input', 'Output']}
            rows={[
              ['Format detection', 'parser.py', 'Inspect column names to identify file format',      'Raw XLSX',         'Format type (transactional / pre-agg)'],
              ['Month normalisation','parser.py','Convert "Mar-26" → "Mar-2026" short years',         'Month strings',    'Standardised MMM-YYYY format'],
              ['Aggregation',       'parser.py', 'Sum GROSS_AMOUNT by store × month × product type', 'Transaction rows', 'monthly_sales, monthly_sales_ds, monthly_sales_dsg'],
              ['Merging',           'main.py',   'Join store records with target lookup dict',        'stores[], targets{}','Enriched stores with .target field'],
              ['Phase allocation',  'classificationEngine.ts','Split month list into 3 equal phases', 'months[]',         'earlyMonths[], midMonths[], recentMonths[]'],
              ['Metric computation','classificationEngine.ts','Compute phase totals, growth, trend, stability, ranks', 'StoreRecord, phases','StoreMetrics per store'],
              ['Classification',    'classificationEngine.ts','Apply 7-rule priority tree to metrics', 'StoreMetrics + network medians','StoreCategory for each store'],
              ['Rendering',         'Tab components','Filter, aggregate, format for display',          'ClassificationResult','Plotly charts + KPI cards'],
            ]}
          />
        </section>

        {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 9. FUNCTION REGISTRY */}
        <section>
          <SectionAnchor id="function-registry" />
          <SectionTitle>Function Registry</SectionTitle>

          <SubTitle>Backend Functions</SubTitle>
          <Table
            headers={['Function', 'File', 'Input Parameters', 'Return Value', 'Used By']}
            rows={[
              ['parse_sales(filepath)',            'parser.py',  'filepath: str',                                       'list[dict]',          '/api/upload/sales, /api/demo/load'],
              ['parse_targets(filepath)',          'parser.py',  'filepath: str',                                       'dict[str, dict]',     '/api/upload/targets, /api/data'],
              ['_parse_transactional(df)',         'parser.py',  'df: pd.DataFrame',                                    'list[dict]',          'parse_sales()'],
              ['_parse_ow_targets(df)',            'parser.py',  'df: pd.DataFrame',                                    'dict[str, dict]',     'parse_targets()'],
              ['get_month_columns(df)',            'parser.py',  'df: pd.DataFrame',                                    'list[str]',           'parse_sales()'],
              ['detect_month_from_filename(name)', 'parser.py',  'filename: str',                                       'str or None',         '/api/upload/targets, /api/tracker/sales/upload'],
              ['_normalise_month(m)',              'parser.py',  'm: str',                                              'str',                 'parse_sales(), parse_targets()'],
              ['validate_store_match(s, t)',       'parser.py',  'sales_df: DataFrame, target_df: DataFrame',           'list[str]',           'Optional validation step'],
              ['save_target_file(content, month)', 'storage.py', 'content: bytes, month_label: str',                   'dict metadata',       '/api/upload/targets, /api/targets/upload'],
              ['list_target_files()',              'storage.py', '—',                                                   'list[dict]',          '/api/targets/list'],
              ['set_active_target(month)',         'storage.py', 'month_label: str',                                    'None',                '/api/targets/set-active'],
              ['parse_tracker_target(filepath)',   'tracker.py', 'filepath: str',                                       'list[dict]',          '/api/tracker/data'],
              ['parse_tracker_sales(filepath)',    'tracker.py', 'filepath: str',                                       'dict',                '/api/tracker/data'],
              ['detect_sales_month(filepath)',     'tracker.py', 'filepath: str',                                       'str or None',         '/api/tracker/sales/upload'],
              ['_sort_months(months)',             'main.py',    'months: list[str]',                                   'list[str]',           '/api/data endpoint'],
              ['_read_active_targets()',           'main.py',    '—',                                                   'dict[str, dict]',     '/api/data endpoint'],
            ]}
          />

          <SubTitle>Frontend Functions</SubTitle>
          <Table
            headers={['Function', 'File', 'Input Parameters', 'Return Value', 'Used By']}
            rows={[
              ['classifyAllStores(stores, months)',   'classificationEngine.ts', 'StoreRecord[], string[]',        'ClassificationResult',   'DataContext.tsx'],
              ['allocatePhases(months)',              'classificationEngine.ts', 'string[]',                       '{early, mid, recent}',    'classifyAllStores()'],
              ['computeStoreMetrics(store, phases)',  'classificationEngine.ts', 'StoreRecord, Phases',            'StoreMetrics',           'classifyAllStores()'],
              ['classifyStore(metrics, medians)',     'classificationEngine.ts', 'StoreMetrics, medians',          'StoreCategory',          'computeStoreMetrics()'],
              ['computeTrendScore(store, months)',    'classificationEngine.ts', 'StoreRecord, string[]',          'number',                 'computeStoreMetrics()'],
              ['computeStabilityScore(store, months)','classificationEngine.ts','StoreRecord, string[]',          'number',                 'computeStoreMetrics()'],
              ['fetchDashboardData()',               'api.ts',                   '—',                              'Promise<DashboardData>', 'DataContext.tsx'],
              ['fetchStoreDetail(storeId)',          'api.ts',                   'storeId: string',                'Promise<StoreRecord>',   'StoreDeepDivePage.tsx'],
              ['formatINR(value)',                   'formatting.ts',            'value: number',                  'string',                 'All tabs with revenue display'],
              ['formatPct(value)',                   'formatting.ts',            'value: number',                  'string',                 'All tabs with percentage display'],
              ['useFilters()',                       'useFilters.ts',            '—',                              '{getFilters, setFilter, …}','App.tsx + all tabs'],
              ['useDataContext()',                   'DataContext.tsx',           '—',                              'DataContextValue',        'All 10 tab components'],
            ]}
          />
        </section>

        {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 10. DATA POLICY */}
        <section>
          <SectionAnchor id="data-policy" />
          <SectionTitle>Data Policy — No Static Data</SectionTitle>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div className="border border-red-200 rounded-xl bg-red-50 p-4">
              <div className="font-bold text-red-800 mb-2 text-sm">NEVER Stored / Persisted</div>
              <ul className="space-y-1 text-sm text-red-700">
                {[
                  'Calculated KPI values (growth %, trend score, etc.)',
                  'Store rankings (early rank, recent rank, overall rank)',
                  'Store classifications (Rising Star, Fallen Star, etc.)',
                  'Network aggregates (total network revenue, median values)',
                  'Projections (projected achievement, DRR)',
                  'Chart data (box plot statistics, sankey flows)',
                  'AI-generated insights',
                  'Filtered or aggregated subsets of data',
                ].map((item, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="font-bold shrink-0">✗</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="border border-green-200 rounded-xl bg-green-50 p-4">
              <div className="font-bold text-green-800 mb-2 text-sm">ONLY These Are Persisted</div>
              <ul className="space-y-1 text-sm text-green-700">
                {[
                  'Uploaded sales XLSX (in memory, cleared on restart)',
                  'Uploaded target XLSX files (to data/targets/ on disk)',
                  'Target registry metadata JSON (index of target files)',
                  'Tracker monthly sales XLSX (to data/sales/monthly/ on disk)',
                  'Raw XLSX bytes for reload without re-upload',
                ].map((item, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="font-bold shrink-0">✓</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <InfoCard title="Auditability Chain" badge="Traceability" badgeColor="blue">
            <p className="mb-2">Every number on the dashboard can be traced back to raw file columns:</p>
            <CodeBlock>{`Dashboard Display (e.g. "Rising Star — 40% growth")
  ↓
classifyStore() in classificationEngine.ts
  ↓
growthPct = (recentTotal − earlyTotal) / earlyTotal × 100
  ↓
recentTotal = sum of monthly_sales for recent phase months
  ↓
monthly_sales = from StoreRecord.monthly_sales["Mar-2025"]
  ↓
Source: GROSS_AMOUNT column (transactional format)
     OR: "Mar-2025" column (pre-aggregated format)
  ↓
Source File: uploaded_sales.xlsx (held in _in_memory_sales_raw)`}</CodeBlock>
          </InfoCard>

          <InfoCard title="Why This Architecture" badge="Rationale" badgeColor="purple">
            <ul className="space-y-1.5">
              <li><strong>Data freshness:</strong> Every dashboard load recomputes everything from raw data — no stale cached values.</li>
              <li><strong>Auditability:</strong> Any metric can be traced to its exact source column in the uploaded file.</li>
              <li><strong>Flexibility:</strong> Upload a new file → entire dashboard recalculates instantly.</li>
              <li><strong>No sync issues:</strong> Since nothing is stored, there is no risk of displayed values diverging from source data.</li>
              <li><strong>Simple maintenance:</strong> Change a threshold in classificationConfig.ts → every classification updates automatically.</li>
            </ul>
          </InfoCard>
        </section>

        {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 11. INPUT FILE FORMATS */}
        <section>
          <SectionAnchor id="input-formats" />
          <SectionTitle>Input File Formats</SectionTitle>

          <SubTitle>Sales File — Transactional Format (Primary)</SubTitle>
          <p className="text-sm text-gray-600 mb-2">
            Row per transaction. Parser auto-detects this format when <code className="bg-gray-100 px-1 rounded">SHIP_NODE</code> or{' '}
            <code className="bg-gray-100 px-1 rounded">Sub Classification</code> + <code className="bg-gray-100 px-1 rounded">GROSS_AMOUNT</code> columns are found.
          </p>
          <CodeBlock>{`Required columns:
  SHIP_NODE           → Store ID (e.g. "CR001")
  Category            → Store category/tier (e.g. "A+")
  State               → Indian state name
  Sub Classification  → "Device Secure Gold" or "Device Secure"
  GROSS_AMOUNT        → Revenue in ₹
  Month               → "Jan-24" or "Jan-2024"

Output per store:
  monthly_sales       = sum(DS + DSG GROSS_AMOUNT per month)
  monthly_sales_ds    = sum(Device Secure only per month)
  monthly_sales_dsg   = sum(Device Secure Gold only per month)
  monthly_plans_count = count of rows per month`}</CodeBlock>

          <SubTitle>Sales File — Pre-Aggregated Format (Legacy)</SubTitle>
          <p className="text-sm text-gray-600 mb-2">
            One row per store with monthly revenue pre-summed. No breakdown by DS/DSG.
          </p>
          <CodeBlock>{`Required columns:
  Store_ID    → Store identifier
  Store_Name  → Display name (optional)
  State       → Indian state name
  Category    → Store tier
  Jan-2024    → Revenue column (one per month in MMM-YYYY format)
  Feb-2024    → …
  (any number of month columns)`}</CodeBlock>

          <SubTitle>Target File — OW Budget Format (Primary)</SubTitle>
          <CodeBlock>{`Required columns:
  Store Key         → Store ID matching sales Store_ID
  Store Name        → Display name
  Head - Operations → Regional head name (optional)
  Zonal Manager     → ZM name (optional)
  Cluster Manager   → CM name (optional)
  OOW               → Monthly target in ₹`}</CodeBlock>

          <SubTitle>Target File — Legacy Format</SubTitle>
          <CodeBlock>{`Required columns:
  Store_ID        → Store ID
  Monthly_Target  → Target in ₹`}</CodeBlock>

          <SubTitle>Tracker Sales File</SubTitle>
          <CodeBlock>{`Required columns:
  Store Name  → Must match target file Store Name
  Sales       → Revenue in ₹ (or Amount / Revenue / Value)
  Date        → Transaction date (used to detect month and days elapsed)
  State       → Indian state (optional, for filtering)`}</CodeBlock>

          <SubTitle>File Naming Conventions (Storage Layer)</SubTitle>
          <Table
            headers={['File Type', 'Naming Pattern', 'Example']}
            rows={[
              ['Target XLSX',       'YYYY-MM_target.xlsx',         '2026-06_target.xlsx'],
              ['Tracker Sales XLSX','YYYY-MM_tracker_sales.xlsx',  '2026-06_tracker_sales.xlsx'],
              ['Target Registry',   'target_registry.json',        'backend/data/metadata/target_registry.json'],
            ]}
          />
        </section>

        {/* bottom padding */}
        <div className="h-10" />
      </div>
    </div>
  )
}
