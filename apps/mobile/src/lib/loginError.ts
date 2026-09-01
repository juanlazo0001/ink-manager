import { ApiError } from './api';

/**
 * Maps anything `login()` can throw to a message a person can act on.
 *
 * Split out of the login screen so it is a pure, importable function with
 * no React Native imports -- it can be exercised directly against the real
 * API (which is how its branches were verified) instead of only through a
 * device.
 *
 * The API's own error text is already written for humans in every case but
 * one, so it is shown as-is; this only steps in where a raw message would
 * mislead or read like a machine wrote it.
 */
export function loginErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    // An error that did NOT come from the API (Railway's edge answering
    // mid-deploy, a proxy error page, a dead connection) says nothing
    // about the credentials that were typed -- telling someone their
    // password is wrong because a deploy was in flight is the worst
    // possible reading of it. See ApiError.fromApi.
    /*
     * 429 FIRST, ahead of the `fromApi` check, and that ordering is the
     * whole fix.
     *
     * `fromApi` is decided by `typeof body.error === 'string'`
     * (lib/api.ts). express-rate-limit's DEFAULT 429 body is plain text,
     * so a rate-limited login fell into the branch below and told the
     * user "Can't reach Ink Manager right now" — a deliberate refusal
     * reported as a network outage, which sends them to check their wifi
     * while the server is fine and waiting them out.
     *
     * Session BG's own limiters answer with JSON, so this branch should
     * rarely be needed by them. It is here anyway because the thing that
     * produced the bug — a 429 with a body this client did not expect —
     * can just as easily come from a proxy, an edge, or the next limiter
     * somebody adds without reading this file.
     */
    if (err.status === 429) {
      return err.fromApi && err.message
        ? err.message
        : 'Too many attempts. Wait a few minutes and try again.';
    }
    if (!err.fromApi) {
      return "Can't reach Ink Manager right now. Try again in a moment.";
    }
    if (err.status >= 500) {
      return 'Something went wrong on our end. Try again in a moment.';
    }
    // The one API message written for a machine rather than a person --
    // verified live against production, which answers a bad password with
    // exactly `401 {"error":"invalid credentials"}`. Every other 401 this
    // route can return is already a real sentence (deactivated account,
    // pending invite, unverified email) and is passed straight through.
    if (err.status === 401 && err.message === 'invalid credentials') {
      return 'Email or password is incorrect.';
    }
    return err.message;
  }
  return 'Something went wrong. Try again.';
}
