/* Single source of truth for the creator record.
   Table columns, the detail panel, CSV import mapping and CSV export are all
   derived from FIELDS so there is exactly one place to add a field. */

/* Ordered journey — the UI numbers stages by their position here, and this
   must match the creator_stage enum in the database. */
export const STAGES = [
  'Joined',
  'Accepted (Target Collab Invite)',
  'First Product',
  'Product Sent',
  'First Video',
  'Video Posted',
  'First Sale',
  'First Sale Achieved',
  'Build Momentum',
  'Consistent Creator',
  'Tier Up',
  'Top Performer',
]

/** Compact stage name for pills and chart axes, where the full names are long. */
export function stageShort(stage) {
  return stage === 'Accepted (Target Collab Invite)' ? 'Accepted' : stage
}

export const TIERS = ['Bronze', 'Silver', 'Gold']

/* Fields flagged `manual` are typed in by hand today but are meant to sync
   from TikTok Shop once the Shop API is connected. */
const MANUAL_NOTE = 'Manual for now — will sync from TikTok Shop in future.'

export const FIELDS = [
  { key: 'name', label: 'Name', type: 'text', primary: true, sortable: true },
  { key: 'stage', label: 'Stage', type: 'enum', options: STAGES, primary: true, sortable: true },
  { key: 'next_action', label: 'Next Action', type: 'text', primary: true, sortable: true },
  {
    key: 'current_product',
    label: 'Current Product',
    type: 'text',
    hint: MANUAL_NOTE,
    aliases: ['Current Sample'],
    primary: true,
    sortable: true,
  },
  {
    key: 'next_follow_up_date',
    label: 'Next Follow-up',
    type: 'date',
    primary: true,
    sortable: true,
  },
  { key: 'owner', label: 'Owner', type: 'text', primary: true, sortable: true },
  { key: 'gmv', label: 'GMV', type: 'num', primary: true, sortable: true },
  {
    key: 'creator_tier',
    label: 'Creator Tier',
    type: 'enum',
    options: TIERS,
    allowFreeText: true,
    primary: true,
    sortable: true,
  },
  { key: 'last_contact', label: 'Last Contact', type: 'date', primary: true, sortable: true },

  // Secondary — shown via the "all fields" toggle and always in the detail panel.
  { key: 'tiktok_handle', label: 'TikTok Handle', type: 'text', sortable: true },
  { key: 'instagram_handle', label: 'Instagram Handle', type: 'text', sortable: true },
  { key: 'email', label: 'Email', type: 'text', sortable: true },
  { key: 'tiktok_shop_eligible', label: 'TikTok Shop Eligible', type: 'bool', sortable: true },
  {
    key: 'shipping_address',
    label: 'Shipping Address',
    type: 'text',
    multiline: true,
    hint: 'Only needed for creators who are not TikTok Shop Affiliates.',
    aliases: ['Address'],
    sortable: false,
  },
  {
    key: 'other_products_received',
    label: 'Other Products Received',
    type: 'products',
    hint: MANUAL_NOTE,
    aliases: ['Other Products', 'Previous Products'],
    sortable: false,
  },
  { key: 'product_sent_date', label: 'Product Sent', type: 'date', sortable: true },
  { key: 'product_delivery_date', label: 'Product Delivered', type: 'date', sortable: true },
  { key: 'first_video_date', label: 'First Video Date', type: 'date', sortable: true },
  { key: 'first_video_link', label: 'First Video Link', type: 'url', sortable: false },
  { key: 'first_sale_date', label: 'First Sale Date', type: 'date', sortable: true },
  // A bare "Units Sold" import header is deliberately not aliased to either of
  // these — it's ambiguous, so the user maps it by hand.
  {
    key: 'units_sold_current_product',
    label: 'Units Sold (Current Product)',
    type: 'int',
    sortable: true,
  },
  {
    key: 'units_sold_total',
    label: 'Units Sold (Total)',
    type: 'int',
    aliases: ['Total Units Sold', 'Lifetime Units Sold'],
    sortable: true,
  },
]

export const PRIMARY_FIELDS = FIELDS.filter((f) => f.primary)

export const FIELD_BY_KEY = Object.fromEntries(FIELDS.map((f) => [f.key, f]))

/** Columns selected from Supabase — FIELDS plus the record/status metadata. */
export const SELECT_COLUMNS = [
  'id',
  ...FIELDS.map((f) => f.key),
  'notes',
  'status',
  'removed_by',
  'removed_at',
  'created_at',
  'updated_at',
].join(', ')

/** A blank creator, used by "New creator". */
export function emptyCreator() {
  const row = {}
  for (const f of FIELDS) {
    row[f.key] = f.type === 'bool' ? false : f.type === 'products' ? [] : null
  }
  row.stage = STAGES[0]
  row.notes = []
  row.status = 'active'
  return row
}

/** Coerce a raw string (CSV cell or input value) into the field's storage type. */
export function coerce(field, raw) {
  const v = typeof raw === 'string' ? raw.trim() : raw

  if (field.type === 'products') {
    if (Array.isArray(v)) return v
    return parseProducts(v == null ? '' : String(v))
  }

  if (field.type === 'bool') {
    if (typeof v === 'boolean') return v
    if (v === '' || v == null) return false
    return ['y', 'yes', 'true', '1', 't'].includes(String(v).toLowerCase())
  }

  if (field.type === 'int' || field.type === 'num') {
    if (v === '' || v == null) return null
    const n = Number(String(v).replace(/[£$,\s]/g, ''))
    if (Number.isNaN(n)) return null
    return field.type === 'int' ? Math.round(n) : n
  }

  if (field.type === 'date') {
    if (!v) return null
    return normaliseDate(String(v))
  }

  return v === '' || v == null ? null : String(v)
}

/* Product lists travel through CSV/Excel as one cell:
     "Product A (2026-08-01); Product B (2026-08-15); Product C"
   Entries are split on ";" and the date is a trailing "(...)". A trailing
   bracket that isn't a date stays part of the name, e.g. "Lip Kit (Pink)". */

export function formatProducts(list) {
  return (list || [])
    .filter((p) => p && p.product)
    .map((p) => (p.date_received ? `${p.product} (${p.date_received})` : p.product))
    .join('; ')
}

export function parseProducts(text) {
  return String(text || '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const m = entry.match(/^(.*?)\s*\(([^()]*)\)$/)
      // Require a 4-digit year so "Pack (2)" isn't read as a date by new Date().
      const date = m && m[1] && /\d{4}/.test(m[2]) ? normaliseDate(m[2]) : null
      return date
        ? { product: m[1], date_received: date }
        : { product: entry, date_received: null }
    })
}

/** Accepts YYYY-MM-DD and DD/MM/YYYY; returns an ISO date string or null. */
export function normaliseDate(input) {
  const s = input.trim()
  if (!s) return null

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s

  const slash = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (slash) {
    const [, d, m, y] = slash
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }

  const parsed = new Date(s)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString().slice(0, 10)
}
