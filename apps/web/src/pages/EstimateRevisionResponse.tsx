import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { apiFetch, ApiError } from '../lib/api'
import { FlatArtistAvatar } from '../components/ArtistAvatar'
import { applyThemePreset } from '../lib/themePresets'
import PublicPageFooter from '../components/PublicPageFooter'
import { formatPriceEstimate } from '../lib/format'

type PageState = 'loading' | 'invalid' | 'ready' | 'success'
type Decision = 'APPROVE' | 'FLAG'
// Same fix as EstimateResponse.tsx: this heading used to be hardcoded to
// "expired" regardless of the real reason -- a plain never-existed token
// (404) got the same misleading label as a genuinely time-expired one
// (410). This route doesn't (yet) have EstimateResponse.tsx's third
// "superseded" case (revision resends aren't tracked that way), so only
// the two that already existed here.
type InvalidKind = 'invalid' | 'expired'

function invalidKindFromStatus(status: number | undefined): InvalidKind {
  return status === 410 ? 'expired' : 'invalid'
}

const INVALID_HEADINGS: Record<InvalidKind, string> = {
  invalid: 'This link is invalid',
  expired: 'This link has expired',
}

interface VerifyResponse {
  clientFirstName: string
  studioName: string
  studioSlug: string
  studioLogoUrl: string | null
  themePreset: string
  artistName: string | null
  artistAvatarUrl: string | null
  priceEstimateLow: number | null
  priceEstimateHigh: number | null
  timeEstimateHoursMin: number | null
  timeEstimateHoursMax: number | null
  // Multi-session planning: empty for every Project that never declared
  // more than one session -- timeEstimateHoursMin/Max above drive display
  // in that case, exactly as before this feature existed.
  plannedSessions: {
    sessionNumber: number
    // Flat-rate pricing: null when staff chose to hide this session's hour
    // range from the client -- redacted server-side (never sent at all,
    // not just hidden here), so this is a real absence, not empty input.
    estimatedHoursMin: number | null
    estimatedHoursMax: number | null
    estimatedPriceLow: number | null
    estimatedPriceHigh: number | null
  }[]
  reason: string | null
}

function formatHourRange(min: number | null, max: number | null): string {
  if (min == null || max == null) return 'To be discussed'
  return min === max ? `${min} hours` : `${min}–${max} hours`
}

