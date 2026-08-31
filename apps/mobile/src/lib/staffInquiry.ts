import type { InquiryStatus } from '@ink-manager/shared-types';

import { apiFetch } from './api';

/**
 * `GET /inquiries/:id` — the OWNER / FRONT_DESK view of an inquiry.
 *
 * A genuinely different shape from `GET /inquiries/assigned-to-me/:id`,
 * which is what mobile's existing inquiry screen renders. That difference
 * is why owner rows were never tappable: the guard in the inquiries list
 * (`onPress={isArtist ? … : undefined}`) was added because opening an
 * owner row would have loaded a payload the artist screen cannot read.
 *
 * It is NOT the API scoping inconsistency recorded in PARITY-AUDIT.md
 * Finding B. Verified against dev as the owner: this route returns 200
 * with the full record.
 *
 * Typed from the live response — shared-types stops at
 * `StaffInquiryListItem`, which is the LIST row and lacks most of what
 * detail returns. Logged as an API-typing gap.
 */
export interface StaffInquiryDetail {
  id: string;
  status: InquiryStatus;
  channel: string | null;
  description: string | null;
  createdAt: string;
  updatedAt: string;

  clientStatedBudget: string | null;
  budget: string | null;
  colorOrBlackGrey: string | null;
  estimatedSize: string | null;
  placement?: string | null;
  desiredTiming: string | null;
  hasBeenTattooedBefore: boolean | null;

  priceEstimateLow: number | null;
  priceEstimateHigh: number | null;
  timeEstimateHoursMin?: number | null;
  timeEstimateHoursMax?: number | null;
  estimateSentAt: string | null;
  estimateOpenedAt: string | null;
  estimateRespondedAt: string | null;
  estimateRevisionSentAt: string | null;
  estimateRevisionApproved: boolean | null;
  estimateRevisionReason: string | null;

  assignedArtistId: string | null;
  assignedAt: string | null;
  /*
   * `avatarUrl` was absent here and present on the wire the whole time --
   * `GET /inquiries/:id` returns it inside `assignedArtist.user`, checked
   * against the real dev payload before it was added. Web's Assignment
   * widget has always drawn it (`ArtistDetailField` -> `ArtistAvatar`);
   * mobile could not, because the type it read the response through did
   * not admit the field existed.
   */
  assignedArtist: {
    id: string;
    user?: { name: string | null; email: string; avatarUrl?: string | null } | null;
  } | null;

  clientId: string | null;
  client: { id: string; firstName: string; lastName: string } | null;

  appointmentId: string | null;
  appointment: { id: string; startTime?: string; startAt?: string } | null;

  depositForms: {
    id: string;
    paidAt: string | null;
    depositAmount: number;
    totalCharged: number;
    createdAt: string;
  }[];

  referenceImages?: string[];
  /*
   * `placementImages`, NOT `placementPhotos`. The old name was wrong and
   * had never been read, so it never failed -- it would simply have been
   * `undefined` forever the first time anything rendered it. The API's
   * column, its Prisma field and its JSON key are all `placementImages`
   * (schema.prisma:1815); web reads `inquiry.placementImages`. Confirmed
   * against a live response, not inferred from the schema alone.
   *
   * Web's own heading for these is "Placement photos" -- the LABEL is
   * photos, the FIELD is images. Almost certainly where the old name came
   * from.
   */
  placementImages?: string[];
  closedReason: string | null;
  declineNote: string | null;
  archivedAt: string | null;
}

export function fetchStaffInquiryDetail(
  token: string,
  id: string,
  signal?: AbortSignal,
): Promise<StaffInquiryDetail> {
  return apiFetch<StaffInquiryDetail>(`/inquiries/${encodeURIComponent(id)}`, { token, signal });
}

/**
 * Web's pipeline stepper, as five stages
 * (apps/web/src/pages/InquiryDetail.tsx renders exactly these):
 * inquiry received → artist assigned → estimate sent → deposit requested
 * → scheduled.
 *
 * Derived from timestamps rather than from `status`, because status moves
 * backwards (an inquiry can return to AWAITING_CLIENT_RESPONSE) while the
 * facts underneath do not.
 */
export interface PipelineStage {
  key: string;
  label: string;
  done: boolean;
  /** The first not-yet-done stage — what the studio owes this inquiry next. */
  current: boolean;
}

export function pipelineStages(inq: StaffInquiryDetail): PipelineStage[] {
  const depositRequested = inq.depositForms.length > 0;
  const base = [
    { key: 'received', label: 'Inquiry received', done: true },
    { key: 'assigned', label: 'Artist assigned', done: !!inq.assignedArtistId },
    { key: 'estimate', label: 'Estimate sent', done: !!inq.estimateSentAt },
    { key: 'deposit', label: 'Deposit requested', done: depositRequested },
    { key: 'scheduled', label: 'Scheduled', done: !!inq.appointmentId },
  ];
  // Web marks the current stage distinctly rather than showing a plain
  // done/not-done split, so the stepper answers "what next" and not just
  // "how far". The first unfinished stage is that stage.
  const firstOpen = base.findIndex((s) => !s.done);
  return base.map((s, i) => ({ ...s, current: i === firstOpen }));
}

export function artistName(inq: StaffInquiryDetail): string | null {
  const u = inq.assignedArtist?.user;
  return u ? (u.name ?? u.email) : null;
}

/** The assigned artist's avatar, or null. Null is a legitimate answer:
    most artists in dev have none, and the caller falls back to initials. */
export function artistAvatarUrl(inq: StaffInquiryDetail): string | null {
  return inq.assignedArtist?.user?.avatarUrl ?? null;
}

/**
 * Assign (or reassign) the artist on an inquiry — a LIVE write.
 *
 * Web's own request, verbatim (`handleAssign`,
 * apps/web/src/pages/InquiryDetail.tsx):
 *
 *     PATCH /inquiries/:id/assign      { artistId }
 *
 * The route returns the updated inquiry, so the caller can settle its
 * optimistic state on the server's own answer rather than on what it
 * guessed. Permission is `inquiries.assignArtist`, evaluated at the
 * INQUIRY's studio — see AssignArtistSheet's note for why that matters
 * and why the gate is the permission and never the role.
 */
export function assignInquiryArtist(
  token: string,
  inquiryId: string,
  artistId: string,
): Promise<StaffInquiryDetail> {
  return apiFetch<StaffInquiryDetail>(`/inquiries/${encodeURIComponent(inquiryId)}/assign`, {
    token,
    method: 'PATCH',
    body: JSON.stringify({ artistId }),
  });
}
