import { useSearchParams } from 'react-router-dom'

// The device a client pays on at the counter never authenticates and
// never needs to see any appointment/payment data -- the actual
// confirmation (marking the Appointment paidVia: STRIPE) happens
// server-side via the webhook, which the staff member's own already-open
// AppointmentDetail page will reflect. This page exists purely so the
// client's Stripe Checkout redirect lands somewhere reasonable-looking
// instead of a 404.
export default function AppointmentPaymentComplete() {
  const [searchParams] = useSearchParams()
  const canceled = searchParams.get('status') === 'canceled'

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4 py-10 text-fg">
      <div className="w-full max-w-md rounded-2xl card-surface border border-border bg-surface p-8 text-center">
        <h1 className="text-xl font-semibold text-fg">{canceled ? 'Payment canceled' : 'Thank you!'}</h1>
        <p className="mt-3 text-sm text-fg-secondary">
          {canceled
            ? 'No payment was made. Please hand the device back to your artist or the front desk.'
            : 'Your payment is being processed. Please hand the device back to your artist or the front desk.'}
        </p>
      </div>
    </div>
  )
}
