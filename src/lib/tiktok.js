/* Everything the app needs to know about the TikTok sync that isn't a field
   definition: tooltip text, which fields lock when synced, the period selector
   and the new-filters logic. Tooltip copy lives in TIKTOK_HINTS only. */

import { todayISO } from './format'

/** Tooltip text. Keyed by field key, or by the item it describes. */
export const TIKTOK_HINTS = {
  // Fields
  gmv: "Net affiliate sales from TikTok: selling price × units, minus returns and refunds, before tax. Cancelled orders count as 0. Unsettled orders use TikTok's estimate.",
  units_sold_total:
    "Units on TikTok affiliate orders that weren't cancelled or fully returned. Partly refunded orders still count every unit.",
  units_sold_current_product:
    "Units on TikTok affiliate orders for the current product that weren't cancelled or fully returned. Partly refunded orders still count every unit.",
  first_sale_date: "First TikTok affiliate sale that wasn't cancelled or fully returned.",
  last_sale_at: "Latest TikTok affiliate sale that wasn't cancelled or fully returned.",
  first_video_date:
    "The creator's first video that drove a sale, and when it was posted. Videos without sales aren't visible to TikTok's API.",
  first_video_link:
    "The creator's first video that drove a sale, and when it was posted. Videos without sales aren't visible to TikTok's API.",
  other_videos:
    'For each other product, the first video that sold it. Each video is listed once with the products it sold. Most recent first.',
  current_product: 'From the latest approved TikTok sample, unless someone entered a newer product here.',
  product_sent_date: "From TikTok's shipping for the current sample. Blank until it ships.",
  product_delivery_date: "From TikTok's shipping for the current sample. Blank until it ships.",
  tiktok_shop_eligible: 'Set automatically once TikTok shows any affiliate activity.',
  other_products_received:
    'Products from earlier TikTok samples that shipped, plus anything entered here. TikTok entries are managed by the sync and cannot be removed.',

  // Shown beside Current Product when it is synced
  currentProductEditHint:
    'From the latest TikTok sample. Editing it here overrides TikTok until a newer sample arrives.',

  // Filters
  newFromTiktok:
    "Created automatically from TikTok activity and not yet reviewed. Clears when an owner is assigned or it's marked as reviewed.",
  requestCancelledOnly: 'Their only TikTok activity was a sample request that was cancelled before shipping.',
  suggested: 'TikTok activity suggests a later stage or a higher tier. Accept or dismiss in the drawer.',
  noSale: "Creators whose latest TikTok sale (Last sale) is older than the chosen number of days, or who haven't sold yet.",
  noContact: "Only creators whose Last Contact is also older than that number of days, or empty.",

  // Period selector
  period: 'Values for the selected period, calculated from TikTok sales. Stored totals are all-time.',

  // Drawer
  pendingSamples: 'Sample requests TikTok shows as still open: requested, or approved and awaiting shipment.',
  recentSamples: "The creator's latest sample applications on TikTok, with request, shipping and delivery dates.",
  targetCollabs:
    'Target collaborations that include this creator. Accepted means they added products to their showcase; posted means they made content for them.',
  creatorStats:
    "TikTok's figures for this creator across all shops, not just ours. For information only; refreshed with samples.",
  statFollowers: "Their TikTok follower count, from their latest sample application.",
  statGmv30d: 'Their sales over the last 30 days across all shops on TikTok, not just ours.',
  statFulfilment:
    "Their sample fulfilment rate over the past 90 days across all shops. Blank if they haven't allowed TikTok to share it.",
  statViews: "The median views on their videos, as reported by TikTok.",
  allTime: 'The drawer always shows all-time totals, whatever period is selected in the toolbar.',
}

/** Fields the sync fills and locks (read-only) once `synced_fields[key]` is true. */
export const LOCKED_WHEN_SYNCED = new Set([
  'gmv',
  'first_sale_date',
  'last_sale_at',
  'units_sold_total',
  'units_sold_current_product',
  'first_video_date',
  'first_video_link',
  'other_videos',
  'product_sent_date',
  'product_delivery_date',
  'tiktok_shop_eligible',
])

/** Synced, but still editable (a newer manual entry wins in the database). */
export const SYNCED_EDITABLE = new Set(['current_product', 'other_products_received'])

export const isSynced = (creator, key) => creator?.synced_fields?.[key] === true

/** True when the app must not write this field for this creator. */
export const isLockedFor = (creator, key) => LOCKED_WHEN_SYNCED.has(key) && isSynced(creator, key)

/** Columns on the creators row that only the sync / database write. */
export const SERVER_OWNED_COLUMNS = [
  'synced_fields',
  'tiktok_synced_at',
  'tiktok_request_cancelled_only',
  'tiktok_creator_id',
  'source',
]

