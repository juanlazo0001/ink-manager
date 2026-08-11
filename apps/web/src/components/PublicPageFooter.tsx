import { Link } from 'react-router-dom'
import { useLocaleSafe } from '../i18n'
import { en } from '../i18n/strings/en'
import { es } from '../i18n/strings/es'
import { ShieldIcon, DocumentIcon } from './icons'

const FOOTER_STRINGS = { en, es }

// Small discoverability footer for every public, unauthenticated page --
// reinforces /privacy and /terms are real, live pages, exactly what an A2P
// 10DLC compliance reviewer checks for. Renders nothing if the page hasn't
// resolved a studioSlug yet (e.g. still loading) rather than a broken link.
//
// Mounted both inside a LocaleProvider (every i18n'd public flow) and
// outside one (GiftCardResponse.tsx, still English-only for v1) -- reads
// the dictionaries directly rather than useTranslations() (which throws
// without a provider) so the same component works, translated or not,
// in both places without crashing the one page that has no provider.
//
// variant="icons" (flash gallery restyle): same two links/targets, restyled
// with a leading icon and Jura letter-spacing to match the Editorial Gold
// system -- never a different destination, just a different treatment.
export default function PublicPageFooter({
  studioSlug,
  variant = 'text',
}: {
  studioSlug: string | null | undefined
  variant?: 'text' | 'icons'
}) {
  const localeCtx = useLocaleSafe()
  const strings = FOOTER_STRINGS[localeCtx?.locale ?? 'en'].common

  if (!studioSlug) return null

  if (variant === 'icons') {
    return (
      <div className="relative z-10 flash-gallery-footer">
        <Link to={`/privacy/${studioSlug}`} target="_blank" rel="noopener noreferrer">
          <ShieldIcon className="h-3.5 w-3.5" />
          {strings.privacyPolicy}
        </Link>
        <Link to={`/terms/${studioSlug}`} target="_blank" rel="noopener noreferrer">
          <DocumentIcon className="h-3.5 w-3.5" />
          {strings.termsAndConditions}
        </Link>
      </div>
    )
  }

  return (
    // relative z-10: a no-op everywhere this renders today, but keeps this
    // footer readable on pages that can show a fixed personalized
    // background behind their content (DepositResponse/FlashPaymentResponse's
    // payment-confirmation state, see PaymentConfirmationStage's own
    // comment) without this component needing to know that's happening.
    <div className="relative z-10 mt-6 flex justify-center gap-4 text-xs text-fg-muted">
      <Link to={`/privacy/${studioSlug}`} target="_blank" rel="noopener noreferrer" className="hover:text-fg">
        {strings.privacyPolicy}
      </Link>
      <Link to={`/terms/${studioSlug}`} target="_blank" rel="noopener noreferrer" className="hover:text-fg">
        {strings.termsAndConditions}
      </Link>
    </div>
  )
}
