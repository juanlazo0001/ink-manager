import { useEffect, useState, useCallback } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { apiFetch, ApiError } from '../lib/api'
import { formatCalendarDateOnly } from '../lib/format'
import QrCode from '../components/QrCode'
import StatusPill from '../components/StatusPill'
import PublicPageFooter from '../components/PublicPageFooter'
import PaymentFlowStages from '../components/payments/PaymentFlowStages'
import PaymentConfirmationStage from '../components/payments/PaymentConfirmationStage'

// Embedded payments migration: same "one of the platform's own Editorial
// Gold pages, never studio-themed" treatment DepositResponse.tsx/
// FlashPaymentResponse.tsx already adopted -- login-shell's own CSS
// redefines the --color-* custom properties every bg-bg/text-fg/etc.
// utility class here already reads, so this no longer calls
// applyThemePreset (which would otherwise pollute the global [data-theme]
// attribute for whatever the visitor navigates to next).

interface GiftCardView {
  studioName: string
  studioSlug: string
  code: string
  amountCents: number
  status: string
  expiresAt: string | null
  stripeConnected: boolean
  embeddedPaymentsEnabled: boolean
}

type PageState = 'loading' | 'invalid' | 'ready'

export default function GiftCardResponse() {
  const { code } = useParams<{ code: string }>()
  const [searchParams] = useSearchParams()
  const justReturnedFromStripe = searchParams.get('paid') === '1'

  const [state, setState] = useState<PageState>('loading')
  const [invalidMessage, setInvalidMessage] = useState('This gift card code is invalid.')
  const [data, setData] = useState<GiftCardView | null>(null)

  const [confirmingPayment, setConfirmingPayment] = useState(justReturnedFromStripe)
  const [payingNow, setPayingNow] = useState(false)
  const [payError, setPayError] = useState<string | null>(null)

  const [embeddedSecret, setEmbeddedSecret] = useState<{ clientSecret: string; connectedAccountId: string } | null>(null)
  const [embeddedLoadError, setEmbeddedLoadError] = useState<string | null>(null)

  const loadView = useCallback(
    (opts?: { poll?: boolean }) => {
      if (!code) return
      let pollAttempts = 0

      function load() {
        apiFetch<GiftCardView>(`/gift-cards/view/${code}`)
          .then((result) => {
            setData(result)
            setState('ready')

            if (opts?.poll && result.status === 'PENDING' && pollAttempts < 5) {
              pollAttempts += 1
              setTimeout(load, 1500)
            } else {
              setConfirmingPayment(false)
            }
          })
          .catch((err) => {
            setInvalidMessage(err instanceof Error ? err.message : 'This gift card code is invalid.')
            setState('invalid')
            setConfirmingPayment(false)
          })
      }

      load()
    },
    [code],
  )

  useEffect(() => {
    loadView({ poll: justReturnedFromStripe })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code])

  async function goToStripeCheckout() {
    if (!code) return
    setPayingNow(true)
    setPayError(null)
    try {
      const { url } = await apiFetch<{ url: string }>(`/gift-cards/${code}/checkout-session`, { method: 'POST' })
      window.location.href = url
    } catch (err) {
      setPayError(err instanceof ApiError ? err.message : 'Something went wrong')
      setPayingNow(false)
    }
  }

  // Embedded payments: fetches (or reuses -- see the server's own
  // fetch-or-create comment) the PaymentIntent client secret once this
  // page is in the "unpaid, embedded flag on" state -- same pattern
  // DepositResponse.tsx already uses.
  const showEmbedded = Boolean(
    state === 'ready' && data && data.status === 'PENDING' && !confirmingPayment && data.stripeConnected && data.embeddedPaymentsEnabled,
  )

  useEffect(() => {
    if (!showEmbedded || !code || embeddedSecret) return
    let ignore = false
    apiFetch<{ clientSecret: string; connectedAccountId: string }>(`/gift-cards/${code}/payment-intent`, { method: 'POST' })
      .then((result) => {
        if (!ignore) setEmbeddedSecret(result)
      })
      .catch((err) => {
        if (!ignore) setEmbeddedLoadError(err instanceof ApiError ? err.message : 'Something went wrong')
      })
    return () => {
      ignore = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showEmbedded, code, embeddedSecret])

  function handleEmbeddedPaid() {
    setConfirmingPayment(true)
    loadView({ poll: true })
  }

  return (
    <div className="login-shell flex min-h-screen items-center justify-center px-4 py-10 text-fg">
      <div className="login-panel-surface w-full max-w-lg px-4 py-8 sm:p-8">
        {state === 'loading' && <p className="text-center text-sm text-fg-secondary">Loading…</p>}

        {state === 'invalid' && (
          <div className="text-center">
            <h1 className="login-jura text-xl font-semibold text-fg">Gift card not found</h1>
            <p className="mt-2 text-sm text-fg-secondary">{invalidMessage}</p>
          </div>
        )}

        {state === 'ready' && data && data.status !== 'PENDING' && (
          <div>
            <PaymentConfirmationStage
              identity={{ artistName: null, artistAvatarUrl: null, studioName: data.studioName }}
              amountCents={data.amountCents}
              heading={data.status === 'EXEMPT' ? 'Deposit Exemption' : 'Gift Card Ready'}
              body="Present this code or QR at checkout to redeem."
              // The card/QR block right below already shows the amount at
              // its own larger scale -- same "don't show it twice" reasoning
              // as DepositResponse.tsx's own DepositGiftCardCard.
              hideAmount
            />

            <div className="relative z-10 mt-2 text-center">
              <div className="flex justify-center">
                <QrCode value={window.location.href} />
              </div>

              <p className="mt-4 select-all rounded-lg border border-border bg-surface-inset px-3 py-2 font-mono text-sm tracking-wider text-fg">
                {data.code}
              </p>

              <div className="mt-5 flex justify-center gap-6 text-sm">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">Status</p>
                  <div className="mt-1">
                    <StatusPill status={data.status} />
                  </div>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">Expires</p>
                  <p className="mt-1 text-fg">{data.expiresAt ? formatCalendarDateOnly(data.expiresAt) : 'Never'}</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {state === 'ready' && data && data.status === 'PENDING' && confirmingPayment && (
          <div className="text-center">
            <h1 className="login-jura text-xl font-semibold text-fg">Confirming payment…</h1>
            <p className="mt-2 text-sm text-fg-secondary">This usually takes just a moment.</p>
          </div>
        )}

        {state === 'ready' && data && data.status === 'PENDING' && !confirmingPayment && data.stripeConnected && (
          <>
            {data.embeddedPaymentsEnabled ? (
              <PaymentFlowStages
                identity={{ artistName: null, artistAvatarUrl: null, studioName: data.studioName }}
                headlineAmountCents={data.amountCents}
                breakdown={[{ label: 'Gift Card', valueCents: data.amountCents }]}
                payment={embeddedSecret}
                paymentLoadError={embeddedLoadError}
                returnUrl={`${window.location.origin}/gift-card/${code}?paid=1`}
                successHeading="Payment received"
                successBody="Your gift card is ready to use."
                onPaid={handleEmbeddedPaid}
              />
            ) : (
              <div className="text-center">
                <p className="text-sm text-fg-secondary">{data.studioName}</p>
                <h1 className="login-jura mt-1 text-3xl font-bold text-fg">${(data.amountCents / 100).toFixed(2)} Gift Card</h1>

                {payError && (
                  <div className="mt-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                    {payError}
                  </div>
                )}

                <button
                  type="button"
                  onClick={goToStripeCheckout}
                  disabled={payingNow}
                  className="login-button login-jura mt-6 w-full px-4 py-3 text-sm font-bold uppercase"
                >
                  {payingNow ? 'Redirecting…' : `Pay $${(data.amountCents / 100).toFixed(2)}`}
                </button>
              </div>
            )}
          </>
        )}

        {state === 'ready' && data && data.status === 'PENDING' && !confirmingPayment && !data.stripeConnected && (
          <div className="text-center">
            <p className="text-sm text-fg-secondary">{data.studioName}</p>
            <h1 className="login-jura mt-1 text-3xl font-bold text-fg">${(data.amountCents / 100).toFixed(2)} Gift Card</h1>
            <div className="mt-4">
              <StatusPill status="PENDING" label="Payment Pending" />
            </div>
            <p className="mt-4 text-sm text-fg-secondary">
              {justReturnedFromStripe
                ? "Thanks! We're confirming your payment now -- this usually takes just a moment. Refresh this page to check."
                : "This gift card hasn't been paid for yet."}
            </p>
          </div>
        )}

        <PublicPageFooter studioSlug={data?.studioSlug} />
      </div>
    </div>
  )
}