/** Extra creators columns the app reads beyond FIELDS. */
export const TIKTOK_COLUMNS = [
  ...SERVER_OWNED_COLUMNS,
  'new_from_tiktok',
  'suggested_stage',
  'suggested_tier',
  'suggestion_reason',
  'suggestion_dismissed_value',
  'last_sale_at',
]

// ---------------------------------------------------------------------------
// Entries from TikTok
// ---------------------------------------------------------------------------

export const isTikTokEntry = (entry) => entry?.source === 'tiktok'

/** A video entry's product names: de-duplicated (two listings can share a name), order kept. */
export function videoProducts(video) {
  const names = Array.isArray(video?.products) && video.products.length ? video.products : [video?.product]
  return [...new Set(names.filter(Boolean))]
}

// ---------------------------------------------------------------------------
// Suggestions
// ---------------------------------------------------------------------------

/** suggestion_reason joins the stage and tier reasons with " · ". Returns each
    part, or the whole string for a suggestion when it can't be split. */
export function splitReason(creator) {
  const reason = creator.suggestion_reason || ''
  const both = creator.suggested_stage && creator.suggested_tier
  if (!both) return { stage: reason, tier: reason }
  const parts = reason.split(' · ')
  return parts.length === 2 ? { stage: parts[0], tier: parts[1] } : { stage: reason, tier: reason }
}

/** What's left of suggestion_reason once one suggestion is resolved. */
export function remainingReason(creator, resolved) {
  const other = resolved === 'stage' ? 'tier' : 'stage'
  if (!creator[`suggested_${other}`]) return null
  return splitReason(creator)[other] || null
}

// ---------------------------------------------------------------------------
// Review rule
// ---------------------------------------------------------------------------

/** "New from TikTok" clears when a creator gets an owner, in the same save. */
export function applyReviewRule(prev, next) {
  if (next.new_from_tiktok && next.owner_id && !prev?.owner_id) return { ...next, new_from_tiktok: false }
  return next
}

// ---------------------------------------------------------------------------
// Period selector
// ---------------------------------------------------------------------------

export const PERIOD_KINDS = [
  { kind: 'all', label: 'All time' },
  { kind: '7d', label: 'Last 7 days' },
  { kind: '30d', label: 'Last 30 days' },
  { kind: '90d', label: 'Last 90 days' },
  { kind: 'month', label: 'This month' },
  { kind: 'custom', label: 'Custom range' },
]

export const DEFAULT_PERIOD = { kind: 'all', from: '', to: '' }

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** A saved or in-state period, with anything unrecognised reset to All time. */
export function cleanPeriod(p) {
  if (!p || typeof p !== 'object' || !PERIOD_KINDS.some((k) => k.kind === p.kind)) return DEFAULT_PERIOD
  return {
    kind: p.kind,
    from: ISO_DATE.test(p.from) ? p.from : '',
    to: ISO_DATE.test(p.to) ? p.to : '',
  }
}

/** A custom range with neither date set is just All time. */
export const isPeriodActive = (p) =>
  p.kind !== 'all' && !(p.kind === 'custom' && !p.from && !p.to)

/** Local midnight of YYYY-MM-DD as an ISO instant. */
const localStart = (iso) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toISOString()
}

/** { from, to } for creator_tiktok_period. `to` is exclusive; null = open ended.
    "Last N days" is N calendar days including today. */
export function periodRange(p, now = new Date()) {
  if (p.kind === 'custom') {
    let to = null
    if (p.to) {
      const [y, m, d] = p.to.split('-').map(Number)
      to = new Date(y, m - 1, d + 1).toISOString() // the end date is inclusive
    }
    return { from: p.from ? localStart(p.from) : null, to }
  }
  if (p.kind === 'month') return { from: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(), to: null }
  const days = { '7d': 7, '30d': 30, '90d': 90 }[p.kind]
  return { from: new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1)).toISOString(), to: null }
}

/** Short lower-case wording for headers: "last 30 days", "1 Sep 2026 – 30 Sep 2026". */
export function periodLabel(p) {
  if (!isPeriodActive(p)) return ''
  if (p.kind === 'custom') {
    const fmt = (iso) =>
      new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    if (p.from && p.to) return `${fmt(p.from)} – ${fmt(p.to)}`
    return p.from ? `from ${fmt(p.from)}` : `to ${fmt(p.to)}`
  }
  return PERIOD_KINDS.find((k) => k.kind === p.kind).label.toLowerCase()
}

/** Stable key for effects: same range, same key. */
export const periodKey = (p) => (isPeriodActive(p) ? `${p.kind}|${p.from}|${p.to}` : 'all')

