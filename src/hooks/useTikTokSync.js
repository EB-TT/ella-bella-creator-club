import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { summariseSync } from '../lib/tiktok'

const REFRESH_MS = 60 * 1000

/** Sync status from tiktok_sync_status(), refetched every minute and on demand
    (`refreshStatus`). The app only reads it; the sync itself runs on the hour. */
export function useTikTokSync() {
  const [rows, setRows] = useState(null)
  const [statusError, setStatusError] = useState(null)
  const alive = useRef(true)

  const fetchStatus = useCallback(async () => {
    const { data, error } = await supabase.rpc('tiktok_sync_status')
    if (!alive.current) return null
    if (error) {
      setStatusError(error.message)
      return null
    }
    setStatusError(null)
    setRows(data || [])
    return data || []
  }, [])

  useEffect(() => {
    alive.current = true
    fetchStatus()
    const id = setInterval(fetchStatus, REFRESH_MS)
    return () => {
      alive.current = false
      clearInterval(id)
    }
  }, [fetchStatus])

  const summary = rows ? summariseSync(rows) : null
  return { rows, summary, statusError, refreshStatus: fetchStatus }
}
