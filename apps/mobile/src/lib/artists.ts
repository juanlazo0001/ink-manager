import type {
  ArtistProfile,
  MeResponse,
  ScheduleBlock,
  ServiceOption,
  WidgetLayout,
} from '@ink-manager/shared-types';

import { apiFetch } from './api';

/**
 * Every request the profile screens make. One module so the endpoint each
 * field belongs to is visible in one place — which matters more here than
 * anywhere else in this app, because the artist profile is NOT one
 * resource behind one write.
 *
 *   PATCH /users/me                       name, phone, avatar
 *   PATCH /artists/:id                    the whole profile document
 *   PATCH /artists/:id/preferred-schedule  weekly availability, alone
 *   PATCH /artists/:id/self-scheduling     one boolean, solo-gated
 *   PATCH /artists/:id/profile-delegation  one boolean, self-only
 *   PATCH /artists/:id/publish             the public page
 *   PUT   /widget-layouts/artist-detail    section order + collapsed
 *
 * Web splits them exactly this way. Collapsing them into one save would
 * mean sending fields the API strips, or asking for permissions the
 * caller may not hold on a save that should have succeeded without them.
 */

/**
 * `GET /artists`. Needs `artists.view`.
 *
 * The studio's roster — HOME artists plus anyone currently guesting, and
 * never a deleted account. Web's Flash gallery calls this to populate its
 * artist filter, and only for staff, because an ARTIST caller already
 * sees exactly one person's pieces.
 *
 * Only the three fields a picker needs are typed here. The route returns
 * a much larger artist object; naming the subset keeps a caller from
 * quietly depending on a field this app never asked for.
 */
export interface ArtistOption {
  id: string;
  /*
   * `user.id` is the USER id, not the artist id, and the two are not
   * interchangeable: `POST /inquiries/:id/share-to-artist` takes
   * `artistUserId` and rejects an Artist.id outright. `GET /artists` has
   * always selected it (`artistListSelect` in routes/artists.ts) -- the
   * type simply never declared it, the same way `portfolioImages` did
   * not until something needed it.
   */
  user: { id: string; name: string | null; email: string; avatarUrl: string | null };
  /**
   * Cloudinary URLs on the artist record.
   *
   * `GET /artists` has always selected this (`artistListSelect` in
   * routes/artists.ts); the type simply never declared it, because no
   * mobile screen read it until the composer's portfolio picker. Optional
   * rather than required so that nothing already destructuring an
   * `ArtistOption` has to change.
   */
  portfolioImages?: string[];
}

export function fetchArtists(token: string, signal?: AbortSignal): Promise<ArtistOption[]> {
  return apiFetch<ArtistOption[]>('/artists', { token, signal });
}

/** Web's own `artistLabel` — the name, falling back to the email. */
export function artistLabel(artist: ArtistOption): string {
  return artist.user.name ?? artist.user.email;
}

/** `GET /artists/:id`. Needs `artists.view`, which ARTIST holds by default. */
export function fetchArtistProfile(token: string, artistId: string, signal?: AbortSignal): Promise<ArtistProfile> {
  return apiFetch<ArtistProfile>(`/artists/${encodeURIComponent(artistId)}`, { token, signal });
}

export function fetchServices(token: string, signal?: AbortSignal): Promise<ServiceOption[]> {
  return apiFetch<ServiceOption[]>('/services', { token, signal });
}

export function fetchWidgetLayout(token: string, pageKey: string, signal?: AbortSignal): Promise<WidgetLayout> {
  return apiFetch<WidgetLayout>(`/widget-layouts/${encodeURIComponent(pageKey)}`, { token, signal });
}

/**
 * `PUT /widget-layouts/:pageKey` — both arrays are required, so this
 * always sends both. Deliberately fire-and-forget at the call site: a
 * failed layout write is a display preference that didn't stick, never a
 * reason to interrupt someone mid-edit.
 */
