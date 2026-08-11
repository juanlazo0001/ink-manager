import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { apiFetch, ApiError } from '../lib/api'
import { formatDateTime } from '../lib/format'
import { dollarsToCents } from '../lib/money'
import { FlatArtistAvatar } from '../components/ArtistAvatar'
import PublicPageFooter from '../components/PublicPageFooter'
import SignaturePadField, { type SignaturePadHandle } from '../components/SignaturePadField'
import PaymentFlowStages from '../components/payments/PaymentFlowStages'
import PaymentConfirmationStage from '../components/payments/PaymentConfirmationStage'
import { LocaleProvider, useLocale, useTranslations } from '../i18n'
import DepositAppointmentCard from '../components/payments/DepositAppointmentCard'
import DepositGiftCardCard from '../components/payments/DepositGiftCardCard'

// Embedded payments migration: this page is one of the platform's own
// "Editorial Gold, never studio-themed" pages now (same login-shell
// treatment as Login/Signup/the artist public page), so applyThemePreset
// is deliberately gone -- login-shell's own CSS redefines the same
// --color-* custom properties every bg-bg/text-fg/etc. utility class below
// already reads, scoped to .login-shell regardless of whatever [data-theme]
// happens to be sitting on <html> from a previously-viewed studio's own
// page in this same tab. Calling applyThemePreset here would only pollute
// that global attribute for whatever the visitor navigates to next, for a
// page that no longer reads it at all.

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
  // Confirmation-screen enrichment: a real cacheable image URL (via
  // publicAssets) for the hero specifically -- null when the artist hasn't
  // published a public profile, in which case the hero falls back to
  // FlatArtistAvatar's own initials badge rather than a broken request.
  artistPublicAvatarUrl: string | null
  // Part 1 (personalized confirmation background): a real cacheable,
  // pre-blurred image URL -- same "real URL via publicAssets, not raw
  // inline data" shape as artistPublicAvatarUrl above, sourced from the
  // originating inquiry's OWN referenceImages (never placementImages/body
  // photos -- enforced server-side, see the API route's own comment).
  // Null whenever the inquiry has no reference images, in which case the
  // page falls back to its plain static background, unchanged.
  referenceBackgroundUrl: string | null
  // Multi-session-aware as of the confirmation enrichment -- resolves via
  // this deposit form's own PlannedSession when planned (session 2+ is
  // never reflected on the project's legacy singular appointment slot),
  // so this is now the correct per-session appointment, not just
  // whatever the project's first session happened to be.
  appointmentStart: string | null
  appointmentEnd: string | null
  proposedStartAt: string | null
  proposedEndAt: string | null
  // IANA identifier, always present -- the appointment card states this
  // explicitly rather than letting a client assume their own timezone.
  studioTimezone: string
  // Best-effort -- null whenever there's no reliable single location to
  // attribute the appointment to (see the API route's own comment on why
  // this can't be a clean per-appointment lookup in this schema).
  studioAddress: string | null
  // Confirmation-screen enrichment: null until paid.
  giftCard: {
    code: string
    amountCents: number
    expiresAt: string | null
    publicUrl: string | null
  } | null
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
  // Embedded payments migration: independent of stripeConnected -- a
  // studio can be Stripe-connected with this still off (the default),
  // in which case this page behaves exactly as it did before this flag
  // existed (redirect to hosted Checkout).
  embeddedPaymentsEnabled: boolean
  terms: Term[]
  // Multi-language public forms: which locale the API actually resolved
  // (explicit ?locale= > this client's own stored preference > the
  // studio's own default) -- synced back into LocaleProvider on load so
  // the picker reflects the server's own resolution immediately, not
  // always defaulting to English until a client manually toggles it.
  resolvedLocale?: string
  // Prepay: DEPOSIT (tier, default) or FULL_PREPAY (full estimated price) --
  // drives which copy namespace (deposit.* vs prepay.*) this page renders.
  amountMode: 'DEPOSIT' | 'FULL_PREPAY'
}

