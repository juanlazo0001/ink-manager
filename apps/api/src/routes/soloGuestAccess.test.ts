// Regression coverage for the solo-guest access fix (REPORT.md:
// "Solo-guest 403 investigation" -> "Build the solo-guest access fix").
// Root cause: artistAccess.ts's callerBelongsToStudio/activeStudioIdsForCaller
// used to dispatch on the caller's literal global role (`=== Role.ARTIST`)
// to decide whether to resolve membership from the DB at all -- missing a
// solo studio-of-one whose own account is role OWNER but who ALSO has an
// Artist profile and guests elsewhere. Fixed via effectiveRoleAt: role is
// resolved PER STUDIO (real global role at home, always ARTIST at any
// studio reached only via an active GUEST membership), and every primitive
// built on it (hasPermissionAt, hasPermissionOrSoloArtistAt,
// activeStudioIdsForCaller) plus three "kin" call sites that reimplemented
// the same dispatch inline (flashPieces.ts, lib/conversations.ts,
// deposits.ts/waivers.ts) now go through it.
//
// Two directions matter equally here, per the task's own explicit rule 2:
// under-fixing leaves the original 403; over-fixing (passing the caller's
// raw global OWNER role into a permission check once membership is
// recognized) would grant unconditional OWNER-level access at every studio
// a solo owner merely guests at -- hasPermission short-circuits `true` for
// OWNER, so that direction is the more dangerous one to miss. Every
// "negative" test below exists specifically to catch that regression, not
// just the original bug.
//
// Four personas exercise inquiries/appointments/conversations/flash-pieces
// against a real, non-solo, multi-staff host studio:
// - soloOwnerArtist: role OWNER at their own solo studio-of-one, ALSO has
//   an Artist profile, ALSO an active GUEST at hostStudio. The bug's own
//   subject.
// - plainGuestArtist: role ARTIST at a normal (non-solo) home studio, ALSO
//   an active GUEST at hostStudio -- the already-correct control this
//   fix must not disturb.
// - homeOnlyArtist: role ARTIST, no guest memberships anywhere -- the
//   simplest possible case, must be completely unaffected.
// - hostOwner: real OWNER staff at hostStudio -- staff-at-their-own-studio
//   sanity, must be completely unaffected.

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
import appointmentsRouter from "./appointments";
import conversationsRouter from "./conversations";
import flashPiecesRouter from "./flashPieces";
import { staffRouter as depositFormsRouter } from "./deposits";
import { staffRouter as waiversStaffRouter } from "./waivers";

function tokenFor(userId: string, studioId: string, role: Role): string {
  return jwt.sign({ userId, studioId, role }, JWT_SECRET);
}

