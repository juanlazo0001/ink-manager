import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import { useAuth } from '../context/useAuth'

type PageState = 'verifying' | 'error'

// Decision (flagged per the task): logs the owner in directly rather than
// confirming success and bouncing to /login. POST /auth/verify-email/:token
// already returns a real JWT -- the same shape /login itself returns, and
// the same pattern ArtistInviteAccept's new-identity branch already uses
// (setSession + navigate straight into the app) -- so there's nothing left
// to prove by making them type the password they just chose a second time.
// ProtectedRoute's own eligibility check takes it from here: a SOLO
// signup lands on /welcome, a STUDIO signup (once Part 3 exists) on
// /setup, either way via the exact same redirect every other new account
// already goes through.
export default function VerifyEmail() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const { setSession } = useAuth()
  const [state, setState] = useState<PageState>('verifying')
  const [error, setError] = useState('This link is invalid.')

  useEffect(() => {
    if (!token) return
    let ignore = false

    apiFetch<{ token: string }>(`/auth/verify-email/${token}`, { method: 'POST' })
      .then((result) => {
        if (ignore) return
        setSession(result.token)
        navigate('/dashboard')
      })
      .catch((err) => {
        if (ignore) return
        setError(err instanceof Error ? err.message : 'This link is invalid.')
        setState('error')
      })

    return () => {
      ignore = true
    }
  }, [token, setSession, navigate])

  return (
    <div className="login-panel-surface relative z-10 w-full max-w-sm p-8 text-center shadow-2xl">
      <img src="/branding/logo-white-512.png" alt="Ink Manager" className="mx-auto mb-2 h-24 w-auto" />

      {state === 'verifying' && <p className="text-sm text-[var(--login-smoke)]">Verifying your email…</p>}

      {state === 'error' && (
        <>
          <p className="mb-4 text-sm text-[var(--login-cream)]">{error}</p>
          <Link
            to="/login"
            className="login-jura text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--login-gold)] hover:text-[var(--login-gold-hi)]"
          >
            Back to sign in
          </Link>
        </>
      )}
    </div>
  )
}
