// Regression coverage for the artist-mobility studio-scoping bug class
// (REPORT.md: "Artist-mobility studio-scoping audit" -- deposit-forms PDF
// export, plus the shared callerBelongsToStudio/studioHasActiveMembership/
// activeStudioIdsForCaller primitives every other fix in that audit is
// built on). Run with `npx tsx --test src/routes/artistMobility.test.ts`
// (or `npm test`, which runs every *.test.ts). Real Prisma against the
// real dev database -- same "no mocking, no test framework beyond
// node:test" convention as lib/studioTime.test.ts -- with a self-contained
// fixture set created here and torn down in `after`, since this is a
// permanent, re-runnable regression test rather than one-off session
// verification (which is what this codebase's OTHER "leave test data in
// place" convention applies to).
//
// Three things this file proves, in order:
//
// 1. POSITIVE: a guest artist with an ACTIVE membership at a studio that
//    isn't their home gets real access to that studio's data (the
//    original bug -- deposit-forms/:id/pdf 404'd them).
//
// 2. NEGATIVE, ended GUEST membership: once that membership's `endedAt`
//    is set, access must revert to zero -- not just a 404 on the one
//    flagged PDF route, but genuinely absent from every list endpoint
//    this audit touched (calendar, conversations, flash gallery,
//    reports). This is the same failure SHAPE as the historical
//    `GET /artists` roster bug (a departed/removed artist still showing
//    up) -- the fix for bug #4 must not reintroduce bugs #1/#2's shape
//    for these new call sites.
//
// 3. NEGATIVE, stale JWT after a HOME transfer: a caught-before-shipping
//    regression in callerBelongsToStudio itself. An artist's JWT keeps
//    its OLD `studioId` claim until they receive and apply a freshly
//    minted token (go-solo/artist-invite-accept both mint one specifically
//    because requireAuth never re-validates studioId/role live) -- up to
//    the full 7-day token lifetime on a second device/tab that never
//    refreshes. An earlier version of callerBelongsToStudio trusted that
//    claim via a plain equality shortcut, which would have granted ghost
//    access to the OLD home studio even after its membership row was
//    already `endedAt`-set. Fixed by never trusting the ARTIST caller's
//    own studioId claim -- only a fresh DB read of it, or an active
//    membership row, counts.

import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma";
import { JWT_SECRET } from "../lib/jwt";
import { Role } from "../../generated/prisma/enums";
import { callerBelongsToStudio, studioHasActiveMembership, activeStudioIdsForCaller } from "../lib/artistAccess";
import { staffRouter as depositFormsRouter } from "./deposits";
import appointmentsRouter from "./appointments";
import flashPiecesRouter from "./flashPieces";
import conversationsRouter from "./conversations";
import reportsRouter from "./reports";

function tokenFor(userId: string, studioId: string, role: Role): string {
  return jwt.sign({ userId, studioId, role }, JWT_SECRET);
}

const suffix = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let server: http.Server;
let baseUrl: string;

// -- Scenario 1: active guest membership --
let homeStudioId: string;
let guestStudioId: string;
let unrelatedStudioId: string;
let intakeFormId: string;
let serviceId: string;
let clientId: string;
let guestArtistUserId: string;
let guestArtistId: string;
let outsiderUserId: string;
let outsiderArtistId: string;
let inquiryId: string;
let depositFormId: string;

// -- Scenario 2: ended guest membership --
let endedArtistUserId: string;
let endedArtistId: string;
let endedInquiryId: string;
let endedAppointmentId: string;
let endedConversationId: string;
let endedFlashPieceId: string;

// -- Scenario 3: stale JWT after a HOME transfer --
let formerHomeStudioId: string;
let currentHomeStudioId: string;
let transferArtistUserId: string;
let transferArtistId: string;
let transferFlashPieceId: string;

