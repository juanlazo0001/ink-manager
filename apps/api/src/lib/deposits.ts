import crypto from "node:crypto";
import { prisma } from "./prisma";
import { InquiryStatus, AppointmentStatus, AppointmentType } from "../../generated/prisma/enums";
import { diffObjects, logAudit } from "./audit";
import { dollarsToCents } from "./money";
import { computeGiftCardExpiration, generateUniqueGiftCardCode } from "./giftCards";
import { getOrCreateClientConversation } from "./conversations";
import { sendClientSms } from "./clientSms";
import { shortenUrl } from "./shortLinks";
import { PUBLIC_APP_URL } from "./publicUrl";
import { getChargeableConnectedAccountId } from "./stripeConnect";
import { createDirectChargeCheckoutSession } from "./stripe";
import { findBufferConflict, resolveSchedulingBufferMs } from "./schedulingConflict";
import { resolveDepositAmounts, resolveDepositTiers } from "./depositTiers";
import { emitInvalidation } from "./realtime/registry";

export type PaidVia = "STRIPE" | "MANUAL";

const DEPOSIT_TOKEN_TTL_HOURS = 48;

// Mirrors inquiries.ts's own PROJECT_STATUSES exactly (SCHEDULING/
// WAITLISTED/CONFIRMED) -- duplicated as a literal here rather than
// imported, since that constant lives in a route file and a lib module
// importing from a route would invert this codebase's usual dependency
// direction. DEPOSIT_PENDING is deliberately not included, same reasoning
// as inquiries.ts's own comment on PROJECT_STATUSES: it's checked
// separately below.
const DEPOSIT_FORM_ALLOWED_STATUSES: InquiryStatus[] = [
  InquiryStatus.SCHEDULING,
  InquiryStatus.WAITLISTED,
  InquiryStatus.CONFIRMED,
];

export interface GenerateAndSendDepositFormOptions {
  studioId: string;
  actorUserId: string;
  proposedStartAt?: string;
  proposedEndAt?: string;
  autoSend?: boolean;
  plannedSessionId?: string;
}

export type GenerateAndSendDepositFormResult =
  | {
      ok: true;
      depositForm: Awaited<ReturnType<typeof prisma.depositForm.create>>;
      depositUrl: string;
      depositSendResult: Awaited<ReturnType<typeof sendClientSms>> | null;
    }
  | { ok: false; status: number; error: string };

