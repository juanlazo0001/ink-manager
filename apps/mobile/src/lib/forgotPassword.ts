/**
 * Where the login screen's "Forgot password?" link goes.
 *
 * v1 opens the EXISTING public web page in the system browser rather than
 * rebuilding the flow natively, deliberately: that page is plain, public
 * and already mobile-legible; the reset link arrives by email and lands
 * back on the web anyway; and `POST /auth/forgot-password` returns the
 * same response whether or not the address matched an account (it is
 * built not to be an email-enumeration oracle), so a native screen would
 * duplicate a flow while showing a person nothing new.
 *
 * Derived from the API base rather than hardcoded, so a build pointed at
 * a local or staging API opens that stack's own web app instead of
 * production. `api.` -> `web.` is the real production pairing
 * (api.inkmanager.app / web.inkmanager.app); any other host falls through
 * unchanged, which fails visibly rather than silently opening the wrong
 * site.
 *
 * Pure and dependency-free so it can be checked without rendering
 * anything -- same reasoning as loginError.ts.
 */
export function forgotPasswordUrl(apiUrl: string): string {
  const base = apiUrl.replace(/^(https?:\/\/)api\./i, '$1web.');
  return `${base.replace(/\/+$/, '')}/forgot-password`;
}
