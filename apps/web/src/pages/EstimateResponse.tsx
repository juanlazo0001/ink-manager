import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { apiFetch, ApiError } from '../lib/api'
import { sanitizeHtml } from '../lib/sanitizeHtml'
import { formatPriceEstimate } from '../lib/format'
import { FlatArtistAvatar } from '../components/ArtistAvatar'
import PublicPageFooter from '../components/PublicPageFooter'
import { LocaleProvider, useLocale, useTranslations, persistPickerLocale } from '../i18n'
import LanguagePicker from '../i18n/LanguagePicker'
import { crossfadeVariants, uiSpringTransition } from '../lib/motion'

const INPUT_CLASS =
  'mt-1 w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent'

// Token-lifecycle bug fix: 'alreadyBooked' is new -- a client revisiting
// their own link after their self-scheduling booking completed (see
// Inquiry.selfScheduleBookedAt's own schema comment) now gets a real
// "you're all set" message instead of falling through to 'invalid'.
type PageState = 'loading' | 'invalid' | 'ready' | 'success' | 'alreadyBooked'
type Decision = 'PROCEED' | 'BUDGET_TOO_HIGH' | 'DECLINE'
// Distinguishes the three shapes an 'invalid' response can actually mean
// (see estimateToken's own schema comment on why this is now reachable in
// more ways than a plain "never existed") -- drives the heading, since a
// resent-past link isn't the same situation as one that time-expired.
type InvalidKind = 'invalid' | 'expired' | 'superseded'

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
  // Multi-session planning: empty for every estimate that never declared
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
  estimateTermsSnapshot: string | null
  // Multi-language public forms: this API field is IGNORED on purpose --
  // see the module-level comment near its render site below.
  collaborativeDesignPolicy: string
  // Multi-language public forms: which locale the API actually resolved
  // (explicit ?locale= > this client's own stored preference > the
  // studio's own default) -- synced back into LocaleProvider on load,
  // same pattern as every other flow's own verify response.
  resolvedLocale?: string
}

// Token-lifecycle bug fix: GET /estimates/verify/:token's new already-
// responded shapes -- either data (the normal decision-form case, unioned
// above) or one of these two, never both. alreadyResponded means self-
// scheduling is still pending (redirect); alreadyBooked means it's done.
interface AlreadyRespondedResponse {
  alreadyResponded: true
  selfScheduleToken: string
}
interface AlreadyBookedResponse {
  alreadyBooked: true
  clientFirstName: string
  studioName: string
  studioSlug: string
  themePreset: string
}

// Status-code convention this fix introduces across the whole estimate/
// self-scheduling token chain (estimates.ts, selfSchedule.ts): 404 = never
// existed, 410 = time-expired, 409 = superseded by a newer link. Kept as
// one small shared mapping rather than three inline ternaries so the
// three public pages that now all need it (this one, EstimateRevisionResponse,
// SelfSchedule) read the same status the same way.
function invalidKindFromStatus(status: number | undefined): InvalidKind {
  if (status === 409) return 'superseded'
  if (status === 410) return 'expired'
  return 'invalid'
}

export default function EstimateResponse() {
  return (
    <LocaleProvider>
      <EstimateResponseContent />
    </LocaleProvider>
  )
}

