import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import { useAuth } from '../context/useAuth'

type PageState = 'loading' | 'invalid' | 'ready' | 'submitting'

interface VerifyResponse {
  studioName: string
  membershipType: 'HOME' | 'GUEST'
  email: string
  identityExists: boolean
}

const MEMBERSHIP_LABEL: Record<VerifyResponse['membershipType'], string> = {
  HOME: 'as their home studio',
  GUEST: 'as a guest artist',
}

// Artist mobility, Part 2: two very different flows behind one URL shape
// (same as InviteAccept.tsx, but branching on identityExists rather than
// always being a fresh account). A brand-new identity sets a password,
// same as a team invite. An existing identity logs in as themselves
// (useAuth().login -- the exact same call the /login page itself uses,
// so nothing about "this person is verified as this account" is
// reinvented here) and THEN accepts while authenticated -- the backend
// route requires that authenticated match before it will touch a real
// existing account.
export default function ArtistInviteAccept() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const { login, setSession } = useAuth()
  const [state, setState] = useState<PageState>('loading')
  const [invalidMessage, setInvalidMessage] = useState('This invite link is invalid.')
  const [data, setData] = useState<VerifyResponse | null>(null)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) return
    let ignore = false

    apiFetch<VerifyResponse>(`/artist-invite/verify/${token}`)
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

  async function acceptWhileAuthenticated() {
    const result = await apiFetch<{ token: string | null; membershipType: string }>(`/artist-invite/accept/${token}`, {
      method: 'POST',
      body: JSON.stringify({}),
    })
    // A HOME acceptance moves the accepting user's studioId/role, so their
    // existing JWT is stale the instant this succeeds -- swap in the fresh
    // one the route returns. A GUEST acceptance never changes studioId/
    // role, so the route returns no token and the current session is
    // already correct as-is.
    if (result.token) {
      setSession(result.token)
    }
    navigate('/profile')
  }

  async function handleNewIdentitySubmit(event: FormEvent) {
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
      const result = await apiFetch<{ token: string }>(`/artist-invite/accept/${token}`, {
        method: 'POST',
        body: JSON.stringify({ password }),
      })
      setSession(result.token)
      navigate('/profile')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
      setState('ready')
    }
  }

  async function handleExistingIdentitySubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setState('submitting')
    try {
      await login(data!.email, password)
      await acceptWhileAuthenticated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
      setState('ready')
    }
  }

  return (
    <div className="login-panel-surface relative z-10 w-full max-w-sm p-8 shadow-2xl">
      <img src="/branding/logo-white-512.png" alt="Ink Manager" className="mx-auto mb-2 h-24 w-auto" />

      {state === 'loading' && <p className="text-center text-sm text-[var(--login-smoke)]">Loading…</p>}

      {state === 'invalid' && (
        <p className="text-center text-sm text-[var(--login-cream)]">{invalidMessage}</p>
      )}

      {(state === 'ready' || state === 'submitting') && data && !data.identityExists && (
        <form onSubmit={handleNewIdentitySubmit}>
          <p className="mb-6 text-center text-sm text-[var(--login-smoke)]">
            You've been invited to join <span className="text-[var(--login-cream)]">{data.studioName}</span>{' '}
            {MEMBERSHIP_LABEL[data.membershipType]}. Set a password to activate your account ({data.email}).
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

      {(state === 'ready' || state === 'submitting') && data && data.identityExists && (
        <form onSubmit={handleExistingIdentitySubmit}>
          <p className="mb-6 text-center text-sm text-[var(--login-smoke)]">
            <span className="text-[var(--login-cream)]">{data.studioName}</span> has invited you to join{' '}
            {MEMBERSHIP_LABEL[data.membershipType]}. You already have an Ink Manager account ({data.email}) — log in
            to accept.
          </p>

          {error && (
            <div className="mb-4 rounded-md border border-red-900/40 bg-red-950/40 px-3 py-2 text-sm text-red-300">
              {error}
            </div>
          )}

          <input
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
            disabled={state === 'submitting'}
            className="login-button login-jura w-full px-4 py-3 text-xs font-bold uppercase disabled:opacity-60"
          >
            {state === 'submitting' ? 'Accepting…' : 'Log in and accept'}
          </button>
        </form>
      )}
    </div>
  )
}
