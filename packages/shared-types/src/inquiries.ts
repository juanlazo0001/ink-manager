import type { InquiryStatus } from './enums';

/**
 * Inquiries are the one surface in this API that already projects
 * per-role SERVER-SIDE, and it is worth stating plainly because it is the
 * opposite of `GET /appointments/:id`:
 *
 *   OWNER / FRONT_DESK   GET /inquiries          GET /inquiries/:id
 *   ARTIST               GET /inquiries/assigned-to-me
 *                        GET /inquiries/assigned-to-me/:id
 *
 * The staff routes are `requireRole(OWNER, FRONT_DESK)` — an artist gets
 * a 403, not a filtered list. The artist routes are scoped to
 * `assignedArtistId === their own artist id`, use a narrower projection
 * (client is first/last name only, never email or phone), and then have
 * the studio-configurable `pricingDetail` / `internalNotes` toggles
 * applied on top.
 *
 * So a client does NOT need to gate these responses itself. It needs to
 * call the right route for the caller's role, and show what comes back.
 */

export interface InquiryClientRef {
  firstName: string;
  lastName: string;
}

export interface InquiryArtistRef {
  id: string;
  user: { id: string; name: string | null; email: string; avatarUrl: string | null };
}

/** Non-null when the record lives at a studio the caller only guests at. */
export type FromGuestStudio = { id: string; name: string } | null;

/** One row of `GET /inquiries` (OWNER / FRONT_DESK). */
export interface StaffInquiryListItem {
  id: string;
  channel: string;
  description: string;
  status: InquiryStatus;
  createdAt: string;
  updatedAt: string;
  priceEstimateLow: number | null;
  priceEstimateHigh: number | null;
  estimateSentAt: string | null;
  estimateOpenedAt: string | null;
  referenceImages: string[];
  /** Set once the project is wrapped up — part of the derived pipeline stage. */
  projectCompletedAt: string | null;
  client: InquiryClientRef | null;
  assignedArtist: InquiryArtistRef | null;
  appointment: { startTime: string } | null;
  fromGuestStudio: FromGuestStudio;
}

/**
 * One row of `GET /inquiries/assigned-to-me` (ARTIST).
 *
 * A different, narrower shape than the staff row — not a subset of it.
 * Notably it carries the artist's own rate (needed for their estimate
 * flow) and the linked sessions, but no estimate-sent/opened tracking.
 */
export interface ArtistInquiryListItem {
  id: string;
  channel: string;
  description: string;
  colorOrBlackGrey: string | null;
  placement: string | null;
  estimatedSize: string | null;
  hasBeenTattooedBefore: boolean | null;
  budget: string | null;
  desiredTiming: string | null;
  referenceImages: string[];
  placementImages: string[];
  createdAt: string;
  updatedAt: string;
  status: InquiryStatus;
  /** May be stripped by the studio's `pricingDetail` visibility toggle. */
  priceEstimateLow: number | null;
  priceEstimateHigh: number | null;
  timeEstimateHoursMin: number | null;
  timeEstimateHoursMax: number | null;
  projectCompletedAt: string | null;
  client: InquiryClientRef | null;
  assignedArtist: (InquiryArtistRef & { hourlyRateCents: number | null; flatRateCents: number | null }) | null;
  service: { id: string; name: string; pricingModel: string } | null;
  appointment: { id: string; startTime: string; endTime: string; status: string } | null;
  fromGuestStudio: FromGuestStudio;
}

/**
 * Query parameters for `GET /inquiries` (staff only).
 * `status` and `artistId` repeat for multiple values; `artistId=unassigned`
 * is a real, special value. Results are capped at 100 — there is no
 * pagination.
 */
export interface StaffInquiryListQuery {
  status?: InquiryStatus[];
  artistId?: string[];
  q?: string;
  sort?: string;
}

/**
 * `GET /inquiries/assigned-to-me` takes one parameter.
 *
 * Default (omitted) returns ONLY `ARTIST_ASSIGNED` inquiries — the
 * artist's review inbox. `scope=all` drops that filter and returns their
 * whole non-archived pipeline, which is what a full list wants.
 */
export interface ArtistInquiryListQuery {
  scope?: 'all';
}

/**
 * Every inquiry status transition is gated on a permission key evaluated
 * at THE INQUIRY'S OWN studio (`hasPermissionAt`), never on role — a
 * guest artist's rights follow the record, not their home studio.
 *
 * Listed here so a client can decide what to offer without re-deriving
 * it. None of `inquiries.edit`, `inquiries.markLost` or
 * `inquiries.assignArtist` is in an ARTIST's default set.
 */
export const INQUIRY_TRANSITION_PERMISSIONS = {
  waitlist: 'inquiries.edit',
  unwaitlist: 'inquiries.edit',
  reopen: 'inquiries.edit',
  release: 'inquiries.edit',
  'mark-good-candidate': 'inquiries.edit',
  'complete-project': 'inquiries.edit',
  'reopen-project': 'inquiries.edit',
  archive: 'inquiries.edit',
  'mark-lost': 'inquiries.markLost',
  assign: 'inquiries.assignArtist',
  'revise-estimate': 'inquiries.enterEstimate',
} as const;

