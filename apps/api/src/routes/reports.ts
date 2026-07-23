import { Router } from "express";
import { prisma } from "../lib/prisma";
import { AppointmentStatus, InquiryStatus, GiftCardStatus, Role } from "../../generated/prisma/enums";
import { requireAuth, requireRole } from "../middleware/auth";

const router = Router();
router.use(requireAuth);
// Same "all three staff roles" precedent as nav-counts.ts -- Dashboard.tsx
// (the one page this backs) has never been role-gated, everyone lands
// there after login. Revisit if the real dollar figures here (deposit
// conversion, gift card liability) turn out to need OWNER/FRONT_DESK-only
// treatment -- flagged in REPORT.md for review, not decided here.
router.use(requireRole(Role.OWNER, Role.FRONT_DESK, Role.ARTIST));

const DEFAULT_RANGE_DAYS = 30;

function parseRange(req: import("express").Request): { start: Date; end: Date } {
  const startRaw = typeof req.query.start === "string" ? new Date(req.query.start) : undefined;
  const endRaw = typeof req.query.end === "string" ? new Date(req.query.end) : undefined;

  const end =
    endRaw && !Number.isNaN(endRaw.getTime())
      ? new Date(endRaw.getFullYear(), endRaw.getMonth(), endRaw.getDate(), 23, 59, 59, 999)
      : new Date();

  const start =
    startRaw && !Number.isNaN(startRaw.getTime())
      ? new Date(startRaw.getFullYear(), startRaw.getMonth(), startRaw.getDate(), 0, 0, 0, 0)
      : new Date(end.getTime() - DEFAULT_RANGE_DAYS * 24 * 60 * 60 * 1000);

  return { start, end };
}

function avgHoursBetween(rows: { from: Date; to: Date }[]): number | null {
  if (rows.length === 0) return null;
  const totalMs = rows.reduce((sum, r) => sum + (r.to.getTime() - r.from.getTime()), 0);
  return totalMs / rows.length / (1000 * 60 * 60);
}

