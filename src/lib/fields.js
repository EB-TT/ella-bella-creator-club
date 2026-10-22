/* Single source of truth for the creator record.
   Table columns, the detail panel, CSV import mapping and CSV export are all
   derived from FIELDS so there is exactly one place to add a field. */

import { DEFAULT_STAGE, RETIRED_STAGES, STAGES, TIERS } from './journey'

/* The stage list, stageShort and the tier list live in journey.js (so tiktok.js
   can use them without a cycle). Re-exported here for the existing imports. */
export { STAGES, stageShort, TIERS } from './journey'

/* ONE SWITCH for the merged Journey field. true: the table, drawer and New
   creator form show a single Journey field (the accepted tier if there is one,
   otherwise the stage) and the separate Stage and Creator Tier columns and
   dropdowns are hidden. false: the app goes back to separate Stage and Creator
   Tier fields, with separate suggestion bars and the 12-stage funnel, as before
   phase 7. Nothing is removed either way: `stage` and `creator_tier` stay as
   separate columns, FIELDS still defines both, and import, export and the save
   logic always use them. */
export const JOURNEY_MERGED = true

import { TIKTOK_COLUMNS, TIKTOK_HINTS, videoProducts } from './tiktok'

/* Fields owned by the TikTok sync carry `readOnly` (shown but never edited or
   written back by the app) and `importable: false` (not offered in the import
   column mapping). They are still exported. Which other fields lock per creator
   (once TikTok has data) is in lib/tiktok.js, and tooltip text is TIKTOK_HINTS. */

export const FIELDS = [
  { key: 'name', label: 'Name', type: 'text', primary: true, sortable: true, aliases: ['Creator', 'Creator Name'] },
  {
    key: 'stage',
    label: 'Stage',
    type: 'enum',
    options: STAGES,
    hiddenOptions: RETIRED_STAGES, // listed only while the creator is on one
    primary: true,
    sortable: true,
  },
  { key: 'next_action', label: 'Next Action', type: 'text', primary: true, sortable: true },
  {
    key: 'current_product',
    label: 'Current Product',
    type: 'text',
    aliases: ['Current Sample', 'Current Product/s'],
    primary: true,
    sortable: true,
  },
  {
    key: 'next_follow_up_date',
    label: 'Next Follow-up',
    type: 'date',
    aliases: ['Follow-up Date', 'Follow Up Date'],
    primary: true,
    sortable: true,
  },
  // Stored as a profiles.id; shown, sorted, imported and exported by name.
  { key: 'owner_id', label: 'Owner', type: 'owner', aliases: ['Assigned To'], primary: true, sortable: true },
  { key: 'gmv', label: 'GMV', type: 'num', primary: true, sortable: true },
  {
    key: 'creator_tier',
    label: 'Creator Tier',
    type: 'enum',
    options: TIERS,
    matchOption: true,
    primary: true,
    sortable: true,
  },
  { key: 'last_contact', label: 'Last Contact', type: 'date', primary: true, sortable: true },

  // Secondary — shown via the "all fields" toggle and always in the detail panel.
  {
    key: 'tiktok_handle',
    label: 'TikTok Handle',
    type: 'text',
    aliases: ['TikTok', 'TT Handle', 'TikTok Username'],
    sortable: true,
  },
  {
    key: 'instagram_handle',
    label: 'Instagram Handle',
    type: 'text',
    aliases: ['Insta Handle', 'Instagram', 'IG Handle'],
    sortable: true,
  },
  { key: 'email', label: 'Email', type: 'text', aliases: ['Email Add', 'Email Address'], sortable: true },
  { key: 'mobile', label: 'Mobile', type: 'text', aliases: ['WhatsApp', 'Phone', 'Phone Number'], sortable: true },
  { key: 'discord_handle', label: 'Discord', type: 'text', aliases: ['Discord Handle'], sortable: true },
  // Blank is English. Import drops anything that isn't one of the two.
  {
    key: 'language',
    label: 'Language',
    type: 'enum',
    options: ['English', 'Spanish'],
    blankLabel: 'English',
    aliases: ['Lang.', 'Lang'],
    matchOption: true,
    sortable: true,
  },
  { key: 'cc_join_date', label: 'CC Join Date', type: 'date', aliases: ['Join Date'], sortable: true },
  {
    key: 'tiktok_shop_eligible',
    label: 'TikTok Shop Eligible',
    type: 'bool',
    checkLabel: 'Eligible',
    sortable: true,
  },
  {
    key: 'shipping_address',
    label: 'Shipping Address',
    type: 'text',
    multiline: true,
    hint: TIKTOK_HINTS.shippingAddress,
    aliases: ['Address', 'Shipping Address Not TT Shop Enabled'],
    sortable: false,
  },
  {
    key: 'other_products_received',
    label: 'Other Products Received',
    type: 'products',
    aliases: ['Other Products', 'Previous Products'],
    sortable: false,
  },
  {
    key: 'other_videos',
    label: 'Other Videos',
    type: 'videos',
    readOnly: true,
    importable: false,
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
  {
    key: 'last_sale_at',
    label: 'Last Sale',
    type: 'date',
    readOnly: true,
    importable: false,
    sortable: true,
  },
  // Ella Bella video views since 2 May 2026, all time (the date range doesn't touch it).
  // The tier measure; LIVE views are shown in the drawer only.
  {
    key: 'video_views',
    label: 'Ella Bella video views',
    type: 'int',
    thousands: true,
    readOnly: true,
    importable: false,
    sortable: true,
  },
  // From the engagement log (likes and comments the team ticks in the drawer), not TikTok.
  {
    key: 'last_engaged_at',
    label: 'Last Engaged',
    type: 'date',
    readOnly: true,
    notTikTok: true,
    importable: false,
    sortable: true,
  },
]

export const PRIMARY_FIELDS = FIELDS.filter((f) => f.primary)

export const FIELD_BY_KEY = Object.fromEntries(FIELDS.map((f) => [f.key, f]))

/* The Journey field is a view over `stage` and `creator_tier`, not a column, so
   it is not in FIELDS (select, save, import and export never see it). The table
   and drawer use TABLE_FIELDS: FIELDS with Stage swapped for Journey and Creator
   Tier dropped when JOURNEY_MERGED. */
export const JOURNEY_FIELD = {
  key: 'journey',
  label: 'Journey',
  type: 'journey',
  primary: true,
  sortable: true,
}

export const TABLE_FIELDS = JOURNEY_MERGED
  ? FIELDS.flatMap((f) => (f.key === 'stage' ? [JOURNEY_FIELD] : f.key === 'creator_tier' ? [] : [f]))
  : FIELDS

export const PRIMARY_TABLE_FIELDS = TABLE_FIELDS.filter((f) => f.primary)

export const TABLE_FIELD_BY_KEY = Object.fromEntries(TABLE_FIELDS.map((f) => [f.key, f]))

/** A saved sort on a column this mode doesn't show maps to the one that replaced it. */
export function sortKeyForMode(key) {
  if (JOURNEY_MERGED) return key === 'stage' || key === 'creator_tier' ? 'journey' : key
  return key === 'journey' ? 'stage' : key
}

/** A saved column on a key this mode doesn't show maps to the one that replaced it. */
export function columnKeyForMode(key) {
  if (JOURNEY_MERGED) return key === 'stage' || key === 'creator_tier' ? 'journey' : key
  return key === 'journey' ? 'stage' : key
}

/* Table columns other than Name, which is always first, sticky and not movable. */
export const OPTIONAL_TABLE_FIELDS = TABLE_FIELDS.filter((f) => f.key !== 'name')

/** The key fields: what the table shows until someone picks their own columns. */
export const DEFAULT_COLUMN_KEYS = OPTIONAL_TABLE_FIELDS.filter((f) => f.primary).map((f) => f.key)

/** A saved column list, cleaned: keys this mode doesn't know are dropped, old
    Stage / Creator Tier keys follow the Journey switch, no repeats, never Name. */
export function cleanColumnKeys(keys) {
  if (!Array.isArray(keys)) return null
  const out = []
  for (const raw of keys) {
    const key = columnKeyForMode(raw)
    if (key !== 'name' && TABLE_FIELD_BY_KEY[key] && !out.includes(key)) out.push(key)
  }
  return out
}

/** Name first, then the chosen columns in order (null = the key fields). */
export function columnFields(keys) {
  return [TABLE_FIELD_BY_KEY.name, ...(keys ?? DEFAULT_COLUMN_KEYS).map((k) => TABLE_FIELD_BY_KEY[k])]
}

/** Columns selected from Supabase — FIELDS plus the record/status metadata. */
export const SELECT_COLUMNS = [
  ...new Set([
    'id',
    ...FIELDS.map((f) => f.key),
    ...TIKTOK_COLUMNS,
  ]),
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
    row[f.key] = f.type === 'bool' ? false : f.type === 'products' || f.type === 'videos' ? [] : null
  }
  row.stage = DEFAULT_STAGE
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

  if (field.type === 'owner') return v || null

  // Fixed lists that accept any casing/spacing and drop anything else.
  if (field.matchOption) return matchOption(field, v)

  return v === '' || v == null ? null : String(v)
}