const suffix = `sga-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let server: http.Server;
let baseUrl: string;

const studioIds: string[] = [];
const userIds: string[] = [];
const artistIds: string[] = [];
const clientIds: string[] = [];
const serviceIds: string[] = [];
const inquiryIds: string[] = [];
const appointmentIds: string[] = [];
const conversationIds: string[] = [];
const flashPieceIds: string[] = [];
const waiverIds: string[] = [];

let soloStudioId: string;
let hostStudioId: string;
let plainGuestHomeStudioId: string;
let homeOnlyStudioId: string;

let soloOwnerArtistUserId: string;
let soloOwnerArtistId: string;
let plainGuestArtistUserId: string;
let plainGuestArtistId: string;
let homeOnlyArtistUserId: string;
let homeOnlyArtistId: string;
let hostOwnerUserId: string;
let hostHomeArtistUserId: string;
let hostHomeArtistId: string;

let soloOwnerInquiryAtHost: string;
let plainGuestInquiryAtHost: string;
let homeOnlyInquiryAtHome: string;
let hostStaffInquiryAtHost: string;

let soloOwnerApptAtHost: string;
let soloOwnerApptForApproveTest: string;
let plainGuestApptAtHost: string;

let soloOwnerOwnStaffConvo: string;
let hostOtherStaffConvo: string;

let soloOwnerFlashPieceAtHost: string;
let hostHomeArtistFlashPieceAtHost: string;

let soloOwnerDepositFormAtHost: string;
let soloOwnerWaiverAtHost: string;

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

async function makeClient(studioId: string, tag: string): Promise<string> {
  const client = await prisma.client.create({
    data: { studioId, firstName: "Test", lastName: "Client", referralCode: `${suffix}-${tag}-ref` },
  });
  clientIds.push(client.id);
  return client.id;
}

let nextOffsetHours = 24;
function reserveOffsetHours(): number {
  const offset = nextOffsetHours;
  nextOffsetHours += 6;
  return offset;
}

async function makeInquiry(studioId: string, artistId: string, serviceId: string, tag: string): Promise<string> {
  const clientId = await makeClient(studioId, tag);
  const inquiry = await prisma.inquiry.create({
    data: {
      studioId,
      clientId,
      serviceId,
      assignedArtistId: artistId,
      channel: "EMAIL",
      description: "Solo-guest access regression test",
      colorOrBlackGrey: "Color",
      placement: "Forearm",
      estimatedSize: "Small",
      hasBeenTattooedBefore: false,
      priceEstimateLow: 100,
      priceEstimateHigh: 200,
      status: "ARTIST_ASSIGNED",
    },
  });
  inquiryIds.push(inquiry.id);
  return inquiry.id;
}

async function makeRequestedAppointment(studioId: string, artistId: string, serviceId: string, tag: string): Promise<string> {
  const offsetHours = reserveOffsetHours();
  const clientId = await makeClient(studioId, `${tag}-appt`);
  const inquiry = await prisma.inquiry.create({
    data: {
      studioId,
      clientId,
      serviceId,
      assignedArtistId: artistId,
      channel: "EMAIL",
      description: "Solo-guest access regression test appointment",
      colorOrBlackGrey: "Color",
      placement: "Forearm",
      estimatedSize: "Small",
      hasBeenTattooedBefore: false,
      priceEstimateLow: 100,
      priceEstimateHigh: 200,
    },
  });
  inquiryIds.push(inquiry.id);
  const appointment = await prisma.appointment.create({
    data: {
      studioId,
      artistId,
      clientId,
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
  soloStudioId = await makeStudio("solo");
  hostStudioId = await makeStudio("host");
  plainGuestHomeStudioId = await makeStudio("plain-guest-home");
  homeOnlyStudioId = await makeStudio("home-only");

  // hostStudio needs a real gatekeeper so it is genuinely NOT solo, and
  // its ARTIST matrix explicitly DENIES appointments.reschedule -- the
  // critical "no escalation" test needs a permission the solo owner's
  // home OWNER role would trivially have, but the host's real ARTIST
  // matrix does not.
  const hostOwner = await prisma.user.create({
    data: { email: `${suffix}-host-owner@test.invalid`, role: Role.OWNER, studioId: hostStudioId },
  });
  hostOwnerUserId = hostOwner.id;
  userIds.push(hostOwnerUserId);
  await prisma.rolePermission.create({
    data: { studioId: hostStudioId, role: Role.ARTIST, permissionKey: "appointments.reschedule", allowed: false },
  });

  // Another real artist at hostStudio (HOME there) -- the "different
  // artist's own piece" the solo-owner guest must never be able to touch.
  const hostHomeArtistUser = await prisma.user.create({
    data: { email: `${suffix}-host-home-artist@test.invalid`, role: Role.ARTIST, studioId: hostStudioId },
  });
  hostHomeArtistUserId = hostHomeArtistUser.id;
  userIds.push(hostHomeArtistUserId);
  const hostHomeArtist = await prisma.artist.create({ data: { userId: hostHomeArtistUserId, specialties: [], portfolioImages: [] } });
  hostHomeArtistId = hostHomeArtist.id;
  artistIds.push(hostHomeArtistId);

  // Solo owner-artist: role OWNER, the ONLY active user at soloStudio, ALSO
  // has an Artist profile, ALSO an active GUEST at hostStudio.
  const soloOwnerUser = await prisma.user.create({
    data: { email: `${suffix}-solo-owner-artist@test.invalid`, role: Role.OWNER, studioId: soloStudioId },
  });
  soloOwnerArtistUserId = soloOwnerUser.id;
  userIds.push(soloOwnerArtistUserId);
  const soloOwnerArtist = await prisma.artist.create({ data: { userId: soloOwnerArtistUserId, specialties: [], portfolioImages: [] } });
  soloOwnerArtistId = soloOwnerArtist.id;
  artistIds.push(soloOwnerArtistId);
  await prisma.studioMembership.create({
    data: { studioId: hostStudioId, artistId: soloOwnerArtistId, type: StudioMembershipType.GUEST },
  });

  // Plain guest artist: role ARTIST at a normal home, ALSO an active GUEST
  // at hostStudio -- same relationship shape as soloOwnerArtist, minus the
  // OWNER-at-home complication. Every assertion this fix makes for the solo
  // owner must ALSO still hold, unchanged, for this control.
  const plainGuestUser = await prisma.user.create({
    data: { email: `${suffix}-plain-guest-artist@test.invalid`, role: Role.ARTIST, studioId: plainGuestHomeStudioId },
  });
  plainGuestArtistUserId = plainGuestUser.id;
  userIds.push(plainGuestArtistUserId);
  const plainGuestArtist = await prisma.artist.create({ data: { userId: plainGuestArtistUserId, specialties: [], portfolioImages: [] } });
  plainGuestArtistId = plainGuestArtist.id;
  artistIds.push(plainGuestArtistId);
  await prisma.studioMembership.create({
    data: { studioId: hostStudioId, artistId: plainGuestArtistId, type: StudioMembershipType.GUEST },
  });

  // Home-only artist: role ARTIST, zero guest memberships anywhere.
  const homeOnlyUser = await prisma.user.create({
    data: { email: `${suffix}-home-only-artist@test.invalid`, role: Role.ARTIST, studioId: homeOnlyStudioId },
  });
  homeOnlyArtistUserId = homeOnlyUser.id;
  userIds.push(homeOnlyArtistUserId);
  const homeOnlyArtist = await prisma.artist.create({ data: { userId: homeOnlyArtistUserId, specialties: [], portfolioImages: [] } });
  homeOnlyArtistId = homeOnlyArtist.id;
  artistIds.push(homeOnlyArtistId);

  const hostServiceId = await makeService(hostStudioId);
  const homeOnlyServiceId = await makeService(homeOnlyStudioId);

  // Inquiries
  soloOwnerInquiryAtHost = await makeInquiry(hostStudioId, soloOwnerArtistId, hostServiceId, "solo-inq");
  plainGuestInquiryAtHost = await makeInquiry(hostStudioId, plainGuestArtistId, hostServiceId, "plain-inq");
  homeOnlyInquiryAtHome = await makeInquiry(homeOnlyStudioId, homeOnlyArtistId, homeOnlyServiceId, "homeonly-inq");
  hostStaffInquiryAtHost = await makeInquiry(hostStudioId, hostHomeArtistId, hostServiceId, "hoststaff-inq");

  // Appointments
  soloOwnerApptAtHost = await makeRequestedAppointment(hostStudioId, soloOwnerArtistId, hostServiceId, "solo");
  soloOwnerApptForApproveTest = await makeRequestedAppointment(hostStudioId, soloOwnerArtistId, hostServiceId, "solo-approve");
  plainGuestApptAtHost = await makeRequestedAppointment(hostStudioId, plainGuestArtistId, hostServiceId, "plain");

  // Conversations: solo owner's own STAFF thread at host (must be visible
  // to them), and a DIFFERENT host staff member's own STAFF thread (must
  // NOT be visible to the solo-owner guest -- the over-permission check).
  const ownConvo = await prisma.conversation.create({
    data: { studioId: hostStudioId, type: "STAFF", staffUserId: soloOwnerArtistUserId },
  });
  soloOwnerOwnStaffConvo = ownConvo.id;
  conversationIds.push(ownConvo.id);

  const otherConvo = await prisma.conversation.create({
    data: { studioId: hostStudioId, type: "STAFF", staffUserId: hostHomeArtistUserId },
  });
  hostOtherStaffConvo = otherConvo.id;
  conversationIds.push(otherConvo.id);

  // Flash pieces: solo owner's own piece at host (self-edit must work), and
  // a DIFFERENT host artist's own piece (must stay untouchable).
  const ownPiece = await prisma.flashPiece.create({
    data: {
      studioId: hostStudioId,
      artistId: soloOwnerArtistId,
      imageUrl: "https://example.test/own.png",
      title: "Solo owner's own piece",
      priceCents: 10000,
      estimatedDurationMinutes: 60,
    },
  });
  soloOwnerFlashPieceAtHost = ownPiece.id;
  flashPieceIds.push(ownPiece.id);

  const otherPiece = await prisma.flashPiece.create({
    data: {
      studioId: hostStudioId,
      artistId: hostHomeArtistId,
      imageUrl: "https://example.test/other.png",
      title: "Different host artist's piece",
      priceCents: 15000,
      estimatedDurationMinutes: 90,
    },
  });
  hostHomeArtistFlashPieceAtHost = otherPiece.id;
  flashPieceIds.push(otherPiece.id);

  // Deposit form + waiver, both tied to the solo owner's own host work --
  // regression coverage for the deposits.ts/waivers.ts "kin" fixes.
  const depositForm = await prisma.depositForm.create({
    data: {
      inquiryId: soloOwnerInquiryAtHost,
      token: `${suffix}-deposit-token`,
      tokenExpiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      depositAmount: 100,
      feeAmount: 10,
      totalCharged: 110,
      // GET /:id/pdf 400s on an unsigned form regardless of permission --
      // signed here so this fixture actually exercises the permission path
      // under test, not that unrelated validation.
      signedAt: new Date(),
      signatureName: "Solo Owner Artist",
    },
  });
  soloOwnerDepositFormAtHost = depositForm.id;

  const waiver = await prisma.liabilityWaiver.create({
    data: {
      studioId: hostStudioId,
      clientId: (await prisma.appointment.findUniqueOrThrow({ where: { id: soloOwnerApptAtHost }, select: { clientId: true } })).clientId,
      appointmentId: soloOwnerApptAtHost,
      healthQuestionsSnapshot: [],
      clausesSnapshot: [],
    },
  });
  soloOwnerWaiverAtHost = waiver.id;
  waiverIds.push(waiver.id);

  const app = express();
  app.use(express.json());
  app.use("/inquiries", inquiriesRouter);
  app.use("/appointments", appointmentsRouter);
  app.use("/conversations", conversationsRouter);
  app.use("/flash-pieces", flashPiecesRouter);
  app.use("/deposit-forms", depositFormsRouter);
  app.use("/waivers", waiversStaffRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));

  await prisma.liabilityWaiver.deleteMany({ where: { id: { in: waiverIds } } });
  await prisma.depositForm.deleteMany({ where: { inquiryId: soloOwnerInquiryAtHost } });
  await prisma.flashPiece.deleteMany({ where: { id: { in: flashPieceIds } } });
  await prisma.conversation.deleteMany({ where: { id: { in: conversationIds } } });
  await prisma.appointment.deleteMany({ where: { id: { in: appointmentIds } } });
  await prisma.inquiry.deleteMany({ where: { id: { in: inquiryIds } } });
  await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
  await prisma.service.deleteMany({ where: { id: { in: serviceIds } } });
  await prisma.intakeForm.deleteMany({ where: { studioId: { in: studioIds } } });
  await prisma.studioMembership.deleteMany({ where: { artistId: { in: artistIds } } });
  await prisma.artist.deleteMany({ where: { id: { in: artistIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.rolePermission.deleteMany({ where: { studioId: { in: studioIds } } });
  await prisma.auditLog.deleteMany({ where: { studioId: { in: studioIds } } });
  await prisma.studio.deleteMany({ where: { id: { in: studioIds } } });
});

// --- Inquiries -------------------------------------------------------

test("[inquiries] solo owner-artist: host inquiry blended into the staff LIST (GET /)", async () => {
  const token = tokenFor(soloOwnerArtistUserId, soloStudioId, Role.OWNER);
  const res = await fetch(`${baseUrl}/inquiries/`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(res.status, 200);
  const body = (await res.json()) as Array<{ id: string; fromGuestStudio: { id: string } | null }>;
  const row = body.find((i) => i.id === soloOwnerInquiryAtHost);
  assert.ok(row, "the solo owner's host-guest inquiry must appear in their blended list");
  assert.equal(row!.fromGuestStudio?.id, hostStudioId);
});

test("[inquiries] solo owner-artist: host inquiry DETAIL via /assigned-to-me/:id -> 200 (the original bug, now fixed)", async () => {
  const token = tokenFor(soloOwnerArtistUserId, soloStudioId, Role.OWNER);
  const res = await fetch(`${baseUrl}/inquiries/assigned-to-me/${soloOwnerInquiryAtHost}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200);
});