// ---------------------------------------------------------------------
// GET /inquiries/assigned-to-me/:id — the artist's project detail
// ---------------------------------------------------------------------
//
// Same `ARTIST_INQUIRY_SELECT` projection as the artist list, scoped to
// `assignedArtistId === the caller's own artist id`.
//
// Two things shape these types:
//
// 1. Fields marked "may be absent" are removed from the response by
//    `applyArtistFieldVisibility()` when the studio turns a toggle off --
//    `pricingDetail` deletes the estimate/budget/deposit fields,
//    `internalNotes` deletes notes. They are `?` rather than `| null`
//    because the key is genuinely GONE, not nulled, and the difference
//    matters: absent means "your studio does not show you this", null
//    means "not set yet".
// 2. Permission is evaluated at the INQUIRY's studio, not the caller's
//    home one. That currently produces a documented inconsistency -- the
//    list route is home-studio scoped -- so a 403 here on a row that the
//    list happily returned is an expected state a client must handle.
//    See apps/mobile/PARITY-AUDIT.md, Finding B.

export interface InquiryNoteRef {
  id: string;
  bodyHtml: string;
  attachments: unknown;
  createdAt: string;
  author: { id: string; name: string | null; email: string } | null;
}

export interface InquirySessionRef {
  id: string;
  startTime: string;
  endTime: string;
  status: string;
  checkedOutAt: string | null;
  /** An artist's own tip always survives the pricing toggle, by design. */
  tipCents: number | null;
  liabilityWaiver: { status: string } | null;
  photos: { id: string; url: string; uploadedAt: string }[];
}

export interface InquiryPlannedSessionRef {
  id: string;
  sessionNumber: number;
  estimatedHoursMin: number | null;
  estimatedHoursMax: number | null;
  estimatedPriceLow: number | null;
  estimatedPriceHigh: number | null;
  depositForm: { signedAt: string | null; paidAt: string | null } | null;
}

export interface ArtistInquiryDetail {
  id: string;
  channel: string;
  description: string;
  colorOrBlackGrey: string | null;
  placement: string | null;
  estimatedSize: string | null;
  hasBeenTattooedBefore: boolean | null;
  desiredTiming: string | null;
  referenceImages: string[];
  placementImages: string[];
  createdAt: string;
  updatedAt: string;
  status: InquiryStatus;
  projectCompletedAt: string | null;

  /** May be absent — `pricingDetail` visibility. */
  budget?: string | null;
  priceEstimateLow?: number | null;
  priceEstimateHigh?: number | null;
  timeEstimateHoursMin?: number | null;
  timeEstimateHoursMax?: number | null;
  depositForms?: { id: string; sessionNumber: number; signedAt: string | null; paidAt: string | null; paidManually: boolean }[];

  /** May be absent — `internalNotes` visibility. Already filtered to `visibleToArtist`. */
  notes?: InquiryNoteRef[];

  client: InquiryClientRef | null;
  assignedArtist: (InquiryArtistRef & { hourlyRateCents: number | null; flatRateCents: number | null }) | null;
  service: { id: string; name: string; pricingModel: string } | null;
  appointment: { id: string; startTime: string; endTime: string; status: string } | null;
  sessions: InquirySessionRef[];
  plannedSessions: InquiryPlannedSessionRef[];
  fromGuestStudio: FromGuestStudio;
}

/**
 * `PATCH /inquiries/:id/respond` — the artist's own decision on a project
 * assigned to them.
 *
 * The two decisions are NOT symmetrical, and it matters for any client:
 *
 * - `DECLINE` needs only a non-empty `declineNote`. A genuine one-step
 *   action.
 * - `APPROVE` is estimate COMPOSITION — price range, time range and a
 *   session plan, all validated server-side. It is not a simple
 *   transition, and web presents it as a form, not a button.
 *
 * Gated by `inquiries.enterEstimate` at the INQUIRY's studio (both
 * decisions), plus the inquiry being assigned to the caller.
 *
 * Separately, `inquiries.artistSendEstimate` decides the CONSEQUENCE of
 * an approve rather than the right to make one: with it, the estimate is
 * really sent to the client; without it, the identical fields are saved
 * and front desk sends. Worth telling the artist which will happen.
 */
export interface RespondDeclineRequest {
  decision: 'DECLINE';
  declineNote: string;
}

export interface RespondApproveRequest {
  decision: 'APPROVE';
  priceEstimateLow: number;
  priceEstimateHigh: number;
  timeEstimateHoursMin?: number | null;
  timeEstimateHoursMax?: number | null;
  sessions?: unknown[];
}

export type RespondRequest = RespondDeclineRequest | RespondApproveRequest;
