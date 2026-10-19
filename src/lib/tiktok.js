/* Everything the app needs to know about the TikTok sync that isn't a field
   definition: tooltip text, which fields lock when synced, the period selector
   and the new-filters logic. Tooltip copy lives in TIKTOK_HINTS only. */

import { formatDateTime, isOverdue, todayISO } from './format'
import { TIERS } from './journey'

/** Tooltip text. Keyed by field key, or by the item it describes. Every
    creators-side tooltip and hint lives here. */
export const TIKTOK_HINTS = {
  // Fields: table headers and drawer labels use the same text
  name: 'Display name. Edit freely.',
  tiktok_handle: 'Links them to TikTok data. Changing it re-links.',
  instagram_handle: 'Entered by the team.',
  email: 'Entered by the team.',
  stage: 'Journey stage. TikTok can suggest a later one.',
  journey: 'Stage, or tier once earned. Hover the funnel for details.',
  journeyClearsTier: 'This removes their tier.',
  next_action: 'What the owner plans next.',
  next_follow_up_date: 'When to follow up. Red when overdue.',
  owner_id: 'Team member responsible.',
  creator_tier: 'Bronze to Platinum. Set by the team.',
  last_contact: 'Last time the team got in touch.',
  gmv: 'TikTok sales, net of returns, before tax. Unsettled sales are estimates.',
  units_sold_total: 'Units sold on TikTok, excluding cancelled and returned sales.',
  units_sold_current_product: 'Units of the current product, all time. TikTok samples only.',
  first_sale_date: "First TikTok sale that wasn't cancelled or returned.",
  last_sale_at: "Latest TikTok sale that wasn't cancelled or returned.",
  first_video_date: 'When their first selling video was posted.',
  first_video_link: 'Their first video that drove a sale.',
  other_videos: 'First selling video for each other product, newest first.',
  current_product: 'Latest approved TikTok sample, unless the team entered something newer.',
  other_products_received: 'Earlier products sent. TikTok entries are added automatically.',
  product_sent_date: 'From TikTok shipping for the current sample. Blank until shipped.',
  product_delivery_date: 'From TikTok shipping for the current sample. Blank until shipped.',
  tiktok_shop_eligible: 'Set automatically once TikTok shows any activity.',
  shippingAddress: "Only needed for creators who aren't TikTok Shop affiliates.",
  allTime: 'The drawer always shows all-time totals, whatever date range is selected.',

  // Markers and inline notes. {time} is filled in by the component.
  syncedLocked: "From TikTok – can't be edited.",
  syncedEditable: 'From TikTok.',
  syncedAt: 'Synced {time}.',
  filledFromTiktok: 'Filled automatically from TikTok.',
  currentProductEditHint: 'Editing overrides TikTok until a newer sample arrives.',
  tiktokEntry: "From a TikTok sample. Can't be changed.",
  removeEntry: 'Remove entry',
  updatedInBackgroundNote: 'Changed while you were editing. Your edits are kept.',

  // Drawer bars and buttons
  newFromTiktokBar: 'Auto-created from TikTok. Clears when an owner is assigned.',
  markReviewed: 'Clear the New from TikTok flag.',
  suggestedStageBar: 'TikTok shows a later stage.',
  suggestedTierBar: "GMV meets this tier's band.",
  suggestedJourneyBar: 'TikTok data points to a later step.',
  suggestedPill: 'Suggested from TikTok data. Not applied yet.',
  quickAccept: 'Accept this suggestion.',
  accept: 'Apply it.',
  dismiss: "Hide it. It won't come back.",
  removeCreator: 'Remove creator',
  closeDrawer: 'Close',

  // Drawer TikTok section
  tiktokSection: 'From TikTok Shop, as of the last sync.',
  pendingSamples: 'Waiting for approval or shipping.',
  recentSamples: 'Latest samples with status and dates.',
  targetCollabs: 'Collabs they accepted or posted for.',
  creatorStats: 'TikTok figures across all shops.',
  statFollowers: 'TikTok followers.',
  statGmv30d: 'Sales across all shops, last 30 days. — if not shared.',
  statFulfilment: 'Sample fulfilment rate, last 90 days. — if not shared.',
  statViews: 'Shoppable videos, last 30 days. — if not shared.',
  statsAsOf: 'When TikTok last sent these.',

  // Toolbar, filters and page
  myCreators: 'Only creators you own.',
  myCreatorsDisabled: 'No team profile for your account yet',
  filtersButton: 'More ways to narrow the list.',
  newFromTiktok: 'Auto-created from TikTok. Clears when an owner is assigned.',
  requestCancelledOnly: 'Only activity was a cancelled sample request.',
  suggested: 'Creators with a stage or tier suggestion.',
  noSale: 'No TikTok sale in {days} days, or never.',
  neverSold: 'No TikTok sale ever.',
  noContact: 'Also no contact in that time.',
  noContactDisabled: 'Pick a No sale period first.',
  clearFilters: 'Remove all filters.',
  stageFilter: 'Click × to show all stages.',
  journeyFilter: 'Click × to show every step.',
  overdue: 'Follow-up date has passed.',
  keyFields: 'Main columns or every column.',
  import: 'Add creators from CSV or Excel.',
  export: "Download what's shown.",
  exportDisabled: 'Nothing to export.',
  newCreator: 'Add a creator by hand.',
  countActive: 'Matching creators out of all active.',
  countRemoved: 'Matching creators out of all removed.',
  funnel: 'Click a bar to filter by stage.',
  funnelJourney: "Each creator's place in the journey. Hover a bar for details.",
  funnelSuggestedNote: 'Suggested creators are also counted at their current step.',
  pagination: '100 per page.',
  tabActive: 'Creators in the programme.',
  tabRemoved: 'Removed creators. Restore from here.',
  restore: 'Move back to Active.',
  themeLight: 'Switch to light',
  themeDark: 'Switch to dark',
  signOut: 'Sign out',

  // Header: date range, sync, refresh
  dateRange: 'Applies to GMV and Units Sold (Total) only.',
  syncOk: 'Updates hourly. Last synced {time}.',
  syncStale: 'No sync for 3+ hours.',
  syncRetrying: '{stream} will retry at {time}.',
  syncError: '{stream} failed. Will retry on the next run.',
  syncConnectionUntil: 'TikTok connection valid until {date}',
  syncToken: 'TikTok connection needs attention.',
  refresh: 'Reload data.',

  // Settings (admins)
  settingsButton: 'Settings: tiers, journey rules, automation, products.',
  settingsBack: 'Back to the creators list.',
  settingsBasis: 'Which GMV decides a creator’s tier.',
  settingsMinGmv: 'Lowest GMV that earns this tier.',
  settingsPreview: 'Creators per tier at these values. Not saved yet.',
  settingsBmContent: 'Videos or lives that sold, for Build Momentum.',
  settingsCcContent: 'Videos or lives that sold, for Consistent Creator.',
  settingsCcMonths: 'Or sales in each of this many recent months.',
  settingsAutoStage: 'Moves stages forward without anyone approving.',
  settingsAutoTier: 'Sets tiers without anyone approving them.',
  settingsAutoWarn: 'Changes creators without review.',
  settingsSave: 'Saves, then updates every creator.',
  settingsReadOnly: 'Only admins can change these.',
  settingsProducts: 'Automatic names come from the TikTok listing title.',
  settingsProductName: 'Your name for this product. Empty uses the automatic one.',
  settingsProductSave: 'Saves, then updates creators.',
  bulkTier: 'Applies every suggested tier. Admins only.',
  bulkStage: 'Applies every suggested stage. Admins only.',

  // Funnel bars. {n} and {m} come from the journey rules in Settings.
  journeySteps: {
    Joined: { means: 'In the club, nothing started yet.', when: 'Set by the team.' },
    'Accepted (Target Collab Invite)': {
      means: 'Accepted a target collab invite.',
      when: 'They accept a target collab invite.',
    },
    'First Product': { means: 'A sample is on its way to them.', when: 'A sample is requested or approved.' },
    'Product Sent': { means: 'Their sample has shipped.', when: 'The sample ships.' },
    'First Video': { means: 'Sample delivered, content now due.', when: 'The sample is delivered.' },
    'Video Posted': {
      means: 'They have posted content.',
      when: 'Sample completed, a video sale, or collab content posted.',
    },
    'First Sale': { means: 'About to make a first sale.', when: 'Set by the team.' },
    'First Sale Achieved': { means: 'They have made a sale.', when: 'TikTok shows any sale.' },
    'Build Momentum': { means: 'Selling through several videos or lives.', when: '{n}+ videos or lives have sold.' },
    'Consistent Creator': {
      means: 'Selling steadily over time.',
      when: '{n}+ videos or lives sold, or sales in each of the last {m} months.',
    },
  },
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
  'suggestion_dismissed_stage',
  'suggestion_dismissed_tier',
  'last_sale_at',
]

