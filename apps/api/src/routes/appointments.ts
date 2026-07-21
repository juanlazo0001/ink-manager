import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth, requireRole } from "../middleware/auth";
import { Role, AppointmentStatus, GiftCardStatus } from "../../generated/prisma/enums";
import { requirePermission } from "../lib/permissions";
import { diffObjects, logAudit } from "../lib/audit";
import { validateGiftCardForAttachment } from "../lib/giftCards";
import { isSameCalendarDay } from "../lib/dateRange";
import { findBufferConflict, formatBufferWarning } from "../lib/schedulingConflict";
import { ensureLiabilityWaiver } from "../lib/waivers";
import { emitInvalidation } from "../lib/realtime/registry";

const router = Router();

router.use(requireAuth);

// Same exclude-from-default-list-views treatment as Client.archivedAt /
// Inquiry.archivedAt -- the record stays intact and directly reachable via
// GET /:id, only the default list (which backs the Calendar) excludes it.
const NOT_ARCHIVED = { archivedAt: null } as const;

// Every appointment needs both an inquiry (the project it belongs to) and
// an attached ACTIVE gift card (the deposit) -- N appointments require N
// gift cards. A client with no available card can't get an appointment
// booked here; the error says so explicitly rather than a generic 400.
router.post("/", requirePermission("appointments.create"), async (req, res) => {
  const body = req.body ?? {};

  const missing = ["artistId", "clientId", "startTime", "endTime", "inquiryId", "giftCardId"].filter(
    (field) => !body[field],
  );
  if (missing.length > 0) {
    return res.status(400).json({ error: `Missing required field(s): ${missing.join(", ")}` });
  }

  const { artistId, clientId, startTime, endTime, notes, inquiryId, giftCardId } = body;

  const start = new Date(startTime);
  const end = new Date(endTime);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
    return res.status(400).json({ error: "startTime and endTime must be valid dates, with startTime before endTime" });
  }

  const studioId = req.user!.studioId;

  const studioSettingsForDayCheck = await prisma.studioSettings.findUnique({
    where: { studioId },
    select: { timezone: true },
  });
  if (!isSameCalendarDay(start, end, studioSettingsForDayCheck?.timezone ?? "America/New_York")) {
    return res.status(400).json({ error: "An appointment cannot span more than one day" });
  }

  const [artist, client, inquiry] = await Promise.all([
    prisma.artist.findUnique({ where: { id: artistId }, include: { user: true } }),
    prisma.client.findUnique({ where: { id: clientId } }),
    prisma.inquiry.findUnique({ where: { id: inquiryId } }),
  ]);

  if (!artist || artist.user.studioId !== studioId) {
    return res.status(400).json({ error: "artistId must belong to your studio" });
  }

  if (!client || client.studioId !== studioId) {
    return res.status(400).json({ error: "clientId must belong to your studio" });
  }

  if (!inquiry || inquiry.studioId !== studioId || inquiry.clientId !== clientId) {
    return res.status(400).json({ error: "inquiryId must belong to this client in your studio" });
  }

  const giftCardResult = await validateGiftCardForAttachment(giftCardId, studioId, clientId);
  if ("error" in giftCardResult) {
    return res.status(400).json({
      error: `${giftCardResult.error} — collect a deposit or issue a gift card for this client first.`,
    });
  }

  const appointment = await prisma.$transaction(async (tx) => {
    const created = await tx.appointment.create({
      data: {
        artistId,
        clientId,
        inquiryId,
        startTime: start,
        endTime: end,
        notes,
        studioId,
        status: AppointmentStatus.CONFIRMED,
      },
    });

    await tx.giftCard.update({ where: { id: giftCardId }, data: { appointmentId: created.id } });

    return created;
  });

  await logAudit({
    studioId,
    actorUserId: req.user!.userId,
    entityType: "Appointment",
    entityId: appointment.id,
    action: "create",
    changes: { artistId, clientId, inquiryId, giftCardId, startTime: start, endTime: end },
  });

  const conflict = await findBufferConflict(artistId, start, end, appointment.id);

  emitInvalidation({ type: "appointment.changed", studioId });

  res.status(201).json({ ...appointment, bufferWarning: formatBufferWarning(conflict) });
});

