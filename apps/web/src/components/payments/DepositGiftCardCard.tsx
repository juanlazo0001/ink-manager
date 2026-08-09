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
    <div className="mt-5 rounded-lg border border-border p-4 text-center">
      <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">{t('deposit.giftCardCard.label')}</p>
      <p className="mt-1 text-2xl font-semibold text-fg">{formatCents(amountCents)}</p>
      <p className="mt-1 text-sm text-fg-secondary">{t('deposit.giftCardCard.showQrAtStudio')}</p>

      {publicUrl && (
        <div className="mt-3 flex justify-center">
          <QrCode value={publicUrl} size={160} />
        </div>
      )}

      <p className="mt-3 font-mono text-sm tracking-widest text-fg">{code}</p>
      {expiresAt && (
        <p className="mt-1 text-xs text-fg-muted">
          {t('deposit.giftCardCard.validUntil', { date: formatDateOnly(expiresAt, locale) })}
        </p>
      )}
    </div>
  )
}
