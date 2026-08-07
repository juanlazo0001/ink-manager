// Regression coverage for the artist estimate parity feature (REPORT.md:
// "Artist estimate parity"). Run with `npx tsx --test
// src/routes/estimateParity.test.ts` (or `npm test`, which runs every
// *.test.ts). Real Prisma against the real dev database, real HTTP against
// the real router -- same conventions as artistMobility.test.ts.
//
// Two things this file proves:
//
// 1. inquiries.artistSendEstimate ON (the default): an artist's own
//    PATCH /:id/respond APPROVE goes through the EXACT same send path as
//    staff's own Generate & Send Estimate -- a token is minted, the
//    inquiry moves to AWAITING_CLIENT_RESPONSE, and the response carries
//    an estimateUrl, all from the shared lib/estimates.ts function.
//
// 2. inquiries.artistSendEstimate OFF (a studio override): the SAME
//    approve call saves the identical fields (price/time still land on
//    the inquiry) but sends nothing -- no token, status stays
//    ARTIST_ASSIGNED -- and the derived ARTIST_ESTIMATE_NEEDS_REVIEW task
//    source picks it up. Front desk then sends it themselves through the
//    ordinary staff route, which works, and the task source no longer
//    lists it once sent. Adversarially, that same artist can't reach the
//    staff-only POST /:id/send-estimate route directly -- gated by an
//    entirely different permission (inquiries.sendEstimate) ARTIST never
//    has by default, unaffected by the new key either way.
import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma";
import { JWT_SECRET } from "../lib/jwt";
import { Role } from "../../generated/prisma/enums";
import { artistEstimateNeedsReviewSource } from "../lib/tasks/artistEstimateNeedsReview";
import inquiriesRouter from "./inquiries";

function tokenFor(userId: string, studioId: string, role: Role): string {
  return jwt.sign({ userId, studioId, role }, JWT_SECRET);
}

interface EstimateResponseBody {
  estimateUrl?: string;
  estimateSendResult?: unknown;
}

const suffix = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let server: http.Server;
let baseUrl: string;

// -- ON scenario (default permission) --
let studioOnId: string;
let intakeFormOnId: string;
let serviceOnId: string;
let clientOnId: string;
let artistOnUserId: string;
let artistOnId: string;
let inquiryOnId: string;

// -- OFF scenario (studio override) --
let studioOffId: string;
let intakeFormOffId: string;
let serviceOffId: string;
let clientOffId: string;
let artistOffUserId: string;
let artistOffId: string;
let frontDeskOffUserId: string;
let inquiryOffId: string;

