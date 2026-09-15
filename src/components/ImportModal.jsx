import { useState } from 'react'
import { coerce, FIELDS, STAGES } from '../lib/fields'
import { guessMapping, parseCsvFile } from '../lib/csv'

/* Import runs entirely in the app under the team member's own session, so
   nobody needs Supabase dashboard access to load creators. */

function buildRows(csvRows, mapping) {
  const rows = []
  const skipped = []

  csvRows.forEach((raw, i) => {
    const row = { status: 'active', notes: [] }

    for (const field of FIELDS) {
      const header = mapping[field.key]
      if (!header) continue
      row[field.key] = coerce(field, raw[header])
    }

    if (!row.name) {
      skipped.push(`Row ${i + 2}: no name`)
      return
    }
    if (!row.stage || !STAGES.includes(row.stage)) row.stage = STAGES[0]

    rows.push(row)
  })

  return { rows, skipped }
}

export function ImportModal({ onImport, onClose }) {
  const [headers, setHeaders] = useState([])
  const [csvRows, setCsvRows] = useState([])
  const [mapping, setMapping] = useState({})
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)

  async function onFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    setResult(null)
    try {
      const { headers, rows } = await parseCsvFile(file)
      setHeaders(headers)
      setCsvRows(rows)
      setMapping(guessMapping(headers))
    } catch (err) {
      setError(err.message || 'Could not read that file.')
    }
  }

  async function run() {
    setBusy(true)
    setError(null)
    const { rows, skipped } = buildRows(csvRows, mapping)

    if (!rows.length) {
      setError('Nothing to import — check that a CSV column is mapped to Name.')
      setBusy(false)
      return
    }

    try {
      const count = await onImport(rows)
      setResult({ count, skipped })
    } catch (err) {
      setError(err.message || 'Import failed.')
    }
    setBusy(false)
  }

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal__title">Import creators from CSV</h2>
        <p className="modal__text">
          Upload a CSV with a header row. Columns are matched automatically where the names line
          up — check the mapping below and adjust anything that is wrong. Rows without a name are
          skipped.
        </p>

        {error && <div className="alert">{error}</div>}
        {result && (
          <div className="alert alert--ok">
            Imported {result.count} creator{result.count === 1 ? '' : 's'}.
            {result.skipped.length > 0 && ` Skipped ${result.skipped.length}: ${result.skipped.join('; ')}`}
          </div>
        )}

        {!result && (
          <>
            <input type="file" accept=".csv,text/csv" className="input" onChange={onFile} />

            {headers.length > 0 && (
              <div style={{ marginTop: 'var(--sp-5)' }}>
                <h3 className="section-title">
                  Column mapping · {csvRows.length} row{csvRows.length === 1 ? '' : 's'} found
                </h3>
                {FIELDS.map((f) => (
                  <div className="map-row" key={f.key}>
                    <span className="map-row__label">
                      {f.label}
                      {f.key === 'name' && ' *'}
                    </span>
                    <select
                      className="select"
                      value={mapping[f.key] || ''}
                      onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value }))}
                    >
                      <option value="">— ignore —</option>
                      {headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        <div className="modal__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            {result ? 'Done' : 'Cancel'}
          </button>
          {!result && (
            <button
              type="button"
              className="btn btn--primary"
              onClick={run}
              disabled={busy || !csvRows.length}
            >
              {busy ? 'Importing…' : `Import ${csvRows.length || ''}`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
