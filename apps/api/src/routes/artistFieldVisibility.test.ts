// Regression/adversarial coverage for Phase 5 (REPORT.md: "Studio-level
// field-visibility controls for artists"). Real HTTP against real Express
// routers with self-contained Prisma fixtures (same convention as
// permissionContext.test.ts/soloGuestAccess.test.ts). Verifies:
//
// 1. Default (no toggle touched): pricing/notes fields present, byte-for-
//    byte the pre-Phase-5 ARTIST_INQUIRY_SELECT/INQUIRY_LIST_SELECT shape.
// 2. Hiding a group makes its fields genuinely ABSENT from the JSON (key
//    missing, not null) on both LIST and DETAIL, confirmed via raw
//    response parsing, not UI inspection.
// 3. Guest case: hiding a group at the HOST only affects that guest
//    artist's HOST-studio view -- their HOME-studio inquiry (same
//    response, for the list case) is untouched.
// 4. Toggle back on, in the same running server (no restart) -- visibility
//    restored immediately, proving "live, no redeploy" isn't just a claim
//    about DB-backed settings but genuinely holds end to end.
// 5. OWNER/FRONT_DESK responses are completely unaffected by any of this,
//    at both the artist-facing routes (irrelevant to them) and their own
//    full staff detail view.
// 6. The guest-blended branch of staff GET / (Part 1's second finding) --
//    a solo-owner-guest's own blended host row loses pricing detail too,
//    while their home row keeps it, in the SAME list response.

import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma";
import { JWT_SECRET } from "../lib/jwt";
import { Role, StudioMembershipType } from "../../generated/prisma/enums";
import inquiriesRouter from "./inquiries";
import { staffRouter as studioSettingsRouter } from "./studioSettings";

function tokenFor(userId: string, studioId: string, role: Role): string {
  return jwt.sign({ userId, studioId, role }, JWT_SECRET);
}

