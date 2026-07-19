import { Router } from "express";
import crypto from "node:crypto";
import { prisma } from "../lib/prisma";
import { AppointmentStatus, Channel, InquiryStatus, MessageChannel, MessageDirection } from "../../generated/prisma/enums";
import { requireAuth, requireRole } from "../middleware/auth";
import { Role } from "../../generated/prisma/enums";
import { diffObjects, logAudit } from "../lib/audit";
import { validateGiftCardForAttachment } from "../lib/giftCards";
import { getOrCreateStaffConversation } from "../lib/conversations";

const router = Router();

const ESTIMATE_TOKEN_TTL_DAYS = 7;
const SCHEDULING_BUFFER_MS = 1.5 * 60 * 60 * 1000;
const DEPOSIT_TOKEN_TTL_HOURS = 48;
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

// $0-200 -> $50 deposit / $60 total, $201-599 -> $100/$110, $600+ -> $200/$210.
// Fee is a flat $10 in every tier, but derived (not hardcoded) from the two
// numbers so the tier table stays the single source of truth.
function computeDepositTier(averageEstimate: number): { depositAmount: number; totalCharged: number } {
  if (averageEstimate <= 200) return { depositAmount: 50, totalCharged: 60 };
  if (averageEstimate <= 599) return { depositAmount: 100, totalCharged: 110 };
  return { depositAmount: 200, totalCharged: 210 };
}

const REQUIRED_FIELDS = [
  "studioSlug",
  "firstName",
  "lastName",
  "email",
  "channel",
  "description",
  "colorOrBlackGrey",
  "placement",
  "estimatedSize",
] as const;

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

// Public: the intake form fetches a prefill draft by its capability token
// (never PII in the URL, just this opaque token) to populate matching
// fields before the client has typed anything. Invalid/expired/used tokens
// return a plain 404 -- the form falls back to loading empty, no error
// banner drama (this is a quiet nice-to-have, not a broken link).
router.get("/prefill/:token", async (req, res) => {
  const token = req.params.token as string;

  const draft = await prisma.prefillDraft.findUnique({ where: { token } });
  if (!draft || draft.usedAt || draft.expiresAt < new Date()) {
    return res.status(404).json({ error: "Not found" });
  }

  res.json({ payload: draft.payload });
});

// Public: the intake form is unauthenticated. Creates the Client (or reuses
// an existing one, matched by email within the studio) and the Inquiry
// together, so the studio's pipeline sees a single lead rather than a
// duplicate client every time the same person submits again.
router.post("/", async (req, res) => {
  const body = req.body ?? {};

  const missing = REQUIRED_FIELDS.filter((field) => !body[field]);
  if (missing.length > 0) {
    return res.status(400).json({ error: `Missing required field(s): ${missing.join(", ")}` });
  }

  if (typeof body.hasBeenTattooedBefore !== "boolean") {
    return res.status(400).json({ error: "hasBeenTattooedBefore must be a boolean" });
  }

  if (!Object.values(Channel).includes(body.channel)) {
    return res.status(400).json({ error: `channel must be one of: ${Object.values(Channel).join(", ")}` });
  }

  if (body.referenceImages !== undefined && !isStringArray(body.referenceImages)) {
    return res.status(400).json({ error: "referenceImages must be an array of strings" });
  }

  if (body.placementImages !== undefined && !isStringArray(body.placementImages)) {
    return res.status(400).json({ error: "placementImages must be an array of strings" });
  }

  const {
    studioSlug,
    firstName,
    lastName,
    email,
    phone,
    channel,
    description,
    colorOrBlackGrey,
    placement,
    estimatedSize,
    hasBeenTattooedBefore,
    budget,
    desiredTiming,
    preferredArtistId,
    referenceImages,
    placementImages,
    draftToken,
  } = body;

  const studio = await prisma.studio.findUnique({ where: { slug: studioSlug } });
  if (!studio) {
    return res.status(404).json({ error: "Studio not found" });
  }

  // A draft token riding along is optional and best-effort -- an invalid/
  // stale one (already used, expired, wrong studio) never blocks a real
  // submission, it's just not marked used.
  let draft: { id: string } | null = null;
  if (typeof draftToken === "string" && draftToken.length > 0) {
    const found = await prisma.prefillDraft.findUnique({ where: { token: draftToken } });
    if (found && found.studioId === studio.id && !found.usedAt && found.expiresAt >= new Date()) {
      draft = found;
    }
  }

  if (preferredArtistId) {
    const preferredArtist = await prisma.artist.findUnique({
      where: { id: preferredArtistId },
      include: { user: true },
    });

    if (!preferredArtist || preferredArtist.user.studioId !== studio.id) {
      return res.status(400).json({ error: "preferredArtistId must belong to this studio" });
    }
  }

  const existingClient = await prisma.client.findFirst({
    where: { studioId: studio.id, email },
  });

  const client =
    existingClient ??
    (await prisma.client.create({
      data: { studioId: studio.id, firstName, lastName, email, phone },
    }));

  const inquiry = await prisma.inquiry.create({
    data: {
      studioId: studio.id,
      clientId: client.id,
      channel,
      description,
      colorOrBlackGrey,
      placement,
      estimatedSize,
      hasBeenTattooedBefore,
      budget,
      desiredTiming,
      preferredArtistId: preferredArtistId || null,
      referenceImages: referenceImages ?? [],
      placementImages: placementImages ?? [],
    },
  });

  if (draft) {
    await prisma.prefillDraft.update({ where: { id: draft.id }, data: { usedAt: new Date() } });
  }

  res.status(201).json(inquiry);
});

