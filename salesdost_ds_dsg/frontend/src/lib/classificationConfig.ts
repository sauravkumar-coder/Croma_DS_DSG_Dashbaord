// Classification thresholds — all activity values are cumulative phase totals
// (sum of monthly_sales across the phase's months, which equals policies sold).
// Growth % = (recentTotal - earlyTotal) / earlyTotal × 100
export const CLASSIFICATION_CONFIG = {
  // New Bloomer — essentially inactive early, now contributing
  NEW_BLOOMER_EARLY_CEILING:  10,    // earlyTotal must be ≤ this
  NEW_BLOOMER_REVENUE_RATIO:  0.10,  // earlyTotal must be ≤ this fraction of recentTotal (OR earlyTotal = 0)

  // Fallen Star — established store, strict monotone decline ≥ 30%
  // Requires: earlyTotal > midTotal > recentTotal AND earlyTotal > medianEarlyRevenue
  FALLEN_STAR_DECLINE:        30,    // ((earlyTotal - recentTotal) / earlyTotal) × 100 must be ≥ this

  // Rising Star — established store, strict monotone growth ≥ 30%
  // Requires: earlyTotal < midTotal < recentTotal AND recentTotal > medianRecentRevenue
  RISING_STAR_GROWTH:         30,    // ((recentTotal - earlyTotal) / earlyTotal) × 100 must be ≥ this

  // Declining Store — weakening store (not severe enough for Fallen Star)
  DECLINING_THRESHOLD:        15,    // ((earlyTotal - recentTotal) / earlyTotal) × 100 must be ≥ this

  // Growing Store — improving store (not yet Rising Star level)
  GROWING_THRESHOLD:          15,    // growth % must be ≥ this
} as const