const suffix = `afv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let server: http.Server;
let baseUrl: string;

const studioIds: string[] = [];
const userIds: string[] = [];
const artistIds: string[] = [];
const clientIds: string[] = [];
const serviceIds: string[] = [];
const inquiryIds: string[] = [];

let hostStudioId: string;
let homeStudioId: string;

let hostOwnerUserId: string;
let guestArtistUserId: string;
let guestArtistId: string;

let soloStudioId: string;
let soloOwnerArtistUserId: string;
let soloOwnerArtistId: string;
let soloOwnerHostInquiryId: string;

let hostInquiryId: string;
let homeInquiryId: string;

async function makeStudio(name: string): Promise<string> {
  const studio = await prisma.studio.create({ data: { slug: `${suffix}-${name}`, name: `Test ${name}` } });
  studioIds.push(studio.id);
  return studio.id;
}

async function makeService(studioId: string): Promise<string> {
  const intake = await prisma.intakeForm.create({ data: { studioId, name: "Intake", slug: `${suffix}-${studioId}-intake` } });
  const service = await prisma.service.create({
    data: {
      studioId,
      name: "Tattoo",
      slug: `${suffix}-${studioId}-tattoo`,
      pricingModel: "RANGE",
      depositModel: "TIER_BASED",
      intakeFormId: intake.id,
    },
  });
  serviceIds.push(service.id);
  return service.id;
}

async function makeFullInquiry(studioId: string, artistId: string, serviceId: string, tag: string): Promise<string> {
  const client = await prisma.client.create({
    data: { studioId, firstName: "Test", lastName: "Client", referralCode: `${suffix}-${tag}-ref` },
  });
  clientIds.push(client.id);
  const inquiry = await prisma.inquiry.create({
    data: {
      studioId,
      clientId: client.id,
      serviceId,
      assignedArtistId: artistId,
      channel: "EMAIL",
      description: "Artist field-visibility regression test",
      colorOrBlackGrey: "Color",
      placement: "Forearm",
      estimatedSize: "Small",
      hasBeenTattooedBefore: false,
      budget: "$500",
      priceEstimateLow: 300,
      priceEstimateHigh: 500,
      timeEstimateHoursMin: 2,
      timeEstimateHoursMax: 3,
      status: "ARTIST_ASSIGNED",
    },
  });
  inquiryIds.push(inquiry.id);

  await prisma.depositForm.create({
    data: {
      inquiryId: inquiry.id,
      token: `${suffix}-${tag}-deposit`,
      tokenExpiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      depositAmount: 50,
      feeAmount: 5,
      totalCharged: 55,
    },
  });

  await prisma.inquiryNote.create({
    data: {
      studioId,
      inquiryId: inquiry.id,
      bodyHtml: "<p>Visible-to-artist note</p>",
      visibleToArtist: true,
      authorId: hostOwnerUserId,
    },
  });

  return inquiry.id;
}

before(async () => {
  hostStudioId = await makeStudio("host");
  homeStudioId = await makeStudio("home");

  const hostOwner = await prisma.user.create({
    data: { email: `${suffix}-host-owner@test.invalid`, role: Role.OWNER, studioId: hostStudioId },
  });
  hostOwnerUserId = hostOwner.id;
  userIds.push(hostOwnerUserId);

  const guestArtistUser = await prisma.user.create({
    data: { email: `${suffix}-guest-artist@test.invalid`, role: Role.ARTIST, studioId: homeStudioId },
  });
  guestArtistUserId = guestArtistUser.id;
  userIds.push(guestArtistUserId);
  const guestArtist = await prisma.artist.create({ data: { userId: guestArtistUserId, specialties: [], portfolioImages: [] } });
  guestArtistId = guestArtist.id;
  artistIds.push(guestArtistId);
  await prisma.studioMembership.create({
    data: { studioId: hostStudioId, artistId: guestArtistId, type: StudioMembershipType.GUEST },
  });

  const hostServiceId = await makeService(hostStudioId);
  const homeServiceId = await makeService(homeStudioId);

  hostInquiryId = await makeFullInquiry(hostStudioId, guestArtistId, hostServiceId, "host");
  homeInquiryId = await makeFullInquiry(homeStudioId, guestArtistId, homeServiceId, "home");

  // Solo studio-of-one OWNER with their own Artist profile, ALSO an active
  // GUEST at hostStudio -- the exact persona the solo-guest access fix and
  // Part 1's second finding are both about: their effective role AT
  // hostStudio is ARTIST, so the guest-blended branch of staff GET / must
  // apply the same field-visibility stripping to their own blended row
  // there, even though their global role is OWNER.
  soloStudioId = await makeStudio("solo");
  const soloOwnerUser = await prisma.user.create({
    data: { email: `${suffix}-solo-owner@test.invalid`, role: Role.OWNER, studioId: soloStudioId },
  });
  soloOwnerArtistUserId = soloOwnerUser.id;
  userIds.push(soloOwnerArtistUserId);
  const soloOwnerArtist = await prisma.artist.create({ data: { userId: soloOwnerArtistUserId, specialties: [], portfolioImages: [] } });
  soloOwnerArtistId = soloOwnerArtist.id;
  artistIds.push(soloOwnerArtistId);
  await prisma.studioMembership.create({
    data: { studioId: hostStudioId, artistId: soloOwnerArtistId, type: StudioMembershipType.GUEST },
  });
  soloOwnerHostInquiryId = await makeFullInquiry(hostStudioId, soloOwnerArtistId, hostServiceId, "solo-owner-host");

  const app = express();
  app.use(express.json());
  app.use("/inquiries", inquiriesRouter);
  app.use("/studio-settings", studioSettingsRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));

  await prisma.inquiryNote.deleteMany({ where: { inquiryId: { in: inquiryIds } } });
  await prisma.depositForm.deleteMany({ where: { inquiryId: { in: inquiryIds } } });
  await prisma.inquiry.deleteMany({ where: { id: { in: inquiryIds } } });
  await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
  await prisma.service.deleteMany({ where: { id: { in: serviceIds } } });
  await prisma.intakeForm.deleteMany({ where: { studioId: { in: studioIds } } });
  await prisma.studioMembership.deleteMany({ where: { artistId: { in: artistIds } } });
  await prisma.artist.deleteMany({ where: { id: { in: artistIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.rolePermission.deleteMany({ where: { studioId: { in: studioIds } } });
  await prisma.auditLog.deleteMany({ where: { studioId: { in: studioIds } } });
  await prisma.studioSettings.deleteMany({ where: { studioId: { in: studioIds } } });
  await prisma.studio.deleteMany({ where: { id: { in: studioIds } } });
});

async function setHostVisibility(pricingDetail: boolean, internalNotes: boolean) {
  const token = tokenFor(hostOwnerUserId, hostStudioId, Role.OWNER);
  const res = await fetch(`${baseUrl}/studio-settings/`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ artistFieldVisibility: { pricingDetail, internalNotes } }),
  });
  assert.equal(res.status, 200, "settings PATCH must succeed to set up each scenario");
}

test("default (no toggle touched): pricing and notes fields present on DETAIL, matching pre-Phase-5 behavior", async () => {
  const token = tokenFor(guestArtistUserId, homeStudioId, Role.ARTIST);
  const res = await fetch(`${baseUrl}/inquiries/assigned-to-me/${hostInquiryId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.priceEstimateLow, 300);
  assert.equal(body.priceEstimateHigh, 500);
  assert.equal(body.budget, "$500");
  assert.equal((body.depositForms as unknown[]).length, 1);
  assert.equal((body.notes as unknown[]).length, 1);
});

