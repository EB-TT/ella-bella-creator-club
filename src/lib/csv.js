import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import { FIELD_BY_KEY, FIELDS, formatProducts, formatVideos, JOURNEY_MERGED } from './fields'

const isExcel = (file) =>
  /\.xlsx?$/i.test(file.name || '') ||
  /spreadsheetml|ms-excel/.test(file.type || '')

const cleanHeader = (c) => String(c ?? '').replace(/\s+/g, ' ').trim()

/** A sheet as rows of cells → { headers, rows, rowNumbers }.
    The header row is the first row with anything in it. Header names lose their
    line breaks and stray spaces, and a name that repeats gets " (2)", " (3)" so
    nothing is overwritten: the first column with a name keeps the plain name.
    Columns with no header are dropped. Each row is an object keyed by header;
    `rowNumbers[i]` is that row's number in the sheet (blank rows are skipped but
    still counted), `firstRow` is the sheet's first row number (1 for CSV). */
export function tableFromMatrix(matrix, firstRow = 1) {
  const headerAt = matrix.findIndex((r) => r.some((c) => String(c ?? '').trim() !== ''))
  if (headerAt === -1) throw new Error('No header row found in that file.')

  const seen = new Map()
  const columns = []
  matrix[headerAt].forEach((cell, index) => {
    const base = cleanHeader(cell)
    if (!base) return
    const n = (seen.get(base.toLowerCase()) ?? 0) + 1
    seen.set(base.toLowerCase(), n)
    columns.push({ index, name: n === 1 ? base : `${base} (${n})` })
  })
  if (!columns.length) throw new Error('No header row found in that file.')

  const rows = []
  const rowNumbers = []
  for (let i = headerAt + 1; i < matrix.length; i += 1) {
    const cells = matrix[i]
    if (!cells.some((c) => String(c ?? '').trim() !== '')) continue
    rows.push(Object.fromEntries(columns.map(({ index, name }) => [name, String(cells[index] ?? '')])))
    rowNumbers.push(firstRow + i)
  }
  return { headers: columns.map((c) => c.name), rows, rowNumbers }
}

/** Parse an uploaded CSV file into { headers, rows, rowNumbers }. */
export function parseCsvFile(file) {
  return new Promise((resolve, reject) => {
    // header: false so repeated header names can be told apart by position.
    Papa.parse(file, {
      skipEmptyLines: false,
      complete: (res) => {
        try {
          resolve(tableFromMatrix(res.data))
        } catch (err) {
          reject(err)
        }
      },
      error: (err) => reject(err),
    })
  })
}

/** Parse an uploaded .xlsx/.xls file (first sheet) into { headers, rows, rowNumbers }. */
export async function parseExcelFile(file) {
  const book = XLSX.read(await file.arrayBuffer(), { type: 'array' })
  const sheetName = book.SheetNames[0]
  if (!sheetName) throw new Error('That workbook has no sheets.')
  const sheet = book.Sheets[sheetName]

  // raw: false so dates and numbers arrive as the strings the user sees,
  // which is what the shared coerce() logic already expects from CSV.
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '', blankrows: true })
  const firstRow = sheet['!ref'] ? XLSX.utils.decode_range(sheet['!ref']).s.r + 1 : 1
  return tableFromMatrix(matrix, firstRow)
}

/** Parse either a CSV or an Excel file, picked by extension/MIME type. */
export function parseImportFile(file) {
  return isExcel(file) ? parseExcelFile(file) : parseCsvFile(file)
}

const normalise = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')

/** Same text once case, spacing, punctuation and line breaks are ignored. */
export const normaliseHeader = normalise

/** Best-effort auto-match of sheet headers to import targets ({ key, names }).
    A header is used once, and a repeated header ("Notes (2)") never matches,
    so the first column with a name wins. */
export function guessMapping(headers, targets) {
  const mapping = {}
  const used = new Set()

  for (const target of targets) {
    const names = target.names.map(normalise)
    const hit = headers.find((h) => !used.has(h) && names.includes(normalise(h)))
    mapping[target.key] = hit || ''
    if (hit) used.add(hit)
  }
  return mapping
}

/** Shape creators into flat export rows keyed by the field labels.
    `ownerNames` maps profile id → name; `labels` overrides a field's header by
    key (the Period selector puts the period in the GMV / Units column names);
    `columns` is the table's visible column keys, in order (omitted = all fields). */
function toExportRows(creators, ownerNames, labels = {}, columns) {
  const fields = exportFields(columns)
  const withSuggestions = JOURNEY_MERGED && (!columns || columns.includes('journey'))
  return creators.map((c) => {
    const out = {}
    for (const f of fields) {
      const v = c[f.key]
      const label = labels[f.key] || f.label
      if (f.type === 'bool') out[label] = v ? 'Yes' : 'No'
      else if (f.type === 'products') out[label] = formatProducts(v)
      else if (f.type === 'videos') out[label] = formatVideos(v)
      else if (f.type === 'date') out[label] = v ? String(v).slice(0, 10) : ''
      else if (f.type === 'owner') out[label] = (v && ownerNames?.get(v)) || ''
      else out[label] = v ?? f.blankLabel ?? ''
    }
    // With the merged Journey field the app shows one column, so the export adds
    // the suggestions next to Stage and Creator Tier and no detail is lost.
    if (withSuggestions) {
      out['Suggested stage'] = c.suggested_stage ?? ''
      out['Suggested tier'] = c.suggested_tier ?? ''
    }
    out['Notes'] = (c.notes || [])
      .map((n) => `[${n.timestamp} ${n.author}] ${n.text}`)
      .join('\n')
    out['Status'] = c.status
    return out
  })
}

export function download(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/** Download the given creators as a CSV using the field labels as headers. */
export function exportCreatorsCsv(creators, filename, ownerNames, labels, columns) {
  const csv = Papa.unparse(toExportRows(creators, ownerNames, labels, columns))
  download(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }), filename)
}

/** Download the given creators as an .xlsx workbook with the same columns. */
export function exportCreatorsExcel(creators, filename, ownerNames, labels, columns) {
  const sheet = XLSX.utils.json_to_sheet(toExportRows(creators, ownerNames, labels, columns))
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, 'Creators')
  const buf = XLSX.write(book, { bookType: 'xlsx', type: 'array' })
  download(
    new Blob([buf], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    filename,
  )
}
