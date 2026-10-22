import { useEffect } from 'react'
import { cleanColumnKeys, FIELD_BY_KEY, OPTIONAL_TABLE_FIELDS, TABLE_FIELD_BY_KEY } from '../lib/fields'
import { cleanPeriod, DEFAULT_PERIOD } from '../lib/tiktok'

/* Per-person table view (owner filter, sort, chosen columns and their order,
   GMV/Units period), kept in this browser's localStorage under the signed-in user's id.
   Search text, the funnel stage filter and the TikTok filters are deliberately
   not saved: a stale hidden filter silently hiding rows is more confusing than
   setting it again. A custom period is saved as its dates. */

const KEY_PREFIX = 'ebcc-view:'

export const DEFAULT_VIEW = {
  owner: 'all', // 'all' | 'unassigned' | profile id
  sort: { key: 'next_follow_up_date', direction: 'asc' },
  columns: null, // null = the key fields; otherwise the column keys after Name, in order
  period: DEFAULT_PERIOD,
}

/** The saved view for this user, with anything unrecognised reset to default. */
export function loadView(userId) {
  let saved = null
  try {
    saved = JSON.parse(localStorage.getItem(KEY_PREFIX + userId))
  } catch {
    /* blocked storage or bad JSON — use the defaults */
  }
  if (!saved || typeof saved !== 'object') return DEFAULT_VIEW

  // Journey is a table column, not a stored field, so look in both.
  const sortField = FIELD_BY_KEY[saved.sort?.key] || TABLE_FIELD_BY_KEY[saved.sort?.key]
  return {
    owner: typeof saved.owner === 'string' && saved.owner ? saved.owner : DEFAULT_VIEW.owner,
    sort:
      sortField?.sortable && ['asc', 'desc'].includes(saved.sort.direction)
        ? { key: saved.sort.key, direction: saved.sort.direction }
        : DEFAULT_VIEW.sort,
    // Before the column picker, "All fields" was a saved on/off switch: keep it as every column.
    columns:
      cleanColumnKeys(saved.columns) ??
      (saved.showAllFields === true ? OPTIONAL_TABLE_FIELDS.map((f) => f.key) : DEFAULT_VIEW.columns),
    period: cleanPeriod(saved.period),
  }
}

/** Writes the view back whenever it changes. */
export function useSaveView(userId, view) {
  const json = JSON.stringify(view)
  useEffect(() => {
    try {
      localStorage.setItem(KEY_PREFIX + userId, json)
    } catch {
      /* private browsing — the view just won't survive a reload */
    }
  }, [userId, json])
}
