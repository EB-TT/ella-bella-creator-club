import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { summariseSync } from '../lib/tiktok'

const REFRESH_MS = 60 * 1000
const POLL_MS = 15 * 1000
const POLL_LIMIT_MS = 5 * 60 * 1000
const NOTICE_MS = 10 * 1000

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Sync status from tiktok_sync_status() plus "Sync now". After Sync now it
    polls every 15 s for up to 5 minutes and calls `onDerived` when the derive
    row's last_success_at changes (that's when creators have new values). */
export function useTikTokSync({ onDerived }) {
  const [rows, setRows] = useState(null)
  const [statusError, setStatusError] = useState(null)
  const [syncing, setSyncing] = useState(false)
  const [notice, setNotice] = useState(null)

  const onDerivedRef = useRef(onDerived)
  const alive = useRef(true)
  const noticeTimer = useRef(null)

  useEffect(() => {
    onDerivedRef.current = onDerived
  }, [onDerived])

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
      clearTimeout(noticeTimer.current)
    }
  }, [fetchStatus])

  const say = useCallback((text, tone = 'info', ephemeral = true) => {
    clearTimeout(noticeTimer.current)
    setNotice({ text, tone })
    if (ephemeral) noticeTimer.current = setTimeout(() => setNotice(null), NOTICE_MS)
  }, [])

  const syncNow = useCallback(async () => {
    setSyncing(true)
    const deriveAt = (r) => r?.find((x) => x.stream === 'derive')?.last_success_at ?? null
    const before = deriveAt(await fetchStatus())

    const { error } = await supabase.functions.invoke('tiktok-shop-sync', { body: { force: true } })
    if (error) {
      say(`Couldn't start the sync: ${error.message}`, 'error')
      setSyncing(false)
      return
    }
    say('Sync started', 'info', false)

    const deadline = Date.now() + POLL_LIMIT_MS
    let done = false
    while (alive.current && Date.now() < deadline) {
      await sleep(POLL_MS)
      if (!alive.current) return
      const now = deriveAt(await fetchStatus())
      if (now && now !== before) {
        onDerivedRef.current?.()
        done = true
        break
      }
    }

    if (!alive.current) return
    say(
      done ? 'Sync finished – creators refreshed' : 'No new data yet – the sync may still be running',
      done ? 'ok' : 'info'
    )
    setSyncing(false)
  }, [fetchStatus, say])

  const summary = rows ? summariseSync(rows) : null
  return { rows, summary, statusError, syncing, syncNow, notice, refreshStatus: fetchStatus }
}
