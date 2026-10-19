import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'
import { formatProducts, formatVideos } from '../lib/fields'
import { formatCell, isOverdue } from '../lib/format'
import { PERIOD_FIELDS, TIKTOK_HINTS } from '../lib/tiktok'
import { BoolPill, StagePill, TierPill } from './Pill'
import { Tooltip } from './Tooltip'

function SortIcon({ state }) {
  if (state === 'asc') return <ArrowUp size={12} />
  if (state === 'desc') return <ArrowDown size={12} />
  return <ChevronsUpDown size={12} />
}

function Cell({ field, row, ownerNames }) {
  if (field.key === 'stage') return <StagePill stage={row.stage} />
  if (field.key === 'creator_tier') return <TierPill tier={row.creator_tier} />
  if (field.type === 'bool') return <BoolPill value={row[field.key]} />

  if (field.type === 'owner') {
    const id = row[field.key]
    if (!id) return <span className="cell-muted">—</span>
    return <span>{ownerNames?.get(id) ?? 'Unknown user'}</span>
  }

  if (field.type === 'url') {
    const v = row[field.key]
    if (!v) return <span className="cell-muted">—</span>
    return (
      <a href={v} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
        Open
      </a>
    )
  }

  const text = formatCell(field, row[field.key])
  const muted = text === '—'
  const title =
    field.type === 'products'
      ? formatProducts(row[field.key]) || undefined
      : field.type === 'videos'
        ? formatVideos(row[field.key]) || undefined
        : undefined
  return (
    <span className={muted ? 'cell-muted' : undefined} title={title}>
      {text}
    </span>
  )
}

export function CreatorTable({
  rows,
  columns,
  sort,
  onSort,
  onRowClick,
  emptyMessage,
  extraColumns,
  ownerNames,
  period = '', // e.g. "last 30 days" when GMV and Units follow the Period selector
}) {
  if (!rows.length) return <div className="card empty">{emptyMessage}</div>

  return (
    <div className="card table-wrap">
      <table className="table">
        <thead>
          <tr>
            {columns.map((f) => {
              const state = sort.key === f.key ? sort.direction : null
              const periodic = PERIOD_FIELDS.includes(f.key)
              const label = periodic && period ? `${f.label} – ${period}` : f.label
              const tip = periodic
                ? [TIKTOK_HINTS.period, TIKTOK_HINTS[f.key]].join('\n\n')
                : TIKTOK_HINTS[f.key] || f.hint
              return (
                <th
                  key={f.key}
                  className={f.sortable ? 'sortable' : undefined}
                  onClick={f.sortable ? () => onSort(f.key) : undefined}
                  aria-sort={
                    state === 'asc' ? 'ascending' : state === 'desc' ? 'descending' : 'none'
                  }
                >
                  <span className={`th-inner${state ? ' th-inner--active' : ''}`}>
                    <Tooltip text={tip}>
                      <span>{label}</span>
                    </Tooltip>
                    {f.sortable && <SortIcon state={state} />}
                  </span>
                </th>
              )
            })}
            {extraColumns?.map((c) => (
              <th key={c.key}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              className={isOverdue(row) ? 'row--overdue' : undefined}
              onClick={() => onRowClick(row)}
            >
              {columns.map((f) => (
                <td
                  key={f.key}
                  className={[
                    f.key === 'name' ? 'cell-name' : '',
                    f.type === 'int' || f.type === 'num' ? 'cell-num' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <Cell field={f} row={row} ownerNames={ownerNames} />
                </td>
              ))}
              {extraColumns?.map((c) => (
                <td key={c.key}>{c.render(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
