import { Check, Lightbulb } from 'lucide-react'
import { stageShort } from '../lib/fields'
import { stageNumber } from '../lib/journey'
import { journeySuggestion, TIKTOK_HINTS } from '../lib/tiktok'
import { Tooltip } from './Tooltip'

/* Tinted pill pattern: background --x-bg, colour --x, 1px border --x-border. */

/* Colour tracks journey phase: onboarding (invited, joined, TT Shop Enabled) is
   neutral, the product → video stretch is amber (in progress), the first-sale
   milestone is green, and momentum onward is accent. */
const STAGE_TONE = {
  Invited: 'neutral',
  Joined: 'neutral',
  'TT Shop Enabled': 'neutral',
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
  const n = stageNumber(stage) // retired stages have no number
  return (
    <Pill tone={STAGE_TONE[stage] || 'neutral'}>
      {n ? `${n}. ` : ''}
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
  const n = stageNumber(value)
  const tone = kind === 'tier' ? ` pill--${value.toLowerCase()}` : ''
  return (
    <span className="jr-suggest">
      <Tooltip text={TIKTOK_HINTS.suggestedPill}>
        <span className={`pill pill--suggested${tone}`}>
          <Lightbulb size={11} />
          {kind === 'stage' && n ? `${n}. ` : ''}
          {stageShort(value)}
        </span>
      </Tooltip>
      {onAccept && <AcceptTick onAccept={onAccept} />}
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

/** The tick that accepts a suggestion. Hidden until the pill is hovered or the
    tick is focused, unless `show` keeps it visible (the drawer). */
function AcceptTick({ onAccept, show = false }) {
  return (
    <Tooltip text={TIKTOK_HINTS.quickAccept}>
      <button
        type="button"
        className={`jr-accept${show ? ' jr-accept--show' : ''}`}
        aria-label={TIKTOK_HINTS.quickAccept}
        onClick={(e) => {
          e.stopPropagation()
          onAccept()
        }}
      >
        <Check size={12} />
      </button>
    </Tooltip>
  )
}

/** The suggested next journey step as a dashed "→ First Product" pill with an
    accept tick. Nothing without a suggestion. */
export function NextStepPill({ creator, onAccept, showTick = false }) {
  const suggestion = journeySuggestion(creator)
  if (!suggestion) return null
  const tone = suggestion.kind === 'tier' ? ` pill--${suggestion.value.toLowerCase()}` : ''
  return (
    <span className="jr-suggest">
      <Tooltip text={TIKTOK_HINTS.nextActionSuggestion}>
        <span className={`pill pill--suggested${tone}`}>→ {stageShort(suggestion.value)}</span>
      </Tooltip>
      {onAccept && <AcceptTick onAccept={onAccept} show={showTick} />}
    </span>
  )
}

/** Next Action table cell: the suggested next step if there is one, then the
    free text (muted after a suggestion); otherwise just the text. */
export function NextActionCell({ creator, onAccept }) {
  const text = creator.next_action
  const suggestion = journeySuggestion(creator)
  if (!suggestion) return text ? <span>{text}</span> : <span className="cell-muted">—</span>
  return (
    <span className="jr-cell">
      <NextStepPill creator={creator} onAccept={onAccept} />
      {text && <span className="cell-muted">{text}</span>}
    </span>
  )
}
