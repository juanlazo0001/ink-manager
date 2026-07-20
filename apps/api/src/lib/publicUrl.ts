// Single source of truth for the base URL used to build every public-
// facing link this server generates (intake form, prefill-draft, estimate,
// deposit, waiver, gift card, consent form). Previously each route file
// defined its own `const FRONTEND_URL = process.env.FRONTEND_URL || "http://
// localhost:5173"` -- harmless in dev, but a silent trap in production: if
// the env var is ever unset there, every one of those links quietly points
// real clients at localhost instead of failing loudly.
const DEV_FALLBACK = "http://localhost:5173";

function resolvePublicAppUrl(): string {
  const configured = process.env.PUBLIC_APP_URL;

  if (configured) {
    return configured.replace(/\/+$/, "");
  }

  if (process.env.NODE_ENV !== "production") {
    return DEV_FALLBACK;
  }

  // Deliberately not throwing: a loud, impossible-to-miss startup log is
  // more useful here than crashing the whole API over a link-building
  // misconfiguration. Every link built from this fallback will be visibly
  // broken (a localhost URL in a production response) rather than silently
  // wrong, which is what made the bug this replaces hard to notice.
  console.error(
    "[publicUrl] PUBLIC_APP_URL is not set in production -- every public link " +
      "(estimate/deposit/waiver/gift-card/intake/prefill-draft) will incorrectly " +
      "point at localhost until this is fixed. Set PUBLIC_APP_URL to the real " +
      "deployed frontend domain.",
  );
  return DEV_FALLBACK;
}

export const PUBLIC_APP_URL = resolvePublicAppUrl();
