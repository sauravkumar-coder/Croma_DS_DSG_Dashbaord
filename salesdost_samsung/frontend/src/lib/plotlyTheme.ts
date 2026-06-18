/**
 * Shared Plotly layout tokens for the light-mode dashboard.
 *
 * All chart components import from here so the visual theme is consistent
 * and can be updated from a single location — change PT.grid once and every
 * chart's gridlines update automatically.
 */

/** Base colour tokens referenced by axis and font config. */
export const PT = {
  font: '#6b7280',  // gray-500  — axis labels, tick text, legend
  grid: '#e5e7eb',  // gray-200  — chart gridlines
  line: '#d1d5db',  // gray-300  — axis lines and tick marks
} as const

/**
 * Transparent background + standard Inter font — spread into every Plotly layout.
 *
 * Usage:
 *   layout={{ ...PLOTLY_BASE, xaxis: { ... } }}
 */
export const PLOTLY_BASE = {
  paper_bgcolor: 'rgba(0,0,0,0)',
  plot_bgcolor:  'rgba(0,0,0,0)',
  font: { color: PT.font, family: 'Inter, sans-serif', size: 11 },
} as const

/**
 * Standard axis appearance (grid, line, tick colours + automargin).
 * Spread into `xaxis` / `yaxis` objects inside a Plotly layout.
 *
 * Usage:
 *   xaxis: { ...PT_AXIS, title: { text: 'Revenue (₹)' } }
 */
export const PT_AXIS = {
  gridcolor:  PT.grid,
  linecolor:  PT.line,
  tickcolor:  PT.line,
  automargin: true,
} as const