before(async () => {
  const homeStudio = await prisma.studio.create({ data: { slug: `${suffix}-home`, name: "Test Home Studio" } });
  const guestStudio = await prisma.studio.create({ data: { slug: `${suffix}-guest`, name: "Test Guest Studio" } });
  const unrelatedStudio = await prisma.studio.create({ data: { slug: `${suffix}-unrelated`, name: "Test Unrelated Studio" } });
  homeStudioId = homeStudio.id;
  guestStudioId = guestStudio.id;
  unrelatedStudioId = unrelatedStudio.id;

  const intakeForm = await prisma.intakeForm.create({
    data: { studioId: guestStudioId, name: "Test Intake", slug: `${suffix}-intake` },
  });
  intakeFormId = intakeForm.id;

  const service = await prisma.service.create({
    data: {
      studioId: guestStudioId,
      name: "Tattoo",
      slug: `${suffix}-tattoo`,
      pricingModel: "RANGE",
      depositModel: "TIER_BASED",
      intakeFormId,
    },
  });
  serviceId = service.id;

  const client = await prisma.client.create({
    data: { studioId: guestStudioId, firstName: "Test", lastName: "Client", referralCode: `${suffix}-ref` },
  });
  clientId = client.id;

  // The guest artist: HOME at homeStudio, an ACTIVE GUEST membership at
  // guestStudio -- the exact shape that used to 404 on the deposit-form
  // PDF route.
  const guestArtistUser = await prisma.user.create({
    data: { email: `${suffix}-guest-artist@test.invalid`, role: Role.ARTIST, studioId: homeStudioId },
  });
  guestArtistUserId = guestArtistUser.id;
  const guestArtist = await prisma.artist.create({
    data: { userId: guestArtistUserId, specialties: [], portfolioImages: [] },
  });
  guestArtistId = guestArtist.id;
  await prisma.studioMembership.create({
    data: { studioId: guestStudioId, artistId: guestArtistId, type: "GUEST" },
  });

  // The outsider: HOME at homeStudio too, but NO relationship to
  // guestStudio at all, and not assigned to the inquiry below -- every
  // assertion against them must still be a 404, proving the fix didn't
  // over-widen access.
  const outsiderUser = await prisma.user.create({
    data: { email: `${suffix}-outsider@test.invalid`, role: Role.ARTIST, studioId: homeStudioId },
  });
  outsiderUserId = outsiderUser.id;
  const outsiderArtist = await prisma.artist.create({
    data: { userId: outsiderUserId, specialties: [], portfolioImages: [] },
  });
  outsiderArtistId = outsiderArtist.id;

  const inquiry = await prisma.inquiry.create({
    data: {
      studioId: guestStudioId,
      clientId,
      serviceId,
      channel: "EMAIL",
      description: "Test tattoo",
      colorOrBlackGrey: "Color",
      placement: "Forearm",
      estimatedSize: "Small",
      hasBeenTattooedBefore: false,
      assignedArtistId: guestArtistId,
    },
  });
  inquiryId = inquiry.id;

  const depositForm = await prisma.depositForm.create({
    data: {
      inquiryId,
      token: `${suffix}-token`,
      tokenExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      depositAmount: 100,
      feeAmount: 10,
      totalCharged: 110,
      signedAt: new Date(),
      signatureName: "Test Client",
    },
  });
  depositFormId = depositForm.id;

  // -- Scenario 2 fixtures: an artist who WAS a guest at guestStudio, but
  // that membership has since ENDED (simulating removal, or the artist's
  // own guest stint finishing) -- with real records at guestStudio from
  // while it was active, exactly like a real removed guest artist would
  // have left behind.
  const endedArtistUser = await prisma.user.create({
    data: { email: `${suffix}-ended-artist@test.invalid`, role: Role.ARTIST, studioId: homeStudioId },
  });
  endedArtistUserId = endedArtistUser.id;
  const endedArtist = await prisma.artist.create({
    data: { userId: endedArtistUserId, specialties: [], portfolioImages: [] },
  });
  endedArtistId = endedArtist.id;
  await prisma.studioMembership.create({
    data: { studioId: guestStudioId, artistId: endedArtistId, type: "GUEST", endedAt: new Date() },
  });

  const endedInquiry = await prisma.inquiry.create({
    data: {
      studioId: guestStudioId,
      clientId,
      serviceId,
      channel: "EMAIL",
      description: "Ended-membership test tattoo",
      colorOrBlackGrey: "Color",
      placement: "Shoulder",
      estimatedSize: "Small",
      hasBeenTattooedBefore: false,
      assignedArtistId: endedArtistId,
    },
  });
  endedInquiryId = endedInquiry.id;

  const endedAppointment = await prisma.appointment.create({
    data: {
      studioId: guestStudioId,
      artistId: endedArtistId,
      clientId,
      inquiryId: endedInquiryId,
      startTime: new Date(Date.now() + 24 * 60 * 60 * 1000),
      endTime: new Date(Date.now() + 26 * 60 * 60 * 1000),
    },
  });
  endedAppointmentId = endedAppointment.id;

  const endedConversation = await prisma.conversation.create({
    data: { studioId: guestStudioId, type: "STAFF", staffUserId: endedArtistUserId },
  });
  endedConversationId = endedConversation.id;

  const endedFlashPiece = await prisma.flashPiece.create({
    data: {
      studioId: guestStudioId,
      artistId: endedArtistId,
      imageUrl: "https://example.invalid/flash.png",
      title: "Ended-membership test piece",
      priceCents: 10000,
      estimatedDurationMinutes: 60,
    },
  });
  endedFlashPieceId = endedFlashPiece.id;

  // -- Scenario 3 fixtures: an artist mid HOME transfer. DB state already
  // reflects "after" (User.studioId + the active HOME membership both
  // point at currentHomeStudio; formerHomeStudio's HOME membership is
  // already ended) -- but the token used in the test below deliberately
  // still carries the OLD studioId, simulating a second device/tab that
  // hasn't picked up the fresh token go-solo/invite-accept mints.
  const formerHomeStudio = await prisma.studio.create({ data: { slug: `${suffix}-former-home`, name: "Former Home" } });
  const currentHomeStudio = await prisma.studio.create({ data: { slug: `${suffix}-current-home`, name: "Current Home" } });
  formerHomeStudioId = formerHomeStudio.id;
  currentHomeStudioId = currentHomeStudio.id;

  const transferArtistUser = await prisma.user.create({
    data: { email: `${suffix}-transfer-artist@test.invalid`, role: Role.ARTIST, studioId: currentHomeStudioId },
  });
  transferArtistUserId = transferArtistUser.id;
  const transferArtist = await prisma.artist.create({
    data: { userId: transferArtistUserId, specialties: [], portfolioImages: [] },
  });
  transferArtistId = transferArtist.id;
  await prisma.studioMembership.create({
    data: { studioId: formerHomeStudioId, artistId: transferArtistId, type: "HOME", endedAt: new Date() },
  });
  await prisma.studioMembership.create({
    data: { studioId: currentHomeStudioId, artistId: transferArtistId, type: "HOME" },
  });

  // One real flash piece still sitting at the FORMER home studio (created
  // back when it really was home) -- must disappear from this artist's
  // own list even when the request carries the stale old-home token.
  const transferFlashPiece = await prisma.flashPiece.create({
    data: {
      studioId: formerHomeStudioId,
      artistId: transferArtistId,
      imageUrl: "https://example.invalid/transfer-flash.png",
      title: "Former-home test piece",
      priceCents: 5000,
      estimatedDurationMinutes: 30,
    },
  });
  transferFlashPieceId = transferFlashPiece.id;

  // Minimal app: the real routers under test, mounted exactly like
  // index.ts mounts them -- no other app-level middleware needed for a
  // bearer-token GET (each router applies its own requireAuth).
  const app = express();
  app.use(express.json());
  app.use("/deposit-forms", depositFormsRouter);
  app.use("/appointments", appointmentsRouter);
  app.use("/flash-pieces", flashPiecesRouter);
  app.use("/conversations", conversationsRouter);
  app.use("/reports", reportsRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));

  await prisma.depositForm.deleteMany({ where: { id: depositFormId } });
  await prisma.appointment.deleteMany({ where: { id: endedAppointmentId } });
  await prisma.conversation.deleteMany({ where: { id: endedConversationId } });
  await prisma.flashPiece.deleteMany({ where: { id: { in: [endedFlashPieceId, transferFlashPieceId] } } });
  await prisma.inquiry.deleteMany({ where: { id: { in: [inquiryId, endedInquiryId] } } });
  await prisma.client.deleteMany({ where: { id: clientId } });
  await prisma.service.deleteMany({ where: { id: serviceId } });
  await prisma.intakeForm.deleteMany({ where: { id: intakeFormId } });
  await prisma.studioMembership.deleteMany({
    where: { artistId: { in: [guestArtistId, endedArtistId, transferArtistId] } },
  });
  await prisma.artist.deleteMany({ where: { id: { in: [guestArtistId, outsiderArtistId, endedArtistId, transferArtistId] } } });
  await prisma.user.deleteMany({
    where: { id: { in: [guestArtistUserId, outsiderUserId, endedArtistUserId, transferArtistUserId] } },
  });
  await prisma.studio.deleteMany({
    where: { id: { in: [homeStudioId, guestStudioId, unrelatedStudioId, formerHomeStudioId, currentHomeStudioId] } },
  });
});

