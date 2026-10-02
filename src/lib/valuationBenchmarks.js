/* Creator valuation benchmarks — the one place these thresholds live in the
   frontend. The valuate-creator Edge Function uses the same $15 / $50 CPM
   pair (LOW_CPM / HIGH_CPM in metrics.ts) for the suggested rate range. */

export const SUGGESTED_CPM_LOW = 15
export const SUGGESTED_CPM_HIGH = 50

const LABEL = { green: 'Good', amber: 'OK', red: 'Poor' }

/** Cost per 1,000 median views. Lower is better. */
export function cpmRag(cpm) {
  if (cpm == null) return null
  if (cpm <= 15) return 'green'
  if (cpm <= 50) return 'amber'
  return 'red'
}

/** Engagement rate as a decimal (0.12 = 12%). */
export function engagementRag(rate) {
  if (rate == null) return null
  if (rate > 0.1) return 'green'
  if (rate >= 0.05) return 'amber'
  return 'red'
}

/** True action rate as a decimal. */
export function tarRag(rate) {
  if (rate == null) return null
  return rate > 0.01 ? 'green' : 'red'
}

export const BENCHMARK_TEXT = {
  cpm: 'CPM: ≤ $15 good, $15–50 OK, > $50 poor',
  engagement: 'Engagement: > 10% good, 5–10% OK, < 5% poor',
  tar: 'TAR: > 1% good, otherwise poor',
}

export function ragLabel(rag) {
  return LABEL[rag] || ''
}

/** quoted_rate / median_views × 1000, or null when either is missing. */
export function calcCpm(quotedRate, medianViews) {
  if (quotedRate == null || quotedRate === '' || !medianViews) return null
  return (Number(quotedRate) / medianViews) * 1000
}
