import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { SELECT_COLUMNS } from '../lib/fields'

/** Loads every creator row (active and removed) and exposes the write paths.
    ~50 rows today, 1,000+ later — still well within one fetch. */
export function useCreators() {
  const [creators, setCreators] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('creators')
      .select(SELECT_COLUMNS)
      .order('created_at', { ascending: false })

    if (error) setError(error.message)
    else {
      setError(null)
      setCreators((data || []).map((r) => ({ ...r, notes: r.notes || [] })))
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const save = useCallback(async (creator) => {
    const { id, created_at, updated_at, ...patch } = creator

    if (id) {
      const { data, error } = await supabase
        .from('creators')
        .update(patch)
        .eq('id', id)
        .select(SELECT_COLUMNS)
        .single()
      if (error) throw error
      const row = { ...data, notes: data.notes || [] }
      setCreators((prev) => prev.map((c) => (c.id === row.id ? row : c)))
      return row
    }

    const { data, error } = await supabase
      .from('creators')
      .insert(patch)
      .select(SELECT_COLUMNS)
      .single()
    if (error) throw error
    const row = { ...data, notes: data.notes || [] }
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
    const inserted = (data || []).map((r) => ({ ...r, notes: r.notes || [] }))
    setCreators((prev) => [...inserted, ...prev])
    return inserted.length
  }, [])

  return { creators, loading, error, reload: load, save, remove, restore, importRows }
}
