import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { apiFetch } from '../lib/api'

type PageState = 'loading' | 'success' | 'error'

export default function ConfirmEmailChange() {
  const { token } = useParams<{ token: string }>()
  const [state, setState] = useState<PageState>('loading')
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!token) return
    let ignore = false

    // A plain POST on load, not a separate verify-then-confirm step --
    // clicking the emailed link IS the confirmation, there's nothing else
    // for the person to decide once they're here.
    apiFetch<{ message: string }>(`/auth/confirm-email-change/${token}`, { method: 'POST' })
      .then((result) => {
        if (ignore) return
        setMessage(result.message)
        setState('success')
      })
      .catch((err) => {
        if (ignore) return
        setMessage(err instanceof Error ? err.message : 'This link is invalid.')
        setState('error')
      })

    return () => {
      ignore = true
    }
  }, [token])

  return (
    <div className="login-panel-surface relative z-10 w-full max-w-sm p-8 text-center shadow-2xl">
      <img src="/branding/logo-white-512.png" alt="Ink Manager" className="mx-auto mb-2 h-24 w-auto" />

      {state === 'loading' && <p className="mt-4 text-sm text-[var(--login-smoke)]">Confirming…</p>}

      {(state === 'success' || state === 'error') && (
        <>
          <p className="mt-4 text-sm text-[var(--login-cream)]">{message}</p>
          <Link
            to="/login"
            className="login-jura mt-6 inline-block text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--login-gold)] hover:text-[var(--login-gold-hi)]"
          >
            Back to sign in
          </Link>
        </>
      )}
    </div>
  )
}