// ---------------------------------------------------------------------
// Scenario 1: active guest membership gets real access (the original bug)
// ---------------------------------------------------------------------

test("callerBelongsToStudio: HOME artist matches their own studio", async () => {
  const belongs = await callerBelongsToStudio(
    { studioId: homeStudioId, role: Role.ARTIST, userId: guestArtistUserId },
    homeStudioId,
  );
  assert.equal(belongs, true);
});

test("callerBelongsToStudio: GUEST artist matches their active guest studio even though it's not their home", async () => {
  const belongs = await callerBelongsToStudio(
    { studioId: homeStudioId, role: Role.ARTIST, userId: guestArtistUserId },
    guestStudioId,
  );
  assert.equal(belongs, true);
});

test("callerBelongsToStudio: an artist with no membership at all is rejected for that studio", async () => {
  const belongs = await callerBelongsToStudio(
    { studioId: homeStudioId, role: Role.ARTIST, userId: outsiderUserId },
    guestStudioId,
  );
  assert.equal(belongs, false);
});

test("callerBelongsToStudio: unrelated third studio is rejected for both artists", async () => {
  assert.equal(
    await callerBelongsToStudio({ studioId: homeStudioId, role: Role.ARTIST, userId: guestArtistUserId }, unrelatedStudioId),
    false,
  );
  assert.equal(
    await callerBelongsToStudio({ studioId: homeStudioId, role: Role.ARTIST, userId: outsiderUserId }, unrelatedStudioId),
    false,
  );
});

