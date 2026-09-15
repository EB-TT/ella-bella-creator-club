import Papa from 'papaparse'
import { FIELDS } from './fields'

/** Parse an uploaded file into { headers, rows }. */
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

/** Download the given creators as a CSV using the field labels as headers. */
export function exportCreatorsCsv(creators, filename) {
  const rows = creators.map((c) => {
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

  const csv = Papa.unparse(rows)
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
