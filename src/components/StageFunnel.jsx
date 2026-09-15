import { useMemo } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { STAGES } from '../lib/fields'

const SHORT = {
  'Accepted (Target Collab Invitation)': 'Accepted',
}

export function StageFunnel({ creators, activeStage, onSelectStage }) {
  const data = useMemo(() => {
    const counts = Object.fromEntries(STAGES.map((s) => [s, 0]))
    for (const c of creators) {
      if (c.stage in counts) counts[c.stage] += 1
    }
    return STAGES.map((s) => ({ stage: s, short: SHORT[s] || s, count: counts[s] }))
  }, [creators])

  return (
    <section className="card funnel">
      <div className="funnel__head">
        <h2 className="section-title" style={{ margin: 0 }}>
          Stage funnel
        </h2>
        <span className="funnel__total">{creators.length} active creators</span>
      </div>

      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="short"
            tick={{ fill: 'var(--text-2)', fontSize: 11 }}
            axisLine={{ stroke: 'var(--border)' }}
            tickLine={false}
            interval={0}
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
