import { journeyIndex } from './journey'

/** Sort value for a field. Enums (stage, tier) sort by list order, not
    alphabetically; owner sorts by the profile's name. */
function sortValue(field, row, ownerNames) {
  const v = row[field.key]
  // Journey is a view over stage and creator_tier: stages in enum order, then tiers.
  if (field.type === 'journey') return journeyIndex(row)

  if (v == null || v === '') return null

  if (field.type === 'enum') {
    const i = field.options.indexOf(v)
    return i === -1 ? field.options.length : i
  }
  if (field.type === 'owner') return ownerNames?.get(v)?.toLowerCase() ?? null
  if (field.type === 'bool') return v ? 1 : 0
  if (field.type === 'int' || field.type === 'num') return Number(v)
  if (field.type === 'date') return v // ISO strings sort lexicographically
  return String(v).toLowerCase()
}

/** Returns a new sorted array. Empty values always sort last, both directions.
    `ownerNames` maps profile id → name. */
export function sortCreators(rows, field, direction, ownerNames) {
  if (!field) return rows

  const dir = direction === 'desc' ? -1 : 1

  return [...rows].sort((a, b) => {
    const av = sortValue(field, a, ownerNames)
    const bv = sortValue(field, b, ownerNames)

    if (av === null && bv === null) return 0
    if (av === null) return 1
    if (bv === null) return -1

    if (av < bv) return -1 * dir
    if (av > bv) return 1 * dir
    return 0
  })
}
