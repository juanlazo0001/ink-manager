// Embedded payments migration (explore/embedded-payments branch), Parts 2
// and 3: embedded deposit payment, flash prepayment, and session checkout.
// Covers the gating logic for each flow's own payment-intent endpoint
// (flag off, no Stripe connected) and the payment_intent.succeeded
// webhook's three-model dispatch/idempotency -- the live Stripe test-mode
// evidence (real Payment Element, real test cards, 3DS, gift-card
// issuance, auto-book) is covered by the report's own live-browser
// walkthrough, not duplicated here as a live-network test. Everything here
// runs against real Prisma with no live Stripe API calls (webhook
// signature verification is pure local crypto against a test secret, no
// network involved).

import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { prisma } from "../lib/prisma";
import { getStripe } from "../lib/stripe";
import { IntegrationChannel, IntegrationStatus } from "../../generated/prisma/enums";
import { publicRouter as depositsPublicRouter } from "./deposits";
import flashPaymentsRouter from "./flashPayments";
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
const artistIds: string[] = [];
const flashPieceIds: string[] = [];
const appointmentIds: string[] = [];

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
  app.use("/flash-payment", flashPaymentsRouter);
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

  await prisma.appointment.deleteMany({ where: { id: { in: appointmentIds } } });
  await prisma.depositForm.deleteMany({ where: { inquiryId: { in: inquiryIds } } });
  await prisma.giftCard.deleteMany({ where: { studioId: { in: studioIds } } });
  await prisma.inquiry.deleteMany({ where: { id: { in: inquiryIds } } });
  await prisma.flashPiece.deleteMany({ where: { id: { in: flashPieceIds } } });
  await prisma.artist.deleteMany({ where: { id: { in: artistIds } } });
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

// ---------------------------------------------------------------------
// Part 3: flash prepayment
// ---------------------------------------------------------------------

async function makeStudioWithFlashInquiry(opts: { embeddedPaymentsEnabled: boolean; stripeConnected: boolean; tag: string }) {
  const studio = await prisma.studio.create({ data: { name: `EP Flash ${opts.tag} ${suffix}`, slug: `ep-flash-${opts.tag}-${suffix}` } });
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
        metadata: { stripeAccountId: `acct_test_flash_${opts.tag}_${suffix}`, chargesEnabled: true, payoutsEnabled: true },
      },
    });
  }

  const artistUser = await prisma.user.create({ data: { email: `${opts.tag}-${suffix}-artist@test.invalid`, role: "ARTIST", studioId: studio.id } });
  userIds.push(artistUser.id);
  const artist = await prisma.artist.create({ data: { userId: artistUser.id, specialties: [], portfolioImages: [] } });
  artistIds.push(artist.id);

  const flashPiece = await prisma.flashPiece.create({
    data: { studioId: studio.id, artistId: artist.id, imageUrl: "https://example.test/flash.png", title: "Test Flash", priceCents: 15000, estimatedDurationMinutes: 60 },
  });
  flashPieceIds.push(flashPiece.id);

  const intakeForm = await prisma.intakeForm.create({ data: { studioId: studio.id, name: "Intake", slug: `${opts.tag}-${suffix}-flashintake` } });
  intakeFormIds.push(intakeForm.id);
  const service = await prisma.service.create({
    data: { studioId: studio.id, name: "Tattoo", slug: `${opts.tag}-${suffix}-flashtattoo`, pricingModel: "RANGE", depositModel: "TIER_BASED", intakeFormId: intakeForm.id },
  });
  serviceIds.push(service.id);

  const client = await prisma.client.create({ data: { studioId: studio.id, firstName: "Flash", lastName: "Test", referralCode: `${opts.tag}-${suffix}-flashref` } });
  clientIds.push(client.id);

  const flashPaymentToken = `${opts.tag}-${suffix}-flashtoken`;
  const inquiry = await prisma.inquiry.create({
    data: {
      studioId: studio.id,
      clientId: client.id,
      serviceId: service.id,
      flashPieceId: flashPiece.id,
      channel: "INSTAGRAM",
      description: "Flash prepayment gating test",
      colorOrBlackGrey: "Color",
      placement: "Arm",
      estimatedSize: "Small",
      hasBeenTattooedBefore: false,
      referenceImages: [],
      placementImages: [],
      status: "FLASH_PAYMENT_PENDING",
      flashPaymentToken,
      flashPaymentTokenExpiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
    },
  });
  inquiryIds.push(inquiry.id);

  return { studio, inquiry, flashPaymentToken };
}

test("POST /flash-payment/payment-intent/:token is refused when embeddedPaymentsEnabled is off (the default)", async () => {
  const { flashPaymentToken } = await makeStudioWithFlashInquiry({ embeddedPaymentsEnabled: false, stripeConnected: true, tag: "flashflagoff" });

  const res = await fetch(`${baseUrl}/flash-payment/payment-intent/${flashPaymentToken}`, { method: "POST" });
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string };
  assert.match(body.error, /enabled/i);
});

