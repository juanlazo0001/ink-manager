import { createPortal } from 'react-dom'
import { formatCents } from '../../lib/money'
import { FlatArtistAvatar } from '../ArtistAvatar'
import type { PaymentIdentity } from './PaymentFlowStages'

// Stage 3, also reused standalone for each page's "already paid, page
// reloaded" branch -- a fresh visit and an in-flow success look identical.
// Part 2 sizing pass (against a real reference screenshot): a much larger
// hero avatar, a gold divider under the checkmark, and the title allowed to
// wrap at true display scale rather than staying compact.
export default function PaymentConfirmationStage({
  identity,
  amountCents,
  heading,
  body,
  // Part 2: the reference screenshot's own deposit-with-voucher case drops
  // the amount from the hero entirely -- it's redundant with
  // DepositGiftCardCard's own large amount right below. Callers with no
  // such redundant display elsewhere (flash payment, session checkout, or
  // a deposit with no gift card issued) leave this unset and keep the
  // amount here, since it would otherwise appear nowhere on the page.
  hideAmount = false,
}: {
  identity: PaymentIdentity
  amountCents: number
  heading: string
  body: string
  hideAmount?: boolean
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
            <FlatArtistAvatar name={identity.artistName} avatarUrl={identity.artistAvatarUrl} className="h-32 w-32" />
          </div>
        )}
        <p className="font-display mt-5 text-2xl italic text-accent">✓</p>
        {/* Short gold divider under the checkmark -- purely decorative,
            matching the reference's own hero treatment. */}
        <div className="mx-auto mt-2 h-px w-10 bg-accent/60" aria-hidden="true" />
        <h1 className="font-display mt-4 text-5xl leading-[1.05] font-medium text-fg">{heading}</h1>
        {!hideAmount && (
          <p className="font-display mt-3 text-4xl font-medium text-fg">{formatCents(amountCents)}</p>
        )}
        <p className="mt-4 text-base text-accent">
          {identity.artistName ? `${identity.artistName} at ${identity.studioName}` : identity.studioName}
        </p>
        <p className="mt-2 text-sm text-fg-secondary">{body}</p>
      </div>
    </div>
  )
}
