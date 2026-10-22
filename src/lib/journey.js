/* The creator journey as one sequence: stages until a creator earns a tier,
   then tiers. Constants and position helpers only, with no imports, so
   fields.js and tiktok.js can both build on it without a cycle. */

/* Ordered journey — the UI numbers stages by their position here, and this
   must match the creator_stage enum in the database. */
export const STAGES = [
  'Invited',
  'Joined',
  'TT Shop Enabled',
  'First Product',
  'Product Sent',
  'First Video',
  'Video Posted',
  'First Sale',
  'First Sale Achieved',
  'Build Momentum',
  'Consistent Creator',
  'Tier Up',
  'Top Performer',
]

/** Compact stage name for pills and chart axes. Every name is short enough now,
    so this returns it unchanged; callers keep it as the one place to shorten one. */
export function stageShort(stage) {
  return stage
}

/** Where a hand-made or imported creator starts (what STAGES[0] used to be). */
export const DEFAULT_STAGE = 'Joined'

/* Ordered low → high; tier sorting follows this order. Must match the
   creators_creator_tier_check constraint in the database. */
export const TIERS = ['Bronze', 'Silver', 'Gold', 'Platinum']

/** Nothing sets these any more (tiers replaced two; First Sale was dropped in
    phase 8). They stay in the enum, and the funnel, dropdowns and filters hide
    them unless a creator is currently on one. */
export const RETIRED_STAGES = ['First Sale', 'Tier Up', 'Top Performer']

/** The ten stages a creator moves through before earning a tier. */
export const JOURNEY_STAGES = STAGES.filter((s) => !RETIRED_STAGES.includes(s))

/** A stage's place in the visible journey (1-10), or null for a retired stage. */
export function stageNumber(stage) {
  const i = JOURNEY_STAGES.indexOf(stage)
  return i === -1 ? null : i + 1
}

/** Everything the funnel shows, in order: ten stages, then four tiers. */
export const JOURNEY_STEPS = [...JOURNEY_STAGES, ...TIERS]

/** Sort order: every stage in enum order (a creator can still be on a retired
    one), then the tiers. */
const JOURNEY_ORDER = [...STAGES, ...TIERS]

/** Is the creator on this stage or later? Used for Bronze's Consistent Creator
    requirement in the Settings preview. Tiers count as past every stage. */
export function reachedStage(c, stage) {
  if (c.creator_tier) return true
  return STAGES.indexOf(c.stage) >= STAGES.indexOf(stage)
}

export const isTier = (step) => TIERS.includes(step)

/** Where a creator is on the journey: the accepted tier if set, otherwise the stage. */
export const journeyOf = (c) => c.creator_tier || c.stage

export function journeyIndex(c) {
  const i = JOURNEY_ORDER.indexOf(journeyOf(c))
  return i === -1 ? JOURNEY_ORDER.length : i
}

/** Does the creator belong to a funnel step? A stage step holds creators with no
    tier on that stage. A tier step holds creators with that tier and those
    whose suggested tier it is. */
export function journeyMatches(c, step) {
  if (isTier(step)) return c.creator_tier === step || c.suggested_tier === step
  return !c.creator_tier && c.stage === step
}
