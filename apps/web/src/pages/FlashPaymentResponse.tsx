import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { apiFetch, ApiError } from '../lib/api'
import { FlatArtistAvatar } from '../components/ArtistAvatar'
import PublicPageFooter from '../components/PublicPageFooter'
import PaymentFlowStages from '../components/payments/PaymentFlowStages'
import { LocaleProvider, useLocale, useTranslations } from '../i18n'

// Embedded payments migration: same fixed Editorial Gold platform
// treatment as DepositResponse.tsx now (login-shell) -- applyThemePreset
// deliberately removed, see that file's own comment for why.

type PageState = 'loading' | 'invalid' | 'ready'

interface VerifyResponse {
  clientFirstName: string
  studioName: string
  studioSlug: string
  studioLogoUrl: string | null
  themePreset: string
  artistName: string | null
  artistAvatarUrl: string | null
  // Part 1 (personalized confirmation background): same shape/reasoning
  // as DepositResponse.tsx's own field -- see that file's comment. Always
  // null for a flash-origin inquiry in practice (POST /flash-pieces/:id/
  // request never sets referenceImages), so this page's confirmation
  // falls back to the static background by construction, not a special
  // case here.
  referenceBackgroundUrl: string | null
  pieceTitle: string | null
  pieceImageUrl: string | null
  priceCents: number | null
  stripeConnected: boolean
  embeddedPaymentsEnabled: boolean
  paidAt: string | null
  selfScheduleToken: string | null
  resolvedLocale?: string
}

export default function FlashPaymentResponse() {
  return (
    <LocaleProvider>
      <FlashPaymentResponseContent />
    </LocaleProvider>
  )
}

