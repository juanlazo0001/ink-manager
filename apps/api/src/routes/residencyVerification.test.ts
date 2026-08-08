// 6a Epic Part 5 -- adversarial overlap-ordering coverage beyond Part 2's
// own build-time smoke tests (residencies.test.ts already proved "overlap
// rejected at CREATE" and "overlap rejected at ACCEPT" each with one
// concrete date ordering); accept-flow visibility (a PENDING stint must be
// invisible to the public artist page and to availability -- the latter
// already covered by Part 3's own residencyAvailability.test.ts, the
// former is new here); and an end-to-end location-first booking landing at
// a HOST studio (not home) through a confirmed residency window, proving
// the public page's BOOK mechanism really does route everything downstream
// to whichever studio the client picked.

import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma";
import { JWT_SECRET } from "../lib/jwt";
import { Role, StudioMembershipType, ResidencyStatus } from "../../generated/prisma/enums";
import residenciesRouter from "./residencies";
import artistPublicProfileRouter from "./artistPublicProfile";
import inquiriesRouter from "./inquiries";

function tokenFor(userId: string, studioId: string, role: Role): string {
  return jwt.sign({ userId, studioId, role }, JWT_SECRET);
}

const suffix = `resverify-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let server: http.Server;
let baseUrl: string;

const studioIds: string[] = [];
const userIds: string[] = [];
const artistIds: string[] = [];
const membershipIds: string[] = [];
const clientIds: string[] = [];
const inquiryIds: string[] = [];
const serviceIds: string[] = [];
const intakeFormIds: string[] = [];
const locationIds: string[] = [];

let hostStudioId: string;
let hostStudioSlug: string;
let hostOwnerUserId: string;
let homeStudioId: string;
let homeStudioSlug: string;

before(async () => {
  const hostStudio = await prisma.studio.create({ data: { name: `Verify Host ${suffix}`, slug: `verify-host-${suffix}` } });
  hostStudioId = hostStudio.id;
  hostStudioSlug = hostStudio.slug;
  const homeStudio = await prisma.studio.create({ data: { name: `Verify Home ${suffix}`, slug: `verify-home-${suffix}` } });
  homeStudioId = homeStudio.id;
  homeStudioSlug = homeStudio.slug;
  studioIds.push(hostStudioId, homeStudioId);

  const hostOwner = await prisma.user.create({ data: { email: `${suffix}-host-owner@test.invalid`, role: Role.OWNER, studioId: hostStudioId } });
  hostOwnerUserId = hostOwner.id;
  userIds.push(hostOwnerUserId);

  const app = express();
  app.use(express.json());
  app.use("/residencies", residenciesRouter);
  app.use("/artists", artistPublicProfileRouter);
  app.use("/inquiries", inquiriesRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await prisma.inquiry.deleteMany({ where: { id: { in: inquiryIds } } });
  await prisma.clientEmail.deleteMany({ where: { clientId: { in: clientIds } } });
  await prisma.clientPhone.deleteMany({ where: { clientId: { in: clientIds } } });
  await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
  // Studio-scoped, not just tracked-array-based: a booking POST that hits
  // resolveIntakeForm/ensureDefaultIntakeForm without an explicit formSlug
  // can silently create an extra default IntakeForm this file never
  // explicitly tracked -- same lesson as artistPublicProfile.test.ts's own
  // cleanup fix.
  await prisma.service.deleteMany({ where: { studioId: { in: studioIds } } });
  await prisma.intakeForm.deleteMany({ where: { studioId: { in: studioIds } } });
  await prisma.location.deleteMany({ where: { id: { in: locationIds } } });
  await prisma.residency.deleteMany({ where: { artistId: { in: artistIds } } });
  await prisma.studioMembership.deleteMany({ where: { id: { in: membershipIds } } });
  await prisma.artist.deleteMany({ where: { id: { in: artistIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.rolePermission.deleteMany({ where: { studioId: { in: studioIds } } });
  await prisma.auditLog.deleteMany({ where: { studioId: { in: studioIds } } });
  await prisma.studio.deleteMany({ where: { id: { in: studioIds } } });
});

async function makeArtist(tag: string): Promise<{ artistId: string; homeMembershipId: string }> {
  const user = await prisma.user.create({ data: { email: `${suffix}-${tag}@test.invalid`, role: Role.ARTIST, studioId: homeStudioId } });
  userIds.push(user.id);
  const artist = await prisma.artist.create({ data: { userId: user.id, specialties: [], portfolioImages: [] } });
  artistIds.push(artist.id);
  const homeMembership = await prisma.studioMembership.create({ data: { studioId: homeStudioId, artistId: artist.id, type: StudioMembershipType.HOME } });
  membershipIds.push(homeMembership.id);
  return { artistId: artist.id, homeMembershipId: homeMembership.id };
}

// ---------------------------------------------------------------------
// Overlap rejection, both orderings -- the boolean overlap predicate
// (findResidencyOverlapConflict) is direction-agnostic by construction
// (`!(endKey < candidateStartKey || startKey > candidateEndKey)`), but
// Part 2's own tests only ever exercised ONE chronological ordering (the
// new stint starting after the existing one and extending past it, at
// create; an earlier-dated PENDING stint conflicting with a
// later-created-but-overlapping CONFIRMED one, at accept). These tests
// exercise the reverse orderings and the exact-boundary cases -- proving
// the check doesn't silently depend on which side started first.
// ---------------------------------------------------------------------

test("overlap rejected at CREATE, reverse ordering: new stint starts BEFORE and extends INTO an existing confirmed one", async () => {
  const { artistId, homeMembershipId } = await makeArtist("createreverse");
  await prisma.residency.create({
    data: { membershipId: homeMembershipId, artistId, startDate: new Date("2028-01-10"), endDate: new Date("2028-01-20"), status: ResidencyStatus.CONFIRMED },
  });
  const guestMembership = await prisma.studioMembership.create({ data: { studioId: hostStudioId, artistId, type: StudioMembershipType.GUEST } });
  membershipIds.push(guestMembership.id);

  const res = await fetch(`${baseUrl}/residencies/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tokenFor(hostOwnerUserId, hostStudioId, Role.OWNER)}`, "Content-Type": "application/json" },
    body: JSON.stringify({ membershipId: guestMembership.id, startDate: "2028-01-01", endDate: "2028-01-12" }),
  });
  assert.equal(res.status, 409, "starting before and ending inside an existing confirmed window must still be rejected");
});

test("overlap rejected at CREATE: new stint fully ENCOMPASSES an existing confirmed one", async () => {
  const { artistId, homeMembershipId } = await makeArtist("createencompass");
  await prisma.residency.create({
    data: { membershipId: homeMembershipId, artistId, startDate: new Date("2028-02-10"), endDate: new Date("2028-02-12"), status: ResidencyStatus.CONFIRMED },
  });
  const guestMembership = await prisma.studioMembership.create({ data: { studioId: hostStudioId, artistId, type: StudioMembershipType.GUEST } });
  membershipIds.push(guestMembership.id);

  const res = await fetch(`${baseUrl}/residencies/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tokenFor(hostOwnerUserId, hostStudioId, Role.OWNER)}`, "Content-Type": "application/json" },
    body: JSON.stringify({ membershipId: guestMembership.id, startDate: "2028-02-01", endDate: "2028-02-20" }),
  });
  assert.equal(res.status, 409, "a new window that fully contains an existing confirmed one must be rejected");
});

test("overlap rejected at CREATE: new stint fully NESTED inside an existing confirmed one", async () => {
  const { artistId, homeMembershipId } = await makeArtist("createnested");
  await prisma.residency.create({
    data: { membershipId: homeMembershipId, artistId, startDate: new Date("2028-03-01"), endDate: new Date("2028-03-20"), status: ResidencyStatus.CONFIRMED },
  });
  const guestMembership = await prisma.studioMembership.create({ data: { studioId: hostStudioId, artistId, type: StudioMembershipType.GUEST } });
  membershipIds.push(guestMembership.id);

  const res = await fetch(`${baseUrl}/residencies/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tokenFor(hostOwnerUserId, hostStudioId, Role.OWNER)}`, "Content-Type": "application/json" },
    body: JSON.stringify({ membershipId: guestMembership.id, startDate: "2028-03-05", endDate: "2028-03-10" }),
  });
  assert.equal(res.status, 409, "a new window fully nested inside an existing confirmed one must be rejected");
});

test("boundary: adjacent, non-overlapping windows (back-to-back days) are ALLOWED", async () => {
  const { artistId, homeMembershipId } = await makeArtist("boundaryok");
  await prisma.residency.create({
    data: { membershipId: homeMembershipId, artistId, startDate: new Date("2028-04-01"), endDate: new Date("2028-04-10"), status: ResidencyStatus.CONFIRMED },
  });
  const guestMembership = await prisma.studioMembership.create({ data: { studioId: hostStudioId, artistId, type: StudioMembershipType.GUEST } });
  membershipIds.push(guestMembership.id);

  const res = await fetch(`${baseUrl}/residencies/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tokenFor(hostOwnerUserId, hostStudioId, Role.OWNER)}`, "Content-Type": "application/json" },
    body: JSON.stringify({ membershipId: guestMembership.id, startDate: "2028-04-11", endDate: "2028-04-15" }),
  });
  assert.equal(res.status, 201, "starting the very next civil day after an existing window ends must NOT be treated as an overlap");
});

test("boundary: same-day touch (new starts exactly the day an existing one ends) is REJECTED (inclusive on both ends)", async () => {
  const { artistId, homeMembershipId } = await makeArtist("boundaryreject");
  await prisma.residency.create({
    data: { membershipId: homeMembershipId, artistId, startDate: new Date("2028-05-01"), endDate: new Date("2028-05-10"), status: ResidencyStatus.CONFIRMED },
  });
  const guestMembership = await prisma.studioMembership.create({ data: { studioId: hostStudioId, artistId, type: StudioMembershipType.GUEST } });
  membershipIds.push(guestMembership.id);

  const res = await fetch(`${baseUrl}/residencies/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tokenFor(hostOwnerUserId, hostStudioId, Role.OWNER)}`, "Content-Type": "application/json" },
    body: JSON.stringify({ membershipId: guestMembership.id, startDate: "2028-05-10", endDate: "2028-05-15" }),
  });
  assert.equal(res.status, 409, "sharing even one calendar day must be rejected -- both ends are inclusive");
});

test("overlap rejected at ACCEPT, reverse ordering: accepting the chronologically EARLIER of two conflicting PENDING stints, after the LATER one was already confirmed", async () => {
  const { artistId, homeMembershipId } = await makeArtist("acceptreverse");
  const guestMembership = await prisma.studioMembership.create({ data: { studioId: hostStudioId, artistId, type: StudioMembershipType.GUEST } });
  membershipIds.push(guestMembership.id);

  // Two overlapping PENDING proposals, both legal to coexist since neither
  // is CONFIRMED yet.
  const earlier = await prisma.residency.create({
    data: { membershipId: homeMembershipId, artistId, startDate: new Date("2028-06-01"), endDate: new Date("2028-06-15"), status: ResidencyStatus.PENDING },
  });
  const later = await prisma.residency.create({
    data: { membershipId: guestMembership.id, artistId, startDate: new Date("2028-06-10"), endDate: new Date("2028-06-20"), status: ResidencyStatus.PENDING },
  });

  const artist = await prisma.artist.findUniqueOrThrow({ where: { id: artistId }, include: { user: true } });

  // Accept the LATER-dated one first -- it has nothing confirmed to
  // conflict with yet, so this must succeed.
  const acceptLaterRes = await fetch(`${baseUrl}/residencies/${later.id}/accept`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tokenFor(artist.userId, homeStudioId, Role.ARTIST)}` },
  });
  assert.equal(acceptLaterRes.status, 200);

  // Now accepting the EARLIER-dated one (proposed first, chronologically
  // starts first) must still be rejected -- proves the accept-time
  // overlap check has nothing to do with proposal order or which side's
  // dates come first, only with what's actually CONFIRMED at accept time.
  const acceptEarlierRes = await fetch(`${baseUrl}/residencies/${earlier.id}/accept`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tokenFor(artist.userId, homeStudioId, Role.ARTIST)}` },
  });
  assert.equal(acceptEarlierRes.status, 409, "accepting the earlier-proposed, earlier-dated stint must still be blocked by the now-confirmed later one");

  const stillPending = await prisma.residency.findUniqueOrThrow({ where: { id: earlier.id } });
  assert.equal(stillPending.status, ResidencyStatus.PENDING);
});

// ---------------------------------------------------------------------
// Accept-flow visibility: a PENDING stint must be invisible to the public
// artist page (Part 3's residencyAvailability.test.ts already proved it
// unlocks nothing in availability) -- becomes visible the moment, and
// only the moment, it's actually accepted.
// ---------------------------------------------------------------------

test("accept-flow visibility: a PENDING residency is invisible on the public artist page; appears once CONFIRMED", async () => {
  const { artistId, homeMembershipId: _unused } = await makeArtist("publicvisibility");
  void _unused;
  const location = await prisma.location.create({ data: { studioId: homeStudioId, name: "Home base" } });
  locationIds.push(location.id);
  await prisma.artist.update({ where: { id: artistId }, data: { publicSlug: `${suffix}-pub`, publishedAt: new Date() } });

  const guestMembership = await prisma.studioMembership.create({ data: { studioId: hostStudioId, artistId, type: StudioMembershipType.GUEST } });
  membershipIds.push(guestMembership.id);
  const residency = await prisma.residency.create({
    data: { membershipId: guestMembership.id, artistId, startDate: new Date("2028-07-01"), endDate: new Date("2028-07-10"), status: ResidencyStatus.PENDING },
  });

  const pendingRes = await fetch(`${baseUrl}/artists/public/${suffix}-pub`);
  const pendingBody = (await pendingRes.json()) as { upcomingResidencies: { studio: { id: string } }[] };
  assert.ok(
    !pendingBody.upcomingResidencies.some((r) => r.studio.id === hostStudioId),
    "a PENDING (not yet accepted) residency must not appear on the public page at all",
  );

  await prisma.residency.update({ where: { id: residency.id }, data: { status: ResidencyStatus.CONFIRMED } });

  const confirmedRes = await fetch(`${baseUrl}/artists/public/${suffix}-pub`);
  const confirmedBody = (await confirmedRes.json()) as { upcomingResidencies: { studio: { id: string } }[] };
  assert.ok(
    confirmedBody.upcomingResidencies.some((r) => r.studio.id === hostStudioId),
    "the same residency must appear on the public page the moment it's CONFIRMED",
  );
});

// ---------------------------------------------------------------------
// Location-first end-to-end booking: the public page's BOOK flow, pointed
// at a HOST studio the artist is CONFIRMED guesting at (not home) --
// proves the whole downstream chain (studio resolution, service/intake
// form, pre-assignment) really does belong to whichever studio the client
// picked, not always the artist's home.
// ---------------------------------------------------------------------

test("location-first booking through a residency window lands at the HOST studio with the artist pre-assigned", async () => {
  const { artistId } = await makeArtist("locationfirst");
  const homeLocation = await prisma.location.create({ data: { studioId: homeStudioId, name: "Home base 2" } });
  locationIds.push(homeLocation.id);
  await prisma.artist.update({ where: { id: artistId }, data: { publicSlug: `${suffix}-locfirst`, publishedAt: new Date() } });

  const guestMembership = await prisma.studioMembership.create({ data: { studioId: hostStudioId, artistId, type: StudioMembershipType.GUEST } });
  membershipIds.push(guestMembership.id);
  await prisma.residency.create({
    data: { membershipId: guestMembership.id, artistId, startDate: new Date("2028-08-01"), endDate: new Date("2028-08-10"), status: ResidencyStatus.CONFIRMED },
  });

  // Host studio's OWN intake form/service -- deliberately distinct from
  // home's, so landing on the HOST's own pipeline is unambiguous, not a
  // coincidence of both studios sharing a default.
  const hostIntakeForm = await prisma.intakeForm.create({ data: { studioId: hostStudioId, name: "Host Intake", slug: `${suffix}-host-intake` } });
  intakeFormIds.push(hostIntakeForm.id);
  const hostService = await prisma.service.create({
    data: { studioId: hostStudioId, name: "Host Tattoo", slug: `${suffix}-host-tattoo`, pricingModel: "RANGE", depositModel: "TIER_BASED", intakeFormId: hostIntakeForm.id },
  });
  serviceIds.push(hostService.id);

  // Step 1: fetch the public page, exactly like the frontend's BOOK picker
  // would, and confirm the host studio is actually listed as an option.
  const publicRes = await fetch(`${baseUrl}/artists/public/${suffix}-locfirst`);
  const publicBody = (await publicRes.json()) as { id: string; upcomingResidencies: { studio: { id: string; slug: string } }[] };
  const hostOption = publicBody.upcomingResidencies.find((r) => r.studio.id === hostStudioId);
  assert.ok(hostOption, "the host studio's residency window must be offered as a BOOK destination on the public page");
  assert.equal(hostOption!.studio.slug, hostStudioSlug);

  // Step 2: the client picks the HOST option -- exactly what
  // ArtistPublicPage.tsx's bookAt() does, POSTing to the picked studio's
  // own slug with bookingArtistId, never the artist's home studio.
  const bookingRes = await fetch(`${baseUrl}/inquiries`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      studioSlug: hostOption!.studio.slug,
      formSlug: hostIntakeForm.slug,
      firstName: "Location",
      lastName: "First",
      email: `${suffix}-locationfirst-client@test.invalid`,
      channel: "EMAIL",
      description: "Booked through the host residency window",
      colorOrBlackGrey: "Color",
      placement: "Leg",
      estimatedSize: "Medium",
      hasBeenTattooedBefore: false,
      referenceImages: ["https://example.test/ref.png"],
      placementImages: ["https://example.test/placement.png"],
      smsConsent: true,
      bookingArtistId: publicBody.id,
    }),
  });
  assert.equal(bookingRes.status, 201);
  const bookingBody = (await bookingRes.json()) as { id: string; studioId: string; assignedArtistId: string; status: string; serviceId: string };
  inquiryIds.push(bookingBody.id);
  const created = await prisma.inquiry.findUniqueOrThrow({ where: { id: bookingBody.id }, select: { clientId: true } });
  clientIds.push(created.clientId);

  assert.equal(bookingBody.studioId, hostStudioId, "the inquiry must land at the HOST studio, not the artist's home");
  assert.equal(bookingBody.assignedArtistId, artistId, "the artist must be pre-assigned");
  assert.equal(bookingBody.status, "ARTIST_ASSIGNED");
  assert.equal(bookingBody.serviceId, hostService.id, "must use the HOST's own service/intake-form pipeline, not home's");
});
