import { formatCents } from '../../lib/money'
import { formatDateOnly } from '../../lib/format'
import QrCode from '../QrCode'
import { useTranslations, useLocale } from '../../i18n'

// Reuses the app's existing QR component (components/QrCode.tsx, wrapping
// the already-installed `qrcode` package) -- the same one GiftCardResponse.tsx
// already uses for this exact gift-card-page context, so no new library
// pick was needed here. Encodes the SHORTENED public link (not the raw
// long URL GiftCardResponse.tsx itself encodes) per this feature's own
// brief -- shorter payload scans more reliably.
//
// Multi-language public forms closeout: this shipped to main (post-branch-
// cut) with hardcoded English -- folded into t() here. Rendered as a
// DepositResponse.tsx child, always inside its own <LocaleProvider>.
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
  const { t } = useTranslations()
  const { locale } = useLocale()
  return (
    // relative z-10: same reasoning as DepositAppointmentCard's own comment
    // -- keeps this above the fixed personalized background.
    <div className="relative z-10 mt-5 rounded-2xl border border-border p-5 text-center">
      <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">{t('deposit.giftCardCard.label')}</p>
      {/* font-medium, not font-semibold -- every other font-display amount
          in this family (PaymentAmountStage's headline, PaymentConfirmation
          Stage's own confirmed amount) uses font-medium; this was the lone
          font-semibold outlier, found via computed-style comparison. */}
      <p className="font-display mt-2 text-4xl font-medium text-fg">{formatCents(amountCents)}</p>
      <p className="mt-2 text-sm text-fg-secondary">{t('deposit.giftCardCard.showQrAtStudio')}</p>

      {publicUrl && (
        <div className="mt-4 flex justify-center">
          <QrCode value={publicUrl} size={200} />
        </div>
      )}

      <p className="mt-4 font-mono text-base tracking-widest text-fg">{code}</p>
      {expiresAt && (
        <p className="mt-1 text-xs text-fg-muted">
          {t('deposit.giftCardCard.validUntil', { date: formatDateOnly(expiresAt, locale) })}
        </p>
      )}
    </div>
  )
}
