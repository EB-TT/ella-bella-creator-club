import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Check, ChevronsUpDown } from 'lucide-react'
import { JOURNEY_MERGED, sortVideos } from '../lib/fields'
import { formatCell, formatDate, isOverdue } from '../lib/format'
import { PERIOD_FIELDS, TIKTOK_HINTS, videoProducts } from '../lib/tiktok'
import { JourneyCell, NextActionCell, StagePill, TierPill } from './Pill'
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

function Cell({ field, row, ownerNames, onQuickAccept }) {
  if (field.key === 'journey') return <JourneyCell creator={row} onAccept={onQuickAccept && (() => onQuickAccept(row))} />
  // With the merged Journey field, a pending suggestion shows here as the next step.
  if (field.key === 'next_action' && JOURNEY_MERGED) {
    return <NextActionCell creator={row} onAccept={onQuickAccept && (() => onQuickAccept(row))} />
  }
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

/** Room for the header and about six rows; short windows scroll the page instead. */
const MIN_TABLE_HEIGHT = 320

export function CreatorTable({
  rows,
  columns,
  sort,
  onSort,
  onRowClick,
  emptyMessage,
  extraColumns,
  ownerNames,
  onQuickAccept, // accepts a row's journey suggestion from the dashed pill's tick
  onReorder, // (fromKey, toKey): a header was dragged onto another; Name can't move
  period = '', // e.g. "last 30 days" when GMV and Units follow the Period selector
  scrollKey, // changes with the page: the table scrolls back to the top
}) {
  const wrapRef = useRef(null)
  const dragKey = useRef(null)
  const [dragging, setDragging] = useState(null) // the key being dragged
  const [over, setOver] = useState(null) // the header it is over

  // The table area is as tall as the window allows, so that with the page
  // scrolled to the table's top the table, the pager under it and the page's
  // bottom padding end exactly at the bottom of the window. Measured against
  // the page (not the current scroll). Runs after every render (the pager, the
  // funnel and the column set all change with state) and again when anything
  // around the table changes size.
  const measure = useCallback(() => {
    const el = wrapRef.current
    if (!el) return
    const page = el.parentElement
    const style = getComputedStyle(page)
    const pager = el.nextElementSibling
    const below = pager ? pager.offsetHeight + (parseFloat(style.rowGap) || 0) : 0
    const top = el.getBoundingClientRect().top + window.scrollY
    const room = window.innerHeight - top - below - (parseFloat(style.paddingBottom) || 0)
    el.style.setProperty('--table-max-h', `${Math.max(MIN_TABLE_HEIGHT, Math.floor(room))}px`)
  }, [])

  useLayoutEffect(measure)

  useLayoutEffect(() => {
    const page = wrapRef.current?.parentElement
    if (!page) return
    const ro = new ResizeObserver(measure)
    ro.observe(page)
    Array.from(page.children).forEach((c) => c !== wrapRef.current && ro.observe(c))
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [measure, rows.length === 0])

  useEffect(() => {
    if (wrapRef.current) wrapRef.current.scrollTop = 0
  }, [scrollKey])

  if (!rows.length) return <div className="card empty">{emptyMessage}</div>

  return (
    <div className="card table-wrap table-wrap--grid" ref={wrapRef}>
      <table className="table">
        <thead>
          <tr>
            {columns.map((f, i) => {
              const state = sort.key === f.key ? sort.direction : null
              const periodic = PERIOD_FIELDS.includes(f.key)
              const label = periodic && period ? `${f.label} – ${period}` : f.label
              const movable = Boolean(onReorder) && i > 0 // Name stays first
              const tip = [TIKTOK_HINTS[f.key] || f.hint, movable && TIKTOK_HINTS.dragReorder]
                .filter(Boolean)
                .join('\n')
              const endDrag = () => {
                dragKey.current = null
                setDragging(null)
                setOver(null)
              }
              return (
                <th
                  key={f.key}
                  className={[
                    f.sortable ? 'sortable' : '',
                    dragging === f.key ? 'th--dragging' : '',
                    over === f.key ? 'th--over' : '',
                  ]
                    .filter(Boolean)
                    .join(' ') || undefined}
                  draggable={movable || undefined}
                  onDragStart={
                    movable
                      ? (e) => {
                          dragKey.current = f.key
                          setDragging(f.key)
                          e.dataTransfer.effectAllowed = 'move'
                          e.dataTransfer.setData('text/plain', f.key) // Firefox needs data to start a drag
                        }
                      : undefined
                  }
                  onDragOver={
                    movable
                      ? (e) => {
                          if (!dragKey.current || dragKey.current === f.key) return
                          e.preventDefault()
                          setOver(f.key)
                        }
                      : undefined
                  }
                  onDrop={
                    movable
                      ? (e) => {
                          e.preventDefault()
                          if (dragKey.current && dragKey.current !== f.key) onReorder(dragKey.current, f.key)
                          endDrag()
                        }
                      : undefined
                  }
                  onDragEnd={movable ? endDrag : undefined}
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
                  <Cell field={f} row={row} ownerNames={ownerNames} onQuickAccept={onQuickAccept} />
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
