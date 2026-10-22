import { AlertTriangle, RotateCw } from 'lucide-react'
import { formatDate, formatDateTime } from '../lib/format'
import {
  DETAIL_STREAMS,
  errorMessage,
  isWaitingForScope,
  relativeTime,
  retryMessage,
  shortError,
  streamLabel,
  TIKTOK_HINTS,
} from '../lib/tiktok'
import { Tooltip } from './Tooltip'

/** What the indicator says, most urgent first: the visible text, its tooltip
    headline, and whether it's a warning. */
function describe(summary) {
  const retrying = summary.retrying[0]
  const errored = summary.errored[0]
  if (summary.tokenProblem) return { text: 'Connection issue', headline: TIKTOK_HINTS.syncToken, warn: true }
  if (retrying) return { text: 'Retrying', headline: retryMessage(retrying), warn: true }
  if (errored) return { text: 'Sync error', headline: errorMessage(errored), warn: true }
  if (summary.stale) return { text: 'Sync delayed', headline: TIKTOK_HINTS.syncStale, warn: true }
  if (summary.lastSuccess) {
    return {
      text: `Synced ${relativeTime(summary.lastSuccess)}`,
      headline: TIKTOK_HINTS.syncOk.replace('{time}', formatDateTime(new Date(summary.lastSuccess).toISOString())),
      warn: false,
    }
  }
  return { text: 'Not synced yet', headline: TIKTOK_HINTS.syncOk.replace('{time}', 'never'), warn: false }
}

/** Tooltip body: the headline, one line per stream (status, last success, next retry), each stream's last error, and when the TikTok connection expires. */
function details(rows, headline) {
  const byStream = Object.fromEntries(rows.map((r) => [r.stream, r]))
  const lines = [...DETAIL_STREAMS, 'token']
    .filter((s) => byStream[s])
    .map((s) => {
      const r = byStream[s]
      // An analytics stream waiting for its API scope isn't a problem, so it only says so.
      if (isWaitingForScope(r)) return `${streamLabel(s)}: ${TIKTOK_HINTS.syncWaiting}`
      return [
        `${streamLabel(s)}: ${r.last_status || 'not run yet'}`,
        `last success ${r.last_success_at ? formatDateTime(r.last_success_at) : 'never'}`,
        r.next_retry_at && Date.parse(r.next_retry_at) > Date.now() ? retryMessage(r) : null,
      ]
        .filter(Boolean)
        .join(' · ')
    })
  const errors = [...DETAIL_STREAMS, 'token']
    .filter((s) => byStream[s]?.last_error && !isWaitingForScope(byStream[s]))
    .map((s) => `${streamLabel(s)}: ${shortError(byStream[s].last_error)}`)
  const until = byStream.token?.access_token_expires_at
  const connection = until ? TIKTOK_HINTS.syncConnectionUntil.replace('{date}', formatDate(until)) : null
  return [headline, '', ...lines, ...(errors.length ? ['', ...errors] : []), ...(connection ? ['', connection] : [])].join(
    '\n',
  )
}

/** Header indicator ("Synced 34 min ago", with a short warning when something's wrong) and Refresh. */
export function SyncStatus({ sync, onRefresh, refreshing }) {
  const { rows, summary, statusError } = sync

  let text
  let tip
  let warn = false
  if (statusError) {
    text = 'Sync status unavailable'
    tip = statusError
    warn = true
  } else if (!summary) {
    text = 'Checking sync…'
    tip = ''
  } else {
    const d = describe(summary)
    text = d.text
    tip = details(rows, d.headline)
    warn = d.warn
  }

  return (
    <div className="syncstatus">
      <Tooltip text={tip} width={420}>
        <span className={`syncstatus__text${warn ? ' syncstatus__text--warn' : ''}`}>
          {warn && <AlertTriangle size={14} />}
          {text}
        </span>
      </Tooltip>
      <Tooltip text={TIKTOK_HINTS.refresh}>
        <button
          type="button"
          className="icon-btn"
          aria-label="Refresh"
          disabled={refreshing}
          onClick={onRefresh}
        >
          <RotateCw size={15} className={refreshing ? 'spin' : undefined} />
        </button>
      </Tooltip>
    </div>
  )
}