test("[inquiries] solo owner-artist: CANNOT reach the host's full STAFF detail view (GET /:id) -> 404", async () => {
  const token = tokenFor(soloOwnerArtistUserId, soloStudioId, Role.OWNER);
  const res = await fetch(`${baseUrl}/inquiries/${soloOwnerInquiryAtHost}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 404, "their OWNER-at-home role must not leak into the host's staff-only projection");
});

test("[inquiries] solo owner-artist: CANNOT see a different host artist's assigned inquiry via /assigned-to-me/:id -> 404", async () => {
  const token = tokenFor(soloOwnerArtistUserId, soloStudioId, Role.OWNER);
  const res = await fetch(`${baseUrl}/inquiries/assigned-to-me/${hostStaffInquiryAtHost}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 404);
});

test("[inquiries] plain guest artist (control): host inquiry DETAIL via /assigned-to-me/:id -> 200, unchanged", async () => {
  const token = tokenFor(plainGuestArtistUserId, plainGuestHomeStudioId, Role.ARTIST);
  const res = await fetch(`${baseUrl}/inquiries/assigned-to-me/${plainGuestInquiryAtHost}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200);
});

test("[inquiries] home-only artist (control): own inquiry DETAIL -> 200, unchanged", async () => {
  const token = tokenFor(homeOnlyArtistUserId, homeOnlyStudioId, Role.ARTIST);
  const res = await fetch(`${baseUrl}/inquiries/assigned-to-me/${homeOnlyInquiryAtHome}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200);
});

