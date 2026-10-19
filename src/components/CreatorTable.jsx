import { useEffect, useLayoutEffect, useRef } from 'react'
import { ArrowDown, ArrowUp, Check, ChevronsUpDown } from 'lucide-react'
import { sortVideos } from '../lib/fields'
import { formatCell, formatDate, isOverdue } from '../lib/format'
import { PERIOD_FIELDS, TIKTOK_HINTS, videoProducts } from '../lib/tiktok'
import { StagePill, TierPill } from './Pill'
import { Tooltip } from './Tooltip'

function SortIcon({ state }) {
  if (state === 'asc') return <ArrowUp size={12} />
  if (state === 'desc') return <ArrowDown size={12} />
  return <ChevronsUpDown size={12} />
}

/** Full list behind an "N products" cell, one per line. */
const productLines = (list) =>
  (list || [])
    .filter((p) => p?.product)
    .map((p) => (p.date_received ? `${p.product} (${formatDate(p.date_received)})` : p.product))
    .join('\n')

/** Full list behind an "N videos" cell, one per line, newest first. */
const videoLines = (list) =>
  sortVideos(list)
    .map((v) => [v.date ? formatDate(v.date) : '', videoProducts(v).join(', ')].filter(Boolean).join(' · '))
    .filter(Boolean)
    .join('\n')

function Cell({ field, row, ownerNames }) {
  if (field.key === 'stage') return <StagePill stage={row.stage} />
  if (field.key === 'creator_tier') return <TierPill tier={row.creator_tier} />
  // Same wording as the drawer: a tick and the label when set, blank otherwise.
  // (Export keeps Yes/No.)
  if (field.type === 'bool') {
    return row[field.key] ? (
      <Tooltip text={TIKTOK_HINTS[field.key]}>
        <span className="cell-check">
          <Check size={14} className="tick" /> {field.checkLabel || 'Yes'}
        </span>
      </Tooltip>
    ) : null
  }

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
  const list =
    field.type === 'products'
      ? productLines(row[field.key])
      : field.type === 'videos'
        ? videoLines(row[field.key])
        : ''
  return (
    <Tooltip text={list} width={360}>
      <span className={muted ? 'cell-muted' : undefined}>{text}</span>
    </Tooltip>
  )
}

const TABLE_BOTTOM_SPACE = 80

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
  scrollKey, // changes with the page: the table scrolls back to the top
}) {
  const wrapRef = useRef(null)

  // The table area is as tall as the space left under the toolbar, so its
  // horizontal scrollbar stays on screen. Measured against the page (not the
  // current scroll), re-measured when the layout above it changes size.
  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const measure = () => {
      const top = el.getBoundingClientRect().top + window.scrollY
      // Room under the table for the pager and the page's bottom padding.
      el.style.setProperty('--table-offset', `${Math.round(top + TABLE_BOTTOM_SPACE)}px`)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el.parentElement)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [rows.length])

  useEffect(() => {
    if (wrapRef.current) wrapRef.current.scrollTop = 0
  }, [scrollKey])

  if (!rows.length) return <div className="card empty">{emptyMessage}</div>

  return (
    <div className="card table-wrap table-wrap--grid" ref={wrapRef}>
      <table className="table">
        <thead>
          <tr>
            {columns.map((f) => {
              const state = sort.key === f.key ? sort.direction : null
              const periodic = PERIOD_FIELDS.includes(f.key)
              const label = periodic && period ? `${f.label} – ${period}` : f.label
              const tip = TIKTOK_HINTS[f.key] || f.hint
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
