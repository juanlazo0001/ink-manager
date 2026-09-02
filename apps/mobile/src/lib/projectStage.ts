/**
 * The derived PROJECT stage — the five-step timeline a converted inquiry
 * sits on, as opposed to its raw `InquiryStatus`.
 *
 * ─── WHY THIS IS ITS OWN MODULE ─────────────────────────────────────
 *
 * Session BH ported web's `deriveProjectStage` into `staffInquiry.ts` for
 * the Progress stepper, which left the screen contradicting itself: the
 * stepper said "Session Complete" while the header chip two inches above
 * it still said "SCHEDULING". Three different screens need the same
 * answer and only one of them imports `staffInquiry`, so the derivation
 * lives here.
 *
 * ─── WEB IS NOT UNIFORM ABOUT THIS, DELIBERATELY ────────────────────
 *
 * Checked context by context rather than assumed, because "use the
 * derived stage everywhere" would have been wrong:
 *
 *   InquiryDetail header      derived, else status   (InquiryDetail.tsx)
 *   Pipeline list / Kanban    derived, else status   (InquiryKanbanCard)
 *   Artist project detail     derived                (MyProjectDetail)
 *   CLIENT detail's list      RAW STATUS, always     (ClientDetail.tsx)
 *
 * The client page is the exception on purpose: it lists a person's whole
 * history across inquiries and projects, where the pipeline stage of one
 * converted project is less use than the status every row can show.
 * Mobile now matches each of those choices in its own equivalent screen.
 */

/** `PROJECT_STATUSES` in web's `lib/kanban.ts`. */
const PROJECT_STATUSES = ['SCHEDULING', 'WAITLISTED', 'CONFIRMED'];

/** `PROJECT_STAGE_ORDER` / `PROJECT_STAGE_LABELS`, verbatim. */
export const PROJECT_STAGES = [
  { key: 'NEEDS_SCHEDULING', label: 'Needs Scheduling' },
  { key: 'SCHEDULED', label: 'Scheduled' },
  { key: 'WAIVER_VERIFIED', label: 'Waiver Verified' },
  { key: 'SESSION_COMPLETE', label: 'Session Complete' },
  { key: 'PROJECT_COMPLETE', label: 'Project Complete' },
] as const;

/**
 * The shape the derivation reads. Deliberately loose: the LIST route
 * returns `sessions` and `projectCompletedAt` but NOT `appointmentId`,
 * while the DETAIL route returns all three, and both have to work.
 */
export interface ProjectStageInput {
  status: string;
  projectCompletedAt?: string | null;
  appointmentId?: string | null;
  appointment?: unknown;
  sessions?: { checkedOutAt?: string | null; liabilityWaiver?: { status: string } | null }[];
}

/**
 * Which of the five stages this record sits at, or -1 when it is not a
 * converted project at all.
 *
 * Web's `deriveProjectStage`, including its own reasoning: it returns the
 * LAST COMPLETED milestone rather than the stepper's next goal, and it
 * checks BOTH the older 1:1 appointment link and the newer 1:many
 * sessions link so it agrees with every other "needs scheduling"
 * definition in the app.
 */
export function projectStageIndex(inq: ProjectStageInput): number {
  if (!PROJECT_STATUSES.includes(inq.status)) return -1;
  if (inq.projectCompletedAt) return 4;

  const sessions = inq.sessions ?? [];
  const booked = !!inq.appointmentId || !!inq.appointment;
  if (sessions.length === 0 && !booked) return 0;

  // Sessions arrive startTime-ascending; the earliest not-yet-checked-out
  // one is the session being worked toward.
  const current = sessions.find((session) => !session.checkedOutAt);
  if (!current) return 3;
  if (current.liabilityWaiver?.status === 'VERIFIED') return 2;
  return 1;
}

/**
 * The label for the chip, or null when the raw status should be shown.
 *
 * Null rather than a fallback string: the caller renders
 * `InquiryStatusChip` for null, which carries the status colours, and a
 * function that invented a label here would quietly take that decision
 * away from it.
 */
export function projectStageLabel(inq: ProjectStageInput): string | null {
  const index = projectStageIndex(inq);
  return index < 0 ? null : PROJECT_STAGES[index].label;
}