function EstimateResponseContent() {
  const { t } = useTranslations()
  const { locale, setLocale } = useLocale()

  const INVALID_HEADINGS: Record<InvalidKind, string> = {
    invalid: t('common.linkInvalidHeading'),
    expired: t('common.linkExpiredHeading'),
    superseded: t('common.linkSupersededHeading'),
  }

  // A range ("2–3 hours") always reads plural in both languages
  // regardless of the numbers involved -- only the single-number case
  // (min === max) needs to pick between estimate.hourSingular/hourPlural.
  function formatHourRange(min: number | null, max: number | null): string | null {
    if (min == null || max == null) return null
    if (min === max) return `${min} ${min === 1 ? t('estimate.hourSingular') : t('estimate.hourPlural')}`
    return `${min}–${max} ${t('estimate.hourPlural')}`
  }

  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const [state, setState] = useState<PageState>('loading')
  const [invalidKind, setInvalidKind] = useState<InvalidKind>('invalid')
  const [invalidMessage, setInvalidMessage] = useState(t('common.linkExpiredHeading'))
  const [verifyData, setVerifyData] = useState<VerifyResponse | null>(null)
  const [alreadyBookedData, setAlreadyBookedData] = useState<AlreadyBookedResponse | null>(null)
  const [respondedAs, setRespondedAs] = useState<Decision | null>(null)

  const [activeForm, setActiveForm] = useState<Decision | null>(null)
  const [statedBudget, setStatedBudget] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [pendingDecision, setPendingDecision] = useState<Decision | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) return

    let ignore = false

    // Fix pass: the FIRST fetch must NOT send ?locale= explicitly -- an
    // explicit query param always wins in resolveRequestLocale's own
    // precedence, so echoing this component's still-default 'en' state
    // back at the server as if it were a real choice defeated the whole
    // "resolve from Client.preferredLocale" mechanism on every fresh
    // link, permanently. A later picker toggle re-fetches explicitly via
    // the separate effect below (needed so estimateTermsSnapshot's own
    // seed-equality resolution re-runs in the new language too).
    apiFetch<VerifyResponse | AlreadyRespondedResponse | AlreadyBookedResponse>(`/estimates/verify/${token}`)
      .then((data) => {
        if (ignore) return
        // Token-lifecycle bug fix: a client re-opening their own link
        // after already approving lands here now instead of a bare
        // "invalid" -- either straight back into the self-scheduling
        // picker they left, or a real "you're all set" if they already
        // booked, never the decision form a second time.
        if ('alreadyResponded' in data) {
          navigate(`/schedule/${data.selfScheduleToken}`, { replace: true })
          return
        }
        if ('alreadyBooked' in data) {
          setAlreadyBookedData(data)
          setState('alreadyBooked')
          return
        }
        setVerifyData(data)
        // Server-resolved locale (client's own stored preference or the
        // studio's default) wins on first load.
        if (data.resolvedLocale && data.resolvedLocale !== locale) setLocale(data.resolvedLocale as typeof locale)
        setState('ready')
      })
      .catch((err) => {
        if (ignore) return
        const kind = invalidKindFromStatus(err instanceof ApiError ? err.status : undefined)
        setInvalidKind(kind)
        setInvalidMessage(err instanceof Error ? err.message : t('common.linkExpiredHeading'))
        setState('invalid')
      })

    return () => {
      ignore = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, navigate])

  // Re-fetch with the new locale explicitly whenever the client toggles
  // the picker, so estimateTermsSnapshot's own seed-equality resolution
  // (server-side) re-runs in the new language too -- platform strings
  // already re-render instantly from LocaleContext alone; this covers
  // the one piece of this page only useTranslations() can't reach.
  // Skipped on the very first render (that fetch already happened,
  // deliberately without an explicit locale, above).
  const isFirstLocaleRender = useRef(true)
  useEffect(() => {
    if (isFirstLocaleRender.current) {
      isFirstLocaleRender.current = false
      return
    }
    if (!token || state !== 'ready') return
    apiFetch<VerifyResponse | AlreadyRespondedResponse | AlreadyBookedResponse>(`/estimates/verify/${token}?locale=${locale}`)
      .then((data) => {
        if ('alreadyResponded' in data || 'alreadyBooked' in data) return
        setVerifyData(data)
      })
      .catch(() => {
        /* Best-effort re-translation only -- the page already has usable data from the first load. */
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale])

  async function respond(decision: Decision) {
    if (!token) return

    if (decision === 'BUDGET_TOO_HIGH' && statedBudget.trim().length === 0) {
      setSubmitError(t('estimate.pleaseProvideBudget'))
      return
    }

    setSubmitError(null)
    setSubmitting(true)
    setPendingDecision(decision)

    try {
      const result = await apiFetch<{ success: true; selfScheduleToken: string | null }>(
        `/estimates/respond/${token}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            decision,
            statedBudget: decision === 'BUDGET_TOO_HIGH' ? statedBudget.trim() : undefined,
          }),
        },
      )

      // Client self-scheduling exploration: only ever present on a PROCEED
      // response, and only when the assigned artist opted in (see
      // estimates.ts's PROCEED branch) -- every other decision, and every
      // artist who hasn't opted in, leaves this null and falls through to
      // the static success message below exactly as before.
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
        <div className="mb-4 flex justify-end">
          <LanguagePicker onChange={(next) => token && persistPickerLocale(`/estimates/${token}/locale`, next)} />
        </div>

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
              <p className="mt-4 text-sm text-fg-secondary">
                {invalidKind === 'superseded'
                  ? t('common.pleaseCheckMessagesForNewestLink')
                  : t('estimate.contactStudioForNewEstimate')}
              </p>
            </motion.div>
          )}

          {state === 'alreadyBooked' && alreadyBookedData && (
            <motion.div key="alreadyBooked" variants={crossfadeVariants} initial="initial" animate="animate" exit="exit" transition={uiSpringTransition} className="text-center">
              <h1 className="login-jura text-xl font-semibold text-fg">{t('estimate.alreadyBookedHeading', { firstName: alreadyBookedData.clientFirstName })}</h1>
              <p className="mt-2 text-sm text-fg-secondary">
                {t('estimate.alreadyBookedBody', { studioName: alreadyBookedData.studioName })}
              </p>
            </motion.div>
          )}

          {state === 'success' && (
            <motion.div key="success" variants={crossfadeVariants} initial="initial" animate="animate" exit="exit" transition={uiSpringTransition} className="text-center">
              <h1 className="login-jura text-xl font-semibold text-fg">
                {respondedAs === 'PROCEED' && t('estimate.proceedHeading')}
                {respondedAs === 'BUDGET_TOO_HIGH' && t('estimate.budgetHeading')}
                {respondedAs === 'DECLINE' && t('estimate.declineHeading')}
              </h1>
              <p className="mt-2 text-sm text-fg-secondary">
                {respondedAs === 'PROCEED' && t('estimate.proceedBody')}
                {respondedAs === 'BUDGET_TOO_HIGH' && t('estimate.budgetBody')}
                {respondedAs === 'DECLINE' && t('estimate.declineBody')}
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
              <h1 className="login-jura text-xl font-semibold text-fg">{t('estimate.pageHeading')}</h1>
              <p className="mt-1 text-sm font-medium text-fg-secondary">{verifyData.studioName}</p>
              <div className="mt-3 flex items-center gap-2.5">
                {verifyData.artistName && (
                  <FlatArtistAvatar name={verifyData.artistName} avatarUrl={verifyData.artistAvatarUrl} className="h-8 w-8" />
                )}
                <p className="text-base text-accent">
                  {t('estimate.intro', {
                    firstName: verifyData.clientFirstName,
                    artistName: verifyData.artistName ?? t('estimate.defaultArtistName'),
                  })}
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
                  {/* Hero treatment: the single number a client cares about
                      most gets the payment family's Fraunces/font-display
                      weight, scaled down from their 36-48px full-page hero
                      since this sits in a two-column card grid alongside
                      the time estimate, not a dedicated confirmation
                      screen. */}
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
                      {(verifyData.plannedSessions.length === 1
                        ? formatHourRange(
                            verifyData.plannedSessions[0].estimatedHoursMin,
                            verifyData.plannedSessions[0].estimatedHoursMax,
                          )
                        : formatHourRange(verifyData.timeEstimateHoursMin, verifyData.timeEstimateHoursMax)) ?? t('estimate.toBeDiscussed')}
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

              {/* Multi-language public forms, Finding 1: verifyData.collaborativeDesignPolicy
                  is deliberately ignored -- it's a single hardcoded platform string
                  (COLLABORATIVE_DESIGN_POLICY in routes/estimates.ts), identical for
                  every studio, not studio content, so it's translated here instead
                  of trusting whatever single-locale text the API happens to send. */}
              <div className="mt-5 rounded-lg border border-border bg-surface-inset p-3 text-xs text-fg-secondary">
                {t('estimate.collaborativeDesignPolicy')}
              </div>

              {verifyData.estimateTermsSnapshot && (
                <div className="mt-3 rounded-lg border border-border bg-surface-inset p-3 text-xs text-fg-secondary">
                  <p className="mb-1 font-medium uppercase tracking-wider text-fg-muted">{t('estimate.termsHeading')}</p>
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
                  {submitting && pendingDecision === 'PROCEED' ? t('estimate.submitting') : t('estimate.proceedButton')}
                </button>

                <AnimatePresence initial={false} mode="wait">
                  {activeForm === 'BUDGET_TOO_HIGH' ? (
                    <motion.div key="budget-form" variants={crossfadeVariants} initial="initial" animate="animate" exit="exit" transition={uiSpringTransition} className="rounded-lg border border-border p-3">
                      <label className="mb-1 block text-xs font-medium text-fg-secondary">
                        {t('estimate.budgetPrompt')}
                      </label>
                      <input
                        type="text"
                        placeholder={t('estimate.budgetPlaceholder')}
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
                        {submitting && pendingDecision === 'BUDGET_TOO_HIGH' ? t('estimate.submitting') : t('estimate.sendBudget')}
                      </button>
                    </motion.div>
                  ) : (
                    <motion.button
                      key="budget-prompt"
                      variants={crossfadeVariants}
                      initial="initial"
                      animate="animate"
                      exit="exit"
                      transition={uiSpringTransition}
                      type="button"
                      onClick={() => setActiveForm('BUDGET_TOO_HIGH')}
                      className="w-full rounded-full border border-border px-4 py-2 text-sm font-medium text-fg transition hover:bg-surface"
                    >
                      {t('estimate.declinePrompt')}
                    </motion.button>
                  )}
                </AnimatePresence>

                <button
                  type="button"
                  onClick={() => respond('DECLINE')}
                  disabled={submitting}
                  className="w-full rounded-full border border-border px-4 py-2 text-sm font-medium text-fg-secondary transition hover:bg-surface hover:text-fg disabled:opacity-60"
                >
                  {submitting && pendingDecision === 'DECLINE' ? t('estimate.submitting') : t('estimate.notMovingForward')}
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
