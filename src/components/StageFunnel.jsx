import { useMemo } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Rectangle,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as ChartTip,
  XAxis,
  YAxis,
} from 'recharts'
import { JOURNEY_MERGED, stageShort } from '../lib/fields'
import { JOURNEY_STAGES, TIERS } from '../lib/journey'
import { stepText, tierBandText, TIKTOK_HINTS } from '../lib/tiktok'
import { Tooltip } from './Tooltip'

const TIER_COLOR = { Bronze: 'var(--bronze)', Silver: 'var(--silver)', Gold: 'var(--amber)', Platinum: 'var(--accent)' }

/** An empty slot between the last stage and the first tier, with a divider through it. */
const GAP = '\u200b'

/* Hover bubble for a bar, styled like the app's tooltips. */
function StepTip({ active, payload, settings }) {
  const d = active && payload?.[0]?.payload
  if (!d || d.kind === 'gap') return null
  const text = d.kind === 'stage' ? stepText(d.step, settings) : null
  const band = d.kind === 'tier' ? tierBandText(settings, d.step) : ''
  return (
    <div className="funnel-tip">
      <strong>{d.full}</strong>
      {d.kind === 'stage' ? (
        <>
          <div>{d.count} creators</div>
          {text && (
            <>
              <div>
                <span className="funnel-tip__k">Means:</span> {text.means}
              </div>
              <div>
                <span className="funnel-tip__k">Moves here when:</span> {text.when}
              </div>
            </>
          )}
        </>
      ) : (
        <>
          <div>
            {d.count} with this tier · {d.suggested} suggested
          </div>
          {band && <div>{band}</div>}
          {d.step === 'Bronze' && <div>{TIKTOK_HINTS.tierBronzeNote}</div>}
          {d.suggested > 0 && <div className="funnel-tip__note">{TIKTOK_HINTS.funnelSuggestedNote}</div>}
        </>
      )}
    </div>
  )
}

/* One journey: ten stages, a divider, then the four tiers. Each creator is
   counted once, in their tier's bar if they have one and otherwise their
   stage's. A tier bar is stacked: solid = accepted, hatched = creators whose
   suggested tier it is (they are also counted at their current step). Clicking
   a bar sets the single Journey filter. */
