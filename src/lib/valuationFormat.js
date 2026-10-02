const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })
const plain = new Intl.NumberFormat('en-US')
const usdRange = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumSignificantDigits: 2,
})
const usd2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })

export const DASH = '—'

export function formatCompact(n) {
  return n == null ? DASH : compact.format(n)
}

export function formatInt(n) {
  return n == null ? DASH : plain.format(n)
}

/** Decimal rate → percentage, e.g. 0.2053 → "20.5%". */
export function formatPct(rate, digits = 1) {
  return rate == null ? DASH : `${(rate * 100).toFixed(digits)}%`
}

/** Suggested rate range at two significant figures, e.g. "$96K – $320K". */
export function formatRateRange(low, high) {
  if (low == null || high == null) return DASH
  return `${usdRange.format(low)} – ${usdRange.format(high)}`
}

export function formatCpm(cpm) {
  return cpm == null ? DASH : usd2.format(cpm)
}

export function formatDuration(startedAt, completedAt) {
  if (!startedAt || !completedAt) return DASH
  const secs = Math.max(0, Math.round((new Date(completedAt) - new Date(startedAt)) / 1000))
  if (secs < 60) return `${secs}s`
  return `${Math.floor(secs / 60)}m ${String(secs % 60).padStart(2, '0')}s`
}

export function daysAgo(value, now = Date.now()) {
  return Math.floor((now - new Date(value).getTime()) / 86_400_000)
}

export function profileUrl(platform, handle) {
  if (platform === 'instagram') return `https://www.instagram.com/${handle}/`
  return `https://www.tiktok.com/@${handle}`
}

/** Strip a leading @, trim, lowercase — matches the table's handle check. */
export function normaliseHandle(raw) {
  return raw.trim().replace(/^@+/, '').trim().toLowerCase()
}
