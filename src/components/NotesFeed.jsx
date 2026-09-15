import { useState } from 'react'
import { ChevronDown, ChevronRight, Plus } from 'lucide-react'
import { formatDateTime } from '../lib/format'

/* Notes live on the creator row as a JSON array of { author, timestamp, text },
   newest first, each collapsed until clicked. */

function Note({ note }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="note">
      <button type="button" className="note__head" onClick={() => setOpen((o) => !o)}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span className="note__meta">
          {formatDateTime(note.timestamp)} · {note.author}
        </span>
        {!open && <span className="note__preview">{note.text}</span>}
      </button>
      {open && <div className="note__body">{note.text}</div>}
    </div>
  )
}

export function NotesFeed({ notes, onAdd }) {
  const [draft, setDraft] = useState('')

  const ordered = [...(notes || [])].sort((a, b) =>
    String(b.timestamp || '').localeCompare(String(a.timestamp || ''))
  )

  function submit() {
    const text = draft.trim()
    if (!text) return
    onAdd(text)
    setDraft('')
  }

  return (
    <section>
      <h3 className="section-title">Notes</h3>

      <textarea
        className="textarea"
        placeholder="Add a note…"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />
      <button
        type="button"
        className="btn btn--outline"
        style={{ marginTop: 'var(--sp-2)', marginBottom: 'var(--sp-4)' }}
        onClick={submit}
        disabled={!draft.trim()}
      >
        <Plus size={14} /> Add note
      </button>

      {ordered.length === 0 ? (
        <p className="cell-muted" style={{ fontSize: 12, margin: 0 }}>
          No notes yet.
        </p>
      ) : (
        ordered.map((n, i) => <Note key={`${n.timestamp}-${i}`} note={n} />)
      )}
    </section>
  )
}
