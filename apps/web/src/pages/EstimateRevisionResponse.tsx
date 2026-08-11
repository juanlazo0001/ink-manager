import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { apiFetch, ApiError } from '../lib/api'
import { FlatArtistAvatar } from '../components/ArtistAvatar'
import PublicPageFooter from '../components/PublicPageFooter'
import { formatPriceEstimate } from '../lib/format'
import { LocaleProvider, useLocale, useTranslations } from '../i18n'
import { crossfadeVariants, uiSpringTransition } from '../lib/motion'

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
  // Multi-language public forms: which locale the API actually resolved
  // (explicit ?locale= > this client's own stored preference > the
  // studio's own default) -- synced back into LocaleProvider on load,
  // same pattern as every other flow's own verify response.
  resolvedLocale?: string
}

// Distinct from EstimateResponse.tsx (the pre-conversion PROCEED/BUDGET_TOO_HIGH/
// DECLINE flow) -- this page only ever appears for a Project whose estimate
// was revised AFTER the deposit was already paid (see POST /inquiries/:id/
// revise-estimate). There's no PROCEED-to-deposit step here since the
// deposit's already handled; the only two responses are "I approve this
// change" and "I have a concern" (FLAG), neither of which touches the
// Project's scheduling/deposit status -- FLAG just tells staff to follow up.
export default function EstimateRevisionResponse() {
  return (
    <LocaleProvider>
      <EstimateRevisionResponseContent />
    </LocaleProvider>
  )
}

