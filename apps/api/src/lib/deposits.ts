import { prisma } from "./prisma";
import { InquiryStatus } from "../../generated/prisma/enums";
import { diffObjects, logAudit } from "./audit";
import { dollarsToCents } from "./money";
import { computeGiftCardExpiration, generateUniqueGiftCardCode } from "./giftCards";
import { getOrCreateClientConversation } from "./conversations";
import { sendClientSms } from "./clientSms";
import { shortenUrl } from "./shortLinks";
import { PUBLIC_APP_URL } from "./publicUrl";

export type PaidVia = "STRIPE" | "MANUAL";

export type IssueGiftCardResult =
  | { ok: true; giftCardId: string; alreadyProcessed: boolean }
  | { ok: false; error: string };

// Deposits ARE gift cards: paying one issues a gift card for the same tier
// amount the deposit form shows (depositAmount, not totalCharged -- the fee
// isn't part of what the client redeems later). The inquiry moves to
// SCHEDULING rather than CONFIRMED -- an appointment can't be created
// without an attached gift card (Phase 3), so scheduling has to come after
// the card exists, not before.
//
// Phase 7C: the ONE place this happens, called identically by both the
// staff-facing manual mark-paid route (routes/deposits.ts, paidVia:
// "MANUAL", a real authenticated actorUserId) and the Stripe webhook
// (routes/webhooks.ts, paidVia: "STRIPE", actorUserId: null -- no staff
// member took this action, same "system action" convention as every other
// webhook-triggered write in this codebase). Previously this whole body
// lived inline in the mark-paid route only; extracted here so a real Stripe
// payment issues its gift card through the exact same amount-conversion,
// referral-reward, and audit logic, not a second copy of it.
//
// Idempotent: a webhook retry (or, in principle, a double-click racing two
// requests) that lands here after the gift card already exists returns
// alreadyProcessed: true rather than an error -- callers that need to
// surface "already paid" as a client-facing 400 (the manual route) check
// for that themselves before ever calling this; the webhook, which has no
// user to show an error to, just treats it as a no-op success.
export async function issueGiftCardForPaidDeposit(
  depositFormId: string,
  paidVia: PaidVia,
  actorUserId: string | null,
): Promise<IssueGiftCardResult> {
  const depositForm = await prisma.depositForm.findUnique({
    where: { id: depositFormId },
    include: { inquiry: true },
  });

  if (!depositForm) {
    return { ok: false, error: "Deposit form not found" };
  }

  if (!depositForm.signedAt) {
    return { ok: false, error: "This deposit form has not been signed yet" };
  }

  if (depositForm.giftCardId) {
    return { ok: true, giftCardId: depositForm.giftCardId, alreadyProcessed: true };
  }

  const studioId = depositForm.inquiry.studioId;
  const clientId = depositForm.inquiry.clientId;
  const paidAt = new Date();

  const [studioSettings, code] = await Promise.all([
    prisma.studioSettings.findUnique({ where: { studioId } }),
    generateUniqueGiftCardCode(),
  ]);

  // Package M: this deposit form might belong to session 2+ of a project
  // that already converted -- only the very first deposit form ever paid
  // for an inquiry actually converts it.
  const isFirstConversion = depositForm.inquiry.status === InquiryStatus.DEPOSIT_PENDING;

  // Package O: a referral reward is a one-time event tied to THIS client's
  // first-ever paid deposit -- eligibility re-checked fresh inside the
  // transaction below, right before writing.
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
    // Re-checked fresh, inside the transaction, immediately before writing
    // -- narrows the double-issue race window (two near-simultaneous calls,
    // e.g. a genuine webhook retry landing while the first delivery's
    // transaction is still in flight) to essentially nothing.
    const fresh = await tx.depositForm.findUnique({ where: { id: depositFormId }, select: { giftCardId: true } });
    if (fresh?.giftCardId) {
      return { giftCard: null, updatedDepositForm: null, referralReward: null, alreadyProcessed: true as const };
    }

    const giftCard = await tx.giftCard.create({
      data: {
        studioId,
        clientId: depositForm.inquiry.clientId,
        code,
        amountCents: dollarsToCents(depositForm.depositAmount),
        expiresAt: computeGiftCardExpiration(studioSettings?.giftCardDefaultExpirationDays ?? null),
        issuedById: actorUserId,
        // paidVia's own values (STRIPE/MANUAL) predate GiftCardPaymentMethod
        // and stay as-is on DepositForm (a wider rename isn't this task's
        // scope) -- MANUAL maps to CASH here since a staff-confirmed
        // "paid outside Stripe" deposit is exactly what in-person cash
        // collection means; there's no other manual-payment concept
        // anywhere in this codebase.
        paymentMethod: paidVia === "STRIPE" ? "STRIPE" : "CASH",
      },
    });

    const updatedDepositForm = await tx.depositForm.update({
      where: { id: depositFormId },
      // paidManually stays the "is this deposit paid" flag every other
      // consumer of this schema (Kanban board, cold-lead/deposit-unpaid
      // tasks, reports) already reads -- set true for BOTH payment paths,
      // same as before this feature existed. paidVia is the new, more
      // precise descriptor for staff-facing UI clarity only.
      data: { paidManually: true, paidAt, giftCardId: giftCard.id, paidVia },
    });

    if (isFirstConversion) {
      await tx.inquiry.update({ where: { id: depositForm.inquiryId }, data: { status: InquiryStatus.SCHEDULING } });
    }

    let referralReward: { giftCardId: string; code: string; amountCents: number; referrerClientId: string } | null =
      null;

    if (referrerCandidate && referrerCandidate.studioId === studioId) {
      const freshClient = await tx.client.findUnique({
        where: { id: clientId },
        select: { referralRewardIssuedAt: true },
      });
      const priorPaidCount = await tx.depositForm.count({
        where: { inquiry: { clientId }, paidManually: true, NOT: { id: depositFormId } },
      });

      if (freshClient && !freshClient.referralRewardIssuedAt && priorPaidCount === 0) {
        const rewardGiftCard = await tx.giftCard.create({
          data: {
            studioId,
            clientId: referrerCandidate.id,
            code: referralRewardCode!,
            amountCents: studioSettings?.referralRewardAmountCents ?? 2500,
            expiresAt: computeGiftCardExpiration(studioSettings?.giftCardDefaultExpirationDays ?? null),
            issuedById: actorUserId,
            // paymentMethod deliberately left unset -- a promotional
            // referral reward, not a payment of any kind (not Stripe, not
            // cash collected, not a deposit exemption either). None of
            // this session's "no silent path" rule applies to a $0-cost
            // reward the studio is giving away, not collecting on.
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

    return { giftCard, updatedDepositForm, referralReward, alreadyProcessed: false as const };
  });

  if (!giftCard || !updatedDepositForm) {
    // The fresh re-check inside the transaction found a gift card already
    // issued (the narrow race window above) -- same idempotent no-op as
    // the pre-check at the top of this function.
    const refetched = await prisma.depositForm.findUnique({ where: { id: depositFormId }, select: { giftCardId: true } });
    return { ok: true, giftCardId: refetched!.giftCardId!, alreadyProcessed: true };
  }

  await logAudit({
    studioId,
    actorUserId,
    entityType: "DepositForm",
    entityId: depositFormId,
    action: "gift_card_issued_from_deposit",
    changes: { depositFormId, giftCardId: giftCard.id, amountCents: giftCard.amountCents, paidVia },
  });

  if (isFirstConversion) {
    await logAudit({
      studioId,
      actorUserId,
      entityType: "Inquiry",
      entityId: depositForm.inquiryId,
      action: "status_change",
      changes: diffObjects(depositForm.inquiry, { status: InquiryStatus.SCHEDULING }, ["status"]),
    });
  }

  if (referralReward) {
    await logAudit({
      studioId,
      actorUserId,
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
      actorUserId,
      entityType: "Client",
      entityId: clientId,
      action: "referral_reward_triggered",
      changes: { referrerClientId: referralReward.referrerClientId, giftCardId: referralReward.giftCardId },
    });

    const studio = await prisma.studio.findUnique({ where: { id: studioId }, select: { name: true } });
    const amount = (referralReward.amountCents / 100).toFixed(2);
    const publicUrl = await shortenUrl(`${PUBLIC_APP_URL}/gift-card/${referralReward.code}`);
    const body = `Great news, ${referrerCandidate!.firstName}! ${referredClient!.firstName} just paid their deposit, so you've earned a $${amount} referral reward from ${studio?.name ?? "our studio"}: ${publicUrl} (code ${referralReward.code})`;

    const conversation = await getOrCreateClientConversation(studioId, referralReward.referrerClientId, actorUserId);
    await sendClientSms({
      studioId,
      clientId: referralReward.referrerClientId,
      conversationId: conversation.conversation.id,
      body,
      actorUserId,
    });
  }

  return { ok: true, giftCardId: giftCard.id, alreadyProcessed: false };
}