// Multi-language public forms: this page's own hardcoded 8-clause
// agreement (Term.label from the API) is platform copy, not studio
// content -- see routes/deposits.ts's TERMS array and the Part 1
// investigation's Finding 1. Term.key is still the API's own source of
// truth for WHICH terms exist and in what order; Term.label itself is
// ignored in favor of this lookup, so the platform copy is translated
// here, once, rather than trusting whatever single-locale text the API
// happens to send.
const TERM_TRANSLATION_KEYS: Record<string, Parameters<ReturnType<typeof useTranslations>['t']>[0]> = {
  agreedNonRefundable: 'deposit.terms.agreedNonRefundable',
  agreedLatePolicy: 'deposit.terms.agreedLatePolicy',
  agreedNoShowForfeit: 'deposit.terms.agreedNoShowForfeit',
  agreedNewDepositAfterNoShow: 'deposit.terms.agreedNewDepositAfterNoShow',
  agreedRescheduleLimit: 'deposit.terms.agreedRescheduleLimit',
  agreedExpiration: 'deposit.terms.agreedExpiration',
  agreedIdAndVoucher: 'deposit.terms.agreedIdAndVoucher',
  agreedAge18: 'deposit.terms.agreedAge18',
}

// Prepay: only 6 of the 8 term keys have prepay-specific wording
// (agreedLatePolicy and agreedAge18 don't mention "deposit" at all, so
// they fall back to the base deposit.terms.* copy for both modes).
const PREPAY_TERM_TRANSLATION_KEYS: Partial<Record<string, Parameters<ReturnType<typeof useTranslations>['t']>[0]>> = {
  agreedNonRefundable: 'prepay.terms.agreedNonRefundable',
  agreedNoShowForfeit: 'prepay.terms.agreedNoShowForfeit',
  agreedNewDepositAfterNoShow: 'prepay.terms.agreedNewDepositAfterNoShow',
  agreedRescheduleLimit: 'prepay.terms.agreedRescheduleLimit',
  agreedExpiration: 'prepay.terms.agreedExpiration',
  agreedIdAndVoucher: 'prepay.terms.agreedIdAndVoucher',
}

export default function DepositResponse() {
  return (
    <LocaleProvider>
      <DepositResponseContent />
    </LocaleProvider>
  )
}

