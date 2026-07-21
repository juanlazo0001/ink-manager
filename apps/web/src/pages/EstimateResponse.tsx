import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { apiFetch, ApiError } from '../lib/api'
import { sanitizeHtml } from '../lib/sanitizeHtml'

const INPUT_CLASS =
  'mt-1 w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent'

type PageState = 'loading' | 'invalid' | 'ready' | 'success'
type Decision = 'PROCEED' | 'BUDGET_TOO_HIGH' | 'DECLINE'

interface VerifyResponse {
  clientFirstName: string
  studioName: string
  studioLogoUrl: string | null
  artistName: string | null
  artistAvatarUrl: string | null
  priceEstimateLow: number | null
  priceEstimateHigh: number | null
  timeEstimateHoursMin: number | null
  timeEstimateHoursMax: number | null
  estimateTermsSnapshot: string | null
  collaborativeDesignPolicy: string
}

function formatHourRange(min: number | null, max: number | null): string {
  if (min == null || max == null) return 'To be discussed'
  return min === max ? `${min} hours` : `${min}–${max} hours`
}

export default function EstimateResponse() {
  const { token } = useParams<{ token: string }>()
  const [state, setState] = useState<PageState>('loading')
  const [invalidMessage, setInvalidMessage] = useState('This link is invalid or has expired.')
  const [verifyData, setVerifyData] = useState<VerifyResponse | null>(null)
  const [respondedAs, setRespondedAs] = useState<Decision | null>(null)

  const [activeForm, setActiveForm] = useState<Decision | null>(null)
  const [statedBudget, setStatedBudget] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [pendingDecision, setPendingDecision] = useState<Decision | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) return

    let ignore = false

    apiFetch<VerifyResponse>(`/estimates/verify/${token}`)
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

  async function respond(decision: Decision) {
    if (!token) return

    if (decision === 'BUDGET_TOO_HIGH' && statedBudget.trim().length === 0) {
      setSubmitError('Please let us know what budget would work for you.')
      return
    }

    setSubmitError(null)
    setSubmitting(true)
    setPendingDecision(decision)

    try {
      await apiFetch(`/estimates/respond/${token}`, {
        method: 'PATCH',
        body: JSON.stringify({
          decision,
          statedBudget: decision === 'BUDGET_TOO_HIGH' ? statedBudget.trim() : undefined,
        }),
      })

      setRespondedAs(decision)
      setState('success')
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
      setPendingDecision(null)
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
            <p className="mt-4 text-sm text-fg-secondary">Please contact the studio to request a new estimate.</p>
          </div>
        )}

        {state === 'success' && (
          <div className="text-center">
            <h1 className="text-xl font-semibold text-fg">
              {respondedAs === 'PROCEED' && "Thanks — let's get you scheduled!"}
              {respondedAs === 'BUDGET_TOO_HIGH' && "Thanks for letting us know"}
              {respondedAs === 'DECLINE' && "We're sorry to see you go"}
            </h1>
            <p className="mt-2 text-sm text-fg-secondary">
              {respondedAs === 'PROCEED' &&
                "We've let the studio know you're ready to move forward. They'll be in touch to schedule your appointment."}
              {respondedAs === 'BUDGET_TOO_HIGH' &&
                "We've passed your budget along to the studio — they'll follow up with revised options."}
              {respondedAs === 'DECLINE' &&
                'Thanks for considering us. If anything changes, feel free to reach back out.'}
            </p>
          </div>
        )}

        {state === 'ready' && verifyData && (
          <div>
            {verifyData.studioLogoUrl && (
              <img
                src={verifyData.studioLogoUrl}
                alt={verifyData.studioName}
                className="mb-4 h-10 w-auto object-contain"
              />
            )}
            <h1 className="text-xl font-semibold text-fg">Your Tattoo Estimate</h1>
            <p className="mt-1 text-sm font-medium text-fg-secondary">{verifyData.studioName}</p>
            <div className="mt-3 flex items-center gap-2.5">
              {verifyData.artistName &&
                (verifyData.artistAvatarUrl ? (
                  <img
                    src={verifyData.artistAvatarUrl}
                    alt={verifyData.artistName}
                    className="h-8 w-8 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-inset text-xs font-semibold text-fg">
                    {verifyData.artistName.slice(0, 1).toUpperCase()}
                  </span>
                ))}
              <p className="text-sm text-fg-secondary">
                {verifyData.clientFirstName}, here's what {verifyData.artistName ?? 'your artist'} put together for
                you.
              </p>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">Price range</p>
                <p className="mt-1 text-lg font-semibold text-fg">
                  {verifyData.priceEstimateLow != null && verifyData.priceEstimateHigh != null
                    ? `$${verifyData.priceEstimateLow} – $${verifyData.priceEstimateHigh}`
                    : 'To be discussed'}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">Estimated time</p>
                <p className="mt-1 text-lg font-semibold text-fg">
                  {formatHourRange(verifyData.timeEstimateHoursMin, verifyData.timeEstimateHoursMax)}
                </p>
              </div>
            </div>

            <div className="mt-5 rounded-lg border border-border bg-surface-inset p-3 text-xs text-fg-secondary">
              {verifyData.collaborativeDesignPolicy}
            </div>

            {verifyData.estimateTermsSnapshot && (
              <div className="mt-3 rounded-lg border border-border bg-surface-inset p-3 text-xs text-fg-secondary">
                <p className="mb-1 font-medium uppercase tracking-wider text-fg-muted">Terms &amp; Conditions</p>
                {/* estimateTermsSnapshot may hold rich HTML (saved through
                    Settings' WYSIWYG editor) or older plain text (pre-
                    existing snapshots from before Phase UI-3) -- sanitized
                    either way; the whitespace-pre-wrap class is a cosmetic
                    nicety for the plain-text-newline case, harmless for
                    real HTML content which carries its own block spacing. */}
                <div
                  className="tiptap-content whitespace-pre-wrap"
                  dangerouslySetInnerHTML={{ __html: sanitizeHtml(verifyData.estimateTermsSnapshot) }}
                />
              </div>
            )}

            {submitError && (
              <div className="mt-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                {submitError}
              </div>
            )}

            <div className="mt-6 space-y-3">
              <button
                type="button"
                onClick={() => respond('PROCEED')}
                disabled={submitting}
                className="w-full rounded-full bg-accent px-4 py-2 text-sm font-medium text-bg transition hover:bg-accent-hover disabled:opacity-60"
              >
                {submitting && pendingDecision === 'PROCEED' ? 'Submitting…' : "Proceed — I'm in!"}
              </button>

              {activeForm === 'BUDGET_TOO_HIGH' ? (
                <div className="rounded-lg border border-border p-3">
                  <label className="mb-1 block text-xs font-medium text-fg-secondary">
                    What budget would work for you?
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. $200-300"
                    value={statedBudget}
                    onChange={(e) => setStatedBudget(e.target.value)}
                    className={INPUT_CLASS}
                  />
                  <button
                    type="button"
                    onClick={() => respond('BUDGET_TOO_HIGH')}
                    disabled={submitting}
                    className="mt-3 w-full rounded-full bg-accent px-4 py-2 text-sm font-medium text-bg transition hover:bg-accent-hover disabled:opacity-60"
                  >
                    {submitting && pendingDecision === 'BUDGET_TOO_HIGH' ? 'Submitting…' : 'Send my budget'}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setActiveForm('BUDGET_TOO_HIGH')}
                  className="w-full rounded-full border border-border px-4 py-2 text-sm font-medium text-fg transition hover:bg-surface"
                >
                  This is a bit more than I expected
                </button>
              )}

              <button
                type="button"
                onClick={() => respond('DECLINE')}
                disabled={submitting}
                className="w-full rounded-full border border-border px-4 py-2 text-sm font-medium text-fg-secondary transition hover:bg-surface hover:text-fg disabled:opacity-60"
              >
                {submitting && pendingDecision === 'DECLINE' ? 'Submitting…' : "No thanks, I'm not moving forward"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
