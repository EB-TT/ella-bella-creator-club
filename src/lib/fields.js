/* Single source of truth for the creator record.
   Table columns, the detail panel, CSV import mapping and CSV export are all
   derived from FIELDS so there is exactly one place to add a field. */

export const STAGES = [
  'Accepted (Target Collab Invitation)',
  'Received Product',
  'First Video',
  'First Sale',
  'Build Momentum',
  'Consistent Creator',
  'Tier Up',
]

export const TIERS = ['Bronze', 'Silver', 'Gold']

export const FIELDS = [
  { key: 'name', label: 'Name', type: 'text', primary: true, sortable: true },
  { key: 'stage', label: 'Stage', type: 'enum', options: STAGES, primary: true, sortable: true },
  { key: 'next_action', label: 'Next Action', type: 'text', primary: true, sortable: true },
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
  { key: 'product_sent_date', label: 'Product Sent', type: 'date', sortable: true },
  { key: 'product_delivery_date', label: 'Product Delivered', type: 'date', sortable: true },
  { key: 'first_video_date', label: 'First Video Date', type: 'date', sortable: true },
  { key: 'first_video_link', label: 'First Video Link', type: 'url', sortable: false },
  { key: 'first_sale_date', label: 'First Sale Date', type: 'date', sortable: true },
  { key: 'units_sold', label: 'Units Sold', type: 'int', sortable: true },
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
    row[f.key] = f.type === 'bool' ? false : null
  }
  row.stage = STAGES[0]
  row.notes = []
  row.status = 'active'
  return row
}

/** Coerce a raw string (CSV cell or input value) into the field's storage type. */
export function coerce(field, raw) {
  const v = typeof raw === 'string' ? raw.trim() : raw

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
