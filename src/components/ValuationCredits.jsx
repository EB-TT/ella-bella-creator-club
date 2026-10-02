import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  HAIKU_INPUT_PER_MTOK,
  HAIKU_OUTPUT_PER_MTOK,
  USAGE_HINTS,
  creditsRag,
} from '../lib/valuationBenchmarks'
import { formatInt } from '../lib/valuationFormat'
import { Tooltip } from './Tooltip'

// Several valuations finishing together should trigger one balance check.
const REFRESH_DEBOUNCE_MS = 5000
const DONE = new Set(['complete', 'failed'])

function haikuCostThisMonth(rows) {
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  let input = 0
  let output = 0
  for (const r of rows) {
    if (new Date(r.requested_at) < monthStart) continue
    input += Number(r.results?.classifier_tokens?.input) || 0
    output += Number(r.results?.classifier_tokens?.output) || 0
  }
  return (input * HAIKU_INPUT_PER_MTOK + output * HAIKU_OUTPUT_PER_MTOK) / 1_000_000
}

function formatSpend(usd) {
  if (usd > 0 && usd < 0.01) return '<$0.01'
  return `$${usd.toFixed(2)}`
}

/** API usage: Social Fetch credits left (live from the Edge Function) and
    estimated Haiku spend this month (summed from all loaded rows, removed included). */
export function ValuationCredits({ rows, loading, fetchBalance }) {
  const [balance, setBalance] = useState(null)
  const [stale, setStale] = useState(false)
  const timer = useRef(null)
  const seenDone = useRef(null)

  const refresh = useCallback(async () => {
    try {
      setBalance(await fetchBalance())
      setStale(false)
    } catch (err) {
      // Rate-limited or failed: keep the last known value.
      console.warn('Social Fetch balance:', err.message)
      setStale(true)
    }
  }, [fetchBalance])

  useEffect(() => {
    refresh()
    return () => clearTimeout(timer.current)
  }, [refresh])

  // Re-check after a run finishes (seen via Realtime), debounced.
  useEffect(() => {
    if (loading) return
    const done = new Set(rows.filter((r) => DONE.has(r.status)).map((r) => r.id))
    const prev = seenDone.current
    seenDone.current = done
    if (!prev || ![...done].some((id) => !prev.has(id))) return
    clearTimeout(timer.current)
    timer.current = setTimeout(refresh, REFRESH_DEBOUNCE_MS)
  }, [rows, loading, refresh])

  const spend = useMemo(() => haikuCostThisMonth(rows), [rows])
  const credits = balance?.balance ?? null
  const rag = creditsRag(credits)

  return (
    <div className="card vusage">
      <div className="vusage__item">
        <Tooltip text={USAGE_HINTS.socialFetch}>
          <span className="label">Social Fetch</span>
        </Tooltip>
        <span className={`vusage__value${rag ? ` vusage__value--${rag}` : ''}`}>
          {credits == null ? (stale ? 'Unavailable' : 'Checking…') : `${formatInt(credits)} credits left`}
        </span>
        {balance?.included_total > 0 && (
          <span className="cell-muted vusage__sub">
            Plan: {formatInt(balance.included_remaining)} of {formatInt(balance.included_total)} left this period
          </span>
        )}
        {balance?.billing_alert && (
          <span className="vusage__sub vusage__value--red">Billing: {balance.billing_alert.replace(/_/g, ' ')}</span>
        )}
        {stale && credits != null && <span className="cell-muted vusage__sub">Couldn&apos;t refresh</span>}
      </div>

      <div className="vusage__item">
        <Tooltip text={USAGE_HINTS.haiku}>
          <span className="label">Classifier</span>
        </Tooltip>
        <span className="vusage__value">Haiku: ~{formatSpend(spend)} this month</span>
        <a className="vusage__sub" href="https://console.anthropic.com/" target="_blank" rel="noreferrer">
          console.anthropic.com
        </a>
      </div>
    </div>
  )
}
