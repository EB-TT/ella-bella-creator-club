import { useEffect, useState } from 'react'
import { Check, Copy, Eye, EyeOff } from 'lucide-react'
import { supabase } from '../lib/supabase'

const REDIRECT_URL = 'https://alxzuzxathoqxlrbmbry.supabase.co/functions/v1/tiktok-shop-callback'

async function describeInvokeError(err) {
  try {
    const body = await err.context?.json()
    if (body?.error) return body.error
  } catch {
    /* not JSON — fall through */
  }
  return err.message || 'Could not save the app details'
}

/* Public page (no login) for whoever registers the TikTok Shop app: copy the
   redirect URL, enter the app details once, then authorise. The setup token
   comes from the link and is only held in memory. */
export function TikTokSetup() {
  const [token] = useState(() => new URLSearchParams(window.location.search).get('token')?.trim() || '')
  const [appKey, setAppKey] = useState('')
  const [appSecret, setAppSecret] = useState('')
  const [serviceId, setServiceId] = useState('')
  const [region, setRegion] = useState('')
  const [showSecret, setShowSecret] = useState(false)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(null) // { authorizeUrl }

  // Always light, whatever the CRM theme on this browser is. Not persisted.
  useEffect(() => {
    document.documentElement.className = 'theme-light'
  }, [])

  async function copyRedirect() {
    try {
      await navigator.clipboard.writeText(REDIRECT_URL)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard blocked — the box is selectable */
    }
  }

  async function onSubmit(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)

    const { data, error } = await supabase.functions.invoke('tiktok-shop-setup', {
      body: { token, app_key: appKey, app_secret: appSecret, service_id: serviceId, region },
    })
    if (error) {
      setError(await describeInvokeError(error))
    } else {
      setAppKey('')
      setAppSecret('')
      setServiceId('')
      setRegion('')
      setShowSecret(false)
      setSaved({ authorizeUrl: data?.authorize_url || null })
    }
    setBusy(false)
  }

  if (!supabase || !token) {
    return (
      <div className="login">
        <div className="card login__card">
          <h1 className="login__mark">ella bella creator club</h1>
          <div className="alert">
            {supabase
              ? 'This setup link is incomplete – ask DB for the full link.'
              : 'This page is not configured – ask DB.'}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="login">
      <div className="card setup__card">
        <h1 className="login__mark">ella bella creator club</h1>
        <p className="login__sub">Connect our TikTok Shop.</p>

        <section className="setup__step">
          <h2 className="setup__title">Step 1 – Redirect URL</h2>
          <p className="setup__text">
            Paste this into the Redirect URL field when creating the app in Partner Center.
          </p>
          <div className="setup__copy">
            <input
              className="input"
              readOnly
              value={REDIRECT_URL}
              aria-label="Redirect URL"
              onFocus={(e) => e.target.select()}
            />
            <button type="button" className="btn btn--outline" onClick={copyRedirect}>
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </section>

        <section className="setup__step">
          <h2 className="setup__title">Step 2 – App details</h2>
          {error && <div className="alert">{error}</div>}
          <form onSubmit={onSubmit}>
            <div className="login__field">
              <label className="label" htmlFor="tt-app-key">
                App Key
              </label>
              <input
                id="tt-app-key"
                className="input"
                autoComplete="off"
                spellCheck={false}
                value={appKey}
                onChange={(e) => setAppKey(e.target.value)}
                required
              />
            </div>

            <div className="login__field">
              <label className="label" htmlFor="tt-app-secret">
                App Secret
              </label>
              <div className="setup__copy">
                <input
                  id="tt-app-secret"
                  className="input"
                  type={showSecret ? 'text' : 'password'}
                  autoComplete="new-password"
                  spellCheck={false}
                  value={appSecret}
                  onChange={(e) => setAppSecret(e.target.value)}
                  required
                />
                <button
                  type="button"
                  className="btn btn--outline"
                  onClick={() => setShowSecret((s) => !s)}
                  aria-label={showSecret ? 'Hide secret' : 'Show secret'}
                >
                  {showSecret ? <EyeOff size={14} /> : <Eye size={14} />}
                  {showSecret ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            <div className="login__field">
              <label className="label" htmlFor="tt-service-id">
                Service ID
              </label>
              <input
                id="tt-service-id"
                className="input"
                autoComplete="off"
                spellCheck={false}
                value={serviceId}
                onChange={(e) => setServiceId(e.target.value)}
                required
              />
            </div>

            <fieldset className="setup__radios">
              <legend className="label">Partner Center used</legend>
              {[
                ['us', 'US'],
                ['global', 'Global'],
              ].map(([value, label]) => (
                <label key={value} className="setup__radio">
                  <input
                    type="radio"
                    name="tt-region"
                    value={value}
                    checked={region === value}
                    onChange={() => setRegion(value)}
                    required
                  />
                  {label}
                </label>
              ))}
            </fieldset>

            <button type="submit" className="btn btn--primary btn--block" disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </form>
        </section>

        {saved && (
          <section className="setup__step">
            <div className="alert alert--ok">Saved</div>
            <h2 className="setup__title">Step 3 – Authorise</h2>
            {saved.authorizeUrl ? (
              <a
                className="btn btn--primary btn--block"
                href={saved.authorizeUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Authorise the app
              </a>
            ) : (
              <p className="setup__text">
                In Partner Center go to App &amp; Service → your app → Authorization → Copy
                authorization link, open it and click Authorise.
              </p>
            )}
            <p className="setup__text">You should see “Connected: &lt;your shop&gt;”. That’s it.</p>
          </section>
        )}
      </div>
    </div>
  )
}
