import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { apiFetch } from '../lib/api'

export default function ResetPassword() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)

    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setSubmitting(true)
    try {
      await apiFetch(`/auth/reset-password/${token}`, { method: 'POST', body: JSON.stringify({ newPassword }) })
      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="login-panel-surface relative z-10 w-full max-w-sm p-8 shadow-2xl">
      <img src="/branding/logo-white-512.png" alt="Ink Manager" className="mx-auto mb-2 h-24 w-auto" />

      {done ? (
        <div className="text-center">
          <p className="mt-4 text-sm text-[var(--login-cream)]">
            Your password has been reset. Every other device you were signed in on has been signed out.
          </p>
          <button
            type="button"
            onClick={() => navigate('/login')}
            className="login-button login-jura mt-6 w-full px-4 py-3 text-xs font-bold uppercase"
          >
            Sign in
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          {error && (
            <div className="mb-4 rounded-md border border-red-900/40 bg-red-950/40 px-3 py-2 text-sm text-red-300">
              {error}
            </div>
          )}

          <input
            type="password"
            required
            placeholder="New password"
            aria-label="New password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            className="login-input mb-6 w-full px-3 py-3 text-sm"
          />
          <input
            type="password"
            required
            placeholder="Confirm new password"
            aria-label="Confirm new password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            className="login-input mb-6 w-full px-3 py-3 text-sm"
          />

          <button
            type="submit"
            disabled={submitting}
            className="login-button login-jura w-full px-4 py-3 text-xs font-bold uppercase disabled:opacity-60"
          >
            {submitting ? 'Resetting…' : 'Reset password'}
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
  )
}
