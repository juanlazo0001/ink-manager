import { formatCents } from '../../lib/money'
import type { PaymentIdentity } from './PaymentFlowStages'

// Stage 3, also reused standalone for each page's "already paid, page
// reloaded" branch -- a fresh visit and an in-flow success look identical.
export default function PaymentConfirmationStage({
  identity,
  amountCents,
  heading,
  body,
}: {
  identity: PaymentIdentity
  amountCents: number
  heading: string
  body: string
}) {
  return (
    <div className="py-4 text-center">
      <p className="font-display text-3xl italic text-accent">✓</p>
      <h1 className="font-display mt-3 text-3xl font-medium text-fg">{heading}</h1>
      <p className="font-display mt-2 text-4xl font-medium text-fg">{formatCents(amountCents)}</p>
      <p className="mt-3 text-sm text-fg-secondary">
        {identity.artistName ? `${identity.artistName} at ${identity.studioName}` : identity.studioName}
      </p>
      <p className="mt-4 text-sm text-fg-secondary">{body}</p>
    </div>
  )
}
