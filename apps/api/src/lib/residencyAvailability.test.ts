// Core coverage for 6a Epic Part 3 (residency-aware availability). Tests
// the shared lib/schedulingAssistant.ts functions directly (every real
// consumer -- scheduling assistant, client self-scheduling, flash
// booking, staff scheduling -- funnels through these same functions, so
// this is the one place the rule needs proving). The more exhaustive
// real-HTTP adversarial and timezone-distinct proof lands in Part 5.

import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "./prisma";
import { Role, StudioMembershipType, ResidencyStatus } from "../../generated/prisma/enums";
import { getSuggestedTimes } from "./schedulingAssistant";

const suffix = `resavail-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const studioIds: string[] = [];
const userIds: string[] = [];
let artistId: string;
let homeStudioId: string;
let hostStudioId: string;

before(async () => {
  homeStudioId = (await prisma.studio.create({ data: { name: `Avail Home ${suffix}`, slug: `avail-home-${suffix}` } })).id;
  hostStudioId = (await prisma.studio.create({ data: { name: `Avail Host ${suffix}`, slug: `avail-host-${suffix}` } })).id;
  studioIds.push(homeStudioId, hostStudioId);

  await prisma.studioSettings.create({ data: { studioId: homeStudioId, timezone: "America/New_York" } });
  await prisma.studioSettings.create({ data: { studioId: hostStudioId, timezone: "America/New_York" } });

  const user = await prisma.user.create({ data: { email: `${suffix}-artist@test.invalid`, role: Role.ARTIST, studioId: homeStudioId } });
  userIds.push(user.id);
  const artist = await prisma.artist.create({
    data: {
      userId: user.id,
      specialties: [],
      portfolioImages: [],
      // A full-week, wide-open schedule so every day of the search window
      // has real candidate slots regardless of weekday -- isolates the
      // residency gate as the only thing under test here.
      preferredSchedule: Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, startTime: "09:00", endTime: "17:00" })),
    },
  });
  artistId = artist.id;

  await prisma.studioMembership.create({ data: { studioId: homeStudioId, artistId, type: StudioMembershipType.HOME } });
  await prisma.studioMembership.create({ data: { studioId: hostStudioId, artistId, type: StudioMembershipType.GUEST } });
});

after(async () => {
  await prisma.residency.deleteMany({ where: { artistId } });
  await prisma.studioMembership.deleteMany({ where: { artistId } });
  await prisma.artist.deleteMany({ where: { id: artistId } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.studioSettings.deleteMany({ where: { studioId: { in: studioIds } } });
  await prisma.studio.deleteMany({ where: { id: { in: studioIds } } });
});

test("outside any residency window: bookable at home, NOT at the host", async () => {
  // now far in the future, well outside any residency created below --
  // each test creates its own dated residency, so this baseline (no
  // residency rows exist yet) covers "no residency active anywhere."
  const now = new Date("2027-06-01T12:00:00Z");
  const home = await getSuggestedTimes(artistId, 60, homeStudioId, { now, searchDays: 3 });
  const host = await getSuggestedTimes(artistId, 60, hostStudioId, { now, searchDays: 3 });
  assert.ok(home.length > 0, "bookable at home with no active residency");
  assert.equal(host.length, 0, "must NOT be bookable at a studio with no residency and that isn't home");
});

test("during a CONFIRMED residency at the host: bookable at host, BLOCKED at home", async () => {
  const now = new Date("2027-07-01T12:00:00Z");
  const residency = await prisma.residency.create({
    data: {
      membershipId: (await prisma.studioMembership.findFirstOrThrow({ where: { studioId: hostStudioId, artistId } })).id,
      artistId,
      startDate: new Date("2027-07-01"),
      endDate: new Date("2027-07-10"),
      status: ResidencyStatus.CONFIRMED,
    },
  });

  const home = await getSuggestedTimes(artistId, 60, homeStudioId, { now, searchDays: 3 });
  const host = await getSuggestedTimes(artistId, 60, hostStudioId, { now, searchDays: 3 });
  assert.equal(home.length, 0, "must be BLOCKED at home during a confirmed residency elsewhere");
  assert.ok(host.length > 0, "must be bookable at the host during their own confirmed residency");

  await prisma.residency.delete({ where: { id: residency.id } });
});

test("a PENDING (not yet accepted) residency at the host does NOT unlock availability there", async () => {
  const now = new Date("2027-08-01T12:00:00Z");
  const residency = await prisma.residency.create({
    data: {
      membershipId: (await prisma.studioMembership.findFirstOrThrow({ where: { studioId: hostStudioId, artistId } })).id,
      artistId,
      startDate: new Date("2027-08-01"),
      endDate: new Date("2027-08-10"),
      status: ResidencyStatus.PENDING,
    },
  });

  const home = await getSuggestedTimes(artistId, 60, homeStudioId, { now, searchDays: 3 });
  const host = await getSuggestedTimes(artistId, 60, hostStudioId, { now, searchDays: 3 });
  assert.ok(home.length > 0, "still bookable at home -- a PENDING stint must not block anything yet");
  assert.equal(host.length, 0, "still NOT bookable at the host -- a PENDING stint must not unlock anything yet");

  await prisma.residency.delete({ where: { id: residency.id } });
});

test("after the residency window ends: bookable at home again, no longer at the host", async () => {
  const now = new Date("2027-09-15T12:00:00Z"); // after the residency below ends
  const residency = await prisma.residency.create({
    data: {
      membershipId: (await prisma.studioMembership.findFirstOrThrow({ where: { studioId: hostStudioId, artistId } })).id,
      artistId,
      startDate: new Date("2027-09-01"),
      endDate: new Date("2027-09-10"),
      status: ResidencyStatus.CONFIRMED,
    },
  });

  const home = await getSuggestedTimes(artistId, 60, homeStudioId, { now, searchDays: 3 });
  const host = await getSuggestedTimes(artistId, 60, hostStudioId, { now, searchDays: 3 });
  assert.ok(home.length > 0, "back to bookable at home once the residency window has passed");
  assert.equal(host.length, 0, "no longer bookable at the host once the residency window has passed");

  await prisma.residency.delete({ where: { id: residency.id } });
});
