import { Router } from "express";
import { prisma } from "../lib/prisma";
import { GiftCardStatus, Role } from "../../generated/prisma/enums";
import { requireAuth, requireRole } from "../middleware/auth";
import { diffObjects, logAudit } from "../lib/audit";
import { computeGiftCardExpiration, generateUniqueGiftCardCode, syncExpiredStatus } from "../lib/giftCards";
import { getOrCreateClientConversation } from "../lib/conversations";
import { sendClientSms } from "../lib/clientSms";
import { sendClientEmail } from "../lib/clientEmail";
import { renderClientEmailHtml } from "../lib/emailTemplate";
import { PUBLIC_APP_URL } from "../lib/publicUrl";
import { shortenUrl } from "../lib/shortLinks";
import { DEFAULT_THEME_PRESET } from "../lib/themePresets";
import { getChargeableConnectedAccountId } from "../lib/stripeConnect";
import { createDirectChargeCheckoutSession } from "../lib/stripe";
import { emitInvalidation } from "../lib/realtime/registry";
import { callerBelongsToStudio, hasPermissionAt } from "../lib/artistAccess";

const GIFT_CARD_DETAIL_INCLUDE = {
  // Stackable gift cards: giftCards here is every OTHER card (this one
  // included) attached to the same appointment -- lets the detail page
  // show stacked context ("alongside 2 other cards") instead of implying
  // a solitary 1:1 relationship that no longer holds.
  appointment: {
    select: {
      id: true,
      startTime: true,
      endTime: true,
      giftCards: { select: { id: true, code: true, amountCents: true, status: true } },
    },
  },
  issuedBy: { select: { id: true, name: true, email: true } },
  // phone/email (plus phones/emails, minimal -- just presence) for the
  // detail page's own Send Receipt channel picker -- reads the real
  // contact rows, not just the singular scalars, since those can drift
  // null even when a client genuinely has a phone/email on file. See
  // routes/inquiries.ts's own INQUIRY_INCLUDE comment for the full bug.
  client: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phone: true,
      email: true,
      phones: { select: { id: true } },
      emails: { select: { id: true } },
    },
  },
  // Checkout overage (Part 3): when this card was issued from redeeming a
  // larger one down to its exact remaining difference, this surfaces
  // where it came from -- support/audit clarity, not needed for the
  // normal gift-card-issuance paths where it's always null.
  derivedFromGiftCard: { select: { id: true, code: true, amountCents: true } },
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
    include: { studio: { select: { name: true, slug: true, settings: { select: { themePreset: true } } } } },
  });

  if (!card) {
    return res.status(404).json({ error: "This gift card code is invalid." });
  }

  const synced = await syncExpiredStatus(card);

  res.json({
    studioName: card.studio.name,
    studioSlug: card.studio.slug,
    themePreset: card.studio.settings?.themePreset ?? DEFAULT_THEME_PRESET,
    code: card.code,
    amountCents: synced.amountCents,
    status: synced.status,
    expiresAt: synced.expiresAt,
  });
});

const router = Router();
router.use(requireAuth);