function pct(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

// Single combined endpoint (not six separate ones) -- the Dashboard loads
// every section at once, and this way every count/aggregate below runs as
// one batch of parallel, already-studio-and-date-scoped DB queries instead
// of six separate round trips re-deriving the same range. start/end (same
// param names as GET /appointments' own range filter) scope the funnel,
// lost/cold rate, response time, and artist utilization sections --
// deposit conversion and gift card liability are deliberately NOT
// date-ranged (the task spec only calls for a selector on the first four;
// a deposit form's "sent" event already only happens once, so an all-time
// conversion rate is the more meaningful number, and gift card liability
// is a right-now snapshot by definition).
router.get("/dashboard", async (req, res) => {
  const { studioId } = req.user!;
  const { start, end } = parseRange(req);

  const inquiryBaseWhere = { studioId, archivedAt: null, createdAt: { gte: start, lte: end } } as const;

  const [
    receivedCount,
    estimateSentCount,
    respondedCount,
    depositPendingCount,
    scheduledCount,
    completedCount,
    lostCount,
    coldCount,
    convertedCount,
    estimateSentRows,
    respondedRows,
    artistGroups,
    depositForms,
    giftCardAgg,
  ] = await Promise.all([
    prisma.inquiry.count({ where: inquiryBaseWhere }),
    prisma.inquiry.count({ where: { ...inquiryBaseWhere, estimateSentAt: { not: null } } }),
    prisma.inquiry.count({ where: { ...inquiryBaseWhere, estimateRespondedAt: { not: null } } }),
    // Package M: depositForm is now a to-many relation (depositForms) --
    // "reached the deposit stage" still just means at least one row exists.
    prisma.inquiry.count({ where: { ...inquiryBaseWhere, depositForms: { some: {} } } }),
    // Checks both the older 1:1 "scheduled slot" link (appointmentId) and
    // the newer 1:many "sessions under this project" link (sessions, via
    // Appointment.inquiryId) -- the real POST /:id/schedule route sets both
    // together, but at least one dev-seed fixture only ever populated the
    // newer relation directly, so counting only the older field undercounts.
    prisma.inquiry.count({
      where: { ...inquiryBaseWhere, OR: [{ appointmentId: { not: null } }, { sessions: { some: {} } }] },
    }),
    prisma.inquiry.count({
      where: {
        ...inquiryBaseWhere,
        OR: [
          { appointment: { is: { status: AppointmentStatus.COMPLETED } } },
          { sessions: { some: { status: AppointmentStatus.COMPLETED } } },
        ],
      },
    }),
    prisma.inquiry.count({ where: { ...inquiryBaseWhere, status: InquiryStatus.CLOSED_LOST } }),
    prisma.inquiry.count({ where: { ...inquiryBaseWhere, status: InquiryStatus.COLD_LEAD } }),
    prisma.inquiry.count({ where: { ...inquiryBaseWhere, status: InquiryStatus.CONFIRMED } }),
    prisma.inquiry.findMany({
      where: { ...inquiryBaseWhere, estimateSentAt: { not: null } },
      select: { createdAt: true, estimateSentAt: true },
    }),
    prisma.inquiry.findMany({
      where: { ...inquiryBaseWhere, estimateSentAt: { not: null }, estimateRespondedAt: { not: null } },
      select: { estimateSentAt: true, estimateRespondedAt: true },
    }),
    prisma.appointment.groupBy({
      by: ["artistId"],
      where: { studioId, archivedAt: null, startTime: { gte: start, lte: end } },
      _count: { _all: true },
    }),
    // All-time by design -- see comment above the route.
    prisma.depositForm.findMany({
      where: { inquiry: { studioId, archivedAt: null } },
      select: { createdAt: true, paidManually: true, paidAt: true },
    }),
    prisma.giftCard.aggregate({
      where: {
        studioId,
        status: GiftCardStatus.ACTIVE,
        OR: [{ expiresAt: null }, { expiresAt: { gte: new Date() } }],
      },
      _sum: { amountCents: true },
      _count: { _all: true },
    }),
  ]);

  const funnelStages = [
    { stage: "received", label: "Received", count: receivedCount },
    { stage: "estimateSent", label: "Estimate Sent", count: estimateSentCount },
    { stage: "responded", label: "Responded", count: respondedCount },
    { stage: "depositPending", label: "Deposit Pending", count: depositPendingCount },
    { stage: "scheduled", label: "Scheduled", count: scheduledCount },
    { stage: "completed", label: "Completed", count: completedCount },
  ].map((s) => ({ ...s, conversionFromReceived: pct(s.count, receivedCount) }));

  const lostColdConvertedTotal = lostCount + coldCount + convertedCount;

  const avgHoursToEstimateSent = avgHoursBetween(
    estimateSentRows.map((r) => ({ from: r.createdAt, to: r.estimateSentAt! })),
  );
  const avgHoursToResponse = avgHoursBetween(
    respondedRows.map((r) => ({ from: r.estimateSentAt!, to: r.estimateRespondedAt! })),
  );

  const artistIds = artistGroups.map((g) => g.artistId);
  const artists = await prisma.artist.findMany({
    where: { id: { in: artistIds } },
    select: { id: true, user: { select: { name: true, email: true } } },
  });
  const artistNameById = new Map(artists.map((a) => [a.id, a.user.name ?? a.user.email]));
  const artistUtilization = artistGroups
    .map((g) => ({
      artistId: g.artistId,
      name: artistNameById.get(g.artistId) ?? "Unknown",
      appointmentCount: g._count._all,
    }))
    .sort((a, b) => b.appointmentCount - a.appointmentCount);

  const paidDepositForms = depositForms.filter((d) => d.paidManually);
  const avgHoursToPayment = avgHoursBetween(
    paidDepositForms.filter((d) => d.paidAt).map((d) => ({ from: d.createdAt, to: d.paidAt! })),
  );

  res.json({
    range: { start: start.toISOString(), end: end.toISOString() },
    funnel: { stages: funnelStages },
    lostRate: {
      lost: lostCount,
      cold: coldCount,
      converted: convertedCount,
      lostColdRate: pct(lostCount + coldCount, lostColdConvertedTotal),
    },
    responseTime: {
      avgHoursToEstimateSent,
      avgHoursToResponse,
      sampleSizeEstimateSent: estimateSentRows.length,
      sampleSizeResponse: respondedRows.length,
    },
    artistUtilization,
    depositConversion: {
      sent: depositForms.length,
      paid: paidDepositForms.length,
      conversionRate: pct(paidDepositForms.length, depositForms.length),
      avgHoursToPayment,
    },
    giftCardLiability: {
      activeCardCount: giftCardAgg._count._all,
      totalCents: giftCardAgg._sum.amountCents ?? 0,
    },
  });
});

export default router;
