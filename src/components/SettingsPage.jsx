import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { STAGES, TIERS } from '../lib/journey'
import { formatMoney } from '../lib/format'
import { DEFAULT_STAGE_RULES, TIER_BASES, TIKTOK_HINTS } from '../lib/tiktok'
import { ConfirmModal } from './ConfirmModal'
import { InfoTip } from './SyncMarker'
import { JourneyTierPill } from './Pill'
import { Tooltip } from './Tooltip'

/* Global TikTok settings, for admins (profiles.is_admin). Everything saves
   through security-definer functions, which also re-run the derive so creators
   update straight away. A non-admin who somehow lands here gets a read-only view. */

const PAGE_SIZE = 1000
const DAY = 86400000

const asText = (n) => (n == null ? '' : String(n))

function toForm(settings) {
  const bands = settings?.tier_bands?.bands
  const rules = { ...DEFAULT_STAGE_RULES, ...(settings?.stage_rules || {}) }
  return {
    basis: settings?.tier_bands?.basis || 'all_time',
    mins: Object.fromEntries(
      TIERS.map((t) => [t, asText(Array.isArray(bands) ? bands.find((b) => b?.tier === t)?.min_gmv : '')]),
    ),
    bmContent: asText(rules.build_momentum?.min_content),
    ccContent: asText(rules.consistent_creator?.min_content),
    ccMonths: asText(rules.consistent_creator?.months),
    autoStage: Boolean(settings?.auto_apply_stage),
    autoTier: Boolean(settings?.auto_apply_tier),
  }
}

const wholeNumber = (v) => /^[0-9]{1,6}$/.test(String(v).trim())

/** Same checks as update_tiktok_settings, so the person sees the problem before saving. */
function bandProblem(form) {
  let prev = 0
  for (const t of TIERS) {
    const raw = String(form.mins[t]).trim()
    if (!/^[0-9]+(\.[0-9]{1,2})?$/.test(raw)) return `${t} needs a minimum GMV that is a number.`
    const v = Number(raw)
    if (v <= 0) return `${t} needs a minimum GMV above $0.`
    if (v <= prev) return `Minimum GMV must go up at each tier: ${t} must be above the tier before it.`
    prev = v
  }
  return null
}

function ruleProblem(form) {
  if (![form.bmContent, form.ccContent, form.ccMonths].every(wholeNumber)) return 'Journey rules must be whole numbers.'
  const bm = Number(form.bmContent)
  const cc = Number(form.ccContent)
  const months = Number(form.ccMonths)
  if (bm < 1 || cc < 1) return 'Content counts must be at least 1.'
  if (cc <= bm) return 'Consistent Creator needs more content than Build Momentum.'
  if (months < 1 || months > 12) return 'Months must be between 1 and 12.'
  return null
}

function toPayload(form) {
  return {
    tier_bands: {
      basis: form.basis,
      bands: TIERS.map((t) => ({ tier: t, min_gmv: Number(form.mins[t]) })),
    },
    stage_rules: {
      build_momentum: { min_content: Number(form.bmContent) },
      consistent_creator: { min_content: Number(form.ccContent), months: Number(form.ccMonths) },
    },
    auto_apply_stage: form.autoStage,
    auto_apply_tier: form.autoTier,
  }
}

/** creator_id → GMV for lines in the last `days` days, paged like any PostgREST result. */
async function loadRecentGmv(days) {
  const from = new Date(Date.now() - days * DAY).toISOString()
  const map = new Map()
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .rpc('creator_tiktok_period', { p_from: from, p_to: null })
      .order('creator_id')
      .range(offset, offset + PAGE_SIZE - 1)
    if (error) throw error
    for (const r of data || []) map.set(r.creator_id, Number(r.gmv))
    if (!data || data.length < PAGE_SIZE) break
  }
  return map
}

function Field({ label, hint, htmlFor, children }) {
  return (
    <div className="settings__field">
      <div className="label-row">
        <label className="label" htmlFor={htmlFor}>
          {label}
        </label>
        <InfoTip text={hint} />
      </div>
      {children}
    </div>
  )
}

function Toggle({ id, label, hint, warning, checked, disabled, onChange }) {
  return (
    <div className="settings__toggle">
      <div className="settings__toggle-row">
        <label className="check-row" htmlFor={id}>
          <input
            id={id}
            type="checkbox"
            className="checkbox"
            checked={checked}
            disabled={disabled}
            onChange={(e) => onChange(e.target.checked)}
          />
          {label}
        </label>
        <InfoTip text={hint} />
      </div>
      <p className="field-hint settings__warn">{warning}</p>
    </div>
  )
}

