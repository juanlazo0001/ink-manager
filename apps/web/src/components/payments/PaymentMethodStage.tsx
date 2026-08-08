import { useMemo, useState, type FormEvent } from 'react'
import { loadStripe, type Stripe } from '@stripe/stripe-js'
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js'
import { formatCents } from '../../lib/money'
import { EDITORIAL_GOLD_STRIPE_APPEARANCE } from '../../lib/stripeAppearance'

const DEFAULT_PAYMENT_METHOD_ORDER = ['apple_pay', 'google_pay', 'link', 'card']

// Stage 2: consolidates what used to be three near-identical *PaymentForm
// components (DepositPaymentForm, FlashPaymentForm,
// AppointmentPaymentElementForm) into one. paymentMethodOrder puts wallets
// (Apple/Google Pay) above card entry, per the Payment Element's own
// ordering option -- Stripe's documented mechanism for this, not a custom
// wallet-button implementation.
export default function PaymentMethodStage({
  clientSecret,
  connectedAccountId,
  amountCents,
  returnUrl,
  paymentMethodOrder,
  onPaid,
}: {
  clientSecret: string
  connectedAccountId: string
  amountCents: number
  returnUrl: string
  paymentMethodOrder?: string[]
  onPaid: () => void
}) {
  const stripePromise = useMemo<Promise<Stripe | null>>(
    () => loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY, { stripeAccount: connectedAccountId }),
    [connectedAccountId],
  )

  return (
    <Elements stripe={stripePromise} options={{ clientSecret, appearance: EDITORIAL_GOLD_STRIPE_APPEARANCE }}>
      <PaymentMethodForm
        amountCents={amountCents}
        returnUrl={returnUrl}
        paymentMethodOrder={paymentMethodOrder ?? DEFAULT_PAYMENT_METHOD_ORDER}
        onPaid={onPaid}
      />
    </Elements>
  )
}

function PaymentMethodForm({
  amountCents,
  returnUrl,
  paymentMethodOrder,
  onPaid,
}: {
  amountCents: number
  returnUrl: string
  paymentMethodOrder: string[]
  onPaid: () => void
}) {
  const stripe = useStripe()
  const elements = useElements()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!stripe || !elements) return

    setSubmitting(true)
    setError(null)

    const { error: submitError } = await elements.submit()
    if (submitError) {
      setError(submitError.message ?? 'Please check your payment details.')
      setSubmitting(false)
      return
    }

    // redirect: 'if_required' -- a card payment (the overwhelming majority
    // of cases) resolves right here with no navigation at all. Only a
    // genuinely redirect-requiring method (3DS challenge, a bank redirect)
    // leaves the page, returning to returnUrl afterward.
    const { error: confirmError, paymentIntent } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: returnUrl },
      redirect: 'if_required',
    })

    if (confirmError) {
      setError(confirmError.message ?? 'Something went wrong. Please try again.')
      setSubmitting(false)
      return
    }

    if (paymentIntent && (paymentIntent.status === 'succeeded' || paymentIntent.status === 'processing')) {
      onPaid()
    } else {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement options={{ paymentMethodOrder }} />

      {error && (
        <div className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>
      )}

      <button
        type="submit"
        disabled={!stripe || !elements || submitting}
        className="login-button login-jura w-full px-4 py-3 text-sm font-bold uppercase disabled:opacity-60"
      >
        {submitting ? 'Processing…' : `Pay ${formatCents(amountCents)}`}
      </button>
    </form>
  )
}