// Cash payment path: this is the ONE general/manual issuance route (not
// tied to a deposit form, not the EXEMPT override below) -- the only
// legitimate reason staff call this directly is recording an in-person
// cash collection (a Stripe-paid card always comes through the deposit
// checkout/webhook flow instead, never this route). paymentMethod is
// therefore required and locked to "CASH", not left open to any value --
// this is what closes the previously-silent gap where a gift card could
// be issued here with zero record of whether real payment was ever
// collected. Same requirePermission("giftCards.issue") gate as before;
// no new permission introduced, per this session's own instruction to
// reuse whatever already governs this action.
router.post("/", async (req, res) => {
  const body = req.body ?? {};
  const { clientId, amountCents, appointmentId, expiresAt, paymentMethod } = body;

  if (!clientId || typeof amountCents !== "number" || amountCents <= 0) {
    return res.status(400).json({ error: "clientId and a positive amountCents are required" });
  }

  if (paymentMethod !== "CASH") {
    return res.status(400).json({ error: 'paymentMethod must be "CASH" -- use POST /gift-cards/exempt for a no-payment override.' });
  }

  if (expiresAt !== undefined && req.user!.role !== Role.OWNER) {
    return res.status(403).json({ error: "Only an OWNER can override the default expiration when issuing a card" });
  }

  const client = await prisma.client.findUnique({ where: { id: clientId } });
  // Artist mobility bug fix: resolve studioId from the CLIENT's own studio,
  // then verify the caller actually belongs there (HOME or GUEST) -- not
  // req.user!.studioId, which is only the caller's home and would reject
  // a guest artist issuing a card for their own guest-studio client.
  if (!client || client.mergedIntoId || !(await callerBelongsToStudio(req.user!, client.studioId))) {
    return res.status(400).json({ error: "clientId must belong to an active client in your studio" });
  }
  const studioId = client.studioId;

  // Permission-context fix: evaluated at the client's own studio.
  if (!(await hasPermissionAt(req.user!, studioId, "giftCards.issue"))) {
    return res.status(403).json({ error: "Forbidden" });
  }

  // Stackable gift cards: no "this appointment already has a card" guard
  // here anymore -- several cards can legitimately share one appointmentId
  // now, so a studio issuing a brand-new card straight onto an appointment
  // that already has others attached is expected, not an error.
  if (appointmentId) {
    const appointment = await prisma.appointment.findUnique({ where: { id: appointmentId } });

    if (!appointment || appointment.studioId !== studioId || appointment.clientId !== clientId) {
      return res.status(400).json({ error: "appointmentId must belong to this client in your studio" });
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
      paymentMethod: "CASH",
    },
  });

  await logAudit({
    studioId,
    actorUserId: req.user!.userId,
    entityType: "GiftCard",
    entityId: card.id,
    action: "create",
    changes: { clientId, amountCents, appointmentId: appointmentId ?? null, expiresAt: resolvedExpiresAt, paymentMethod: "CASH" },
  });

  emitInvalidation({ type: "giftcard.changed", studioId, clientId });

  res.status(201).json(card);
});

// Stripe checkout-link path: the third and last real issuance path
// alongside Cash (above) and Exempt (below) -- a staff-generated payment
// link for the client to pay themselves, rather than a live in-person
// collection. The GiftCard row (and its real, final code) is created
// PENDING immediately -- not spendable/attachable yet (validateGiftCard
// ForAttachment only ever accepts ACTIVE/EXEMPT) -- so the webhook
// (routes/webhooks.ts) has something to find by stripeCheckoutSessionId
// once payment actually completes. Same requirePermission("giftCards.issue")
// gate as the Cash path -- this is still just "issuing a gift card,"
// same capability, different payment method.
router.post("/checkout-session", async (req, res) => {
  const body = req.body ?? {};
  const { clientId, amountCents, appointmentId, expiresAt } = body;

  if (!clientId || typeof amountCents !== "number" || amountCents <= 0) {
    return res.status(400).json({ error: "clientId and a positive amountCents are required" });
  }

  if (expiresAt !== undefined && req.user!.role !== Role.OWNER) {
    return res.status(403).json({ error: "Only an OWNER can override the default expiration when issuing a card" });
  }

  const client = await prisma.client.findUnique({ where: { id: clientId } });
  // Artist mobility bug fix: same as POST / above -- resolve studioId from
  // the client's own studio, verify caller membership against THAT.
  if (!client || client.mergedIntoId || !(await callerBelongsToStudio(req.user!, client.studioId))) {
    return res.status(400).json({ error: "clientId must belong to an active client in your studio" });
  }
  const studioId = client.studioId;

  // Permission-context fix: evaluated at the client's own studio.
  if (!(await hasPermissionAt(req.user!, studioId, "giftCards.issue"))) {
    return res.status(403).json({ error: "Forbidden" });
  }

  if (appointmentId) {
    const appointment = await prisma.appointment.findUnique({ where: { id: appointmentId } });

    if (!appointment || appointment.studioId !== studioId || appointment.clientId !== clientId) {
      return res.status(400).json({ error: "appointmentId must belong to this client in your studio" });
    }
  }

  const stripeAccountId = await getChargeableConnectedAccountId(studioId);
  if (!stripeAccountId) {
    return res.status(400).json({ error: "Online payment isn't available for this studio right now." });
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
      status: GiftCardStatus.PENDING,
      expiresAt: resolvedExpiresAt,
      appointmentId: appointmentId || null,
      issuedById: req.user!.userId,
      paymentMethod: "STRIPE",
    },
  });

  let session;
  try {
    session = await createDirectChargeCheckoutSession({
      connectedAccountId: stripeAccountId,
      amountCents,
      productName: "Gift Card",
      successUrl: `${PUBLIC_APP_URL}/gift-card/${code}?paid=1`,
      cancelUrl: `${PUBLIC_APP_URL}/gift-card/${code}?canceled=1`,
      metadata: { giftCardId: card.id },
    });
  } catch (err) {
    // Nothing was ever charged and this card can never become spendable
    // without a session to pay through -- delete rather than leave an
    // orphaned PENDING row with no way to ever complete.
    await prisma.giftCard.delete({ where: { id: card.id } });
    return res.status(502).json({ error: err instanceof Error ? err.message : "Failed to start Stripe checkout" });
  }

  const updated = await prisma.giftCard.update({
    where: { id: card.id },
    data: { stripeCheckoutSessionId: session.id },
  });

  await logAudit({
    studioId,
    actorUserId: req.user!.userId,
    entityType: "GiftCard",
    entityId: card.id,
    action: "checkout_session_created",
    changes: { clientId, amountCents, appointmentId: appointmentId ?? null, expiresAt: resolvedExpiresAt, paymentMethod: "STRIPE" },
  });

  emitInvalidation({ type: "giftcard.changed", studioId, clientId });

  res.status(201).json({ ...updated, checkoutUrl: session.url });
});