before(async () => {
  const studioOn = await prisma.studio.create({ data: { slug: `${suffix}-on`, name: "Test Studio On" } });
  studioOnId = studioOn.id;
  const intakeFormOn = await prisma.intakeForm.create({
    data: { studioId: studioOnId, name: "Test Intake", slug: `${suffix}-on-intake` },
  });
  intakeFormOnId = intakeFormOn.id;
  const serviceOn = await prisma.service.create({
    data: {
      studioId: studioOnId,
      name: "Tattoo",
      slug: `${suffix}-on-tattoo`,
      pricingModel: "RANGE",
      depositModel: "TIER_BASED",
      intakeFormId: intakeFormOnId,
    },
  });
  serviceOnId = serviceOn.id;
  const clientOn = await prisma.client.create({
    data: { studioId: studioOnId, firstName: "On", lastName: "Client", referralCode: `${suffix}-on-ref` },
  });
  clientOnId = clientOn.id;
  const artistOnUser = await prisma.user.create({
    data: { email: `${suffix}-on-artist@test.invalid`, role: Role.ARTIST, studioId: studioOnId },
  });
  artistOnUserId = artistOnUser.id;
  const artistOn = await prisma.artist.create({ data: { userId: artistOnUserId, specialties: [], portfolioImages: [] } });
  artistOnId = artistOn.id;
  const inquiryOn = await prisma.inquiry.create({
    data: {
      studioId: studioOnId,
      clientId: clientOnId,
      serviceId: serviceOnId,
      channel: "EMAIL",
      description: "On-scenario test tattoo",
      colorOrBlackGrey: "Color",
      placement: "Forearm",
      estimatedSize: "Small",
      hasBeenTattooedBefore: false,
      assignedArtistId: artistOnId,
      status: "ARTIST_ASSIGNED",
    },
  });
  inquiryOnId = inquiryOn.id;

  const studioOff = await prisma.studio.create({ data: { slug: `${suffix}-off`, name: "Test Studio Off" } });
  studioOffId = studioOff.id;
  const intakeFormOff = await prisma.intakeForm.create({
    data: { studioId: studioOffId, name: "Test Intake", slug: `${suffix}-off-intake` },
  });
  intakeFormOffId = intakeFormOff.id;
  const serviceOff = await prisma.service.create({
    data: {
      studioId: studioOffId,
      name: "Tattoo",
      slug: `${suffix}-off-tattoo`,
      pricingModel: "RANGE",
      depositModel: "TIER_BASED",
      intakeFormId: intakeFormOffId,
    },
  });
  serviceOffId = serviceOff.id;
  const clientOff = await prisma.client.create({
    data: { studioId: studioOffId, firstName: "Off", lastName: "Client", referralCode: `${suffix}-off-ref` },
  });
  clientOffId = clientOff.id;
  const artistOffUser = await prisma.user.create({
    data: { email: `${suffix}-off-artist@test.invalid`, role: Role.ARTIST, studioId: studioOffId },
  });
  artistOffUserId = artistOffUser.id;
  const artistOff = await prisma.artist.create({ data: { userId: artistOffUserId, specialties: [], portfolioImages: [] } });
  artistOffId = artistOff.id;
  const frontDeskOffUser = await prisma.user.create({
    data: { email: `${suffix}-off-frontdesk@test.invalid`, role: Role.FRONT_DESK, studioId: studioOffId },
  });
  frontDeskOffUserId = frontDeskOffUser.id;
  const inquiryOff = await prisma.inquiry.create({
    data: {
      studioId: studioOffId,
      clientId: clientOffId,
      serviceId: serviceOffId,
      channel: "EMAIL",
      description: "Off-scenario test tattoo",
      colorOrBlackGrey: "Color",
      placement: "Shoulder",
      estimatedSize: "Small",
      hasBeenTattooedBefore: false,
      assignedArtistId: artistOffId,
      status: "ARTIST_ASSIGNED",
    },
  });
  inquiryOffId = inquiryOff.id;

  await prisma.rolePermission.create({
    data: { studioId: studioOffId, role: Role.ARTIST, permissionKey: "inquiries.artistSendEstimate", allowed: false },
  });

  const app = express();
  app.use(express.json());
  app.use("/inquiries", inquiriesRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));

  await prisma.auditLog.deleteMany({ where: { studioId: { in: [studioOnId, studioOffId] } } });
  await prisma.rolePermission.deleteMany({ where: { studioId: { in: [studioOnId, studioOffId] } } });
  await prisma.plannedSession.deleteMany({ where: { inquiryId: { in: [inquiryOnId, inquiryOffId] } } });
  await prisma.inquiry.deleteMany({ where: { id: { in: [inquiryOnId, inquiryOffId] } } });
  // getOrCreateClientConversation (called by the send path regardless of
  // whether the SMS itself actually goes out) creates a real Conversation
  // row for each client -- clean those up before the Client/Studio rows
  // they reference.
  await prisma.message.deleteMany({ where: { studioId: { in: [studioOnId, studioOffId] } } });
  await prisma.conversation.deleteMany({ where: { studioId: { in: [studioOnId, studioOffId] } } });
  await prisma.client.deleteMany({ where: { id: { in: [clientOnId, clientOffId] } } });
  await prisma.service.deleteMany({ where: { id: { in: [serviceOnId, serviceOffId] } } });
  await prisma.intakeForm.deleteMany({ where: { id: { in: [intakeFormOnId, intakeFormOffId] } } });
  await prisma.artist.deleteMany({ where: { id: { in: [artistOnId, artistOffId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [artistOnUserId, artistOffUserId, frontDeskOffUserId] } } });
  await prisma.studio.deleteMany({ where: { id: { in: [studioOnId, studioOffId] } } });
});

