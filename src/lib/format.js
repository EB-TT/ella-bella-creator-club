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

/** "3 Oct", or "3 Oct 2025" when it isn't this year. */
export function formatDayMonth(value) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) })
}

export function formatCell(field, value) {
  if (field.blankLabel && (value == null || value === '')) return field.blankLabel
  if (field.thousands && value != null && value !== '') return Number(value).toLocaleString('en-US')
  if (field.type === 'bool') return value ? 'Yes' : 'No'
  if (field.key === 'gmv') return formatMoney(value)
  if (field.type === 'date') return formatDate(value)
  if (field.type === 'products') {
    const n = value?.length || 0
    return n ? `${n} product${n === 1 ? '' : 's'}` : '—'
  }
  if (field.type === 'videos') {
    const n = value?.length || 0
    return n ? `${n} video${n === 1 ? '' : 's'}` : '—'
  }
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
