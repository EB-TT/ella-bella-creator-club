import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'
import { formatCell, isOverdue } from '../lib/format'
import { BoolPill, StagePill, TierPill } from './Pill'

function SortIcon({ state }) {
  if (state === 'asc') return <ArrowUp size={12} />
  if (state === 'desc') return <ArrowDown size={12} />
  return <ChevronsUpDown size={12} />
}

function Cell({ field, row }) {
  if (field.key === 'stage') return <StagePill stage={row.stage} />
  if (field.key === 'creator_tier') return <TierPill tier={row.creator_tier} />
  if (field.type === 'bool') return <BoolPill value={row[field.key]} />

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
  return <span className={muted ? 'cell-muted' : undefined}>{text}</span>
}

export function CreatorTable({ rows, columns, sort, onSort, onRowClick, emptyMessage, extraColumns }) {
  if (!rows.length) return <div className="card empty">{emptyMessage}</div>

  return (
    <div className="card table-wrap">
      <table className="table">
        <thead>
          <tr>
            {columns.map((f) => {
              const state = sort.key === f.key ? sort.direction : null
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
                    {f.label}
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
                  <Cell field={f} row={row} />
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