export function SettingsPage({ creators, settings, isAdmin, onBack, onSaved }) {
  const [form, setForm] = useState(() => toForm(settings))
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState(null)

  // Take in the saved values when they arrive or change after a save.
  useEffect(() => setForm(toForm(settings)), [settings])

  const set = (patch) => {
    setSaved(false)
    setForm((f) => ({ ...f, ...patch }))
  }
  const bandError = bandProblem(form)
  const ruleError = ruleProblem(form)
  const canSave = isAdmin && !saving && !bandError && !ruleError

  async function save() {
    setSaving(true)
    setSaveError(null)
    setSaved(false)
    const { error } = await supabase.rpc('update_tiktok_settings', { p: toPayload(form) })
    if (error) setSaveError(error.message)
    else {
      setSaved(true)
      await onSaved()
    }
    setSaving(false)
  }

  // ---- Tier preview ------------------------------------------------------
  const days = form.basis === 'last_30_days' ? 30 : form.basis === 'last_90_days' ? 90 : 0
  const [recent, setRecent] = useState({ days: null, gmv: null, error: null })

  useEffect(() => {
    if (!days) return
    let stale = false
    loadRecentGmv(days)
      .then((gmv) => !stale && setRecent({ days, gmv, error: null }))
      .catch((e) => !stale && setRecent({ days, gmv: null, error: e.message }))
    return () => {
      stale = true
    }
  }, [days])

  const linked = useMemo(() => creators.filter((c) => c.status === 'active' && c.tiktok_creator_id), [creators])

  const preview = useMemo(() => {
    if (bandError) return null
    let source
    if (!days) source = (c) => Number(c.gmv) || 0
    else if (recent.days === days && recent.gmv) source = (c) => recent.gmv.get(c.id) || 0
    else return null
    const bands = TIERS.map((t) => ({ tier: t, min: Number(form.mins[t]) })).reverse() // high → low
    const counts = { none: 0, ...Object.fromEntries(TIERS.map((t) => [t, 0])) }
    for (const c of linked) {
      const gmv = source(c)
      const hit = gmv > 0 ? bands.find((b) => b.min <= gmv) : null
      counts[hit ? hit.tier : 'none'] += 1
    }
    return counts
  }, [bandError, days, recent, linked, form.mins])

  const previewLoading = Boolean(days) && !bandError && recent.days !== days

  // ---- Products ----------------------------------------------------------
  const [products, setProducts] = useState(null)
  const [productError, setProductError] = useState(null)
  const [edits, setEdits] = useState({})
  const [savingProduct, setSavingProduct] = useState(null)

  const loadProducts = async () => {
    const { data, error } = await supabase.rpc('list_tiktok_products')
    if (error) setProductError(error.message)
    else {
      setProductError(null)
      setProducts(data || [])
    }
  }
  useEffect(() => {
    loadProducts()
  }, [])

  async function saveProduct(p) {
    setSavingProduct(p.product_id)
    setProductError(null)
    const { error } = await supabase.rpc('set_product_short_name', {
      p_product_id: p.product_id,
      p_short_name: edits[p.product_id] ?? '',
    })
    if (error) setProductError(error.message)
    else {
      setEdits((e) => {
        const { [p.product_id]: _done, ...rest } = e
        return rest
      })
      await Promise.all([loadProducts(), onSaved()])
    }
    setSavingProduct(null)
  }

  // ---- Bulk actions ------------------------------------------------------
  const [confirm, setConfirm] = useState(null) // 'tier' | 'stage'
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkMessage, setBulkMessage] = useState(null)
  const [bulkError, setBulkError] = useState(null)

  const tierN = useMemo(
    () =>
      creators.filter(
        (c) =>
          c.status === 'active' &&
          c.suggested_tier &&
          TIERS.indexOf(c.suggested_tier) > (c.creator_tier ? TIERS.indexOf(c.creator_tier) : -1),
      ).length,
    [creators],
  )
  const stageN = useMemo(
    () =>
      creators.filter(
        (c) => c.status === 'active' && c.suggested_stage && STAGES.indexOf(c.suggested_stage) > STAGES.indexOf(c.stage),
      ).length,
    [creators],
  )

  async function runBulk() {
    const kind = confirm
    setBulkBusy(true)
    setBulkError(null)
    setBulkMessage(null)
    const { data, error } = await supabase.rpc(
      kind === 'tier' ? 'accept_all_tier_suggestions' : 'accept_all_stage_suggestions',
    )
    if (error) setBulkError(error.message)
    else {
      setBulkMessage(`Accepted ${data} ${kind} suggestion${data === 1 ? '' : 's'}.`)
      await onSaved()
    }
    setBulkBusy(false)
    setConfirm(null)
  }

  const ro = !isAdmin

  return (
    <main className="page settings">
      <div className="settings__top">
        <Tooltip text={TIKTOK_HINTS.settingsBack}>
          <button type="button" className="btn btn--ghost" onClick={onBack}>
            <ArrowLeft size={14} /> Back to creators
          </button>
        </Tooltip>
        <h1 className="settings__title">Settings</h1>
        {ro && (
          <Tooltip text={TIKTOK_HINTS.settingsReadOnly}>
            <span className="pill pill--neutral">Read only</span>
          </Tooltip>
        )}
      </div>

      <section className="card settings__section">
        <h2 className="section-title">Tier bands</h2>
        <div className="settings__grid">
          <Field label="Based on" hint={TIKTOK_HINTS.settingsBasis} htmlFor="set-basis">
            <select
              id="set-basis"
              className="select"
              value={form.basis}
              disabled={ro}
              onChange={(e) => set({ basis: e.target.value })}
            >
              {TIER_BASES.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </select>
          </Field>
          {TIERS.map((t) => (
            <Field key={t} label={`${t} – minimum GMV ($)`} hint={TIKTOK_HINTS.settingsMinGmv} htmlFor={`set-min-${t}`}>
              <input
                id={`set-min-${t}`}
                className="input"
                type="number"
                min="0"
                step="1"
                value={form.mins[t]}
                disabled={ro}
                onChange={(e) => set({ mins: { ...form.mins, [t]: e.target.value } })}
              />
            </Field>
          ))}
        </div>
        {bandError && <div className="alert">{bandError}</div>}

        <div className="settings__preview">
          <div className="label-row">
            <span className="label">With these values</span>
            <InfoTip text={TIKTOK_HINTS.settingsPreview} />
          </div>
          {previewLoading && <span className="cell-muted">Counting…</span>}
          {recent.error && days > 0 && <div className="alert">Couldn't count: {recent.error}</div>}
          {preview && (
            <div className="settings__counts">
              {TIERS.map((t) => (
                <span key={t} className="settings__count">
                  <JourneyTierPill tier={t} /> <strong>{preview[t].toLocaleString('en-US')}</strong>
                </span>
              ))}
              <span className="settings__count">
                <span className="pill pill--neutral">Under {formatMoney(form.mins.Bronze)}</span>{' '}
                <strong>{preview.none.toLocaleString('en-US')}</strong>
              </span>
            </div>
          )}
        </div>
      </section>

      <section className="card settings__section">
        <h2 className="section-title">Journey rules</h2>
        <div className="settings__grid">
          <Field label="Build Momentum – videos or lives that sold" hint={TIKTOK_HINTS.settingsBmContent} htmlFor="set-bm">
            <input
              id="set-bm"
              className="input"
              type="number"
              min="1"
              step="1"
              value={form.bmContent}
              disabled={ro}
              onChange={(e) => set({ bmContent: e.target.value })}
            />
          </Field>
          <span />
          <Field label="Consistent Creator – videos or lives that sold" hint={TIKTOK_HINTS.settingsCcContent} htmlFor="set-cc">
            <input
              id="set-cc"
              className="input"
              type="number"
              min="1"
              step="1"
              value={form.ccContent}
              disabled={ro}
              onChange={(e) => set({ ccContent: e.target.value })}
            />
          </Field>
          <Field label="…or sales in each of the last (months)" hint={TIKTOK_HINTS.settingsCcMonths} htmlFor="set-months">
            <input
              id="set-months"
              className="input"
              type="number"
              min="1"
              max="12"
              step="1"
              value={form.ccMonths}
              disabled={ro}
              onChange={(e) => set({ ccMonths: e.target.value })}
            />
          </Field>
        </div>
        {ruleError && <div className="alert">{ruleError}</div>}
      </section>

      <section className="card settings__section">
        <h2 className="section-title">Automation</h2>
        <Toggle
          id="set-auto-stage"
          label="Apply stage suggestions automatically"
          hint={TIKTOK_HINTS.settingsAutoStage}
          warning={TIKTOK_HINTS.settingsAutoWarn}
          checked={form.autoStage}
          disabled={ro}
          onChange={(v) => set({ autoStage: v })}
        />
        <Toggle
          id="set-auto-tier"
          label="Apply tier suggestions automatically"
          hint={TIKTOK_HINTS.settingsAutoTier}
          warning={TIKTOK_HINTS.settingsAutoWarn}
          checked={form.autoTier}
          disabled={ro}
          onChange={(v) => set({ autoTier: v })}
        />
      </section>

      {!ro && (
        <div className="settings__save">
          <Tooltip text={TIKTOK_HINTS.settingsSave}>
            <button type="button" className="btn btn--primary" disabled={!canSave} onClick={save}>
              {saving ? 'Saving…' : 'Save settings'}
            </button>
          </Tooltip>
          {saved && (
            <span className="alert alert--ok" role="status">
              Saved – creators updated
            </span>
          )}
          {saveError && <span className="alert">{saveError}</span>}
        </div>
      )}

      <section className="card settings__section">
        <div className="label-row">
          <h2 className="section-title" style={{ margin: 0 }}>
            Products
          </h2>
          <InfoTip text={TIKTOK_HINTS.settingsProducts} />
        </div>
        {productError && <div className="alert">{productError}</div>}
        {!products && !productError && <span className="cell-muted">Loading products…</span>}
        {products && (
          <div className="settings__products">
            <div className="settings__prow settings__prow--head">
              <span>Product</span>
              <span>Automatic name</span>
              <span>Your name</span>
              <span />
            </div>
            {products.map((p) => {
              const draft = edits[p.product_id]
              const value = draft ?? p.short_name ?? ''
              const dirty = draft !== undefined && draft.trim() !== (p.short_name ?? '')
              return (
                <div className="settings__prow" key={p.product_id}>
                  <Tooltip text={p.title || p.product_id} width={360}>
                    <span className="settings__trunc">{p.title || p.product_id}</span>
                  </Tooltip>
                  <span className="settings__trunc">{p.auto_name || '—'}</span>
                  <Tooltip text={TIKTOK_HINTS.settingsProductName}>
                    <input
                      className="input"
                      aria-label={`Your name for ${p.auto_name || p.product_id}`}
                      placeholder={p.auto_name || ''}
                      maxLength={80}
                      value={value}
                      disabled={ro}
                      onChange={(e) => setEdits((x) => ({ ...x, [p.product_id]: e.target.value }))}
                    />
                  </Tooltip>
                  {!ro && (
                    <Tooltip text={TIKTOK_HINTS.settingsProductSave}>
                      <button
                        type="button"
                        className="btn btn--outline btn--sm"
                        disabled={!dirty || savingProduct !== null}
                        onClick={() => saveProduct(p)}
                      >
                        {savingProduct === p.product_id ? 'Saving…' : 'Save'}
                      </button>
                    </Tooltip>
                  )}
                </div>
              )
            })}
            {products.length === 0 && <span className="cell-muted">No products yet.</span>}
          </div>
        )}
      </section>

      {!ro && (
        <section className="card settings__section">
          <h2 className="section-title">Bulk actions</h2>
          <div className="settings__bulk">
            <Tooltip text={TIKTOK_HINTS.bulkTier}>
              <button type="button" className="btn btn--outline" disabled={!tierN || bulkBusy} onClick={() => setConfirm('tier')}>
                Accept all tier suggestions ({tierN})
              </button>
            </Tooltip>
            <Tooltip text={TIKTOK_HINTS.bulkStage}>
              <button type="button" className="btn btn--outline" disabled={!stageN || bulkBusy} onClick={() => setConfirm('stage')}>
                Accept all stage suggestions ({stageN})
              </button>
            </Tooltip>
          </div>
          {bulkMessage && (
            <div className="alert alert--ok" role="status">
              {bulkMessage}
            </div>
          )}
          {bulkError && <div className="alert">{bulkError}</div>}
        </section>
      )}

      {confirm && (
        <ConfirmModal
          title={`Accept all ${confirm} suggestions?`}
          message={`This sets the suggested ${confirm} on ${confirm === 'tier' ? tierN : stageN} creators without reviewing them one by one.`}
          confirmLabel="Accept all"
          busy={bulkBusy}
          onConfirm={runBulk}
          onCancel={() => setConfirm(null)}
        />
      )}
    </main>
  )
}
