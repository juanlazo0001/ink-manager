import { Link } from 'react-router-dom'

// Small discoverability footer for every public, unauthenticated page --
// reinforces /privacy and /terms are real, live pages, exactly what an A2P
// 10DLC compliance reviewer checks for. Renders nothing if the page hasn't
// resolved a studioSlug yet (e.g. still loading) rather than a broken link.
export default function PublicPageFooter({ studioSlug }: { studioSlug: string | null | undefined }) {
  if (!studioSlug) return null

  return (
    // relative z-10: a no-op everywhere this renders today, but keeps this
    // footer readable on pages that can show a fixed personalized
    // background behind their content (DepositResponse/FlashPaymentResponse's
    // payment-confirmation state, see PaymentConfirmationStage's own
    // comment) without this component needing to know that's happening.
    <div className="relative z-10 mt-6 flex justify-center gap-4 text-xs text-fg-muted">
      <Link to={`/privacy/${studioSlug}`} target="_blank" rel="noopener noreferrer" className="hover:text-fg">
        Privacy Policy
      </Link>
      <Link to={`/terms/${studioSlug}`} target="_blank" rel="noopener noreferrer" className="hover:text-fg">
        Terms &amp; Conditions
      </Link>
    </div>
  )
}
