import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, ChevronsUpDown, Loader2, RotateCcw } from 'lucide-react'
import { formatDate, formatDateTime } from '../lib/format'
import {
  BENCHMARK_TEXT,
  SUGGESTED_CPM_HIGH,
  SUGGESTED_CPM_LOW,
  calcCpm,
  cpmRag,
  engagementRag,
  ragLabel,
  tarRag,
} from '../lib/valuationBenchmarks'
import {
  DASH,
  formatCompact,
  formatCpm,
  formatDuration,
  formatInt,
  formatPct,
  formatRateRange,
  profileUrl,
} from '../lib/valuationFormat'

const STALL_MS = 10 * 60 * 1000
const STATUS_ORDER = { pending: 0, running: 1, stalled: 2, failed: 3, complete: 4 }

const inProgress = (row) => row.status === 'pending' || row.status === 'running'
export const isStalled = (row, now) => inProgress(row) && now - new Date(row.requested_at).getTime() > STALL_MS
const quoted = (row) => (row.quoted_rate == null ? null : Number(row.quoted_rate))
const duration = (row) =>
  row.started_at && row.completed_at ? new Date(row.completed_at) - new Date(row.started_at) : null

const COLUMNS = [
  { key: 'handle', label: 'Handle', value: (r) => r.handle },
  { key: 'requested_at', label: 'Requested', value: (r) => r.requested_at },
  { key: 'status', label: 'Status', value: (r, now) => STATUS_ORDER[isStalled(r, now) ? 'stalled' : r.status] },
  { key: 'median_views', label: 'Median views', num: true, value: (r) => r.results?.median_views },
  { key: 'engagement', label: 'Engagement', num: true, value: (r) => r.results?.engagement_agg },
  { key: 'tar', label: 'TAR', num: true, value: (r) => r.results?.tar, hint: 'True action rate: (saves + shares + est. product-interest comments) ÷ views' },
  { key: 'suggested', label: 'Suggested rate', num: true, value: (r) => r.results?.suggested_rate_low, hint: `Median views at $${SUGGESTED_CPM_LOW}–$${SUGGESTED_CPM_HIGH} CPM` },
  { key: 'quoted_rate', label: 'Quoted rate', num: true, value: quoted },
  { key: 'cpm', label: 'CPM', num: true, value: (r) => calcCpm(r.quoted_rate, r.results?.median_views), hint: 'Quoted rate ÷ median views × 1,000' },
  { key: 'duration', label: 'Duration', num: true, value: duration },
  { key: 'credits_used', label: 'Credits', num: true, value: (r) => r.credits_used },
]

/** Empty values always sort last, both directions — same rule as the creators table. */
function sortRows(rows, column, direction, now) {
  const dir = direction === 'desc' ? -1 : 1
  return [...rows].sort((a, b) => {
    const av = column.value(a, now) ?? null
    const bv = column.value(b, now) ?? null
    if (av === null && bv === null) return 0
    if (av === null) return 1
    if (bv === null) return -1
    const x = typeof av === 'string' ? av.toLowerCase() : av
    const y = typeof bv === 'string' ? bv.toLowerCase() : bv
    if (x < y) return -1 * dir
    if (x > y) return 1 * dir
    return 0
  })
}

function SortIcon({ state }) {
  if (state === 'asc') return <ArrowUp size={12} />
  if (state === 'desc') return <ArrowDown size={12} />
  return <ChevronsUpDown size={12} />
}

function RagPill({ rag, benchmark, children }) {
  if (!rag) return <span className="cell-muted">{children}</span>
  return (
    <span className={`pill pill--${rag}`} title={`${ragLabel(rag)} · ${benchmark}`}>
      {children}
    </span>
  )
}

function Waiting() {
  return <span className="vskeleton" aria-label="Waiting for results" />
}