test("studioHasActiveMembership: true for the guest studio, false for the unrelated one", async () => {
  assert.equal(await studioHasActiveMembership(guestStudioId, guestArtistId), true);
  assert.equal(await studioHasActiveMembership(unrelatedStudioId, guestArtistId), false);
});

test("activeStudioIdsForCaller: guest artist resolves to [home, guest]", async () => {
  const ids = await activeStudioIdsForCaller({ studioId: homeStudioId, role: Role.ARTIST, userId: guestArtistUserId });
  assert.deepEqual(new Set(ids), new Set([homeStudioId, guestStudioId]));
});

test("GET /deposit-forms/:id/pdf: guest artist downloads their own guest-studio project's signed deposit form -- 200", async () => {
  const token = tokenFor(guestArtistUserId, homeStudioId, Role.ARTIST);
  const res = await fetch(`${baseUrl}/deposit-forms/${depositFormId}/pdf`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/pdf");
  const body = await res.arrayBuffer();
  assert.ok(body.byteLength > 0, "PDF body should not be empty");
});

test("GET /deposit-forms/:id/pdf: an artist with no relationship to the project's studio -- 404", async () => {
  const token = tokenFor(outsiderUserId, homeStudioId, Role.ARTIST);
  const res = await fetch(`${baseUrl}/deposit-forms/${depositFormId}/pdf`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 404);
});

test("GET /deposit-forms/:id/pdf: no bearer token at all -- 401", async () => {
  const res = await fetch(`${baseUrl}/deposit-forms/${depositFormId}/pdf`);
  assert.equal(res.status, 401);
});

test("GET /deposit-forms/:id/pdf: a nonexistent deposit form id -- 404, not a crash", async () => {
  const token = tokenFor(guestArtistUserId, homeStudioId, Role.ARTIST);
  const res = await fetch(`${baseUrl}/deposit-forms/does-not-exist/pdf`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 404);
});

// ---------------------------------------------------------------------
// Scenario 2: ended GUEST membership -- must revert to zero access,
// everywhere, not just the one flagged PDF route. This is the exact
// "ghost access" shape the historical GET /artists roster bug had; the
// fix for the PDF bug must not reintroduce it for these new call sites.
// ---------------------------------------------------------------------

test("callerBelongsToStudio: an ENDED guest membership is rejected, not treated as still active", async () => {
  const belongs = await callerBelongsToStudio(
    { studioId: homeStudioId, role: Role.ARTIST, userId: endedArtistUserId },
    guestStudioId,
  );
  assert.equal(belongs, false);
});

test("studioHasActiveMembership: false for an ended membership", async () => {
  assert.equal(await studioHasActiveMembership(guestStudioId, endedArtistId), false);
});

test("activeStudioIdsForCaller: an ended guest membership does not appear in the caller's active studio set", async () => {
  const ids = await activeStudioIdsForCaller({ studioId: homeStudioId, role: Role.ARTIST, userId: endedArtistUserId });
  assert.deepEqual(ids, [homeStudioId]);
  assert.ok(!ids.includes(guestStudioId), "ended guest studio must not appear");
});

test("GET /deposit-forms/:id/pdf: ended-membership artist is 404'd out of a deposit form at that studio", async () => {
  const token = tokenFor(endedArtistUserId, homeStudioId, Role.ARTIST);
  const res = await fetch(`${baseUrl}/deposit-forms/${depositFormId}/pdf`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 404);
});

test("GET /appointments (calendar): ended-membership artist's own guest-studio appointment does not appear", async () => {
  const token = tokenFor(endedArtistUserId, homeStudioId, Role.ARTIST);
  const res = await fetch(`${baseUrl}/appointments`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(res.status, 200);
  const appointments = (await res.json()) as { id: string }[];
  assert.ok(
    !appointments.some((a) => a.id === endedAppointmentId),
    "ended-membership studio's appointment must not appear on this artist's calendar",
  );
});

test("GET /conversations: ended-membership artist's own guest-studio staff thread does not appear", async () => {
  const token = tokenFor(endedArtistUserId, homeStudioId, Role.ARTIST);
  const res = await fetch(`${baseUrl}/conversations`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(res.status, 200);
  const conversations = (await res.json()) as { id: string }[];
  assert.ok(
    !conversations.some((c) => c.id === endedConversationId),
    "ended-membership studio's staff thread must not appear on this artist's conversation list",
  );
});

test("GET /flash-pieces: ended-membership artist's own guest-studio flash piece does not appear", async () => {
  const token = tokenFor(endedArtistUserId, homeStudioId, Role.ARTIST);
  const res = await fetch(`${baseUrl}/flash-pieces`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(res.status, 200);
  const pieces = (await res.json()) as { id: string }[];
  assert.ok(
    !pieces.some((p) => p.id === endedFlashPieceId),
    "ended-membership studio's flash piece must not appear on this artist's own gallery list",
  );
});

test("GET /reports/dashboard: ended-membership artist's guest-studio project no longer counts toward their own numbers", async () => {
  const token = tokenFor(endedArtistUserId, homeStudioId, Role.ARTIST);
  const res = await fetch(`${baseUrl}/reports/dashboard`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(res.status, 200);
  const dashboard = (await res.json()) as { scope: string; funnel: { stages: { stage: string; count: number }[] } };
  assert.equal(dashboard.scope, "own");
  const received = dashboard.funnel.stages.find((s) => s.stage === "received");
  assert.equal(received?.count, 0, "the ended-membership studio's inquiry must not count toward this artist's own funnel");
});

// ---------------------------------------------------------------------
// Scenario 3: stale JWT after a HOME transfer -- caught before shipping.
// Proves callerBelongsToStudio/activeStudioIdsForCaller never trust the
// ARTIST caller's OWN studioId claim, only a fresh DB read.
// ---------------------------------------------------------------------

test("callerBelongsToStudio: a stale JWT still claiming the FORMER home studio is rejected once that HOME membership has ended", async () => {
  const staleJwtUser = { studioId: formerHomeStudioId, role: Role.ARTIST, userId: transferArtistUserId };
  assert.equal(await callerBelongsToStudio(staleJwtUser, formerHomeStudioId), false);
});

test("callerBelongsToStudio: the same artist's CURRENT home studio is correctly accepted", async () => {
  const freshJwtUser = { studioId: currentHomeStudioId, role: Role.ARTIST, userId: transferArtistUserId };
  assert.equal(await callerBelongsToStudio(freshJwtUser, currentHomeStudioId), true);
});

test("activeStudioIdsForCaller: resolves to the CURRENT home even when passed a stale JWT claiming the former one", async () => {
  const staleJwtUser = { studioId: formerHomeStudioId, role: Role.ARTIST, userId: transferArtistUserId };
  const ids = await activeStudioIdsForCaller(staleJwtUser);
  assert.deepEqual(ids, [currentHomeStudioId]);
});

test("GET /flash-pieces: a stale JWT claiming the FORMER home studio still only ever sees the CURRENT home's pieces", async () => {
  // The token itself carries the OLD studioId -- exactly what a second
  // device/tab that hasn't refreshed its token yet would send.
  const staleToken = tokenFor(transferArtistUserId, formerHomeStudioId, Role.ARTIST);
  const res = await fetch(`${baseUrl}/flash-pieces`, { headers: { Authorization: `Bearer ${staleToken}` } });
  assert.equal(res.status, 200);
  const pieces = (await res.json()) as { id: string }[];
  assert.ok(
    !pieces.some((p) => p.id === transferFlashPieceId),
    "the former home studio's flash piece must not appear even when the request's own JWT still claims that studio",
  );
});