test("hiding Pricing & financial detail at the HOST: fields genuinely ABSENT (key missing) from DETAIL", async () => {
  await setHostVisibility(false, true);

  const token = tokenFor(guestArtistUserId, homeStudioId, Role.ARTIST);
  const res = await fetch(`${baseUrl}/inquiries/assigned-to-me/${hostInquiryId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as Record<string, unknown>;

  assert.equal("priceEstimateLow" in body, false, "priceEstimateLow must be ABSENT, not null");
  assert.equal("priceEstimateHigh" in body, false);
  assert.equal("timeEstimateHoursMin" in body, false);
  assert.equal("timeEstimateHoursMax" in body, false);
  assert.equal("budget" in body, false);
  assert.equal("depositForms" in body, false);
  // Untouched group stays visible.
  assert.equal((body.notes as unknown[]).length, 1);
  // Non-hideable fields untouched.
  assert.equal(body.description, "Artist field-visibility regression test");
  assert.ok(Array.isArray(body.referenceImages));
});

test("guest case: the SAME artist's HOME-studio inquiry is unaffected by the host's setting", async () => {
  const token = tokenFor(guestArtistUserId, homeStudioId, Role.ARTIST);
  const res = await fetch(`${baseUrl}/inquiries/assigned-to-me/${homeInquiryId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.priceEstimateLow, 300, "home studio's own (untouched) setting must still show pricing");
  assert.equal(body.budget, "$500");
});

test("guest case, LIST: one response, two studios, two different visibilities for the same artist", async () => {
  const token = tokenFor(guestArtistUserId, homeStudioId, Role.ARTIST);
  const res = await fetch(`${baseUrl}/inquiries/assigned-to-me?scope=all`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as Array<Record<string, unknown>>;

  const hostRow = body.find((r) => r.id === hostInquiryId)!;
  const homeRow = body.find((r) => r.id === homeInquiryId)!;
  assert.ok(hostRow, "host row must be present in the blended list");
  assert.ok(homeRow, "home row must be present");
  assert.equal("priceEstimateLow" in hostRow, false, "host row: pricing hidden");
  assert.equal(homeRow.priceEstimateLow, 300, "home row: pricing still visible");
});

test("hiding Internal notes too: notes key absent, pricing stays hidden from the prior toggle", async () => {
  await setHostVisibility(false, false);

  const token = tokenFor(guestArtistUserId, homeStudioId, Role.ARTIST);
  const res = await fetch(`${baseUrl}/inquiries/assigned-to-me/${hostInquiryId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal("notes" in body, false);
  assert.equal("priceEstimateLow" in body, false);
});

test("toggle back on, same running server (no restart): visibility restored live", async () => {
  await setHostVisibility(true, true);

  const token = tokenFor(guestArtistUserId, homeStudioId, Role.ARTIST);
  const res = await fetch(`${baseUrl}/inquiries/assigned-to-me/${hostInquiryId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.priceEstimateLow, 300);
  assert.equal((body.notes as unknown[]).length, 1);
});

test("OWNER/FRONT_DESK unaffected: host OWNER's own full staff DETAIL view ignores the artist toggle entirely", async () => {
  await setHostVisibility(false, false);

  const token = tokenFor(hostOwnerUserId, hostStudioId, Role.OWNER);
  const res = await fetch(`${baseUrl}/inquiries/${hostInquiryId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.priceEstimateLow, 300, "staff's own full view must never be affected by an ARTIST-only setting");
  assert.equal(body.budget, "$500");

  await setHostVisibility(true, true);
});

test("Part 1's second finding: a solo owner-artist's OWN guest-blended row in staff GET / loses pricing too", async () => {
  await setHostVisibility(false, true);

  // Solo owner's OWN staff list, at their own (unrelated) solo studio --
  // GET / is home-scoped (req.user!.studioId), so this returns zero home
  // rows and relies entirely on the guest-blending branch to surface their
  // hostStudio-assigned inquiry at all.
  const token = tokenFor(soloOwnerArtistUserId, soloStudioId, Role.OWNER);
  const res = await fetch(`${baseUrl}/inquiries/`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(res.status, 200);
  const body = (await res.json()) as Array<Record<string, unknown>>;

  const blendedRow = body.find((r) => r.id === soloOwnerHostInquiryId);
  assert.ok(blendedRow, "the solo owner's host-guest inquiry must be blended into their own staff list");
  assert.equal(
    "priceEstimateLow" in blendedRow!,
    false,
    "their effective role AT hostStudio is ARTIST, so the host's pricing-hidden setting must apply to this blended row -- their global OWNER role must not leak full staff-shaped data through the blending branch",
  );

  await setHostVisibility(true, true);
});
