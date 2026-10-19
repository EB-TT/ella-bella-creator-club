import { ChevronLeft, ChevronRight } from 'lucide-react'
import { TIKTOK_HINTS } from '../lib/tiktok'
import { Tooltip } from './Tooltip'

export const PAGE_SIZE = 100

const nf = new Intl.NumberFormat('en-US')

/** Page controls under the table. `page` is zero-based. The count always shows; the page controls only for more than one page.
    `of` is the unfiltered total; when it differs from `total` the count says so. */
export function Pagination({ page, total, of, hint, onPage }) {
  const pages = Math.ceil(total / PAGE_SIZE)
  if (!total) return null
  const first = page * PAGE_SIZE + 1
  const last = Math.min(total, (page + 1) * PAGE_SIZE)

  return (
    <div className="pager">
      <Tooltip text={hint || TIKTOK_HINTS.pagination} className="pager__info">
        <span>
          {nf.format(first)}–{nf.format(last)} of {nf.format(total)}
          {of > total && ` (filtered from ${nf.format(of)})`}
        </span>
      </Tooltip>
      {pages > 1 && (
        <>
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
        </>
      )}
    </div>
  )
}
