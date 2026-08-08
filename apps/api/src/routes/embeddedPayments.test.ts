// Embedded payments migration (explore/embedded-payments branch), Part 2:
// embedded deposit payment. Covers the gating logic for
// POST /deposits/:token/payment-intent (flag off, no Stripe connected) and
// the payment_intent.succeeded webhook branch's dispatch/idempotency --
// the live Stripe test-mode evidence (real Payment Element, real test
// cards, 3DS, gift-card issuance, auto-book) is covered by the report's
// own live-browser walkthrough, not duplicated here as a live-network
// test. Everything here runs against real Prisma with no live Stripe API
// calls (webhook signature verification is pure local crypto against a
// test secret, no network involved).

import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { prisma } from "../lib/prisma";
import { getStripe } from "../lib/stripe";
import { IntegrationChannel, IntegrationStatus } from "../../generated/prisma/enums";
import { publicRouter as depositsPublicRouter } from "./deposits";
import webhooksRouter from "./webhooks";

const TEST_WEBHOOK_SECRET = "whsec_test_secret_for_embedded_payments_suite";

const suffix = `epwh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let server: http.Server;
let baseUrl: string;

const studioIds: string[] = [];
const userIds: string[] = [];
const clientIds: string[] = [];
const inquiryIds: string[] = [];
const serviceIds: string[] = [];
const intakeFormIds: string[] = [];

let originalWebhookSecret: string | undefined;

before(async () => {
  originalWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  process.env.STRIPE_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;

  const app = express();
  // Mirrors index.ts's own raw-body special-case for this exact path --
  // signature verification needs real bytes, not the parsed JSON every
  // other route gets.
  app.use((req, res, next) => {
    if (req.originalUrl === "/webhooks/stripe") {
      return express.raw({ type: "application/json" })(req, res, next);
    }
    return express.json()(req, res, next);
  });
  app.use("/deposits", depositsPublicRouter);
  app.use("/webhooks", webhooksRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (originalWebhookSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
  else process.env.STRIPE_WEBHOOK_SECRET = originalWebhookSecret;

  await prisma.depositForm.deleteMany({ where: { inquiryId: { in: inquiryIds } } });
  await prisma.giftCard.deleteMany({ where: { studioId: { in: studioIds } } });
  await prisma.inquiry.deleteMany({ where: { id: { in: inquiryIds } } });
  await prisma.clientEmail.deleteMany({ where: { clientId: { in: clientIds } } });
  await prisma.clientPhone.deleteMany({ where: { clientId: { in: clientIds } } });
  await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
  await prisma.service.deleteMany({ where: { id: { in: serviceIds } } });
  await prisma.intakeForm.deleteMany({ where: { id: { in: intakeFormIds } } });
  await prisma.studioIntegration.deleteMany({ where: { studioId: { in: studioIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.studioSettings.deleteMany({ where: { studioId: { in: studioIds } } });
  await prisma.auditLog.deleteMany({ where: { studioId: { in: studioIds } } });
  await prisma.studio.deleteMany({ where: { id: { in: studioIds } } });
});

async function makeStudioWithSignedDeposit(opts: { embeddedPaymentsEnabled: boolean; stripeConnected: boolean; tag: string }) {
  const studio = await prisma.studio.create({ data: { name: `EP Studio ${opts.tag} ${suffix}`, slug: `ep-${opts.tag}-${suffix}` } });
  studioIds.push(studio.id);
  await prisma.studioSettings.upsert({
    where: { studioId: studio.id },
    create: { studioId: studio.id, embeddedPaymentsEnabled: opts.embeddedPaymentsEnabled },
    update: { embeddedPaymentsEnabled: opts.embeddedPaymentsEnabled },
  });

  if (opts.stripeConnected) {
    await prisma.studioIntegration.create({
      data: {
        studioId: studio.id,
        channel: IntegrationChannel.STRIPE,
        status: IntegrationStatus.CONNECTED,
        metadata: { stripeAccountId: `acct_test_${opts.tag}_${suffix}`, chargesEnabled: true, payoutsEnabled: true },
      },
    });
  }

  const intakeForm = await prisma.intakeForm.create({ data: { studioId: studio.id, name: "Intake", slug: `${opts.tag}-${suffix}-intake` } });
  intakeFormIds.push(intakeForm.id);
  const service = await prisma.service.create({
    data: { studioId: studio.id, name: "Tattoo", slug: `${opts.tag}-${suffix}-tattoo`, pricingModel: "RANGE", depositModel: "TIER_BASED", intakeFormId: intakeForm.id },
  });
  serviceIds.push(service.id);
  const client = await prisma.client.create({ data: { studioId: studio.id, firstName: "EP", lastName: "Test", referralCode: `${opts.tag}-${suffix}-ref` } });
  clientIds.push(client.id);
  const inquiry = await prisma.inquiry.create({
    data: {
      studioId: studio.id,
      clientId: client.id,
      serviceId: service.id,
      channel: "EMAIL",
      description: "Embedded payments gating test",
      colorOrBlackGrey: "Color",
      placement: "Arm",
      estimatedSize: "Small",
      hasBeenTattooedBefore: false,
      referenceImages: [],
      placementImages: [],
      status: "DEPOSIT_PENDING",
    },
  });
  inquiryIds.push(inquiry.id);

  const depositForm = await prisma.depositForm.create({
    data: {
      inquiryId: inquiry.id,
      token: `${opts.tag}-${suffix}-token`,
      tokenExpiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      depositAmount: 100,
      feeAmount: 10,
      totalCharged: 110,
      signedAt: new Date(),
      signatureName: "EP Test",
      signatureData: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      agreedNonRefundable: true,
      agreedLatePolicy: true,
      agreedNoShowForfeit: true,
      agreedNewDepositAfterNoShow: true,
      agreedRescheduleLimit: true,
      agreedExpiration: true,
      agreedIdAndVoucher: true,
      agreedAge18: true,
    },
  });

  return { studio, inquiry, depositForm };
}

test("POST /:token/payment-intent is refused when embeddedPaymentsEnabled is off (the default)", async () => {
  const { depositForm } = await makeStudioWithSignedDeposit({ embeddedPaymentsEnabled: false, stripeConnected: true, tag: "flagoff" });

  const res = await fetch(`${baseUrl}/deposits/${depositForm.token}/payment-intent`, { method: "POST" });
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string };
  assert.match(body.error, /enabled/i);
});

test("POST /:token/payment-intent is refused when the studio has no Stripe connected, even with the flag on", async () => {
  const { depositForm } = await makeStudioWithSignedDeposit({ embeddedPaymentsEnabled: true, stripeConnected: false, tag: "noconnect" });

  const res = await fetch(`${baseUrl}/deposits/${depositForm.token}/payment-intent`, { method: "POST" });
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string };
  assert.match(body.error, /online payment/i);
});

test("GET /verify/:token exposes embeddedPaymentsEnabled, independent of the flag's own default", async () => {
  // stripeConnected: true here deliberately -- a signed-but-unpaid deposit
  // form at a studio with NO Stripe connected hits the pre-existing
  // "already signed" terminal state (isExpiredOrInvalid's own rule, not
  // something this migration changes), so this checks the flag's real
  // success-path shape instead of re-testing that unrelated rule.
  const { depositForm } = await makeStudioWithSignedDeposit({ embeddedPaymentsEnabled: true, stripeConnected: true, tag: "verifyflagon" });
  const res = await fetch(`${baseUrl}/deposits/verify/${depositForm.token}`);
  const body = (await res.json()) as { embeddedPaymentsEnabled: boolean; stripeConnected: boolean };
  assert.equal(body.embeddedPaymentsEnabled, true);
  assert.equal(body.stripeConnected, true);

  const { depositForm: depositFormOff } = await makeStudioWithSignedDeposit({ embeddedPaymentsEnabled: false, stripeConnected: true, tag: "verifyflagoff" });
  const resOff = await fetch(`${baseUrl}/deposits/verify/${depositFormOff.token}`);
  const bodyOff = (await resOff.json()) as { embeddedPaymentsEnabled: boolean };
  assert.equal(bodyOff.embeddedPaymentsEnabled, false, "default (unset) studio must report the flag off, not omit it");
});

test("webhook payment_intent.succeeded: finds the DepositForm by stripePaymentIntentId, issues the gift card, sets paidVia -- same downstream effect checkout.session.completed already produces", async () => {
  const { studio, inquiry, depositForm } = await makeStudioWithSignedDeposit({ embeddedPaymentsEnabled: true, stripeConnected: true, tag: "webhook" });
  const integration = await prisma.studioIntegration.findUniqueOrThrow({
    where: { studioId_channel: { studioId: studio.id, channel: IntegrationChannel.STRIPE } },
  });
  const connectedAccountId = (integration.metadata as { stripeAccountId: string }).stripeAccountId;

  const fakePaymentIntentId = `pi_test_${suffix}`;
  await prisma.depositForm.update({ where: { id: depositForm.id }, data: { stripePaymentIntentId: fakePaymentIntentId } });

  const eventPayload = {
    id: `evt_${suffix}`,
    object: "event",
    type: "payment_intent.succeeded",
    account: connectedAccountId,
    data: { object: { id: fakePaymentIntentId, object: "payment_intent", status: "succeeded" } },
  };
  const payloadString = JSON.stringify(eventPayload);
  const signature = getStripe().webhooks.generateTestHeaderString({ payload: payloadString, secret: TEST_WEBHOOK_SECRET });

  const res = await fetch(`${baseUrl}/webhooks/stripe`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "stripe-signature": signature },
    body: payloadString,
  });
  assert.equal(res.status, 200);

  const updated = await prisma.depositForm.findUniqueOrThrow({ where: { id: depositForm.id } });
  assert.equal(updated.paidVia, "STRIPE");
  assert.ok(updated.giftCardId, "a gift card must have been issued");

  const giftCard = await prisma.giftCard.findUniqueOrThrow({ where: { id: updated.giftCardId! } });
  assert.equal(giftCard.amountCents, Math.round(depositForm.depositAmount * 100));
  assert.equal(giftCard.status, "ACTIVE");

  const updatedInquiry = await prisma.inquiry.findUniqueOrThrow({ where: { id: inquiry.id } });
  assert.equal(updatedInquiry.status, "SCHEDULING", "first conversion must advance the inquiry status, same as the Checkout path");
});

test("webhook payment_intent.succeeded: replaying the same event is idempotent (no duplicate gift card, no error)", async () => {
  const { studio, depositForm } = await makeStudioWithSignedDeposit({ embeddedPaymentsEnabled: true, stripeConnected: true, tag: "idempotent" });
  const integration = await prisma.studioIntegration.findUniqueOrThrow({
    where: { studioId_channel: { studioId: studio.id, channel: IntegrationChannel.STRIPE } },
  });
  const connectedAccountId = (integration.metadata as { stripeAccountId: string }).stripeAccountId;

  const fakePaymentIntentId = `pi_test_replay_${suffix}`;
  await prisma.depositForm.update({ where: { id: depositForm.id }, data: { stripePaymentIntentId: fakePaymentIntentId } });

  const eventPayload = {
    id: `evt_replay_${suffix}`,
    object: "event",
    type: "payment_intent.succeeded",
    account: connectedAccountId,
    data: { object: { id: fakePaymentIntentId, object: "payment_intent", status: "succeeded" } },
  };
  const payloadString = JSON.stringify(eventPayload);
  const signature = getStripe().webhooks.generateTestHeaderString({ payload: payloadString, secret: TEST_WEBHOOK_SECRET });

  for (let i = 0; i < 2; i++) {
    const res = await fetch(`${baseUrl}/webhooks/stripe`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "stripe-signature": signature },
      body: payloadString,
    });
    assert.equal(res.status, 200);
  }

  const updated = await prisma.depositForm.findUniqueOrThrow({ where: { id: depositForm.id } });
  assert.ok(updated.giftCardId);
  const giftCardCount = await prisma.giftCard.count({ where: { id: updated.giftCardId! } });
  assert.equal(giftCardCount, 1, "replaying the same webhook event must not issue a second gift card");
});
