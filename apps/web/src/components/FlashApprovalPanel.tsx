import { useState } from 'react'

export type FlashApprovalMode = 'artist' | 'studio'

interface FlashPieceSummary {
  title: string
  imageUrl: string
  priceCents: number
  estimatedDurationMinutes: number
  isOneOfOne: boolean
}

interface FlashApprovalPanelProps {
  mode: FlashApprovalMode
  flashPiece: FlashPieceSummary | null
  placement: string
  placementImages: string[]
  // Studio mode only: true when the assigned artist's own review mode is
  // ARTIST, so despite this being visible to staff (anyone with
  // inquiries.view can see a pending flash request), the decision isn't
  // front desk's to make -- mirrors POST /:id/flash/approve's own
  // artistOwnsApproval gate, just surfaced as read-only info instead of a
  // 403. Always false/omitted for mode="artist" -- that route is
  // identity-scoped, so ownership is already guaranteed by the time this
  // renders at all.
  artistOwnsDecision?: boolean
  canApprove: boolean
  canDecline: boolean
  approving: boolean
  declining: boolean
  error: string | null
  onApprove: () => void
  onDecline: (reason?: string) => void
  // Studio mode only, matching InquiryDetail.tsx's existing behavior --
  // MyFlashRequestDetail.tsx's artist-owned decline has never taken a
  // reason.
  allowDeclineReason?: boolean
}

// The one shared flash-approval surface (art/price/duration, placement,
// approve/decline) mounted on both routes that reach a pending flash
// request: MyFlashRequestDetail.tsx (artist's own identity-gated view) and
// InquiryDetail.tsx's "Flash Booking -- Review" widget (staff view). Not a
// shared ROUTE -- those two pages reach this entity through deliberately
// different, pre-existing permission surfaces (identity-only vs matrix-
// gated OWNER/FRONT_DESK) -- just a shared COMPONENT, so the two callers
// stop maintaining near-duplicate copies of this UI.
export default function FlashApprovalPanel({
  mode,
  flashPiece,
  placement,
  placementImages,
  artistOwnsDecision = false,
  canApprove,
  canDecline,
  approving,
  declining,
  error,
  onApprove,
  onDecline,
  allowDeclineReason = false,
}: FlashApprovalPanelProps) {
  const [declineReason, setDeclineReason] = useState('')
  const busy = approving || declining

  return (
    <div>
      {flashPiece && (
        <div className="flex items-start gap-4">
          <img
            src={flashPiece.imageUrl}
            alt={flashPiece.title}
            className="h-24 w-24 shrink-0 rounded-lg border border-border object-cover"
          />
          <div className="text-sm text-fg-secondary">
            <p className="text-fg">{flashPiece.title}</p>
            <p className="text-fg">${(flashPiece.priceCents / 100).toFixed(2)}</p>
            <p>~{Math.round((flashPiece.estimatedDurationMinutes / 60) * 10) / 10} hours</p>
            {flashPiece.isOneOfOne && <p className="text-xs text-fg-muted">One-of-one piece</p>}
          </div>
        </div>
      )}

      <div className={flashPiece ? 'mt-4' : ''}>
        <p className="text-sm font-medium text-fg-secondary">Placement</p>
        <p className="mt-1 text-sm text-fg">{placement}</p>
        {placementImages.length > 0 && (
          <div className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-4">
            {placementImages.map((url) => (
              <a key={url} href={url} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-lg border border-border">
                <img src={url} alt="Placement" className="aspect-square w-full object-cover" />
              </a>
            ))}
          </div>
        )}
      </div>

      {artistOwnsDecision ? (
        <p className="mt-4 text-sm text-fg-secondary">
          This artist reviews their own flash requests -- it's on their own Tasks page, not actionable here.
        </p>
      ) : (
        <>
          <p className="mt-4 text-sm text-fg-secondary">
            {mode === 'artist'
              ? "This is yours alone to decide -- your response, nobody else's."
              : 'Review the placement above, then approve to move this customer to payment, or decline to reopen the piece.'}
          </p>

          {(canApprove || canDecline) && (
            <div className="mt-3 space-y-3">
              {allowDeclineReason && canDecline && (
                <input
                  type="text"
                  value={declineReason}
                  onChange={(e) => setDeclineReason(e.target.value)}
                  placeholder="Decline reason (optional)"
                  className="w-full max-w-sm rounded-lg border border-border bg-surface-inset px-3 py-1.5 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                />
              )}
              <div className="flex flex-wrap gap-3">
                {canApprove && (
                  <button
                    type="button"
                    onClick={onApprove}
                    disabled={busy}
                    className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-60"
                  >
                    {approving ? 'Approving…' : 'Approve'}
                  </button>
                )}
                {canDecline && (
                  <button
                    type="button"
                    onClick={() => onDecline(allowDeclineReason ? declineReason.trim() || undefined : undefined)}
                    disabled={busy}
                    className="rounded-full border border-danger/40 px-4 py-2 text-sm font-medium text-danger transition hover:bg-danger/10 disabled:opacity-60"
                  >
                    {declining ? 'Declining…' : 'Decline'}
                  </button>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
    </div>
  )
}
