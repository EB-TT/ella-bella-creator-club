import { Info, RefreshCw } from 'lucide-react'
import { formatDateTime } from '../lib/format'
import { SYNCED_EDITABLE, TIKTOK_HINTS } from '../lib/tiktok'
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

/** "Synced from TikTok" marker. Its tooltip says the field comes from TikTok, whether it can be
    edited, and when it was last synced. */
export function SyncMarker({ syncedAt, fieldKey }) {
  const text = [
    SYNCED_EDITABLE.has(fieldKey) ? TIKTOK_HINTS.syncedEditable : TIKTOK_HINTS.syncedLocked,
    syncedAt ? TIKTOK_HINTS.syncedAt.replace('{time}', formatDateTime(syncedAt)) : null,
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <Tooltip text={text}>
      <span className="sync-mark">
        <RefreshCw size={10} /> Synced from TikTok
      </span>
    </Tooltip>
  )
}

/** A field's label with its definition tooltip and, when TikTok has filled it, the marker. */
export function FieldLabel({ field, htmlFor, synced = false, syncedAt, allTime = false, tiktokOwned = false }) {
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
      <InfoTip text={tiktokOwned && !synced ? TIKTOK_HINTS.filledFromTiktok : TIKTOK_HINTS[field.key]} />
      {synced && <SyncMarker syncedAt={syncedAt} fieldKey={field.key} />}
    </div>
  )
}
