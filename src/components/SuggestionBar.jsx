import { Lightbulb } from 'lucide-react'
import { stageShort } from '../lib/fields'
import { journeySuggestion, splitReason, TIKTOK_HINTS } from '../lib/tiktok'
import { InfoTip } from './SyncMarker'
import { Tooltip } from './Tooltip'

/* "Suggested: <value> – <reason>" with Accept and Dismiss, one bar per
   suggestion. The drawer does the saving. */

function Bar({ kind, value, reason, hint, busy, merged = false, onAccept, onDismiss }) {
  return (
    <div className="suggestion">
      <Lightbulb size={14} className="suggestion__icon" />
      <span className="suggestion__text">
        <strong>Suggested {merged ? 'journey step' : kind}: {kind === 'stage' ? stageShort(value) : value}</strong>
        {reason ? ` – ${reason}` : ''}
      </span>
      <InfoTip text={hint} />
      <Tooltip text={TIKTOK_HINTS.accept}>
        <button type="button" className="btn btn--primary btn--sm" disabled={busy} onClick={onAccept}>
          Accept
        </button>
      </Tooltip>
      <Tooltip text={TIKTOK_HINTS.dismiss}>
        <button type="button" className="btn btn--outline btn--sm" disabled={busy} onClick={onDismiss}>
          Dismiss
        </button>
      </Tooltip>
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
          hint={TIKTOK_HINTS.suggestedStageBar}
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
          hint={TIKTOK_HINTS.suggestedTierBar}
          busy={busy}
          onAccept={() => onAccept('tier')}
          onDismiss={() => onDismiss('tier')}
        />
      )}
    </>
  )
}

/* The merged Journey suggestion (JOURNEY_MERGED): one bar for the higher of the
   suggested tier and stage. Accept applies it (a tier also applies a pending
   stage); Dismiss dismisses both. The drawer does the saving. */
export function JourneySuggestionBar({ creator, busy, onAccept, onDismiss }) {
  const suggestion = journeySuggestion(creator)
  if (!suggestion) return null
  return (
    <Bar
      kind={suggestion.kind === 'tier' ? 'tier' : 'stage'}
      value={suggestion.value}
      reason={suggestion.reason}
      hint={TIKTOK_HINTS.suggestedJourneyBar}
      merged
      busy={busy}
      onAccept={onAccept}
      onDismiss={onDismiss}
    />
  )
}
