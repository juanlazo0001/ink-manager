import { sanitizeHtml } from '../lib/sanitizeHtml'

interface PlatformPolicyPageProps {
  title: string
  bodyHtml: string
}

// Backs the platform-level /privacy and /terms (no studioSlug) -- distinct
// from PublicPolicyPage.tsx, which renders a Studio's OWN privacy/terms
// text at /privacy/:studioSlug and /terms/:studioSlug. These two describe
// Ink Manager itself, so there's no studio to fetch: content is a fixed
// HTML-string constant (platformPolicies.ts), not a StudioSettings field.
//
// Reuses PublicPolicyPage's exact render mechanism (sanitizeHtml +
// tiptap-content + dangerouslySetInnerHTML) for visual/maintenance
// consistency, and `.policy-shell` locks these pages to editorial-gold
// regardless of whatever [data-theme] happens to be on <html> (a
// logged-in studio's own preset, possibly stale from the same tab) --
// same "fixed platform identity" technique AuthLayout's .login-shell
// uses, since a Twilio/carrier reviewer (or any client) must see Ink
// Manager's own consistent identity here, never a studio's.
export default function PlatformPolicyPage({ title, bodyHtml }: PlatformPolicyPageProps) {
  return (
    <div className="policy-shell min-h-screen bg-bg text-fg">
      <div className="mx-auto max-w-2xl px-6 py-10 sm:px-10">
        <p className="text-sm font-medium text-fg-secondary">Ink Manager</p>
        <h1 className="mt-1 text-2xl font-bold text-fg">{title}</h1>

        <div
          className="tiptap-content mt-6 whitespace-pre-wrap text-sm text-fg-secondary"
          dangerouslySetInnerHTML={{ __html: sanitizeHtml(bodyHtml) }}
        />
      </div>
    </div>
  )
}