// OWNER-only, permanently -- one of this expansion's fixed safety-floor
// items, never matrix-configurable (see lib/permissions.ts's own top
// comment and REPORT.md). A "Deposit Exemption" is a real GiftCard row
// (status EXEMPT, amountCents 0) that satisfies the "appointment requires
// an attached ACTIVE gift card" rule without representing real money -- it
// reuses the entire existing gift-card system (attach/detach, audit trail,
// appointment validation in validateGiftCardForAttachment) rather than a
// parallel mechanism. Day-to-day attach/detach of an already-issued exempt
// card is governed by the normal appointments/gift-card permissions; only
// issuance itself is OWNER-restricted, same precedent as /:id/void below.
router.post("/exempt", requireRole(Role.OWNER), async (req, res) => {
  const body = req.body ?? {};
  const { clientId, exemptionReason, expiresAt } = body;
  const studioId = req.user!.studioId;

  if (!clientId || typeof clientId !== "string") {
    return res.status(400).json({ error: "clientId is required" });
  }

  if (exemptionReason !== undefined && exemptionReason !== null && typeof exemptionReason !== "string") {
    return res.status(400).json({ error: "exemptionReason must be a string or null" });
  }

  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client || client.studioId !== studioId || client.mergedIntoId) {
    return res.status(400).json({ error: "clientId must belong to an active client in your studio" });
  }

  // Unlike regular issuance, an exemption defaults to never expiring --
  // there's no studio-wide default here, only what the OWNER explicitly sets.
  let resolvedExpiresAt: Date | null = null;
  if (expiresAt !== undefined && expiresAt !== null) {
    resolvedExpiresAt = new Date(expiresAt);
    if (Number.isNaN(resolvedExpiresAt.getTime())) {
      return res.status(400).json({ error: "expiresAt must be a valid date or null" });
    }
  }

  const code = await generateUniqueGiftCardCode();
  const reason = typeof exemptionReason === "string" && exemptionReason.trim() ? exemptionReason.trim() : null;

  const card = await prisma.giftCard.create({
    data: {
      studioId,
      clientId,
      code,
      amountCents: 0,
      status: GiftCardStatus.EXEMPT,
      exemptionReason: reason,
      expiresAt: resolvedExpiresAt,
      issuedById: req.user!.userId,
      paymentMethod: "EXEMPT",
    },
  });

  await logAudit({
    studioId,
    actorUserId: req.user!.userId,
    entityType: "GiftCard",
    entityId: card.id,
    action: "exempt_gift_card_issued",
    changes: { clientId, exemptionReason: reason, expiresAt: resolvedExpiresAt },
  });

  emitInvalidation({ type: "giftcard.changed", studioId, clientId });

  res.status(201).json(card);
});

