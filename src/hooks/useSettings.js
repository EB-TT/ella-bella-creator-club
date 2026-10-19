import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

/** Whether the signed-in user is an admin (profiles.is_admin, set by hand in SQL).
    False while loading, and if the column doesn't exist yet. */
export function useIsAdmin(userId) {
  const [isAdmin, setIsAdmin] = useState(false)

  useEffect(() => {
    let cancelled = false
    supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!cancelled) setIsAdmin(!error && data?.is_admin === true)
      })
    return () => {
      cancelled = true
    }
  }, [userId])

  return isAdmin
}

/** The global TikTok settings ({ tier_bands, stage_rules, auto_apply_stage,
    auto_apply_tier }), read by every signed-in user. Null until loaded, or if the
    function isn't there yet. */
export function useTikTokSettings() {
  const [settings, setSettings] = useState(null)

  const reload = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_tiktok_settings')
    if (!error) setSettings(data || null)
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  return { settings, reload }
}
