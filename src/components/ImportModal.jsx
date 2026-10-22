import { useMemo, useState } from 'react'
import { Download, FileSpreadsheet } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { guessMapping, parseImportFile } from '../lib/csv'
import {
  batches,
  buildImportRows,
  downloadReport,
  downloadTemplateCsv,
  downloadTemplateExcel,
  IMPORT_TARGETS,
  ignoredReason,
  importFieldLabel,
  mergeResults,
} from '../lib/importSheet'
import { TIKTOK_HINTS } from '../lib/tiktok'
import { InfoTip } from './SyncMarker'
import { Tooltip } from './Tooltip'

/* Import the team's sheet (migration 015, public.import_creators).

   upload → map columns → preview (a dry run: nothing is written) → import in
   batches of 500 → done. The database does the matching and every write under
   the signed-in user's session; this component parses the file, shows what the
   preview says and sends the confirmed rows. */

const BATCH = 500
const SHOW = 200

const ISSUE = /not recognised|not a date|No team member|More than one/

const hasIssue = (row, extra) =>
  (row.skipped || []).length > 0 || (extra.get(row.row) || []).length > 0 || (row.messages || []).some((m) => ISSUE.test(m))

const ACTION_TONE = { update: 'accent', create: 'green', skip: 'amber' }

const num = (n) => Number(n || 0).toLocaleString('en-US')

function Stat({ value, label }) {
  return (
    <div className="import-stat">
      <strong>{num(value)}</strong>
      <span>{label}</span>
    </div>
  )
}

function Summary({ summary, clientInvalid, dry }) {
  const s = summary
  const owners = s.owner_unmatched?.names || []
  return (
    <>
      <div className="import-stats">
        <Stat value={s.rows_received} label="Rows in the file" />
        <Stat value={s.matched} label={dry ? 'Existing creators to update' : 'Existing creators updated'} />
        <Stat value={s.created} label={dry ? 'New creators to add' : 'New creators added'} />
        <Stat value={s.skipped?.total} label="Rows skipped" />
        <Stat value={s.fields_filled} label="Empty fields filled" />
        <Stat value={s.values_skipped_already_filled} label="Left alone: already filled" />
        <Stat value={s.values_skipped_tiktok_owned} label="Left alone: TikTok has it" />
        <Stat value={s.stage_moved_forward} label="Stages moved forward" />
        <Stat value={s.stage_not_later} label="Stages already there or later" />
        <Stat value={s.notes_appended} label="Notes added" />
        <Stat value={s.notes_skipped_duplicate} label="Notes already there" />
        <Stat value={(s.invalid_values || 0) + clientInvalid} label="Values not understood" />
      </div>
      {s.skipped?.total > 0 && (
        <p className="field-hint">
          Skipped: {num(s.skipped.no_handle)} with no handle, {num(s.skipped.duplicate)} repeating an earlier handle,{' '}
          {num(s.skipped.removed_match)} matching a removed creator (restore them first).
        </p>
      )}
      {owners.length > 0 && (
        <p className="field-hint">
          No team member yet for {owners.join(', ')} ({num(s.owner_unmatched.rows)} row
          {s.owner_unmatched.rows === 1 ? '' : 's'}). Owner is left blank; importing again once they have a login fills it.
        </p>
      )}
    </>
  )
}