function JourneyFunnel({ creators, activeStep, onSelectStep, settings }) {
  const { data, retired } = useMemo(() => {
    const stage = Object.fromEntries(JOURNEY_STAGES.map((s) => [s, 0]))
    const tier = Object.fromEntries(TIERS.map((t) => [t, 0]))
    const suggested = Object.fromEntries(TIERS.map((t) => [t, 0]))
    let retired = 0
    for (const c of creators) {
      if (c.creator_tier in tier) tier[c.creator_tier] += 1
      else if (c.stage in stage) stage[c.stage] += 1
      else retired += 1
      if (c.suggested_tier in suggested) suggested[c.suggested_tier] += 1
    }
    return {
      retired,
      data: [
        ...JOURNEY_STAGES.map((s, i) => ({
          kind: 'stage',
          step: s,
          short: stageShort(s),
          full: `${i + 1}. ${s}`,
          count: stage[s],
          suggested: 0,
        })),
        { kind: 'gap', step: GAP, short: GAP, full: '', count: 0, suggested: 0 },
        ...TIERS.map((t) => ({
          kind: 'tier',
          step: t,
          short: t,
          full: t,
          count: tier[t],
          suggested: suggested[t],
        })),
      ],
    }
  }, [creators])

  const colour = (d) => (d.kind === 'tier' ? TIER_COLOR[d.step] : 'var(--accent)')
  const faded = (d) => (activeStep && activeStep !== d.step ? 0.3 : 1)
  const pick = (d) => d.kind !== 'gap' && onSelectStep(activeStep === d.step ? null : d.step)

  return (
    <section className="card funnel">
      <div className="funnel__head">
        <Tooltip text={TIKTOK_HINTS.funnelJourney}>
          <h2 className="section-title" style={{ margin: 0 }}>
            Journey
          </h2>
        </Tooltip>
        <span className="funnel__total">
          {creators.length} active creators{retired ? ` · ${retired} on retired stages not shown` : ''}
        </span>
      </div>

      <ResponsiveContainer width="100%" height={250}>
        <BarChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
          <defs>
            {TIERS.map((t) => (
              <pattern key={t} id={`hatch-${t}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="6" height="6" fill={TIER_COLOR[t]} fillOpacity="0.15" />
                <line x1="0" y1="0" x2="0" y2="6" stroke={TIER_COLOR[t]} strokeWidth="2.5" strokeOpacity="0.75" />
              </pattern>
            ))}
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="short"
            tick={{ fill: 'var(--text-2)', fontSize: 11 }}
            axisLine={{ stroke: 'var(--border)' }}
            tickLine={false}
            interval={0}
            angle={-35}
            textAnchor="end"
            height={80}
          />
          <YAxis allowDecimals={false} tick={{ fill: 'var(--text-3)', fontSize: 11 }} axisLine={false} tickLine={false} />
          <ReferenceLine x={GAP} stroke="var(--border)" strokeDasharray="4 3" />
          <ChartTip cursor={{ fill: 'var(--accent-dim)' }} content={<StepTip settings={settings} />} />
          <Bar
            dataKey="count"
            stackId="journey"
            cursor="pointer"
            onClick={pick}
            // Rounded top only when nothing is stacked above it.
            shape={(p) => <Rectangle {...p} radius={p.payload.suggested > 0 ? 0 : [6, 6, 0, 0]} />}
          >
            {data.map((d) => (
              <Cell key={d.step} fill={colour(d)} fillOpacity={faded(d)} />
            ))}
          </Bar>
          <Bar dataKey="suggested" stackId="journey" cursor="pointer" radius={[6, 6, 0, 0]} onClick={pick}>
            {data.map((d) => (
              <Cell
                key={d.step}
                fill={d.kind === 'tier' ? `url(#hatch-${d.step})` : 'none'}
                stroke={colour(d)}
                strokeDasharray="3 2"
                strokeOpacity={d.kind === 'tier' ? faded(d) : 0}
                fillOpacity={faded(d)}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </section>
  )
}

/** The Journey funnel, or the stage-only funnel when JOURNEY_MERGED is off. */
export function StageFunnel({ creators, activeStage, onSelectStage, activeJourney, onSelectJourney, settings }) {
  return JOURNEY_MERGED ? (
    <JourneyFunnel creators={creators} activeStep={activeJourney} onSelectStep={onSelectJourney} settings={settings} />
  ) : (
    <LegacyFunnel creators={creators} activeStage={activeStage} onSelectStage={onSelectStage} />
  )
}

/* The stage-only funnel, used when JOURNEY_MERGED is false. */
function LegacyFunnel({ creators, activeStage, onSelectStage }) {
  // Retired stages are left out of the bars; creators still on one are counted in the header.
  const { data, retired } = useMemo(() => {
    const counts = Object.fromEntries(JOURNEY_STAGES.map((s) => [s, 0]))
    let retired = 0
    for (const c of creators) {
      if (c.stage in counts) counts[c.stage] += 1
      else retired += 1
    }
    return {
      retired,
      data: JOURNEY_STAGES.map((s, i) => ({
        stage: s,
        short: stageShort(s),
        full: `${i + 1}. ${s}`,
        count: counts[s],
      })),
    }
  }, [creators])

  return (
    <section className="card funnel">
      <div className="funnel__head">
        <Tooltip text={TIKTOK_HINTS.funnel}>
          <h2 className="section-title" style={{ margin: 0 }}>
            Stage funnel
          </h2>
        </Tooltip>
        <span className="funnel__total">
          {creators.length} active creators{retired ? ` · ${retired} on retired stages not shown` : ''}
        </span>
      </div>

      <ResponsiveContainer width="100%" height={250}>
        <BarChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          {/* Ten stage names don't fit side by side, so the ticks are angled. */}
          <XAxis
            dataKey="short"
            tick={{ fill: 'var(--text-2)', fontSize: 11 }}
            axisLine={{ stroke: 'var(--border)' }}
            tickLine={false}
            interval={0}
            angle={-35}
            textAnchor="end"
            height={80}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fill: 'var(--text-3)', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <ChartTip
            cursor={{ fill: 'var(--accent-dim)' }}
            contentStyle={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--r-control)',
              fontSize: 12,
              color: 'var(--text-1)',
            }}
            labelStyle={{ color: 'var(--text-2)' }}
            labelFormatter={(_, payload) => payload?.[0]?.payload.full}
            formatter={(v) => [v, 'Creators']}
          />
          <Bar
            dataKey="count"
            radius={[6, 6, 0, 0]}
            cursor="pointer"
            onClick={(d) => onSelectStage(activeStage === d.stage ? null : d.stage)}
          >
            {data.map((d) => (
              <Cell
                key={d.stage}
                fill={activeStage && activeStage !== d.stage ? 'var(--accent-dim)' : 'var(--accent)'}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </section>
  )
}
