import { CalendarRange } from 'lucide-react'
import { PERIOD_KINDS, TIKTOK_HINTS } from '../lib/tiktok'
import { Tooltip } from './Tooltip'

/* Date range for the GMV and Units Sold (Total) columns, in the header. The
   stored totals (and the drawer) are always all-time. */
export function PeriodSelector({ period, onChange, loading }) {
  return (
    <div className="period">
      <Tooltip text={TIKTOK_HINTS.dateRange}>
        <span className="period__pick">
          <CalendarRange size={14} />
          <select
            className="select"
            style={{ width: 'auto' }}
            aria-label="Date range for GMV and Units Sold (Total)"
            value={period.kind}
            onChange={(e) => onChange({ ...period, kind: e.target.value })}
          >
            {PERIOD_KINDS.map((k) => (
              <option key={k.kind} value={k.kind}>
                {k.label}
              </option>
            ))}
          </select>
        </span>
      </Tooltip>
      {period.kind === 'custom' && (
        <Tooltip text={TIKTOK_HINTS.customDates}>
          <span className="period__custom">
            <input
              type="date"
              className="input"
              style={{ width: 'auto' }}
              aria-label="From date"
              value={period.from}
              max={period.to || undefined}
              onChange={(e) => onChange({ ...period, from: e.target.value })}
            />
            <span className="cell-muted">to</span>
            <input
              type="date"
              className="input"
              style={{ width: 'auto' }}
              aria-label="To date"
              value={period.to}
              min={period.from || undefined}
              onChange={(e) => onChange({ ...period, to: e.target.value })}
            />
          </span>
        </Tooltip>
      )}
      {loading && <span className="cell-muted period__loading">Loading…</span>}
    </div>
  )
}
