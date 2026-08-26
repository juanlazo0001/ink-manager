// Adversarial coverage for the appointments response projection
// (lib/appointmentVisibility.ts). Real HTTP against the real router with
// self-contained Prisma fixtures -- same convention as
// artistFieldVisibility.test.ts / permissionContext.test.ts /
// soloGuestAccess.test.ts.
//
// What this is defending. Before the projection, BOTH appointment routes
// returned the whole Appointment row to anyone holding `appointments.view`
// -- a permission ARTIST has by DEFAULT. On the wire that meant
// finalCostCents, tipCents, closeoutNotes, paidVia, both Stripe ids, the
// gift-card stack with codes and dollar amounts, and the client's real
// phone/email/SMS-consent state. Every one of those was hidden CLIENT-side
// only, independently, in apps/web and apps/mobile. Two clients agreeing
// to hide a field is not the same as the field not being sent.
//
// So every assertion below reads the RAW parsed JSON and checks for key
// PRESENCE (`in`), never a rendered value and never `== null` -- a
// withheld field must be genuinely ABSENT, because `"finalCostCents": null`
// is a claim (closed out at no charge) and absence is not.
//
// The three probes the work order named, plus the two that keep the fix
// honest:
//
//  1. plain ARTIST on their own appointment      -> nothing sensitive
//  2. guest-studio OWNER (solo owner-artist)     -> nothing sensitive,
//     DESPITE a real global OWNER role. This is the one that matters most:
//     `hasPermission` short-circuits TRUE unconditionally for OWNER, so
//     resolving the caller's role from the JWT instead of from the record's
//     studio would hand them everything. effectiveRoleAt returns ARTIST at
//     a studio they only guest at, which is what prevents it.
//  3. revoked-permission staff (FRONT_DESK with appointments.checkout
//     overridden off) -> money gone, contact details still there. Proves
//     the three rules are genuinely independent rather than one role check
//     wearing three hats.
//  4. host OWNER -> everything present (no regression: this fix must not
//     take anything away from someone who could already see it).
//  5. an ARTIST GRANTED appointments.checkout by override -> money present.
//     Proves the gate is the permission, not the role.

import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma";
import { JWT_SECRET } from "../lib/jwt";
import { Role, StudioMembershipType } from "../../generated/prisma/enums";
import appointmentsRouter from "./appointments";

function tokenFor(userId: string, studioId: string, role: Role): string {
  return jwt.sign({ userId, studioId, role }, JWT_SECRET);
}

