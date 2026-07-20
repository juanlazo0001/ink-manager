import { Router } from "express";
import { prisma } from "../lib/prisma";
import { GiftCardStatus, Role } from "../../generated/prisma/enums";
import { requireAuth, requireRole } from "../middleware/auth";
import { diffObjects, logAudit } from "../lib/audit";
import { computeGiftCardExpiration, generateUniqueGiftCardCode, isExpired, syncExpiredStatus } from "../lib/giftCards";
import { getOrCreateClientConversation } from "../lib/conversations";
import { sendClientSms } from "../lib/clientSms";
import { PUBLIC_APP_URL } from "../lib/publicUrl";

const GIFT_CARD_DETAIL_INCLUDE = {
  appointment: { select: { id: true, startTime: true, endTime: true } },
  issuedBy: { select: { id: true, name: true, email: true } },
  client: { select: { id: true, firstName: true, lastName: true } },
} as const;

// Public: the card's own code is the bearer token here, and deliberately
// does NOT expire on use like the other public tokens (consent/estimate/
// deposit) -- a gift card is reusable until it's actually redeemed or its
// own expiresAt passes, so the link needs to keep working across visits.
const publicRouter = Router();

publicRouter.get("/view/:code", async (req, res) => {
  const code = req.params.code as string;

  const card = await prisma.giftCard.findUnique({
    where: { code },
    include: { studio: { select: { name: true } } },
  });

  if (!card) {
    return res.status(404).json({ error: "This gift card code is invalid." });
  }

  const synced = await syncExpiredStatus(card);

  res.json({
    studioName: card.studio.name,
    code: card.code,
    amountCents: synced.amountCents,
    status: synced.status,
    expiresAt: synced.expiresAt,
  });
});

const router = Router();
router.use(requireAuth);
router.use(requireRole(Role.OWNER, Role.FRONT_DESK));

router.post("/", async (req, res) => {
  const body = req.body ?? {};
  const { clientId, amountCents, appointmentId, expiresAt } = body;
  const studioId = req.user!.studioId;

  if (!clientId || typeof amountCents !== "number" || amountCents <= 0) {
    return res.status(400).json({ error: "clientId and a positive amountCents are required" });
  }

  if (expiresAt !== undefined && req.user!.role !== Role.OWNER) {
    return res.status(403).json({ error: "Only an OWNER can override the default expiration when issuing a card" });
  }

  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client || client.studioId !== studioId || client.mergedIntoId) {
    return res.status(400).json({ error: "clientId must belong to an active client in your studio" });
  }

  if (appointmentId) {
    const [appointment, existingCard] = await Promise.all([
      prisma.appointment.findUnique({ where: { id: appointmentId } }),
      prisma.giftCard.findUnique({ where: { appointmentId } }),
    ]);

    if (!appointment || appointment.studioId !== studioId || appointment.clientId !== clientId) {
      return res.status(400).json({ error: "appointmentId must belong to this client in your studio" });
    }

    if (existingCard && !isExpired(existingCard) && existingCard.status === GiftCardStatus.ACTIVE) {
      return res.status(400).json({ error: "This appointment already has an active gift card attached" });
    }
  }

  let resolvedExpiresAt: Date | null;
  if (expiresAt !== undefined) {
    resolvedExpiresAt = expiresAt === null ? null : new Date(expiresAt);
    if (resolvedExpiresAt !== null && Number.isNaN(resolvedExpiresAt.getTime())) {
      return res.status(400).json({ error: "expiresAt must be a valid date or null" });
    }
  } else {
    const settings = await prisma.studioSettings.findUnique({ where: { studioId } });
    resolvedExpiresAt = computeGiftCardExpiration(settings?.giftCardDefaultExpirationDays ?? null);
  }

  const code = await generateUniqueGiftCardCode();

  const card = await prisma.giftCard.create({
    data: {
      studioId,
      clientId,
      code,
      amountCents,
      expiresAt: resolvedExpiresAt,
      appointmentId: appointmentId || null,
      issuedById: req.user!.userId,
    },
  });

  await logAudit({
    studioId,
    actorUserId: req.user!.userId,
    entityType: "GiftCard",
    entityId: card.id,
    action: "create",
    changes: { clientId, amountCents, appointmentId: appointmentId ?? null, expiresAt: resolvedExpiresAt },
  });

  res.status(201).json(card);
});

router.get("/:id", async (req, res) => {
  const id = req.params.id as string;

  const card = await prisma.giftCard.findUnique({ where: { id }, include: GIFT_CARD_DETAIL_INCLUDE });
  if (!card || card.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Gift card not found" });
  }

  const synced = await syncExpiredStatus(card);
  res.json({ ...card, status: synced.status });
});

const TEXT_RECEIPT_ERROR_MESSAGES: Record<string, string> = {
  not_connected: "This studio's SMS integration isn't connected -- connect it in Settings to send text receipts.",
  no_phone: "This client has no phone number on file.",
  opted_out: "This client has opted out of text messages.",
  send_failed: "The text failed to send -- try again in a moment.",
};

