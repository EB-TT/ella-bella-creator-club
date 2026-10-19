import { ChevronLeft, ChevronRight } from 'lucide-react'
import { TIKTOK_HINTS } from '../lib/tiktok'
import { Tooltip } from './Tooltip'

export const PAGE_SIZE = 100

const nf = new Intl.NumberFormat('en-US')

/** Page controls under the table. `page` is zero-based. Renders nothing for a single page. */
export function Pagination({ page, total, onPage }) {
  const pages = Math.ceil(total / PAGE_SIZE)
  if (pages <= 1) return null
  const first = page * PAGE_SIZE + 1
  const last = Math.min(total, (page + 1) * PAGE_SIZE)

  return (
    <div className="pager">
      <Tooltip text={TIKTOK_HINTS.pagination} className="pager__info">
        <span>
          {nf.format(first)}–{nf.format(last)} of {nf.format(total)}
        </span>
      </Tooltip>
      <button type="button" className="btn btn--outline btn--sm" disabled={page === 0} onClick={() => onPage(0)}>
        First
      </button>
      <button
        type="button"
        className="btn btn--outline btn--sm"
        disabled={page === 0}
        aria-label="Previous page"
        onClick={() => onPage(page - 1)}
      >
        <ChevronLeft size={14} />
      </button>
      <span className="pager__page">
        Page {page + 1} of {nf.format(pages)}
      </span>
      <button
        type="button"
        className="btn btn--outline btn--sm"
        disabled={page >= pages - 1}
        aria-label="Next page"
        onClick={() => onPage(page + 1)}
      >
        <ChevronRight size={14} />
      </button>
      <button
        type="button"
        className="btn btn--outline btn--sm"
        disabled={page >= pages - 1}
        onClick={() => onPage(pages - 1)}
      >
        Last
      </button>
    </div>
  )
}
