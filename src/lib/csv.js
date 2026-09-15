import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import { FIELDS } from './fields'

const isExcel = (file) =>
  /\.xlsx?$/i.test(file.name || '') ||
  /spreadsheetml|ms-excel/.test(file.type || '')

/** Parse an uploaded CSV file into { headers, rows }. */
export function parseCsvFile(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: 'greedy',
      complete: (res) => {
        const headers = res.meta.fields || []
        if (!headers.length) {
          reject(new Error('No header row found in that CSV.'))
          return
        }
        resolve({ headers, rows: res.data })
      },
      error: (err) => reject(err),
    })
  })
}

/** Parse an uploaded .xlsx/.xls file (first sheet) into { headers, rows }. */
export async function parseExcelFile(file) {
  const book = XLSX.read(await file.arrayBuffer(), { type: 'array' })
  const sheetName = book.SheetNames[0]
  if (!sheetName) throw new Error('That workbook has no sheets.')
  const sheet = book.Sheets[sheetName]

  // raw: false so dates and numbers arrive as the strings the user sees,
  // which is what the shared coerce() logic already expects from CSV.
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' })
  const headerRow = matrix.find((r) => r.some((c) => String(c).trim() !== ''))
  if (!headerRow) throw new Error('No header row found in that spreadsheet.')

  const headers = headerRow.map((h) => String(h).trim()).filter(Boolean)
  if (!headers.length) throw new Error('No header row found in that spreadsheet.')

  const rows = XLSX.utils
    .sheet_to_json(sheet, { range: matrix.indexOf(headerRow), raw: false, defval: '' })
    .filter((r) => Object.values(r).some((v) => String(v).trim() !== ''))

  return { headers, rows }
}

/** Parse either a CSV or an Excel file, picked by extension/MIME type. */
export function parseImportFile(file) {
  return isExcel(file) ? parseExcelFile(file) : parseCsvFile(file)
}

const normalise = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')

/** Best-effort auto-match of CSV headers to field keys. */
export function guessMapping(headers) {
  const mapping = {}
  const used = new Set()

  for (const field of FIELDS) {
    const targets = [normalise(field.key), normalise(field.label)]
    const hit = headers.find((h) => !used.has(h) && targets.includes(normalise(h)))
    if (hit) {
      mapping[field.key] = hit
      used.add(hit)
    } else {
      mapping[field.key] = ''
    }
  }
  return mapping
}

/** Shape creators into flat export rows keyed by the field labels. */
function toExportRows(creators) {
  return creators.map((c) => {
    const out = {}
    for (const f of FIELDS) {
      const v = c[f.key]
      out[f.label] = f.type === 'bool' ? (v ? 'Yes' : 'No') : (v ?? '')
    }
    out['Notes'] = (c.notes || [])
      .map((n) => `[${n.timestamp} ${n.author}] ${n.text}`)
      .join('\n')
    out['Status'] = c.status
    return out
  })
}

function download(blob, filename) {
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
export function exportCreatorsCsv(creators, filename) {
  const csv = Papa.unparse(toExportRows(creators))
  download(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }), filename)
}

/** Download the given creators as an .xlsx workbook with the same columns. */
export function exportCreatorsExcel(creators, filename) {
  const sheet = XLSX.utils.json_to_sheet(toExportRows(creators))
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