function StatusCell({ row, stalled, retrying, onRetry }) {
  if (stalled) {
    return (
      <span className="vstatus">
        <span className="pill pill--amber" title={`No result after 10 minutes (still ${row.status})`}>
          Stalled
        </span>
        <button
          type="button"
          className="btn btn--outline vbtn-sm"
          disabled={retrying}
          onClick={(e) => {
            e.stopPropagation()
            onRetry(row)
          }}
        >
          <RotateCcw size={12} /> {retrying ? 'Retrying…' : 'Retry'}
        </button>
      </span>
    )
  }
  if (row.status === 'pending') return <span className="pill pill--neutral">Pending</span>
  if (row.status === 'running')
    return (
      <span className="pill pill--accent">
        <Loader2 size={11} className="vspin" /> Running
      </span>
    )
  if (row.status === 'failed')
    return (
      <span className="pill pill--red vstatus--failed" title={row.error || 'Failed'}>
        Failed
      </span>
    )
  return <span className="pill pill--green">Complete</span>
}

function QuotedRateInput({ row, onSave }) {
  const initial = row.quoted_rate == null ? '' : String(row.quoted_rate)
  const [value, setValue] = useState(initial)
  const [error, setError] = useState(null)
  const cancelled = useRef(false)

  // Keep in step with edits arriving over Realtime.
  useEffect(() => setValue(initial), [initial])

  async function commit() {
    if (cancelled.current) {
      cancelled.current = false
      return
    }
    const v = value.trim()
    const next = v === '' ? null : Math.round(Number(v) * 100) / 100
    if (next !== null && !(Number.isFinite(next) && next >= 0)) {
      setError('Enter a positive amount')
      setValue(initial)
      return
    }
    if (next === quoted(row)) return
    try {
      setError(null)
      await onSave(row.id, next)
    } catch (err) {
      setError(err.message || 'Could not save')
      setValue(initial)
    }
  }

  return (
    <input
      className={`input vrate${error ? ' vrate--error' : ''}`}
      type="number"
      min="0"
      step="0.01"
      inputMode="decimal"
      placeholder="$"
      aria-label={`Quoted rate for @${row.handle}`}
      title={error || 'Enter to save, Esc to cancel'}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          e.currentTarget.blur()
        } else if (e.key === 'Escape') {
          cancelled.current = true
          setValue(initial)
          e.currentTarget.blur()
        }
      }}
      onBlur={commit}
    />
  )
}

const EXCLUDED_LABEL = {
  under_7_days: 'under 7 days old',
  older_than_90_days: 'older than 90 days',
  no_views: 'no view count',
  unparseable_date: 'unparseable date',
}

function Stat({ label, children }) {
  return (
    <div className="vstat">
      <span className="label">{label}</span>
      <div className="vstat__value">{children}</div>
    </div>
  )
}

