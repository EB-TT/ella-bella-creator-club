import { AlertTriangle, RefreshCw, RotateCw } from 'lucide-react'
import { formatDateTime } from '../lib/format'
import { relativeTime, retryMessage, SYNC_STREAMS, TIKTOK_HINTS } from '../lib/tiktok'
import { Tooltip } from './Tooltip'

/** Tooltip body: each stream's status, last success and error. */
function details(rows, summary) {
  const byStream = Object.fromEntries(rows.map((r) => [r.stream, r]))
  const lines = [...SYNC_STREAMS, 'token']
    .filter((s) => byStream[s])
    .map((s) => {
      const r = byStream[s]
      return [
        `${s}: ${r.last_status || 'not run yet'}`,
        `last success ${r.last_success_at ? formatDateTime(r.last_success_at) : 'never'}`,
        r.last_error ? `error: ${r.last_error}` : null,
        r.next_retry_at && Date.parse(r.next_retry_at) > Date.now()
          ? `${retryMessage(r)} (${r.consecutive_failures} failure${r.consecutive_failures === 1 ? '' : 's'} in a row)`
          : null,
      ]
        .filter(Boolean)
        .join(' · ')
    })
  const token = byStream.token
  if (token?.access_token_expires_at) {
    lines.push(
      `Access token ${summary.expired ? 'expired' : 'expires'} ${formatDateTime(token.access_token_expires_at)}`
    )
  }
  const head = summary.stale ? [TIKTOK_HINTS.syncStale, ''] : []
  return ['TikTok sync status', ...head, ...lines].join('\n')
}

/** Toolbar indicator ("TikTok synced 5 minutes ago", with a warning when something's wrong), Refresh and Sync now. */
export function SyncStatus({ sync, onRefresh, refreshing }) {
  const { rows, summary, statusError, syncing, syncNow, notice } = sync

  // Visible text, most urgent first. The tooltip lists everything.
  const retrying = summary?.retrying ?? []
  const text = statusError
    ? 'TikTok sync status unavailable'
    : !summary
      ? 'Checking TikTok sync…'
      : summary.stale
        ? TIKTOK_HINTS.syncStale
        : retrying.length
          ? retryMessage(retrying[0]) + (retrying.length > 1 ? ` (+${retrying.length - 1} more)` : '')
          : summary.lastSuccess
            ? `TikTok synced ${relativeTime(summary.lastSuccess)}`
            : 'TikTok not synced yet'

  const tip = statusError ? statusError : summary ? details(rows, summary) : 'Loading sync status…'
  const warn = Boolean(statusError) || summary?.warning

  return (
    <div className="syncstatus">
      <Tooltip text={tip} width={420}>
        <span className={`syncstatus__text${warn ? ' syncstatus__text--warn' : ''}`}>
          {warn && <AlertTriangle size={14} />}
          {text}
        </span>
      </Tooltip>
      {notice && (
        <span className={`syncstatus__notice syncstatus__notice--${notice.tone}`} role="status">
          {notice.text}
        </span>
      )}
      <Tooltip text={TIKTOK_HINTS.refresh} width={300}>
        <button type="button" className="btn btn--outline" disabled={refreshing} onClick={onRefresh}>
          <RotateCw size={14} className={refreshing ? 'spin' : undefined} /> {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </Tooltip>
      <button
        type="button"
        className="btn btn--outline"
        disabled={syncing}
        onClick={syncNow}
        title="Ask TikTok for the latest data now"
      >
        <RefreshCw size={14} className={syncing ? 'spin' : undefined} /> {syncing ? 'Syncing…' : 'Sync now'}
      </button>
    </div>
  )
}