// Phase 7A: everything except the two terminal enum values. Used by
// mark-lost (valid FROM any of these) and reopen (valid target TO any of
// these) -- broader than coldLeadSweep.ts's own eligible-statuses list,
// since reopening a lost Projects-side inquiry (e.g. back to CONFIRMED) is
// legitimate and isn't the sweep's concern.
const NON_TERMINAL_STATUSES: InquiryStatus[] = (Object.values(InquiryStatus) as InquiryStatus[]).filter(
  (s) => s !== InquiryStatus.CLOSED_LOST && s !== InquiryStatus.COLD_LEAD,
);

const INQUIRY_INCLUDE = {
  client: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
  preferredArtist: { select: { id: true, user: { select: { name: true } } } },
  assignedArtist: { select: { id: true, user: { select: { name: true } } } },
  appointment: { select: { id: true, startTime: true, endTime: true, status: true } },
  // UI-1 §3: every appointment/session under this project (1:many via
  // Appointment.inquiryId), for the project detail page's nested
  // Appointments section -- distinct from the singular `appointment`
  // above, which is only the original scheduling-flow slot.
  sessions: {
    select: {
      id: true,
      startTime: true,
      endTime: true,
      status: true,
      artist: { select: { id: true, user: { select: { name: true, email: true } } } },
    },
    orderBy: { startTime: "asc" },
  },
  depositForm: {
    select: {
      id: true,
      token: true,
      depositAmount: true,
      feeAmount: true,
      totalCharged: true,
      signedAt: true,
      signatureName: true,
      paidManually: true,
      paidAt: true,
    },
  },
} as const;

// The inbox list only renders these fields -- preferredArtist/assignedArtist/
// appointment/depositForm are detail-page-only, so the list query skips them.
const INQUIRY_LIST_SELECT = {
  id: true,
  channel: true,
  description: true,
  status: true,
  createdAt: true,
  referenceImages: true,
  client: { select: { firstName: true, lastName: true } },
} as const;