// Optional ?start=&end= (ISO) scopes to a visible calendar range (Phase
// UI-5) via an interval-overlap query, on top of the existing filters --
// deliberately extending this route rather than adding a parallel one, so
// role scoping (ARTIST sees only their own) never has two places to get
// out of sync. Without a range, keeps the pre-Phase-UI-5 "latest 100"
// behavior (Sidebar's prefetch and any other no-range caller).
router.get("/", requirePermission("appointments.view"), async (req, res) => {
  const { studioId, role, userId } = req.user!;
  const clientId = typeof req.query.clientId === "string" ? req.query.clientId : undefined;
  const rangeStartRaw = typeof req.query.start === "string" ? new Date(req.query.start) : undefined;
  const rangeEndRaw = typeof req.query.end === "string" ? new Date(req.query.end) : undefined;
  const hasValidRange =
    rangeStartRaw && rangeEndRaw && !Number.isNaN(rangeStartRaw.getTime()) && !Number.isNaN(rangeEndRaw.getTime());

  let artistId: string | undefined;

  if (role === Role.ARTIST) {
    const artist = await prisma.artist.findUnique({ where: { userId } });

    if (!artist) {
      return res.json([]);
    }

    artistId = artist.id;
  }

  const appointments = await prisma.appointment.findMany({
    where: {
      studioId,
      ...NOT_ARCHIVED,
      ...(clientId ? { clientId } : {}),
      ...(artistId ? { artistId } : {}),
      ...(hasValidRange ? { startTime: { lt: rangeEndRaw! }, endTime: { gt: rangeStartRaw! } } : {}),
    },
    include: {
      artist: { select: { id: true, user: { select: { name: true, email: true } } } },
      client: { select: { id: true, firstName: true, lastName: true } },
      inquiryProject: { select: { id: true, description: true } },
    },
    orderBy: { startTime: "asc" },
    take: hasValidRange ? 500 : 100,
  });

  res.json(
    appointments.map(({ inquiryProject, artist, ...rest }) => ({
      ...rest,
      artist: { id: artist.id, name: artist.user.name ?? artist.user.email },
      inquiry: inquiryProject
        ? {
            id: inquiryProject.id,
            label:
              inquiryProject.description.length > 60
                ? `${inquiryProject.description.slice(0, 60).trimEnd()}…`
                : inquiryProject.description,
          }
        : null,
    })),
  );
});

const APPOINTMENT_DETAIL_INCLUDE = {
  artist: { select: { id: true, user: { select: { email: true, name: true } } } },
  client: { select: { id: true, firstName: true, lastName: true } },
  // The project this session belongs to -- via inquiryId/inquiryProject, not
  // the older 1:1 `inquiry` back-relation (Inquiry.appointmentId), which is
  // a different, usually-null link left over from the original scheduling flow.
  inquiryProject: { select: { id: true, description: true, clientId: true } },
  giftCard: { select: { id: true, code: true, amountCents: true, status: true, expiresAt: true } },
  checkedOutBy: { select: { id: true, name: true, email: true } },
  // Non-PII summary only -- the health data and ID image behind this
  // waiver live behind GET /waivers/:id, which is OWNER/FRONT_DESK only.
  liabilityWaiver: { select: { id: true, status: true, signedAt: true, verifiedAt: true } },
} as const;

router.get("/:id", requirePermission("appointments.view"), async (req, res) => {
  const id = req.params.id as string;

  const appointment = await prisma.appointment.findUnique({ where: { id }, include: APPOINTMENT_DETAIL_INCLUDE });

  if (!appointment || appointment.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Appointment not found" });
  }

  const { inquiryProject, ...rest } = appointment;
  res.json({ ...rest, inquiry: inquiryProject });
});

