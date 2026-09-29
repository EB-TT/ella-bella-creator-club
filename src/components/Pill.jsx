import { STAGES, stageShort } from '../lib/fields'

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

const TIER_TONE = { Bronze: 'amber', Silver: 'neutral', Gold: 'accent' }

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
