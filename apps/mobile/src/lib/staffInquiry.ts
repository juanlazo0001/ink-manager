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

  /*
   * The project timeline's inputs. Both were already on the wire —
   * `GET /inquiries/:id` returns them and apps/web reads them — and were
   * simply not declared here, which is the third time this exact shape
   * of omission has hidden a real gap (see `avatarUrl` and
   * `placementImages` in session BB).
   *
   * Optional so nothing constructing a `StaffInquiryDetail` in a fixture
   * has to change.
   */
  projectCompletedAt?: string | null;
  sessions?: {
    id: string;
    checkedOutAt?: string | null;
    liabilityWaiver?: { status: string } | null;
  }[];

  depositForms: {
    id: string;
    paidAt: string | null;
    depositAmount: number;
    totalCharged: number;
    createdAt: string;
  }[];

  /*
   * The intake form this inquiry came through, and the studio's own
   * custom answers. Both on the wire already; see lib/intakeFields.ts for
   * why "The request" is now driven by them rather than by a fixed list.
   */
  intakeFormId?: string | null;
  customFieldAnswers?: Record<string, { question: string; type: string; answer: unknown }> | null;
  preferredArtist?: {
    id: string;
    user?: { name: string | null; email: string; avatarUrl?: string | null } | null;
  } | null;

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

/**
 * The statuses web treats as a converted PROJECT rather than an inquiry.
 * `isConverted` in `apps/web/src/pages/InquiryDetail.tsx`, and
 * `PROJECT_STATUSES` in its `lib/kanban.ts`. DEPOSIT_PENDING is
 * deliberately NOT one — web's own comment says it is still the
 * Inquiries tab.
 */
const PROJECT_STATUSES = ['SCHEDULING', 'WAITLISTED', 'CONFIRMED'];

/** Web's `PROJECT_STAGE_ORDER` / `PROJECT_STAGE_LABELS`, verbatim. */
const PROJECT_STAGES = [
  { key: 'needs-scheduling', label: 'Needs Scheduling' },
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'waiver-verified', label: 'Waiver Verified' },
  { key: 'session-complete', label: 'Session Complete' },
  { key: 'project-complete', label: 'Project Complete' },
];

/**
 * Which of the five project stages this record sits at, or -1.
 *
 * A port of web's `deriveProjectStage` (`lib/kanban.ts`), including its
 * reasoning: it returns the LAST COMPLETED milestone, not the stepper's
 * next goal, and it checks BOTH the older 1:1 `appointment` link and the
 * newer 1:many `sessions` link so it agrees with every other
 * "needs scheduling" definition in the app rather than being a narrower
 * one that only happens to match today.
 */
function projectStageIndex(inq: StaffInquiryDetail): number {
  if (inq.projectCompletedAt) return 4;
  const sessions = inq.sessions ?? [];
  if (sessions.length === 0 && !inq.appointmentId) return 0;
  // Sessions arrive startTime-ascending; the earliest not-yet-checked-out
  // one is the session being worked toward.
  const current = sessions.find((session) => !session.checkedOutAt);
  if (!current) return 3;
  if (current.liabilityWaiver?.status === 'VERIFIED') return 2;
  return 1;
}

/**
 * The Progress stepper.
 *
 * ─── TWO MODELS, AND MOBILE ONLY HAD ONE ────────────────────────────
 *
 * Web switches: an INQUIRY gets the intake lifecycle, and a converted
 * PROJECT gets the five-stage project timeline. Mobile showed the intake
 * lifecycle unconditionally, so every scheduled or confirmed project
 * displayed a stepper that had stopped describing it — "Deposit
 * requested / Scheduled" where web was already tracking waiver, session
 * and project completion. Measured in session BH's parity run: NONE of
 * web's five project stage labels appeared on mobile.
 *
 * Not a styling difference. The two clients were answering different
 * questions about the same record.
 */
export function pipelineStages(inq: StaffInquiryDetail): PipelineStage[] {
  if (PROJECT_STATUSES.includes(inq.status)) {
    const index = projectStageIndex(inq);
    return PROJECT_STAGES.map((stage, i) => ({
      ...stage,
      done: i <= index,
      // The stepper's goal is the stage AFTER the last completed one,
      // which is what web bolds. At the end, the last stage is current.
      current: i === Math.min(index + 1, PROJECT_STAGES.length - 1) && index < PROJECT_STAGES.length - 1,
    }));
  }

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
