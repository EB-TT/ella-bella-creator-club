import { Info, RefreshCw } from 'lucide-react'
import { formatDateTime } from '../lib/format'
import { TIKTOK_HINTS } from '../lib/tiktok'
import { Tooltip } from './Tooltip'

/** Small info icon whose tooltip carries a definition. Nothing without text. */
export function InfoTip({ text, width }) {
  if (!text) return null
  return (
    <Tooltip text={text} width={width}>
      <span className="info-tip" aria-label="What is this?">
        <Info size={12} />
      </span>
    </Tooltip>
  )
}

/** "Synced from TikTok" marker. Its tooltip gives the last sync time and the field's definition. */
export function SyncMarker({ syncedAt, fieldKey }) {
  const text = [
    `Synced from TikTok · last synced ${syncedAt ? formatDateTime(syncedAt) : 'not yet'}`,
    TIKTOK_HINTS[fieldKey],
  ]
    .filter(Boolean)
    .join('\n\n')
  return (
    <Tooltip text={text}>
      <span className="sync-mark">
        <RefreshCw size={10} /> Synced from TikTok
      </span>
    </Tooltip>
  )
}

/** A field's label with its definition tooltip and, when TikTok has filled it, the marker. */
export function FieldLabel({ field, htmlFor, synced = false, syncedAt, allTime = false }) {
  const Tag = htmlFor ? 'label' : 'span'
  return (
    <div className="label-row">
      <Tag className="label" htmlFor={htmlFor}>
        {field.label}
        {allTime && (
          <Tooltip text={TIKTOK_HINTS.allTime}>
            <span className="label-sub"> · All time</span>
          </Tooltip>
        )}
      </Tag>
      <InfoTip text={TIKTOK_HINTS[field.key]} />
      {synced && <SyncMarker syncedAt={syncedAt} fieldKey={field.key} />}
    </div>
  )
}