router.get("/:id", async (req, res) => {
  const id = req.params.id as string;

  const card = await prisma.giftCard.findUnique({ where: { id }, include: GIFT_CARD_DETAIL_INCLUDE });
  if (!card || !(await callerBelongsToStudio(req.user!, card.studioId))) {
    return res.status(404).json({ error: "Gift card not found" });
  }

  // Permission-context fix: evaluated at the gift card's own studio.
  if (!(await hasPermissionAt(req.user!, card.studioId, "giftCards.view"))) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const synced = await syncExpiredStatus(card);
  // Same shortLinks.shortenUrl every other public link goes through --
  // idempotent by target URL, so this is the same short code already
  // handed out for this card's link elsewhere (SMS text receipt, the
  // client's shareable-links composer), not a fresh one. The detail page
  // previously reconstructed a full-length URL client-side from the raw
  // code instead.
  const publicUrl = await shortenUrl(`${PUBLIC_APP_URL}/gift-card/${card.code}`);
  res.json({ ...card, status: synced.status, publicUrl });
});

const TEXT_RECEIPT_ERROR_MESSAGES: Record<string, string> = {
  not_connected: "This studio's SMS integration isn't connected -- connect it in Settings to send text receipts.",
  no_phone: "This client has no phone number on file.",
  opted_out: "This client has opted out of text messages.",
  no_email: "This client has no email address on file.",
  send_failed: "The receipt failed to send -- try again in a moment.",
};

