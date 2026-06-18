/**
 * Shared Framer Motion animation variants.
 *
 * Import these instead of re-defining them in each component so that spring
 * physics stay identical across every tab and can be tuned in one place.
 */

/**
 * Stagger container for a row of KPI cards.
 * Children (using kpiItem) will entrance one-by-one with a short delay.
 *
 * Usage:
 *   <motion.div variants={kpiContainer} initial="hidden" animate="show">
 *     <motion.div variants={kpiItem}>…</motion.div>
 *   </motion.div>
 */
export const kpiContainer = {
  hidden: {},
  show:   { transition: { staggerChildren: 0.07, delayChildren: 0.05 } },
}

/**
 * Individual KPI card spring entrance — must be a direct child of kpiContainer.
 *
 * Usage: <motion.div variants={kpiItem}>
 */
export const kpiItem = {
  hidden: { opacity: 0, y: 20, scale: 0.93 },
  show:   {
    opacity: 1, y: 0, scale: 1,
    transition: { type: 'spring' as const, stiffness: 300, damping: 24 },
  },
}

/**
 * Section panel slide-in spring.  Spread the return value onto a motion.div.
 * Pass a delay (seconds) to stagger multiple panels on the same page.
 *
 * @param delay - entrance delay in seconds (default 0)
 *
 * Usage: <motion.div {...panelSpring(0.12)}>
 */
export const panelSpring = (delay = 0) => ({
  initial:    { opacity: 0, y: 28 },
  animate:    { opacity: 1, y: 0 },
  transition: { type: 'spring' as const, stiffness: 260, damping: 24, delay },
})