// Extracted from POST /inquiries/:id/deposit-form (Package M) so a second
// caller -- the front-desk approval flow's APPROVE action (routes/
// appointments.ts), confirming a client's self-scheduled REQUESTED
// appointment -- generates and sends a deposit form through the EXACT
// same path (same token/expiry minting, same amount math, same real-SMS
// auto-send, same Conversations logging) rather than a second copy of it.
// Same "called identically by two call sites" precedent as
// issueGiftCardForPaidDeposit above. Auth/permission checks stay at each
// route's own middleware layer -- this function trusts studioId/
// actorUserId as already-authenticated.
export async function generateAndSendDepositForm(
  inquiryId: string,
  opts: GenerateAndSendDepositFormOptions,
): Promise<GenerateAndSendDepositFormResult> {
  const { studioId, actorUserId, proposedStartAt, proposedEndAt, autoSend, plannedSessionId } = opts;

  const inquiry = await prisma.inquiry.findUnique({
    where: { id: inquiryId },
    include: {
      depositForms: { orderBy: { sessionNumber: "desc" }, take: 1 },
      client: true,
      service: true,
      plannedSessions: true,
    },
  });
  if (!inquiry || inquiry.studioId !== studioId) {
    return { ok: false, status: 404, error: "Inquiry not found" };
  }

  if (inquiry.status !== InquiryStatus.DEPOSIT_PENDING && !DEPOSIT_FORM_ALLOWED_STATUSES.includes(inquiry.status)) {
    return {
      ok: false,
      status: 400,
      error: "A deposit form can only be sent while DEPOSIT_PENDING or after the inquiry has converted to a Project",
    };
  }

  if (!inquiry.assignedArtistId) {
    return { ok: false, status: 400, error: "Assign an artist before requesting a deposit" };
  }

  if (inquiry.priceEstimateLow == null || inquiry.priceEstimateHigh == null) {
    return { ok: false, status: 400, error: "This inquiry is missing a price estimate" };
  }

  let plannedSession: (typeof inquiry.plannedSessions)[number] | null = null;
  if (plannedSessionId !== undefined) {
    plannedSession = inquiry.plannedSessions.find((s) => s.id === plannedSessionId) ?? null;
    if (!plannedSession) {
      return { ok: false, status: 400, error: "plannedSessionId must belong to this project's session plan" };
    }
  }

  let latest: { id: string; signedAt: Date | null; sessionNumber: number } | undefined;
  let isNewSession: boolean;
  let sessionNumber: number;

  if (plannedSession) {
    if (plannedSession.depositFormId) {
      const linkedForm = await prisma.depositForm.findUnique({ where: { id: plannedSession.depositFormId } });
      if (linkedForm?.signedAt) {
        return { ok: false, status: 400, error: "This planned session's deposit form has already been signed" };
      }
      latest = linkedForm ?? undefined;
    }
    isNewSession = !latest;
    sessionNumber = plannedSession.sessionNumber;
  } else {
    latest = inquiry.depositForms[0];
    isNewSession = !latest || latest.signedAt != null;
    sessionNumber = (latest?.sessionNumber ?? 0) + 1;
  }

  let proposedStart: Date | null = null;
  let proposedEnd: Date | null = null;
  if (isNewSession) {
    if (typeof proposedStartAt !== "string" || typeof proposedEndAt !== "string") {
      return { ok: false, status: 400, error: "A tentative appointment time is required before generating a deposit form" };
    }
    proposedStart = new Date(proposedStartAt);
    proposedEnd = new Date(proposedEndAt);
    if (Number.isNaN(proposedStart.getTime()) || Number.isNaN(proposedEnd.getTime()) || proposedStart >= proposedEnd) {
      return { ok: false, status: 400, error: "proposedStartAt must be a valid date before proposedEndAt" };
    }
  }

  const settings = await prisma.studioSettings.findUnique({ where: { studioId } });
  const tiers = resolveDepositTiers(settings?.depositTiers);

  const average = (inquiry.priceEstimateLow + inquiry.priceEstimateHigh) / 2;
  const { depositAmount, totalCharged } = resolveDepositAmounts(inquiry.service, average, tiers, settings?.depositFeeCents);
  const feeAmount = totalCharged - depositAmount;

  const token = crypto.randomBytes(32).toString("hex");
  const tokenExpiresAt = new Date(Date.now() + DEPOSIT_TOKEN_TTL_HOURS * 60 * 60 * 1000);

  const depositForm = isNewSession
    ? await prisma.depositForm.create({
        data: {
          inquiryId,
          sessionNumber,
          token,
          tokenExpiresAt,
          depositAmount,
          feeAmount,
          totalCharged,
          proposedStartAt: proposedStart,
          proposedEndAt: proposedEnd,
        },
      })
    : await prisma.depositForm.update({
        where: { id: latest!.id },
        data: { token, tokenExpiresAt, depositAmount, feeAmount, totalCharged },
      });

  if (plannedSession && isNewSession) {
    await prisma.plannedSession.update({ where: { id: plannedSession.id }, data: { depositFormId: depositForm.id } });
  }

  const depositUrl = await shortenUrl(`${PUBLIC_APP_URL}/deposit/${token}`);

  let depositSendResult: Awaited<ReturnType<typeof sendClientSms>> | null = null;
  if (autoSend !== false) {
    const studio = await prisma.studio.findUnique({ where: { id: studioId }, select: { name: true } });
    depositSendResult = await sendClientSms({
      studioId,
      clientId: inquiry.clientId,
      conversationId: (await getOrCreateClientConversation(studioId, inquiry.clientId, actorUserId)).conversation.id,
      body: `Hi ${inquiry.client.firstName}, here's your deposit form to secure your appointment with ${studio?.name ?? "our studio"}: ${depositUrl} (expires in 48 hours)`,
      actorUserId,
    });
  }

  // Real-time audit gap, found while extracting this function: the
  // original inline route never broadcast anything -- another staff
  // member with this same project open never saw a freshly generated/
  // resent deposit form appear live. Fixed here rather than left alone,
  // since this is the exact function both the manual button and the new
  // approve flow now share, and "every mutation broadcasts" is this
  // feature's own standing rule.
  emitInvalidation({ type: "inquiry.updated", studioId, inquiryId });

  return { ok: true, depositForm, depositUrl, depositSendResult };
}

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

  // Master on/off for the whole referral program -- default true (matches
  // today's always-on behavior). Off means no NEW reward is ever issued,
  // even for a referredByClientId relationship that already existed
  // before the studio turned this off -- checked first, before any of the
  // eligibility lookups below even run.
  const referralProgramEnabled = studioSettings?.referralProgramEnabled ?? true;

  // Package O: a referral reward is a one-time event tied to THIS client's
  // first-ever paid deposit -- eligibility re-checked fresh inside the
  // transaction below, right before writing. This is just a cheap early
  // out (skip generating a referrer/reward code at all when obviously not
  // eligible); it must apply the exact same referralAllowRepeatRedemption-
  // aware rule the transaction's own gate does below, or a studio with
  // repeat redemption ON would incorrectly short-circuit here every time
  // after the first-ever reward, before the transaction's gate ever got a
  // chance to allow a later project's own reward through.
  const referredClient = referralProgramEnabled
    ? await prisma.client.findUnique({
        where: { id: clientId },
        select: { id: true, firstName: true, referredByClientId: true, referralRewardIssuedAt: true },
      })
    : null;
  const repeatRedemptionAllowed = studioSettings?.referralAllowRepeatRedemption ?? false;
  const referrerCandidate =
    referredClient?.referredByClientId && (repeatRedemptionAllowed || !referredClient.referralRewardIssuedAt)
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

      // Settings "repeat redemption" toggle (default false, matching this
      // gate's original one-time-ever behavior exactly; repeatRedemptionAllowed
      // computed once, above, from the same studioSettings this whole
      // function already fetched -- also gates the referrerCandidate
      // short-circuit above, which must agree with this gate or a repeat
      // reward could never reach this code at all). Off: scope stays
      // studio-wide across every one of this client's inquiries, and
      // referralRewardIssuedAt is a permanent once-set guard -- a specific
      // referred client's relationship with their referrer earns a reward
      // at most once, ever. On: referralRewardIssuedAt no longer blocks by
      // itself, and priorPaidCount narrows to THIS inquiry only -- so a
      // later, separate project (a new Inquiry) from the same referred
      // client can earn their referrer another reward on that project's
      // own first paid deposit, without capping the referred client to a
      // single reward-triggering deposit for their entire history. Either
      // way, this only governs the SAME redeemer's own reuse -- how many
      // different people can use one code is unrelated and always unlimited.
      const priorPaidCount = await tx.depositForm.count({
        where: {
          inquiry: { clientId, ...(repeatRedemptionAllowed ? { id: depositForm.inquiryId } : {}) },
          paidManually: true,
          NOT: { id: depositFormId },
        },
      });

      const blockedByPriorReward = !repeatRedemptionAllowed && Boolean(freshClient?.referralRewardIssuedAt);

      if (freshClient && !blockedByPriorReward && priorPaidCount === 0) {
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

  // Auto-book: the deposit page lets a client pick a tentative time
  // (proposedStartAt/proposedEndAt, staff-picked from getSuggestedTimes --
  // see POST /:id/deposit-form) as part of paying, but until now that
  // tentative pick was purely informational and never became a real
  // Appointment on its own; staff had to notice the paid deposit and book
  // it by hand. Re-runs the exact same buffer/conflict check every other
  // booking route already uses (findBufferConflict) -- time has passed
  // since the tentative pick, so another appointment could have taken the
  // slot in the meantime. Independent per deposit form/session: only ever
  // books or flags THIS one, regardless of what state any other session of
  // the same project is in.
  //
  // No schema change: a conflict is never persisted as its own flag --
  // "auto-booking failed here" is derived purely from existing columns (a
  // paid, proposed-time-bearing deposit form with no linked appointment
  // yet). See lib/tasks/schedulingConflict.ts, the other place that same
  // derivation happens (the front-desk task/notification for this).
  if (depositForm.proposedStartAt && depositForm.proposedEndAt) {
    const [plannedSession, freshInquiry] = await Promise.all([
      prisma.plannedSession.findUnique({
        where: { depositFormId },
        select: { id: true, appointmentId: true },
      }),
      prisma.inquiry.findUnique({
        where: { id: depositForm.inquiryId },
        select: { appointmentId: true, assignedArtistId: true, clientId: true },
      }),
    ]);

    // Already booked -- e.g. staff manually booked this exact session in
    // the narrow window between the client signing and this payment
    // confirming. Never double-book on top of that.
    //
    // Front-desk approval, Part 2: the un-planned (!plannedSession) branch
    // used to be able to assume freshInquiry.appointmentId was always null
    // here -- true for the classic flow, where no real Appointment exists
    // until THIS auto-book creates one. That stopped holding once a client
    // could self-schedule their own REQUESTED appointment, then staff
    // approves it (setting Inquiry.appointmentId) and generates this exact
    // deposit form with proposedStartAt/EndAt equal to that already-real
    // appointment's own time -- without this OR, a later payment would
    // find plannedSession null, alreadyBooked false, and create a SECOND,
    // duplicate Appointment for the same slot alongside the real one.
    const alreadyBooked = plannedSession ? plannedSession.appointmentId != null : freshInquiry?.appointmentId != null;

    if (freshInquiry?.assignedArtistId && !alreadyBooked) {
      const assignedArtist = await prisma.artist.findUnique({
        where: { id: freshInquiry.assignedArtistId },
        select: { schedulingBufferMinutes: true },
      });
      const conflict = await findBufferConflict(
        freshInquiry.assignedArtistId,
        depositForm.proposedStartAt,
        depositForm.proposedEndAt,
        undefined,
        resolveSchedulingBufferMs(assignedArtist?.schedulingBufferMinutes, studioSettings?.schedulingBufferMinutes),
      );

      if (!conflict) {
        const appointment = await prisma.$transaction(async (tx) => {
          const created = await tx.appointment.create({
            data: {
              studioId,
              artistId: freshInquiry.assignedArtistId!,
              clientId: freshInquiry.clientId,
              inquiryId: depositForm.inquiryId,
              startTime: depositForm.proposedStartAt!,
              endTime: depositForm.proposedEndAt!,
              status: AppointmentStatus.CONFIRMED,
              appointmentType: AppointmentType.TATTOO_SESSION,
            },
          });

          await tx.giftCard.update({ where: { id: giftCard.id }, data: { appointmentId: created.id } });

          if (plannedSession) {
            await tx.plannedSession.update({ where: { id: plannedSession.id }, data: { appointmentId: created.id } });
          }

          // Only the FIRST appointment a project ever gets fills this
          // singular, legacy 1:1 slot (see POST /inquiries/:id/schedule) --
          // a later session (planned or not) still shows up correctly via
          // the Appointment.inquiryId 1:many relation, which
          // deriveProjectStage/projectNeedsScheduling (apps/web/src/lib/
          // kanban.ts) already OR in alongside this field, so leaving it
          // untouched for session 2+ is correct, not a gap.
          if (!freshInquiry.appointmentId) {
            await tx.inquiry.update({
              where: { id: depositForm.inquiryId },
              data: { appointmentId: created.id, status: InquiryStatus.CONFIRMED },
            });
          }

          return created;
        });

        await logAudit({
          studioId,
          actorUserId,
          entityType: "Inquiry",
          entityId: depositForm.inquiryId,
          action: "auto_booked_from_deposit",
          changes: { startTime: appointment.startTime, endTime: appointment.endTime },
        });

        emitInvalidation({ type: "appointment.changed", studioId });
      } else {
        await logAudit({
          studioId,
          actorUserId,
          entityType: "Inquiry",
          entityId: depositForm.inquiryId,
          action: "auto_book_conflict",
          changes: { proposedStartAt: depositForm.proposedStartAt, proposedEndAt: depositForm.proposedEndAt },
        });
      }
    }
  }

  return { ok: true, giftCardId: giftCard.id, alreadyProcessed: false };
}

