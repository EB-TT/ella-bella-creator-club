import { useState } from 'react'
import { JOURNEY_STAGES, RETIRED_STAGES, stageShort, TIERS } from '../lib/journey'
import { TIKTOK_HINTS } from '../lib/tiktok'
import { JourneyCell } from './Pill'
import { FieldLabel } from './SyncMarker'

/* The merged Journey field (JOURNEY_MERGED in lib/fields.js). One dropdown over
   the two stored columns:
     - choosing a tier sets creator_tier and leaves stage alone;
     - choosing a stage sets stage and clears creator_tier, a deliberate move
       back down, so it asks first when that would remove a tier.
   `value` is the draft (what is being edited); `shown` is the draft with the
   saved suggestion on it, for the pills. */
export function JourneyInput({ field, value, shown, onChange }) {
  const [pending, setPending] = useState(null)
  const current = value.creator_tier || value.stage

  // The retired stages are listed only while the creator is on one.
  const stages = [...JOURNEY_STAGES, ...RETIRED_STAGES.filter((s) => s === value.stage)]

  function choose(next) {
    if (TIERS.includes(next)) {
      setPending(null)
      onChange({ creator_tier: next })
    } else if (value.creator_tier) {
      setPending(next)
    } else {
      onChange({ stage: next })
    }
  }

  return (
    <div className="field--full">
      <FieldLabel field={field} htmlFor={field.key} />
      <select
        id={field.key}
        className="select"
        value={current || ''}
        onChange={(e) => choose(e.target.value)}
      >
        {stages.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
        <option disabled>──────────</option>
        {TIERS.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>

      {pending && (
        <div className="journey-confirm" role="alert">
          <span>
            Move back to {stageShort(pending)}? {TIKTOK_HINTS.journeyClearsTier}
          </span>
          <button
            type="button"
            className="btn btn--primary btn--sm"
            onClick={() => {
              onChange({ stage: pending, creator_tier: null })
              setPending(null)
            }}
          >
            Move back
          </button>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setPending(null)}>
            Cancel
          </button>
        </div>
      )}

      <div className="journey-now">
        <JourneyCell creator={shown} />
      </div>
    </div>
  )
}
