import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { formatDate, formatDateTime } from '../lib/format'
import { sampleStatus, TIKTOK_HINTS } from '../lib/tiktok'
import { InfoTip } from './SyncMarker'
import { Tooltip } from './Tooltip'

/* Read-only TikTok panel for the drawer. Loaded lazily, per creator, through
   creator_tiktok_info (the TikTok tables themselves are not readable). */

const nf = new Intl.NumberFormat('en-US')

function Heading({ children, hint }) {
  return (
    <div className="label-row">
      <span className="label">{children}</span>
      <InfoTip text={hint} />
    </div>
  )
}

function money(amount, currency) {
  if (amount == null) return '—'
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: 0,
    }).format(Number(amount))
  } catch {
    return `${nf.format(Number(amount))} ${currency || ''}`.trim()
  }
}

function Stat({ label, hint, children }) {
  return (
    <div>
      <div className="label-row">
        <span className="label">{label}</span>
        <InfoTip text={hint} />
      </div>
      <div>{children}</div>
    </div>
  )
}

const dateOrDash = (v) => (v ? formatDate(v) : '—')

export function TikTokSection({ creator }) {
  const linked = Boolean(creator.tiktok_creator_id)
  const [state, setState] = useState({ loading: false, info: null, error: null })

  useEffect(() => {
    if (!creator.id || !linked) {
      setState({ loading: false, info: null, error: null })
      return
    }
    let stale = false
    setState({ loading: true, info: null, error: null })
    supabase.rpc('creator_tiktok_info', { p_creator_id: creator.id }).then(({ data, error }) => {
      if (stale) return
      setState(
        error
          ? { loading: false, info: null, error: error.message }
          : { loading: false, info: data, error: null }
      )
    })
    return () => {
      stale = true
    }
  }, [creator.id, linked])

  if (!creator.id) return null

  const { loading, info, error } = state
  const notLinked = !linked || (info && info.linked === false)

  return (
    <section>
      <div className="label-row" style={{ marginBottom: 'var(--sp-3)' }}>
        <h3 className="section-title" style={{ margin: 0 }}>
          TikTok
        </h3>
        <InfoTip text={TIKTOK_HINTS.tiktokSection} />
      </div>

      {notLinked ? (
        <p className="cell-muted" style={{ fontSize: 12, margin: 0 }}>
          Not linked to TikTok – set their TikTok handle to link them.
        </p>
      ) : error ? (
        <div className="alert">{error}</div>
      ) : loading || !info ? (
        <p className="cell-muted" style={{ fontSize: 12, margin: 0 }}>
          Loading TikTok data…
        </p>
      ) : (
        <div className="tiktok-section">
          <div>
            <Heading hint={TIKTOK_HINTS.pendingSamples}>Pending sample requests</Heading>
            {info.pending_samples?.length ? (
              info.pending_samples.map((s, i) => (
                <div className="product-entry" key={i}>
                  <span className="product-entry__name">{s.product || 'Unknown product'}</span>
                  <span className="product-entry__date">{sampleStatus(s.status)}</span>
                  <span className="product-entry__date">Requested {dateOrDash(s.requested_at)}</span>
                </div>
              ))
            ) : (
              <p className="cell-muted" style={{ fontSize: 12, margin: 0 }}>
                None.
              </p>
            )}
          </div>

          <div>
            <Heading hint={TIKTOK_HINTS.recentSamples}>Recent samples</Heading>
            {info.samples?.length ? (
              info.samples.map((s, i) => (
                <div className="product-entry product-entry--wrap" key={i}>
                  <span className="product-entry__name">{s.product || 'Unknown product'}</span>
                  <span className="product-entry__date">{sampleStatus(s.status)}</span>
                  <span className="product-entry__dates">
                    Requested {dateOrDash(s.requested_at)} · Shipped {dateOrDash(s.shipped_at)} · Delivered{' '}
                    {dateOrDash(s.delivered_at)}
                  </span>
                </div>
              ))
            ) : (
              <p className="cell-muted" style={{ fontSize: 12, margin: 0 }}>
                None.
              </p>
            )}
          </div>

          <div>
            <Heading hint={TIKTOK_HINTS.targetCollabs}>Target collabs</Heading>
            {info.collabs?.length ? (
              info.collabs.map((c, i) => (
                <div className="product-entry product-entry--wrap" key={i}>
                  <span className="product-entry__name">{c.name || 'Target collab'}</span>
                  <span className="product-entry__date">Accepted {dateOrDash(c.accepted_at)}</span>
                  <span className="product-entry__dates">
                    {c.showcase_product_count ?? 0} in showcase · {c.content_product_count ?? 0} posted
                  </span>
                </div>
              ))
            ) : (
              <p className="cell-muted" style={{ fontSize: 12, margin: 0 }}>
                None.
              </p>
            )}
          </div>

          <div>
            <Heading hint={TIKTOK_HINTS.creatorStats}>TikTok stats across all shops</Heading>
            <div className="grid-2">
              <Stat label="Followers" hint={TIKTOK_HINTS.statFollowers}>
                {info.stats?.followers != null ? nf.format(info.stats.followers) : '—'}
              </Stat>
              <Stat label="30-day GMV" hint={TIKTOK_HINTS.statGmv30d}>
                {money(info.stats?.gmv_30d, info.stats?.gmv_30d_currency)}
              </Stat>
              <Stat label="Fulfilment rate" hint={TIKTOK_HINTS.statFulfilment}>
                {info.stats?.fulfilment_rate != null
                  ? `${Math.round(Number(info.stats.fulfilment_rate) * 10) / 10}%`
                  : '—'}
              </Stat>
              <Stat label="Median video views" hint={TIKTOK_HINTS.statViews}>
                {info.stats?.median_video_views != null ? nf.format(info.stats.median_video_views) : '—'}
              </Stat>
            </div>
            <Tooltip text={TIKTOK_HINTS.statsAsOf}>
              <span className="field-hint">
                Stats as of {dateOrDash(info.stats?.stats_at)}
                {info.tiktok_synced_at ? ` · last synced ${formatDateTime(info.tiktok_synced_at)}` : ''}
              </span>
            </Tooltip>
          </div>
        </div>
      )}
    </section>
  )
}
