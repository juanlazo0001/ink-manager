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

// Phase 7B: the API's OWN public base URL -- a genuinely different thing
// from PUBLIC_APP_URL above (this app's Railway service and the web
// frontend's are separate domains). Needed for two things: building the
// inbound Twilio webhook URL shown in Settings -> Integrations, and
// reconstructing the exact URL Twilio signed when validating
// X-Twilio-Signature (the request's own req.protocol/host can't be
// trusted behind a proxy). Same loud-fallback convention as PUBLIC_APP_URL.
const API_DEV_FALLBACK = "http://localhost:4000";

function resolveApiPublicUrl(): string {
  const configured = process.env.API_PUBLIC_URL;

  if (configured) {
    return configured.replace(/\/+$/, "");
  }

  if (process.env.NODE_ENV !== "production") {
    return API_DEV_FALLBACK;
  }

  console.error(
    "[publicUrl] API_PUBLIC_URL is not set in production -- the Twilio inbound " +
      "webhook URL shown in Settings and used to validate X-Twilio-Signature will " +
      "incorrectly reference localhost until this is fixed. Set API_PUBLIC_URL to " +
      "this API's own real deployed domain.",
  );
  return API_DEV_FALLBACK;
}

export const API_PUBLIC_URL = resolveApiPublicUrl();

// Single source of truth for these two -- used both to display/copy the
// setup URL in Settings -> Integrations and to reconstruct the exact URL
// Twilio signed when validating X-Twilio-Signature (must match exactly).
export const TWILIO_SMS_WEBHOOK_URL = `${API_PUBLIC_URL}/webhooks/twilio/sms`;
const TWILIO_STATUS_CALLBACK_URL_RAW = `${API_PUBLIC_URL}/webhooks/twilio/status`;

// Twilio's own API rejects a localhost URL as an invalid StatusCallback at
// send time (a real send would otherwise fail outright in local dev,
// where API_PUBLIC_URL has no real public tunnel) -- null here means
// "omit the parameter," so a dev send still goes out, it just won't get
// delivery-status updates until this API has a real public URL (or a
// tunnel) in front of it.
export const TWILIO_STATUS_CALLBACK_URL = API_PUBLIC_URL.includes("localhost")
  ? null
  : TWILIO_STATUS_CALLBACK_URL_RAW;
