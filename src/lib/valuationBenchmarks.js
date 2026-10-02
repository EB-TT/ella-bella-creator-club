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

/* ---------- Tooltip text — edit wording here ---------- */

export const COLUMN_HINTS = {
  handle: 'The creator\'s handle. Click to open their profile.',
  requested_at: 'When the valuation was requested, and by whom.',
  status:
    'Pending: queued. Running: in progress. Complete: done. Failed: hover for the reason. Stalled: no progress for 10+ minutes – retry.',
  median_views:
    'The middle value of views across posts from the last 90 days, excluding posts under 7 days old. Median rather than average, so one viral post doesn\'t skew it.',
  engagement:
    '(Likes + comments + shares + saves) ÷ views, across all counted posts. Instagram: likes and comments only. Benchmark: 5–10% good, over 10% ideal.',
  tar:
    'Target Action Ratio: (saves + shares + product-interest comments) ÷ views. Product-interest comments are found by AI, which reads a sample of comments on up to 20 top posts and flags purchase intent; the flagged share is applied to each post\'s total comments. Expand a row to see flagged comments. Benchmark: over 1%. Not available for Instagram.',
  suggested: `What the creator is worth from their median views: $${SUGGESTED_CPM_LOW} CPM (ideal) to $${SUGGESTED_CPM_HIGH} CPM (upper limit).`,
  quoted_rate: 'The rate the creator quoted. Editable any time; CPM updates instantly.',
  cpm: 'Cost per 1,000 views: quoted rate ÷ median views × 1,000. Benchmark: $15 or less ideal, up to $50 acceptable.',
  duration: 'How long the valuation took to run.',
  credits_used: 'Social Fetch credits used (about $0.002 each).',
}

export const DETAIL_HINTS = {
  comments_sampled: 'Comments read by the AI – one page from each of the top 20 posts by views.',
  comments_flagged: 'Comments the AI classed as product interest. Listed below.',
  comments_unclassified: 'Comments the AI couldn\'t label, e.g. due to an API error. Not counted in TAR.',
  window_truncated: 'This creator posts a lot, so only the most recent ~80 posts were checked.',
  prompt_hash: 'Identifies which version of the AI instructions labelled these comments.',
}

export const PLATFORM_HINTS = {
  engagementPartial: 'Likes and comments only – Instagram doesn\'t make shares or saves public.',
  needsInsights:
    'Saves and shares aren\'t public on Instagram. Ask the creator for an Insights screenshot to calculate this.',
}

/* ---------- API usage panel ---------- */

/** Social Fetch credits left: amber below the first, red below the second. */
export const CREDITS_AMBER_BELOW = 50
export const CREDITS_RED_BELOW = 10

export function creditsRag(credits) {
  if (credits == null) return null
  if (credits < CREDITS_RED_BELOW) return 'red'
  if (credits < CREDITS_AMBER_BELOW) return 'amber'
  return null
}

/** Claude Haiku 4.5 list prices, USD per million tokens. */
export const HAIKU_INPUT_PER_MTOK = 1
export const HAIKU_OUTPUT_PER_MTOK = 5

export const USAGE_HINTS = {
  socialFetch:
    "Credits left for scraping creator data. A typical TikTok valuation uses 5–25. Credits are managed by the admin – let them know if it's running low.",
  haiku:
    'Estimated cost of the AI that classifies comments, from tokens used by valuations this month. Billing is managed by the admin.',
}
