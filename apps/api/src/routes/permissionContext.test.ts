// Regression coverage for the permission-context fix (REPORT.md:
// "Investigation: permission context is home-studio-scoped, not
// record-studio-scoped" and its follow-up fix entry). Converts both
// adversarial repros that investigation confirmed with real HTTP into
// permanent tests, plus their positive twins -- same "real Prisma, real
// HTTP, self-contained fixtures created here and torn down in `after`"
// convention as artistMobility.test.ts. Run with
// `npx tsx --test src/routes/permissionContext.test.ts` (or `npm test`).
//
// Four scenarios, in order:
//
// 1. NEGATIVE (the confirmed hole, part a): a guest artist whose HOME
//    studio grants appointments.reschedule must NOT be able to approve an
//    appointment at a HOST studio that denies ARTIST that permission --
//    before the fix, this returned 200.
//
// 2. POSITIVE twin of (1): the SAME shape, except the HOST studio itself
//    grants the permission (regardless of what the artist's own, entirely
//    different, home studio allows) -- must succeed. Proves the fix
//    checks the right studio, not just "always deny an ARTIST."
//
// 3. NEGATIVE (the confirmed hole, part b): a genuinely solo (studio-of-
//    one) artist's scheduling autonomy must NOT travel to a real
//    multi-staff studio they're only guesting at -- before the fix, this
//    returned 200 via the solo bypass evaluated against the wrong studio.
//
// 4. POSITIVE twin of (3): the SAME solo artist, acting at their OWN
//    studio -- the bypass must still work there. Proves the fix narrowed
//    the bypass correctly rather than breaking it outright.
//
// Plus one staff sanity check: an OWNER at the host studio can still
// approve appointments there -- the refactor from middleware to an inline,
// record-scoped check must not have changed staff behavior at all (this
// fix's own rule 4).

import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma";
import { JWT_SECRET } from "../lib/jwt";
import { Role } from "../../generated/prisma/enums";
import appointmentsRouter from "./appointments";

function tokenFor(userId: string, studioId: string, role: Role): string {
  return jwt.sign({ userId, studioId, role }, JWT_SECRET);
}

const suffix = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let server: http.Server;
let baseUrl: string;

// Studios
let guestHomeStudioId: string; // grants appointments.reschedule to ARTIST
let hostDenyStudioId: string; // multi-staff; denies appointments.reschedule to ARTIST
let guestHome2StudioId: string; // denies appointments.reschedule to ARTIST (proves host-grant doesn't need home's help)
let hostGrantStudioId: string; // multi-staff; grants appointments.reschedule to ARTIST
let soloStudioId: string; // genuinely solo -- exactly one active user, role ARTIST

// People
let guestArtistUserId: string;
let guestArtistId: string;
let guestArtist2UserId: string;
let guestArtist2Id: string;
let soloArtistUserId: string;
let soloArtistId: string;
let hostDenyOwnerUserId: string;

// Records (services/clients/inquiries per studio, appointments under test)
const studioIds: string[] = [];
const serviceIds: string[] = [];
const clientIds: string[] = [];
const inquiryIds: string[] = [];
const appointmentIds: string[] = [];

async function makeStudio(name: string) {
  const studio = await prisma.studio.create({ data: { slug: `${suffix}-${name}`, name: `Test ${name}` } });
  studioIds.push(studio.id);
  return studio.id;
}

