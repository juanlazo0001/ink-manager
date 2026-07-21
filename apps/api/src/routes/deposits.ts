import { Router } from "express";
import { prisma } from "../lib/prisma";
import { InquiryStatus, Role } from "../../generated/prisma/enums";
import { requireAuth, requireRole } from "../middleware/auth";
import { diffObjects, logAudit } from "../lib/audit";
import { dollarsToCents } from "../lib/money";
import { computeGiftCardExpiration, generateUniqueGiftCardCode } from "../lib/giftCards";

// Exact SOP wording, in the order the client must agree to each one.
const TERMS = [
  {
    key: "agreedNonRefundable",
    label:
      "A deposit is required to set an appointment. Deposits are non-refundable and are applied to the final price of the tattoo.",
  },
  {
    key: "agreedLatePolicy",
    label: "Artists reserve the right to reschedule the appointment if the client is more than 15 minutes late without notification.",
  },
  {
    key: "agreedNoShowForfeit",
    label: "A no-call/no-show forfeits the deposit. A 48-hour notice is required to change a scheduled appointment.",
  },
  {
    key: "agreedNewDepositAfterNoShow",
    label: "After a no-call/no-show, a new deposit is required to set up another appointment.",
  },
  {
    key: "agreedRescheduleLimit",
    label: "Appointments may be rescheduled up to 3 times; the deposit is forfeited on the 3rd reschedule.",
  },
  {
    key: "agreedExpiration",
    label: "Deposits expire one year after the date they were created.",
  },
  {
    key: "agreedIdAndVoucher",
    label: "Client must bring a government-issued ID and the Deposit Voucher (issued after payment) on the day of the appointment.",
  },
  {
    key: "agreedAge18",
    label: "Client reconfirms they are at least 18 years of age.",
  },
] as const;

const TERM_KEYS = TERMS.map((t) => t.key);

function isExpiredOrInvalid(depositForm: { signedAt: Date | null; tokenExpiresAt: Date } | null) {
  if (!depositForm) {
    return { code: "invalid", error: "This link is invalid." } as const;
  }

  if (depositForm.signedAt) {
    return { code: "already_signed", error: "This deposit form has already been signed." } as const;
  }

  if (depositForm.tokenExpiresAt < new Date()) {
    return { code: "expired", error: "This link has expired." } as const;
  }

  return null;
}

// Public: same pattern as consent form / estimate links.
const publicRouter = Router();

publicRouter.get("/verify/:token", async (req, res) => {
  const token = req.params.token as string;

  const depositForm = await prisma.depositForm.findUnique({
    where: { token },
    include: {
      inquiry: {
        include: {
          client: true,
          studio: true,
          assignedArtist: { include: { user: true } },
          appointment: true,
        },
      },
    },
  });

  const invalidity = isExpiredOrInvalid(depositForm);
  if (invalidity) {
    const status = invalidity.code === "invalid" ? 404 : 410;
    return res.status(status).json(invalidity);
  }

  const { inquiry } = depositForm!;

  res.json({
    clientFirstName: inquiry.client.firstName,
    studioName: inquiry.studio.name,
    artistName: inquiry.assignedArtist?.user.name ?? null,
    artistAvatarUrl: inquiry.assignedArtist?.user.avatarUrl ?? null,
    appointmentStart: inquiry.appointment?.startTime ?? null,
    appointmentEnd: inquiry.appointment?.endTime ?? null,
    // Purely informational -- only meaningful once there's no real
    // appointment yet (a real one always takes precedence in the UI).
    proposedStartAt: depositForm!.proposedStartAt,
    proposedEndAt: depositForm!.proposedEndAt,
    depositAmount: depositForm!.depositAmount,
    feeAmount: depositForm!.feeAmount,
    totalCharged: depositForm!.totalCharged,
    terms: TERMS,
  });
});

