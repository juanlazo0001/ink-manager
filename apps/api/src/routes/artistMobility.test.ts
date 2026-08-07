// Regression coverage for the artist-mobility studio-scoping bug class
// (REPORT.md: "Artist-mobility studio-scoping audit" -- deposit-forms PDF
// export, plus the shared callerBelongsToStudio/studioHasActiveMembership
// primitives every other fix in that audit is built on). Run with
// `npx tsx --test src/routes/artistMobility.test.ts` (or `npm test`, which
// runs every *.test.ts). Real Prisma against the real dev database -- same
// "no mocking, no test framework beyond node:test" convention as
// lib/studioTime.test.ts -- with a self-contained fixture set created here
// and torn down in `after`, since this is a permanent, re-runnable
// regression test rather than one-off session verification (which is what
// this codebase's OTHER "leave test data in place" convention applies to).
//
// The bug, exactly: a whole family of routes authorized a caller against a
// record's studio with a plain `record.studioId === req.user!.studioId`
// equality check. req.user!.studioId is only the caller's HOME studio
// (copied from User.studioId at login) -- for an ARTIST with an active
// GUEST StudioMembership at a *different* studio, that equality check
// always 404'd them out of their own legitimately-assigned work at the
// guest studio. Fixed via callerBelongsToStudio (lib/artistAccess.ts),
// which additionally checks for an active membership (HOME or GUEST) at
// the record's own studio.

import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma";
import { JWT_SECRET } from "../lib/jwt";
import { Role } from "../../generated/prisma/enums";
import { callerBelongsToStudio, studioHasActiveMembership } from "../lib/artistAccess";
import { staffRouter as depositFormsRouter } from "./deposits";

function tokenFor(userId: string, studioId: string, role: Role): string {
  return jwt.sign({ userId, studioId, role }, JWT_SECRET);
}

const suffix = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let server: http.Server;
let baseUrl: string;

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

  // The guest artist: HOME at homeStudio, an active GUEST membership at
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

  // Minimal app: just the one router under test, mounted exactly like
  // index.ts mounts it -- no other app-level middleware needed for a
  // bearer-token GET.
  const app = express();
  app.use(express.json());
  app.use("/deposit-forms", depositFormsRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));

  await prisma.depositForm.deleteMany({ where: { id: depositFormId } });
  await prisma.inquiry.deleteMany({ where: { id: inquiryId } });
  await prisma.client.deleteMany({ where: { id: clientId } });
  await prisma.service.deleteMany({ where: { id: serviceId } });
  await prisma.intakeForm.deleteMany({ where: { id: intakeFormId } });
  await prisma.studioMembership.deleteMany({ where: { artistId: { in: [guestArtistId] } } });
  await prisma.artist.deleteMany({ where: { id: { in: [guestArtistId, outsiderArtistId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [guestArtistUserId, outsiderUserId] } } });
  await prisma.studio.deleteMany({ where: { id: { in: [homeStudioId, guestStudioId, unrelatedStudioId] } } });
});

test("callerBelongsToStudio: HOME artist matches their own studio with no extra query", async () => {
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
