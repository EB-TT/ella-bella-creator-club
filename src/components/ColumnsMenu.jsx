import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Columns3 } from 'lucide-react'
import { OPTIONAL_TABLE_FIELDS, TABLE_FIELD_BY_KEY } from '../lib/fields'
import { TIKTOK_HINTS } from '../lib/tiktok'
import { InfoTip } from './SyncMarker'
import { Tooltip } from './Tooltip'

/* The Columns button and its checklist of every field. Ticking a field adds it as
   the last column; unticking removes it. Order is changed by dragging the table
   headers (CreatorTable). Name is always the first column, so it is shown ticked
   and locked. Which columns and in what order is saved in the person's view. */

export function ColumnsMenu({ selected, onToggle, onReset, onShowAll }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false)
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="filters" ref={ref}>
      <Tooltip text={TIKTOK_HINTS.columnsButton}>
        <button
          type="button"
          className="btn btn--ghost"
          aria-expanded={open}
          aria-haspopup="true"
          onClick={() => setOpen((v) => !v)}
        >
          <Columns3 size={14} /> Columns <ChevronDown size={13} />
        </button>
      </Tooltip>

      {open && (
        <div className="filters__menu columns__menu card" role="group" aria-label="Columns">
          <div className="filters__row">
            <label className="filters__check">
              <input type="checkbox" className="checkbox" checked disabled />
              <span>{TABLE_FIELD_BY_KEY.name.label}</span>
            </label>
            <span className="cell-muted columns__note">Always first</span>
          </div>
          <div className="columns__list">
            {OPTIONAL_TABLE_FIELDS.map((f) => (
              <div className="filters__row" key={f.key}>
                <label className="filters__check">
                  <input
                    type="checkbox"
                    className="checkbox"
                    checked={selected.includes(f.key)}
                    onChange={() => onToggle(f.key)}
                  />
                  <span>{f.label}</span>
                </label>
                <InfoTip text={TIKTOK_HINTS[f.key] || f.hint} />
              </div>
            ))}
          </div>
          <div className="columns__foot">
            <Tooltip text={TIKTOK_HINTS.columnsReset}>
              <button type="button" className="btn btn--ghost btn--sm" onClick={onReset}>
                Reset to default
              </button>
            </Tooltip>
            <Tooltip text={TIKTOK_HINTS.columnsShowAll}>
              <button type="button" className="btn btn--ghost btn--sm" onClick={onShowAll}>
                Show all
              </button>
            </Tooltip>
            <span className="cell-muted columns__note">{TIKTOK_HINTS.dragReorder}</span>
          </div>
        </div>
      )}
    </div>
  )
}
