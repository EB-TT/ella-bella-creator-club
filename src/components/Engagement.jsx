import { useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { useEngagement } from '../hooks/useEngagement'
import { formatDate, formatDayMonth } from '../lib/format'
import { TIKTOK_HINTS } from '../lib/tiktok'
import { InfoTip } from './SyncMarker'
import { Tooltip } from './Tooltip'

/* The drawer's engagement block: the creator's Ella Bella videos with Liked and
   Commented boxes (the team ticks them by hand; TikTok doesn't expose them), their
   LIVE sessions, and a form to log a like or comment on a video that isn't listed. */

const nf = new Intl.NumberFormat('en-US')
const SHORT_LIST = 10

function Heading({ children, hint }) {
  return (
    <div className="label-row">
      <span className="label">{children}</span>
      <InfoTip text={hint} />
    </div>
  )
}

function Tick({ label, hint, at, onChange }) {
  return (
    <div className="vid__check">
      <Tooltip text={hint}>
        <label className="check-row">
          <input
            type="checkbox"
            className="checkbox"
            checked={Boolean(at)}
            onChange={(e) => onChange(e.target.checked)}
          />
          {label}
        </label>
      </Tooltip>
      {at && <span className="vid__when">{`${label} ${formatDayMonth(at)}`}</span>}
    </div>
  )
}

function VideoRow({ video, onTick }) {
  const isLink = video.source === 'link'
  const products = (video.products || []).join(', ')
  const title = isLink ? video.url : video.title || products || 'Video'
  const meta = [
    isLink ? null : formatDate(video.posted_at),
    video.title ? products : null,
    video.views != null ? `${nf.format(video.views)} views` : null,
  ].filter(Boolean)
  return (
    <div className="vid">
      <div className="vid__main">
        <span className="vid__title" title={title}>
          {title}
        </span>
        <span className="vid__meta">
          {isLink && (
            <Tooltip text={TIKTOK_HINTS.videoLinkSource}>
              <span className="vid__tag">Link</span>
            </Tooltip>
          )}
          {isLink && meta.length > 0 ? ' · ' : ''}
          {meta.join(' · ')}
          {isLink && video.featured_ella_bella === false && (
            <span className="vid__tag">{meta.length ? ' · ' : ''}Doesn’t feature Ella Bella</span>
          )}
        </span>
      </div>
      <div className="vid__checks">
        {video.url && (
          <Tooltip text={TIKTOK_HINTS.videoOpen}>
            <a
              className="icon-btn"
              href={video.url}
              target="_blank"
              rel="noreferrer"
              aria-label={TIKTOK_HINTS.videoOpen}
            >
              <ExternalLink size={14} />
            </a>
          </Tooltip>
        )}
        <Tick label="Liked" hint={TIKTOK_HINTS.videoLiked} at={video.liked_at} onChange={(v) => onTick(video, 'liked', v)} />
        <Tick
          label="Commented"
          hint={TIKTOK_HINTS.videoCommented}
          at={video.commented_at}
          onChange={(v) => onTick(video, 'commented', v)}
        />
      </div>
    </div>
  )
}

function LinkForm({ onLog }) {
  const [url, setUrl] = useState('')
  const [liked, setLiked] = useState(false)
  const [commented, setCommented] = useState(false)
  const [featured, setFeatured] = useState(true)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState(null)

  async function submit(e) {
    e.preventDefault()
    const link = url.trim()
    let valid = false
    try {
      valid = /^https?:$/.test(new URL(link).protocol)
    } catch {
      /* not a URL */
    }
    if (!valid) return setProblem('Paste the full link, starting with https://')
    if (!liked && !commented) return setProblem('Tick Liked, Commented or both.')
    setProblem(null)
    setBusy(true)
    const ok = await onLog({ url: link, liked, commented, featured })
    setBusy(false)
    if (ok) {
      setUrl('')
      setLiked(false)
      setCommented(false)
      setFeatured(true)
    }
  }

  return (
    <form className="link-form" onSubmit={submit}>
      <Heading hint={TIKTOK_HINTS.logByLink}>Log engagement by link</Heading>
      <input
        className="input"
        type="url"
        placeholder="https://www.tiktok.com/@creator/video/…"
        aria-label="Video link"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
      />
      <div className="link-form__checks">
        <label className="check-row">
          <input type="checkbox" className="checkbox" checked={liked} onChange={(e) => setLiked(e.target.checked)} />
          Liked
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            className="checkbox"
            checked={commented}
            onChange={(e) => setCommented(e.target.checked)}
          />
          Commented
        </label>
        <Tooltip text={TIKTOK_HINTS.logFeatures}>
          <label className="check-row">
            <input
              type="checkbox"
              className="checkbox"
              checked={featured}
              onChange={(e) => setFeatured(e.target.checked)}
            />
            Features Ella Bella
          </label>
        </Tooltip>
        <button type="submit" className="btn btn--outline btn--sm" disabled={busy || !url.trim()}>
          {busy ? 'Saving…' : 'Log it'}
        </button>
      </div>
      {problem && <div className="alert">{problem}</div>}
    </form>
  )
}

/** `onEngaged` runs after a like or comment is saved (the drawer re-reads Last Engaged). */
export function Engagement({ creatorId, onEngaged }) {
  const { loading, videos, lives, error, writeError, setTick, logLink } = useEngagement(creatorId, onEngaged)
  const [allVideos, setAllVideos] = useState(false)
  const [allLives, setAllLives] = useState(false)

  const shownVideos = allVideos ? videos : videos.slice(0, SHORT_LIST)
  const shownLives = allLives ? lives : lives.slice(0, SHORT_LIST)

  return (
    <div className="engage">
      {error && <div className="alert">{error}</div>}
      {writeError && <div className="alert">{writeError}</div>}

      <div>
        <Heading hint={TIKTOK_HINTS.videosList}>Videos</Heading>
        {loading ? (
          <p className="cell-muted" style={{ fontSize: 12, margin: 0 }}>
            Loading videos…
          </p>
        ) : videos.length === 0 ? (
          !error && (
            <p className="cell-muted" style={{ fontSize: 12, margin: 0 }}>
              No Ella Bella videos found yet.
            </p>
          )
        ) : (
          <>
            {shownVideos.map((v) => (
              <VideoRow key={v.video_id ?? `link:${v.engagement_id}`} video={v} onTick={setTick} />
            ))}
            {videos.length > SHORT_LIST && (
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setAllVideos((v) => !v)}>
                {allVideos ? 'Show fewer' : `Show all ${videos.length}`}
              </button>
            )}
          </>
        )}
      </div>

      {lives.length > 0 && (
        <div>
          <Heading hint={TIKTOK_HINTS.livesList}>LIVE sessions</Heading>
          {shownLives.map((l) => (
            <div className="vid" key={l.live_id}>
              <div className="vid__main">
                <span className="vid__title">{formatDate(l.start_time)}</span>
              </div>
              <span className="vid__meta">{l.views != null ? `${nf.format(l.views)} views` : '—'}</span>
            </div>
          ))}
          {lives.length > SHORT_LIST && (
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setAllLives((v) => !v)}>
              {allLives ? 'Show fewer' : `Show all ${lives.length}`}
            </button>
          )}
        </div>
      )}

      <LinkForm onLog={logLink} />
    </div>
  )
}
