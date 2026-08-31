import { ApiError, apiFetch } from '@/lib/api';

/**
 * Public self-serve signup, mirroring `POST /auth/signup`.
 *
 * ─── WHAT IT CREATES ────────────────────────────────────────────────
 *
 * A STUDIO AND ITS OWNER, together, in one call — not a user joining an
 * existing studio. That is a different flow entirely (`/invite`,
 * `/artist-invite`), token-based, and not this. The route runs
 * `createStudioWithOwner`, generates the studio slug, writes an audit row
 * (`self_serve_studio_created`), and emails a verification link.
 *
 * ─── IT DOES NOT LOG YOU IN ─────────────────────────────────────────
 *
 * The 201 carries no token — `{ message, email, studioSlug }` — and
 * login is BLOCKED until the address is verified:
 *
 *     401 { error: "Check your email to verify your account before
 *           logging in.", code: "email_not_verified" }
 *
 * So "check your email" is the terminal state of this flow, not a
 * waypoint, and there is nothing for SecureStore to store yet. Web ends
 * on exactly the same screen.
 *
 * ─── NO TERMS ACCEPTANCE, DELIBERATELY ──────────────────────────────
 *
 * Web's signup asks for none, sends none, and records none. Mirroring it
 * means having none here. A consent checkbox that nothing persists would
 * be a legal record that is not a record, which is worse than its
 * absence. Owner-confirmed; recorded so a later reader does not read the
 * omission as an oversight.
 *
 * ─── ANTI-ABUSE ─────────────────────────────────────────────────────
 *
 * The route is behind `rateLimit({ windowMs: 15 min, limit: 5 })`. No
 * captcha exists anywhere in this product, so there is no protection for
 * this client to route around. Note that CLAUDE.md records the limiter as
 * in-memory PER PROCESS, so the ceiling is per API instance.
 */

export type Persona = 'SOLO' | 'STUDIO';

export interface SignupDraft {
  persona: Persona | null;
  studioName: string;
  ownerName: string;
  email: string;
  password: string;
  phone: string;
}

export interface SignupResult {
  message: string;
  email: string;
  studioSlug: string;
}

export const emptySignupDraft: SignupDraft = {
  persona: null,
  studioName: '',
  ownerName: '',
  email: '',
  password: '',
  phone: '',
};

/** The route's own `EMAIL_PATTERN` behaviour, kept deliberately loose. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const MIN_PASSWORD_LENGTH = 8;

/**
 * The route's validation, rule for rule and in its order, so the form
 * refuses in place rather than bouncing off a 400.
 *
 * The server stays the authority — this only avoids a round trip for
 * something already known to fail. Returns the first problem, matching
 * how the route itself returns on the first failed check.
 */
export function validateSignup(draft: SignupDraft): string | null {
  if (draft.persona !== 'SOLO' && draft.persona !== 'STUDIO') {
    return 'Choose how you will be using Ink Manager.';
  }
  if (draft.ownerName.trim().length === 0) {
    return 'Your name is required.';
  }
  if (!EMAIL_RE.test(draft.email.trim())) {
    return 'A valid email is required.';
  }
  if (draft.password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (draft.persona === 'STUDIO' && draft.studioName.trim().length === 0) {
    return 'Studio name is required for a studio account.';
  }
  return null;
}

/**
 * The body, shaped exactly as web sends it.
 *
 * `studioName` is included ONLY for STUDIO — web omits the key entirely
 * for a solo account and lets the server default it to the owner's name,
 * which is also what makes the intake-form and flash-gallery URLs read
 * sensibly for a solo artist. Sending a blank string instead would fail
 * the route's own non-empty check for STUDIO and, for SOLO, defeat the
 * defaulting.
 *
 * `phone` is likewise omitted when empty rather than sent as "".
 */
export function buildSignupBody(draft: SignupDraft): Record<string, unknown> {
  return {
    persona: draft.persona,
    ownerName: draft.ownerName.trim(),
    email: draft.email.trim(),
    password: draft.password,
    ...(draft.persona === 'STUDIO' ? { studioName: draft.studioName.trim() } : {}),
    ...(draft.phone.trim() ? { phone: draft.phone.trim() } : {}),
  };
}

export function signUp(draft: SignupDraft): Promise<SignupResult> {
  return apiFetch<SignupResult>('/auth/signup', {
    method: 'POST',
    body: JSON.stringify(buildSignupBody(draft)),
  });
}

/** `POST /auth/resend-verification`, behind its own rate limiter. */
export function resendVerification(email: string): Promise<unknown> {
  return apiFetch('/auth/resend-verification', {
    method: 'POST',
    body: JSON.stringify({ email: email.trim() }),
  });
}

/**
 * Signup failures, in words, WITHOUT ever confusing "we could not reach
 * the server" with "the server said no".
 *
 * ─── STATUS 0, NOT `fromApi`, IS THE NETWORK TEST ───────────────────
 *
 * This was written the other way first and it was wrong, caught by
 * running it: the API's RATE LIMITER answers 429 with a PLAIN-TEXT body
 * ("Too many requests, please try again later."), not the
 * `{ error }` JSON every route emits. `apiFetch` sets `fromApi` from
 * whether that JSON parsed, so a real, meaningful 429 arrives with
 * `fromApi: false` and a `fromApi`-first mapper reports it as
 * "check your connection" -- sending someone to look at their wifi when
 * what they actually need is to wait a few minutes.
 *
 * `status === 0` is set in exactly one place: `apiFetch`'s catch branch,
 * where the request never completed. That is the only true "unreachable"
 * signal, so it is the one this keys on. Anything with a status is an
 * answer from the server and gets read as one.
 */
export function signupErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    /* The only genuinely-unreachable case. */
    if (err.status === 0) {
      return "Couldn't reach Ink Manager. Check your connection and try again.";
    }
    /* Ahead of the JSON check, because this one is not JSON. */
    if (err.status === 429) {
      return 'Too many sign-up attempts. Wait a few minutes and try again.';
    }
    if (err.status >= 500) {
      return 'Something went wrong on our side. Try again in a moment.';
    }
    /* 400 and 409 are the route's own sentences -- "A valid email is
       required", "An account with that email already exists. Try logging
       in instead." -- and rewording them would only make the two clients
       disagree about the same rejection. */
    if (err.fromApi && err.message) return err.message;
  }
  return 'Could not create your account. Try again.';
}
