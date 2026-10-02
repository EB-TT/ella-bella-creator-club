import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const TABLE = 'creator_valuations'

function upsert(rows, row) {
  const i = rows.findIndex((r) => r.id === row.id)
  if (i === -1) return [row, ...rows]
  const next = [...rows]
  next[i] = { ...rows[i], ...row }
  return next
}

/** The function's own { error } message when it sent one, else the client's. */
async function describeInvokeError(err) {
  try {
    const body = await err.context?.json()
    if (body?.error) return body.error
  } catch {
    /* not JSON — fall through */
  }
  return err.message || 'Could not start the valuation'
}

/** Loads every valuation and keeps them live via Realtime while mounted.
    Results and status are written by the valuate-creator Edge Function;
    the app can only insert requests and edit quoted_rate. */
export function useValuations() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from(TABLE)
      .select('*')
      .order('requested_at', { ascending: false })

    if (error) setError(error.message)
    else {
      setError(null)
      setRows(data || [])
    }
    setLoading(false)
  }, [])

  const merge = useCallback((row) => setRows((prev) => upsert(prev, row)), [])

  useEffect(() => {
    load()

    let subscribedOnce = false
    const channel = supabase
      .channel('creator-valuations')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: TABLE }, (p) => merge(p.new))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: TABLE }, async (p) => {
        merge(p.new)
        // Large jsonb can be dropped from Realtime payloads, so fetch finished rows in full.
        if (p.new.status === 'complete' && !p.new.results) {
          const { data } = await supabase.from(TABLE).select('*').eq('id', p.new.id).single()
          if (data) merge(data)
        }
      })
      .subscribe((status) => {
        // Catch up on anything missed while the socket was reconnecting.
        if (status === 'SUBSCRIBED') {
          if (subscribedOnce) load()
          subscribedOnce = true
        }
      })

    return () => {
      supabase.removeChannel(channel)
    }
  }, [load, merge])

  /** Inserts a pending request and starts the Edge Function. Throws if the insert
      fails; an invoke failure is returned so the caller can show it (the row stays pending). */
  const request = useCallback(
    async ({ platform, handle, quotedRate, requestedByName }) => {
      const { data, error } = await supabase
        .from(TABLE)
        .insert({
          platform,
          handle,
          quoted_rate: quotedRate,
          requested_by_name: requestedByName,
        })
        .select()
        .single()
      if (error) throw error
      merge(data)

      const { error: fnError } = await supabase.functions.invoke('valuate-creator', {
        body: { id: data.id },
      })
      return { row: data, invokeError: fnError ? await describeInvokeError(fnError) : null }
    },
    [merge]
  )

  const setQuotedRate = useCallback(
    async (id, quotedRate) => {
      const { data, error } = await supabase
        .from(TABLE)
        .update({ quoted_rate: quotedRate })
        .eq('id', id)
        .select()
        .single()
      if (error) throw error
      merge(data)
      return data
    },
    [merge]
  )

  return { rows, loading, error, request, setQuotedRate }
}