function ValuationDetail({ row }) {
  const r = row.results
  const excluded = Object.entries(r.excluded || {}).filter(([, n]) => n > 0)
  const posts = r.posts || []
  const flagged = r.flagged_comments || []
  const postUrl = useMemo(() => new Map(posts.map((p) => [p.id, p.url])), [posts])

  return (
    <div className="vdetail">
      <div className="vdetail__stats">
        <Stat label="Posts">
          {formatInt(r.posts_counted)} counted of {formatInt(r.posts_fetched)} fetched
          <div className="cell-muted vstat__sub">
            {excluded.length
              ? `Excluded: ${excluded.map(([k, n]) => `${n} ${EXCLUDED_LABEL[k] || k.replace(/_/g, ' ')}`).join(', ')}`
              : 'None excluded'}
          </div>
        </Stat>
        <Stat label="Followers">{formatCompact(r.followers)}</Stat>
        <Stat label="Engagement">
          {formatPct(r.engagement_agg)} aggregate
          <div className="cell-muted vstat__sub">{formatPct(r.engagement_mean)} mean per post</div>
        </Stat>
        <Stat label="TAR">
          {r.tar == null ? DASH : `${formatPct(r.tar, 2)} over ${r.tar_posts} posts`}
        </Stat>
        <Stat label="Comments">
          {formatInt(r.comments_sampled)} sampled · {formatInt(r.comments_flagged)} flagged
          <div className="cell-muted vstat__sub">{formatInt(r.comments_unclassified)} unclassified</div>
        </Stat>
      </div>

      {r.window_truncated && (
        <div className="vnote">
          Only the most recent ~80 posts checked — this creator posts a lot, so the 90-day window was cut short.
        </div>
      )}

      <div>
        <h3 className="section-title">Posts counted</h3>
        {posts.length ? (
          <div className="table-wrap vdetail__posts">
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Post</th>
                  <th className="cell-num">Views</th>
                  <th className="cell-num">Likes</th>
                  <th className="cell-num">Comments</th>
                  <th className="cell-num">Shares</th>
                  <th className="cell-num">Saves</th>
                  <th className="cell-num">Engagement</th>
                  <th className="cell-num">TAR</th>
                </tr>
              </thead>
              <tbody>
                {posts.map((p) => (
                  <tr key={p.id}>
                    <td className="num">{formatDate(p.posted_at)}</td>
                    <td>
                      <a href={p.url} target="_blank" rel="noreferrer">
                        Open
                      </a>
                    </td>
                    <td className="cell-num">{formatCompact(p.views)}</td>
                    <td className="cell-num">{formatCompact(p.likes)}</td>
                    <td className="cell-num">{formatCompact(p.comments)}</td>
                    <td className="cell-num">{formatCompact(p.shares)}</td>
                    <td className="cell-num">{formatCompact(p.saves)}</td>
                    <td className="cell-num">{formatPct(p.engagement)}</td>
                    <td className="cell-num">
                      {p.tar == null ? <span className="cell-muted">{DASH}</span> : formatPct(p.tar, 2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="cell-muted">No posts in the 7–90 day window.</p>
        )}
      </div>

      <div>
        <h3 className="section-title">Comments flagged as product interest</h3>
        {flagged.length ? (
          <ul className="vcomments">
            {flagged.map((c, i) => (
              <li key={`${c.post_id}-${i}`} className="vcomments__item">
                <span className="vcomments__text">{c.text}</span>
                <span className="vcomments__meta">
                  {formatInt(c.likes)} likes ·{' '}
                  {postUrl.get(c.post_id) ? (
                    <a href={postUrl.get(c.post_id)} target="_blank" rel="noreferrer">
                      post
                    </a>
                  ) : (
                    'post'
                  )}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="cell-muted">None.</p>
        )}
        {r.comments_flagged > flagged.length && (
          <p className="cell-muted vstat__sub">
            Showing the top {flagged.length} of {r.comments_flagged} by likes.
          </p>
        )}
      </div>

      <p className="vdetail__meta">
        Classifier {r.classifier_model} · prompt {r.prompt_hash}
      </p>
    </div>
  )
}

export function ValuationTable({ rows, now, highlightId, retryingId, onRetry, onSetRate }) {
  const [sort, setSort] = useState({ key: 'requested_at', direction: 'desc' })
  const [expandedId, setExpandedId] = useState(null)
  const rowRefs = useRef(new Map())

  const sorted = useMemo(
    () => sortRows(rows, COLUMNS.find((c) => c.key === sort.key), sort.direction, now),
    [rows, sort, now]
  )

  useEffect(() => {
    if (highlightId) rowRefs.current.get(highlightId)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [highlightId])

  function onSort(key) {
    setSort((s) =>
      s.key === key ? { key, direction: s.direction === 'asc' ? 'desc' : 'asc' } : { key, direction: 'asc' }
    )
  }

  if (!rows.length) return <div className="card empty">No valuations yet — enter a handle above.</div>

  return (
    <div className="card table-wrap">
      <table className="table vtable">
        <thead>
          <tr>
            {COLUMNS.map((c) => {
              const state = sort.key === c.key ? sort.direction : null
              return (
                <th
                  key={c.key}
                  title={c.hint}
                  className="sortable"
                  onClick={() => onSort(c.key)}
                  aria-sort={state === 'asc' ? 'ascending' : state === 'desc' ? 'descending' : 'none'}
                >
                  <span className={`th-inner${state ? ' th-inner--active' : ''}`}>
                    {c.label}
                    <SortIcon state={state} />
                  </span>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const r = row.results
            const done = row.status === 'complete' && r
            const stalled = isStalled(row, now)
            const waiting = inProgress(row) && !stalled
            const expanded = done && expandedId === row.id
            const cpm = done ? calcCpm(row.quoted_rate, r.median_views) : null
            const metric = (content) => (waiting ? <Waiting /> : done ? content : <span className="cell-muted">{DASH}</span>)
            const toggle = () => done && setExpandedId(expanded ? null : row.id)

            return (
              <Fragment key={row.id}>
                <tr
                  ref={(el) => (el ? rowRefs.current.set(row.id, el) : rowRefs.current.delete(row.id))}
                  className={[
                    done ? 'vrow--expandable' : 'vrow--static',
                    highlightId === row.id ? 'vrow--highlight' : '',
                    expanded ? 'vrow--expanded' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={toggle}
                >
                  <td className="cell-name">
                    <span className="vhandle">
                      {done ? (
                        <button
                          type="button"
                          className="vexpand"
                          aria-expanded={expanded}
                          aria-label={`${expanded ? 'Hide' : 'Show'} details for @${row.handle}`}
                          onClick={(e) => {
                            e.stopPropagation()
                            toggle()
                          }}
                        >
                          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </button>
                      ) : (
                        <span className="vexpand vexpand--blank" />
                      )}
                      <a
                        href={profileUrl(row.platform, row.handle)}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                      >
                        @{row.handle}
                      </a>
                    </span>
                  </td>
                  <td>
                    <span className="num">{formatDateTime(row.requested_at)}</span>
                    <div className="cell-muted vstat__sub">{row.requested_by_name || DASH}</div>
                  </td>
                  <td>
                    <StatusCell row={row} stalled={stalled} retrying={retryingId === row.id} onRetry={onRetry} />
                  </td>
                  <td className="cell-num">{metric(formatCompact(r?.median_views))}</td>
                  <td className="cell-num">
                    {metric(
                      <RagPill rag={engagementRag(r?.engagement_agg)} benchmark={BENCHMARK_TEXT.engagement}>
                        {formatPct(r?.engagement_agg)}
                      </RagPill>
                    )}
                  </td>
                  <td className="cell-num">
                    {metric(
                      r?.tar == null ? (
                        <span className="cell-muted" title="Comments weren't classified">
                          {DASH}
                        </span>
                      ) : (
                        <RagPill rag={tarRag(r.tar)} benchmark={BENCHMARK_TEXT.tar}>
                          {formatPct(r.tar, 2)}
                        </RagPill>
                      )
                    )}
                  </td>
                  <td className="cell-num">{metric(formatRateRange(r?.suggested_rate_low, r?.suggested_rate_high))}</td>
                  <td className="cell-num">
                    <QuotedRateInput row={row} onSave={onSetRate} />
                  </td>
                  <td className="cell-num">
                    {metric(
                      cpm == null ? (
                        <span className="cell-muted">{DASH}</span>
                      ) : (
                        <RagPill rag={cpmRag(cpm)} benchmark={BENCHMARK_TEXT.cpm}>
                          {formatCpm(cpm)}
                        </RagPill>
                      )
                    )}
                  </td>
                  <td className="cell-num">
                    {waiting ? <Waiting /> : <span className="cell-muted">{formatDuration(row.started_at, row.completed_at)}</span>}
                  </td>
                  <td className="cell-num">
                    {waiting ? <Waiting /> : <span className="cell-muted">{formatInt(row.credits_used)}</span>}
                  </td>
                </tr>
                {expanded && (
                  <tr className="vrow-detail">
                    <td colSpan={COLUMNS.length}>
                      <ValuationDetail row={row} />
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