// Archive: soft, reversible hide -- same treatment as Client.archivedAt /
// Inquiry.archivedAt.
router.post("/:id/archive", requirePermission("appointments.manage"), async (req, res) => {
  const id = req.params.id as string;
  const appointment = await prisma.appointment.findUnique({ where: { id } });
  if (!appointment || appointment.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Appointment not found" });
  }
  if (appointment.archivedAt) {
    return res.json(appointment);
  }

  const updated = await prisma.appointment.update({ where: { id }, data: { archivedAt: new Date() } });

  await logAudit({
    studioId: req.user!.studioId,
    actorUserId: req.user!.userId,
    entityType: "Appointment",
    entityId: id,
    action: "archive",
    changes: { archivedAt: updated.archivedAt },
  });

  res.json(updated);
});

router.post("/:id/unarchive", requirePermission("appointments.manage"), async (req, res) => {
  const id = req.params.id as string;
  const appointment = await prisma.appointment.findUnique({ where: { id } });
  if (!appointment || appointment.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Appointment not found" });
  }
  if (!appointment.archivedAt) {
    return res.json(appointment);
  }

  const updated = await prisma.appointment.update({ where: { id }, data: { archivedAt: null } });

  await logAudit({
    studioId: req.user!.studioId,
    actorUserId: req.user!.userId,
    entityType: "Appointment",
    entityId: id,
    action: "unarchive",
    changes: { archivedAt: null },
  });

  res.json(updated);
});

// Shared between the delete-preview (so the confirmation UI can show what
// will be detached/destroyed) and the audit snapshot written just before
// the actual DELETE below.
async function gatherAppointmentDeletionSummary(appointmentId: string) {
  const [waivers, consentForm, giftCard, conversationTags] = await Promise.all([
    prisma.liabilityWaiver.count({ where: { appointmentId } }),
    prisma.consentForm.findUnique({ where: { appointmentId }, select: { id: true } }),
    prisma.giftCard.findUnique({
      where: { appointmentId },
      select: { id: true, code: true, amountCents: true, status: true },
    }),
    prisma.conversationTag.count({ where: { entityType: "Appointment", entityId: appointmentId } }),
  ]);

  return {
    waivers,
    consentForms: consentForm ? 1 : 0,
    giftCardToDetach: giftCard,
    conversationTags,
  };
}

router.get("/:id/delete-preview", requireRole(Role.OWNER), async (req, res) => {
  const id = req.params.id as string;
  const appointment = await prisma.appointment.findUnique({ where: { id } });
  if (!appointment || appointment.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Appointment not found" });
  }

  const summary = await gatherAppointmentDeletionSummary(id);
  res.json(summary);
});

// True permanent delete -- OWNER only. Scoped to just this one appointment,
// same detach-don't-destroy philosophy as Inquiry's own delete route: a gift
// card attached here is the client's money, independent of this one
// session, so it's DETACHED (appointmentId -> null), never destroyed. A
// consent form is likewise unlinked rather than deleted -- a signed legal
// document outlives the session it was tied to. The liability waiver, by
// contrast, has a required (non-nullable) appointmentId -- it cannot exist
// without this appointment, so it's deleted along with it.
router.delete("/:id", requireRole(Role.OWNER), async (req, res) => {
  const id = req.params.id as string;
  const { confirm } = req.body ?? {};

  if (confirm !== "DELETE") {
    return res.status(400).json({ error: 'Type "DELETE" to confirm this action.' });
  }

  const appointment = await prisma.appointment.findUnique({ where: { id } });
  if (!appointment || appointment.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Appointment not found" });
  }

  const summary = await gatherAppointmentDeletionSummary(id);

  await prisma.$transaction(async (tx) => {
    // Detach, don't destroy -- the client's money survives this delete.
    await tx.giftCard.updateMany({ where: { appointmentId: id }, data: { appointmentId: null } });
    // Unlink, don't destroy -- a signed consent form outlives the session.
    await tx.consentForm.updateMany({ where: { appointmentId: id }, data: { appointmentId: null } });

    await tx.liabilityWaiver.deleteMany({ where: { appointmentId: id } });
    await tx.conversationTag.deleteMany({ where: { entityType: "Appointment", entityId: id } });

    // Inquiry.appointmentId is an optional back-reference to this same
    // appointment (the older 1:1 "scheduled slot" link) -- null it before
    // deleting the appointment, or that FK blocks the delete below.
    await tx.inquiry.updateMany({ where: { appointmentId: id }, data: { appointmentId: null } });
    await tx.appointment.delete({ where: { id } });
  });

  await logAudit({
    studioId: req.user!.studioId,
    actorUserId: req.user!.userId,
    entityType: "Appointment",
    entityId: id,
    action: "permanently_deleted",
    changes: {
      appointment: { startTime: appointment.startTime, endTime: appointment.endTime, status: appointment.status },
      ...summary,
    },
  });

  res.json({ success: true, detachedGiftCard: summary.giftCardToDetach });
});