export type CreateDepositCheckoutSessionResult =
  | { ok: true; url: string }
  | { ok: false; status: number; error: string };

// Phase 7D: the ONE place a Stripe Checkout Session gets created for a
// deposit -- called both by the public post-signing flow (routes/deposits.ts
// publicRouter, right after signing and again if the client abandons
// Stripe's page and retries) and by staff's own "get/resend payment link"
// action (same file's staffRouter, for when the client navigated away
// entirely and needs the link handed back to them another way). Sharing
// this means both paths get identical validation and session-creation
// logic, not two near-copies of it. A fresh session is generated every
// call, never reused -- Checkout Sessions expire on Stripe's own schedule,
// so there's no stale one worth resurrecting.
export async function createDepositCheckoutSession(depositFormId: string): Promise<CreateDepositCheckoutSessionResult> {
  const depositForm = await prisma.depositForm.findUnique({
    where: { id: depositFormId },
    include: { inquiry: { select: { studioId: true } } },
  });

  if (!depositForm) {
    return { ok: false, status: 404, error: "This deposit form was not found." };
  }

  if (depositForm.paidVia) {
    return { ok: false, status: 400, error: "This deposit has already been paid." };
  }

  if (!depositForm.signedAt) {
    return { ok: false, status: 400, error: "Please sign the deposit agreement first." };
  }

  const stripeAccountId = await getChargeableConnectedAccountId(depositForm.inquiry.studioId);
  if (!stripeAccountId) {
    return { ok: false, status: 400, error: "Online payment isn't available for this studio right now." };
  }

  const totalCents = Math.round(depositForm.totalCharged * 100);

  let session;
  try {
    session = await createDirectChargeCheckoutSession({
      connectedAccountId: stripeAccountId,
      amountCents: totalCents,
      productName: "Deposit",
      successUrl: `${PUBLIC_APP_URL}/deposit/${depositForm.token}?paid=1`,
      cancelUrl: `${PUBLIC_APP_URL}/deposit/${depositForm.token}?canceled=1`,
      metadata: { depositFormId: depositForm.id },
    });
  } catch (err) {
    return { ok: false, status: 502, error: err instanceof Error ? err.message : "Failed to start Stripe checkout" };
  }

  await prisma.depositForm.update({
    where: { id: depositForm.id },
    data: { stripeCheckoutSessionId: session.id },
  });

  return { ok: true, url: session.url };
}
