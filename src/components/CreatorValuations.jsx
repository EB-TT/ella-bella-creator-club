import { useEffect, useMemo, useRef, useState } from 'react'
import { useValuations } from '../hooks/useValuations'
import { ConfirmModal } from './ConfirmModal'
import { ValuationCredits } from './ValuationCredits'
import { ValuationForm } from './ValuationForm'
import { ValuationTable } from './ValuationTable'
import '../styles/valuations.css'

const HIGHLIGHT_MS = 3000
const TICK_MS = 15000

/** Creator Valuations tab. Deliberately separate from the creators table:
    the only input is a handle typed here. */
export function CreatorValuations({ authorName }) {
  const { rows, loading, error, request, setQuotedRate, remove, restore, fetchBalance } = useValuations()
  const [highlightId, setHighlightId] = useState(null)
  const [retryingId, setRetryingId] = useState(null)
  const [retryError, setRetryError] = useState(null)
  const [showRemoved, setShowRemoved] = useState(false)
  const [pendingRemove, setPendingRemove] = useState(null)
  const [removing, setRemoving] = useState(false)
  const [restoringId, setRestoringId] = useState(null)
  const [actionError, setActionError] = useState(null)
  const [now, setNow] = useState(() => Date.now())
  const highlightTimer = useRef(null)

  // Re-check for stalled rows while anything is still in flight.
  const anyInProgress = rows.some((r) => r.status === 'pending' || r.status === 'running')
  useEffect(() => {
    if (!anyInProgress) return
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(t)
  }, [anyInProgress])

  useEffect(() => () => clearTimeout(highlightTimer.current), [])

  const removedCount = useMemo(() => rows.filter((r) => r.removed_at).length, [rows])
  const visible = useMemo(() => (showRemoved ? rows : rows.filter((r) => !r.removed_at)), [rows, showRemoved])

  function view(id) {
    clearTimeout(highlightTimer.current)
    setHighlightId(id)
    highlightTimer.current = setTimeout(() => setHighlightId(null), HIGHLIGHT_MS)
  }

  /** A stalled row is left as-is; retry files a fresh request for the same handle. */
  async function retry(row) {
    setRetryError(null)
    setRetryingId(row.id)
    try {
      const { invokeError } = await request({
        platform: row.platform,
        handle: row.handle,
        quotedRate: row.quoted_rate == null ? null : Number(row.quoted_rate),
        requestedByName: authorName,
      })
      if (invokeError) setRetryError(`Retry saved, but the valuation didn't start: ${invokeError}`)
    } catch (err) {
      setRetryError(err.message || 'Could not retry.')
    } finally {
      setRetryingId(null)
    }
  }

  async function confirmRemove() {
    setActionError(null)
    setRemoving(true)
    try {
      await remove(pendingRemove.id, authorName)
      setPendingRemove(null)
    } catch (err) {
      setActionError(err.message || 'Could not remove the valuation.')
      setPendingRemove(null)
    } finally {
      setRemoving(false)
    }
  }

  async function onRestore(row) {
    setActionError(null)
    setRestoringId(row.id)
    try {
      await restore(row.id)
    } catch (err) {
      setActionError(err.message || 'Could not restore the valuation.')
    } finally {
      setRestoringId(null)
    }
  }

  return (
    <>
      {error && <div className="alert">{error}</div>}
      {retryError && <div className="alert">{retryError}</div>}
      {actionError && <div className="alert">{actionError}</div>}

      <ValuationCredits rows={rows} loading={loading} fetchBalance={fetchBalance} />

      <ValuationForm
        rows={rows}
        authorName={authorName}
        onRequest={request}
        onView={view}
        onSetRate={setQuotedRate}
      />

      <div className="vtoolbar">
        <label className="vtoggle">
          <input type="checkbox" checked={showRemoved} onChange={(e) => setShowRemoved(e.target.checked)} />
          Show removed ({removedCount})
        </label>
      </div>

      {loading ? (
        <div className="card empty">Loading valuations…</div>
      ) : (
        <ValuationTable
          rows={visible}
          now={now}
          highlightId={highlightId}
          retryingId={retryingId}
          restoringId={restoringId}
          emptyMessage={
            rows.length ? 'Every valuation has been removed — tick “Show removed” to see them.' : 'No valuations yet — enter a handle above.'
          }
          onRetry={retry}
          onSetRate={setQuotedRate}
          onRemove={setPendingRemove}
          onRestore={onRestore}
        />
      )}

      {pendingRemove && (
        <ConfirmModal
          title="Remove this valuation?"
          message={`The valuation for @${pendingRemove.handle} will be hidden. Nothing is deleted — tick “Show removed” to see or restore it at any time.`}
          confirmLabel="Remove"
          danger
          busy={removing}
          onConfirm={confirmRemove}
          onCancel={() => setPendingRemove(null)}
        />
      )}
    </>
  )
}