// Route path stays "text-receipt" (external API stability -- no reason to
// churn callers over a name), but "Text Receipt" is now "Send Receipt" on
// the frontend and this accepts either channel. Audit action reflects
// which one actually ran.
router.post("/:id/text-receipt", async (req, res) => {
  const id = req.params.id as string;
  const { channel } = req.body ?? {};

  if (channel !== undefined && channel !== "SMS" && channel !== "EMAIL") {
    return res.status(400).json({ error: "channel must be SMS or EMAIL" });
  }

  const card = await prisma.giftCard.findUnique({
    where: { id },
    include: { studio: { select: { name: true } } },
  });
  if (!card || !(await callerBelongsToStudio(req.user!, card.studioId))) {
    return res.status(404).json({ error: "Gift card not found" });
  }
  const studioId = card.studioId;

  // Permission-context fix: evaluated at the gift card's own studio.
  if (!(await hasPermissionAt(req.user!, studioId, "giftCards.issue"))) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const synced = await syncExpiredStatus(card);
  if (synced.status !== GiftCardStatus.ACTIVE) {
    return res.status(400).json({ error: `Only an ACTIVE card can have a receipt sent (this one is ${synced.status})` });
  }

  const publicUrl = await shortenUrl(`${PUBLIC_APP_URL}/gift-card/${card.code}`);
  const amount = (card.amountCents / 100).toFixed(2);
  const body = `Thanks for your purchase! Here's your $${amount} gift card from ${card.studio.name}: ${publicUrl} (code ${card.code})`;

  const { conversation } = await getOrCreateClientConversation(studioId, card.clientId, req.user!.userId);

  const result =
    channel === "EMAIL"
      ? await sendClientEmail({
          studioId,
          clientId: card.clientId,
          conversationId: conversation.id,
          subject: `Your gift card -- ${card.studio.name}`,
          bodyText: body,
          bodyHtml: renderClientEmailHtml({
            studioName: card.studio.name,
            heading: "Thanks for your purchase!",
            bodyParagraphs: [`Here's your $${amount} gift card (code ${card.code}).`],
            buttonText: "View gift card",
            buttonUrl: publicUrl,
          }),
          actorUserId: req.user!.userId,
          logAttemptEvenOnFailure: true,
        })
      : await sendClientSms({
          studioId,
          clientId: card.clientId,
          conversationId: conversation.id,
          body,
          actorUserId: req.user!.userId,
          logAttemptEvenOnFailure: true,
        });

  if (!result.sent) {
    return res.status(400).json({ error: TEXT_RECEIPT_ERROR_MESSAGES[result.reason] ?? "The receipt could not be sent." });
  }

  await logAudit({
    studioId,
    actorUserId: req.user!.userId,
    entityType: "GiftCard",
    entityId: id,
    action: channel === "EMAIL" ? "email-receipt" : "text-receipt",
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
  if (!card || !(await callerBelongsToStudio(req.user!, card.studioId))) {
    return res.status(404).json({ error: "Gift card not found" });
  }

  // Permission-context fix: evaluated at the gift card's own studio.
  if (!(await hasPermissionAt(req.user!, card.studioId, "giftCards.issue"))) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const synced = await syncExpiredStatus(card);
  if (synced.status !== GiftCardStatus.ACTIVE && synced.status !== GiftCardStatus.EXEMPT) {
    return res
      .status(400)
      .json({ error: `Only an ACTIVE or EXEMPT card can be moved (this one is ${synced.status})` });
  }

  const fromAppointmentId = card.appointmentId;

  // Stackable gift cards: no "that appointment already has a card" guard
  // here anymore -- moving this card onto an appointment that already has
  // others attached is expected now, not an error.
  if (appointmentId) {
    const appointment = await prisma.appointment.findUnique({ where: { id: appointmentId } });

    if (!appointment || appointment.studioId !== card.studioId || appointment.clientId !== card.clientId) {
      return res.status(400).json({ error: "appointmentId must belong to this card's client in your studio" });
    }
  }

  const updated = await prisma.giftCard.update({ where: { id }, data: { appointmentId: appointmentId ?? null } });

  await logAudit({
    studioId: card.studioId,
    actorUserId: req.user!.userId,
    entityType: "GiftCard",
    entityId: id,
    action: "rollover",
    changes: { fromAppointmentId, toAppointmentId: appointmentId ?? null },
  });

  emitInvalidation({ type: "giftcard.changed", studioId: card.studioId, clientId: card.clientId });

  res.json({
    ...updated,
    // Detaching leaves that appointment without a deposit -- Phase 4's
    // checkout flow governs this, but the UI should be able to warn now.
    detachedFromAppointment: appointmentId === null && fromAppointmentId != null ? fromAppointmentId : null,
  });
});

// Staff quick win: reassign which client holds this card -- a genuinely
// different action from PATCH /:id/attachment above (which moves an
// already-this-client's card onto/off one of THEIR OWN appointments).
// Same giftCards.issue permission tier as that route (this is the
// closest existing precedent: "modify what this card is associated
// with," not a terminal action like void). Deliberately allowed for
// any non-VOID status -- REDEEMED/EXPIRED/EXEMPT cards are real
// historical records a studio may still need to correct the holder on,
// not just untouched ACTIVE ones; VOID is the one true dead end.
router.patch("/:id/holder", async (req, res) => {
  const id = req.params.id as string;
  const { clientId } = req.body ?? {};

  if (typeof clientId !== "string" || !clientId) {
    return res.status(400).json({ error: "clientId is required" });
  }

  const card = await prisma.giftCard.findUnique({ where: { id }, include: { client: true } });
  if (!card || !(await callerBelongsToStudio(req.user!, card.studioId))) {
    return res.status(404).json({ error: "Gift card not found" });
  }

  // Permission-context fix: evaluated at the gift card's own studio.
  if (!(await hasPermissionAt(req.user!, card.studioId, "giftCards.issue"))) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const synced = await syncExpiredStatus(card);
  if (synced.status === GiftCardStatus.VOID) {
    return res.status(400).json({ error: "A voided card can't be reassigned to a different client" });
  }

  const newClient = await prisma.client.findUnique({ where: { id: clientId } });
  if (!newClient || newClient.studioId !== card.studioId) {
    return res.status(400).json({ error: "clientId must belong to this card's studio" });
  }
  if (newClient.id === card.clientId) {
    return res.status(400).json({ error: "This card is already attached to that client" });
  }

  const fromClient = card.client;
  const hadAppointmentId = card.appointmentId;

  // The card's own appointmentId (if set) belongs to the OLD holder --
  // /attachment's own invariant (appointment.clientId === card.clientId)
  // would otherwise silently break the instant the holder changes, so
  // this clears it in the same update rather than leaving a dangling
  // reference for staff to discover later as a confusing bug.
  const updated = await prisma.giftCard.update({
    where: { id },
    data: { clientId: newClient.id, appointmentId: null },
  });

  await logAudit({
    studioId: card.studioId,
    actorUserId: req.user!.userId,
    entityType: "GiftCard",
    entityId: id,
    action: "reassign-holder",
    changes: {
      holder: {
        from: `${fromClient.firstName} ${fromClient.lastName}`,
        to: `${newClient.firstName} ${newClient.lastName}`,
      },
      ...(hadAppointmentId ? { detachedFromAppointment: { from: hadAppointmentId, to: null } } : {}),
    },
  });

  emitInvalidation({ type: "giftcard.changed", studioId: card.studioId, clientId: fromClient.id });
  emitInvalidation({ type: "giftcard.changed", studioId: card.studioId, clientId: newClient.id });

  res.json({ ...updated, detachedFromAppointment: hadAppointmentId ?? null });
});

// Scanner feature: the front-desk "redeem/apply" action a QR scan routes
// staff to. No dedicated redeem endpoint existed before this -- the only
// prior way a card became REDEEMED was as a side effect of a full session
// checkout's own redeem/roll decision (routes/appointments.ts). This is
// the direct, out-of-band equivalent for a card being spent at the front
// desk without going through that flow (e.g. a walk-in, or simply
// confirming a client's voucher on the spot). Same terminal-action
// permission tier as /void (giftCards.void), not giftCards.issue --
// spending a card's value down is a consuming action, not an issuing one.
router.post("/:id/redeem", async (req, res) => {
  const id = req.params.id as string;

  const card = await prisma.giftCard.findUnique({ where: { id } });
  if (!card || !(await callerBelongsToStudio(req.user!, card.studioId))) {
    return res.status(404).json({ error: "Gift card not found" });
  }

  // Permission-context fix: evaluated at the gift card's own studio.
  if (!(await hasPermissionAt(req.user!, card.studioId, "giftCards.void"))) {
    return res.status(403).json({ error: "Forbidden" });
  }

  // Lazy expiry sync, same as every other read/mutation of a single card
  // in this file -- an ACTIVE-looking row whose expiresAt has already
  // passed must be caught here, not redeemed as if it were still good.
  const synced = await syncExpiredStatus(card);

  if (synced.status !== GiftCardStatus.ACTIVE) {
    const reason =
      synced.status === GiftCardStatus.REDEEMED
        ? "This card has already been redeemed"
        : synced.status === GiftCardStatus.EXPIRED
          ? "This card has expired"
          : synced.status === GiftCardStatus.VOID
            ? "This card has been voided"
            : `This card isn't redeemable (status: ${synced.status})`;
    return res.status(400).json({ error: reason });
  }

  const updated = await prisma.giftCard.update({
    where: { id },
    data: { status: GiftCardStatus.REDEEMED, redeemedAt: new Date() },
  });

  await logAudit({
    studioId: card.studioId,
    actorUserId: req.user!.userId,
    entityType: "GiftCard",
    entityId: id,
    action: "redeem",
    changes: { status: { from: synced.status, to: GiftCardStatus.REDEEMED }, source: "scanner" },
  });

  // Same event shape every other gift-card mutation in this file already
  // uses -- the scanner's redemption is not a special case realtime-wise.
  emitInvalidation({ type: "giftcard.changed", studioId: card.studioId, clientId: card.clientId });

  res.json(updated);
});

// Not a safety-floor item -- OWNER-only was just the previous hardcoded
// default, now a genuinely configurable key (defaults preserve that exact
// behavior: FRONT_DESK/ARTIST both false until an OWNER opts in).
router.post("/:id/void", async (req, res) => {
  const id = req.params.id as string;

  const card = await prisma.giftCard.findUnique({ where: { id } });
  if (!card || !(await callerBelongsToStudio(req.user!, card.studioId))) {
    return res.status(404).json({ error: "Gift card not found" });
  }

  // Permission-context fix: evaluated at the gift card's own studio.
  if (!(await hasPermissionAt(req.user!, card.studioId, "giftCards.void"))) {
    return res.status(403).json({ error: "Forbidden" });
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
    studioId: card.studioId,
    actorUserId: req.user!.userId,
    entityType: "GiftCard",
    entityId: id,
    action: "void",
    changes: { status: { from: card.status, to: GiftCardStatus.VOID }, detachedFromAppointment: formerAppointmentId },
  });

  emitInvalidation({ type: "giftcard.changed", studioId: card.studioId, clientId: card.clientId });

  res.json(updated);
});

// Left hardcoded OWNER-only, not part of this expansion's key set -- was
// already OWNER-only (not FD-accessible even under the old router-level
// gate), and no key in this task's list maps to "edit a card's expiration/
// other fields" without either overreaching giftCards.issue's FD-default
// scope or inventing a key the task didn't ask for.
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

  emitInvalidation({ type: "giftcard.changed", studioId: req.user!.studioId, clientId: card.clientId });

  res.json(updated);
});

export { publicRouter, router as staffRouter };