function EstimateRevisionResponseContent() {
  const { t } = useTranslations()
  const { locale, setLocale } = useLocale()

  const INVALID_HEADINGS: Record<InvalidKind, string> = {
    invalid: t('common.linkInvalidHeading'),
    expired: t('common.linkExpiredHeading'),
  }

  // See EstimateResponse.tsx's identical helper for why only the
  // single-number case needs to pick a word form.
  function formatHourRange(min: number | null, max: number | null): string {
    if (min == null || max == null) return t('estimate.toBeDiscussed')
    if (min === max) return `${min} ${min === 1 ? t('estimate.hourSingular') : t('estimate.hourPlural')}`
    return `${min}–${max} ${t('estimate.hourPlural')}`
  }

  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const [state, setState] = useState<PageState>('loading')
  const [invalidKind, setInvalidKind] = useState<InvalidKind>('invalid')
  const [invalidMessage, setInvalidMessage] = useState(t('common.linkExpiredHeading'))
  const [verifyData, setVerifyData] = useState<VerifyResponse | null>(null)
  const [respondedAs, setRespondedAs] = useState<Decision | null>(null)

  const [submitting, setSubmitting] = useState(false)
  const [pendingDecision, setPendingDecision] = useState<Decision | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) return

    let ignore = false

    // Fix pass: no explicit ?locale= on this first fetch -- see
    // EstimateResponse.tsx's identical comment. This page has no
    // server-resolved, locale-dependent content beyond the initial
    // resolvedLocale sync (its `reason` field is a one-off staff-typed
    // message, not studio-translatable template content), so unlike
    // Estimate/Deposit/Waiver there's no need for a second, toggle-
    // triggered re-fetch here.
    apiFetch<VerifyResponse>(`/estimates/revision/verify/${token}`)
      .then((data) => {
        if (ignore) return
        setVerifyData(data)
        // Server-resolved locale (client's own stored preference or the
        // studio's default) wins on first load.
        if (data.resolvedLocale && data.resolvedLocale !== locale) setLocale(data.resolvedLocale as typeof locale)
        setState('ready')
      })
      .catch((err) => {
        if (ignore) return
        setInvalidKind(invalidKindFromStatus(err instanceof ApiError ? err.status : undefined))
        setInvalidMessage(err instanceof Error ? err.message : t('common.linkExpiredHeading'))
        setState('invalid')
      })

    return () => {
      ignore = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      setSubmitError(err instanceof ApiError ? err.message : t('common.somethingWentWrong'))
    } finally {
      setSubmitting(false)
      setPendingDecision(null)
    }
  }

  return (
    <div className="login-shell flex min-h-screen items-center justify-center px-4 py-10 text-fg">
      <div className="login-panel-surface w-full max-w-lg px-4 py-8 sm:p-8">
        <AnimatePresence mode="wait">
          {state === 'loading' && (
            <motion.p key="loading" variants={crossfadeVariants} initial="initial" animate="animate" exit="exit" transition={uiSpringTransition} className="text-center text-sm text-fg-secondary">
              {t('common.loading')}
            </motion.p>
          )}

          {state === 'invalid' && (
            <motion.div key="invalid" variants={crossfadeVariants} initial="initial" animate="animate" exit="exit" transition={uiSpringTransition} className="text-center">
              <h1 className="login-jura text-xl font-semibold text-fg">{INVALID_HEADINGS[invalidKind]}</h1>
              <p className="mt-2 text-sm text-fg-secondary">{invalidMessage}</p>
              <p className="mt-4 text-sm text-fg-secondary">{t('estimateRevision.invalidBody')}</p>
            </motion.div>
          )}

          {state === 'success' && (
            <motion.div key="success" variants={crossfadeVariants} initial="initial" animate="animate" exit="exit" transition={uiSpringTransition} className="text-center">
              <h1 className="login-jura text-xl font-semibold text-fg">
                {respondedAs === 'APPROVE' ? t('estimateRevision.confirmedHeading') : t('estimateRevision.concernHeading')}
              </h1>
              <p className="mt-2 text-sm text-fg-secondary">
                {respondedAs === 'APPROVE' ? t('estimateRevision.confirmedBody') : t('estimateRevision.concernBody')}
              </p>
            </motion.div>
          )}

          {state === 'ready' && verifyData && (
            <motion.div key="ready" variants={crossfadeVariants} initial="initial" animate="animate" exit="exit" transition={uiSpringTransition}>
              {verifyData.studioLogoUrl && (
                <img
                  src={verifyData.studioLogoUrl}
                  alt={verifyData.studioName}
                  className="mb-4 h-10 w-auto object-contain"
                />
              )}
              <h1 className="login-jura text-xl font-semibold text-fg">{t('estimateRevision.pageHeading')}</h1>
              <p className="mt-1 text-sm font-medium text-fg-secondary">{verifyData.studioName}</p>
              <div className="mt-3 flex items-center gap-2.5">
                {verifyData.artistName && (
                  <FlatArtistAvatar name={verifyData.artistName} avatarUrl={verifyData.artistAvatarUrl} className="h-8 w-8" />
                )}
                <p className="text-base text-accent">
                  {t('estimateRevision.intro', { firstName: verifyData.clientFirstName })}
                </p>
              </div>

              <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">
                    {verifyData.priceEstimateLow != null &&
                    verifyData.priceEstimateHigh != null &&
                    verifyData.priceEstimateLow !== verifyData.priceEstimateHigh
                      ? t('estimate.priceRangeLabel')
                      : t('estimate.priceLabel')}
                  </p>
                  {/* Hero treatment: mirrors EstimateResponse.tsx's own
                      identical fix -- the headline number gets the payment
                      family's Fraunces/font-display weight, scaled down
                      from their 36-48px full-page hero for this card-grid
                      context. */}
                  <p className="mt-1 font-display text-2xl font-medium text-fg sm:text-3xl">
                    {formatPriceEstimate(verifyData.priceEstimateLow, verifyData.priceEstimateHigh) ?? t('estimate.toBeDiscussed')}
                  </p>
                </div>
                {/* A 1-row plan (flat-rate, staff choosing whether to show
                    this one session's hours) reads the same as no plan at
                    all -- the "N-session plan" breakdown box below is only
                    worth showing once there's an actual multi-session
                    breakdown to see. */}
                {verifyData.plannedSessions.length <= 1 && (
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">{t('estimate.estimatedTimeLabel')}</p>
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
                    {t('estimate.sessionPlan', { n: verifyData.plannedSessions.length })}
                  </p>
                  <ul className="mt-2 space-y-1">
                    {verifyData.plannedSessions.map((session) => (
                      <li key={session.sessionNumber} className="text-sm text-fg">
                        {t('estimate.sessionLabel', { n: session.sessionNumber })}
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
                  <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">{t('estimateRevision.whyThisChanged')}</p>
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
                  {submitting && pendingDecision === 'APPROVE' ? t('estimateRevision.submitting') : t('estimateRevision.approveButton')}
                </button>

                <button
                  type="button"
                  onClick={() => respond('FLAG')}
                  disabled={submitting}
                  className="w-full rounded-full border border-border px-4 py-2 text-sm font-medium text-fg-secondary transition hover:bg-surface hover:text-fg disabled:opacity-60"
                >
                  {submitting && pendingDecision === 'FLAG' ? t('estimateRevision.submitting') : t('estimateRevision.concernButton')}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <PublicPageFooter studioSlug={verifyData?.studioSlug} />
      </div>
    </div>
  )
}
