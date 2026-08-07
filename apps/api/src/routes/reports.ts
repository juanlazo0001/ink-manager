import { Router } from "express";
import { prisma } from "../lib/prisma";
import { AppointmentStatus, InquiryStatus, GiftCardStatus, Role } from "../../generated/prisma/enums";
import { requireAuth } from "../middleware/auth";
import { hasPermission, requirePermission } from "../lib/permissions";
import { activeStudioIdsForCaller } from "../lib/artistAccess";

const router = Router();
router.use(requireAuth);
// Was unconditionally OWNER/FRONT_DESK/ARTIST -- reports.viewDashboard
// preserves that (default true for both configurable roles). The real
// dollar figures this route also returns (deposit conversion, gift card
// liability) are now their own separate reports.viewFinancial permission,
// default true for FRONT_DESK but false for ARTIST -- a deliberate
// tightening this expansion makes, not a same-as-today default (see
// lib/permissions.ts's own comment on this key, and REPORT.md).
router.use(requirePermission("reports.viewDashboard"));

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
  const { studioId, userId, role } = req.user!;
  const { start, end } = parseRange(req);
  const canViewFinancial = await hasPermission(studioId, role, "reports.viewFinancial");

  // An ARTIST's dashboard is their own performance, not the whole studio's --
  // every section below scopes to their own assigned inquiries/appointments
  // when this is set, rather than the studioId-only where clauses OWNER/
  // FRONT_DESK still get. null for every other role (no extra filter).
  const scopingArtist =
    role === Role.ARTIST ? await prisma.artist.findUnique({ where: { userId }, select: { id: true } }) : null;
  const artistScope = scopingArtist ? { assignedArtistId: scopingArtist.id } : {};
  // Artist mobility bug fix: an ARTIST's own dashboard spans every studio
  // they CURRENTLY belong to (HOME + active GUESTs), not just home -- a
  // guest artist's own assigned projects at a GUEST studio have a
  // different Inquiry.studioId than home, so ANDing home studioId alone
  // silently zeroed out that whole slice of their own numbers. But it must
  // stay scoped to ACTIVE memberships, not open up to every studio they
  // were ever assignedArtistId at regardless of current status -- once a
  // GUEST membership ends, that studio's work must stop counting toward
  // "your performance" going forward, same reasoning as the calendar/
  // flash-gallery list fixes right next to this one.
  const artistStudioIds = scopingArtist ? await activeStudioIdsForCaller(req.user!) : null;

  const inquiryBaseWhere = {
    ...(artistStudioIds ? { studioId: { in: artistStudioIds } } : { studioId }),
    archivedAt: null,
    createdAt: { gte: start, lte: end },
    ...artistScope,
  } as const;

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
    needsSchedulingCount,
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
      where: {
        // Same artist-mobility fix as inquiryBaseWhere above.
        ...(artistStudioIds ? { studioId: { in: artistStudioIds } } : { studioId }),
        archivedAt: null,
        startTime: { gte: start, lte: end },
        // Appointment carries its own direct artistId (not just via
        // inquiry.assignedArtistId) -- scope on that field itself rather
        // than scopingArtist's spread-in assignedArtistId shape above,
        // which only applies to Inquiry where clauses.
        ...(scopingArtist ? { artistId: scopingArtist.id } : {}),
      },
      _count: { _all: true },
    }),
    // All-time by design -- see comment above the route.
    prisma.depositForm.findMany({
      where: {
        inquiry: {
          archivedAt: null,
          ...(artistStudioIds ? { studioId: { in: artistStudioIds } } : { studioId }),
          ...artistScope,
        },
      },
      select: { createdAt: true, paidManually: true, paidAt: true },
    }),
    // Gift card liability has no natural per-artist scope -- a card belongs
    // to a client/the studio, not to whichever artist eventually redeems
    // it -- so this stays studio-wide even for an ARTIST (moot by default
    // anyway, since it's already behind reports.viewFinancial, which
    // defaults false for ARTIST).
    prisma.giftCard.aggregate({
      where: {
        studioId,
        status: GiftCardStatus.ACTIVE,
        OR: [{ expiresAt: null }, { expiresAt: { gte: new Date() } }],
      },
      _sum: { amountCents: true },
      _count: { _all: true },
    }),
    // Needs Scheduling: a Project (deposit-paid Inquiry) with zero linked
    // Appointments yet -- a right-now snapshot, not date-ranged, same
    // reasoning as depositConversion/giftCardLiability below (this is a
    // current-state flag, not a historical event with a "happened at"
    // timestamp to range over). Same appointmentId/sessions OR as
    // scheduledCount above, and same frontend-mirrored derivation as
    // apps/web/src/lib/kanban.ts's projectNeedsScheduling -- keep both in
    // sync if the set of "Project" statuses ever changes.
    prisma.inquiry.count({
      where: {
        // Same artist-mobility fix as inquiryBaseWhere above.
        ...(artistStudioIds ? { studioId: { in: artistStudioIds } } : { studioId }),
        archivedAt: null,
        status: { in: [InquiryStatus.SCHEDULING, InquiryStatus.WAITLISTED, InquiryStatus.CONFIRMED] },
        appointmentId: null,
        sessions: { none: {} },
        ...artistScope,
      },
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
    // Tells the frontend whether every section above is studio-wide
    // (OWNER/FRONT_DESK) or scoped down to just the requesting artist's own
    // assigned inquiries/appointments -- drives copy ("the studio" vs "your
    // work") and whether Artist Utilization renders as a cross-artist
    // comparison at all.
    scope: scopingArtist ? "own" : "studio",
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
    // Not gated by reports.viewFinancial -- an operational scheduling
    // count, not a dollar figure.
    needsSchedulingCount,
    // Real dollar figures -- omitted entirely (not just zeroed) without
    // reports.viewFinancial, so the frontend can tell "no data" apart from
    // "not allowed to see this" and hide the section rather than show a
    // misleading $0.
    ...(canViewFinancial
      ? {
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
        }
      : {}),
  });
});

export default router;
