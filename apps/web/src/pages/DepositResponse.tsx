import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { apiFetch, ApiError } from '../lib/api'
import { formatDateTime } from '../lib/format'

const INPUT_CLASS =
  'mt-1 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600'

type PageState = 'loading' | 'invalid' | 'ready' | 'success'

interface Term {
  key: string
  label: string
}

interface VerifyResponse {
  clientFirstName: string
  studioName: string
  artistName: string | null
  appointmentStart: string | null
  appointmentEnd: string | null
  depositAmount: number
  feeAmount: number
  totalCharged: number
  terms: Term[]
}

export default function DepositResponse() {
  const { token } = useParams<{ token: string }>()
  const [state, setState] = useState<PageState>('loading')
  const [invalidMessage, setInvalidMessage] = useState('This link is invalid or has expired.')
  const [verifyData, setVerifyData] = useState<VerifyResponse | null>(null)

  const [agreed, setAgreed] = useState<Record<string, boolean>>({})
  const [signatureName, setSignatureName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) return

    let ignore = false

    apiFetch<VerifyResponse>(`/deposits/verify/${token}`)
      .then((data) => {
        if (ignore) return
        setVerifyData(data)
        setState('ready')
      })
      .catch((err) => {
        if (ignore) return
        setInvalidMessage(err instanceof Error ? err.message : 'This link is invalid or has expired.')
        setState('invalid')
      })

    return () => {
      ignore = true
    }
  }, [token])

  const allAgreed = verifyData ? verifyData.terms.every((term) => agreed[term.key]) : false

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!token || !verifyData) return

    if (!allAgreed) {
      setSubmitError('Please agree to every term before signing.')
      return
    }

    if (signatureName.trim().length === 0) {
      setSubmitError('Please type your name as your signature.')
      return
    }

    setSubmitError(null)
    setSubmitting(true)

    try {
      await apiFetch(`/deposits/sign/${token}`, {
        method: 'PATCH',
        body: JSON.stringify({
          ...Object.fromEntries(verifyData.terms.map((term) => [term.key, true])),
          signatureName: signatureName.trim(),
        }),
      })

      setState('success')
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-900 px-4 py-10 text-white">
      <div className="w-full max-w-lg rounded-2xl border border-neutral-800 bg-neutral-900 p-8">
        {state === 'loading' && <p className="text-center text-sm text-neutral-400">Loading…</p>}

        {state === 'invalid' && (
          <div className="text-center">
            <h1 className="text-xl font-semibold text-white">This link has expired</h1>
            <p className="mt-2 text-sm text-neutral-400">{invalidMessage}</p>
            <p className="mt-4 text-sm text-neutral-400">Please contact the studio to request a new deposit form.</p>
          </div>
        )}

        {state === 'success' && (
          <div className="text-center">
            <h1 className="text-xl font-semibold text-white">Thanks — you're all set!</h1>
            <p className="mt-2 text-sm text-neutral-400">
              Your signed deposit form has been received. No payment has been collected yet — the studio will reach
              out to collect your deposit and confirm your appointment.
            </p>
          </div>
        )}

        {state === 'ready' && verifyData && (
          <div>
            <h1 className="text-xl font-semibold text-white">Deposit Agreement</h1>
            <p className="mt-1 text-sm text-neutral-400">
              {verifyData.clientFirstName}, please review and sign below to confirm your appointment
              {verifyData.artistName ? ` with ${verifyData.artistName}` : ''} at {verifyData.studioName}.
            </p>

            {verifyData.appointmentStart && verifyData.appointmentEnd && (
              <div className="mt-4 rounded-lg border border-neutral-800 p-3">
                <p className="text-xs font-medium uppercase tracking-wider text-neutral-500">Appointment</p>
                <p className="mt-1 text-sm text-white">
                  {formatDateTime(verifyData.appointmentStart)} – {formatDateTime(verifyData.appointmentEnd)}
                </p>
              </div>
            )}

            <div className="mt-4 grid grid-cols-3 gap-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-neutral-500">Deposit</p>
                <p className="mt-1 text-lg font-semibold text-white">${verifyData.depositAmount}</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-neutral-500">Fee</p>
                <p className="mt-1 text-lg font-semibold text-white">${verifyData.feeAmount}</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-neutral-500">Total</p>
                <p className="mt-1 text-lg font-semibold text-white">${verifyData.totalCharged}</p>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="mt-6 space-y-3">
              <p className="text-sm font-medium text-neutral-300">Please read and agree to each term:</p>

              {verifyData.terms.map((term) => (
                <label
                  key={term.key}
                  className="flex items-start gap-3 rounded-lg border border-neutral-800 p-3 text-sm text-neutral-300"
                >
                  <input
                    type="checkbox"
                    checked={agreed[term.key] ?? false}
                    onChange={(e) => setAgreed({ ...agreed, [term.key]: e.target.checked })}
                    className="mt-0.5 h-4 w-4 shrink-0 rounded border-neutral-700 bg-neutral-900"
                  />
                  <span>{term.label}</span>
                </label>
              ))}

              <div>
                <label className="mb-1 block text-sm font-medium text-neutral-300">
                  Type your full name as your signature
                </label>
                <input
                  type="text"
                  value={signatureName}
                  onChange={(e) => setSignatureName(e.target.value)}
                  className={INPUT_CLASS}
                />
              </div>

              {submitError && (
                <div className="rounded-lg border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-400">
                  {submitError}
                </div>
              )}

              <button
                type="submit"
                disabled={submitting || !allAgreed}
                className="w-full rounded-full border border-neutral-700 bg-neutral-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-600 disabled:opacity-60"
              >
                {submitting ? 'Submitting…' : 'Sign and Confirm'}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  )
}