test("[inquiries] host OWNER staff (control): full staff DETAIL at their own studio -> 200, unchanged", async () => {
  const token = tokenFor(hostOwnerUserId, hostStudioId, Role.OWNER);
  const res = await fetch(`${baseUrl}/inquiries/${soloOwnerInquiryAtHost}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200);
});

// --- Appointments ------------------------------------------------------

test("[appointments] solo owner-artist: host appointment blended into the LIST (GET /)", async () => {
  const token = tokenFor(soloOwnerArtistUserId, soloStudioId, Role.OWNER);
  const res = await fetch(`${baseUrl}/appointments/`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(res.status, 200);
  const body = (await res.json()) as Array<{ id: string }>;
  assert.ok(body.some((a) => a.id === soloOwnerApptAtHost));
});

test("[appointments] solo owner-artist: host appointment DETAIL (GET /:id) -> 200 (the original bug, now fixed)", async () => {
  const token = tokenFor(soloOwnerArtistUserId, soloStudioId, Role.OWNER);
  const res = await fetch(`${baseUrl}/appointments/${soloOwnerApptAtHost}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200);
});

test("[appointments] solo owner-artist: DENIED a permission at host their home OWNER role would trivially have (POST /:id/approve -> 403, NOT 200)", async () => {
  const token = tokenFor(soloOwnerArtistUserId, soloStudioId, Role.OWNER);
  const res = await fetch(`${baseUrl}/appointments/${soloOwnerApptForApproveTest}/approve`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(
    res.status,
    403,
    "critical over-permission check: hasPermission short-circuits true for OWNER -- this must evaluate the host's real ARTIST matrix (which denies appointments.reschedule), never the caller's raw OWNER role",
  );
  const appt = await prisma.appointment.findUnique({ where: { id: soloOwnerApptForApproveTest } });
  assert.equal(appt?.status, "REQUESTED", "must be left untouched, not silently confirmed");
});

test("[appointments] plain guest artist (control): host appointment DETAIL -> 200, unchanged", async () => {
  const token = tokenFor(plainGuestArtistUserId, plainGuestHomeStudioId, Role.ARTIST);
  const res = await fetch(`${baseUrl}/appointments/${plainGuestApptAtHost}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200);
});

test("[appointments] host OWNER staff (control): approve at their own studio -> 200, unchanged", async () => {
  const token = tokenFor(hostOwnerUserId, hostStudioId, Role.OWNER);
  const apptId = await makeRequestedAppointment(hostStudioId, hostHomeArtistId, serviceIds[0]!, "staff-sanity");
  const res = await fetch(`${baseUrl}/appointments/${apptId}/approve`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200);
});

// --- Conversations -------------------------------------------------------

test("[conversations] solo owner-artist: own STAFF thread at host visible in LIST (GET /)", async () => {
  const token = tokenFor(soloOwnerArtistUserId, soloStudioId, Role.OWNER);
  const res = await fetch(`${baseUrl}/conversations/`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(res.status, 200);
  const body = (await res.json()) as Array<{ id: string }>;
  assert.ok(body.some((c) => c.id === soloOwnerOwnStaffConvo), "their own guest-studio staff thread must be visible");
  assert.ok(
    !body.some((c) => c.id === hostOtherStaffConvo),
    "a DIFFERENT host staff member's private thread must NOT be visible -- the over-permission check",
  );
});

test("[conversations] solo owner-artist: own STAFF thread DETAIL (GET /:id/messages) -> 200 (the original bug, now fixed)", async () => {
  const token = tokenFor(soloOwnerArtistUserId, soloStudioId, Role.OWNER);
  const res = await fetch(`${baseUrl}/conversations/${soloOwnerOwnStaffConvo}/messages`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200);
});

test("[conversations] solo owner-artist: a DIFFERENT host staff member's thread -> 404 (the over-permission check, direct)", async () => {
  const token = tokenFor(soloOwnerArtistUserId, soloStudioId, Role.OWNER);
  const res = await fetch(`${baseUrl}/conversations/${hostOtherStaffConvo}/messages`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(
    res.status,
    404,
    "their home OWNER role's full staff-thread visibility must not leak into the host's own, artist-scoped '-own' rule",
  );
});

test("[conversations] host OWNER staff (control): can see the other host staff member's thread -> 200, unchanged", async () => {
  const token = tokenFor(hostOwnerUserId, hostStudioId, Role.OWNER);
  const res = await fetch(`${baseUrl}/conversations/${hostOtherStaffConvo}/messages`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200);
});

// --- Flash pieces -------------------------------------------------------

test("[flash-pieces] solo owner-artist: self-edit own piece at host (PATCH /:id) -> 200 (the original bug, now fixed)", async () => {
  const token = tokenFor(soloOwnerArtistUserId, soloStudioId, Role.OWNER);
  const res = await fetch(`${baseUrl}/flash-pieces/${soloOwnerFlashPieceAtHost}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ title: "Updated by solo owner-artist" }),
  });
  assert.equal(res.status, 200);
  const updated = await prisma.flashPiece.findUnique({ where: { id: soloOwnerFlashPieceAtHost } });
  assert.equal(updated?.title, "Updated by solo owner-artist");
});

