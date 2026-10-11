import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

/** Team members (one profile per auth user), loaded once and sorted by name.
    Profiles are written by a database trigger, never by the app. */
export function useProfiles() {
  const [profiles, setProfiles] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    supabase
      .from('profiles')
      .select('id, name')
      .order('name')
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) setError(`Could not load team members: ${error.message}`)
        else setProfiles(data || [])
        setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const nameById = useMemo(() => new Map(profiles.map((p) => [p.id, p.name])), [profiles])

  return { profiles, nameById, loaded, error }
}
