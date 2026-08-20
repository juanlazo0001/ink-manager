// A2P 10DLC compliance (Twilio flagged forced consent on the live intake
// form). The defect: POST /inquiries returned 400 whenever the public
// consent checkbox was unticked -- unconditionally, whether or not a phone
// number was supplied -- so the box was in practice mandatory. A carrier
// reviewer reads that as consent that isn't freely given.
//
// These tests pin the fix from both ends, because "optional" is only safe
// if "no consent" is also structurally enforced downstream:
//   1. a submission WITH a phone and an unticked box succeeds, and records
//      no consent on the client;
//   2. a ticked box records consent, timestamped now;
//   3. sendClientSms refuses a no-consent client with its own distinct
//      reason -- the same hard refusal an opt-out gets, so "phone on file"
//      can never by itself become permission to text.
//
// (3) deliberately asserts the reason string, not merely `sent: false` --
// the point of the fix is that staff and the reminder log can tell "they
// never opted in" apart from "they asked us to stop".

import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { prisma } from "../lib/prisma";
import { sendClientSms } from "../lib/clientSms";
import { getOrCreateClientConversation } from "../lib/conversations";
import inquiriesRouter from "./inquiries";

const suffix = `smsconsent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let server: http.Server;
let baseUrl: string;

const studioIds: string[] = [];
const clientIds: string[] = [];
const inquiryIds: string[] = [];

let studioSlug: string;
let formSlug: string;

function submissionBody(overrides: Record<string, unknown>) {
  return {
    studioSlug,
    formSlug,
    firstName: "Consent",
    lastName: "Optional",
    channel: "EMAIL",
    description: "A2P consent regression coverage",
    colorOrBlackGrey: "Color",
    placement: "Forearm",
    estimatedSize: "Small",
    hasBeenTattooedBefore: false,
    referenceImages: ["https://example.test/ref.png"],
    placementImages: ["https://example.test/placement.png"],
    ...overrides,
  };
}

async function submit(overrides: Record<string, unknown>) {
  const res = await fetch(`${baseUrl}/inquiries`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(submissionBody(overrides)),
  });
  const body = (await res.json()) as { id?: string; error?: string };
  if (body.id) {
    inquiryIds.push(body.id);
    const created = await prisma.inquiry.findUniqueOrThrow({ where: { id: body.id }, select: { clientId: true } });
    if (!clientIds.includes(created.clientId)) clientIds.push(created.clientId);
    return { status: res.status, body, clientId: created.clientId };
  }
  return { status: res.status, body, clientId: null };
}

before(async () => {
  const studio = await prisma.studio.create({
    data: { name: `SMS Consent ${suffix}`, slug: `sms-consent-${suffix}` },
  });
  studioIds.push(studio.id);
  studioSlug = studio.slug;

  const form = await prisma.intakeForm.create({
    data: { studioId: studio.id, name: "Consent Intake", slug: `${suffix}-intake` },
  });
  formSlug = form.slug;

  // The route resolves a service from the submitted form -- a studio with
  // none 500s before any of this file's actual subject matter is reached.
  await prisma.service.create({
    data: {
      studioId: studio.id,
      name: "Consent Tattoo",
      slug: `${suffix}-tattoo`,
      pricingModel: "RANGE",
      depositModel: "TIER_BASED",
      intakeFormId: form.id,
    },
  });

  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use("/inquiries", inquiriesRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await prisma.message.deleteMany({ where: { studioId: { in: studioIds } } });
  await prisma.conversation.deleteMany({ where: { studioId: { in: studioIds } } });
  await prisma.inquiry.deleteMany({ where: { id: { in: inquiryIds } } });
  // Studio-scoped, not just tracked-id-based: a submission that errors
  // partway can leave behind a client this file never got an id back for,
  // and Client_studioId_fkey is RESTRICT -- the studio delete below then
  // fails and leaks the whole fixture. Same lesson as
  // residencyVerification.test.ts's own cleanup fix.
  const strayClients = await prisma.client.findMany({
    where: { studioId: { in: studioIds } },
    select: { id: true },
  });
  const allClientIds = [...new Set([...clientIds, ...strayClients.map((c) => c.id)])];
  await prisma.inquiry.deleteMany({ where: { clientId: { in: allClientIds } } });
  await prisma.conversation.deleteMany({ where: { clientId: { in: allClientIds } } });
  await prisma.clientEmail.deleteMany({ where: { clientId: { in: allClientIds } } });
  await prisma.clientPhone.deleteMany({ where: { clientId: { in: allClientIds } } });
  await prisma.client.deleteMany({ where: { id: { in: allClientIds } } });
  await prisma.service.deleteMany({ where: { studioId: { in: studioIds } } });
  await prisma.intakeForm.deleteMany({ where: { studioId: { in: studioIds } } });
  await prisma.auditLog.deleteMany({ where: { studioId: { in: studioIds } } });
  await prisma.studio.deleteMany({ where: { id: { in: studioIds } } });
});

test("a phone number WITH the consent box unticked submits successfully and records no consent", async () => {
  // The exact combination Twilio's review is about: the client is willing
  // to be phoned, and has NOT agreed to be texted. Both halves must hold.
  const unchecked = await submit({
    email: `${suffix}-unchecked@test.invalid`,
    phone: "5125550111",
    smsConsent: false,
  });
  assert.equal(
    unchecked.status,
    201,
    `unticked consent must not block submission (got ${JSON.stringify(unchecked.body)})`,
  );

  const client = await prisma.client.findUniqueOrThrow({
    where: { id: unchecked.clientId! },
    select: { phone: true, smsConsentGivenAt: true, smsConsentSource: true },
  });
  assert.ok(client.phone, "the phone number must still be stored -- it is a contact method, not a consent signal");
  assert.equal(client.smsConsentGivenAt, null, "an unticked box must record NO consent");
  assert.equal(client.smsConsentSource, null);

  // Omitting the field entirely (a raw no-JS form POST, which never sends
  // an unchecked checkbox at all) must behave identically to sending
  // false -- the old route 400'd on both.
  const omitted = await submit({
    email: `${suffix}-omitted@test.invalid`,
    phone: "5125550112",
  });
  assert.equal(
    omitted.status,
    201,
    `an absent smsConsent field must not block submission (got ${JSON.stringify(omitted.body)})`,
  );
  const omittedClient = await prisma.client.findUniqueOrThrow({
    where: { id: omitted.clientId! },
    select: { smsConsentGivenAt: true },
  });
  assert.equal(omittedClient.smsConsentGivenAt, null);
});

test("a ticked consent box records consent on the client, timestamped now, sourced to the intake form", async () => {
  const submittedAfter = new Date();
  const checked = await submit({
    email: `${suffix}-checked@test.invalid`,
    phone: "5125550113",
    smsConsent: true,
  });
  assert.equal(checked.status, 201);

  const client = await prisma.client.findUniqueOrThrow({
    where: { id: checked.clientId! },
    select: { smsConsentGivenAt: true, smsConsentSource: true },
  });
  assert.ok(client.smsConsentGivenAt, "a ticked box must record consent");
  assert.equal(client.smsConsentSource, "intake_form");
  assert.ok(
    client.smsConsentGivenAt!.getTime() >= submittedAfter.getTime() &&
      client.smsConsentGivenAt!.getTime() <= Date.now() + 1000,
    "consent must be stamped at submission time, not backdated or defaulted",
  );

  // A later no-consent submission from the same client must never ERASE
  // consent already on file -- consent is set-once, and leaving the box
  // unticked on a second inquiry is not a revocation (STOP is).
  const again = await submit({
    email: `${suffix}-checked@test.invalid`,
    phone: "5125550113",
    smsConsent: false,
  });
  assert.equal(again.status, 201);
  assert.equal(again.clientId, checked.clientId, "same email must match the same client");
  const preserved = await prisma.client.findUniqueOrThrow({
    where: { id: checked.clientId! },
    select: { smsConsentGivenAt: true },
  });
  assert.equal(
    preserved.smsConsentGivenAt!.getTime(),
    client.smsConsentGivenAt!.getTime(),
    "an existing consent timestamp must be preserved exactly",
  );
});

test("sendClientSms refuses a client with a phone but no consent, with its own reason", async () => {
  const noConsent = await submit({
    email: `${suffix}-send@test.invalid`,
    phone: "5125550114",
    smsConsent: false,
  });
  assert.equal(noConsent.status, 201);
  const clientId = noConsent.clientId!;
  const { conversation } = await getOrCreateClientConversation(studioIds[0], clientId, null);

  const refused = await sendClientSms({
    studioId: studioIds[0],
    clientId,
    conversationId: conversation.id,
    body: "This must never reach Twilio.",
    actorUserId: null,
  });
  assert.equal(refused.sent, false);
  assert.equal(
    refused.sent === false ? refused.reason : null,
    "no_consent",
    "a no-consent client must be refused BEFORE any integration/connection check, with a distinct reason",
  );

  // Once consent exists the same call gets PAST the consent gate --
  // proving the refusal above was the consent check specifically, not some
  // unrelated precondition failing first. This test studio has no SMS
  // integration, so the expected next stop is not_connected.
  await prisma.client.update({
    where: { id: clientId },
    data: { smsConsentGivenAt: new Date(), smsConsentSource: "test" },
  });
  const withConsent = await sendClientSms({
    studioId: studioIds[0],
    clientId,
    conversationId: conversation.id,
    body: "Now past the consent gate.",
    actorUserId: null,
  });
  assert.equal(withConsent.sent, false);
  assert.equal(withConsent.sent === false ? withConsent.reason : null, "not_connected");

  // An opted-out client is refused the same way, with its own reason kept
  // distinct from no_consent.
  await prisma.client.update({ where: { id: clientId }, data: { smsOptedOutAt: new Date() } });
  const optedOut = await sendClientSms({
    studioId: studioIds[0],
    clientId,
    conversationId: conversation.id,
    body: "Refused for a different reason.",
    actorUserId: null,
  });
  assert.equal(optedOut.sent === false ? optedOut.reason : null, "opted_out");
});
