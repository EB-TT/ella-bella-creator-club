import { AlertTriangle, RefreshCw } from 'lucide-react'
import { formatDateTime } from '../lib/format'
import { relativeTime, SYNC_STREAMS } from '../lib/tiktok'
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
  return ['TikTok sync status', ...lines].join('\n')
}

/** Toolbar indicator ("TikTok synced 5 minutes ago", with a warning when something's wrong) and Sync now. */
export function SyncStatus({ sync }) {
  const { rows, summary, statusError, syncing, syncNow, notice } = sync

  const text = statusError
    ? 'TikTok sync status unavailable'
    : !summary
      ? 'Checking TikTok sync…'
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
