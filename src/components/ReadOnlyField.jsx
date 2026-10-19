import { sortVideos } from '../lib/fields'
import { formatCell, formatDate } from '../lib/format'

/* A TikTok-owned field: displayed in the drawer, never editable. Reuses the
   product-entry rows from Other Products Received for the video list. */

export function ReadOnlyField({ field, value }) {
  if (field.type === 'videos') {
    const videos = sortVideos(value)
    return (
      <div className="field--full">
        <span className="label">{field.label}</span>
        {videos.length === 0 ? (
          <p className="cell-muted" style={{ fontSize: 12, margin: 0 }}>
            None recorded.
          </p>
        ) : (
          videos.map((v, i) => (
            <div className="product-entry" key={i}>
              <span className="product-entry__name">
                {v.url ? (
                  <a href={v.url} target="_blank" rel="noreferrer">
                    {v.product || 'Video'}
                  </a>
                ) : (
                  v.product
                )}
              </span>
              <span className="product-entry__date">{formatDate(v.date)}</span>
            </div>
          ))
        )}
        {field.hint && <span className="field-hint">{field.hint}</span>}
      </div>
    )
  }

  return (
    <div>
      <span className="label">{field.label}</span>
      <div>{formatCell(field, value)}</div>
      {field.hint && <span className="field-hint">{field.hint}</span>}
    </div>
  )
}