router.post("/:id/text-receipt", async (req, res) => {
  const id = req.params.id as string;
  const studioId = req.user!.studioId;

  const card = await prisma.giftCard.findUnique({
    where: { id },
    include: { studio: { select: { name: true } } },
  });
  if (!card || card.studioId !== studioId) {
    return res.status(404).json({ error: "Gift card not found" });
  }

  const synced = await syncExpiredStatus(card);
  if (synced.status !== GiftCardStatus.ACTIVE) {
    return res.status(400).json({ error: `Only an ACTIVE card can have a receipt texted (this one is ${synced.status})` });
  }

  const publicUrl = `${PUBLIC_APP_URL}/gift-card/${card.code}`;
  const amount = (card.amountCents / 100).toFixed(2);
  const body = `Thanks for your purchase! Here's your $${amount} gift card from ${card.studio.name}: ${publicUrl} (code ${card.code})`;

  const { conversation } = await getOrCreateClientConversation(studioId, card.clientId, req.user!.userId);

  const result = await sendClientSms({
    studioId,
    clientId: card.clientId,
    conversationId: conversation.id,
    body,
    actorUserId: req.user!.userId,
  });

  if (!result.sent) {
    return res.status(400).json({ error: TEXT_RECEIPT_ERROR_MESSAGES[result.reason] ?? "The receipt could not be sent." });
  }

  await logAudit({
    studioId,
    actorUserId: req.user!.userId,
    entityType: "GiftCard",
    entityId: id,
    action: "text-receipt",
    changes: { conversationId: conversation.id, messageId: result.messageId },
  });

  res.json({ sent: true });
});

router.patch("/:id/attachment", async (req, res) => {
  const id = req.params.id as string;
  const { appointmentId } = req.body ?? {};

  if (appointmentId !== null && typeof appointmentId !== "string") {
    return res.status(400).json({ error: "appointmentId must be a string or null" });
  }

  const card = await prisma.giftCard.findUnique({ where: { id } });
  if (!card || card.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Gift card not found" });
  }

  const synced = await syncExpiredStatus(card);
  if (synced.status !== GiftCardStatus.ACTIVE) {
    return res.status(400).json({ error: `Only an ACTIVE card can be moved (this one is ${synced.status})` });
  }

  const fromAppointmentId = card.appointmentId;

  if (appointmentId) {
    const [appointment, existingCard] = await Promise.all([
      prisma.appointment.findUnique({ where: { id: appointmentId } }),
      prisma.giftCard.findUnique({ where: { appointmentId } }),
    ]);

    if (!appointment || appointment.studioId !== req.user!.studioId || appointment.clientId !== card.clientId) {
      return res.status(400).json({ error: "appointmentId must belong to this card's client in your studio" });
    }

    if (existingCard && existingCard.id !== id) {
      return res.status(400).json({ error: "That appointment already has a gift card attached" });
    }
  }

  const updated = await prisma.giftCard.update({ where: { id }, data: { appointmentId: appointmentId ?? null } });

  await logAudit({
    studioId: req.user!.studioId,
    actorUserId: req.user!.userId,
    entityType: "GiftCard",
    entityId: id,
    action: "rollover",
    changes: { fromAppointmentId, toAppointmentId: appointmentId ?? null },
  });

  res.json({
    ...updated,
    // Detaching leaves that appointment without a deposit -- Phase 4's
    // checkout flow governs this, but the UI should be able to warn now.
    detachedFromAppointment: appointmentId === null && fromAppointmentId != null ? fromAppointmentId : null,
  });
});

router.post("/:id/void", requireRole(Role.OWNER), async (req, res) => {
  const id = req.params.id as string;

  const card = await prisma.giftCard.findUnique({ where: { id } });
  if (!card || card.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Gift card not found" });
  }

  if (card.status === GiftCardStatus.VOID) {
    return res.status(400).json({ error: "This card has already been voided" });
  }

  const formerAppointmentId = card.appointmentId;

  const updated = await prisma.giftCard.update({
    where: { id },
    data: { status: GiftCardStatus.VOID, appointmentId: null },
  });

  await logAudit({
    studioId: req.user!.studioId,
    actorUserId: req.user!.userId,
    entityType: "GiftCard",
    entityId: id,
    action: "void",
    changes: { status: { from: card.status, to: GiftCardStatus.VOID }, detachedFromAppointment: formerAppointmentId },
  });

  res.json(updated);
});

router.patch("/:id", requireRole(Role.OWNER), async (req, res) => {
  const id = req.params.id as string;
  const body = req.body ?? {};

  if (!("expiresAt" in body)) {
    return res.status(400).json({ error: "expiresAt is required (use null to clear it)" });
  }

  const { expiresAt } = body;

  if (expiresAt !== null && Number.isNaN(new Date(expiresAt).getTime())) {
    return res.status(400).json({ error: "expiresAt must be a valid date or null" });
  }

  const card = await prisma.giftCard.findUnique({ where: { id } });
  if (!card || card.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Gift card not found" });
  }

  const data = { expiresAt: expiresAt === null ? null : new Date(expiresAt) };
  const updated = await prisma.giftCard.update({ where: { id }, data });

  await logAudit({
    studioId: req.user!.studioId,
    actorUserId: req.user!.userId,
    entityType: "GiftCard",
    entityId: id,
    action: "update",
    changes: diffObjects(card, data, ["expiresAt"]),
  });

  res.json(updated);
});

export { publicRouter, router as staffRouter };