/** The canonical option matching `raw` ignoring case and whitespace, or null. */
export function matchOption(field, raw) {
  const key = String(raw ?? '').replace(/\s/g, '').toLowerCase()
  if (!key) return null
  return field.options.find((o) => o.replace(/\s/g, '').toLowerCase() === key) ?? null
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

/* Other Videos export as one cell, most recent first, one entry per video:
     "2026-08-01 · Product A, Product B https://…; 2026-07-15 · Product C https://…" */

/** Other Videos entries, most recent first; undated entries last. */
export function sortVideos(list) {
  return [...(list || [])]
    .filter((v) => v && (v.product || v.url || v.products?.length))
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
}

export function formatVideos(list) {
  return sortVideos(list)
    .map((v) =>
      [
        [v.date ? String(v.date).slice(0, 10) : '', videoProducts(v).join(', ')].filter(Boolean).join(' · '),
        v.url,
      ]
        .filter(Boolean)
        .join(' '),
    )
    .join('; ')
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/** Accepts YYYY-MM-DD, DD/MM/YYYY and D-Mon-YYYY; returns an ISO date string or null. */
export function normaliseDate(input) {
  const s = input.trim()
  if (!s) return null

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s

  const slash = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (slash) {
    const [, d, m, y] = slash
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }

  // D-Mon-YYYY, e.g. 4-Sep-2026 (also "4 Sep 2026" and a two-digit year). Built by
  // hand: new Date() would read it as local midnight and shift the day on conversion.
  const named = s.match(/^(\d{1,2})[\s/.-]+([A-Za-z]{3,9})\.?[\s/.,-]+(\d{2}|\d{4})$/)
  if (named) {
    const month = MONTHS.indexOf(named[2].slice(0, 3).toLowerCase())
    const day = Number(named[1])
    const year = named[3].length === 2 ? 2000 + Number(named[3]) : Number(named[3])
    if (month === -1) return null
    const check = new Date(Date.UTC(year, month, day))
    if (check.getUTCMonth() !== month || check.getUTCDate() !== day) return null // 31-Feb
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }

  const parsed = new Date(s)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString().slice(0, 10)
}
