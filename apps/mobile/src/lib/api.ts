/**
 * Thin fetch wrapper over the same API apps/web talks to. There is no
 * mobile-specific backend and no mobile-specific auth: the contract is
 * `POST /login` -> `{ token }`, then `Authorization: Bearer <token>` on
 * everything else, exactly as apps/web/src/lib/api.ts does it.
 *
 * React Native's fetch is not subject to browser CORS, so no API-side
 * change was needed to make this work from a phone.
 */

/**
 * `EXPO_PUBLIC_`-prefixed env vars are the only ones Expo inlines into
 * the client bundle, and they are inlined at BUILD time -- changing this
 * requires restarting the dev server, not just reloading the app.
 *
 * The fallback is production on purpose: the overwhelmingly common case
 * (a phone running Expo Go) cannot reach a dev machine's localhost, so
 * defaulting to localhost would mean every unconfigured run fails with a
 * network error. Pointing at a local API is the deliberate, opt-in case
 * (set EXPO_PUBLIC_API_URL to the dev machine's LAN IP), not the default.
 */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'https://api.inkmanager.app').replace(/\/+$/, '');

export class ApiError extends Error {
  status: number;
  /**
   * Machine-readable discriminator for the few error responses that need
   * more than "show this message" -- /login's `email_not_verified` is the
   * one that matters here, since it is a 401 that is NOT a wrong password
   * and deserves a different message. Undefined for most error bodies.
   */
  code?: string;
  /**
   * Did THIS API produce the error, or did something in front of it?
   *
   * Every error this API emits is `res.status(N).json({ error })`, so an
   * `error` field is the fingerprint of a real API response. Railway's
   * edge router answers on the API's behalf when no replica is reachable
   * (mid-deploy, crash loop, failed healthcheck) with
   * `404 {"status":"error","code":404,"message":"Application not found"}`
   * -- a 404 with no `error` field. Conflating the two has already taken
   * a public page down in this project (see REPORT.md, 2026-08-21), so
   * the same discriminator apps/web uses is carried over here rather than
   * reinvented.
   */
  fromApi: boolean;

  constructor(message: string, status: number, code?: string, fromApi = true) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fromApi = fromApi;
  }
}

/**
 * "Is this worth retrying, or is it a real answer?" -- true for anything
 * that is not this API deliberately saying no. A phone is far more likely
 * than a browser to be genuinely offline, and a rejected fetch never
 * becomes an ApiError at all, so it is caught here too.
 */
export function isTransientApiFailure(err: unknown): boolean {
  if (err instanceof ApiError) return !err.fromApi || err.status >= 500;
  return err instanceof TypeError;
}

export type ApiFetchOptions = RequestInit & {
  /** Bearer token to attach. Omit for unauthenticated calls (e.g. /login). */
  token?: string | null;
};

export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const { token, headers, ...rest } = options;

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...rest,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
    });
  } catch {
    // A rejected fetch on a phone is nearly always no connectivity or an
    // unreachable host (a LAN dev-server IP that has changed, most often)
    // -- surfaced as a readable message rather than a raw TypeError, but
    // still a TypeError to isTransientApiFailure's eyes via the throw
    // below being an ApiError with fromApi=false.
    throw new ApiError("Can't reach Ink Manager. Check your connection and try again.", 0, undefined, false);
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | { error?: string; code?: string }
      | null;
    const fromApi = typeof body?.error === 'string';
    throw new ApiError(
      body?.error ?? `Request failed with status ${response.status}`,
      response.status,
      body?.code,
      fromApi,
    );
  }

  if (response.status === 204) {
    return null as T;
  }

  return (await response.json()) as T;
}