function FlashPaymentResponseContent() {
  const { t } = useTranslations()
  const { locale, setLocale } = useLocale()
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const justReturnedFromStripe = searchParams.get('paid') === '1'

  const [state, setState] = useState<PageState>('loading')
  const [invalidMessage, setInvalidMessage] = useState(t('common.linkExpiredHeading'))
  const [verifyData, setVerifyData] = useState<VerifyResponse | null>(null)
  const [confirmingPayment, setConfirmingPayment] = useState(justReturnedFromStripe)

  const [payingNow, setPayingNow] = useState(false)
  const [payError, setPayError] = useState<string | null>(null)

  const [embeddedSecret, setEmbeddedSecret] = useState<{ clientSecret: string; connectedAccountId: string } | null>(null)
  const [embeddedLoadError, setEmbeddedLoadError] = useState<string | null>(null)

  // Language becomes customer-specific: no picker on this page anymore --
  // resolvedLocale comes purely from the server (client's own stored
  // preference, else Accept-Language), synced once on load.
  const loadVerify = useCallback(
    (opts?: { poll?: boolean }) => {
      if (!token) return
      let pollAttempts = 0

      function load() {
        apiFetch<VerifyResponse>(`/flash-payment/verify/${token}`)
          .then((data) => {
            setVerifyData(data)
            setState('ready')
            if (data.resolvedLocale && data.resolvedLocale !== locale) setLocale(data.resolvedLocale as typeof locale)

            if (data.selfScheduleToken) {
              navigate(`/schedule/${data.selfScheduleToken}`, { replace: true })
              return
            }

            // Same reasoning as DepositResponse's own poll: the webhook is
            // usually near-instant, but not guaranteed to have landed by the
            // time control returns here, so this briefly re-checks rather
            // than showing a stale "Pay now" button for a payment that
            // already succeeded.
            if (opts?.poll && pollAttempts < 5) {
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
    [token, navigate],
  )

  useEffect(() => {
    loadVerify({ poll: justReturnedFromStripe })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  async function handlePayNow() {
    if (!token) return
    setPayingNow(true)
    setPayError(null)
    try {
      const { url } = await apiFetch<{ url: string }>(`/flash-payment/checkout/${token}`, { method: 'POST' })
      window.location.href = url
    } catch (err) {
      setPayError(err instanceof ApiError ? err.message : t('common.somethingWentWrong'))
      setPayingNow(false)
    }
  }

  const showEmbedded = Boolean(
    state === 'ready' &&
      verifyData &&
      !confirmingPayment &&
      !verifyData.selfScheduleToken &&
      verifyData.stripeConnected &&
      verifyData.embeddedPaymentsEnabled,
  )

  useEffect(() => {
    if (!showEmbedded || !token || embeddedSecret) return
    let ignore = false
    apiFetch<{ clientSecret: string; connectedAccountId: string }>(`/flash-payment/payment-intent/${token}`, { method: 'POST' })
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

  return (
    // bg-bg dropped -- see DepositResponse.tsx's own comment on this same
    // change (Part 1: lets the fixed personalized background show through
    // instead of being hidden behind an opaque ancestor).
    <div className="login-shell flex min-h-screen items-center justify-center px-4 py-10 text-fg">
      <div className="login-panel-surface w-full max-w-lg px-4 py-8 sm:p-8">
        {state === 'loading' && <p className="text-center text-sm text-fg-secondary">{t('common.loading')}</p>}

        {state === 'invalid' && (
          <div className="text-center">
            <h1 className="login-jura text-xl font-semibold text-fg">{t('common.linkExpiredHeading')}</h1>
            <p className="mt-2 text-sm text-fg-secondary">{invalidMessage}</p>
            <p className="mt-4 text-sm text-fg-secondary">{t('flashPayment.linkExpiredBody')}</p>
          </div>
        )}

        {state === 'ready' && verifyData && confirmingPayment && (
          <div className="text-center">
            <h1 className="login-jura text-xl font-semibold text-fg">{t('flashPayment.confirmingPayment')}</h1>
            <p className="mt-2 text-sm text-fg-secondary">{t('flashPayment.confirmingPaymentBody')}</p>
          </div>
        )}

        {state === 'ready' && verifyData && !verifyData.selfScheduleToken && !confirmingPayment && verifyData.stripeConnected && verifyData.embeddedPaymentsEnabled && (
          // Fully restaged -- no duplicate heading/piece-card/price above
          // this the way the non-embedded fallback below still has; the
          // piece itself becomes the breakdown's one line item instead of
          // its own separate card, so the dominant amount only ever
          // appears once.
          <PaymentFlowStages
            identity={{
              artistName: verifyData.artistName,
              artistAvatarUrl: verifyData.artistAvatarUrl,
              studioName: verifyData.studioName,
              referenceBackgroundUrl: verifyData.referenceBackgroundUrl,
            }}
            headlineAmountCents={verifyData.priceCents ?? 0}
            breakdown={verifyData.pieceTitle ? [{ label: verifyData.pieceTitle, valueCents: verifyData.priceCents ?? 0 }] : []}
            payment={embeddedSecret}
            paymentLoadError={embeddedLoadError}
            returnUrl={`${window.location.origin}/flash-payment/${token}?paid=1`}
            successHeading={t('flashPayment.paymentReceivedHeading')}
            successBody={t('flashPayment.paymentReceivedBody')}
            onPaid={handleEmbeddedPaid}
          />
        )}

        {state === 'ready' &&
          verifyData &&
          !verifyData.selfScheduleToken &&
          !confirmingPayment &&
          !(verifyData.stripeConnected && verifyData.embeddedPaymentsEnabled) && (
          <div>
            {verifyData.studioLogoUrl && (
              <img src={verifyData.studioLogoUrl} alt={verifyData.studioName} className="mb-4 h-10 w-auto object-contain" />
            )}
            <h1 className="login-jura text-xl font-semibold text-fg">{t('flashPayment.pageHeading')}</h1>
            <p className="mt-1 text-sm text-fg-secondary">
              {t('flashPayment.intro', {
                firstName: verifyData.clientFirstName,
                pieceTitle: verifyData.pieceTitle ?? '',
                studioName: verifyData.studioName,
              })}
            </p>

            <div className="mt-5 flex items-center gap-3 rounded-xl border border-border bg-surface-inset p-3">
              {verifyData.pieceImageUrl && (
                <img src={verifyData.pieceImageUrl} alt={verifyData.pieceTitle ?? ''} className="h-16 w-16 shrink-0 rounded-lg object-cover" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-fg">{verifyData.pieceTitle}</p>
                {verifyData.artistName && (
                  <div className="mt-1 flex items-center gap-2">
                    <FlatArtistAvatar name={verifyData.artistName} avatarUrl={verifyData.artistAvatarUrl} className="h-5 w-5" />
                    <p className="text-xs text-fg-secondary">{verifyData.artistName}</p>
                  </div>
                )}
              </div>
              {verifyData.priceCents != null && (
                <p className="shrink-0 text-lg font-semibold text-fg">${(verifyData.priceCents / 100).toFixed(2)}</p>
              )}
            </div>

            {!verifyData.stripeConnected ? (
              <p className="mt-5 text-sm text-fg-secondary">{t('flashPayment.paymentUnavailable')}</p>
            ) : (
              <>
                {payError && <p className="mt-4 text-sm text-danger">{payError}</p>}
                <button
                  type="button"
                  onClick={handlePayNow}
                  disabled={payingNow}
                  className="mt-5 w-full rounded-full bg-accent px-4 py-2 text-sm font-medium text-bg transition hover:bg-accent-hover disabled:opacity-60"
                >
                  {payingNow
                    ? t('flashPayment.redirecting')
                    : verifyData.priceCents != null
                      ? t('flashPayment.payAmount', { amount: `$${(verifyData.priceCents / 100).toFixed(2)}` })
                      : t('flashPayment.payNow')}
                </button>
              </>
            )}
          </div>
        )}

        <PublicPageFooter studioSlug={verifyData?.studioSlug} />
      </div>
    </div>
  )
}
