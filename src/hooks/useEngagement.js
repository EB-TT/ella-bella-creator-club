import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

/* A creator's Ella Bella videos and LIVE sessions (creator_videos) with the
   team's likes and comments on them (creator_engagements).

   Ticking a box writes at once and shows at once; if the write fails the box goes
   back and `writeError` says why. Writes to one video run one after another, so
   two quick ticks on a video that has no engagement row yet can't both insert.
   `onChange` runs after each successful write (the drawer uses it to re-read
   the creator, whose Last Engaged is kept up to date by the database). */

/** A video's identity in the list: its TikTok id, or its engagement row for a pasted link. */
const keyOf = (v) => v.video_id ?? `link:${v.engagement_id}`

const COLUMN = { liked: 'liked_at', commented: 'commented_at' }

export function useEngagement(creatorId, onChange) {
  const [state, setState] = useState({ loading: true, videos: [], lives: [], error: null })
  const [writeError, setWriteError] = useState(null)
  const ids = useRef(new Map()) // video key → engagement row id
  const queue = useRef(new Map()) // video key → the last write for it
  const latest = useRef(0) // a slow answer for a previous creator is ignored
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const load = useCallback(
    async ({ silent = false } = {}) => {
      const mine = ++latest.current
      if (!silent) setState({ loading: true, videos: [], lives: [], error: null })
      const { data, error } = await supabase.rpc('creator_videos', { p_creator_id: creatorId })
      if (mine !== latest.current) return
      if (error) {
        setState((s) => ({ ...s, loading: false, error: error.message }))
        return
      }
      const videos = data?.videos || []
      ids.current = new Map(videos.filter((v) => v.engagement_id).map((v) => [keyOf(v), v.engagement_id]))
      setState({ loading: false, videos, lives: data?.lives || [], error: null })
    },
    [creatorId],
  )

  useEffect(() => {
    load()
  }, [load])

  /** Insert the engagement row for a video, or update it if one exists. */
  const write = useCallback(
    async (video, patch) => {
      const key = keyOf(video)
      let id = ids.current.get(key)
      if (!id) {
        const { data, error } = await supabase
          .from('creator_engagements')
          .insert({ creator_id: creatorId, video_id: video.video_id, video_url: video.url, ...patch })
          .select('id')
          .single()
        if (!error) {
          ids.current.set(key, data.id)
          return
        }
        // Someone else logged this video a moment ago: update their row instead.
        if (error.code !== '23505') throw error
        const found = await supabase
          .from('creator_engagements')
          .select('id')
          .eq('creator_id', creatorId)
          .eq('video_id', video.video_id)
          .single()
        if (found.error) throw found.error
        id = found.data.id
        ids.current.set(key, id)
      }
      const { error } = await supabase.from('creator_engagements').update(patch).eq('id', id)
      if (error) throw error
    },
    [creatorId],
  )

  /** Tick or untick Liked / Commented on one listed video. */
  const setTick = useCallback(
    (video, kind, checked) => {
      const key = keyOf(video)
      const col = COLUMN[kind]
      const before = video[col] ?? null
      const stamp = checked ? new Date().toISOString() : null
      const patchRow = (value) =>
        setState((s) => ({ ...s, videos: s.videos.map((v) => (keyOf(v) === key ? { ...v, [col]: value } : v)) }))

      setWriteError(null)
      patchRow(stamp)
      const run = (queue.current.get(key) ?? Promise.resolve())
        .then(() => write(video, { [col]: stamp }))
        .then(() => onChangeRef.current?.())
        .catch((e) => {
          patchRow(before)
          setWriteError(e.message || 'Could not save that.')
        })
      queue.current.set(key, run)
    },
    [write],
  )

  /** Log a like and/or comment on a video by its link (no video id). Resolves true when saved. */
  const logLink = useCallback(
    async ({ url, liked, commented, featured }) => {
      const now = new Date().toISOString()
      setWriteError(null)
      const { error } = await supabase.from('creator_engagements').insert({
        creator_id: creatorId,
        video_id: null,
        video_url: url,
        liked_at: liked ? now : null,
        commented_at: commented ? now : null,
        featured_ella_bella: featured,
      })
      if (error) {
        setWriteError(error.message)
        return false
      }
      await load({ silent: true })
      onChangeRef.current?.()
      return true
    },
    [creatorId, load],
  )

  return { ...state, writeError, setTick, logLink }
}