function DepositResponseContent() {
  const { t } = useTranslations()
  const { locale, setLocale } = useLocale()
  const { token } = useParams<{ token: string }>()
  const [searchParams] = useSearchParams()
  const justReturnedFromStripe = searchParams.get('paid') === '1'

  const [state, setState] = useState<PageState>('loading')
  const [invalidMessage, setInvalidMessage] = useState(t('common.linkExpiredHeading'))
  const [verifyData, setVerifyData] = useState<VerifyResponse | null>(null)

  const [agreed, setAgreed] = useState<Record<string, boolean>>({})
  const [signatureName, setSignatureName] = useState('')
  const [signatureEmptyError, setSignatureEmptyError] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const [payingNow, setPayingNow] = useState(false)
  const [payError, setPayError] = useState<string | null>(null)
  // Set right after returning from Stripe (redirect-based methods only
  // now) OR right after an embedded PaymentElement confirmation resolves
  // in-place -- the payment_intent.succeeded webhook is usually near-
  // instant, but not guaranteed to have landed yet, so this briefly polls
  // rather than showing a stale "pay now" state for a payment that
  // actually already succeeded.
  const [confirmingPayment, setConfirmingPayment] = useState(justReturnedFromStripe)

  // Embedded payments: the fetched client secret + connected account id
  // for this deposit's PaymentIntent, and any error from that fetch
  // itself (distinct from payError above, which is Checkout-redirect-
  // specific and stays scoped to that fallback path).
  const [embeddedSecret, setEmbeddedSecret] = useState<{ clientSecret: string; connectedAccountId: string } | null>(null)
  const [embeddedLoadError, setEmbeddedLoadError] = useState<string | null>(null)

  const signaturePadRef = useRef<SignaturePadHandle | null>(null)

  // Language becomes customer-specific: no picker on this page anymore --
  // resolvedLocale comes purely from the server (client's own stored
  // preference, else Accept-Language), synced once on load. No re-fetch
  // mechanism needed since there's no toggle to react to.
  const loadVerify = useCallback(
    (opts?: { poll?: boolean }) => {
      if (!token) return
      let pollAttempts = 0

      function load() {
        apiFetch<VerifyResponse>(`/deposits/verify/${token}`)
          .then((data) => {
            setVerifyData(data)
            setState('ready')
            if (data.resolvedLocale && data.resolvedLocale !== locale) setLocale(data.resolvedLocale as typeof locale)

            if (opts?.poll && !data.paidVia && pollAttempts < 5) {
              pollAttempts += 1
              setTimeout(load, 1500)
            } else {
              setConfirmingPayment(false)
            }
          })
          .catch((err) => {
            setInvalidMessage(err instanceof Error ? err.message : t('common.linkExpiredHeading'))
            setState('invalid')
            setConfirmingPayment(false)
          })
      }

      load()
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [token],
  )

  useEffect(() => {
    loadVerify({ poll: justReturnedFromStripe })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  const allAgreed = verifyData ? verifyData.terms.every((term) => agreed[term.key]) : false

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!token || !verifyData) return

    if (!allAgreed) {
      setSubmitError(t('deposit.pleaseAgreeToEveryTerm'))
      return
    }

    if (signatureName.trim().length === 0) {
      setSubmitError(t('deposit.pleaseTypeFullName'))
      return
    }

    if (!signaturePadRef.current || signaturePadRef.current.isEmpty()) {
      setSignatureEmptyError(true)
      setSubmitError(t('common.pleaseSignBeforeSubmitting'))
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
        if (verifyData.embeddedPaymentsEnabled) {
          // Refresh rather than redirect -- the "signed, awaiting payment"
          // render branch below picks up from here and mounts the Payment
          // Element inline, no navigation at all.
          loadVerify()
        } else {
          // Redirect straight to Stripe's hosted checkout rather than
          // showing the "we'll collect it separately" screen -- reuses the
          // same checkout-session endpoint a return visit's "Pay Now"
          // button calls, so there's exactly one place that creates the
          // session.
          await goToStripeCheckout()
        }
      } else {
        setState('success')
      }
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : t('common.somethingWentWrong'))
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
      setPayError(err instanceof ApiError ? err.message : t('common.somethingWentWrong'))
      setPayingNow(false)
    }
  }

  // Embedded payments: fetches (or reuses -- see the server's own
  // fetch-or-create comment) the PaymentIntent client secret the moment
  // this page is in the "signed, awaiting payment, embedded flag on"
  // state -- mirrors the fallback path's own "create right after signing,
  // or again on a return visit" behavior, just producing a client secret
  // to mount instead of a URL to redirect to.
  const showEmbedded = Boolean(
    state === 'ready' &&
      verifyData &&
      !verifyData.paidVia &&
      !confirmingPayment &&
      verifyData.signedAt &&
      verifyData.stripeConnected &&
      verifyData.embeddedPaymentsEnabled,
  )

  useEffect(() => {
    if (!showEmbedded || !token || embeddedSecret) return
    let ignore = false
    apiFetch<{ clientSecret: string; connectedAccountId: string }>(`/deposits/${token}/payment-intent`, { method: 'POST' })
      .then((data) => {
        if (!ignore) setEmbeddedSecret(data)
      })
      .catch((err) => {
        if (!ignore) setEmbeddedLoadError(err instanceof ApiError ? err.message : t('common.somethingWentWrong'))
      })
    return () => {
      ignore = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showEmbedded, token, embeddedSecret])

  function handleEmbeddedPaid() {
    setConfirmingPayment(true)
    loadVerify({ poll: true })
  }

  // Prepay: only the small set of client-facing strings whose wording
  // actually differs ("deposit" -> "prepayment") get a prepay.* override --
  // everything else falls back to the base deposit.* copy, matching the
  // "partial mirror, not full duplicate" shape of the two namespaces
  // themselves (see en.ts/es.ts). Each call site below ternaries between
  // the two literal keys directly (rather than a dynamic-key helper) so
  // both keys stay checked against the translation dictionary's own type.
  const isPrepay = verifyData?.amountMode === 'FULL_PREPAY'

  return (
    // bg-bg deliberately dropped (Part 1) -- same as AuthLayout's own
    // .login-shell wrapper, which never had it: body already carries this
    // flat color globally (index.css's own @layer base rule), so removing
    // it here loses nothing when there's no personalized background, and
    // is what lets PaymentConfirmationStage's fixed photo/wash show
    // through this page's content when there is one, rather than being
    // hidden behind an opaque ancestor the way TopBar's own app-bg-photo/
    // app-bg-wash deliberately are (see that pair's own comment).
    <div className="login-shell flex min-h-screen items-center justify-center px-4 py-10 text-fg">
      <div className="login-panel-surface w-full max-w-lg px-4 py-8 sm:p-8">
        {state === 'loading' && <p className="text-center text-sm text-fg-secondary">{t('common.loading')}</p>}

        {state === 'invalid' && (
          <div className="text-center">
            <h1 className="login-jura text-xl font-semibold text-fg">{t('common.linkExpiredHeading')}</h1>
            <p className="mt-2 text-sm text-fg-secondary">{invalidMessage}</p>
            <p className="mt-4 text-sm text-fg-secondary">
              {isPrepay ? t('prepay.linkExpiredBody') : t('deposit.linkExpiredBody')}
            </p>
          </div>
        )}

        {state === 'success' && (
          <div className="text-center">
            <h1 className="login-jura text-xl font-semibold text-fg">{t('deposit.receivedNoPaymentHeading')}</h1>
            <p className="mt-2 text-sm text-fg-secondary">
              {isPrepay ? t('prepay.receivedNoPaymentBody') : t('deposit.receivedNoPaymentBody')}
            </p>
          </div>
        )}

        {state === 'ready' && verifyData && verifyData.paidVia && (
          <div>
            <PaymentConfirmationStage
              identity={{
                artistName: verifyData.artistName,
                artistAvatarUrl: verifyData.artistPublicAvatarUrl,
                studioName: verifyData.studioName,
                referenceBackgroundUrl: verifyData.referenceBackgroundUrl,
              }}
              amountCents={dollarsToCents(verifyData.totalCharged)}
              heading={isPrepay ? t('prepay.paidHeading') : t('deposit.paidHeading')}
              // State-accurate rather than a blanket "confirmed your
              // appointment" claim -- paying a deposit doesn't always
              // result in a real appointment (a scheduling conflict
              // re-checked at payment time can leave it unbooked). The
              // appointment card right below carries the actual state;
              // this line only ever claims what's universally true. (See
              // en.ts/es.ts: paidHeadingStripe/paidHeadingManual updated to
              // drop the "confirmed your appointment" clause to match.)
              body={verifyData.paidVia === 'STRIPE' ? t('deposit.paidHeadingStripe') : t('deposit.paidHeadingManual')}
              // Part 2: the amount would otherwise appear twice -- once
              // here, once in DepositGiftCardCard's own large amount right
              // below -- whenever a gift card was actually issued.
              hideAmount={Boolean(verifyData.giftCard)}
            />

            <DepositAppointmentCard
              startIso={verifyData.appointmentStart}
              endIso={verifyData.appointmentEnd}
              timeZone={verifyData.studioTimezone}
              address={verifyData.studioAddress}
              artistName={verifyData.artistName}
              studioName={verifyData.studioName}
            />

            {verifyData.giftCard && (
              <DepositGiftCardCard
                code={verifyData.giftCard.code}
                amountCents={verifyData.giftCard.amountCents}
                expiresAt={verifyData.giftCard.expiresAt}
                publicUrl={verifyData.giftCard.publicUrl}
                isPrepay={isPrepay}
              />
            )}

            {verifyData.referralProgramEnabled && (
              // relative z-10: same reasoning as DepositAppointmentCard's
              // own comment -- keeps this above the fixed personalized
              // background.
              <div className="relative z-10 mt-5 rounded-2xl border border-accent/30 bg-accent/5 p-5 text-left">
                <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">{t('deposit.shareReferralHeading')}</p>
                <p className="mt-2 text-sm text-fg-secondary">{t('deposit.shareReferralBody')}</p>
                <p className="mt-3 text-center font-mono text-xl font-semibold tracking-widest text-fg">
                  {verifyData.clientReferralCode}
                </p>
              </div>
            )}
          </div>
        )}

        {state === 'ready' && verifyData && !verifyData.paidVia && confirmingPayment && (
          <div className="text-center">
            <h1 className="login-jura text-xl font-semibold text-fg">{t('deposit.confirmingPayment')}</h1>
            <p className="mt-2 text-sm text-fg-secondary">{t('deposit.confirmingPaymentBody')}</p>
          </div>
        )}

        {state === 'ready' &&
          verifyData &&
          !verifyData.paidVia &&
          !confirmingPayment &&
          verifyData.signedAt &&
          verifyData.stripeConnected &&
          (verifyData.embeddedPaymentsEnabled ? (
            <PaymentFlowStages
              identity={{
                artistName: verifyData.artistName,
                artistAvatarUrl: verifyData.artistAvatarUrl,
                studioName: verifyData.studioName,
                referenceBackgroundUrl: verifyData.referenceBackgroundUrl,
              }}
              headlineAmountCents={dollarsToCents(verifyData.totalCharged)}
              breakdown={[
                { label: t('deposit.depositLabel'), valueCents: dollarsToCents(verifyData.depositAmount) },
                { label: t('deposit.feeLabel'), valueCents: dollarsToCents(verifyData.feeAmount) },
              ]}
              payment={embeddedSecret}
              paymentLoadError={embeddedLoadError}
              returnUrl={`${window.location.origin}/deposit/${token}?paid=1`}
              successHeading={t('deposit.paidHeading')}
              successBody={t('deposit.paidHeadingStripe')}
              onPaid={handleEmbeddedPaid}
            />
          ) : (
            <div>
              <h1 className="login-jura text-xl font-semibold text-fg">
                {isPrepay ? t('prepay.agreementSignedHeading') : t('deposit.agreementSignedHeading')}
              </h1>
              <p className="mt-1 text-sm font-medium text-fg-secondary">{verifyData.studioName}</p>
              <p className="mt-2 text-sm text-fg-secondary">
                {isPrepay
                  ? t('prepay.agreementSignedBody', { firstName: verifyData.clientFirstName })
                  : t('deposit.agreementSignedBody', { firstName: verifyData.clientFirstName })}
              </p>

              <div className="mt-4 grid grid-cols-3 gap-3">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">{isPrepay ? t('prepay.amountLabel') : t('deposit.depositLabel')}</p>
                  <p className="mt-1 text-lg font-semibold text-fg">${verifyData.depositAmount}</p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">{t('deposit.feeLabel')}</p>
                  <p className="mt-1 text-lg font-semibold text-fg">${verifyData.feeAmount}</p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">{t('deposit.totalLabel')}</p>
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
                {payingNow ? t('deposit.redirecting') : t('deposit.payAmount', { amount: `$${verifyData.totalCharged}` })}
              </button>
            </div>
          ))}

        {state === 'ready' &&
          verifyData &&
          !verifyData.paidVia &&
          !confirmingPayment &&
          verifyData.signedAt &&
          !verifyData.stripeConnected && (
            <div className="text-center">
              <h1 className="login-jura text-xl font-semibold text-fg">{t('deposit.receivedNoPaymentHeading')}</h1>
              <p className="mt-2 text-sm text-fg-secondary">
                {isPrepay ? t('prepay.receivedNoPaymentBody') : t('deposit.receivedNoPaymentBody')}
              </p>
            </div>
        )}

        {state === 'ready' && verifyData && !verifyData.paidVia && !confirmingPayment && !verifyData.signedAt && (
          <div>
            <h1 className="login-jura text-xl font-semibold text-fg">
              {isPrepay ? t('prepay.agreementHeading') : t('deposit.agreementHeading')}
            </h1>
            <p className="mt-1 text-sm font-medium text-fg-secondary">{verifyData.studioName}</p>
            {verifyData.artistName && (
              <div className="mt-3 flex items-center gap-2">
                <FlatArtistAvatar name={verifyData.artistName} avatarUrl={verifyData.artistAvatarUrl} className="h-7 w-7" />
                <p className="text-sm font-medium text-fg">{verifyData.artistName}</p>
              </div>
            )}
            <p className="mt-2 text-sm text-fg-secondary">
              {t('deposit.agreementIntro', {
                firstName: verifyData.clientFirstName,
                withArtist: verifyData.artistName ? t('deposit.withArtistSuffix', { artistName: verifyData.artistName }) : '',
              })}
            </p>

            {verifyData.appointmentStart && verifyData.appointmentEnd && (
              <div className="mt-4 rounded-lg border border-border p-3">
                <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">{t('deposit.appointmentLabel')}</p>
                <p className="mt-1 text-sm text-fg">
                  {formatDateTime(verifyData.appointmentStart, locale)} – {formatDateTime(verifyData.appointmentEnd, locale)}
                </p>
              </div>
            )}

            {/* A real appointment (above) always takes precedence -- this is
                purely informational and never implies a confirmed booking. */}
            {!verifyData.appointmentStart && verifyData.proposedStartAt && verifyData.proposedEndAt && (
              <div className="mt-4 rounded-lg border border-border bg-surface-inset p-3">
                <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">{t('deposit.tentativeTimeLabel')}</p>
                <p className="mt-1 text-sm text-fg">
                  {isPrepay
                    ? t('prepay.tentativeTimeBody', {
                        range: `${formatDateTime(verifyData.proposedStartAt, locale)} – ${formatDateTime(verifyData.proposedEndAt, locale)}`,
                      })
                    : t('deposit.tentativeTimeBody', {
                        range: `${formatDateTime(verifyData.proposedStartAt, locale)} – ${formatDateTime(verifyData.proposedEndAt, locale)}`,
                      })}
                </p>
              </div>
            )}

            {/* Multi-session planning: only present when this deposit form
                was generated for a specific planned session. */}
            {verifyData.plannedSession && (
              <div className="mt-4 rounded-lg border border-border bg-surface-inset p-3">
                <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">
                  {t('deposit.sessionOf', {
                    n: verifyData.plannedSession.sessionNumber,
                    total: verifyData.plannedSession.totalSessions,
                  })}
                </p>
                {verifyData.plannedSession.estimatedHoursMin != null && verifyData.plannedSession.estimatedHoursMax != null && (
                  <p className="mt-1 text-sm text-fg">
                    {t('deposit.estimatedHours', {
                      min: verifyData.plannedSession.estimatedHoursMin,
                      max: verifyData.plannedSession.estimatedHoursMax,
                    })}
                  </p>
                )}
              </div>
            )}

            <div className="mt-4 grid grid-cols-3 gap-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">{isPrepay ? t('prepay.amountLabel') : t('deposit.depositLabel')}</p>
                <p className="mt-1 text-lg font-semibold text-fg">${verifyData.depositAmount}</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">{t('deposit.feeLabel')}</p>
                <p className="mt-1 text-lg font-semibold text-fg">${verifyData.feeAmount}</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">{t('deposit.totalLabel')}</p>
                <p className="mt-1 text-lg font-semibold text-fg">${verifyData.totalCharged}</p>
              </div>
            </div>

            {verifyData.depositBreakdownNote && (
              <p className="mt-2 text-xs text-fg-muted">{verifyData.depositBreakdownNote}</p>
            )}

            <form onSubmit={handleSubmit} className="mt-6 space-y-3">
              <p className="text-sm font-medium text-fg-secondary">{t('deposit.pleaseReadAndAgree')}</p>

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
                  <span>
                    {(isPrepay && PREPAY_TERM_TRANSLATION_KEYS[term.key]) || TERM_TRANSLATION_KEYS[term.key]
                      ? t((isPrepay && PREPAY_TERM_TRANSLATION_KEYS[term.key]) || TERM_TRANSLATION_KEYS[term.key])
                      : term.label}
                  </span>
                </label>
              ))}

              <div>
                <label className="mb-1 block text-sm font-medium text-fg-secondary">{t('deposit.typeFullName')}</label>
                <input
                  type="text"
                  value={signatureName}
                  onChange={(e) => setSignatureName(e.target.value)}
                  className={INPUT_CLASS}
                />
              </div>

              <SignaturePadField
                ref={signaturePadRef}
                label={t('common.signBelow')}
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
                {submitting ? t('deposit.submitting') : t('deposit.signAndConfirm')}
              </button>
            </form>
          </div>
        )}

        <PublicPageFooter studioSlug={verifyData?.studioSlug} />
      </div>
    </div>
  )
}
