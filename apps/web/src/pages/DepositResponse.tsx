import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import SignaturePad from 'signature_pad'
import { apiFetch, ApiError } from '../lib/api'
import { formatDateTime } from '../lib/format'

const INPUT_CLASS =
  'mt-1 w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent'

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
  const [signatureEmptyError, setSignatureEmptyError] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const signaturePadRef = useRef<SignaturePad | null>(null)

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

  useEffect(() => {
    if (state !== 'ready' || !canvasRef.current) return

    const canvas = canvasRef.current
    const ratio = Math.max(window.devicePixelRatio || 1, 1)
    canvas.width = canvas.offsetWidth * ratio
    canvas.height = canvas.offsetHeight * ratio
    canvas.getContext('2d')?.scale(ratio, ratio)

    const pad = new SignaturePad(canvas, { backgroundColor: 'rgb(255, 255, 255)' })
    signaturePadRef.current = pad

    return () => {
      pad.off()
      signaturePadRef.current = null
    }
  }, [state])

  function handleClearSignature() {
    signaturePadRef.current?.clear()
    setSignatureEmptyError(false)
  }

  const allAgreed = verifyData ? verifyData.terms.every((term) => agreed[term.key]) : false

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!token || !verifyData) return

    if (!allAgreed) {
      setSubmitError('Please agree to every term before signing.')
      return
    }

    if (signatureName.trim().length === 0) {
      setSubmitError('Please type your full name.')
      return
    }

    if (!signaturePadRef.current || signaturePadRef.current.isEmpty()) {
      setSignatureEmptyError(true)
      setSubmitError('Please sign before submitting.')
      return
    }

    setSignatureEmptyError(false)
    setSubmitError(null)
    setSubmitting(true)

    try {
      const signatureData = signaturePadRef.current.toDataURL('image/png')

      await apiFetch(`/deposits/sign/${token}`, {
        method: 'PATCH',
        body: JSON.stringify({
          ...Object.fromEntries(verifyData.terms.map((term) => [term.key, true])),
          signatureName: signatureName.trim(),
          signatureData,
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
    <div className="flex min-h-screen items-center justify-center bg-bg px-4 py-10 text-fg">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-surface p-8">
        {state === 'loading' && <p className="text-center text-sm text-fg-secondary">Loading…</p>}

        {state === 'invalid' && (
          <div className="text-center">
            <h1 className="text-xl font-semibold text-fg">This link has expired</h1>
            <p className="mt-2 text-sm text-fg-secondary">{invalidMessage}</p>
            <p className="mt-4 text-sm text-fg-secondary">Please contact the studio to request a new deposit form.</p>
          </div>
        )}

        {state === 'success' && (
          <div className="text-center">
            <h1 className="text-xl font-semibold text-fg">Thanks — you're all set!</h1>
            <p className="mt-2 text-sm text-fg-secondary">
              Your signed deposit form has been received. No payment has been collected yet — the studio will reach
              out to collect your deposit and confirm your appointment.
            </p>
          </div>
        )}

        {state === 'ready' && verifyData && (
          <div>
            <h1 className="text-xl font-semibold text-fg">Deposit Agreement</h1>
            <p className="mt-1 text-sm font-medium text-fg-secondary">{verifyData.studioName}</p>
            <p className="mt-2 text-sm text-fg-secondary">
              {verifyData.clientFirstName}, please review and sign below to confirm your appointment
              {verifyData.artistName ? ` with ${verifyData.artistName}` : ''}.
            </p>

            {verifyData.appointmentStart && verifyData.appointmentEnd && (
              <div className="mt-4 rounded-lg border border-border p-3">
                <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">Appointment</p>
                <p className="mt-1 text-sm text-fg">
                  {formatDateTime(verifyData.appointmentStart)} – {formatDateTime(verifyData.appointmentEnd)}
                </p>
              </div>
            )}

            <div className="mt-4 grid grid-cols-3 gap-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">Deposit</p>
                <p className="mt-1 text-lg font-semibold text-fg">${verifyData.depositAmount}</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">Fee</p>
                <p className="mt-1 text-lg font-semibold text-fg">${verifyData.feeAmount}</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">Total</p>
                <p className="mt-1 text-lg font-semibold text-fg">${verifyData.totalCharged}</p>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="mt-6 space-y-3">
              <p className="text-sm font-medium text-fg-secondary">Please read and agree to each term:</p>

              {verifyData.terms.map((term) => (
                <label
                  key={term.key}
                  className="flex items-start gap-3 rounded-lg border border-border p-3 text-sm text-fg-secondary"
                >
                  <input
                    type="checkbox"
                    checked={agreed[term.key] ?? false}
                    onChange={(e) => setAgreed({ ...agreed, [term.key]: e.target.checked })}
                    className="mt-0.5 h-4 w-4 shrink-0 rounded border-border bg-surface-inset accent-accent"
                  />
                  <span>{term.label}</span>
                </label>
              ))}

              <div>
                <label className="mb-1 block text-sm font-medium text-fg-secondary">Type your full name</label>
                <input
                  type="text"
                  value={signatureName}
                  onChange={(e) => setSignatureName(e.target.value)}
                  className={INPUT_CLASS}
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-fg-secondary">Sign below</label>
                <div className="overflow-hidden rounded-lg border border-border">
                  <canvas ref={canvasRef} className="h-32 w-full touch-none" />
                </div>
                {signatureEmptyError && <p className="mt-2 text-sm text-danger">Please sign before submitting.</p>}
                <button
                  type="button"
                  onClick={handleClearSignature}
                  className="mt-2 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-fg-secondary transition hover:bg-surface"
                >
                  Clear
                </button>
              </div>

              {submitError && (
                <div className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                  {submitError}
                </div>
              )}

              <button
                type="submit"
                disabled={submitting || !allAgreed}
                className="w-full rounded-full bg-accent px-4 py-2 text-sm font-medium text-bg transition hover:bg-accent-hover disabled:opacity-60"
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
