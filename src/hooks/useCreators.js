import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { FIELDS, SELECT_COLUMNS } from '../lib/fields'
import { isLockedFor, SERVER_OWNED_COLUMNS } from '../lib/tiktok'

/** PostgREST returns at most 1,000 rows per request by default. */
const PAGE_SIZE = 1000

/** jsonb list columns can come back null on rows written outside the app. */
const withLists = (r) => ({
  ...r,
  notes: r.notes || [],
  other_products_received: r.other_products_received || [],
  other_videos: r.other_videos || [],
})

/** Loads every creator row (active and removed), paging through PostgREST's
    1,000-row limit, and exposes the write paths. */
export function useCreators() {
  const [creators, setCreators] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  /** `silent` refetches in the background (after a sync) without the loading state. */
  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true)

    // Ordered by created_at then id: auto-created rows share timestamps, and a
    // stable order is what keeps the pages from overlapping or skipping.
    const byId = new Map()
    let failure = null
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await supabase
        .from('creators')
        .select(SELECT_COLUMNS)
        .order('created_at', { ascending: false })
        .order('id')
        .range(from, from + PAGE_SIZE - 1)
      if (error) {
        failure = error
        break
      }
      // A row inserted mid-load shifts later pages, so de-duplicate by id.
      for (const r of data || []) byId.set(r.id, r)
      if (!data || data.length < PAGE_SIZE) break
    }

    if (failure) setError(failure.message)
    else {
      setError(null)
      setCreators([...byId.values()].map(withLists))
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const save = useCallback(async (creator) => {
    const { id, created_at, updated_at, ...patch } = creator
    // TikTok-owned fields are written by the sync only, never back from the app:
    // always for read-only fields, and per creator for fields TikTok has filled.
    // Current Product and Other Products Received are never stripped.
    for (const f of FIELDS) if (f.readOnly || isLockedFor(creator, f.key)) delete patch[f.key]
    for (const col of SERVER_OWNED_COLUMNS) delete patch[col]

    if (id) {
      const { data, error } = await supabase
        .from('creators')
        .update(patch)
        .eq('id', id)
        .select(SELECT_COLUMNS)
        .single()
      if (error) throw error
      const row = withLists(data)
      setCreators((prev) => prev.map((c) => (c.id === row.id ? row : c)))
      return row
    }

    const { data, error } = await supabase
      .from('creators')
      .insert(patch)
      .select(SELECT_COLUMNS)
      .single()
    if (error) throw error
    const row = withLists(data)
    setCreators((prev) => [row, ...prev])
    return row
  }, [])

  /** Soft delete — never a hard delete anywhere in this app. */
  const remove = useCallback(
    (creator, removedBy) =>
      save({
        ...creator,
        status: 'removed',
        removed_by: removedBy,
        removed_at: new Date().toISOString(),
      }),
    [save]
  )

  const restore = useCallback(
    (creator) => save({ ...creator, status: 'active', removed_by: null, removed_at: null }),
    [save]
  )

  const importRows = useCallback(async (rows) => {
    const { data, error } = await supabase.from('creators').insert(rows).select(SELECT_COLUMNS)
    if (error) throw error
    const inserted = (data || []).map(withLists)
    setCreators((prev) => [...inserted, ...prev])
    return inserted.length
  }, [])

  return { creators, loading, error, reload: load, save, remove, restore, importRows }
}