async function makeService(studioId: string) {
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

// Distinct, well-separated offsets per fixture -- findBufferConflict is
// deliberately status-agnostic (a REQUESTED row blocks a same-artist
// window exactly like a CONFIRMED one), and guestArtistId/soloArtistId
// each own two fixture appointments here, so overlapping default windows
// would make one test's REQUESTED row spuriously 409-block another test's
// otherwise-unrelated approve call.
let nextOffsetHours = 24;
function reserveOffsetHours(): number {
  const offset = nextOffsetHours;
  nextOffsetHours += 6;
  return offset;
}

async function makeRequestedAppointment(studioId: string, artistId: string, serviceId: string) {
  // Reserved synchronously, before any `await` below, so concurrent
  // Promise.all() calls to this function still get distinct, deterministic
  // offsets regardless of resolution order.
  const offsetHours = reserveOffsetHours();
  const client = await prisma.client.create({
    data: { studioId, firstName: "Test", lastName: "Client", referralCode: `${suffix}-${offsetHours}-ref` },
  });
  clientIds.push(client.id);
  const inquiry = await prisma.inquiry.create({
    data: {
      studioId,
      clientId: client.id,
      serviceId,
      assignedArtistId: artistId,
      channel: "EMAIL",
      description: "Permission-context regression test",
      colorOrBlackGrey: "Color",
      placement: "Forearm",
      estimatedSize: "Small",
      hasBeenTattooedBefore: false,
      // approve() checks this directly (400 before any mutation if
      // missing) regardless of permission outcome -- set on every fixture
      // so the 403 tests fail for the right reason and the 200 tests can
      // actually reach a real CONFIRMED status.
      priceEstimateLow: 100,
      priceEstimateHigh: 200,
    },
  });
  inquiryIds.push(inquiry.id);
  const appointment = await prisma.appointment.create({
    data: {
      studioId,
      artistId,
      clientId: client.id,
      inquiryId: inquiry.id,
      startTime: new Date(Date.now() + offsetHours * 60 * 60 * 1000),
      endTime: new Date(Date.now() + (offsetHours + 2) * 60 * 60 * 1000),
      status: "REQUESTED",
    },
  });
  appointmentIds.push(appointment.id);
  return appointment.id;
}

before(async () => {
  guestHomeStudioId = await makeStudio("guest-home");
  hostDenyStudioId = await makeStudio("host-deny");
  guestHome2StudioId = await makeStudio("guest-home-2");
  hostGrantStudioId = await makeStudio("host-grant");
  soloStudioId = await makeStudio("solo");

  await prisma.rolePermission.create({
    data: { studioId: guestHomeStudioId, role: Role.ARTIST, permissionKey: "appointments.reschedule", allowed: true },
  });
  await prisma.rolePermission.create({
    data: { studioId: hostDenyStudioId, role: Role.ARTIST, permissionKey: "appointments.reschedule", allowed: false },
  });
  await prisma.rolePermission.create({
    data: { studioId: guestHome2StudioId, role: Role.ARTIST, permissionKey: "appointments.reschedule", allowed: false },
  });
  await prisma.rolePermission.create({
    data: { studioId: hostGrantStudioId, role: Role.ARTIST, permissionKey: "appointments.reschedule", allowed: true },
  });

  // hostDenyStudio needs a real gatekeeper (OWNER) so it genuinely isn't
  // solo -- otherwise the solo-bypass scenario (3) would trivially pass
  // for the wrong reason.
  const hostDenyOwner = await prisma.user.create({
    data: { email: `${suffix}-host-deny-owner@test.invalid`, role: Role.OWNER, studioId: hostDenyStudioId },
  });
  hostDenyOwnerUserId = hostDenyOwner.id;

  // Guest artist #1: home = guestHomeStudio (grants), guest membership at
  // hostDenyStudio (denies).
  const guestArtistUser = await prisma.user.create({
    data: { email: `${suffix}-guest-artist@test.invalid`, role: Role.ARTIST, studioId: guestHomeStudioId },
  });
  guestArtistUserId = guestArtistUser.id;
  const guestArtist = await prisma.artist.create({ data: { userId: guestArtistUserId, specialties: [], portfolioImages: [] } });
  guestArtistId = guestArtist.id;
  await prisma.studioMembership.create({ data: { studioId: hostDenyStudioId, artistId: guestArtistId, type: "GUEST" } });

  // Guest artist #2: home = guestHome2Studio (denies), guest membership at
  // hostGrantStudio (grants) -- proves the host's own grant is sufficient
  // on its own, independent of home.
  const guestArtist2User = await prisma.user.create({
    data: { email: `${suffix}-guest-artist-2@test.invalid`, role: Role.ARTIST, studioId: guestHome2StudioId },
  });
  guestArtist2UserId = guestArtist2User.id;
  const guestArtist2 = await prisma.artist.create({ data: { userId: guestArtist2UserId, specialties: [], portfolioImages: [] } });
  guestArtist2Id = guestArtist2.id;
  await prisma.studioMembership.create({ data: { studioId: hostGrantStudioId, artistId: guestArtist2Id, type: "GUEST" } });

  // Solo artist: the ONLY active user at soloStudio, role ARTIST (not
  // OWNER -- see isSoloStudioArtist's own comment; OWNER would trivially
  // pass hasPermission without ever exercising the bypass), plus a GUEST
  // membership at hostDenyStudio (a real multi-staff studio -- their
  // autonomy must not travel there).
  const soloArtistUser = await prisma.user.create({
    data: { email: `${suffix}-solo-artist@test.invalid`, role: Role.ARTIST, studioId: soloStudioId },
  });
  soloArtistUserId = soloArtistUser.id;
  const soloArtist = await prisma.artist.create({ data: { userId: soloArtistUserId, specialties: [], portfolioImages: [] } });
  soloArtistId = soloArtist.id;
  await prisma.studioMembership.create({ data: { studioId: hostDenyStudioId, artistId: soloArtistId, type: "GUEST" } });

  const hostDenyServiceId = await makeService(hostDenyStudioId);
  const hostGrantServiceId = await makeService(hostGrantStudioId);
  const soloServiceId = await makeService(soloStudioId);

  await Promise.all([
    // Scenario 1 (negative): guestArtist acting at hostDenyStudio.
    makeRequestedAppointment(hostDenyStudioId, guestArtistId, hostDenyServiceId).then((id) => (apptGuestAtHostDeny = id)),
    // Scenario 2 (positive twin): guestArtist2 acting at hostGrantStudio.
    makeRequestedAppointment(hostGrantStudioId, guestArtist2Id, hostGrantServiceId).then((id) => (apptGuest2AtHostGrant = id)),
    // Scenario 3 (negative): soloArtist acting at hostDenyStudio (guesting).
    makeRequestedAppointment(hostDenyStudioId, soloArtistId, hostDenyServiceId).then((id) => (apptSoloAtHost = id)),
    // Scenario 4 (positive twin): soloArtist acting at their OWN studio.
    makeRequestedAppointment(soloStudioId, soloArtistId, soloServiceId).then((id) => (apptSoloAtHome = id)),
    // Staff sanity: an OWNER-created appointment at hostDenyStudio, for the
    // OWNER-can-still-approve check.
    makeRequestedAppointment(hostDenyStudioId, guestArtistId, hostDenyServiceId).then((id) => (apptForOwnerSanity = id)),
  ]);

  const app = express();
  app.use(express.json());
  app.use("/appointments", appointmentsRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

let apptGuestAtHostDeny: string;
let apptGuest2AtHostGrant: string;
let apptSoloAtHost: string;
let apptSoloAtHome: string;
let apptForOwnerSanity: string;

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));

  await prisma.appointment.deleteMany({ where: { id: { in: appointmentIds } } });
  await prisma.inquiry.deleteMany({ where: { id: { in: inquiryIds } } });
  await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
  await prisma.service.deleteMany({ where: { id: { in: serviceIds } } });
  await prisma.intakeForm.deleteMany({ where: { studioId: { in: studioIds } } });
  await prisma.studioMembership.deleteMany({ where: { artistId: { in: [guestArtistId, guestArtist2Id, soloArtistId] } } });
  await prisma.artist.deleteMany({ where: { id: { in: [guestArtistId, guestArtist2Id, soloArtistId] } } });
  await prisma.user.deleteMany({
    where: { id: { in: [guestArtistUserId, guestArtist2UserId, soloArtistUserId, hostDenyOwnerUserId] } },
  });
  await prisma.rolePermission.deleteMany({ where: { studioId: { in: studioIds } } });
  await prisma.auditLog.deleteMany({ where: { studioId: { in: studioIds } } });
  await prisma.studio.deleteMany({ where: { id: { in: studioIds } } });
});

