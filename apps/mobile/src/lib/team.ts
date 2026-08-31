import { apiFetch } from './api';

/**
 * Team and permissions — `GET /studios/:studioId/users` and
 * `GET /studios/:studioId/permissions`, the same two calls apps/web's
 * Team page makes.
 */

export interface TeamUser {
  id: string;
  name: string | null;
  email: string;
  role: string;
  isActive: boolean;
  avatarUrl: string | null;
  deactivatedAt: string | null;
  /** An invited member who has not accepted yet. */
  pending: boolean;
  inviteExpiresAt: string | null;
  locationId: string | null;
}

/**
 * `{ permissionKeys, matrix }`.
 *
 * `matrix` is keyed by role and contains **FRONT_DESK, ARTIST and
 * CUSTOMER only** — OWNER is structurally absent, because
 * `hasPermission()` short-circuits to true for that role before it ever
 * reads a RolePermission row. Confirmed against dev: the matrix has three
 * keys and the database holds zero OWNER rows.
 */
export interface PermissionsResponse {
  permissionKeys: string[];
  matrix: Record<string, Record<string, boolean>>;
}

/** The roles the matrix can actually configure, in web's own order. */
export const CONFIGURABLE_ROLES = ['FRONT_DESK', 'ARTIST', 'CUSTOMER'] as const;
export type ConfigurableRole = (typeof CONFIGURABLE_ROLES)[number];

export const ROLE_LABELS: Record<string, string> = {
  OWNER: 'Owner',
  FRONT_DESK: 'Front desk',
  ARTIST: 'Artist',
  CUSTOMER: 'Customer',
};

export function fetchTeamUsers(
  token: string,
  studioId: string,
  signal?: AbortSignal,
): Promise<TeamUser[]> {
  return apiFetch<TeamUser[]>(`/studios/${encodeURIComponent(studioId)}/users`, { token, signal });
}

/**
 * `POST /studios/:studioId/invites` — web's "Invite team member".
 *
 * Same body web sends (`Team.tsx`'s `handleInviteSubmit`): email, name,
 * phone, role. The route requires `team.manage` AND that the path studio
 * matches the caller's own token studio, so there is no cross-studio
 * shape to get wrong here.
 *
 * The response is the created invite; nothing on mobile reads it — the
 * screen re-fetches the roster instead, because the row it needs to draw
 * is a PENDING user and that is a different shape from this.
 */
export function inviteTeamMember(
  token: string,
  studioId: string,
  input: { email: string; name: string; phone: string; role: string },
): Promise<unknown> {
  return apiFetch<unknown>(`/studios/${encodeURIComponent(studioId)}/invites`, {
    method: 'POST',
    token,
    body: JSON.stringify(input),
  });
}

export function fetchPermissions(
  token: string,
  studioId: string,
  signal?: AbortSignal,
): Promise<PermissionsResponse> {
  return apiFetch<PermissionsResponse>(`/studios/${encodeURIComponent(studioId)}/permissions`, {
    token,
    signal,
  });
}

/** How many of a group's keys are on for a role — web's "N/M enabled". */
export function enabledCount(
  matrix: PermissionsResponse['matrix'],
  role: string,
  keys: string[],
): number {
  const row = matrix[role] ?? {};
  return keys.reduce((n, k) => n + (row[k] ? 1 : 0), 0);
}
