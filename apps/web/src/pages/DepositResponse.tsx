import { useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { apiFetch, ApiError } from '../lib/api'
import { formatDateTime } from '../lib/format'
import { FlatArtistAvatar } from '../components/ArtistAvatar'
import { applyThemePreset } from '../lib/themePresets'
import PublicPageFooter from '../components/PublicPageFooter'
import SignaturePadField, { type SignaturePadHandle } from '../components/SignaturePadField'

const INPUT_CLASS =
  'mt-1 w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent'

type PageState = 'loading' | 'invalid' | 'ready' | 'success'

interface Term {
  key: string
  label: string
}

interface VerifyResponse {
  clientFirstName: string
  clientReferralCode: string
  referralProgramEnabled: boolean
  studioName: string
  studioSlug: string
  artistName: string | null
  artistAvatarUrl: string | null
  appointmentStart: string | null
  appointmentEnd: string | null
  proposedStartAt: string | null
  proposedEndAt: string | null
  themePreset: string
  depositAmount: number
  feeAmount: number
  totalCharged: number
  depositBreakdownNote: string | null
  // Multi-session planning: null for every un-planned deposit form
  // (today's default).
  plannedSession: {
    sessionNumber: number
    totalSessions: number
    // Flat-rate pricing: null when staff chose to hide this session's hour
    // range from the client -- redacted server-side (never sent at all).
    estimatedHoursMin: number | null
    estimatedHoursMax: number | null
  } | null
  // Phase 7C: paidVia set means a real payment (Stripe or manual) already
  // happened -- a genuine success state, shown regardless of the token's
  // own expiration. signedAt + stripeConnected (both unpaid) means "show a
  // Pay Now button" instead of the sign form; signedAt alone (Stripe not
  // connected for this studio) is today's original "we'll collect it
  // separately" flow.
  signedAt: string | null
  paidVia: 'STRIPE' | 'MANUAL' | null
  stripeConnected: boolean
  terms: Term[]
}

export default function DepositResponse() {
  const { token } = useParams<{ token: string }>()
  const [searchParams] = useSearchParams()
  const justReturnedFromStripe = searchParams.get('paid') === '1'

  const [state, setState] = useState<PageState>('loading')
  const [invalidMessage, setInvalidMessage] = useState('This link is invalid or has expired.')
  const [verifyData, setVerifyData] = useState<VerifyResponse | null>(null)

  const [agreed, setAgreed] = useState<Record<string, boolean>>({})
  const [signatureName, setSignatureName] = useState('')
  const [signatureEmptyError, setSignatureEmptyError] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const [payingNow, setPayingNow] = useState(false)
  const [payError, setPayError] = useState<string | null>(null)
  // Set only right after returning from Stripe -- the checkout.session.completed
  // webhook is usually near-instant, but not guaranteed to have landed by
  // the time the browser's own redirect completes, so this briefly polls
  // rather than showing a stale "pay now" button for a payment that
  // actually already succeeded.
  const [confirmingPayment, setConfirmingPayment] = useState(justReturnedFromStripe)

  const signaturePadRef = useRef<SignaturePadHandle | null>(null)

  useEffect(() => {
    if (!token) return

    let ignore = false
    let pollAttempts = 0

    function load() {
      apiFetch<VerifyResponse>(`/deposits/verify/${token}`)
        .then((data) => {
          if (ignore) return
          setVerifyData(data)
          applyThemePreset(data.themePreset)
          setState('ready')

          if (justReturnedFromStripe && !data.paidVia && pollAttempts < 5) {
            pollAttempts += 1
            setTimeout(load, 1500)
          } else {
            setConfirmingPayment(false)
          }
        })
        .catch((err) => {
          if (ignore) return
          setInvalidMessage(err instanceof Error ? err.message : 'This link is invalid or has expired.')
          setState('invalid')
          setConfirmingPayment(false)
        })
    }

    load()

    return () => {
      ignore = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      const signatureData = signaturePadRef.current.toDataURL()

      const result = await apiFetch<{ success: true; stripeConnected: boolean }>(`/deposits/sign/${token}`, {
        method: 'PATCH',
        body: JSON.stringify({
          ...Object.fromEntries(verifyData.terms.map((term) => [term.key, true])),
          signatureName: signatureName.trim(),
          signatureData,
        }),
      })

      if (result.stripeConnected) {
        // Redirect straight to Stripe's hosted checkout rather than
        // showing the "we'll collect it separately" screen -- reuses the
        // same checkout-session endpoint a return visit's "Pay Now" button
        // calls, so there's exactly one place that creates the session.
        await goToStripeCheckout()
      } else {
        setState('success')
      }
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  async function goToStripeCheckout() {
    if (!token) return
    setPayingNow(true)
    setPayError(null)
    try {
      const { url } = await apiFetch<{ url: string }>(`/deposits/${token}/checkout-session`, { method: 'POST' })
      window.location.href = url
    } catch (err) {
      setPayError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
      setPayingNow(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4 py-10 text-fg">
      <div className="w-full max-w-lg rounded-2xl card-surface border border-border bg-surface p-8">
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

        {state === 'ready' && verifyData && verifyData.paidVia && (
          <div className="text-center">
            <h1 className="text-xl font-semibold text-fg">Thanks — your deposit is paid!</h1>
            <p className="mt-2 text-sm text-fg-secondary">
              {verifyData.paidVia === 'STRIPE'
                ? "We've received your payment and confirmed your appointment."
                : 'The studio has recorded your payment and confirmed your appointment.'}
            </p>

            {verifyData.referralProgramEnabled && (
              <div className="mt-5 rounded-lg border border-accent/30 bg-accent/5 p-4 text-left">
                <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">Know someone else who'd love this?</p>
                <p className="mt-1 text-sm text-fg-secondary">
                  Share your referral code — when a friend you refer pays their own deposit, you'll earn a reward.
                </p>
                <p className="mt-2 text-center font-mono text-lg font-semibold tracking-widest text-fg">
                  {verifyData.clientReferralCode}
                </p>
              </div>
            )}
          </div>
        )}

        {state === 'ready' && verifyData && !verifyData.paidVia && confirmingPayment && (
          <div className="text-center">
            <h1 className="text-xl font-semibold text-fg">Confirming your payment…</h1>
            <p className="mt-2 text-sm text-fg-secondary">This should only take a moment.</p>
          </div>
        )}

        {state === 'ready' && verifyData && !verifyData.paidVia && !confirmingPayment && verifyData.signedAt && verifyData.stripeConnected && (
          <div>
            <h1 className="text-xl font-semibold text-fg">Deposit Agreement Signed</h1>
            <p className="mt-1 text-sm font-medium text-fg-secondary">{verifyData.studioName}</p>
            <p className="mt-2 text-sm text-fg-secondary">
              {verifyData.clientFirstName}, your agreement is on file. Pay your deposit below to confirm your
              appointment.
            </p>

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

            {verifyData.depositBreakdownNote && (
              <p className="mt-2 text-xs text-fg-muted">{verifyData.depositBreakdownNote}</p>
            )}

            {payError && (
              <div className="mt-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                {payError}
              </div>
            )}

            <button
              type="button"
              onClick={goToStripeCheckout}
              disabled={payingNow}
              className="mt-6 w-full rounded-full bg-accent px-4 py-2 text-sm font-medium text-bg transition hover:bg-accent-hover disabled:opacity-60"
            >
              {payingNow ? 'Redirecting…' : `Pay $${verifyData.totalCharged}`}
            </button>
          </div>
        )}

        {state === 'ready' &&
          verifyData &&
          !verifyData.paidVia &&
          !confirmingPayment &&
          verifyData.signedAt &&
          !verifyData.stripeConnected && (
            <div className="text-center">
              <h1 className="text-xl font-semibold text-fg">Thanks — you're all set!</h1>
              <p className="mt-2 text-sm text-fg-secondary">
                Your signed deposit form has been received. No payment has been collected yet — the studio will
                reach out to collect your deposit and confirm your appointment.
              </p>
            </div>
        )}

        {state === 'ready' && verifyData && !verifyData.paidVia && !confirmingPayment && !verifyData.signedAt && (
          <div>
            <h1 className="text-xl font-semibold text-fg">Deposit Agreement</h1>
            <p className="mt-1 text-sm font-medium text-fg-secondary">{verifyData.studioName}</p>
            {verifyData.artistName && (
              <div className="mt-3 flex items-center gap-2">
                <FlatArtistAvatar name={verifyData.artistName} avatarUrl={verifyData.artistAvatarUrl} className="h-7 w-7" />
                <p className="text-sm font-medium text-fg">{verifyData.artistName}</p>
              </div>
            )}
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

            {/* A real appointment (above) always takes precedence -- this is
                purely informational and never implies a confirmed booking. */}
            {!verifyData.appointmentStart && verifyData.proposedStartAt && verifyData.proposedEndAt && (
              <div className="mt-4 rounded-lg border border-border bg-surface-inset p-3">
                <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">Tentative Time</p>
                <p className="mt-1 text-sm text-fg">
                  Your appointment will be tentatively scheduled for{' '}
                  {formatDateTime(verifyData.proposedStartAt)} – {formatDateTime(verifyData.proposedEndAt)}, pending
                  your deposit. We'll confirm exact scheduling once payment is received.
                </p>
              </div>
            )}

            {/* Multi-session planning: only present when this deposit form
                was generated for a specific planned session. */}
            {verifyData.plannedSession && (
              <div className="mt-4 rounded-lg border border-border bg-surface-inset p-3">
                <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">
                  Session {verifyData.plannedSession.sessionNumber} of {verifyData.plannedSession.totalSessions}
                </p>
                {verifyData.plannedSession.estimatedHoursMin != null && verifyData.plannedSession.estimatedHoursMax != null && (
                  <p className="mt-1 text-sm text-fg">
                    Estimated {verifyData.plannedSession.estimatedHoursMin}-{verifyData.plannedSession.estimatedHoursMax}{' '}
                    hours
                  </p>
                )}
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

            {verifyData.depositBreakdownNote && (
              <p className="mt-2 text-xs text-fg-muted">{verifyData.depositBreakdownNote}</p>
            )}

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

              <SignaturePadField
                ref={signaturePadRef}
                label="Sign below"
                showError={signatureEmptyError}
                onClear={() => setSignatureEmptyError(false)}
              />

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

        <PublicPageFooter studioSlug={verifyData?.studioSlug} />
      </div>
    </div>
  )
}
