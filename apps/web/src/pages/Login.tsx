import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import loginBackground from '../assets/login-background-no-artist.png'

// The Ink Manager platform's own login screen -- deliberately a FIXED
// identity, not themed by the per-studio preset system the rest of the
// app uses (lib/themePresets.ts). There's no authenticated studio context
// yet at this point, so per-studio theming doesn't apply here; every
// color/font/radius below is a literal constant from the .login-* classes
// in index.css, not the swappable --color-*/--font-* tokens, so this page
// looks the same regardless of which preset any studio later picks after
// logging in (and regardless of a stale [data-theme] left on <html> from
// a previous session in the same tab).
export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const { login } = useAuth()
  const navigate = useNavigate()

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)

    try {
      await login(email, password)
      navigate('/dashboard')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="login-shell relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-12">
      <img
        src={loginBackground}
        alt=""
        aria-hidden="true"
        className="absolute inset-0 h-full w-full object-cover"
      />
      <div className="hero-shade" aria-hidden="true" />
      <div className="rings" aria-hidden="true">
        <i />
        <i />
        <i />
        <s />
      </div>

      <form onSubmit={handleSubmit} className="login-panel-surface relative z-10 w-full max-w-sm p-8 shadow-2xl">
        <img src="/branding/logo-white-512.png" alt="Ink Manager" className="mx-auto mb-4 h-24 w-auto" />

        {error && (
          <div className="mb-4 rounded-md border border-red-900/40 bg-red-950/40 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}

        <input
          id="email"
          type="email"
          required
          placeholder="Email"
          aria-label="Email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="login-input mb-4 w-full px-3 py-3 text-sm"
        />

        <input
          id="password"
          type="password"
          required
          placeholder="Password"
          aria-label="Password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="login-input mb-6 w-full px-3 py-3 text-sm"
        />

        <button
          type="submit"
          disabled={submitting}
          className="login-button login-jura w-full px-4 py-3 text-xs font-bold uppercase disabled:opacity-60"
        >
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
