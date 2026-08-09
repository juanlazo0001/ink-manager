import { formatCents } from '../../lib/money'
import { formatDateOnly } from '../../lib/format'
import QrCode from '../QrCode'

// Reuses the app's existing QR component (components/QrCode.tsx, wrapping
// the already-installed `qrcode` package) -- the same one GiftCardResponse.tsx
// already uses for this exact gift-card-page context, so no new library
// pick was needed here. Encodes the SHORTENED public link (not the raw
// long URL GiftCardResponse.tsx itself encodes) per this feature's own
// brief -- shorter payload scans more reliably.
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
    <div className="relative z-10 mt-5 rounded-lg border border-border p-4 text-center">
      <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">Your deposit voucher</p>
      <p className="mt-1 text-2xl font-semibold text-fg">{formatCents(amountCents)}</p>
      <p className="mt-1 text-sm text-fg-secondary">Show this QR code at the studio.</p>

      {publicUrl && (
        <div className="mt-3 flex justify-center">
          <QrCode value={publicUrl} size={160} />
        </div>
      )}

      <p className="mt-3 font-mono text-sm tracking-widest text-fg">{code}</p>
      {expiresAt && <p className="mt-1 text-xs text-fg-muted">Valid until {formatDateOnly(expiresAt)}</p>}
    </div>
  )
}