export function saveWidgetLayout(token: string, pageKey: string, layout: WidgetLayout): Promise<WidgetLayout> {
  return apiFetch<WidgetLayout>(`/widget-layouts/${encodeURIComponent(pageKey)}`, {
    method: 'PUT',
    token,
    body: JSON.stringify(layout),
  });
}

/** `PATCH /artists/:id` — the whole document. See `artistPatchFrom`. */
export function saveArtistProfile(
  token: string,
  artistId: string,
  body: Record<string, unknown>,
): Promise<ArtistProfile> {
  return apiFetch<ArtistProfile>(`/artists/${encodeURIComponent(artistId)}`, {
    method: 'PATCH',
    token,
    body: JSON.stringify(body),
  });
}

/**
 * `PATCH /artists/:id/preferred-schedule`.
 *
 * Separate from the main save because it is separately permissioned:
 * `artistSchedules.manage`, which a studio can revoke from ARTIST
 * entirely — even for an artist's own schedule. A studio that has done
 * that gets a 403 here while the rest of the profile still saves, which
 * is the whole reason the two are not one request.
 */
export function savePreferredSchedule(
  token: string,
  artistId: string,
  preferredSchedule: ScheduleBlock[] | null,
): Promise<ArtistProfile> {
  return apiFetch<ArtistProfile>(`/artists/${encodeURIComponent(artistId)}/preferred-schedule`, {
    method: 'PATCH',
    token,
    body: JSON.stringify({ preferredSchedule }),
  });
}

/**
 * `PATCH /artists/:id/self-scheduling`.
 *
 * Reachable by an artist only at a SOLO studio. Anywhere else the API
 * answers 403 with "Self-scheduling is managed by your studio -- ask an
 * owner to enable it for you", which is a real answer worth showing
 * rather than a failure to hide.
 */
export function setSelfScheduling(
  token: string,
  artistId: string,
  allowsClientSelfScheduling: boolean,
): Promise<ArtistProfile> {
  return apiFetch<ArtistProfile>(`/artists/${encodeURIComponent(artistId)}/self-scheduling`, {
    method: 'PATCH',
    token,
    body: JSON.stringify({ allowsClientSelfScheduling }),
  });
}

/**
 * `PATCH /artists/:id/profile-delegation` — whether studio staff may edit
 * this artist's profile on their behalf. Self-only with no staff bypass
 * at all, by design: it is the one switch a studio can never flip.
 */
export function setProfileDelegation(
  token: string,
  artistId: string,
  allowsStudioProfileEdits: boolean,
): Promise<{ allowsStudioProfileEdits: boolean }> {
  return apiFetch<{ allowsStudioProfileEdits: boolean }>(
    `/artists/${encodeURIComponent(artistId)}/profile-delegation`,
    { method: 'PATCH', token, body: JSON.stringify({ allowsStudioProfileEdits }) },
  );
}

/**
 * `PATCH /artists/:id/publish`.
 *
 * Publishing needs a slug and can legitimately fail two ways the person
 * can act on: 409 when the URL is taken, and 400 when their home studio
 * has no location on file yet. Unpublishing takes `{ publish: false }`
 * alone and never fails that way.
 */
export function setPublished(
  token: string,
  artistId: string,
  body: { publish: true; publicSlug: string } | { publish: false },
): Promise<ArtistProfile> {
  return apiFetch<ArtistProfile>(`/artists/${encodeURIComponent(artistId)}/publish`, {
    method: 'PATCH',
    token,
    body: JSON.stringify(body),
  });
}

/**
 * `PATCH /users/me` — account fields only: name, phone, avatarUrl.
 *
 * Not bio or specialties: those used to live here too and now belong to
 * `PATCH /artists/:id` alone. Not email or password either — both have
 * their own confirmation-gated flows, and this route silently ignores
 * them rather than erroring, which is exactly how a client can think it
 * changed something it didn't.
 */
export function updateAccount(
  token: string,
  body: { name?: string | null; phone?: string | null; avatarUrl?: string | null },
): Promise<MeResponse> {
  return apiFetch<MeResponse>('/users/me', { method: 'PATCH', token, body: JSON.stringify(body) });
}