const suffix = `apj-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let server: http.Server;
let baseUrl: string;

const studioIds: string[] = [];
const userIds: string[] = [];
const artistIds: string[] = [];
const clientIds: string[] = [];
const serviceIds: string[] = [];
const inquiryIds: string[] = [];
const appointmentIds: string[] = [];
const giftCardIds: string[] = [];

let hostStudioId: string;
let artistHomeStudioId: string;
let soloStudioId: string;

let hostOwnerUserId: string;
let hostFrontDeskUserId: string;
let guestArtistUserId: string;
let guestArtistId: string;
let soloOwnerArtistUserId: string;
let soloOwnerArtistId: string;

let guestArtistAppointmentId: string;
let soloOwnerAppointmentId: string;

// Every field the projection is responsible for withholding, grouped by
// the rule that governs it. Asserted as whole groups so a field added to
// applyAppointmentVisibility without being added here shows up as a gap.
const FINANCIAL_KEYS = [
  "finalCostCents",
  "tipCents",
  "closeoutNotes",
  "checkedOutById",
  "checkedOutBy",
  "paidVia",
  "stripeCheckoutSessionId",
  "stripePaymentIntentId",
] as const;

const CLIENT_CONTACT_KEYS = ["phone", "email", "smsConsentGivenAt", "smsOptedOutAt", "phones", "emails"] as const;

function assertAbsent(obj: Record<string, unknown>, keys: readonly string[], label: string) {
  for (const key of keys) {
    assert.equal(key in obj, false, `${label}: "${key}" must be ABSENT from the response, not null`);
  }
}

function assertPresent(obj: Record<string, unknown>, keys: readonly string[], label: string) {
  for (const key of keys) {
    assert.equal(key in obj, true, `${label}: "${key}" must still be present`);
  }
}

async function makeStudio(name: string): Promise<string> {
  const studio = await prisma.studio.create({ data: { slug: `${suffix}-${name}`, name: `Test ${name}` } });
  studioIds.push(studio.id);
  return studio.id;
}

async function makeService(studioId: string): Promise<string> {
  const intake = await prisma.intakeForm.create({
    data: { studioId, name: "Intake", slug: `${suffix}-${studioId}-intake` },
  });
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

// A CHECKED-OUT appointment with money on it, a gift card attached, and a
// client carrying real contact details -- i.e. every field the projection
// has an opinion about is genuinely populated, so an assertion of absence
// means "withheld", never "there was nothing there anyway".
async function makeCheckedOutAppointment(
  studioId: string,
  artistId: string,
  serviceId: string,
  tag: string,
): Promise<string> {
  const client = await prisma.client.create({
    data: {
      studioId,
      firstName: "Test",
      lastName: "Client",
      referralCode: `${suffix}-${tag}-ref`,
      phone: "+15555550100",
      email: `${suffix}-${tag}-client@test.invalid`,
      smsConsentGivenAt: new Date(),
    },
  });
  clientIds.push(client.id);
  await prisma.clientPhone.create({ data: { clientId: client.id, phone: "+15555550100", isPrimary: true } });
  await prisma.clientEmail.create({
    data: { clientId: client.id, email: `${suffix}-${tag}-client@test.invalid`, isPrimary: true },
  });

  const inquiry = await prisma.inquiry.create({
    data: {
      studioId,
      clientId: client.id,
      serviceId,
      assignedArtistId: artistId,
      channel: "EMAIL",
      description: "Appointment projection regression test",
      colorOrBlackGrey: "Color",
      placement: "Forearm",
      estimatedSize: "Small",
      hasBeenTattooedBefore: false,
      budget: "$500",
      priceEstimateLow: 300,
      priceEstimateHigh: 500,
      status: "CONFIRMED",
    },
  });
  inquiryIds.push(inquiry.id);

  const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const appointment = await prisma.appointment.create({
    data: {
      studioId,
      artistId,
      clientId: client.id,
      inquiryId: inquiry.id,
      startTime: start,
      endTime: new Date(start.getTime() + 2 * 60 * 60 * 1000),
      status: "COMPLETED",
      finalCostCents: 45000,
      tipCents: 5000,
      closeoutNotes: "Healed well, book a touch-up in six weeks.",
      checkedOutAt: new Date(),
      checkedOutById: hostOwnerUserId,
      paidVia: "MANUAL",
    },
  });
  appointmentIds.push(appointment.id);

  const card = await prisma.giftCard.create({
    data: {
      studioId,
      clientId: client.id,
      appointmentId: appointment.id,
      code: `${suffix}-${tag}-card`,
      amountCents: 20000,
      status: "ACTIVE",
    },
  });
  giftCardIds.push(card.id);

  return appointment.id;
}

async function setOverride(studioId: string, role: Role, permissionKey: string, allowed: boolean) {
  await prisma.rolePermission.upsert({
    where: { studioId_role_permissionKey: { studioId, role, permissionKey } },
    update: { allowed },
    create: { studioId, role, permissionKey, allowed },
  });
}

before(async () => {
  hostStudioId = await makeStudio("host");
  artistHomeStudioId = await makeStudio("artist-home");
  soloStudioId = await makeStudio("solo");

  const hostOwner = await prisma.user.create({
    data: { email: `${suffix}-host-owner@test.invalid`, role: Role.OWNER, studioId: hostStudioId },
  });
  hostOwnerUserId = hostOwner.id;
  userIds.push(hostOwnerUserId);

  const hostFrontDesk = await prisma.user.create({
    data: { email: `${suffix}-host-fd@test.invalid`, role: Role.FRONT_DESK, studioId: hostStudioId },
  });
  hostFrontDeskUserId = hostFrontDesk.id;
  userIds.push(hostFrontDeskUserId);

  // A plain ARTIST whose HOME is elsewhere and who guests at the host.
  const guestArtistUser = await prisma.user.create({
    data: { email: `${suffix}-guest-artist@test.invalid`, role: Role.ARTIST, studioId: artistHomeStudioId },
  });
  guestArtistUserId = guestArtistUser.id;
  userIds.push(guestArtistUserId);
  const guestArtist = await prisma.artist.create({
    data: { userId: guestArtistUserId, specialties: [], portfolioImages: [] },
  });
  guestArtistId = guestArtist.id;
  artistIds.push(guestArtistId);
  await prisma.studioMembership.create({
    data: { studioId: hostStudioId, artistId: guestArtistId, type: StudioMembershipType.GUEST },
  });

  // The dangerous persona: a studio-of-one whose own account is role OWNER
  // and who ALSO has an Artist profile guesting at the host. Their OWNER
  // hat must not travel.
  const soloOwnerUser = await prisma.user.create({
    data: { email: `${suffix}-solo-owner@test.invalid`, role: Role.OWNER, studioId: soloStudioId },
  });
  soloOwnerArtistUserId = soloOwnerUser.id;
  userIds.push(soloOwnerArtistUserId);
  const soloOwnerArtist = await prisma.artist.create({
    data: { userId: soloOwnerArtistUserId, specialties: [], portfolioImages: [] },
  });
  soloOwnerArtistId = soloOwnerArtist.id;
  artistIds.push(soloOwnerArtistId);
  await prisma.studioMembership.create({
    data: { studioId: hostStudioId, artistId: soloOwnerArtistId, type: StudioMembershipType.GUEST },
  });

  const hostServiceId = await makeService(hostStudioId);
  guestArtistAppointmentId = await makeCheckedOutAppointment(hostStudioId, guestArtistId, hostServiceId, "guest");
  soloOwnerAppointmentId = await makeCheckedOutAppointment(hostStudioId, soloOwnerArtistId, hostServiceId, "solo");

  const app = express();
  app.use(express.json());
  app.use("/appointments", appointmentsRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));

  await prisma.giftCard.deleteMany({ where: { id: { in: giftCardIds } } });
  await prisma.appointment.deleteMany({ where: { id: { in: appointmentIds } } });
  await prisma.inquiry.deleteMany({ where: { id: { in: inquiryIds } } });
  await prisma.clientPhone.deleteMany({ where: { clientId: { in: clientIds } } });
  await prisma.clientEmail.deleteMany({ where: { clientId: { in: clientIds } } });
  await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
  await prisma.service.deleteMany({ where: { id: { in: serviceIds } } });
  await prisma.intakeForm.deleteMany({ where: { studioId: { in: studioIds } } });
  await prisma.studioMembership.deleteMany({ where: { artistId: { in: artistIds } } });
  await prisma.artist.deleteMany({ where: { id: { in: artistIds } } });
  await prisma.rolePermission.deleteMany({ where: { studioId: { in: studioIds } } });
  await prisma.auditLog.deleteMany({ where: { studioId: { in: studioIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.studioSettings.deleteMany({ where: { studioId: { in: studioIds } } });
  await prisma.studio.deleteMany({ where: { id: { in: studioIds } } });
});

async function getDetail(userId: string, studioId: string, role: Role, appointmentId: string) {
  const res = await fetch(`${baseUrl}/appointments/${appointmentId}`, {
    headers: { Authorization: `Bearer ${tokenFor(userId, studioId, role)}` },
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

test("probe 1 -- plain ARTIST on their own appointment: money, gift cards and client contact are all absent", async () => {
  const { status, body } = await getDetail(guestArtistUserId, artistHomeStudioId, Role.ARTIST, guestArtistAppointmentId);

  assert.equal(status, 200, "an artist must still be able to OPEN their own appointment");
  assertAbsent(body, FINANCIAL_KEYS, "ARTIST detail");
  assert.equal("giftCards" in body, false, "ARTIST detail: the gift-card stack must be absent entirely");
  assertAbsent(body.client as Record<string, unknown>, CLIENT_CONTACT_KEYS, "ARTIST detail client");
  assert.equal(
    "referralCode" in (body.client as Record<string, unknown>),
    false,
    "ARTIST detail client: referralCode renders only inside the checkout panel, so it travels with financials",
  );

  // The half that must NOT disappear: an artist still needs their own
  // session.
  assert.equal("checkedOutAt" in body, true, "checkedOutAt is operational status, not a financial figure");
  assert.equal("startTime" in body, true);
  assert.equal("notes" in body, true, "the booking note is the artist's own working data");
  assert.equal((body.client as Record<string, unknown>).firstName, "Test", "the client's NAME is not contact detail");
});

test("probe 2 -- guest-studio OWNER: a real OWNER role does not travel to a studio they only guest at", async () => {
  // The token says role OWNER and carries the solo studio as its studioId,
  // both truthfully. The appointment lives at the HOST studio, where this
  // caller is only ever an artist.
  const { status, body } = await getDetail(soloOwnerArtistUserId, soloStudioId, Role.OWNER, soloOwnerAppointmentId);

  assert.equal(status, 200, "their guest membership is live, so the record itself is reachable");
  assertAbsent(body, FINANCIAL_KEYS, "guest-OWNER detail");
  assert.equal("giftCards" in body, false, "guest-OWNER detail: gift-card stack must be absent");
  assertAbsent(body.client as Record<string, unknown>, CLIENT_CONTACT_KEYS, "guest-OWNER detail client");

  // Cross-check that this is the projection doing the work and not the
  // record simply being empty: fromGuestStudio proves the route agrees
  // this is a guest-studio record.
  assert.notEqual(body.fromGuestStudio, null, "this must be recognised as a guest-studio record");
});

test("probe 3 -- revoked-permission staff: the three rules are independent, not one role check", async () => {
  await setOverride(hostStudioId, Role.FRONT_DESK, "appointments.checkout", false);

  const { status, body } = await getDetail(hostFrontDeskUserId, hostStudioId, Role.FRONT_DESK, guestArtistAppointmentId);

  assert.equal(status, 200);
  assertAbsent(body, FINANCIAL_KEYS, "revoked-checkout FRONT_DESK");
  // giftCards.view and staff standing are untouched by that override, so
  // both must survive -- if this fails, the projection is collapsing three
  // decisions into one.
  assert.equal("giftCards" in body, true, "giftCards.view was not revoked, so the stack must still be present");
  assertPresent(body.client as Record<string, unknown>, CLIENT_CONTACT_KEYS, "revoked-checkout FRONT_DESK client");

  await setOverride(hostStudioId, Role.FRONT_DESK, "appointments.checkout", true);
});

test("probe 4 -- host OWNER: nothing is taken away from someone who could already see it", async () => {
  const { status, body } = await getDetail(hostOwnerUserId, hostStudioId, Role.OWNER, guestArtistAppointmentId);

  assert.equal(status, 200);
  assertPresent(body, FINANCIAL_KEYS, "host OWNER");
  assert.equal(body.finalCostCents, 45000, "the real figure, not a placeholder");
  assert.equal(body.tipCents, 5000);
  assert.equal("giftCards" in body, true);
  assert.equal((body.giftCards as unknown[]).length, 1, "the attached card is still there, with its amount");
  assertPresent(body.client as Record<string, unknown>, CLIENT_CONTACT_KEYS, "host OWNER client");
  assert.equal("referralCode" in (body.client as Record<string, unknown>), true);
});

test("probe 5 -- an ARTIST GRANTED appointments.checkout at the host studio sees the money", async () => {
  // The gate is the permission at the record's studio, not the role. A
  // studio that deliberately grants its artists checkout must still get
  // the behaviour it configured.
  await setOverride(hostStudioId, Role.ARTIST, "appointments.checkout", true);

  const { body } = await getDetail(guestArtistUserId, artistHomeStudioId, Role.ARTIST, guestArtistAppointmentId);
  assertPresent(body, FINANCIAL_KEYS, "granted-checkout ARTIST");
  assert.equal(body.finalCostCents, 45000);
  // Still not staff, so contact details stay withheld -- the grant is
  // scoped to what it actually grants.
  assertAbsent(body.client as Record<string, unknown>, CLIENT_CONTACT_KEYS, "granted-checkout ARTIST client");

  await setOverride(hostStudioId, Role.ARTIST, "appointments.checkout", false);
});

test("probe 6 -- the permission is read at the RECORD's studio, not the caller's home", async () => {
  // Granting an artist checkout at their OWN HOME studio must not unlock
  // the money on an appointment that lives at the HOST studio. This is the
  // exact bug hasPermissionAt exists to prevent, re-checked here for the
  // projection specifically.
  await setOverride(artistHomeStudioId, Role.ARTIST, "appointments.checkout", true);

  const { body } = await getDetail(guestArtistUserId, artistHomeStudioId, Role.ARTIST, guestArtistAppointmentId);
  assertAbsent(body, FINANCIAL_KEYS, "home-granted ARTIST viewing a HOST appointment");

  await setOverride(artistHomeStudioId, Role.ARTIST, "appointments.checkout", false);
});

test("the LIST route is projected too -- it leaked the same scalars via `include`", async () => {
  // GET /appointments used a Prisma `include`, so every scalar column rode
  // along: finalCostCents, tipCents, closeoutNotes, paidVia and both
  // Stripe ids reached anyone with appointments.view. packages/
  // shared-types asserted the opposite in prose. Prose is not a filter.
  const artistRes = await fetch(`${baseUrl}/appointments`, {
    headers: { Authorization: `Bearer ${tokenFor(guestArtistUserId, artistHomeStudioId, Role.ARTIST)}` },
  });
  const artistRows = (await artistRes.json()) as Record<string, unknown>[];
  const artistRow = artistRows.find((r) => r.id === guestArtistAppointmentId);
  assert.ok(artistRow, "the artist's own appointment must still appear in their list");
  assertAbsent(artistRow, FINANCIAL_KEYS, "ARTIST list row");
  assert.equal("checkedOutAt" in artistRow, true, "still needed to derive the project stage");

  const ownerRes = await fetch(`${baseUrl}/appointments`, {
    headers: { Authorization: `Bearer ${tokenFor(hostOwnerUserId, hostStudioId, Role.OWNER)}` },
  });
  const ownerRows = (await ownerRes.json()) as Record<string, unknown>[];
  const ownerRow = ownerRows.find((r) => r.id === guestArtistAppointmentId);
  assert.ok(ownerRow, "the owner's own studio list must contain it");
  // web's ClientDetail session-history table reads finalCostCents off THIS
  // route, so narrowing the query outright would have broken it.
  assert.equal(ownerRow.finalCostCents, 45000, "a caller entitled to it must still receive it from the LIST");
});