test("[flash-pieces] solo owner-artist: CANNOT edit a DIFFERENT host artist's piece -> 403 (the over-permission check)", async () => {
  const token = tokenFor(soloOwnerArtistUserId, soloStudioId, Role.OWNER);
  const res = await fetch(`${baseUrl}/flash-pieces/${hostHomeArtistFlashPieceAtHost}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ title: "Should never land" }),
  });
  assert.equal(
    res.status,
    403,
    "must hit the same 'ARTIST can never touch a different artist's piece' hard block as any other guest -- not fall through to a staff flashGallery.manage grant via their OWNER-at-home role",
  );
  const untouched = await prisma.flashPiece.findUnique({ where: { id: hostHomeArtistFlashPieceAtHost } });
  assert.equal(untouched?.title, "Different host artist's piece");
});

test("[flash-pieces] host OWNER staff (control): can edit any artist's piece at their own studio -> 200, unchanged", async () => {
  const token = tokenFor(hostOwnerUserId, hostStudioId, Role.OWNER);
  const res = await fetch(`${baseUrl}/flash-pieces/${hostHomeArtistFlashPieceAtHost}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ title: "Edited by host owner" }),
  });
  assert.equal(res.status, 200);
});

// --- Deposits / Waivers (the other "kin" fixes) --------------------------

test("[deposit-forms] solo owner-artist: GET /:id/pdf for their own host project -> 200 (kin fix)", async () => {
  const token = tokenFor(soloOwnerArtistUserId, soloStudioId, Role.OWNER);
  const res = await fetch(`${baseUrl}/deposit-forms/${soloOwnerDepositFormAtHost}/pdf`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200);
});

test("[waivers] solo owner-artist: GET /:id/status for their own host appointment's waiver -> 200 (kin fix)", async () => {
  const token = tokenFor(soloOwnerArtistUserId, soloStudioId, Role.OWNER);
  const res = await fetch(`${baseUrl}/waivers/${soloOwnerWaiverAtHost}/status`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200);
});
