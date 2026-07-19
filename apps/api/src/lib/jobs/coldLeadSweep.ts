import { prisma } from "../prisma";
import { InquiryStatus } from "../../../generated/prisma/enums";
import { logAudit } from "../audit";
import { registerJob } from "./registry";

export const COLD_LEAD_SWEEP = "coldLeadSweep";

// Mirrors apps/web/src/pages/Inquiries.tsx's INQUIRIES_TAB_STATUSES minus
// the two terminal values (CLOSED_LOST, COLD_LEAD itself). Projects-side
// statuses (SCHEDULING, WAITLISTED, CONFIRMED) are never swept -- a
// confirmed/scheduled project going quiet isn't a "cold lead," it's a
// scheduling problem for staff to notice some other way. Kept as a literal
// list (not imported -- separate frontend/backend compilation units) so a
// change to either side is a deliberate, visible edit; if the frontend's
// tab grouping ever changes, this needs the same update.
const COLD_LEAD_ELIGIBLE_STATUSES: InquiryStatus[] = [
  InquiryStatus.NEW,
  InquiryStatus.ARTIST_ASSIGNED,
  InquiryStatus.AWAITING_CLIENT_RESPONSE,
  InquiryStatus.BUDGET_NEGOTIATION,
  InquiryStatus.DEPOSIT_PENDING,
];

function latestOf(...dates: (Date | null | undefined)[]): Date | null {
  const present = dates.filter((d): d is Date => d != null);
  if (present.length === 0) return null;
  return present.reduce((max, d) => (d > max ? d : max));
}

// Idempotency: the query only considers COLD_LEAD_ELIGIBLE_STATUSES, which
// excludes COLD_LEAD itself -- once an inquiry is swept, it no longer
// matches on a subsequent run (same slot re-run, or a later day's run),
// so it can never be re-processed or double-audited. Reopening (see
// POST /:id/reopen in routes/inquiries.ts) is the only way back into an
// eligible status, and that's an explicit staff action, not this job.
async function run(): Promise<Record<string, unknown>> {
  const studios = await prisma.studio.findMany({
    select: { id: true, settings: { select: { coldLeadDays: true } } },
  });

  let studiosProcessed = 0;
  let inquiriesSwept = 0;

  for (const studio of studios) {
    studiosProcessed += 1;
    const coldLeadDays = studio.settings?.coldLeadDays ?? 90;
    const cutoffMs = coldLeadDays * 24 * 60 * 60 * 1000;
    const now = new Date();

    const candidates = await prisma.inquiry.findMany({
      where: { studioId: studio.id, status: { in: COLD_LEAD_ELIGIBLE_STATUSES } },
      select: {
        id: true,
        status: true,
        updatedAt: true,
        estimateSentAt: true,
        estimateOpenedAt: true,
        estimateRespondedAt: true,
        client: { select: { conversation: { select: { lastMessageAt: true } } } },
      },
    });

    for (const inquiry of candidates) {
      const latestAudit = await prisma.auditLog.findFirst({
        where: { studioId: studio.id, entityType: "Inquiry", entityId: inquiry.id },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });

      const lastActivity = latestOf(
        inquiry.updatedAt,
        latestAudit?.createdAt,
        inquiry.client.conversation?.lastMessageAt,
        inquiry.estimateSentAt,
        inquiry.estimateOpenedAt,
        inquiry.estimateRespondedAt,
      );

      // Every inquiry has at least updatedAt, so lastActivity is never
      // null in practice -- the null-check is defensive, not a real path.
      if (!lastActivity || now.getTime() - lastActivity.getTime() < cutoffMs) continue;

      await prisma.inquiry.update({ where: { id: inquiry.id }, data: { status: InquiryStatus.COLD_LEAD } });

      await logAudit({
        studioId: studio.id,
        actorUserId: null,
        entityType: "Inquiry",
        entityId: inquiry.id,
        action: "status_change",
        changes: {
          status: { from: inquiry.status, to: InquiryStatus.COLD_LEAD },
          job: COLD_LEAD_SWEEP,
          lastActivityAt: lastActivity,
          coldLeadDays,
        },
      });

      inquiriesSwept += 1;
    }
  }

  return { studiosProcessed, inquiriesSwept };
}

registerJob({
  name: COLD_LEAD_SWEEP,
  description: "Marks pre-conversion inquiries with no activity for coldLeadDays as COLD_LEAD.",
  // 02:30 UTC daily -- staggered a half hour after the gift-card sweep so
  // the two never contend for the same instant, though neither touches
  // the other's tables anyway.
  schedule: "30 2 * * *",
  run,
});