// Distinct from EstimateResponse.tsx (the pre-conversion PROCEED/BUDGET_TOO_HIGH/
// DECLINE flow) -- this page only ever appears for a Project whose estimate
// was revised AFTER the deposit was already paid (see POST /inquiries/:id/
// revise-estimate). There's no PROCEED-to-deposit step here since the
// deposit's already handled; the only two responses are "I approve this
// change" and "I have a concern" (FLAG), neither of which touches the
// Project's scheduling/deposit status -- FLAG just tells staff to follow up.
export default function EstimateRevisionResponse() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const [state, setState] = useState<PageState>('loading')
  const [invalidKind, setInvalidKind] = useState<InvalidKind>('invalid')
  const [invalidMessage, setInvalidMessage] = useState('This link is invalid or has expired.')
  const [verifyData, setVerifyData] = useState<VerifyResponse | null>(null)
  const [respondedAs, setRespondedAs] = useState<Decision | null>(null)

  const [submitting, setSubmitting] = useState(false)
  const [pendingDecision, setPendingDecision] = useState<Decision | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) return

    let ignore = false

    apiFetch<VerifyResponse>(`/estimates/revision/verify/${token}`)
      .then((data) => {
        if (ignore) return
        setVerifyData(data)
        applyThemePreset(data.themePreset)
        setState('ready')
      })
      .catch((err) => {
        if (ignore) return
        setInvalidKind(invalidKindFromStatus(err instanceof ApiError ? err.status : undefined))
        setInvalidMessage(err instanceof Error ? err.message : 'This link is invalid or has expired.')
        setState('invalid')
      })

    return () => {
      ignore = true
    }
  }, [token])

  async function respond(decision: Decision) {
    if (!token) return

    setSubmitError(null)
    setSubmitting(true)
    setPendingDecision(decision)

    try {
      // Token-lifecycle bug fix (Bug B): a revision on a self-scheduling-
      // eligible, not-yet-booked inquiry (POST /inquiries/:id/revise-estimate's
      // own self-scheduling-aware branch) can mint a fresh selfScheduleToken
      // -- mirrors EstimateResponse.tsx's identical PROCEED-branch redirect,
      // only ever present on APPROVE, never FLAG.
      const result = await apiFetch<{ success: true; selfScheduleToken: string | null }>(
        `/estimates/revision/respond/${token}`,
        { method: 'PATCH', body: JSON.stringify({ decision }) },
      )

      if (result.selfScheduleToken) {
        navigate(`/schedule/${result.selfScheduleToken}`, { replace: true })
        return
      }

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
      <div className="w-full max-w-lg rounded-2xl card-surface border border-border bg-surface p-8">
        {state === 'loading' && <p className="text-center text-sm text-fg-secondary">Loading…</p>}

        {state === 'invalid' && (
          <div className="text-center">
            <h1 className="text-xl font-semibold text-fg">{INVALID_HEADINGS[invalidKind]}</h1>
            <p className="mt-2 text-sm text-fg-secondary">{invalidMessage}</p>
            <p className="mt-4 text-sm text-fg-secondary">Please contact the studio if you have questions.</p>
          </div>
        )}

        {state === 'success' && (
          <div className="text-center">
            <h1 className="text-xl font-semibold text-fg">
              {respondedAs === 'APPROVE' ? 'Thanks for confirming!' : 'Thanks for letting us know'}
            </h1>
            <p className="mt-2 text-sm text-fg-secondary">
              {respondedAs === 'APPROVE'
                ? "We've let the studio know you're good with the updated estimate."
                : "We've flagged your concern for the studio -- they'll follow up with you directly."}
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
            <h1 className="text-xl font-semibold text-fg">Your Estimate Has Been Updated</h1>
            <p className="mt-1 text-sm font-medium text-fg-secondary">{verifyData.studioName}</p>
            <div className="mt-3 flex items-center gap-2.5">
              {verifyData.artistName && (
                <FlatArtistAvatar name={verifyData.artistName} avatarUrl={verifyData.artistAvatarUrl} className="h-8 w-8" />
              )}
              <p className="text-sm text-fg-secondary">
                {verifyData.clientFirstName}, here's the updated estimate for your project.
              </p>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">
                  {verifyData.priceEstimateLow != null &&
                  verifyData.priceEstimateHigh != null &&
                  verifyData.priceEstimateLow !== verifyData.priceEstimateHigh
                    ? 'Price range'
                    : 'Price'}
                </p>
                <p className="mt-1 text-lg font-semibold text-fg">
                  {formatPriceEstimate(verifyData.priceEstimateLow, verifyData.priceEstimateHigh) ?? 'To be discussed'}
                </p>
              </div>
              {/* A 1-row plan (flat-rate, staff choosing whether to show
                  this one session's hours) reads the same as no plan at
                  all -- the "N-session plan" breakdown box below is only
                  worth showing once there's an actual multi-session
                  breakdown to see. */}
              {verifyData.plannedSessions.length <= 1 && (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">Estimated time</p>
                  <p className="mt-1 text-lg font-semibold text-fg">
                    {/* A present single session's hours win even when
                        null/redacted -- only fall back to the top-level
                        fields when there's no session row at all. */}
                    {verifyData.plannedSessions.length === 1
                      ? formatHourRange(
                          verifyData.plannedSessions[0].estimatedHoursMin,
                          verifyData.plannedSessions[0].estimatedHoursMax,
                        )
                      : formatHourRange(verifyData.timeEstimateHoursMin, verifyData.timeEstimateHoursMax)}
                  </p>
                </div>
              )}
            </div>

            {verifyData.plannedSessions.length > 1 && (
              <div className="mt-4 rounded-lg border border-border bg-surface-inset p-3">
                <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">
                  {verifyData.plannedSessions.length}-session plan
                </p>
                <ul className="mt-2 space-y-1">
                  {verifyData.plannedSessions.map((session) => (
                    <li key={session.sessionNumber} className="text-sm text-fg">
                      Session {session.sessionNumber}
                      {session.estimatedHoursMin != null && session.estimatedHoursMax != null && (
                        <>: {formatHourRange(session.estimatedHoursMin, session.estimatedHoursMax)}</>
                      )}
                      {session.estimatedPriceLow != null && session.estimatedPriceHigh != null && (
                        <> — {formatPriceEstimate(session.estimatedPriceLow, session.estimatedPriceHigh)}</>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {verifyData.reason && (
              <div className="mt-5 rounded-lg border border-border bg-surface-inset p-3">
                <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">Why this changed</p>
                <p className="mt-1 text-sm text-fg-secondary">{verifyData.reason}</p>
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
                onClick={() => respond('APPROVE')}
                disabled={submitting}
                className="w-full rounded-full bg-accent px-4 py-2 text-sm font-medium text-bg transition hover:bg-accent-hover disabled:opacity-60"
              >
                {submitting && pendingDecision === 'APPROVE' ? 'Submitting…' : 'I approve this change'}
              </button>

              <button
                type="button"
                onClick={() => respond('FLAG')}
                disabled={submitting}
                className="w-full rounded-full border border-border px-4 py-2 text-sm font-medium text-fg-secondary transition hover:bg-surface hover:text-fg disabled:opacity-60"
              >
                {submitting && pendingDecision === 'FLAG' ? 'Submitting…' : 'I have a concern about this'}
              </button>
            </div>
          </div>
        )}

        <PublicPageFooter studioSlug={verifyData?.studioSlug} />
      </div>
    </div>
  )
}
