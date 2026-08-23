import type {
  ArtistInquiryDetail,
  ArtistInquiryListItem,
  RespondRequest,
  StaffInquiryListItem,
} from '@ink-manager/shared-types';

import { apiFetch } from './api';

/**
 * The inquiries surface is split by role SERVER-SIDE -- two different
 * route families, two different projections. A client's job is to call
 * the right one, not to filter the wrong one.
 *
 *   OWNER / FRONT_DESK -> GET /inquiries            (403 for an artist)
 *   ARTIST             -> GET /inquiries/assigned-to-me
 *
 * See the note in @ink-manager/shared-types/inquiries for why this is the
 * opposite of GET /appointments/:id and needs no client-side gating.
 */

/** True when this role must use the artist route family. */
export function usesArtistInquiryRoutes(role: string): boolean {
  return role === 'ARTIST';
}

/** OWNER / FRONT_DESK. Capped at 100 by the route; no pagination exists. */
export function fetchStaffInquiries(
  token: string,
  params: { q?: string } = {},
  signal?: AbortSignal,
): Promise<StaffInquiryListItem[]> {
  const query = new URLSearchParams();
  if (params.q && params.q.trim()) query.set('q', params.q.trim());
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return apiFetch<StaffInquiryListItem[]>(`/inquiries${suffix}`, { token, signal });
}

/**
 * ARTIST. `scope=all` is deliberate and not a detail: without it the
 * route returns ONLY `ARTIST_ASSIGNED` inquiries -- the review inbox --
 * which as a whole "Inquiries" tab would look like most of an artist's
 * pipeline had vanished.
 */
export function fetchArtistInquiries(
  token: string,
  signal?: AbortSignal,
): Promise<ArtistInquiryListItem[]> {
  return apiFetch<ArtistInquiryListItem[]>('/inquiries/assigned-to-me?scope=all', { token, signal });
}

/**
 * `GET /inquiries/assigned-to-me/:id` (ARTIST, and an OWNER with their
 * own artist profile).
 *
 * A 403 here on a row the LIST returned is an expected state, not a bug
 * in this client: the list is scoped by the caller's HOME studio while
 * this route checks the INQUIRY's studio. See PARITY-AUDIT.md Finding B.
 * The screen must say so rather than spin.
 */
export function fetchArtistInquiry(
  token: string,
  inquiryId: string,
  signal?: AbortSignal,
): Promise<ArtistInquiryDetail> {
  return apiFetch<ArtistInquiryDetail>(`/inquiries/assigned-to-me/${encodeURIComponent(inquiryId)}`, { token, signal });
}

/** OWNER / FRONT_DESK detail. Not reachable by an artist -- the route is role-gated. */
export function fetchStaffInquiry(
  token: string,
  inquiryId: string,
  signal?: AbortSignal,
): Promise<StaffInquiryListItem & Record<string, unknown>> {
  return apiFetch(`/inquiries/${encodeURIComponent(inquiryId)}`, { token, signal });
}

/**
 * `PATCH /inquiries/:id/respond` -- the artist's decision on their own
 * assigned project.
 *
 * Only DECLINE is issued from mobile today. APPROVE is estimate
 * composition (price range, time range, session plan, server-side
 * validated) and web presents it as a form, not a button -- see the
 * detail screen for how that hand-off is presented rather than faked.
 */
export function respondToInquiry(
  token: string,
  inquiryId: string,
  body: RespondRequest,
): Promise<ArtistInquiryDetail> {
  return apiFetch<ArtistInquiryDetail>(`/inquiries/${encodeURIComponent(inquiryId)}/respond`, {
    method: 'PATCH',
    token,
    body: JSON.stringify(body),
  });
}
