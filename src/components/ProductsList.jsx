import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import { formatDate } from '../lib/format'

/* Other Products Received — a JSON array of { product, date_received } on the
   creator row. Edits go into the draft like any other field, so they're
   committed with "Save changes" rather than instantly like notes. */

export function ProductsList({ field, value, onChange }) {
  const [product, setProduct] = useState('')
  const [date, setDate] = useState('')

  const entries = value || []
  // Newest first for display; undated entries sink to the bottom.
  const ordered = entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) =>
      String(b.entry.date_received || '').localeCompare(String(a.entry.date_received || ''))
    )

  function add() {
    const name = product.trim()
    if (!name) return
    onChange([...entries, { product: name, date_received: date || null }])
    setProduct('')
    setDate('')
  }

  return (
    <div className="field--full">
      <span className="label">{field.label}</span>

      {ordered.length === 0 ? (
        <p className="cell-muted" style={{ fontSize: 12, margin: '0 0 var(--sp-2)' }}>
          None recorded.
        </p>
      ) : (
        ordered.map(({ entry, index }) => (
          <div className="product-entry" key={index}>
            <span className="product-entry__name">{entry.product}</span>
            <span className="product-entry__date">{formatDate(entry.date_received)}</span>
            <button
              type="button"
              className="product-entry__remove"
              title="Remove entry"
              onClick={() => onChange(entries.filter((_, i) => i !== index))}
            >
              <X size={13} />
            </button>
          </div>
        ))
      )}

      <div className="product-add">
        <input
          className="input"
          placeholder="Product"
          aria-label="Product"
          value={product}
          onChange={(e) => setProduct(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <input
          className="input"
          type="date"
          aria-label="Date received"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <button type="button" className="btn btn--outline" onClick={add} disabled={!product.trim()}>
          <Plus size={14} /> Add
        </button>
      </div>

      {field.hint && <span className="field-hint">{field.hint}</span>}
    </div>
  )
}
