import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { isPeriodActive, periodKey, periodRange } from '../lib/tiktok'

const PAGE_SIZE = 1000

/** GMV and units per creator for the selected period, as creator_id → { gmv, units }.
    All time returns nothing (the stored totals are used). `refreshKey` refetches
    after a sync. The RPC is paged like any PostgREST result. */
export function usePeriodTotals(period, refreshKey = 0) {
  const key = periodKey(period)
  const [state, setState] = useState({ key: null, totals: null, error: null })

  useEffect(() => {
    if (!isPeriodActive(period)) return
    let stale = false

    ;(async () => {
      const { from, to } = periodRange(period)
      const totals = new Map()
      for (let offset = 0; ; offset += PAGE_SIZE) {
        const { data, error } = await supabase
          .rpc('creator_tiktok_period', { p_from: from, p_to: to })
          .order('creator_id')
          .range(offset, offset + PAGE_SIZE - 1)
        if (stale) return
        if (error) {
          setState({ key, totals: null, error: error.message })
          return
        }
        for (const r of data || []) totals.set(r.creator_id, { gmv: Number(r.gmv), units: Number(r.units) })
        if (!data || data.length < PAGE_SIZE) break
      }
      setState({ key, totals, error: null })
    })()

    return () => {
      stale = true
    }
    // `key` encodes the period; `period` itself changes identity on every render of the parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, refreshKey])

  const active = key !== 'all'
  const current = active && state.key === key
  return {
    totals: current ? state.totals : null,
    loading: active && !current,
    error: current ? state.error : null,
  }
}
