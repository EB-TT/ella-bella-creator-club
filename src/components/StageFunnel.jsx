import { useMemo } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { STAGES, stageShort } from '../lib/fields'

export function StageFunnel({ creators, activeStage, onSelectStage }) {
  const data = useMemo(() => {
    const counts = Object.fromEntries(STAGES.map((s) => [s, 0]))
    for (const c of creators) {
      if (c.stage in counts) counts[c.stage] += 1
    }
    return STAGES.map((s, i) => ({
      stage: s,
      short: stageShort(s),
      full: `${i + 1}. ${s}`,
      count: counts[s],
    }))
  }, [creators])

  return (
    <section className="card funnel">
      <div className="funnel__head">
        <h2 className="section-title" style={{ margin: 0 }}>
          Stage funnel
        </h2>
        <span className="funnel__total">{creators.length} active creators</span>
      </div>

      <ResponsiveContainer width="100%" height={250}>
        <BarChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          {/* 12 stage names don't fit side by side, so the ticks are angled. */}
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
          <Tooltip
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
