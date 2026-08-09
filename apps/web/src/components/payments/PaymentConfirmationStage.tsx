import { createPortal } from 'react-dom'
import { formatCents } from '../../lib/money'
import { FlatArtistAvatar } from '../ArtistAvatar'
import type { PaymentIdentity } from './PaymentFlowStages'

// Stage 3, also reused standalone for each page's "already paid, page
// reloaded" branch -- a fresh visit and an in-flow success look identical.
// The celebratory hero itself (checkmark, heading, amount, body) stays
// exactly as it was -- the avatar is additive, placed above it, same
// circular treatment PaymentAmountStage's own identity block already
// uses, so a confirmation reached mid-flow and one reached via a fresh
// visit read as the same design language throughout.
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
      {/* Personalized background (Part 1), portaled straight to <body> --
          discovered live (not theorized) that rendering this inline here
          instead trapped it inside .login-panel-surface's own box: any
          ancestor with backdrop-filter (which that card has) establishes a
          new containing block for position: fixed descendants, the same
          way transform/filter do, so the "fixed" photo/wash were being
          sized and clipped to the CARD's bounds, not the viewport. A
          portal renders these as real children of <body>, escaping that
          entirely regardless of how deeply this component is nested.
          Every other page-level sibling (DepositAppointmentCard,
          DepositGiftCardCard, the referral block, PublicPageFooter) has
          its own `relative z-10` for the same reason these need to be
          readable above it -- see each of their own comments. */}
      {identity.referenceBackgroundUrl &&
        createPortal(
          <>
            <img src={identity.referenceBackgroundUrl} alt="" aria-hidden="true" className="app-bg-photo" />
            <span className="payment-bg-wash" aria-hidden="true" />
          </>,
          document.body,
        )}
      {/* relative z-10: an explicit stacking order (not left to plain-
          content-vs-fixed-z-index nuance) so this reads above the
          portaled photo/wash regardless of where in the tree it renders. */}
      <div className="relative z-10">
        {identity.artistName && (
          <div className="flex justify-center">
            <FlatArtistAvatar name={identity.artistName} avatarUrl={identity.artistAvatarUrl} className="h-14 w-14" />
          </div>
        )}
        <p className="font-display mt-3 text-3xl italic text-accent">✓</p>
        <h1 className="font-display mt-3 text-3xl font-medium text-fg">{heading}</h1>
        <p className="font-display mt-2 text-4xl font-medium text-fg">{formatCents(amountCents)}</p>
        <p className="mt-3 text-sm text-fg-secondary">
          {identity.artistName ? `${identity.artistName} at ${identity.studioName}` : identity.studioName}
        </p>
        <p className="mt-4 text-sm text-fg-secondary">{body}</p>
      </div>
    </div>
  )
}
