import { STAGES } from './fields'

/** Sort value for a field — stage sorts by journey order, not alphabetically. */
function sortValue(field, row) {
  const v = row[field.key]
  if (v == null || v === '') return null

  if (field.key === 'stage') {
    const i = STAGES.indexOf(v)
    return i === -1 ? STAGES.length : i
  }
  if (field.type === 'bool') return v ? 1 : 0
  if (field.type === 'int' || field.type === 'num') return Number(v)
  if (field.type === 'date') return v // ISO strings sort lexicographically
  return String(v).toLowerCase()
}

/** Returns a new sorted array. Empty values always sort last, both directions. */
export function sortCreators(rows, field, direction) {
  if (!field) return rows

  const dir = direction === 'desc' ? -1 : 1

  return [...rows].sort((a, b) => {
    const av = sortValue(field, a)
    const bv = sortValue(field, b)

    if (av === null && bv === null) return 0
    if (av === null) return 1
    if (bv === null) return -1

    if (av < bv) return -1 * dir
    if (av > bv) return 1 * dir
    return 0
  })
}
