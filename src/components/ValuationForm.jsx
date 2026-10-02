import { useId, useMemo, useState } from 'react'
import { Gauge } from 'lucide-react'
import { formatDate } from '../lib/format'
import { daysAgo, normaliseHandle } from '../lib/valuationFormat'

const RECENT_DAYS = 14
const MAX_SUGGESTIONS = 8
const PLATFORMS = [
  { value: 'tiktok', label: 'TikTok' },
  { value: 'instagram', label: 'Instagram' },
]

/** '' → null; otherwise a non-negative amount rounded to cents, or NaN if invalid. */
function parseRate(raw) {
  const v = raw.trim()
  if (v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : NaN
}

function daysLabel(days) {
  if (days <= 0) return 'today'
  return `${days} day${days === 1 ? '' : 's'} ago`
}

export function ValuationForm({ rows, authorName, onRequest, onView, onSetRate }) {
  const listId = useId()
  const [platform, setPlatform] = useState('tiktok')
  const [handle, setHandle] = useState('')
  const [rate, setRate] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [recent, setRecent] = useState(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)

  // Handles valued before on this platform, most recent first. Built from rows
  // already loaded for the table, so typing never queries anything. Removed rows don't count.
  const history = useMemo(() => {
    const last = new Map()
    for (const r of rows) {
      if (r.platform !== platform || r.removed_at) continue
      const at = r.completed_at || r.requested_at
      if (!last.has(r.handle) || at > last.get(r.handle)) last.set(r.handle, at)
    }
    return [...last].map(([h, at]) => ({ handle: h, at })).sort((a, b) => (a.at < b.at ? 1 : -1))
  }, [rows, platform])

  const typed = normaliseHandle(handle)
  const suggestions = useMemo(
    () => history.filter((s) => s.handle.includes(typed)).slice(0, MAX_SUGGESTIONS),
    [history, typed]
  )
  const showList = open && suggestions.length > 0

  function choose(s) {
    setHandle(s.handle)
    setRecent(null)
    setOpen(false)
    setActive(-1)
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setActive((i) => Math.min(i + 1, suggestions.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, -1))
    } else if (e.key === 'Enter' && showList && active >= 0) {
      e.preventDefault()
      choose(suggestions[active])
    } else if (e.key === 'Escape' && showList) {
      e.preventDefault()
      setOpen(false)
      setActive(-1)
    }
  }

  function reset() {
    setHandle('')
    setRate('')
    setRecent(null)
  }

  async function submit(e, { force = false } = {}) {
    e?.preventDefault()
    setError(null)
    setNotice(null)
    setOpen(false)

    const h = normaliseHandle(handle)
    const quotedRate = parseRate(rate)
    if (!h) return setError('Enter a handle.')
    if (h.length > 100) return setError('That handle is too long.')
    if (Number.isNaN(quotedRate)) return setError('Quoted rate must be a positive amount.')

    if (!force) {
      const cutoff = new Date(Date.now() - RECENT_DAYS * 86_400_000).toISOString()
      const hit = rows
        .filter(
          (r) =>
            r.platform === platform &&
            !r.removed_at &&
            r.handle === h &&
            r.status === 'complete' &&
            (r.completed_at || r.requested_at) >= cutoff
        )
        .sort((a, b) => (a.requested_at < b.requested_at ? 1 : -1))[0]
      if (hit) {
        setRecent({ row: hit, days: daysAgo(hit.completed_at || hit.requested_at), quotedRate })
        return
      }
    }

    setBusy(true)
    try {
      const { invokeError } = await onRequest({
        platform,
        handle: h,
        quotedRate,
        requestedByName: authorName,
      })
      if (invokeError) setNotice(`Request saved, but the valuation didn't start: ${invokeError}`)
      reset()
    } catch (err) {
      setError(err.message || 'Could not save the request.')
    } finally {
      setBusy(false)
    }
  }

  async function viewRecent() {
    const { row, quotedRate } = recent
    onView(row.id)
    reset()
    if (quotedRate !== null && quotedRate !== (row.quoted_rate == null ? null : Number(row.quoted_rate))) {
      try {
        await onSetRate(row.id, quotedRate)
      } catch (err) {
        setError(err.message || 'Could not update the quoted rate.')
      }
    }
  }

  return (
    <form className="card vform" onSubmit={submit}>
      <div className="vform__fields">
        <div className="vform__field vform__field--handle">
          <label className="label" htmlFor={`${listId}-handle`}>
            Handle
          </label>
          <div className="vcombo">
            <input
              id={`${listId}-handle`}
              className="input"
              placeholder="@creator"
              autoComplete="off"
              spellCheck={false}
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={showList}
              aria-controls={`${listId}-list`}
              aria-activedescendant={showList && active >= 0 ? `${listId}-opt-${active}` : undefined}
              value={handle}
              onChange={(e) => {
                setHandle(e.target.value)
                setRecent(null)
                setOpen(true)
                setActive(-1)
              }}
              onFocus={() => setOpen(true)}
              onBlur={() => setOpen(false)}
              onKeyDown={onKeyDown}
            />
            {showList && (
              <ul className="vcombo__list" id={`${listId}-list`} role="listbox">
                {suggestions.map((s, i) => (
                  <li
                    key={s.handle}
                    id={`${listId}-opt-${i}`}
                    role="option"
                    aria-selected={i === active}
                    className={`vcombo__option${i === active ? ' vcombo__option--active' : ''}`}
                    // mousedown, not click, so the input's blur doesn't close the list first
                    onMouseDown={(e) => {
                      e.preventDefault()
                      choose(s)
                    }}
                    onMouseEnter={() => setActive(i)}
                  >
                    <span>@{s.handle}</span>
                    <span className="vcombo__date">{formatDate(s.at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="vform__field">
          <label className="label" htmlFor={`${listId}-platform`}>
            Platform
          </label>
          <select
            id={`${listId}-platform`}
            className="select"
            value={platform}
            onChange={(e) => {
              setPlatform(e.target.value)
              setRecent(null)
            }}
          >
            {PLATFORMS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        <div className="vform__field">
          <label className="label" htmlFor={`${listId}-rate`}>
            Quoted rate ($, optional)
          </label>
          <input
            id={`${listId}-rate`}
            className="input"
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            placeholder="e.g. 500"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
          />
        </div>

        <button type="submit" className="btn btn--primary vform__submit" disabled={busy}>
          <Gauge size={14} /> {busy ? 'Requesting…' : 'Value creator'}
        </button>
      </div>

      {recent && (
        <div className="vform__recent" role="status">
          <span>
            @{recent.row.handle} was valued {daysLabel(recent.days)}.
          </span>
          <button type="button" className="btn btn--outline" onClick={viewRecent}>
            View
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            disabled={busy}
            onClick={() => {
              setRecent(null)
              submit(null, { force: true })
            }}
          >
            Run again
          </button>
        </div>
      )}

      {error && <div className="alert vform__msg">{error}</div>}
      {notice && <div className="alert vform__msg">{notice}</div>}
    </form>
  )
}
