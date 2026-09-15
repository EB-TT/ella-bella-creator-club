import { useEffect, useMemo, useState } from 'react'
import { Trash2, X } from 'lucide-react'
import { FIELDS } from '../lib/fields'
import { FieldInput } from './FieldInput'
import { NotesFeed } from './NotesFeed'

const GROUPS = [
  { title: 'Creator', keys: ['name', 'tiktok_handle', 'instagram_handle', 'email', 'tiktok_shop_eligible'] },
  { title: 'Journey', keys: ['stage', 'owner', 'next_action', 'next_follow_up_date', 'last_contact'] },
  {
    title: 'Product & content',
    keys: ['product_sent_date', 'product_delivery_date', 'first_video_date', 'first_video_link'],
  },
  { title: 'Performance', keys: ['first_sale_date', 'units_sold', 'gmv', 'creator_tier'] },
]

const FULL_WIDTH = new Set(['name', 'next_action', 'first_video_link'])

export function CreatorDetail({ creator, authorName, onSave, onRequestDelete, onClose }) {
  const [draft, setDraft] = useState(creator)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    setDraft(creator)
    setError(null)
  }, [creator])

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(creator),
    [draft, creator]
  )

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const setField = (key, value) => setDraft((d) => ({ ...d, [key]: value }))

  async function persist(next) {
    setBusy(true)
    setError(null)
    try {
      await onSave(next)
    } catch (e) {
      setError(e.message || 'Could not save.')
      setBusy(false)
      return false
    }
    setBusy(false)
    return true
  }

  /* Adding a note commits the whole draft, so a note can never be lost to an
     unsaved edit sitting next to it. */
  async function addNote(text) {
    const note = { author: authorName, timestamp: new Date().toISOString(), text }
    const next = { ...draft, notes: [...(draft.notes || []), note] }
    setDraft(next)
    await persist(next)
  }

  return (
    <div className="scrim" onClick={onClose}>
      <aside className="drawer" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <header className="drawer__head">
          <span className="drawer__title">{draft.name || 'New creator'}</span>
          {creator.id && creator.status === 'active' && (
            <button
              type="button"
              className="icon-btn"
              title="Remove creator"
              onClick={() => onRequestDelete(creator)}
            >
              <Trash2 size={15} />
            </button>
          )}
          <button type="button" className="icon-btn" title="Close" onClick={onClose}>
            <X size={15} />
          </button>
        </header>

        <div className="drawer__body">
          {error && <div className="alert">{error}</div>}

          {GROUPS.map((group) => (
            <section key={group.title}>
              <h3 className="section-title">{group.title}</h3>
              <div className="grid-2">
                {group.keys.map((key) => {
                  const field = FIELDS.find((f) => f.key === key)
                  if (!field) return null
                  return (
                    <FieldInput
                      key={key}
                      field={{ ...field, full: FULL_WIDTH.has(key) }}
                      value={draft[key]}
                      onChange={(v) => setField(key, v)}
                    />
                  )
                })}
              </div>
            </section>
          ))}

          {creator.id ? (
            <NotesFeed notes={draft.notes} onAdd={addNote} />
          ) : (
            <p className="cell-muted" style={{ fontSize: 12 }}>
              Save this creator to start adding notes.
            </p>
          )}
        </div>

        <footer className="drawer__foot">
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy || !dirty || !draft.name}
            onClick={async () => {
              const ok = await persist(draft)
              if (ok) onClose()
            }}
          >
            {busy ? 'Saving…' : 'Save changes'}
          </button>
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
            {dirty ? 'Discard' : 'Close'}
          </button>
          {!draft.name && <span className="cell-muted" style={{ fontSize: 12 }}>Name is required</span>}
        </footer>
      </aside>
    </div>
  )
}