// Day-of liability waiver: one per appointment, front desk creates it and
// hands the client the link; front desk later verifies the signed result
// against the client's physical ID (POST /waivers/:id/verify).
router.post("/:id/waiver", requireRole(Role.OWNER, Role.FRONT_DESK), async (req, res) => {
  const id = req.params.id as string;
  const studioId = req.user!.studioId;

  const existing = await prisma.appointment.findUnique({ where: { id }, select: { liabilityWaiver: true } });
  if (existing?.liabilityWaiver) {
    return res.status(400).json({ error: "A waiver already exists for this appointment" });
  }

  const result = await ensureLiabilityWaiver(id, studioId, req.user!.userId);

  if (!result.ok) {
    const status = result.error === "Appointment not found" ? 404 : 400;
    return res.status(status).json({ error: result.error });
  }

  res.status(201).json({ ...result.waiver, signingUrl: result.signingUrl });
});

// Checkout: confirms the final cost with the artist, settles the deposit
// (redeem now vs. roll to a future appointment), and records closeout
// notes. Phase 3 guarantees every appointment has an attached ACTIVE gift
// card, but the guard below still checks -- if it's somehow missing, that's
// a data problem to resolve manually rather than something to paper over.
router.post("/:id/checkout", requireRole(Role.OWNER, Role.FRONT_DESK), async (req, res) => {
  const id = req.params.id as string;
  const studioId = req.user!.studioId;
  const body = req.body ?? {};
  const { finalCostCents, depositDecision, closeoutNotes } = body;

  if (typeof finalCostCents !== "number" || !Number.isFinite(finalCostCents) || finalCostCents < 0) {
    return res.status(400).json({ error: "finalCostCents must be a non-negative number" });
  }

  if (depositDecision !== "REDEEM" && depositDecision !== "ROLL") {
    return res.status(400).json({ error: "depositDecision must be 'REDEEM' or 'ROLL'" });
  }

  const appointment = await prisma.appointment.findUnique({ where: { id }, include: { giftCard: true } });

  if (!appointment || appointment.studioId !== studioId) {
    return res.status(404).json({ error: "Appointment not found" });
  }

  if (appointment.checkedOutAt) {
    return res.status(400).json({ error: "This appointment has already been checked out" });
  }

  if (!appointment.giftCard) {
    return res.status(400).json({
      error:
        "This appointment has no attached gift card to redeem or roll. Every appointment should have one (Phase 3) -- resolve this manually before checking out.",
    });
  }

  const card = appointment.giftCard;
  let amountDueCents = 0;
  let remainderCents = 0;

  if (depositDecision === "REDEEM") {
    amountDueCents = Math.max(0, finalCostCents - card.amountCents);
    remainderCents = Math.max(0, card.amountCents - finalCostCents);
  } else {
    amountDueCents = finalCostCents;
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (depositDecision === "REDEEM") {
      await tx.giftCard.update({
        where: { id: card.id },
        data: { status: GiftCardStatus.REDEEMED, redeemedAt: new Date() },
      });
    } else {
      await tx.giftCard.update({ where: { id: card.id }, data: { appointmentId: null } });
    }

    return tx.appointment.update({
      where: { id },
      data: {
        finalCostCents,
        closeoutNotes: typeof closeoutNotes === "string" && closeoutNotes.trim() ? closeoutNotes.trim() : null,
        checkedOutAt: new Date(),
        checkedOutById: req.user!.userId,
        status: AppointmentStatus.COMPLETED,
      },
    });
  });

  await logAudit({
    studioId,
    actorUserId: req.user!.userId,
    entityType: "Appointment",
    entityId: id,
    action: "checkout",
    changes: {
      finalCostCents,
      depositDecision,
      giftCardId: card.id,
      amountDueCents,
      ...(remainderCents > 0 ? { remainderCents } : {}),
    },
  });

  await logAudit({
    studioId,
    actorUserId: req.user!.userId,
    entityType: "GiftCard",
    entityId: card.id,
    action: depositDecision === "REDEEM" ? "redeemed" : "rollover",
    changes:
      depositDecision === "REDEEM"
        ? { status: { from: card.status, to: GiftCardStatus.REDEEMED }, appointmentId: id, finalCostCents, remainderCents }
        : { fromAppointmentId: id, toAppointmentId: null, reason: "checkout_roll" },
  });

  res.json({ ...updated, amountDueCents, remainderCents });
});

