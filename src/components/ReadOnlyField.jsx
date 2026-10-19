import { Check } from 'lucide-react'
import { sortVideos } from '../lib/fields'
import { formatCell, formatDate } from '../lib/format'
import { TIKTOK_HINTS, videoProducts } from '../lib/tiktok'
import { FieldLabel } from './SyncMarker'
import { Tooltip } from './Tooltip'

/* A TikTok-owned field: displayed in the drawer, never editable. `synced` adds
   the "Synced from TikTok" marker. It's false for a creator TikTok has no data
   on (e.g. Last sale or Other Videos before their first sale): no marker, and
   the label tooltip says the field is filled automatically. */

export function ReadOnlyField({ field, value, synced = false, syncedAt, allTime = false }) {
  const label = <FieldLabel field={field} synced={synced} syncedAt={syncedAt} allTime={allTime} tiktokOwned />

  if (field.type === 'videos') {
    const videos = sortVideos(value)
    return (
      <div className="field--full">
        {label}
        {videos.length === 0 ? (
          <p className="cell-muted" style={{ fontSize: 12, margin: 0 }}>
            None recorded.
          </p>
        ) : (
          videos.map((v, i) => {
            const text = [v.date ? formatDate(v.date) : null, videoProducts(v).join(', ') || 'Video']
              .filter(Boolean)
              .join(' · ')
            return (
              <div className="product-entry" key={i}>
                <span className="product-entry__name">
                  {v.url ? (
                    <a href={v.url} target="_blank" rel="noreferrer">
                      {text}
                    </a>
                  ) : (
                    text
                  )}
                </span>
              </div>
            )
          })
        )}
      </div>
    )
  }

  if (field.type === 'bool') {
    return (
      <div>
        {label}
        <div className="check-row">
          {value ? (
            <Tooltip text={TIKTOK_HINTS[field.key]}>
              <span className="cell-check">
                <Check size={16} className="tick" /> {field.checkLabel || 'Yes'}
              </span>
            </Tooltip>
          ) : (
            <span className="cell-muted">—</span>
          )}
        </div>
      </div>
    )
  }

  if (field.type === 'url') {
    return (
      <div className="field--full">
        {label}
        {value ? (
          <a href={value} target="_blank" rel="noreferrer">
            {value}
          </a>
        ) : (
          <span className="cell-muted">—</span>
        )}
      </div>
    )
  }

  return (
    <div>
      {label}
      <div>{formatCell(field, value)}</div>
    </div>
  )
}
