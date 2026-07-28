import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import { TOKEN_STORAGE_KEY } from '../context/auth-context'
import { formatStatus } from '../lib/format'
import AuthPageChrome from '../components/AuthPageChrome'

type PageState = 'loading' | 'invalid' | 'ready' | 'submitting'

interface VerifyResponse {
  studioName: string
  role: string
  email: string
}

export default function InviteAccept() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const [state, setState] = useState<PageState>('loading')
  const [invalidMessage, setInvalidMessage] = useState('This invite link is invalid.')
  const [data, setData] = useState<VerifyResponse | null>(null)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) return
    let ignore = false

    apiFetch<VerifyResponse>(`/invite/verify/${token}`)
      .then((result) => {
        if (ignore) return
        setData(result)
        setState('ready')
      })
      .catch((err) => {
        if (ignore) return
        setInvalidMessage(err instanceof Error ? err.message : 'This invite link is invalid.')
        setState('invalid')
      })

    return () => {
      ignore = true
    }
  }, [token])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)

    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setState('submitting')
    try {
      const result = await apiFetch<{ token: string }>(`/invite/accept/${token}`, {
        method: 'POST',
        body: JSON.stringify({ password }),
      })
      // Same as a real login -- store the token and land in the app,
      // rather than sending a brand-new user back to a login form to
      // re-enter the password they just chose seconds ago.
      localStorage.setItem(TOKEN_STORAGE_KEY, result.token)
      navigate('/dashboard')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
      setState('ready')
    }
  }

  return (
    <AuthPageChrome>
      <div className="login-panel-surface relative z-10 w-full max-w-sm p-8 shadow-2xl">
        <img src="/branding/logo-white-512.png" alt="Ink Manager" className="mx-auto mb-2 h-24 w-auto" />

        {state === 'loading' && <p className="text-center text-sm text-[var(--login-smoke)]">Loading…</p>}

        {state === 'invalid' && (
          <p className="text-center text-sm text-[var(--login-cream)]">{invalidMessage}</p>
        )}

        {(state === 'ready' || state === 'submitting') && data && (
          <form onSubmit={handleSubmit}>
            <p className="mb-6 text-center text-sm text-[var(--login-smoke)]">
              You've been invited to join <span className="text-[var(--login-cream)]">{data.studioName}</span> as
              a{data.role === 'OWNER' ? 'n' : ''} <span className="text-[var(--login-cream)]">{formatStatus(data.role)}</span>.
              Set a password to activate your account ({data.email}).
            </p>

            {error && (
              <div className="mb-4 rounded-md border border-red-900/40 bg-red-950/40 px-3 py-2 text-sm text-red-300">
                {error}
              </div>
            )}

            <input
              type="password"
              required
              placeholder="Choose a password"
              aria-label="Choose a password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="login-input mb-6 w-full px-3 py-3 text-sm"
            />
            <input
              type="password"
              required
              placeholder="Confirm password"
              aria-label="Confirm password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              className="login-input mb-6 w-full px-3 py-3 text-sm"
            />

            <button
              type="submit"
              disabled={state === 'submitting'}
              className="login-button login-jura w-full px-4 py-3 text-xs font-bold uppercase disabled:opacity-60"
            >
              {state === 'submitting' ? 'Activating…' : 'Activate account'}
            </button>
          </form>
        )}
      </div>
    </AuthPageChrome>
  )
}
