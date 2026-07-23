import { Router } from "express";
import { prisma } from "../lib/prisma";
import { InquiryStatus, Role } from "../../generated/prisma/enums";
import { requireAuth, requireRole } from "../middleware/auth";
import { diffObjects, logAudit } from "../lib/audit";
import { dollarsToCents } from "../lib/money";
import { computeGiftCardExpiration, generateUniqueGiftCardCode } from "../lib/giftCards";
import { DEFAULT_THEME_PRESET } from "../lib/themePresets";
import { getOrCreateClientConversation } from "../lib/conversations";
import { sendClientSms } from "../lib/clientSms";
import { shortenUrl } from "../lib/shortLinks";
import { PUBLIC_APP_URL } from "../lib/publicUrl";

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
          studio: { include: { settings: { select: { themePreset: true } } } },
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
    studioSlug: inquiry.studio.slug,
    themePreset: inquiry.studio.settings?.themePreset ?? DEFAULT_THEME_PRESET,
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
  const clientId = depositForm.inquiry.clientId;

  const [studioSettings, code] = await Promise.all([
    prisma.studioSettings.findUnique({ where: { studioId } }),
    generateUniqueGiftCardCode(),
  ]);

  // Package M: this deposit form might belong to session 2+ of a project
  // that already converted (and has been scheduling/confirming/completing
  // sessions ever since) -- only the very first deposit form ever paid for
  // an inquiry actually converts it. A later session's payment issues its
  // own gift card the exact same way, but must never force the inquiry
  // backward to SCHEDULING if it's already moved on further than that.
  const isFirstConversion = depositForm.inquiry.status === InquiryStatus.DEPOSIT_PENDING;

  // Package O: a referral reward is a one-time event tied to THIS client's
  // first-ever paid deposit (across every inquiry they have, not just this
  // one) -- reads the client's own referral fields and the reward gift
  // card code up front, but the actual eligibility re-check happens fresh
  // inside the transaction below, right before writing, to keep the
  // check-then-act window as tight as possible.
  const referredClient = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, firstName: true, referredByClientId: true, referralRewardIssuedAt: true },
  });
  const referrerCandidate =
    referredClient?.referredByClientId && !referredClient.referralRewardIssuedAt
      ? await prisma.client.findUnique({
          where: { id: referredClient.referredByClientId },
          select: { id: true, firstName: true, studioId: true },
        })
      : null;
  const referralRewardCode = referrerCandidate ? await generateUniqueGiftCardCode() : null;

  const { giftCard, updatedDepositForm, referralReward } = await prisma.$transaction(async (tx) => {
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

    if (isFirstConversion) {
      await tx.inquiry.update({ where: { id: depositForm.inquiryId }, data: { status: InquiryStatus.SCHEDULING } });
    }

    let referralReward: { giftCardId: string; code: string; amountCents: number; referrerClientId: string } | null =
      null;

    if (referrerCandidate && referrerCandidate.studioId === studioId) {
      // Re-read the guard fresh, inside the transaction, immediately before
      // deciding to issue -- narrows the race window from the outer check
      // above to essentially nothing. Both conditions (never rewarded yet,
      // and this really is their first paid deposit) must still hold.
      const freshClient = await tx.client.findUnique({
        where: { id: clientId },
        select: { referralRewardIssuedAt: true },
      });
      const priorPaidCount = await tx.depositForm.count({
        where: { inquiry: { clientId }, paidManually: true, NOT: { id } },
      });

      if (freshClient && !freshClient.referralRewardIssuedAt && priorPaidCount === 0) {
        const rewardGiftCard = await tx.giftCard.create({
          data: {
            studioId,
            clientId: referrerCandidate.id,
            code: referralRewardCode!,
            amountCents: studioSettings?.referralRewardAmountCents ?? 2500,
            expiresAt: computeGiftCardExpiration(studioSettings?.giftCardDefaultExpirationDays ?? null),
            issuedById: req.user!.userId,
          },
        });

        await tx.client.update({
          where: { id: clientId },
          data: { referralRewardIssuedAt: new Date(), referralRewardGiftCardId: rewardGiftCard.id },
        });

        referralReward = {
          giftCardId: rewardGiftCard.id,
          code: rewardGiftCard.code,
          amountCents: rewardGiftCard.amountCents,
          referrerClientId: referrerCandidate.id,
        };
      }
    }

    return { giftCard, updatedDepositForm, referralReward };
  });

  await logAudit({
    studioId,
    actorUserId: req.user!.userId,
    entityType: "DepositForm",
    entityId: id,
    action: "gift_card_issued_from_deposit",
    changes: { depositFormId: id, giftCardId: giftCard.id, amountCents: giftCard.amountCents },
  });

  if (isFirstConversion) {
    await logAudit({
      studioId,
      actorUserId: req.user!.userId,
      entityType: "Inquiry",
      entityId: depositForm.inquiryId,
      action: "status_change",
      changes: diffObjects(depositForm.inquiry, { status: InquiryStatus.SCHEDULING }, ["status"]),
    });
  }

  if (referralReward) {
    await logAudit({
      studioId,
      actorUserId: req.user!.userId,
      entityType: "GiftCard",
      entityId: referralReward.giftCardId,
      action: "referral_reward_issued",
      changes: {
        referrerClientId: referralReward.referrerClientId,
        referredClientId: clientId,
        amountCents: referralReward.amountCents,
      },
    });
    await logAudit({
      studioId,
      actorUserId: req.user!.userId,
      entityType: "Client",
      entityId: clientId,
      action: "referral_reward_triggered",
      changes: { referrerClientId: referralReward.referrerClientId, giftCardId: referralReward.giftCardId },
    });

    // Package J's exact pattern: a real SMS, logged into the referrer's own
    // conversation thread, best-effort (a failed/skipped send never blocks
    // or rolls back the reward itself -- the gift card and audit trail
    // above are already real regardless of whether this text goes out).
    const studio = await prisma.studio.findUnique({ where: { id: studioId }, select: { name: true } });
    const amount = (referralReward.amountCents / 100).toFixed(2);
    const publicUrl = await shortenUrl(`${PUBLIC_APP_URL}/gift-card/${referralReward.code}`);
    const body = `Great news, ${referrerCandidate!.firstName}! ${referredClient!.firstName} just paid their deposit, so you've earned a $${amount} referral reward from ${studio?.name ?? "our studio"}: ${publicUrl} (code ${referralReward.code})`;

    const conversation = await getOrCreateClientConversation(studioId, referralReward.referrerClientId, req.user!.userId);
    await sendClientSms({
      studioId,
      clientId: referralReward.referrerClientId,
      conversationId: conversation.conversation.id,
      body,
      actorUserId: req.user!.userId,
    });
  }

  res.json({ ...updatedDepositForm, giftCardId: giftCard.id, referralReward });
});

export { publicRouter, staffRouter };
