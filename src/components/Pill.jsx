import { Check, Lightbulb } from 'lucide-react'
import { STAGES, stageShort } from '../lib/fields'
import { journeySuggestion, TIKTOK_HINTS } from '../lib/tiktok'
import { Tooltip } from './Tooltip'

/* Tinted pill pattern: background --x-bg, colour --x, 1px border --x-border. */

/* Colour tracks journey phase: onboarding is neutral, the product → video
   stretch is amber (in progress), the first-sale milestone is green, and
   momentum onward is accent. */
const STAGE_TONE = {
  Joined: 'neutral',
  'Accepted (Target Collab Invite)': 'neutral',
  'First Product': 'amber',
  'Product Sent': 'amber',
  'First Video': 'amber',
  'Video Posted': 'amber',
  'First Sale': 'green',
  'First Sale Achieved': 'green',
  'Build Momentum': 'accent',
  'Consistent Creator': 'accent',
  'Tier Up': 'accent',
  'Top Performer': 'accent',
}

const TIER_TONE = { Bronze: 'amber', Silver: 'neutral', Gold: 'accent', Platinum: 'green' }

export function Pill({ tone = 'neutral', children }) {
  return <span className={`pill pill--${tone}`}>{children}</span>
}

export function StagePill({ stage }) {
  if (!stage) return <span className="cell-muted">—</span>
  const idx = STAGES.indexOf(stage)
  return (
    <Pill tone={STAGE_TONE[stage] || 'neutral'}>
      {idx >= 0 ? `${idx + 1}. ` : ''}
      {stageShort(stage)}
    </Pill>
  )
}

export function TierPill({ tier }) {
  if (!tier) return <span className="cell-muted">—</span>
  return <Pill tone={TIER_TONE[tier] || 'neutral'}>{tier}</Pill>
}

export function BoolPill({ value }) {
  return <Pill tone={value ? 'green' : 'neutral'}>{value ? 'Yes' : 'No'}</Pill>
}

/* ---------- Journey: stage, or tier once earned ---------- */

/** Accepted tier: a solid pill in the tier's own colour. */
export function JourneyTierPill({ tier }) {
  return <span className={`pill pill--tier pill--${tier.toLowerCase()}`}>{tier}</span>
}

/** The creator's place in the journey: the accepted tier if set, else the stage. */
export function JourneyPosition({ creator }) {
  if (creator.creator_tier) return <JourneyTierPill tier={creator.creator_tier} />
  return <StagePill stage={creator.stage} />
}

/** A suggestion: a dashed outline pill with a bulb. With `onAccept`, hovering
    (or focusing) it shows a small tick that accepts it. */
export function SuggestedPill({ suggestion, onAccept }) {
  const { kind, value } = suggestion
  const idx = STAGES.indexOf(value)
  const tone = kind === 'tier' ? ` pill--${value.toLowerCase()}` : ''
  return (
    <span className="jr-suggest">
      <Tooltip text={TIKTOK_HINTS.suggestedPill}>
        <span className={`pill pill--suggested${tone}`}>
          <Lightbulb size={11} />
          {kind === 'stage' && idx >= 0 ? `${idx + 1}. ` : ''}
          {stageShort(value)}
        </span>
      </Tooltip>
      {onAccept && (
        <Tooltip text={TIKTOK_HINTS.quickAccept}>
          <button
            type="button"
            className="jr-accept"
            aria-label={TIKTOK_HINTS.quickAccept}
            onClick={(e) => {
              e.stopPropagation()
              onAccept()
            }}
          >
            <Check size={12} />
          </button>
        </Tooltip>
      )}
    </span>
  )
}

/** Table cell and drawer display: "Gold", "Gold → Platinum" (solid, then dashed), or just the stage. */
export function JourneyCell({ creator, onAccept }) {
  const suggestion = journeySuggestion(creator)
  return (
    <span className="jr-cell">
      <JourneyPosition creator={creator} />
      {suggestion && (
        <>
          <span className="jr-arrow" aria-hidden="true">
            →
          </span>
          <SuggestedPill suggestion={suggestion} onAccept={onAccept} />
        </>
      )}
    </span>
  )
}