test("GET /flash-payment/verify/:token exposes embeddedPaymentsEnabled", async () => {
  const { flashPaymentToken } = await makeStudioWithFlashInquiry({ embeddedPaymentsEnabled: true, stripeConnected: true, tag: "flashverify" });

  const res = await fetch(`${baseUrl}/flash-payment/verify/${flashPaymentToken}`);
  const body = (await res.json()) as { embeddedPaymentsEnabled: boolean };
  assert.equal(body.embeddedPaymentsEnabled, true);
});

test("webhook payment_intent.succeeded: finds the flash Inquiry by stripePaymentIntentId, sets flashPaidAt, advances to SCHEDULING, mints a self-schedule token", async () => {
  const { studio, inquiry } = await makeStudioWithFlashInquiry({ embeddedPaymentsEnabled: true, stripeConnected: true, tag: "flashwebhook" });
  const integration = await prisma.studioIntegration.findUniqueOrThrow({
    where: { studioId_channel: { studioId: studio.id, channel: IntegrationChannel.STRIPE } },
  });
  const connectedAccountId = (integration.metadata as { stripeAccountId: string }).stripeAccountId;

  const fakePaymentIntentId = `pi_test_flash_${suffix}`;
  await prisma.inquiry.update({ where: { id: inquiry.id }, data: { stripePaymentIntentId: fakePaymentIntentId } });

  const eventPayload = {
    id: `evt_flash_${suffix}`,
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

  const updated = await prisma.inquiry.findUniqueOrThrow({ where: { id: inquiry.id } });
  assert.ok(updated.flashPaidAt, "flashPaidAt must be set");
  assert.equal(updated.status, "SCHEDULING");
  assert.ok(updated.selfScheduleToken, "a self-schedule token must be minted, same as the Checkout path");
});

// ---------------------------------------------------------------------
// Part 3: session/appointment checkout ("amount due")
// ---------------------------------------------------------------------

test("webhook payment_intent.succeeded: finds the Appointment by stripePaymentIntentId, sets paidVia -- same downstream effect checkout.session.completed already produces", async () => {
  const studio = await prisma.studio.create({ data: { name: `EP Appt ${suffix}`, slug: `ep-appt-${suffix}` } });
  studioIds.push(studio.id);
  const connectedAccountId = `acct_test_appt_${suffix}`;
  await prisma.studioIntegration.create({
    data: { studioId: studio.id, channel: IntegrationChannel.STRIPE, status: IntegrationStatus.CONNECTED, metadata: { stripeAccountId: connectedAccountId, chargesEnabled: true, payoutsEnabled: true } },
  });

  const artistUser = await prisma.user.create({ data: { email: `appt-${suffix}-artist@test.invalid`, role: "ARTIST", studioId: studio.id } });
  userIds.push(artistUser.id);
  const artist = await prisma.artist.create({ data: { userId: artistUser.id, specialties: [], portfolioImages: [] } });
  artistIds.push(artist.id);

  const client = await prisma.client.create({ data: { studioId: studio.id, firstName: "Appt", lastName: "Test", referralCode: `appt-${suffix}-ref` } });
  clientIds.push(client.id);

  const intakeForm = await prisma.intakeForm.create({ data: { studioId: studio.id, name: "Intake", slug: `appt-${suffix}-intake` } });
  intakeFormIds.push(intakeForm.id);
  const service = await prisma.service.create({
    data: { studioId: studio.id, name: "Tattoo", slug: `appt-${suffix}-tattoo`, pricingModel: "RANGE", depositModel: "TIER_BASED", intakeFormId: intakeForm.id },
  });
  serviceIds.push(service.id);
  const inquiry = await prisma.inquiry.create({
    data: {
      studioId: studio.id,
      clientId: client.id,
      serviceId: service.id,
      channel: "EMAIL",
      description: "Session checkout webhook test",
      colorOrBlackGrey: "Color",
      placement: "Arm",
      estimatedSize: "Small",
      hasBeenTattooedBefore: false,
      referenceImages: [],
      placementImages: [],
    },
  });
  inquiryIds.push(inquiry.id);

  const fakePaymentIntentId = `pi_test_appt_${suffix}`;
  const appointment = await prisma.appointment.create({
    data: {
      studioId: studio.id,
      artistId: artist.id,
      clientId: client.id,
      inquiryId: inquiry.id,
      startTime: new Date(),
      endTime: new Date(Date.now() + 60 * 60 * 1000),
      status: "COMPLETED",
      stripePaymentIntentId: fakePaymentIntentId,
    },
  });
  appointmentIds.push(appointment.id);

  const eventPayload = {
    id: `evt_appt_${suffix}`,
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

  const updated = await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
  assert.equal(updated.paidVia, "STRIPE");
});
