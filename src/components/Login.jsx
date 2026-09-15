import { useState } from 'react'
import { supabase } from '../lib/supabase'

/* Sign-in only — accounts are created from the Supabase dashboard, by design. */
export function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)

    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError(error.message)
    setBusy(false)
  }

  return (
    <div className="login">
      <form className="card login__card" onSubmit={onSubmit}>
        <h1 className="login__mark">ella bella creator club</h1>
        <p className="login__sub">Sign in to continue.</p>

        {error && <div className="alert">{error}</div>}

        <div className="login__field">
          <label className="label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            className="input"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        <div className="login__field">
          <label className="label" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            className="input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        <button type="submit" className="btn btn--primary btn--block" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        <p className="login__note">
          Need an account? Ask an admin — accounts are created internally.
        </p>
      </form>
    </div>
  )
}