// Staff-facing inbox: every inquiry submitted for this studio, newest first.
router.get("/", requireAuth, requireRole(Role.OWNER, Role.FRONT_DESK), async (req, res) => {
  const inquiries = await prisma.inquiry.findMany({
    where: { studioId: req.user!.studioId },
    select: INQUIRY_LIST_SELECT,
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  res.json(inquiries);
});

// Artist-facing inbox: inquiries currently assigned to the requesting
// artist and awaiting their review. Registered before the "/:id" route
// below so Express doesn't try to match "assigned-to-me" as an :id.
router.get("/assigned-to-me", requireAuth, requireRole(Role.ARTIST), async (req, res) => {
  const artist = await prisma.artist.findUnique({ where: { userId: req.user!.userId } });
  if (!artist) {
    return res.json([]);
  }

  const inquiries = await prisma.inquiry.findMany({
    where: { assignedArtistId: artist.id, status: InquiryStatus.ARTIST_ASSIGNED },
    include: INQUIRY_INCLUDE,
    orderBy: { assignedAt: "desc" },
  });

  res.json(inquiries);
});

router.get("/:id", requireAuth, requireRole(Role.OWNER, Role.FRONT_DESK), async (req, res) => {
  const id = req.params.id as string;

  const inquiry = await prisma.inquiry.findUnique({ where: { id }, include: INQUIRY_INCLUDE });

  if (!inquiry || inquiry.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Inquiry not found" });
  }

  res.json(inquiry);
});

// Detail-field edits only -- status transitions stay in their own dedicated
// routes above/below (assign, respond, schedule, waitlist), never here.
const REQUIRED_STRING_FIELDS = ["description", "colorOrBlackGrey", "placement", "estimatedSize"] as const;
const NULLABLE_STRING_FIELDS = ["budget", "desiredTiming"] as const;
const NUMERIC_FIELDS = [
  "priceEstimateLow",
  "priceEstimateHigh",
  "timeEstimateHoursMin",
  "timeEstimateHoursMax",
] as const;

router.patch("/:id", requireAuth, requireRole(Role.OWNER, Role.FRONT_DESK), async (req, res) => {
  const id = req.params.id as string;
  const body = req.body ?? {};

  if ("status" in body) {
    return res.status(400).json({ error: "status cannot be changed through this route" });
  }

  const inquiry = await prisma.inquiry.findUnique({ where: { id } });
  if (!inquiry || inquiry.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Inquiry not found" });
  }

  const data: Record<string, string | number | null> = {};

  for (const field of REQUIRED_STRING_FIELDS) {
    if (body[field] === undefined) continue;
    if (typeof body[field] !== "string" || body[field].trim().length === 0) {
      return res.status(400).json({ error: `${field} must be a non-empty string` });
    }
    data[field] = body[field].trim();
  }

  for (const field of NULLABLE_STRING_FIELDS) {
    if (body[field] === undefined) continue;
    if (body[field] !== null && typeof body[field] !== "string") {
      return res.status(400).json({ error: `${field} must be a string or null` });
    }
    data[field] = typeof body[field] === "string" ? body[field].trim() || null : null;
  }

  for (const field of NUMERIC_FIELDS) {
    if (body[field] === undefined) continue;
    if (body[field] !== null && typeof body[field] !== "number") {
      return res.status(400).json({ error: `${field} must be a number or null` });
    }
    data[field] = body[field];
  }

  const updated = await prisma.inquiry.update({ where: { id }, data, include: INQUIRY_INCLUDE });

  await logAudit({
    studioId: req.user!.studioId,
    actorUserId: req.user!.userId,
    entityType: "Inquiry",
    entityId: id,
    action: "update",
    changes: diffObjects(inquiry, data, [
      ...REQUIRED_STRING_FIELDS,
      ...NULLABLE_STRING_FIELDS,
      ...NUMERIC_FIELDS,
    ] as unknown as (keyof typeof inquiry)[]),
  });

  res.json(updated);
});

// Staff hands a NEW inquiry off to an artist. Re-assigning only makes sense
// while it's still NEW — once an artist has responded (or is mid-review),
// this endpoint won't touch it; DECLINE below is what puts it back to NEW.
router.patch("/:id/assign", requireAuth, requireRole(Role.OWNER, Role.FRONT_DESK), async (req, res) => {
  const id = req.params.id as string;
  const { artistId } = req.body ?? {};

  if (!artistId) {
    return res.status(400).json({ error: "artistId is required" });
  }

  const inquiry = await prisma.inquiry.findUnique({ where: { id } });
  if (!inquiry || inquiry.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Inquiry not found" });
  }

  if (inquiry.status !== InquiryStatus.NEW) {
    return res.status(400).json({ error: "Only a NEW inquiry can be assigned" });
  }

  const artist = await prisma.artist.findUnique({ where: { id: artistId }, include: { user: true } });
  if (!artist || artist.user.studioId !== req.user!.studioId) {
    return res.status(400).json({ error: "artistId must belong to your studio" });
  }

  const updateData = { assignedArtistId: artistId, assignedAt: new Date(), status: InquiryStatus.ARTIST_ASSIGNED };

  const updated = await prisma.inquiry.update({
    where: { id },
    data: updateData,
    include: INQUIRY_INCLUDE,
  });

  await logAudit({
    studioId: req.user!.studioId,
    actorUserId: req.user!.userId,
    entityType: "Inquiry",
    entityId: id,
    action: "status_change",
    changes: diffObjects(inquiry, updateData, ["status", "assignedArtistId", "assignedAt"]),
  });

  res.json(updated);
});

const DECISIONS = ["APPROVE", "DECLINE"] as const;

// Artist's response to an inquiry assigned to them. APPROVE records the
// artist's own estimate and hands it back to staff (AWAITING_CLIENT_RESPONSE).
// DECLINE unassigns it and puts it back in the pool (NEW) with a note for
// staff explaining why, so it can be reassigned.
router.patch("/:id/respond", requireAuth, requireRole(Role.ARTIST), async (req, res) => {
  const id = req.params.id as string;
  const { decision, priceEstimateLow, priceEstimateHigh, timeEstimateHoursMin, timeEstimateHoursMax, declineNote } =
    req.body ?? {};

  if (!DECISIONS.includes(decision)) {
    return res.status(400).json({ error: `decision must be one of: ${DECISIONS.join(", ")}` });
  }

  const artist = await prisma.artist.findUnique({ where: { userId: req.user!.userId } });
  const inquiry = await prisma.inquiry.findUnique({ where: { id } });

  if (!inquiry || inquiry.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Inquiry not found" });
  }

  if (!artist || inquiry.assignedArtistId !== artist.id) {
    return res.status(403).json({ error: "This inquiry is not assigned to you" });
  }

  if (decision === "DECLINE") {
    if (typeof declineNote !== "string" || declineNote.trim().length === 0) {
      return res.status(400).json({ error: "declineNote is required when declining" });
    }

    const declineData = {
      assignedArtistId: null,
      assignedAt: null,
      status: InquiryStatus.NEW,
      declineNote: declineNote.trim(),
    };

    const updated = await prisma.inquiry.update({
      where: { id },
      data: declineData,
      include: INQUIRY_INCLUDE,
    });

    await logAudit({
      studioId: req.user!.studioId,
      actorUserId: req.user!.userId,
      entityType: "Inquiry",
      entityId: id,
      action: "status_change",
      changes: diffObjects(inquiry, declineData, ["status", "assignedArtistId", "assignedAt", "declineNote"]),
    });

    return res.json(updated);
  }

  for (const [field, value] of Object.entries({
    priceEstimateLow,
    priceEstimateHigh,
    timeEstimateHoursMin,
    timeEstimateHoursMax,
  })) {
    if (value !== undefined && typeof value !== "number") {
      return res.status(400).json({ error: `${field} must be a number` });
    }
  }

  const approveData = {
    status: InquiryStatus.AWAITING_CLIENT_RESPONSE,
    priceEstimateLow: priceEstimateLow ?? null,
    priceEstimateHigh: priceEstimateHigh ?? null,
    timeEstimateHoursMin: timeEstimateHoursMin ?? null,
    timeEstimateHoursMax: timeEstimateHoursMax ?? null,
  };

  const updated = await prisma.inquiry.update({
    where: { id },
    data: approveData,
    include: INQUIRY_INCLUDE,
  });

  await logAudit({
    studioId: req.user!.studioId,
    actorUserId: req.user!.userId,
    entityType: "Inquiry",
    entityId: id,
    action: "status_change",
    changes: diffObjects(inquiry, approveData, [
      "status",
      "priceEstimateLow",
      "priceEstimateHigh",
      "timeEstimateHoursMin",
      "timeEstimateHoursMax",
    ]),
  });

  res.json(updated);
});

// Staff sends (or resends, with revised numbers) the client-facing estimate
// link. Valid from AWAITING_CLIENT_RESPONSE (first send) or
// BUDGET_NEGOTIATION (resend after the client pushed back on price) — either
// way it lands the client back in AWAITING_CLIENT_RESPONSE to review the
// (possibly updated) numbers.
router.post("/:id/send-estimate", requireAuth, requireRole(Role.OWNER, Role.FRONT_DESK), async (req, res) => {
  const id = req.params.id as string;
  const { priceEstimateLow, priceEstimateHigh, timeEstimateHoursMin, timeEstimateHoursMax } = req.body ?? {};

  const inquiry = await prisma.inquiry.findUnique({ where: { id } });
  if (!inquiry || inquiry.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Inquiry not found" });
  }

  if (
    inquiry.status !== InquiryStatus.AWAITING_CLIENT_RESPONSE &&
    inquiry.status !== InquiryStatus.BUDGET_NEGOTIATION
  ) {
    return res
      .status(400)
      .json({ error: "An estimate can only be sent while awaiting client response or during budget negotiation" });
  }

  for (const [field, value] of Object.entries({
    priceEstimateLow,
    priceEstimateHigh,
    timeEstimateHoursMin,
    timeEstimateHoursMax,
  })) {
    if (value !== undefined && typeof value !== "number") {
      return res.status(400).json({ error: `${field} must be a number` });
    }
  }

  // Validate the *effective* range (newly submitted value, falling back to
  // whatever's already on the inquiry) -- staff can resend without
  // resubmitting numbers that were already approved by the artist.
  const effective = {
    priceEstimateLow: priceEstimateLow ?? inquiry.priceEstimateLow,
    priceEstimateHigh: priceEstimateHigh ?? inquiry.priceEstimateHigh,
    timeEstimateHoursMin: timeEstimateHoursMin ?? inquiry.timeEstimateHoursMin,
    timeEstimateHoursMax: timeEstimateHoursMax ?? inquiry.timeEstimateHoursMax,
  };

  for (const [field, value] of Object.entries(effective)) {
    if (value == null) {
      return res.status(400).json({ error: `${field} is required before an estimate can be sent` });
    }
    if (value <= 0) {
      return res.status(400).json({ error: `${field} must be a positive number` });
    }
  }

  if (effective.priceEstimateLow! > effective.priceEstimateHigh!) {
    return res.status(400).json({ error: "priceEstimateLow must be less than or equal to priceEstimateHigh" });
  }

  if (effective.timeEstimateHoursMin! > effective.timeEstimateHoursMax!) {
    return res
      .status(400)
      .json({ error: "timeEstimateHoursMin must be less than or equal to timeEstimateHoursMax" });
  }

  // A prior send/resend already having a sent timestamp is what distinguishes
  // a resend from a first send -- everything else about the flow is identical.
  const isResend = inquiry.estimateSentAt != null;

  const estimateToken = crypto.randomBytes(32).toString("hex");
  const estimateTokenExpiresAt = new Date(Date.now() + ESTIMATE_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

  const studioSettings = await prisma.studioSettings.findUnique({ where: { studioId: req.user!.studioId } });

  const sendEstimateData = {
    estimateToken,
    estimateTokenExpiresAt,
    estimateSentAt: new Date(),
    estimateTermsSnapshot: studioSettings?.estimateTerms ?? null,
    status: InquiryStatus.AWAITING_CLIENT_RESPONSE,
    priceEstimateLow: effective.priceEstimateLow,
    priceEstimateHigh: effective.priceEstimateHigh,
    timeEstimateHoursMin: effective.timeEstimateHoursMin,
    timeEstimateHoursMax: effective.timeEstimateHoursMax,
    // A resend is a new estimate event -- prior open/response timing no
    // longer describes the estimate the client is about to see. It's still
    // recoverable from the audit log below if needed.
    ...(isResend ? { estimateOpenedAt: null, estimateRespondedAt: null } : {}),
  };

  const updated = await prisma.inquiry.update({
    where: { id },
    data: sendEstimateData,
    include: INQUIRY_INCLUDE,
  });

  await logAudit({
    studioId: req.user!.studioId,
    actorUserId: req.user!.userId,
    entityType: "Inquiry",
    entityId: id,
    action: isResend ? "estimate_resent" : "estimate_sent",
    changes: diffObjects(inquiry, sendEstimateData, [
      "status",
      "estimateSentAt",
      "estimateOpenedAt",
      "estimateRespondedAt",
      "priceEstimateLow",
      "priceEstimateHigh",
      "timeEstimateHoursMin",
      "timeEstimateHoursMax",
    ]),
  });

  res.status(201).json({ ...updated, estimateUrl: `${FRONTEND_URL}/estimate/${estimateToken}` });
});

// Creates the real Appointment once the deposit's been paid (SCHEDULING is
// only reachable after mark-paid issues a gift card -- Phase 3), links it
// back to the Inquiry, and attaches the gift card in the same transaction.
// Doesn't block on a tight same-day schedule for the artist — just flags
// it via bufferWarning so staff can decide.
router.post("/:id/schedule", requireAuth, requireRole(Role.OWNER, Role.FRONT_DESK), async (req, res) => {
  const id = req.params.id as string;
  const { startTime, endTime, giftCardId } = req.body ?? {};

  if (!startTime || !endTime) {
    return res.status(400).json({ error: "startTime and endTime are required" });
  }

  if (!giftCardId) {
    return res
      .status(400)
      .json({ error: "giftCardId is required — collect a deposit or issue a gift card for this client first." });
  }

  const start = new Date(startTime);
  const end = new Date(endTime);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
    return res.status(400).json({ error: "startTime and endTime must be valid dates, with startTime before endTime" });
  }

  const inquiry = await prisma.inquiry.findUnique({ where: { id } });
  if (!inquiry || inquiry.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Inquiry not found" });
  }

  if (inquiry.status !== InquiryStatus.SCHEDULING) {
    return res.status(400).json({ error: "Only an inquiry in SCHEDULING can be scheduled" });
  }

  if (!inquiry.assignedArtistId) {
    return res.status(400).json({ error: "This inquiry has no assigned artist" });
  }

  const giftCardResult = await validateGiftCardForAttachment(giftCardId, req.user!.studioId, inquiry.clientId);
  if ("error" in giftCardResult) {
    return res.status(400).json({ error: giftCardResult.error });
  }

  const dayStart = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const sameDayAppointments = await prisma.appointment.findMany({
    where: { artistId: inquiry.assignedArtistId, startTime: { gte: dayStart, lt: dayEnd } },
  });

  const conflict = sameDayAppointments.find(
    (appt) =>
      start.getTime() < appt.endTime.getTime() + SCHEDULING_BUFFER_MS &&
      appt.startTime.getTime() < end.getTime() + SCHEDULING_BUFFER_MS,
  );

  const appointment = await prisma.$transaction(async (tx) => {
    const created = await tx.appointment.create({
      data: {
        studioId: req.user!.studioId,
        artistId: inquiry.assignedArtistId!,
        clientId: inquiry.clientId,
        inquiryId: id,
        startTime: start,
        endTime: end,
        status: AppointmentStatus.CONFIRMED,
      },
    });

    await tx.giftCard.update({ where: { id: giftCardId }, data: { appointmentId: created.id } });

    return created;
  });

  const scheduleData = { appointmentId: appointment.id, status: InquiryStatus.CONFIRMED };

  const updated = await prisma.inquiry.update({
    where: { id },
    data: scheduleData,
    include: INQUIRY_INCLUDE,
  });

  await logAudit({
    studioId: req.user!.studioId,
    actorUserId: req.user!.userId,
    entityType: "Inquiry",
    entityId: id,
    action: "status_change",
    changes: diffObjects(inquiry, scheduleData, ["status", "appointmentId"]),
  });

  res.status(201).json({
    ...updated,
    bufferWarning: conflict
      ? `Less than 1.5 hours from another appointment for this artist the same day (${conflict.startTime.toISOString()} – ${conflict.endTime.toISOString()}).`
      : null,
  });
});

// Alternative to scheduling right away: keeps the inquiry out of active
// scheduling without losing it, for a client who wants to wait for a
// specific slot. The optional note is stored the same way an artist's
// decline note is -- a single "most recent status note" field.
router.post("/:id/waitlist", requireAuth, requireRole(Role.OWNER, Role.FRONT_DESK), async (req, res) => {
  const id = req.params.id as string;
  const { note } = req.body ?? {};

  if (note !== undefined && typeof note !== "string") {
    return res.status(400).json({ error: "note must be a string" });
  }

  const inquiry = await prisma.inquiry.findUnique({ where: { id } });
  if (!inquiry || inquiry.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Inquiry not found" });
  }

  if (inquiry.status !== InquiryStatus.SCHEDULING) {
    return res.status(400).json({ error: "Only an inquiry in SCHEDULING can be waitlisted" });
  }

  const waitlistData = { status: InquiryStatus.WAITLISTED, declineNote: note?.trim() || null };

  const updated = await prisma.inquiry.update({
    where: { id },
    data: waitlistData,
    include: INQUIRY_INCLUDE,
  });

  await logAudit({
    studioId: req.user!.studioId,
    actorUserId: req.user!.userId,
    entityType: "Inquiry",
    entityId: id,
    action: "status_change",
    changes: diffObjects(inquiry, waitlistData, ["status", "declineNote"]),
  });

  res.json(updated);
});

// The missing workflow action: marks an inquiry lost. Valid from any
// non-terminal status (Inquiries-side or Projects-side alike -- a
// confirmed project can still fall through). Deliberately conversation-
// agnostic: a separate workstream adds a chat-side entry point that calls
// this same route, so nothing here assumes it was reached from a thread.
router.post("/:id/mark-lost", requireAuth, requireRole(Role.OWNER, Role.FRONT_DESK), async (req, res) => {
  const id = req.params.id as string;
  const { reason } = req.body ?? {};

  if (reason !== undefined && reason !== null && typeof reason !== "string") {
    return res.status(400).json({ error: "reason must be a string" });
  }

  const inquiry = await prisma.inquiry.findUnique({ where: { id } });
  if (!inquiry || inquiry.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Inquiry not found" });
  }

  if (!NON_TERMINAL_STATUSES.includes(inquiry.status)) {
    return res.status(400).json({ error: "This inquiry is already in a terminal state (CLOSED_LOST or COLD_LEAD)" });
  }

  const lostData = {
    status: InquiryStatus.CLOSED_LOST,
    lostAt: new Date(),
    lostReason: typeof reason === "string" && reason.trim().length > 0 ? reason.trim() : null,
  };

  const updated = await prisma.inquiry.update({ where: { id }, data: lostData, include: INQUIRY_INCLUDE });

  await logAudit({
    studioId: req.user!.studioId,
    actorUserId: req.user!.userId,
    entityType: "Inquiry",
    entityId: id,
    action: "status_change",
    changes: diffObjects(inquiry, lostData, ["status", "lostAt", "lostReason"]),
  });

  res.json(updated);
});

// Reverses mark-lost OR the cold-lead sweep -- both terminal states share
// one reopen path. status is an explicit target rather than a fixed
// "back to NEW": staff know best where an inquiry should resume (one that
// was CONFIRMED before going cold shouldn't have to restart the pipeline).
router.post("/:id/reopen", requireAuth, requireRole(Role.OWNER, Role.FRONT_DESK), async (req, res) => {
  const id = req.params.id as string;
  const { status } = req.body ?? {};

  if (typeof status !== "string" || !NON_TERMINAL_STATUSES.includes(status as InquiryStatus)) {
    return res.status(400).json({ error: `status must be one of: ${NON_TERMINAL_STATUSES.join(", ")}` });
  }

  const inquiry = await prisma.inquiry.findUnique({ where: { id } });
  if (!inquiry || inquiry.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Inquiry not found" });
  }

  if (inquiry.status !== InquiryStatus.CLOSED_LOST && inquiry.status !== InquiryStatus.COLD_LEAD) {
    return res.status(400).json({ error: "Only a CLOSED_LOST or COLD_LEAD inquiry can be reopened" });
  }

  const reopenData = { status: status as InquiryStatus, lostAt: null, lostReason: null };

  const updated = await prisma.inquiry.update({ where: { id }, data: reopenData, include: INQUIRY_INCLUDE });

  await logAudit({
    studioId: req.user!.studioId,
    actorUserId: req.user!.userId,
    entityType: "Inquiry",
    entityId: id,
    action: "status_change",
    changes: diffObjects(inquiry, reopenData, ["status", "lostAt", "lostReason"]),
  });

  res.json(updated);
});

// Generates (or, if unsigned, regenerates) the client-facing deposit form
// link. Only valid once staff has scheduled a real appointment
// (DEPOSIT_PENDING), and the tier is computed from the artist's own
// estimate, not anything the client stated.
router.post("/:id/deposit-form", requireAuth, requireRole(Role.OWNER, Role.FRONT_DESK), async (req, res) => {
  const id = req.params.id as string;

  const inquiry = await prisma.inquiry.findUnique({ where: { id }, include: { depositForm: true } });
  if (!inquiry || inquiry.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Inquiry not found" });
  }

  if (inquiry.status !== InquiryStatus.DEPOSIT_PENDING) {
    return res.status(400).json({ error: "Only an inquiry in DEPOSIT_PENDING can get a deposit form" });
  }

  if (inquiry.priceEstimateLow == null || inquiry.priceEstimateHigh == null) {
    return res.status(400).json({ error: "This inquiry is missing a price estimate" });
  }

  if (inquiry.depositForm?.signedAt) {
    return res.status(400).json({ error: "This deposit form has already been signed" });
  }

  const average = (inquiry.priceEstimateLow + inquiry.priceEstimateHigh) / 2;
  const { depositAmount, totalCharged } = computeDepositTier(average);
  const feeAmount = totalCharged - depositAmount;

  const token = crypto.randomBytes(32).toString("hex");
  const tokenExpiresAt = new Date(Date.now() + DEPOSIT_TOKEN_TTL_HOURS * 60 * 60 * 1000);

  const depositForm = await prisma.depositForm.upsert({
    where: { inquiryId: id },
    create: { inquiryId: id, token, tokenExpiresAt, depositAmount, feeAmount, totalCharged },
    update: { token, tokenExpiresAt, depositAmount, feeAmount, totalCharged },
  });

  res.status(201).json({ ...depositForm, depositUrl: `${FRONTEND_URL}/deposit/${token}` });
});

// Explicit allowlist projection for the sanitized artist share -- named
// fields only, built up rather than derived by deleting keys from a full
// inquiry object, so nothing client-identifying (name/email/phone/DOB/
// address/emergency contact/health data/ID images) can leak through by
// accident as new Inquiry fields get added later.
function buildSharedInquiryProjection(inquiry: {
  description: string;
  colorOrBlackGrey: string;
  placement: string;
  estimatedSize: string;
  hasBeenTattooedBefore: boolean;
  budget: string | null;
  desiredTiming: string | null;
  timeEstimateHoursMin: number | null;
  timeEstimateHoursMax: number | null;
  priceEstimateLow: number | null;
  priceEstimateHigh: number | null;
  referenceImages: string[];
  placementImages: string[];
  preferredArtist: { user: { name: string | null; email: string } } | null;
}): { body: string; attachments: string[] } {
  const lines = [
    `Tattoo: ${inquiry.description}`,
    `Style: ${inquiry.colorOrBlackGrey}`,
    `Placement: ${inquiry.placement}`,
    `Size: ${inquiry.estimatedSize}`,
    `Previously tattooed: ${inquiry.hasBeenTattooedBefore ? "Yes" : "No"}`,
  ];

  if (inquiry.budget) lines.push(`Budget: ${inquiry.budget}`);
  if (inquiry.desiredTiming) lines.push(`Desired timing: ${inquiry.desiredTiming}`);
  if (inquiry.preferredArtist) {
    lines.push(`Preferred artist: ${inquiry.preferredArtist.user.name ?? inquiry.preferredArtist.user.email}`);
  }
  if (inquiry.timeEstimateHoursMin != null && inquiry.timeEstimateHoursMax != null) {
    lines.push(`Estimated time: ${inquiry.timeEstimateHoursMin}-${inquiry.timeEstimateHoursMax} hours`);
  }
  if (inquiry.priceEstimateLow != null && inquiry.priceEstimateHigh != null) {
    lines.push(`Estimated price: $${inquiry.priceEstimateLow}-$${inquiry.priceEstimateHigh}`);
  }

  return { body: lines.join("\n"), attachments: [...inquiry.referenceImages, ...inquiry.placementImages] };
}

// Both share-to-artist routes need the same non-PII fields plus the
// preferred-artist name (resolved via join so the message never shows a raw
// id) -- kept as a Prisma include shape shared between them.
const SHARE_TO_ARTIST_INCLUDE = {
  preferredArtist: { include: { user: { select: { name: true, email: true } } } },
} as const;

// Preview: exactly what would be composed into the artist's thread, before
// an artist is even picked -- the projection never depends on who receives
// it, so the frontend's confirmation modal can show this ahead of send.
router.get("/:id/share-to-artist/preview", requireAuth, requireRole(Role.OWNER, Role.FRONT_DESK), async (req, res) => {
  const id = req.params.id as string;

  const inquiry = await prisma.inquiry.findUnique({ where: { id }, include: SHARE_TO_ARTIST_INCLUDE });
  if (!inquiry || inquiry.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Inquiry not found" });
  }

  res.json(buildSharedInquiryProjection(inquiry));
});

// Sends a sanitized copy of an inquiry's tattoo details into the front-desk
// <-> artist STAFF thread, deliberately excluding all client PII. The body
// accepts artistUserId ONLY -- never message content from the client side --
// so the composed message can never carry anything beyond the fixed
// projection above.
router.post("/:id/share-to-artist", requireAuth, requireRole(Role.OWNER, Role.FRONT_DESK), async (req, res) => {
  const id = req.params.id as string;
  const { studioId, userId } = req.user!;
  const { artistUserId } = req.body ?? {};

  if (typeof artistUserId !== "string" || artistUserId.trim().length === 0) {
    return res.status(400).json({ error: "artistUserId is required" });
  }

  const inquiry = await prisma.inquiry.findUnique({ where: { id }, include: SHARE_TO_ARTIST_INCLUDE });
  if (!inquiry || inquiry.studioId !== studioId) {
    return res.status(404).json({ error: "Inquiry not found" });
  }

  const artist = await prisma.artist.findUnique({ where: { userId: artistUserId }, include: { user: true } });
  if (!artist || artist.user.studioId !== studioId || artist.user.role !== Role.ARTIST) {
    return res.status(400).json({ error: "artistUserId must be an artist in your studio" });
  }

  const { conversation } = await getOrCreateStaffConversation(studioId, artistUserId, userId);
  const { body, attachments } = buildSharedInquiryProjection(inquiry);
  const now = new Date();

  const [message] = await prisma.$transaction([
    prisma.message.create({
      data: {
        studioId,
        conversationId: conversation.id,
        channel: MessageChannel.IN_APP,
        direction: MessageDirection.OUTBOUND,
        body,
        attachments: attachments.length > 0 ? attachments : undefined,
        authorUserId: userId,
        // Set at creation only -- messages stay immutable. Lets the UI
        // render this as a distinct "Shared inquiry" card instead of a
        // plain text bubble.
        metadata: { kind: "shared_inquiry", inquiryId: id },
        createdAt: now,
      },
    }),
    prisma.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: now } }),
  ]);

  await logAudit({
    studioId,
    actorUserId: userId,
    entityType: "Inquiry",
    entityId: id,
    action: "shared_to_artist",
    changes: { artistUserId },
  });

  res.status(201).json({ conversationId: conversation.id, messageId: message.id });
});

export default router;
