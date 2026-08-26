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

/**
 * `POST /inquiries` — staff logging a walk-in or phone inquiry.
 *
 * ─── ONE ROUTE, TWO CALLERS ─────────────────────────────────────────
 *
 * It is mounted with `optionalAuth`, and it branches on `req.user`, not
 * on the path:
 *
 *   no token   the public intake form. `studioSlug` is required.
 *   a token    staff. The studio comes from the token, `studioSlug` is
 *              ignored, and the caller must hold `inquiries.create`
 *              (checked inline, 403 otherwise — there is no
 *              requirePermission middleware to hang it off).
 *
 * So this sends no `studioSlug`: sending one from an authenticated
 * client would be inventing a parameter the route does not read.
 *
 * ─── REQUIREDNESS IS THE STUDIO'S, NOT A CONSTANT ───────────────────
 *
 * The server walks the studio's own configured intake fields
 * (`enabledSystemFields`, `isRequired(key)`) and replies
 * `Missing required field(s): <labels>`. Mobile mirrors web's client-side
 * rules, which assume the defaults — so a studio that has turned a field
 * off may see the server accept something this form still asks for. That
 * is the safe direction to be wrong in, and the server's message is
 * surfaced verbatim when it disagrees.
 */
export interface NewInquiry {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  channel: string;
  referralCode?: string;
  description: string;
  colorOrBlackGrey: string;
  placement: string;
  estimatedSize: string;
  hasBeenTattooedBefore: boolean;
  budget?: string;
  desiredTiming?: string;
  preferredArtistId?: string;
  referenceImages: string[];
  placementImages: string[];
  existingClientId?: string;
}

export function createInquiry(token: string, input: NewInquiry): Promise<{ id: string }> {
  return apiFetch<{ id: string }>('/inquiries', {
    method: 'POST',
    token,
    // `|| undefined` on every optional, matching web exactly: the route
    // distinguishes absent from empty on several of these.
    body: JSON.stringify({
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      phone: input.phone || undefined,
      channel: input.channel,
      referralCode: input.channel === 'REFERRAL' ? input.referralCode : undefined,
      description: input.description,
      colorOrBlackGrey: input.colorOrBlackGrey,
      placement: input.placement,
      estimatedSize: input.estimatedSize,
      hasBeenTattooedBefore: input.hasBeenTattooedBefore,
      budget: input.budget || undefined,
      desiredTiming: input.desiredTiming || undefined,
      preferredArtistId: input.preferredArtistId || undefined,
      referenceImages: input.referenceImages,
      placementImages: input.placementImages,
      existingClientId: input.existingClientId || undefined,
    }),
  });
}