// Handles both a plain status change (the pre-existing behavior) and a
// time/day reschedule (Phase UI-4 groundwork -- Phase UI-5's calendar
// drag-and-drop is the first real caller of the latter, via this same
// route, never a bespoke calendar-only endpoint). At least one of
// status/startTime+endTime must be present.
router.patch("/:id", requirePermission("appointments.manage"), async (req, res) => {
  const id = req.params.id as string;
  const { status, startTime, endTime } = req.body ?? {};

  if (status === undefined && startTime === undefined && endTime === undefined) {
    return res.status(400).json({ error: "status or startTime/endTime is required" });
  }

  if (status !== undefined && !Object.values(AppointmentStatus).includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${Object.values(AppointmentStatus).join(", ")}` });
  }

  const appointment = await prisma.appointment.findUnique({ where: { id } });

  if (!appointment || appointment.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Appointment not found" });
  }

  const data: { status?: AppointmentStatus; startTime?: Date; endTime?: Date } = {};

  if (status !== undefined) {
    data.status = status;
  }

  if (startTime !== undefined || endTime !== undefined) {
    if (startTime === undefined || endTime === undefined) {
      return res.status(400).json({ error: "startTime and endTime must be provided together" });
    }

    const start = new Date(startTime);
    const end = new Date(endTime);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
      return res
        .status(400)
        .json({ error: "startTime and endTime must be valid dates, with startTime before endTime" });
    }

    const studioSettingsForDayCheck = await prisma.studioSettings.findUnique({
      where: { studioId: req.user!.studioId },
      select: { timezone: true },
    });
    if (!isSameCalendarDay(start, end, studioSettingsForDayCheck?.timezone ?? "America/New_York")) {
      return res.status(400).json({ error: "An appointment cannot span more than one day" });
    }

    data.startTime = start;
    data.endTime = end;
  }

  const updated = await prisma.appointment.update({ where: { id }, data });

  await logAudit({
    studioId: req.user!.studioId,
    actorUserId: req.user!.userId,
    entityType: "Appointment",
    entityId: id,
    action: "update",
    changes: diffObjects(appointment, data, ["status", "startTime", "endTime"]),
  });

  // artistId is never accepted by this route (see comment above) -- a
  // reassignment can't happen through this call, so the buffer check below
  // always reflects the appointment's existing, unchanged artist.
  const conflict =
    data.startTime && data.endTime
      ? await findBufferConflict(updated.artistId, data.startTime, data.endTime, id)
      : null;

  emitInvalidation({ type: "appointment.changed", studioId: req.user!.studioId });

  res.json({ ...updated, bufferWarning: formatBufferWarning(conflict) });
});

export default router;
