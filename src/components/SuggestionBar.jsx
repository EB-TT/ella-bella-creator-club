import { Lightbulb } from 'lucide-react'
import { stageShort } from '../lib/fields'
import { splitReason, TIKTOK_HINTS } from '../lib/tiktok'
import { InfoTip } from './SyncMarker'

/* "Suggested: <value> – <reason>" with Accept and Dismiss, one bar per
   suggestion. The drawer does the saving. */

function Bar({ kind, value, reason, busy, onAccept, onDismiss }) {
  return (
    <div className="suggestion">
      <Lightbulb size={14} className="suggestion__icon" />
      <span className="suggestion__text">
        <strong>Suggested {kind}: {kind === 'stage' ? stageShort(value) : value}</strong>
        {reason ? ` – ${reason}` : ''}
      </span>
      <InfoTip text={TIKTOK_HINTS.suggested} />
      <button type="button" className="btn btn--primary btn--sm" disabled={busy} onClick={onAccept}>
        Accept
      </button>
      <button type="button" className="btn btn--outline btn--sm" disabled={busy} onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  )
}

export function SuggestionBars({ creator, busy, onAccept, onDismiss }) {
  const reasons = splitReason(creator)
  return (
    <>
      {creator.suggested_stage && (
        <Bar
          kind="stage"
          value={creator.suggested_stage}
          reason={reasons.stage}
          busy={busy}
          onAccept={() => onAccept('stage')}
          onDismiss={() => onDismiss('stage')}
        />
      )}
      {creator.suggested_tier && (
        <Bar
          kind="tier"
          value={creator.suggested_tier}
          reason={reasons.tier}
          busy={busy}
          onAccept={() => onAccept('tier')}
          onDismiss={() => onDismiss('tier')}
        />
      )}
    </>
  )
}