/** Fields whose columns follow the Period selector. */
export const PERIOD_FIELDS = ['gmv', 'units_sold_total']

// ---------------------------------------------------------------------------
// Toolbar filters
// ---------------------------------------------------------------------------

export const NO_FILTERS = {
  newFromTiktok: false,
  cancelledOnly: false,
  suggested: false,
  noSale: '', // '' | 14 | 30 | 60 | 90 | 'never'
  noContact: false,
}

export const NO_SALE_OPTIONS = [14, 30, 60, 90]

export const activeFilterCount = (f) =>
  [f.newFromTiktok, f.cancelledOnly, f.suggested, f.noSale !== '', f.noSale !== '' && f.noSale !== 'never' && f.noContact]
    .filter(Boolean).length

/** Predicate for the filters, evaluated against the clock at call time. */
export function buildFilterFn(f, now = Date.now()) {
  if (!activeFilterCount(f)) return null

  const days = typeof f.noSale === 'number' ? f.noSale : null
  const saleCutoff = days ? now - days * 86400000 : null
  const contactCutoff = days
    ? (() => {
        const d = new Date(todayISO() + 'T00:00:00')
        d.setDate(d.getDate() - days)
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      })()
    : null

  return (c) => {
    if (f.newFromTiktok && !c.new_from_tiktok) return false
    if (f.cancelledOnly && !c.tiktok_request_cancelled_only) return false
    if (f.suggested && !c.suggested_stage && !c.suggested_tier) return false
    if (f.noSale === 'never' && c.last_sale_at) return false
    if (days) {
      if (c.last_sale_at && Date.parse(c.last_sale_at) >= saleCutoff) return false
      if (f.noContact && c.last_contact && String(c.last_contact).slice(0, 10) >= contactCutoff) return false
    }
    return true
  }
}

// ---------------------------------------------------------------------------
// Sync status
// ---------------------------------------------------------------------------

export const SYNC_STREAMS = ['affiliate', 'samples', 'sample_orders', 'target_collabs', 'derive']

/** Summary of tiktok_sync_status() rows for the toolbar indicator. */
export function summariseSync(rows, now = Date.now()) {
  const byStream = Object.fromEntries((rows || []).map((r) => [r.stream, r]))
  const times = SYNC_STREAMS.map((s) => byStream[s]?.last_success_at)
    .filter(Boolean)
    .map((t) => Date.parse(t))
  const token = byStream.token
  const expired = token?.access_token_expires_at && Date.parse(token.access_token_expires_at) < now
  const tokenBad = Boolean(token) && token.last_status != null && token.last_status !== 'ok'
  const errored = (rows || []).filter((r) => r.last_error)
  return {
    lastSuccess: times.length ? Math.max(...times) : null,
    deriveAt: byStream.derive?.last_success_at || null,
    running: (rows || []).some((r) => r.last_status === 'running'),
    warning: errored.length > 0 || tokenBad || Boolean(expired),
    tokenProblem: tokenBad || Boolean(expired),
    expired: Boolean(expired),
  }
}

/** "5 minutes ago" style text from a timestamp (ms). */
export function relativeTime(ms, now = Date.now()) {
  if (ms == null) return 'never'
  const s = Math.max(0, Math.round((now - ms) / 1000))
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`
  const h = Math.round(m / 60)
  if (h < 48) return `${h} hour${h === 1 ? '' : 's'} ago`
  const d = Math.round(h / 24)
  return `${d} days ago`
}

// ---------------------------------------------------------------------------
// Sample statuses, in plain words
// ---------------------------------------------------------------------------

const SAMPLE_STATUS = {
  PENDING: 'Requested',
  AWAITING_SHIPMENT: 'Approved, awaiting shipment',
  SHIPPED: 'Shipped',
  CONTENT_PENDING: 'Delivered, awaiting content',
  COMPLETED: 'Completed',
  OVERDUE_CANCELLED: 'Cancelled (request expired)',
  WITHDRAW_CANCELLED: 'Cancelled (withdrawn by creator)',
  REJECT_CANCELLED: 'Cancelled (rejected)',
  SHIP_CANCELLED: 'Cancelled (shipping)',
  UNFULFILLABLE_CANCELLED: 'Cancelled (couldn’t be fulfilled)',
  UNFULFILL_CANCELLED: 'Cancelled (couldn’t be fulfilled)',
  OPS_CANCELLED: 'Cancelled (by TikTok)',
}

export function sampleStatus(status) {
  if (!status) return '—'
  if (SAMPLE_STATUS[status]) return SAMPLE_STATUS[status]
  const words = String(status).toLowerCase().replace(/_/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}
