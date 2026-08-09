import { prisma } from "./prisma";
import { InquiryStatus } from "../../generated/prisma/enums";
import { computeApplicationFeeCents, createDirectChargeCheckoutSession, createOrRetrieveDirectChargePaymentIntent } from "./stripe";
import { getChargeableConnectedAccountId } from "./stripeConnect";
import { PUBLIC_APP_URL } from "./publicUrl";

export type CreateFlashCheckoutSessionResult =
  | { ok: true; url: string }
  | { ok: false; status: number; error: string };

// Flash gallery, Part 3: the ONE place a Stripe Checkout Session gets
// created for a flash booking's full prepayment -- called both by the
// public payment page (right after GET /flash-payment/verify/:token loads,
// and again if the client abandons Stripe's page and retries) and, in
// principle, by a future staff-facing resend action, same shared-function
// reasoning as lib/deposits.ts's own createDepositCheckoutSession. A fresh
// session is generated every call, never reused -- Checkout Sessions
// expire on Stripe's own schedule, so there's nothing stale worth
// resurrecting.
export async function createFlashPaymentCheckoutSession(inquiryId: string): Promise<CreateFlashCheckoutSessionResult> {
  const inquiry = await prisma.inquiry.findUnique({
    where: { id: inquiryId },
    include: { flashPiece: true },
  });

  if (!inquiry || !inquiry.flashPiece) {
    return { ok: false, status: 404, error: "This flash booking was not found." };
  }

  if (inquiry.flashPaidAt) {
    return { ok: false, status: 400, error: "This flash booking has already been paid." };
  }

  if (inquiry.status !== InquiryStatus.FLASH_PAYMENT_PENDING) {
    return { ok: false, status: 400, error: "This flash booking isn't awaiting payment." };
  }

  const stripeAccountId = await getChargeableConnectedAccountId(inquiry.studioId);
  if (!stripeAccountId) {
    return { ok: false, status: 400, error: "Online payment isn't available for this studio right now." };
  }

  let session;
  try {
    session = await createDirectChargeCheckoutSession({
      connectedAccountId: stripeAccountId,
      amountCents: inquiry.flashPiece.priceCents,
      productName: inquiry.flashPiece.title,
      successUrl: `${PUBLIC_APP_URL}/flash-payment/${inquiry.flashPaymentToken}?paid=1`,
      cancelUrl: `${PUBLIC_APP_URL}/flash-payment/${inquiry.flashPaymentToken}?canceled=1`,
      metadata: { inquiryId: inquiry.id, flashPieceId: inquiry.flashPiece.id },
    });
  } catch (err) {
    return { ok: false, status: 502, error: err instanceof Error ? err.message : "Failed to start Stripe checkout" };
  }

  await prisma.inquiry.update({
    where: { id: inquiry.id },
    data: { stripeCheckoutSessionId: session.id },
  });

  return { ok: true, url: session.url };
}

export type CreateFlashPaymentIntentResult =
  | { ok: true; clientSecret: string; connectedAccountId: string }
  | { ok: false; status: number; error: string };

// Embedded payments migration: the Payment Element sibling of
// createFlashPaymentCheckoutSession above -- same validation, gated
// additionally on StudioSettings.embeddedPaymentsEnabled (default off,
// hosted Checkout stays the only path otherwise), fetch-or-create instead
// of always-create (see createOrRetrieveDirectChargePaymentIntent's own
// comment in lib/stripe.ts).
export async function createOrRetrieveFlashPaymentIntent(inquiryId: string): Promise<CreateFlashPaymentIntentResult> {
  const inquiry = await prisma.inquiry.findUnique({
    where: { id: inquiryId },
    include: { flashPiece: true },
  });

  if (!inquiry || !inquiry.flashPiece) {
    return { ok: false, status: 404, error: "This flash booking was not found." };
  }

  if (inquiry.flashPaidAt) {
    return { ok: false, status: 400, error: "This flash booking has already been paid." };
  }

  if (inquiry.status !== InquiryStatus.FLASH_PAYMENT_PENDING) {
    return { ok: false, status: 400, error: "This flash booking isn't awaiting payment." };
  }

  const studioSettings = await prisma.studioSettings.findUnique({
    where: { studioId: inquiry.studioId },
    select: { embeddedPaymentsEnabled: true },
  });
  if (!studioSettings?.embeddedPaymentsEnabled) {
    return { ok: false, status: 400, error: "Embedded payment isn't enabled for this studio." };
  }

  const stripeAccountId = await getChargeableConnectedAccountId(inquiry.studioId);
  if (!stripeAccountId) {
    return { ok: false, status: 400, error: "Online payment isn't available for this studio right now." };
  }

  let intent;
  try {
    intent = await createOrRetrieveDirectChargePaymentIntent({
      connectedAccountId: stripeAccountId,
      existingPaymentIntentId: inquiry.stripePaymentIntentId,
      amountCents: inquiry.flashPiece.priceCents,
      applicationFeeCents: computeApplicationFeeCents(inquiry.flashPiece.priceCents),
      metadata: { inquiryId: inquiry.id, flashPieceId: inquiry.flashPiece.id },
    });
  } catch (err) {
    return { ok: false, status: 502, error: err instanceof Error ? err.message : "Failed to start payment" };
  }

  if (intent.id !== inquiry.stripePaymentIntentId) {
    await prisma.inquiry.update({
      where: { id: inquiry.id },
      data: { stripePaymentIntentId: intent.id },
    });
  }

  return { ok: true, clientSecret: intent.clientSecret, connectedAccountId: stripeAccountId };
}
