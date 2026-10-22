/* Turning the team's sheet into rows for public.import_creators (migration 015).

   The app parses and reads the sheet (parseImportFile in csv.js); this file
   decides which of its columns mean what, tidies each row into the shape the
   function expects, and builds the template and the report downloads. The
   database does the matching and every write, and applies the real rules
   (fill empty only, TikTok wins, stage forward only). */

import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import { download, normaliseHeader } from './csv'
import { FIELD_BY_KEY, FIELDS, normaliseDate, parseProducts } from './fields'
import { STAGES } from './journey'
import { LOCKED_WHEN_SYNCED } from './tiktok'

// ---------------------------------------------------------------------------
// What the columns can be mapped to
// ---------------------------------------------------------------------------

/** A target backed by a field definition: its names are the key, label and alternative names. */
const fieldTarget = (key, label) => {
  const f = FIELD_BY_KEY[key]
  return { key, label: label || f.label, names: [key, f.label, ...(f.aliases || [])] }
}

/* Columns that aren't a single field: the journey step, Status, TT Shop Enabled?
   and the two video-link columns (the sheet has one for creators with TikTok Shop
   and one without), plus Notes. */
const special = (key, label, names) => ({ key, label, names: [key, label, ...names] })

/** Every column the import understands, in the order the mapping step lists them. */
export const IMPORT_TARGETS = [
  { ...fieldTarget('tiktok_handle'), required: true },
  fieldTarget('name'),
  fieldTarget('email'),
  fieldTarget('instagram_handle'),
  fieldTarget('language'),
  fieldTarget('mobile'),
  fieldTarget('discord_handle'),
  fieldTarget('cc_join_date'),
  fieldTarget('shipping_address'),
  fieldTarget('owner_id'),
  fieldTarget('next_follow_up_date'),
  special('stage_next', 'Next Action / journey step', ['Next Action', 'Journey Step', 'Journey', 'Stage']),
  special('status', 'Status', ['Status']),
  special('tt_shop', 'TT Shop Enabled?', ['TT Shop Enabled']),
  fieldTarget('current_product'),
  fieldTarget('other_products_received'),
  special('video_link_a', 'Video link', [
    'Video Link - IG/TT Not TT Shop Enabled',
    'Video Link',
    'Video Links',
    'First Video Link',
  ]),
  special('video_link_b', 'Video link (TT Shop)', ['Video Link - TT Shop Enabled', 'Video Link 2']),
  special('notes', 'Notes', ['Notes']),
]

/** Columns we know about and deliberately leave out, with the reason. Keyed by normalised name. */
const LEFT_OUT = {
  productdelivered: 'Yes/No with no date, so there is nothing to write.',
}

const REPEAT = /\s\(\d+\)$/

/** Why a column that isn't mapped is being ignored (for the mapping step's list). */
export function ignoredReason(header, rows, targets = IMPORT_TARGETS) {
  const base = header.replace(REPEAT, '')
  const key = normaliseHeader(base)
  if (REPEAT.test(header) && targets.some((t) => t.names.some((n) => normaliseHeader(n) === key))) {
    return 'Repeats an earlier column. The first one is used.'
  }
  if (LEFT_OUT[key]) return LEFT_OUT[key]
  if (rows.every((r) => String(r[header] ?? '').trim() === '')) return 'Empty column.'
  const owned = FIELDS.find(
    (f) =>
      (f.readOnly || LOCKED_WHEN_SYNCED.has(f.key)) &&
      [f.key, f.label, ...(f.aliases || [])].some((n) => normaliseHeader(n) === key),
  )
  if (owned) return 'TikTok fills this. TikTok data always wins.'
  return 'Not used by the import.'
}

// ---------------------------------------------------------------------------
// Stage
// ---------------------------------------------------------------------------

/** A stage name from the sheet (old numbering and names included) → { stage, ok }.
    stage is a creator_stage label or null (nothing to apply); ok is false when the
    text isn't recognised. "7. First Sale" is Video Posted, "Accepted" is TT Shop
    Enabled, and Tier Up / Top Performer are ignored (tiers come from the data). */
