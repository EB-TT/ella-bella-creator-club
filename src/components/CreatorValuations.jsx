import { useEffect, useRef, useState } from 'react'
import { useValuations } from '../hooks/useValuations'
import { ValuationForm } from './ValuationForm'
import { ValuationTable } from './ValuationTable'
import '../styles/valuations.css'

const HIGHLIGHT_MS = 3000
const TICK_MS = 15000

/** Creator Valuations tab. Deliberately separate from the creators table:
    the only input is a handle typed here. */
export function CreatorValuations({ authorName }) {
  const { rows, loading, error, request, setQuotedRate } = useValuations()
  const [highlightId, setHighlightId] = useState(null)
  const [retryingId, setRetryingId] = useState(null)
  const [retryError, setRetryError] = useState(null)
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

  return (
    <>
      {error && <div className="alert">{error}</div>}
      {retryError && <div className="alert">{retryError}</div>}

      <ValuationForm
        rows={rows}
        authorName={authorName}
        onRequest={request}
        onView={view}
        onSetRate={setQuotedRate}
      />

      {loading ? (
        <div className="card empty">Loading valuations…</div>
      ) : (
        <ValuationTable
          rows={rows}
          now={now}
          highlightId={highlightId}
          retryingId={retryingId}
          onRetry={retry}
          onSetRate={setQuotedRate}
        />
      )}
    </>
  )
}
