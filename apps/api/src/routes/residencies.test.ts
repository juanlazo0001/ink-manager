// Core coverage for 6a Epic Part 2 (residency management). Exhaustive
// adversarial verification (both overlap orderings, live browser
// walkthroughs) lands in Part 5 -- this establishes that the invite flow,
// host-staff CRUD, and artist accept/decline mechanics work correctly
// before Part 3 builds availability on top of them.

import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma";
import { JWT_SECRET } from "../lib/jwt";
import { Role, StudioMembershipType, ResidencyStatus } from "../../generated/prisma/enums";
import studiosRouter from "./studios";
import artistInvitesRouter from "./artistInvites";
import residenciesRouter from "./residencies";

function tokenFor(userId: string, studioId: string, role: Role): string {
  return jwt.sign({ userId, studioId, role }, JWT_SECRET);
}

const suffix = `res-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let server: http.Server;
let baseUrl: string;

const studioIds: string[] = [];
const userIds: string[] = [];
const artistIds: string[] = [];
const membershipIds: string[] = [];

let hostStudioId: string;
let hostOwnerUserId: string;
let homeStudioId: string;
let homeOwnerUserId: string;

before(async () => {
  hostStudioId = (await prisma.studio.create({ data: { name: `Res Host ${suffix}`, slug: `res-host-${suffix}` } })).id;
  homeStudioId = (await prisma.studio.create({ data: { name: `Res Home ${suffix}`, slug: `res-home-${suffix}` } })).id;
  studioIds.push(hostStudioId, homeStudioId);

  const hostOwner = await prisma.user.create({ data: { email: `${suffix}-host-owner@test.invalid`, role: Role.OWNER, studioId: hostStudioId } });
  hostOwnerUserId = hostOwner.id;
  const homeOwner = await prisma.user.create({ data: { email: `${suffix}-home-owner@test.invalid`, role: Role.OWNER, studioId: homeStudioId } });
  homeOwnerUserId = homeOwner.id;
  userIds.push(hostOwnerUserId, homeOwnerUserId);

  const app = express();
  app.use(express.json());
  app.use("/studios", studiosRouter);
  app.use("/", artistInvitesRouter);
  app.use("/residencies", residenciesRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await prisma.residency.deleteMany({ where: { artistId: { in: artistIds } } });
  await prisma.artistMembershipInvite.deleteMany({ where: { studioId: { in: studioIds } } });
  await prisma.studioMembership.deleteMany({ where: { id: { in: membershipIds } } });
  await prisma.artist.deleteMany({ where: { id: { in: artistIds } } });
  // The new-identity accept flow creates a "Complete your artist profile"
  // PersonalTask (RESTRICT FK to User) -- delete before the user rows.
  await prisma.personalTask.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.rolePermission.deleteMany({ where: { studioId: { in: studioIds } } });
  await prisma.auditLog.deleteMany({ where: { studioId: { in: studioIds } } });
  await prisma.studio.deleteMany({ where: { id: { in: studioIds } } });
});

test("inviting a GUEST artist without residency dates is rejected", async () => {
  const token = tokenFor(hostOwnerUserId, hostStudioId, Role.OWNER);
  const res = await fetch(`${baseUrl}/studios/${hostStudioId}/invites`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email: `${suffix}-newartist1@test.invalid`, role: "ARTIST", membershipType: "GUEST" }),
  });
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string };
  assert.match(body.error, /residencyStartDate/);
});

test("inviting a GUEST artist WITH residency dates succeeds, and accepting creates a CONFIRMED residency for a new identity", async () => {
  const email = `${suffix}-newartist2@test.invalid`;
  const inviteToken = tokenFor(hostOwnerUserId, hostStudioId, Role.OWNER);
  const inviteRes = await fetch(`${baseUrl}/studios/${hostStudioId}/invites`, {
    method: "POST",
    headers: { Authorization: `Bearer ${inviteToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      role: "ARTIST",
      membershipType: "GUEST",
      residencyStartDate: "2026-09-01",
      residencyEndDate: "2026-09-10",
    }),
  });
  assert.equal(inviteRes.status, 201);

  const invite = await prisma.artistMembershipInvite.findFirstOrThrow({ where: { email } });
  assert.equal(invite.residencyStartDate?.toISOString().slice(0, 10), "2026-09-01");

  const acceptRes = await fetch(`${baseUrl}/artist-invite/accept/${invite.token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "password1234" }),
  });
  assert.equal(acceptRes.status, 200);

  const artist = await prisma.artist.findFirstOrThrow({ where: { user: { email } } });
  artistIds.push(artist.id);
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  userIds.push(user.id);
  const membership = await prisma.studioMembership.findFirstOrThrow({ where: { artistId: artist.id, studioId: hostStudioId } });
  membershipIds.push(membership.id);

  const residency = await prisma.residency.findFirstOrThrow({ where: { membershipId: membership.id } });
  assert.equal(residency.status, ResidencyStatus.CONFIRMED, "the first stint must land CONFIRMED, not PENDING -- accepting the invite IS consent");
});

test("host staff create a PENDING stint for an existing guest membership; requires residencies.manage", async () => {
  // A separate home artist, then invited as a guest at hostStudio (a
  // second, distinct guest -- keeps this test isolated from the one above).
  const homeArtistEmail = `${suffix}-guestartist@test.invalid`;
  const homeArtistUser = await prisma.user.create({ data: { email: homeArtistEmail, role: Role.ARTIST, studioId: homeStudioId } });
  userIds.push(homeArtistUser.id);
  const homeArtist = await prisma.artist.create({ data: { userId: homeArtistUser.id, specialties: [], portfolioImages: [] } });
  artistIds.push(homeArtist.id);
  await prisma.studioMembership.create({ data: { studioId: homeStudioId, artistId: homeArtist.id, type: StudioMembershipType.HOME } }).then((m) => membershipIds.push(m.id));
  const guestMembership = await prisma.studioMembership.create({ data: { studioId: hostStudioId, artistId: homeArtist.id, type: StudioMembershipType.GUEST } });
  membershipIds.push(guestMembership.id);

  // Deny residencies.manage for FRONT_DESK at hostStudio, then confirm a
  // FRONT_DESK caller is rejected before trying as OWNER (who always has
  // every permission).
  await prisma.rolePermission.create({ data: { studioId: hostStudioId, role: Role.FRONT_DESK, permissionKey: "residencies.manage", allowed: false } });
  const frontDeskUser = await prisma.user.create({ data: { email: `${suffix}-frontdesk@test.invalid`, role: Role.FRONT_DESK, studioId: hostStudioId } });
  userIds.push(frontDeskUser.id);

  const deniedRes = await fetch(`${baseUrl}/residencies/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tokenFor(frontDeskUser.id, hostStudioId, Role.FRONT_DESK)}`, "Content-Type": "application/json" },
    body: JSON.stringify({ membershipId: guestMembership.id, startDate: "2026-11-01", endDate: "2026-11-10" }),
  });
  assert.equal(deniedRes.status, 403);

  const ownerRes = await fetch(`${baseUrl}/residencies/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tokenFor(hostOwnerUserId, hostStudioId, Role.OWNER)}`, "Content-Type": "application/json" },
    body: JSON.stringify({ membershipId: guestMembership.id, startDate: "2026-11-01", endDate: "2026-11-10" }),
  });
  assert.equal(ownerRes.status, 201);
  const created = (await ownerRes.json()) as { id: string; status: string };
  assert.equal(created.status, ResidencyStatus.PENDING, "a host-created stint must start PENDING");

  // Artist sees it in their own cross-studio view.
  const mineRes = await fetch(`${baseUrl}/residencies/mine`, {
    headers: { Authorization: `Bearer ${tokenFor(homeArtistUser.id, homeStudioId, Role.ARTIST)}` },
  });
  const mine = (await mineRes.json()) as Array<{ id: string; status: string }>;
  assert.ok(mine.some((r) => r.id === created.id && r.status === "PENDING"));

  // Artist declines it -- no permission needed, just being the right artist.
  const declineRes = await fetch(`${baseUrl}/residencies/${created.id}/decline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tokenFor(homeArtistUser.id, homeStudioId, Role.ARTIST)}` },
  });
  assert.equal(declineRes.status, 200);
  const declined = await prisma.residency.findUniqueOrThrow({ where: { id: created.id } });
  assert.equal(declined.status, ResidencyStatus.DECLINED);
});

test("editing a CONFIRMED stint's dates resets it to PENDING (the flagged judgment call, built as recommended)", async () => {
  const artistUser = await prisma.user.create({ data: { email: `${suffix}-editcase@test.invalid`, role: Role.ARTIST, studioId: homeStudioId } });
  userIds.push(artistUser.id);
  const artist = await prisma.artist.create({ data: { userId: artistUser.id, specialties: [], portfolioImages: [] } });
  artistIds.push(artist.id);
  const membership = await prisma.studioMembership.create({ data: { studioId: hostStudioId, artistId: artist.id, type: StudioMembershipType.GUEST } });
  membershipIds.push(membership.id);
  const residency = await prisma.residency.create({
    data: { membershipId: membership.id, artistId: artist.id, startDate: new Date("2026-12-01"), endDate: new Date("2026-12-10"), status: ResidencyStatus.CONFIRMED },
  });

  const res = await fetch(`${baseUrl}/residencies/${residency.id}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${tokenFor(hostOwnerUserId, hostStudioId, Role.OWNER)}`, "Content-Type": "application/json" },
    body: JSON.stringify({ startDate: "2026-12-02", endDate: "2026-12-11" }),
  });
  assert.equal(res.status, 200);
  const updated = (await res.json()) as { status: string };
  assert.equal(updated.status, ResidencyStatus.PENDING, "changing a CONFIRMED stint's dates must reset it to PENDING");
});

test("overlap rejected at CREATE: a second CONFIRMED residency overlapping an existing one is blocked", async () => {
  const artistUser = await prisma.user.create({ data: { email: `${suffix}-overlapcreate@test.invalid`, role: Role.ARTIST, studioId: homeStudioId } });
  userIds.push(artistUser.id);
  const artist = await prisma.artist.create({ data: { userId: artistUser.id, specialties: [], portfolioImages: [] } });
  artistIds.push(artist.id);
  const homeMembership = await prisma.studioMembership.create({ data: { studioId: homeStudioId, artistId: artist.id, type: StudioMembershipType.HOME } });
  membershipIds.push(homeMembership.id);
  await prisma.residency.create({
    data: { membershipId: homeMembership.id, artistId: artist.id, startDate: new Date("2027-01-01"), endDate: new Date("2027-01-10"), status: ResidencyStatus.CONFIRMED },
  });

  const guestMembership = await prisma.studioMembership.create({ data: { studioId: hostStudioId, artistId: artist.id, type: StudioMembershipType.GUEST } });
  membershipIds.push(guestMembership.id);

  // Host staff try to create a PENDING stint overlapping the existing
  // CONFIRMED one -- blocked outright at create, per this route's own
  // "fail fast" design (not merely deferred to accept time).
  const res = await fetch(`${baseUrl}/residencies/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tokenFor(hostOwnerUserId, hostStudioId, Role.OWNER)}`, "Content-Type": "application/json" },
    body: JSON.stringify({ membershipId: guestMembership.id, startDate: "2027-01-05", endDate: "2027-01-15" }),
  });
  assert.equal(res.status, 409);
});

test("overlap rejected at ACCEPT: a PENDING stint that would conflict by the time it's accepted is blocked", async () => {
  const artistUser = await prisma.user.create({ data: { email: `${suffix}-overlapaccept@test.invalid`, role: Role.ARTIST, studioId: homeStudioId } });
  userIds.push(artistUser.id);
  const artist = await prisma.artist.create({ data: { userId: artistUser.id, specialties: [], portfolioImages: [] } });
  artistIds.push(artist.id);
  const homeMembership = await prisma.studioMembership.create({ data: { studioId: homeStudioId, artistId: artist.id, type: StudioMembershipType.HOME } });
  membershipIds.push(homeMembership.id);
  const guestMembership = await prisma.studioMembership.create({ data: { studioId: hostStudioId, artistId: artist.id, type: StudioMembershipType.GUEST } });
  membershipIds.push(guestMembership.id);

  // A PENDING stint proposed first (no conflict exists yet)...
  const pending = await prisma.residency.create({
    data: { membershipId: guestMembership.id, artistId: artist.id, startDate: new Date("2027-02-01"), endDate: new Date("2027-02-10"), status: ResidencyStatus.PENDING },
  });
  // ...then a DIFFERENT CONFIRMED residency lands at home, overlapping it,
  // before the artist gets around to accepting the pending one.
  await prisma.residency.create({
    data: { membershipId: homeMembership.id, artistId: artist.id, startDate: new Date("2027-02-05"), endDate: new Date("2027-02-15"), status: ResidencyStatus.CONFIRMED },
  });

  const res = await fetch(`${baseUrl}/residencies/${pending.id}/accept`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tokenFor(artistUser.id, homeStudioId, Role.ARTIST)}` },
  });
  assert.equal(res.status, 409, "accept must re-check overlap fresh, not just trust the create-time check");

  const stillPending = await prisma.residency.findUniqueOrThrow({ where: { id: pending.id } });
  assert.equal(stillPending.status, ResidencyStatus.PENDING);
});