export function stageFromText(text) {
  const s = String(text ?? '')
    .toLowerCase()
    .replace(/^\s*\d+\s*[.)]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!s || s === 'tier up' || s === 'top performer') return { stage: null, ok: true }
  if (['accepted', 'accepted (target collab invite)', 'accepted (target collab invitation)'].includes(s)) {
    return { stage: 'TT Shop Enabled', ok: true }
  }
  if (s === 'first sale') return { stage: 'Video Posted', ok: true }
  const hit = STAGES.find((st) => st.toLowerCase() === s)
  return hit ? { stage: hit, ok: true } : { stage: null, ok: false }
}

const furthest = (stages) => stages.filter(Boolean).sort((a, b) => STAGES.indexOf(b) - STAGES.indexOf(a))[0] ?? null

const isYes = (v) => /^(y|yes|true|1|x|✓|✔)$/i.test(String(v ?? '').trim())

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

const iso = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`

/** A real calendar date, or null (31-Feb, month 13). */
function validDate(y, m, d) {
  const t = new Date(Date.UTC(y, m, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === m && t.getUTCDate() === d ? t : null
}

/** Today as YYYY-MM-DD in the browser's time zone. */
const todayIso = (now) => iso(now.getFullYear(), now.getMonth(), now.getDate())

/** Day, month index and optional year → "YYYY-MM-DD". With no year it is the
    import year, or the year before if that would be in the future. */
function resolveDate(day, month, yearText, now) {
  const explicit = yearText ? (yearText.length === 2 ? 2000 + Number(yearText) : Number(yearText)) : null
  if (explicit) return validDate(explicit, month, day) ? iso(explicit, month, day) : null
  const year = now.getFullYear()
  if (!validDate(year, month, day)) return null
  return iso(year, month, day) > todayIso(now) ? (validDate(year - 1, month, day) ? iso(year - 1, month, day) : null) : iso(year, month, day)
}

// "12-Oct: …", "12 Oct 2026: …", "3-Sep-26: …"
const NOTE_NAMED = /^\s*(\d{1,2})[-\s/.]+([A-Za-z]{3,9})\.?(?:[-\s/.]+(\d{4}|\d{2}))?\s*:\s*(.*)$/
// "12/10: …", "12/10/2026: …" (day first, like the rest of the app)
const NOTE_NUMERIC = /^\s*(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?\s*:\s*(.*)$/

/** One line → { date, rest } if it starts with a dated label, else null. */
function dateLine(line, now) {
  let m = line.match(NOTE_NAMED)
  if (m) {
    const month = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase())
    if (month === -1) return null
    const date = resolveDate(Number(m[1]), month, m[3], now)
    return date ? { date, rest: m[4] } : null
  }
  m = line.match(NOTE_NUMERIC)
  if (m) {
    const date = resolveDate(Number(m[1]), Number(m[2]) - 1, m[3], now)
    return date ? { date, rest: m[4] } : null
  }
  return null
}

/** A notes cell → [{ date: 'YYYY-MM-DD' | null, text }].
    A line starting with a date and a colon begins an entry; a line without one
    joins the entry before it. Text before any dated line, or a cell with no
    dated line at all, is one undated entry (the database dates it now). */
export function parseNotes(cell, now = new Date()) {
  const entries = []
  let current = null
  for (const line of String(cell ?? '').split(/\r?\n/)) {
    const hit = dateLine(line, now)
    if (hit) {
      if (current) entries.push(current)
      current = { date: hit.date, text: hit.rest }
    } else if (current) {
      current.text += `\n${line}`
    } else if (line.trim()) {
      current = { date: null, text: line }
    }
  }
  if (current) entries.push(current)
  return entries.map((e) => ({ ...e, text: e.text.trim() })).filter((e) => e.text)
}

// ---------------------------------------------------------------------------
// Video links
// ---------------------------------------------------------------------------

/** Every http(s) link in the cells, once each. The word before a link ("mask https://…") is dropped. */
export function extractLinks(...cells) {
  const found = []
  for (const cell of cells) {
    for (const m of String(cell ?? '').matchAll(/https?:\/\/[^\s,;]+/gi)) {
      const url = m[0].replace(/[)\].]+$/, '')
      if (!found.includes(url)) found.push(url)
    }
  }
  return found
}

/** TikTok video ids grow with time, so the smallest is the earliest video. Links
    without an id keep their order after those that have one. */
export function earliestFirst(links) {
  const withId = []
  const rest = []
  for (const url of links) {
    const id = url.match(/\/video\/(\d{6,})/)?.[1]
    if (id) withId.push({ url, id: BigInt(id) })
    else rest.push(url)
  }
  withId.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return [...withId.map((x) => x.url), ...rest]
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

/** The sheet rows → { rows, messages }: the objects import_creators takes, and
    per-row notes only the browser can make (a Next Action it couldn't read).
    `mapping` is { targetKey: sheet header }. Empty cells are left out. */
export function buildImportRows(sheetRows, rowNumbers, mapping, now = new Date()) {
  const rows = []
  const messages = new Map() // sheet row number → [text]
  const note = (row, text) => messages.set(row, [...(messages.get(row) || []), text])

  sheetRows.forEach((raw, i) => {
    const rowNo = rowNumbers[i]
    const cell = (key) => (mapping[key] ? String(raw[mapping[key]] ?? '') : '')
    const out = { row: rowNo }
    const set = (key, value) => {
      if (value != null && String(value).trim() !== '') out[key] = typeof value === 'string' ? value.trim() : value
    }

    set('tiktok_handle', cell('tiktok_handle'))
    for (const key of ['name', 'email', 'instagram_handle', 'language', 'mobile', 'discord_handle', 'shipping_address', 'current_product']) {
      set(key, cell(key))
    }
    set('owner_name', cell('owner_id'))

    // Dates travel as ISO. A value that isn't a date goes as typed, so the report can name it.
    for (const key of ['cc_join_date', 'next_follow_up_date']) {
      const text = cell(key).trim()
      if (text) out[key] = normaliseDate(text) ?? text
    }

    // The furthest of: the journey step, TT Shop Enabled? = Yes, Status = Invited.
    const step = stageFromText(cell('stage_next'))
    if (!step.ok) note(rowNo, `Next Action "${cell('stage_next').trim()}" not recognised; stage left alone.`)
    const status = cell('status').trim().toLowerCase() === 'invited' ? 'Invited' : null
    const candidate = furthest([step.stage, isYes(cell('tt_shop')) ? 'TT Shop Enabled' : null, status])
    if (candidate) out.stage_candidate = candidate

    const products = parseProducts(cell('other_products_received').replace(/\r?\n/g, ';'))
    if (products.length) out.other_products = products.map((p) => ({ product: p.product, date_received: p.date_received }))

    // Video links: the earliest-looking one is a candidate for First Video Link
    // (the database only uses it if that is empty and TikTok doesn't fill it); the rest become one note.
    const links = earliestFirst(extractLinks(cell('video_link_a'), cell('video_link_b')))
    if (links.length) {
      out.first_video_link = links[0]
      if (links.length > 1) out.extra_note = `Imported video links: ${links.slice(1).join(', ')}`
    }

    const notes = parseNotes(cell('notes'), now)
    if (notes.length) out.notes = notes

    rows.push(out)
  })

  return { rows, messages }
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

const SUMMARY_KEYS = [
  'rows_received',
  'matched',
  'created',
  'fields_filled',
  'values_skipped_already_filled',
  'values_skipped_tiktok_owned',
  'stage_moved_forward',
  'stage_not_later',
  'notes_appended',
  'notes_skipped_duplicate',
  'invalid_values',
]

/** Adds up the {summary, rows} results of several calls (the real run goes in batches). */
export function mergeResults(results) {
  const summary = { skipped: { total: 0, no_handle: 0, duplicate: 0, removed_match: 0 }, owner_unmatched: { rows: 0, names: [] } }
  for (const key of SUMMARY_KEYS) summary[key] = 0
  const rows = []
  for (const r of results) {
    for (const key of SUMMARY_KEYS) summary[key] += r.summary[key] || 0
    for (const key of Object.keys(summary.skipped)) summary.skipped[key] += r.summary.skipped?.[key] || 0
    summary.owner_unmatched.rows += r.summary.owner_unmatched?.rows || 0
    summary.owner_unmatched.names = [...new Set([...summary.owner_unmatched.names, ...(r.summary.owner_unmatched?.names || [])])]
    rows.push(...r.rows)
  }
  return { summary, rows }
}

/** Splits into batches of `size`. */
export function batches(list, size) {
  const out = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

const FIELD_LABEL = {
  owner_id: 'Owner',
  other_products_received: 'Other Products Received',
}
const labelOf = (key) => FIELD_LABEL[key] || FIELD_BY_KEY[key]?.label || key

/** The per-row report as a CSV download. `extra` is the browser-side messages by row number. */
export function downloadReport(rows, extra, filename) {
  const lines = rows.map((r) => ({
    Row: r.row,
    Handle: r.handle || '',
    Action: r.action,
    'Filled in': (r.filled || []).map(labelOf).join('; '),
    'Left alone': (r.skipped || []).map((s) => `${labelOf(s.field)}: ${s.reason}`).join('; '),
    Notes: [...(r.messages || []), ...(extra?.get(r.row) || [])].join(' '),
  }))
  download(new Blob(['﻿' + Papa.unparse(lines)], { type: 'text/csv;charset=utf-8;' }), filename)
}

export { labelOf as importFieldLabel }

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

const TEMPLATE_HEADERS = [
  'TikTok Handle',
  'Name',
  'Email',
  'Instagram Handle',
  'Language',
  'Mobile',
  'CC Join Date',
  'Discord',
  'Shipping Address',
  'Owner',
  'Next Follow-up',
  'Journey Step',
  'TT Shop Enabled?',
  'Status',
  'Current Product',
  'Other Products Received',
  'Video Links',
  'Notes',
]

const TEMPLATE_EXAMPLE = [
  'examplecreator',
  'Example Creator',
  'example@email.com',
  'example_ig',
  'Spanish',
  '+1 555 0100',
  '2026-09-04',
  'example#1234',
  '1 Example St, Example City',
  'Megs',
  '2026-10-16',
  'First Product',
  'Yes',
  'Invited',
  'Example Product',
  'Other Product A; Other Product B',
  'https://www.tiktok.com/@examplecreator/video/7000000000000000000',
  '12-Oct: Sent a message\n14-Oct: Replied',
]

const INSTRUCTIONS = [
  ['Creator Club import – how to fill this in'],
  [],
  ['TikTok Handle', 'Required. The only way a row is matched to a creator. A handle, @handle or a TikTok profile link all work.'],
  ['Everything else', 'Optional. Leave a column out or a cell blank and nothing happens.'],
  [],
  ['What the import does'],
  ['', 'TikTok data always wins. The import only fills empty fields and never moves anyone backwards.'],
  ['', 'A creator already in the CRM keeps every value they have. Blank fields are filled from your sheet.'],
  ['', 'A handle that is not in the CRM becomes a new creator. Rows with no handle are skipped.'],
  [],
  ['Columns'],
  ['Language', 'Spanish / Spa / Español, or English / En. Blank leaves it alone.'],
  ['CC Join Date, Next Follow-up', 'YYYY-MM-DD, DD/MM/YYYY or 4-Sep-2026. A join date moves an Invited creator to Joined.'],
  ['Owner', "A team member's name, as it appears in the CRM. Names without a login yet are left blank."],
  ['Journey Step', 'A stage name, e.g. First Product. It can only move a creator forward.'],
  ['TT Shop Enabled?', 'Yes counts as at least TT Shop Enabled. Anything else does nothing.'],
  ['Status', 'Invited sets the Invited stage. Other values are ignored.'],
  ['Current Product', 'Only used if the creator has none and TikTok has not filled it.'],
  ['Video Links', 'The earliest link fills an empty First Video Link. Others are saved as a note.'],
  ['Notes', 'Start a line with a date and a colon (12-Oct: …) to date it. Notes are added, never replaced, and repeats are skipped.'],
]

/** Our column names with one example row, as CSV. */
export function downloadTemplateCsv() {
  const csv = Papa.unparse([TEMPLATE_HEADERS, TEMPLATE_EXAMPLE])
  download(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }), 'creator-club-import-template.csv')
}

/** The same, as an .xlsx with an Instructions sheet. */
export function downloadTemplateExcel() {
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([TEMPLATE_HEADERS, TEMPLATE_EXAMPLE]), 'Creators')
  const instructions = XLSX.utils.aoa_to_sheet(INSTRUCTIONS)
  instructions['!cols'] = [{ wch: 28 }, { wch: 110 }]
  XLSX.utils.book_append_sheet(book, instructions, 'Instructions')
  const buf = XLSX.write(book, { bookType: 'xlsx', type: 'array' })
  download(
    new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    'creator-club-import-template.xlsx',
  )
}
