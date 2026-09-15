import { STAGES } from '../lib/fields'

/* Tinted pill pattern: background --x-bg, colour --x, 1px border --x-border. */

const STAGE_TONE = {
  'Accepted (Target Collab Invitation)': 'neutral',
  'Received Product': 'amber',
  'First Video': 'accent',
  'First Sale': 'green',
  'Build Momentum': 'green',
  'Consistent Creator': 'accent',
  'Tier Up': 'accent',
}

const TIER_TONE = { Bronze: 'amber', Silver: 'neutral', Gold: 'accent' }

export function Pill({ tone = 'neutral', children }) {
  return <span className={`pill pill--${tone}`}>{children}</span>
}

export function StagePill({ stage }) {
  if (!stage) return <span className="cell-muted">—</span>
  const idx = STAGES.indexOf(stage)
  // Short label in the table; full stage names are long.
  const short = stage === STAGES[0] ? 'Accepted' : stage
  return (
    <Pill tone={STAGE_TONE[stage] || 'neutral'}>
      {idx >= 0 ? `${idx + 1}. ` : ''}
      {short}
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
