import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import AuthPageChrome from '../components/AuthPageChrome'

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  // Deliberately a single "done" flag, not a distinct success/error state
  // -- the API always returns the same generic response regardless of
  // whether the email matched an account (see POST /auth/forgot-password's
  // own comment), so this page has nothing more specific to show either.
  const [done, setDone] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setSubmitting(true)

    try {
      await apiFetch('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) })
    } catch {
      // Same generic outcome either way -- see above. A network-level
      // failure gets the same "check your email" message rather than a
      // distinct error, since there's no more specific truth to reveal.
    } finally {
      setSubmitting(false)
      setDone(true)
    }
  }

  return (
    <AuthPageChrome>
      <div className="login-panel-surface relative z-10 w-full max-w-sm p-8 shadow-2xl">
        <img src="/branding/logo-white-512.png" alt="Ink Manager" className="mx-auto mb-2 h-24 w-auto" />

        {done ? (
          <div className="text-center">
            <p className="mt-4 text-sm text-[var(--login-cream)]">
              If an account exists for that email, a password reset link has been sent. Check your inbox.
            </p>
            <Link
              to="/login"
              className="login-jura mt-6 inline-block text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--login-gold)] hover:text-[var(--login-gold-hi)]"
            >
              Back to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <p className="mb-4 text-center text-sm text-[var(--login-smoke)]">
              Enter your email and we'll send you a link to reset your password.
            </p>
            <input
              id="email"
              type="email"
              required
              placeholder="Email"
              aria-label="Email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="login-input mb-6 w-full px-3 py-3 text-sm"
            />
            <button
              type="submit"
              disabled={submitting}
              className="login-button login-jura w-full px-4 py-3 text-xs font-bold uppercase disabled:opacity-60"
            >
              {submitting ? 'Sending…' : 'Send reset link'}
            </button>
            <Link
              to="/login"
              className="login-jura mt-4 block text-center text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--login-smoke)] hover:text-[var(--login-cream)]"
            >
              Back to sign in
            </Link>
          </form>
        )}
      </div>
    </AuthPageChrome>
  )
}
