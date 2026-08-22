import { ApiError, isTransientApiFailure } from './api';

/**
 * The message an authenticated screen shows when a fetch fails.
 *
 * One helper rather than a per-screen function, because the same four
 * failures reach every screen and answering them differently in each
 * place is how an app ends up telling a person three different stories
 * about one problem.
 *
 * Order matters:
 *  1. Transient first — an unreachable API (Railway's edge answering
 *     mid-deploy, no signal) must never be reported as a permissions or
 *     data problem. See `ApiError.fromApi`.
 *  2. 401 is a dead session, not a dead screen. The API re-validates the
 *     account on every request — deactivation, deletion, a password
 *     change since the token was issued — so a token that worked a minute
 *     ago can stop working mid-use, and the raw "Unauthorized" it returns
 *     is useless to the person holding the phone.
 *  3. 403 is a real answer: this role is not allowed here.
 *  4. Anything else the API says is already written for humans.
 */
export function screenErrorMessage(err: unknown, subject: string): string {
  if (isTransientApiFailure(err)) {
    return `Couldn't reach the studio. Pull to try again.`;
  }
  if (err instanceof ApiError && err.status === 401) {
    return 'Your session has expired. Log out from the account screen, then sign in again.';
  }
  if (err instanceof ApiError && err.status === 403) {
    return `Your role does not have access to ${subject}.`;
  }
  return err instanceof ApiError ? err.message : `Something went wrong loading ${subject}.`;
}