test("PATCH /:id/respond APPROVE, artistSendEstimate ON: sends the real estimate, same as staff's send path", async () => {
  const token = tokenFor(artistOnUserId, studioOnId, Role.ARTIST);
  const res = await fetch(`${baseUrl}/inquiries/${inquiryOnId}/respond`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      decision: "APPROVE",
      priceEstimateLow: 200,
      priceEstimateHigh: 300,
      timeEstimateHoursMin: 2,
      timeEstimateHoursMax: 3,
    }),
  });
  assert.equal(res.status, 201);
  const body = (await res.json()) as EstimateResponseBody;
  assert.ok(typeof body.estimateUrl === "string" && body.estimateUrl.length > 0, "should return a real estimateUrl");
  assert.ok(body.estimateSendResult, "should return an estimateSendResult");

  const updated = await prisma.inquiry.findUniqueOrThrow({ where: { id: inquiryOnId } });
  assert.equal(updated.status, "AWAITING_CLIENT_RESPONSE");
  assert.ok(updated.estimateSentAt != null, "estimateSentAt should be set");
  assert.ok(updated.estimateToken != null, "estimateToken should be minted");
  assert.equal(updated.priceEstimateLow, 200);
  assert.equal(updated.priceEstimateHigh, 300);
});

test("PATCH /:id/respond APPROVE, artistSendEstimate OFF: saves the estimate but sends nothing", async () => {
  const token = tokenFor(artistOffUserId, studioOffId, Role.ARTIST);
  const res = await fetch(`${baseUrl}/inquiries/${inquiryOffId}/respond`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      decision: "APPROVE",
      priceEstimateLow: 400,
      priceEstimateHigh: 500,
      timeEstimateHoursMin: 4,
      timeEstimateHoursMax: 5,
    }),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as EstimateResponseBody;
  assert.equal(body.estimateUrl, undefined, "should NOT generate a client-facing link");

  const updated = await prisma.inquiry.findUniqueOrThrow({ where: { id: inquiryOffId } });
  assert.equal(updated.status, "ARTIST_ASSIGNED", "status must stay put -- nothing was sent to the client yet");
  assert.equal(updated.estimateSentAt, null);
  assert.equal(updated.estimateToken, null);
  assert.equal(updated.priceEstimateLow, 400);
  assert.equal(updated.priceEstimateHigh, 500);
});

test("ARTIST_ESTIMATE_NEEDS_REVIEW task source lists the saved-not-sent inquiry for front desk", async () => {
  const tasks = await artistEstimateNeedsReviewSource.fetch(studioOffId, frontDeskOffUserId);
  assert.ok(
    tasks.some((t) => t.entityId === inquiryOffId),
    "the saved-but-unsent estimate should surface as a front-desk task",
  );
});

test("Adversarial: the artist with artistSendEstimate OFF still can't hit the staff-only send route directly -- 403", async () => {
  const token = tokenFor(artistOffUserId, studioOffId, Role.ARTIST);
  const res = await fetch(`${baseUrl}/inquiries/${inquiryOffId}/send-estimate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ priceEstimateLow: 400, priceEstimateHigh: 500, timeEstimateHoursMin: 4, timeEstimateHoursMax: 5 }),
  });
  assert.equal(res.status, 403);
});

test("Front desk sends the artist-prepared estimate through the ordinary staff route, then it drops off the task list", async () => {
  const token = tokenFor(frontDeskOffUserId, studioOffId, Role.FRONT_DESK);
  const res = await fetch(`${baseUrl}/inquiries/${inquiryOffId}/send-estimate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 201);
  const body = (await res.json()) as EstimateResponseBody;
  assert.ok(typeof body.estimateUrl === "string" && body.estimateUrl.length > 0);

  const updated = await prisma.inquiry.findUniqueOrThrow({ where: { id: inquiryOffId } });
  assert.equal(updated.status, "AWAITING_CLIENT_RESPONSE");
  assert.ok(updated.estimateSentAt != null);
  // Front desk resent with an empty body -- the already-saved 400/500 numbers
  // from the artist's own save must have carried through untouched.
  assert.equal(updated.priceEstimateLow, 400);
  assert.equal(updated.priceEstimateHigh, 500);

  const tasks = await artistEstimateNeedsReviewSource.fetch(studioOffId, frontDeskOffUserId);
  assert.ok(!tasks.some((t) => t.entityId === inquiryOffId), "should no longer appear once actually sent");
});
