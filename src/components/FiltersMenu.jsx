import { useEffect, useRef, useState } from 'react'
import { ChevronDown, SlidersHorizontal, X } from 'lucide-react'
import {
  activeFilterCount,
  NO_FILTERS,
  NO_SALE_OPTIONS,
  noSaleHint,
  NOT_ENGAGED_OPTIONS,
  notEngagedHint,
  TIKTOK_HINTS,
} from '../lib/tiktok'
import { InfoTip } from './SyncMarker'
import { Tooltip } from './Tooltip'

/* The TikTok-driven filters in one dropdown. They combine with search, owner,
   stage and the funnel, and are deliberately not part of the saved view. */

function Row({ checked, onChange, label, hint, disabled }) {
  return (
    <div className={`filters__row${disabled ? ' filters__row--off' : ''}`}>
      <label className="filters__check">
        <input
          type="checkbox"
          className="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span>{label}</span>
      </label>
      <InfoTip text={hint} />
    </div>
  )
}

export function FiltersMenu({ filters, onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const count = activeFilterCount(filters)
  const set = (patch) => onChange({ ...filters, ...patch })
  const days = typeof filters.noSale === 'number'

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
      <Tooltip text={TIKTOK_HINTS.filtersButton}>
        <button
          type="button"
          className={`btn ${count ? 'btn--primary' : 'btn--outline'}`}
          aria-expanded={open}
          aria-haspopup="true"
          onClick={() => setOpen((v) => !v)}
        >
          <SlidersHorizontal size={14} /> Filters{count ? ` (${count})` : ''} <ChevronDown size={13} />
        </button>
      </Tooltip>

      {open && (
        <div className="filters__menu card" role="group" aria-label="Filters">
          {filters.stage && (
            <div className="filters__row filters__item">
              <span>Stage: {filters.stage}</span>
              <Tooltip text={TIKTOK_HINTS.stageFilter}>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Clear stage filter: ${filters.stage}`}
                  onClick={() => set({ stage: null })}
                >
                  <X size={13} />
                </button>
              </Tooltip>
            </div>
          )}
          {filters.journey && (
            <div className="filters__row filters__item">
              <span>Journey: {filters.journey}</span>
              <Tooltip text={TIKTOK_HINTS.journeyFilter}>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Clear journey filter: ${filters.journey}`}
                  onClick={() => set({ journey: null })}
                >
                  <X size={13} />
                </button>
              </Tooltip>
            </div>
          )}
          <Row
            checked={filters.overdue}
            onChange={(v) => set({ overdue: v })}
            label="Overdue follow-ups"
            hint={TIKTOK_HINTS.overdue}
          />
          <Row
            checked={filters.newFromTiktok}
            onChange={(v) => set({ newFromTiktok: v })}
            label="New from TikTok"
            hint={TIKTOK_HINTS.newFromTiktok}
          />
          <Row
            checked={filters.cancelledOnly}
            onChange={(v) => set({ cancelledOnly: v })}
            label="Request cancelled, no other activity"
            hint={TIKTOK_HINTS.requestCancelledOnly}
          />
          <Row
            checked={filters.suggested}
            onChange={(v) => set({ suggested: v })}
            label="Suggested actions"
            hint={TIKTOK_HINTS.suggested}
          />

          <div className="filters__row filters__row--select">
            <label htmlFor="filter-no-sale">No sale for</label>
            <select
              id="filter-no-sale"
              className="select"
              value={filters.noSale}
              onChange={(e) => {
                const v = e.target.value
                set({ noSale: v === '' || v === 'never' ? v : Number(v), noContact: false })
              }}
            >
              <option value="">Any</option>
              {NO_SALE_OPTIONS.map((d) => (
                <option key={d} value={d}>
                  {d} days
                </option>
              ))}
              <option value="never">Never sold</option>
            </select>
            <InfoTip text={filters.noSale === 'never' ? TIKTOK_HINTS.neverSold : noSaleHint(filters.noSale)} />
          </div>
          <Row
            checked={days && filters.noContact}
            disabled={!days}
            onChange={(v) => set({ noContact: v })}
            label={`…and no contact in ${days ? filters.noSale : 'X'} days`}
            hint={days ? TIKTOK_HINTS.noContact : TIKTOK_HINTS.noContactDisabled}
          />


          <div className="filters__row filters__row--select">
            <label htmlFor="filter-not-engaged">Not engaged for</label>
            <select
              id="filter-not-engaged"
              className="select"
              value={filters.notEngaged}
              onChange={(e) => set({ notEngaged: e.target.value === '' ? '' : Number(e.target.value) })}
            >
              <option value="">Any</option>
              {NOT_ENGAGED_OPTIONS.map((d) => (
                <option key={d} value={d}>
                  {d} days
                </option>
              ))}
            </select>
            <InfoTip text={notEngagedHint(filters.notEngaged)} />
          </div>
          <Row
            checked={filters.spanish}
            onChange={(v) => set({ spanish: v })}
            label="Language: Spanish"
            hint={TIKTOK_HINTS.languageFilter}
          />

          {count > 0 && (
            <Tooltip text={TIKTOK_HINTS.clearFilters}>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => onChange(NO_FILTERS)}>
                Clear filters
              </button>
            </Tooltip>
          )}
        </div>
      )}
    </div>
  )
}