function ReportTable({ rows, extra, filter }) {
  const [limit, setLimit] = useState(SHOW)
  const shown = useMemo(
    () =>
      rows.filter((r) =>
        filter === 'all' ? true : filter === 'issues' ? hasIssue(r, extra) : r.action === filter,
      ),
    [rows, extra, filter],
  )
  if (!shown.length) return <p className="cell-muted">No rows to show.</p>
  return (
    <>
      <div className="import-table">
        <table className="table">
          <thead>
            <tr>
              <th>Row</th>
              <th>Handle</th>
              <th>Action</th>
              <th>Filled in</th>
              <th>Left alone</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {shown.slice(0, limit).map((r) => (
              <tr key={r.row} style={{ cursor: 'default' }}>
                <td className="cell-num">{r.row}</td>
                <td>{r.handle || '—'}</td>
                <td>
                  <span className={`pill pill--${ACTION_TONE[r.action] || 'neutral'}`}>{r.action}</span>
                </td>
                <td className="import-wrap">{(r.filled || []).map(importFieldLabel).join(', ') || '—'}</td>
                <td className="import-wrap">
                  {(r.skipped || []).map((s) => `${importFieldLabel(s.field)}: ${s.reason}`).join('; ') || '—'}
                </td>
                <td className="import-wrap">{[...(r.messages || []), ...(extra.get(r.row) || [])].join(' ') || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {shown.length > limit && (
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => setLimit((n) => n + SHOW)}>
          Show more ({num(shown.length - limit)} left)
        </button>
      )}
    </>
  )
}

export function ImportModal({ onDone, onClose }) {
  const [step, setStep] = useState('upload') // upload | map | preview | done
  const [fileName, setFileName] = useState('')
  const [headers, setHeaders] = useState([])
  const [sheetRows, setSheetRows] = useState([])
  const [rowNumbers, setRowNumbers] = useState([])
  const [mapping, setMapping] = useState({})
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [payload, setPayload] = useState([]) // the rows sent to the function
  const [extra, setExtra] = useState(new Map()) // browser-side notes by row number
  const [preview, setPreview] = useState(null) // { summary, rows }
  const [filter, setFilter] = useState('all')
  const [progress, setProgress] = useState(null) // { done, total }
  const [result, setResult] = useState(null) // the merged real run

  const mappedHeaders = useMemo(() => new Set(Object.values(mapping).filter(Boolean)), [mapping])
  const ignored = useMemo(
    () => headers.filter((h) => !mappedHeaders.has(h)).map((h) => ({ header: h, reason: ignoredReason(h, sheetRows) })),
    [headers, mappedHeaders, sheetRows],
  )
  const clientInvalid = useMemo(() => [...extra.values()].reduce((n, list) => n + list.length, 0), [extra])

  async function onFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    try {
      const table = await parseImportFile(file)
      if (!table.rows.length) throw new Error('That file has a header row but no creators under it.')
      setFileName(file.name)
      setHeaders(table.headers)
      setSheetRows(table.rows)
      setRowNumbers(table.rowNumbers)
      setMapping(guessMapping(table.headers, IMPORT_TARGETS))
      setStep('map')
    } catch (err) {
      setError(err.message || 'Could not read that file.')
    }
  }

  async function runPreview() {
    setBusy(true)
    setError(null)
    const built = buildImportRows(sheetRows, rowNumbers, mapping)
    const { data, error: rpcError } = await supabase.rpc('import_creators', { p_rows: built.rows, p_dry_run: true })
    setBusy(false)
    if (rpcError) {
      setError(rpcError.message)
      return
    }
    setPayload(built.rows)
    setExtra(built.messages)
    setPreview(data)
    setFilter('all')
    setStep('preview')
  }

  // Only rows the preview said would do something are sent; skipped rows stay skipped.
  const actionByRow = useMemo(() => new Map((preview?.rows || []).map((r) => [r.row, r.action])), [preview])
  const toSend = useMemo(() => payload.filter((r) => actionByRow.get(r.row) !== 'skip'), [payload, actionByRow])

  async function runImport() {
    setBusy(true)
    setError(null)
    const parts = batches(toSend, BATCH)
    const results = []
    setProgress({ done: 0, total: parts.length })
    for (let i = 0; i < parts.length; i += 1) {
      const { data, error: rpcError } = await supabase.rpc('import_creators', { p_rows: parts[i], p_dry_run: false })
      if (rpcError) {
        setError(
          `Batch ${i + 1} of ${parts.length} failed: ${rpcError.message}` +
            (i > 0
              ? ` Batches 1–${i} were applied. Running the import again is safe: it only fills empty fields.`
              : ' Nothing was imported.'),
        )
        setBusy(false)
        setProgress(null)
        if (i > 0) onDone?.() // earlier batches are in: refresh the list
        return
      }
      results.push(data)
      setProgress({ done: i + 1, total: parts.length })
    }
    // Rows the preview skipped are carried into the final report as they were.
    const skipped = (preview?.rows || []).filter((r) => r.action === 'skip')
    const merged = mergeResults(results)
    merged.rows.push(...skipped)
    merged.rows.sort((a, b) => a.row - b.row)
    merged.summary.skipped = preview.summary.skipped
    merged.summary.rows_received = preview.summary.rows_received
    setResult(merged)
    setBusy(false)
    setProgress(null)
    setStep('done')
    onDone?.()
  }

  const targets = IMPORT_TARGETS
  const canPreview = Boolean(mapping.tiktok_handle) && !busy
  const wide = step === 'preview' || step === 'done'

  return (
    <div className="modal-scrim" onClick={busy ? undefined : onClose}>
      <div
        className={`modal${wide ? ' modal--wide' : ''}`}
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="modal__title">Import creators from CSV or Excel</h2>
        <p className="modal__text">
          TikTok data always wins. The import only fills empty fields and never moves anyone backwards. Rows are matched
          by TikTok handle; nothing is saved until you have seen the preview and confirmed.
        </p>

        {error && <div className="alert">{error}</div>}

        {step === 'upload' && (
          <>
            <input
              type="file"
              accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              className="input"
              onChange={onFile}
            />
            <div className="import-template">
              <span className="cell-muted">Your own sheet works as it is. Or start from our template:</span>
              <Tooltip text={TIKTOK_HINTS.importTemplate}>
                <button type="button" className="btn btn--outline btn--sm" onClick={downloadTemplateCsv}>
                  <Download size={13} /> CSV
                </button>
              </Tooltip>
              <Tooltip text={TIKTOK_HINTS.importTemplate}>
                <button type="button" className="btn btn--outline btn--sm" onClick={downloadTemplateExcel}>
                  <FileSpreadsheet size={13} /> Excel
                </button>
              </Tooltip>
            </div>
          </>
        )}

        {step === 'map' && (
          <>
            <h3 className="section-title">
              Column mapping · {fileName} · {sheetRows.length} row{sheetRows.length === 1 ? '' : 's'} found
            </h3>
            {targets.map((t) => (
              <div className="map-row" key={t.key}>
                <span className="map-row__label label-row">
                  {t.label}
                  {t.required && ' *'}
                  <InfoTip text={TIKTOK_HINTS.importTargets[t.key]} />
                </span>
                <select
                  className="select"
                  value={mapping[t.key] || ''}
                  onChange={(e) => setMapping((m) => ({ ...m, [t.key]: e.target.value }))}
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
            {!mapping.tiktok_handle && <div className="alert">Pick the TikTok Handle column. Rows are matched on it.</div>}

            {ignored.length > 0 && (
              <div style={{ marginTop: 'var(--sp-5)' }}>
                <div className="label-row">
                  <h3 className="section-title" style={{ margin: 0 }}>
                    Ignored columns ({ignored.length})
                  </h3>
                  <InfoTip text={TIKTOK_HINTS.importIgnored} />
                </div>
                <ul className="import-ignored">
                  {ignored.map((x) => (
                    <li key={x.header}>
                      <strong>{x.header}</strong> <span className="cell-muted">– {x.reason}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}

        {step === 'preview' && preview && (
          <>
            <div className="label-row">
              <h3 className="section-title" style={{ margin: 0 }}>
                Preview · nothing is saved yet
              </h3>
              <InfoTip text={TIKTOK_HINTS.importPreview} />
            </div>
            <Summary summary={preview.summary} clientInvalid={clientInvalid} dry />
            <div className="import-filter">
              <label htmlFor="import-filter" className="label">
                Show
              </label>
              <select id="import-filter" className="select" value={filter} onChange={(e) => setFilter(e.target.value)}>
                <option value="all">All rows</option>
                <option value="update">Existing creators</option>
                <option value="create">New creators</option>
                <option value="skip">Skipped</option>
                <option value="issues">Needs a look</option>
              </select>
              <InfoTip text={TIKTOK_HINTS.importFilter} />
              <Tooltip text={TIKTOK_HINTS.importReport}>
                <button
                  type="button"
                  className="btn btn--outline btn--sm"
                  onClick={() => downloadReport(preview.rows, extra, 'creator-club-import-preview.csv')}
                >
                  <Download size={13} /> Download report
                </button>
              </Tooltip>
            </div>
            <ReportTable rows={preview.rows} extra={extra} filter={filter} />
          </>
        )}

        {step === 'done' && result && (
          <>
            <div className="alert alert--ok">
              Imported: {num(result.summary.matched)} updated, {num(result.summary.created)} added.
            </div>
            <Summary summary={result.summary} clientInvalid={clientInvalid} dry={false} />
            <div className="import-filter">
              <button
                type="button"
                className="btn btn--outline btn--sm"
                onClick={() => downloadReport(result.rows, extra, 'creator-club-import-report.csv')}
              >
                <Download size={13} /> Download report
              </button>
            </div>
          </>
        )}

        {progress && (
          <p className="field-hint" role="status">
            Importing batch {Math.min(progress.done + 1, progress.total)} of {progress.total}…
          </p>
        )}

        <div className="modal__actions">
          {step === 'map' && (
            <button type="button" className="btn btn--ghost" onClick={() => setStep('upload')} disabled={busy}>
              Back
            </button>
          )}
          {step === 'preview' && (
            <button type="button" className="btn btn--ghost" onClick={() => setStep('map')} disabled={busy}>
              Back
            </button>
          )}
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
            {step === 'done' ? 'Done' : 'Cancel'}
          </button>
          {step === 'map' && (
            <Tooltip text={TIKTOK_HINTS.importPreviewButton}>
              <button type="button" className="btn btn--primary" onClick={runPreview} disabled={!canPreview}>
                {busy ? 'Checking…' : `Preview ${sheetRows.length}`}
              </button>
            </Tooltip>
          )}
          {step === 'preview' && (
            <Tooltip text={TIKTOK_HINTS.importRun}>
              <button type="button" className="btn btn--primary" onClick={runImport} disabled={busy || !toSend.length}>
                {busy ? 'Importing…' : `Import ${num(toSend.length)} row${toSend.length === 1 ? '' : 's'}`}
              </button>
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  )
}