publicRouter.patch("/sign/:token", async (req, res) => {
  const token = req.params.token as string;
  const body = req.body ?? {};
  const { signatureName, signatureData } = body;

  const depositForm = await prisma.depositForm.findUnique({ where: { token } });

  const invalidity = isExpiredOrInvalid(depositForm);
  if (invalidity) {
    const status = invalidity.code === "invalid" ? 404 : 410;
    return res.status(status).json(invalidity);
  }

  const allAgreed = TERM_KEYS.every((key) => body[key] === true);
  if (!allAgreed) {
    return res.status(400).json({ error: "All terms must be agreed to." });
  }

  if (typeof signatureName !== "string" || signatureName.trim().length === 0) {
    return res.status(400).json({ error: "signatureName is required" });
  }

  if (typeof signatureData !== "string" || signatureData.trim().length === 0) {
    return res.status(400).json({ error: "signatureData is required" });
  }

  await prisma.depositForm.update({
    where: { id: depositForm!.id },
    data: {
      agreedNonRefundable: true,
      agreedLatePolicy: true,
      agreedNoShowForfeit: true,
      agreedNewDepositAfterNoShow: true,
      agreedRescheduleLimit: true,
      agreedExpiration: true,
      agreedIdAndVoucher: true,
      agreedAge18: true,
      signatureName: signatureName.trim(),
      signatureData,
      signedAt: new Date(),
    },
  });

  res.json({ success: true });
});

// Staff-facing: marking a deposit paid is a separate, authenticated step
// from the client signing -- money hasn't necessarily moved yet at sign
// time, this is what confirms it actually has.
const staffRouter = Router();

// Deposits ARE gift cards: paying one issues a gift card for the same tier
// amount the deposit form shows (depositAmount, not totalCharged -- the fee
// isn't part of what the client redeems later). The inquiry moves to
// SCHEDULING rather than CONFIRMED -- an appointment can't be created
// without an attached gift card (Phase 3), so scheduling has to come after
// the card exists, not before.
staffRouter.patch("/:id/mark-paid", requireAuth, requireRole(Role.OWNER, Role.FRONT_DESK), async (req, res) => {
  const id = req.params.id as string;

  const depositForm = await prisma.depositForm.findUnique({ where: { id }, include: { inquiry: true } });
  if (!depositForm || depositForm.inquiry.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Deposit form not found" });
  }

  if (!depositForm.signedAt) {
    return res.status(400).json({ error: "This deposit form has not been signed yet" });
  }

  if (depositForm.paidManually) {
    return res.status(400).json({ error: "This deposit has already been marked as paid" });
  }

  // Guards against a double-issue if this route were ever somehow called
  // twice for the same deposit -- paidManually already guards it above, but
  // this is the more direct invariant for the gift card itself.
  if (depositForm.giftCardId) {
    return res.status(400).json({ error: "A gift card has already been issued for this deposit" });
  }

  const paidAt = new Date();
  const studioId = req.user!.studioId;

  const [studioSettings, code] = await Promise.all([
    prisma.studioSettings.findUnique({ where: { studioId } }),
    generateUniqueGiftCardCode(),
  ]);

  const { giftCard, updatedDepositForm } = await prisma.$transaction(async (tx) => {
    const giftCard = await tx.giftCard.create({
      data: {
        studioId,
        clientId: depositForm.inquiry.clientId,
        code,
        amountCents: dollarsToCents(depositForm.depositAmount),
        expiresAt: computeGiftCardExpiration(studioSettings?.giftCardDefaultExpirationDays ?? null),
        issuedById: req.user!.userId,
      },
    });

    const updatedDepositForm = await tx.depositForm.update({
      where: { id },
      data: { paidManually: true, paidAt, giftCardId: giftCard.id },
    });

    await tx.inquiry.update({ where: { id: depositForm.inquiryId }, data: { status: InquiryStatus.SCHEDULING } });

    return { giftCard, updatedDepositForm };
  });

  await logAudit({
    studioId,
    actorUserId: req.user!.userId,
    entityType: "DepositForm",
    entityId: id,
    action: "gift_card_issued_from_deposit",
    changes: { depositFormId: id, giftCardId: giftCard.id, amountCents: giftCard.amountCents },
  });

  await logAudit({
    studioId,
    actorUserId: req.user!.userId,
    entityType: "Inquiry",
    entityId: depositForm.inquiryId,
    action: "status_change",
    changes: diffObjects(depositForm.inquiry, { status: InquiryStatus.SCHEDULING }, ["status"]),
  });

  res.json({ ...updatedDepositForm, giftCardId: giftCard.id });
});

export { publicRouter, staffRouter };