// ---------------------------------------------------------------------------
// Entries from TikTok
// ---------------------------------------------------------------------------

export const isTikTokEntry = (entry) => entry?.source === 'tiktok'

/** A video entry's product names: de-duplicated (two listings can share a name), order kept.
    `products` is a list of { product_id, product } (older rows: plain strings); the
    joined `product` string is the fallback. */
export function videoProducts(video) {
  const list = Array.isArray(video?.products) && video.products.length ? video.products : [video?.product]
  const names = list.map((p) => (p && typeof p === 'object' ? p.product : p))
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

/* Merged Journey suggestion: the higher of the suggested tier and the suggested
   stage, which is the tier when there is one. A stage suggestion on a creator who
   already has a tier sits below their place in the journey, so it isn't shown
   (the bulk "accept all stage suggestions" still applies it). */
export function journeySuggestion(creator) {
  const reasons = splitReason(creator)
  if (creator.suggested_tier) return { kind: 'tier', value: creator.suggested_tier, reason: reasons.tier }
  if (creator.suggested_stage && !creator.creator_tier) {
    return { kind: 'stage', value: creator.suggested_stage, reason: reasons.stage }
  }
  return null
}

/** The columns to change to accept the journey suggestion. A tier also takes any
    pending stage suggestion, since that is lower. */
export function journeyAcceptPatch(creator) {
  const patch = { suggested_stage: null, suggested_tier: null, suggestion_reason: null }
  if (creator.suggested_tier) patch.creator_tier = creator.suggested_tier
  if (creator.suggested_stage) patch.stage = creator.suggested_stage
  return patch
}

/** The columns to change to dismiss it: both suggestions, each remembered on its own column. */
export function journeyDismissPatch(creator) {
  const patch = { suggested_stage: null, suggested_tier: null, suggestion_reason: null }
  if (creator.suggested_tier) patch.suggestion_dismissed_tier = creator.suggested_tier
  if (creator.suggested_stage) patch.suggestion_dismissed_stage = creator.suggested_stage
  return patch
}

// ---------------------------------------------------------------------------
// Settings (tier bands, journey rules)
// ---------------------------------------------------------------------------

export const TIER_BASES = [
  { value: 'all_time', label: 'All time', gmv: 'All-time GMV' },
  { value: 'last_30_days', label: 'Last 30 days', gmv: 'Last 30 days GMV' },
  { value: 'last_90_days', label: 'Last 90 days', gmv: 'Last 90 days GMV' },
]

export const DEFAULT_STAGE_RULES = {
  build_momentum: { min_content: 2 },
  consistent_creator: { min_content: 5, months: 3 },
}

const money = (n) => `$${Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`

/** [{ tier, min_gmv }] in tier order from the saved bands, or [] when none are set. */
export function bandList(settings) {
  const bands = settings?.tier_bands?.bands
  if (!Array.isArray(bands)) return []
  return TIERS.map((tier) => bands.find((b) => b?.tier === tier))
    .filter((b) => b && Number.isFinite(Number(b.min_gmv)))
    .map((b) => ({ tier: b.tier, min_gmv: Number(b.min_gmv) }))
}

/** "All-time GMV $2,500–9,999" for a tier's band; the top tier is "$25,000+". Empty without bands. */
export function tierBandText(settings, tier) {
  const bands = bandList(settings)
  const i = bands.findIndex((b) => b.tier === tier)
  if (i === -1) return ''
  const basis = TIER_BASES.find((b) => b.value === settings?.tier_bands?.basis) || TIER_BASES[0]
  const next = bands[i + 1]
  const range = next ? `${money(bands[i].min_gmv)}–${Number(next.min_gmv - 1).toLocaleString('en-US')}` : `${money(bands[i].min_gmv)}+`
  return `${basis.gmv} ${range}`
}

/** Funnel hover text for a stage step, with the thresholds filled in from the rules. */
export function stepText(stage, settings) {
  const t = TIKTOK_HINTS.journeySteps[stage]
  if (!t) return null
  const rules = { ...DEFAULT_STAGE_RULES, ...(settings?.stage_rules || {}) }
  const fill = (text) =>
    text
      .replace('{n}', stage === 'Consistent Creator' ? rules.consistent_creator?.min_content : rules.build_momentum?.min_content)
      .replace('{m}', rules.consistent_creator?.months)
  return { means: fill(t.means), when: fill(t.when) }
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
  stage: null, // a funnel stage name, set by clicking a bar or from the menu
  journey: null, // a journey step (stage or tier), set by clicking a funnel bar
  overdue: false,
}

export const NO_SALE_OPTIONS = [14, 30, 60, 90]

/** "No TikTok sale in 30 days, or never." – X until a day count is chosen. */
export const noSaleHint = (days) => TIKTOK_HINTS.noSale.replace('{days}', typeof days === 'number' ? days : 'X')

export const activeFilterCount = (f) =>
  [f.newFromTiktok, f.cancelledOnly, f.suggested, f.noSale !== '', f.noSale !== '' && f.noSale !== 'never' && f.noContact, f.stage, f.journey, f.overdue]
    .filter(Boolean).length

/** Predicate for the filters, evaluated against the clock at call time. */
export function buildFilterFn(f, now = Date.now(), { merged = false } = {}) {
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
    if (f.overdue && !isOverdue(c)) return false
    if (f.suggested && !(merged ? journeySuggestion(c) : c.suggested_stage || c.suggested_tier)) return false
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

/** Streams as people see them. */
export const STREAM_LABELS = {
  affiliate: 'Sales',
  samples: 'Samples',
  sample_orders: 'Sample shipping',
  target_collabs: 'Collaborations',
  derive: 'Creator updates',
  token: 'TikTok connection',
}

export const streamLabel = (stream) => STREAM_LABELS[stream] || String(stream).replace(/_/g, ' ')

/** Streams that fetch data from TikTok (derive only works on what they stored). */
const DATA_STREAMS = ['affiliate', 'samples', 'sample_orders', 'target_collabs']

/** The latest successful data sync is older than this: "Sync delayed". */
export const STALE_AFTER_MS = 3 * 3600 * 1000

/** Time of day for today, date and time for any other day. */
function retryTime(iso, now) {
  const d = new Date(iso)
  return d.toDateString() === new Date(now).toDateString()
    ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    : formatDateTime(iso)
}

/** "<Stream> will retry at <time>" for a row with a future next_retry_at. */
export function retryMessage(row, now = Date.now()) {
  return TIKTOK_HINTS.syncRetrying
    .replace('{stream}', streamLabel(row.stream))
    .replace('{time}', retryTime(row.next_retry_at, now))
}

/** "<Stream> failed. Will retry on the next run." (no scheduled retry yet) */
export const errorMessage = (row) => TIKTOK_HINTS.syncError.replace('{stream}', streamLabel(row.stream))

/** A stream's last error as one short line for the tooltip. */
export function shortError(message, max = 100) {
  const line = String(message || '').split('\n')[0].replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

/** Summary of tiktok_sync_status() rows for the toolbar indicator. */
export function summariseSync(rows, now = Date.now()) {
  const byStream = Object.fromEntries((rows || []).map((r) => [r.stream, r]))
  const times = SYNC_STREAMS.map((s) => byStream[s]?.last_success_at)
    .filter(Boolean)
    .map((t) => Date.parse(t))
  const dataTimes = DATA_STREAMS.map((s) => byStream[s]?.last_success_at)
    .filter(Boolean)
    .map((t) => Date.parse(t))
  const token = byStream.token
  const expired = token?.access_token_expires_at && Date.parse(token.access_token_expires_at) < now
  const tokenBad = Boolean(token) && token.last_status != null && token.last_status !== 'ok'
  const errored = (rows || []).filter((r) => r.last_error)
  // Never synced is "not synced yet", not stale.
  const stale = dataTimes.length > 0 && now - Math.max(...dataTimes) > STALE_AFTER_MS
  const retrying = (rows || []).filter((r) => r.next_retry_at && Date.parse(r.next_retry_at) > now)
  return {
    lastSuccess: times.length ? Math.max(...times) : null,
    deriveAt: byStream.derive?.last_success_at || null,
    running: (rows || []).some((r) => r.last_status === 'running'),
    warning: errored.length > 0 || tokenBad || Boolean(expired) || stale || retrying.length > 0,
    tokenProblem: tokenBad || Boolean(expired),
    expired: Boolean(expired),
    stale,
    retrying,
    errored,
  }
}

/** "5 minutes ago" style text from a timestamp (ms). */
export function relativeTime(ms, now = Date.now()) {
  if (ms == null) return 'never'
  const s = Math.max(0, Math.round((now - ms) / 1000))
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
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
