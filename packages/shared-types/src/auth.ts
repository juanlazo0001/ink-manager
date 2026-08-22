import type { Role } from './enums';

/**
 * `POST /login` — request and response.
 *
 * The response really is just a token: no user object comes back, so a
 * client that needs a name, role or studio must follow up with
 * `GET /users/me`. The JWT is signed with `expiresIn: "7d"`, but its own
 * expiry is not the whole story — `requireAuth` re-checks the account on
 * every request (deactivation, deletion, and a password change since the
 * token's `iat`), so a structurally valid token can still be rejected.
 * Treat a 401 from any authenticated route as authoritative.
 */
export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  token: string;
}

/**
 * `POST /login` can fail with a 401 that is NOT a wrong password. Only the
 * unverified-email case carries a machine-readable `code`; the others are
 * distinguished by their (human-readable) message alone.
 */
export interface ApiErrorBody {
  error: string;
  /** e.g. `"email_not_verified"`. Absent on most error responses. */
  code?: string;
}

/**
 * `GET /users/me` — the subset the mobile client consumes.
 *
 * The real response is considerably larger (artist profile, memberships,
 * onboarding-wizard eligibility, `isSoloStudio`…). Narrowed on purpose:
 * a client that wants more should widen this deliberately, rather than
 * inherit a stale copy of the web app's own `UserProfile`.
 */
export interface MeResponse {
  id: string;
  email: string;
  name: string | null;
  phone: string | null;
  avatarUrl: string | null;
  role: Role;
  studioId: string;
  /**
   * Every permission key in effect for this user's role at their own
   * studio. Note that a conversation's own `callerPermissions` is
   * evaluated at the *thread's* studio, which can differ for a guest
   * artist — prefer that one when deciding what a thread allows.
   */
  permissions: string[];
}

/** `GET /studios/:studioId` — the subset the mobile client consumes. */
export interface StudioResponse {
  id: string;
  name: string;
  logoUrl: string | null;
  website: string | null;
}
