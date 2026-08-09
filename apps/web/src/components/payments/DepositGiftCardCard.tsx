import { formatCents } from '../../lib/money'
import { formatDateOnly } from '../../lib/format'
import QrCode from '../QrCode'

// Reuses the app's existing QR component (components/QrCode.tsx, wrapping
// the already-installed `qrcode` package) -- the same one GiftCardResponse.tsx
// already uses for this exact gift-card-page context, so no new library
// pick was needed here. Encodes the SHORTENED public link (not the raw
// long URL GiftCardResponse.tsx itself encodes) per this feature's own
// brief -- shorter payload scans more reliably.
//
// Part 2 sizing pass: rounded-2xl/p-5 (was rounded-lg/p-4, same card
// language as DepositAppointmentCard's own comment), a much larger amount
// and QR code (160 -> 200) -- this voucher is the one thing a client is
// most likely to actually use again at the studio, so it gets the most
// visual weight on the page.
export default function DepositGiftCardCard({
  code,
  amountCents,
  expiresAt,
  publicUrl,
}: {
  code: string
  amountCents: number
  expiresAt: string | null
  publicUrl: string | null
}) {
  return (
    // relative z-10: same reasoning as DepositAppointmentCard's own comment
    // -- keeps this above the fixed personalized background.
    <div className="relative z-10 mt-5 rounded-2xl border border-border p-5 text-center">
      <p className="text-sm font-medium uppercase tracking-wider text-fg-muted">Your deposit voucher</p>
      <p className="font-display mt-2 text-4xl font-semibold text-fg">{formatCents(amountCents)}</p>
      <p className="mt-2 text-sm text-fg-secondary">Show this QR code at the studio.</p>

      {publicUrl && (
        <div className="mt-4 flex justify-center">
          <QrCode value={publicUrl} size={200} />
        </div>
      )}

      <p className="mt-4 font-mono text-base tracking-widest text-fg">{code}</p>
      {expiresAt && <p className="mt-1 text-xs text-fg-muted">Valid until {formatDateOnly(expiresAt)}</p>}
    </div>
  )
}
