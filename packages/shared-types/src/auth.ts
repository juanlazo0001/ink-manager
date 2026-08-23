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
 * The real response is larger still (onboarding-wizard eligibility, guest
 * memberships…). Narrowed on purpose: a client that wants more should
 * widen this deliberately, rather than inherit a stale copy of the web
 * app's own `UserProfile`.
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
  /**
   * Present only for a user who HAS an artist profile. That is not the
   * same question as `role === 'ARTIST'`: a solo studio's first account is
   * commonly an OWNER with an artist profile attached, and it needs the
   * artist surfaces exactly as much as a role-ARTIST one does. Key off
   * this field, never off the role.
   */
  artist?: {
    /** The id every `/artists/:id` call needs. There is no other source. */
    id: string;
    bio: string | null;
    specialties: string[];
    allowsClientSelfScheduling: boolean;
    profileSetupCompletedAt: string | null;
    publicSlug: string | null;
    publishedAt: string | null;
    /** The active HOME row only, and only its delegation flag. */
    memberships: { allowsStudioProfileEdits: boolean }[];
  } | null;
  /**
   * This artist is the only OWNER/FRONT_DESK at their studio, so settings
   * a studio would normally control for them (client self-scheduling) are
   * theirs to set directly. Computed server-side; never infer it.
   */
  isSoloStudioArtist?: boolean;
  /** The studio has exactly one person in it, whatever their role. */
  isSoloStudio?: boolean;
}

/** `GET /studios/:studioId` — the subset the mobile client consumes. */
export interface StudioResponse {
  id: string;
  name: string;
  logoUrl: string | null;
  website: string | null;
}
