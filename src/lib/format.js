const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

const dateFmt = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
})

export function formatDate(value) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return dateFmt.format(d)
}

export function formatDateTime(value) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return `${dateFmt.format(d)} ${d.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  })}`
}

export function formatMoney(value) {
  if (value == null || value === '') return '—'
  return usd.format(Number(value))
}

export function formatCell(field, value) {
  if (field.type === 'bool') return value ? 'Yes' : 'No'
  if (field.key === 'gmv') return formatMoney(value)
  if (field.type === 'date') return formatDate(value)
  if (value == null || value === '') return '—'
  return String(value)
}

/** Today at local midnight — the cutoff for "overdue". */
export function todayISO() {
  const now = new Date()
  const tz = now.getTimezoneOffset() * 60000
  return new Date(now - tz).toISOString().slice(0, 10)
}

export function isOverdue(creator) {
  if (creator.status !== 'active') return false
  if (!creator.next_follow_up_date) return false
  return creator.next_follow_up_date < todayISO()
}
