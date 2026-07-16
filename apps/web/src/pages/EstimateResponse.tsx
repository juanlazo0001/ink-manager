import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { apiFetch, ApiError } from '../lib/api'

const INPUT_CLASS =
  'mt-1 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600'

type PageState = 'loading' | 'invalid' | 'ready' | 'success'
type Decision = 'PROCEED' | 'BUDGET_TOO_HIGH' | 'DECLINE'

interface VerifyResponse {
  clientFirstName: string
  studioName: string
  artistName: string | null
  priceEstimateLow: number | null
  priceEstimateHigh: number | null
  timeEstimateHours: number | null
  collaborativeDesignPolicy: string
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
    <div className="flex min-h-screen items-center justify-center bg-neutral-900 px-4 py-10 text-white">
      <div className="w-full max-w-lg rounded-2xl border border-neutral-800 bg-neutral-900 p-8">
        {state === 'loading' && <p className="text-center text-sm text-neutral-400">Loading…</p>}

        {state === 'invalid' && (
          <div className="text-center">
            <h1 className="text-xl font-semibold text-white">This link has expired</h1>
            <p className="mt-2 text-sm text-neutral-400">{invalidMessage}</p>
            <p className="mt-4 text-sm text-neutral-400">Please contact the studio to request a new estimate.</p>
          </div>
        )}

        {state === 'success' && (
          <div className="text-center">
            <h1 className="text-xl font-semibold text-white">
              {respondedAs === 'PROCEED' && "Thanks — let's get you scheduled!"}
              {respondedAs === 'BUDGET_TOO_HIGH' && "Thanks for letting us know"}
              {respondedAs === 'DECLINE' && "We're sorry to see you go"}
            </h1>
            <p className="mt-2 text-sm text-neutral-400">
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
            <h1 className="text-xl font-semibold text-white">Your Tattoo Estimate</h1>
            <p className="mt-1 text-sm text-neutral-400">
              {verifyData.clientFirstName}, here's what {verifyData.artistName ?? 'your artist'} put together for you
              at {verifyData.studioName}.
            </p>

            <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-neutral-500">Price range</p>
                <p className="mt-1 text-lg font-semibold text-white">
                  {verifyData.priceEstimateLow != null && verifyData.priceEstimateHigh != null
                    ? `$${verifyData.priceEstimateLow} – $${verifyData.priceEstimateHigh}`
                    : 'To be discussed'}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-neutral-500">Estimated time</p>
                <p className="mt-1 text-lg font-semibold text-white">
                  {verifyData.timeEstimateHours != null ? `${verifyData.timeEstimateHours} hours` : 'To be discussed'}
                </p>
              </div>
            </div>

            <div className="mt-5 max-h-40 overflow-y-auto rounded-lg border border-neutral-800 bg-neutral-950/40 p-3 text-xs leading-relaxed text-neutral-400">
              <p>{verifyData.collaborativeDesignPolicy}</p>
            </div>

            {submitError && (
              <div className="mt-4 rounded-lg border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-400">
                {submitError}
              </div>
            )}

            <div className="mt-6 space-y-3">
              <button
                type="button"
                onClick={() => respond('PROCEED')}
                disabled={submitting}
                className="w-full rounded-full border border-neutral-700 bg-neutral-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-600 disabled:opacity-60"
              >
                {submitting && pendingDecision === 'PROCEED' ? 'Submitting…' : "Proceed — I'm in!"}
              </button>

              {activeForm === 'BUDGET_TOO_HIGH' ? (
                <div className="rounded-lg border border-neutral-800 p-3">
                  <label className="mb-1 block text-xs font-medium text-neutral-400">
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
                    className="mt-3 w-full rounded-full border border-neutral-700 bg-neutral-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-600 disabled:opacity-60"
                  >
                    {submitting && pendingDecision === 'BUDGET_TOO_HIGH' ? 'Submitting…' : 'Send my budget'}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setActiveForm('BUDGET_TOO_HIGH')}
                  className="w-full rounded-full border border-neutral-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-800"
                >
                  This is a bit more than I expected
                </button>
              )}

              <button
                type="button"
                onClick={() => respond('DECLINE')}
                disabled={submitting}
                className="w-full rounded-full border border-neutral-800 px-4 py-2 text-sm font-medium text-neutral-400 transition hover:bg-neutral-800 hover:text-white disabled:opacity-60"
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