test("guest artist: HOME grants appointments.reschedule, HOST denies -> 403 (the confirmed hole, now fixed)", async () => {
  const token = tokenFor(guestArtistUserId, guestHomeStudioId, Role.ARTIST);
  const res = await fetch(`${baseUrl}/appointments/${apptGuestAtHostDeny}/approve`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 403);

  const appointment = await prisma.appointment.findUnique({ where: { id: apptGuestAtHostDeny } });
  assert.equal(appointment?.status, "REQUESTED", "must be left untouched, not silently confirmed");
});

test("guest artist: HOST itself grants appointments.reschedule -> 200 (positive twin, home irrelevant)", async () => {
  const token = tokenFor(guestArtist2UserId, guestHome2StudioId, Role.ARTIST);
  const res = await fetch(`${baseUrl}/appointments/${apptGuest2AtHostGrant}/approve`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200);

  const appointment = await prisma.appointment.findUnique({ where: { id: apptGuest2AtHostGrant } });
  assert.equal(appointment?.status, "CONFIRMED");
});

test("solo artist guesting at a real multi-staff host -> 403 (the confirmed hole, now fixed)", async () => {
  const token = tokenFor(soloArtistUserId, soloStudioId, Role.ARTIST);
  const res = await fetch(`${baseUrl}/appointments/${apptSoloAtHost}/approve`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 403);

  const appointment = await prisma.appointment.findUnique({ where: { id: apptSoloAtHost } });
  assert.equal(appointment?.status, "REQUESTED", "must be left untouched, not silently confirmed");
});

test("solo artist at their OWN studio -> 200 (positive twin, autonomy still works at home)", async () => {
  const token = tokenFor(soloArtistUserId, soloStudioId, Role.ARTIST);
  const res = await fetch(`${baseUrl}/appointments/${apptSoloAtHome}/approve`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200);

  const appointment = await prisma.appointment.findUnique({ where: { id: apptSoloAtHome } });
  assert.equal(appointment?.status, "CONFIRMED");
});

test("staff sanity: OWNER at the host studio can still approve (refactor didn't change staff behavior)", async () => {
  const token = tokenFor(hostDenyOwnerUserId, hostDenyStudioId, Role.OWNER);
  const res = await fetch(`${baseUrl}/appointments/${apptForOwnerSanity}/approve`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200);

  const appointment = await prisma.appointment.findUnique({ where: { id: apptForOwnerSanity } });
  assert.equal(appointment?.status, "CONFIRMED");
});
