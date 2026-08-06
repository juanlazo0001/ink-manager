import { useEffect, useRef, useState } from 'react'
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
  // Guards the actual network call -- StrictMode's dev-only double-invoke
  // (mount -> effect -> synthetic cleanup -> effect again) is harmless for
  // every other effect in this app (idempotent GETs), but this POST
  // consumes a single-use token: a real second request would 404 against
  // an already-cleared token. A ref (not state) survives that synthetic
  // remount without itself re-triggering a render, so the second
  // invocation's guard check sees it and never fires a second request.
  // No `ignore`-flag cleanup on top of that: an early version paired the
  // ref guard with the usual per-invocation `ignore` closure, but the
  // synthetic cleanup flips THAT flag true before the real (first
  // invocation's) response ever arrives -- the request still only fires
  // once, but its own success handler then silently no-ops, so the JWT
  // that came back is just discarded and the page hangs on "Verifying…"
  // forever. Calling setSession/navigate after a real unmount (someone
  // genuinely navigates away mid-request) is harmless either way -- Router
  // navigation and the auth context's own setter don't require this
  // component to still be mounted -- so there's nothing to cancel.
  const startedRef = useRef(false)

  useEffect(() => {
    if (!token || startedRef.current) return
    startedRef.current = true

    apiFetch<{ token: string }>(`/auth/verify-email/${token}`, { method: 'POST' })
      .then((result) => {
        setSession(result.token)
        navigate('/dashboard')
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'This link is invalid.')
        setState('error')
      })
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
