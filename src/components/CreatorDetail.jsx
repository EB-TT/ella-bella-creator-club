import { useEffect, useMemo, useRef, useState } from 'react'
import { Trash2, X } from 'lucide-react'
import { FIELDS } from '../lib/fields'
import {
  applyReviewRule,
  isLockedFor,
  isSynced,
  PERIOD_FIELDS,
  remainingReason,
  TIKTOK_HINTS,
} from '../lib/tiktok'
import { FieldInput } from './FieldInput'
import { NotesFeed } from './NotesFeed'
import { ProductsList } from './ProductsList'
import { ReadOnlyField } from './ReadOnlyField'
import { InfoTip } from './SyncMarker'
import { SuggestionBars } from './SuggestionBar'
import { Tooltip } from './Tooltip'
import { TikTokSection } from './TikTokSection'

const GROUPS = [
  {
    title: 'Creator',
    keys: ['name', 'tiktok_handle', 'instagram_handle', 'email', 'tiktok_shop_eligible', 'shipping_address'],
  },
  { title: 'Journey', keys: ['stage', 'owner_id', 'next_action', 'next_follow_up_date', 'last_contact'] },
  {
    title: 'Product & content',
    keys: [
      'current_product',
      'other_products_received',
      'product_sent_date',
      'product_delivery_date',
      'first_video_date',
      'first_video_link',
      'other_videos',
    ],
  },
  {
    title: 'Performance',
    keys: ['first_sale_date', 'last_sale_at', 'gmv', 'units_sold_current_product', 'units_sold_total', 'creator_tier'],
  },
]

const FULL_WIDTH = new Set(['name', 'next_action', 'first_video_link', 'shipping_address', 'current_product'])

export function CreatorDetail({ creator, authorName, profiles, onSave, onRequestDelete, onClose }) {
  const [draft, setDraft] = useState(creator)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const [updatedInBackground, setUpdatedInBackground] = useState(false)
  const prevCreator = useRef(creator)
  const draftRef = useRef(draft)
  const ownSave = useRef(false)
  draftRef.current = draft

  /* The row can change under an open drawer (a sync, a refresh). After the
     person's own save the draft is simply the saved row. Otherwise, with no
     unsaved edits the draft takes the fresh row; with edits, the fields the
     person changed keep their values, everything else takes the fresh row, and a
     note says so. */
  useEffect(() => {
    const prev = prevCreator.current
    prevCreator.current = creator

    if (ownSave.current) {
      ownSave.current = false
      setError(null)
      setUpdatedInBackground(false)
      setDraft(creator)
      return
    }

    const d = draftRef.current
    const edited = Object.keys(d).filter((k) => JSON.stringify(d[k]) !== JSON.stringify(prev[k]))
    const rebased = { ...creator }
    for (const k of edited) rebased[k] = d[k]
    setUpdatedInBackground(edited.some((k) => JSON.stringify(rebased[k]) !== JSON.stringify(creator[k])))
    setDraft(rebased)
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
    ownSave.current = true
    try {
      await onSave(applyReviewRule(creator, next))
    } catch (e) {
      ownSave.current = false
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

  /* Suggestions and "Mark as reviewed" commit the whole draft, like adding a
     note, so an unsaved edit next to them isn't lost. On success the saved row
     replaces the draft; on failure the bar stays and the error shows. */
  const resolveSuggestion = (kind, accept) => {
    const value = creator[`suggested_${kind}`]
    const next = {
      ...draft,
      [`suggested_${kind}`]: null,
      suggestion_reason: remainingReason(creator, kind),
    }
    if (accept) next[kind === 'stage' ? 'stage' : 'creator_tier'] = value
    else next[`suggestion_dismissed_${kind}`] = value
    return persist(next)
  }

  const markReviewed = () => persist({ ...draft, new_from_tiktok: false })

  return (
    <div className="scrim" onClick={onClose}>
      <aside className="drawer" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <header className="drawer__head">
          <span className="drawer__title">{draft.name || 'New creator'}</span>
          {creator.id && creator.status === 'active' && (
            <Tooltip text={TIKTOK_HINTS.removeCreator}>
              <button
                type="button"
                className="icon-btn"
                aria-label={TIKTOK_HINTS.removeCreator}
                onClick={() => onRequestDelete(creator)}
              >
                <Trash2 size={15} />
              </button>
            </Tooltip>
          )}
          <Tooltip text={TIKTOK_HINTS.closeDrawer}>
            <button type="button" className="icon-btn" aria-label={TIKTOK_HINTS.closeDrawer} onClick={onClose}>
              <X size={15} />
            </button>
          </Tooltip>
        </header>

        <div className="drawer__body">
          {error && <div className="alert">{error}</div>}

          {updatedInBackground && dirty && (
            <div className="suggestion suggestion--neutral" role="status">
              <span className="suggestion__text">
                <strong>Updated in the background</strong>
                <br />
                {TIKTOK_HINTS.updatedInBackgroundNote}
              </span>
            </div>
          )}

          {creator.id && creator.new_from_tiktok && (
            <div className="suggestion suggestion--neutral">
              <span className="suggestion__text">
                <strong>New from TikTok</strong> – created automatically and not yet reviewed.
              </span>
              <InfoTip text={TIKTOK_HINTS.newFromTiktokBar} />
              <Tooltip text={TIKTOK_HINTS.markReviewed}>
                <button type="button" className="btn btn--outline btn--sm" disabled={busy} onClick={markReviewed}>
                  Mark as reviewed
                </button>
              </Tooltip>
            </div>
          )}

          {creator.id && (
            <SuggestionBars
              creator={creator}
              busy={busy}
              onAccept={(kind) => resolveSuggestion(kind, true)}
              onDismiss={(kind) => resolveSuggestion(kind, false)}
            />
          )}

          {GROUPS.map((group) => (
            <section key={group.title}>
              <h3 className="section-title">{group.title}</h3>
              <div className="grid-2">
                {group.keys.map((key) => {
                  const field = FIELDS.find((f) => f.key === key)
                  if (!field) return null
                  const synced = isSynced(creator, key)
                  const syncedAt = creator.tiktok_synced_at
                  const allTime = PERIOD_FIELDS.includes(key)
                  // Read-only: always for Last sale / Other Videos, and for any
                  // field TikTok has filled for this creator. All of them carry the marker.
                  if (field.readOnly || isLockedFor(creator, key)) {
                    return (
                      <ReadOnlyField
                        key={key}
                        field={field}
                        value={creator[key]}
                        synced
                        syncedAt={syncedAt}
                        allTime={allTime}
                      />
                    )
                  }
                  if (field.type === 'products') {
                    return (
                      <ProductsList
                        key={key}
                        field={field}
                        value={draft[key]}
                        onChange={(v) => setField(key, v)}
                        synced={synced}
                        syncedAt={syncedAt}
                      />
                    )
                  }
                  return (
                    <FieldInput
                      key={key}
                      field={{ ...field, full: FULL_WIDTH.has(key) }}
                      value={draft[key]}
                      onChange={(v) => setField(key, v)}
                      profiles={profiles}
                      synced={synced && key === 'current_product'}
                      syncedAt={syncedAt}
                      note={synced && key === 'current_product' ? TIKTOK_HINTS.currentProductEditHint : undefined}
                      allTime={allTime}
                    />
                  )
                })}
              </div>
            </section>
          ))}

          <TikTokSection creator={creator} />

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
