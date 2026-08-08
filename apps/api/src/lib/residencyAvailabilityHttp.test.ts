// 6a Epic Part 5 -- top-priority verification item: cross-studio
// availability is the only genuinely NEW computation this epic adds (every
// other part is CRUD/plumbing around existing patterns), and the one place
// that could silently regress ordinary, non-guesting scheduling. Part 3's
// own residencyAvailability.test.ts already proved the gate correctly at
// the function level (lib/schedulingAssistant.ts's getSuggestedTimes,
// called directly with an injected `now`); this file proves the same rule
// holds over the real wire -- actual HTTP requests against actual Express
// routers with actual JWTs, for both the staff-facing consumer
// (GET /scheduling/suggested-times) and the public client-facing one
// (GET /self-schedule/verify/:token) -- plus a two-timezone proof that
// "global preferred hours" are genuinely reinterpreted in whichever
// studio's own timezone is asking, and a regression check that an
// ordinary, never-guesting artist's home-studio scheduling is unaffected.
//
// Real dates, not fixed-future ones: neither /scheduling/suggested-times
// nor /self-schedule/verify/:token accepts a `now` override (that's a
// getSuggestedTimes-internals-only escape hatch Part 3 used directly) --
// so this file's residency windows are built relative to the actual
// wall-clock test-run time and sized to fully cover the routes' own
// default 21-day search window, isolating "is the gate wired end-to-end"
// from date-boundary precision, which Part 3's function-level tests
// already covers exhaustively.

import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import jwt from "jsonwebtoken";
import { prisma } from "./prisma";
import { JWT_SECRET } from "./jwt";
import { Role, StudioMembershipType, ResidencyStatus } from "../../generated/prisma/enums";
import { civilDateKey, zonedTimeToUtc } from "./studioTime";
import { isArtistBookableAtStudioOnDate } from "./residencies";
import schedulingRouter from "../routes/scheduling";
import selfScheduleRouter from "../routes/selfSchedule";

function tokenFor(userId: string, studioId: string, role: Role): string {
  return jwt.sign({ userId, studioId, role }, JWT_SECRET);
}

const suffix = `resavailhttp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let server: http.Server;
let baseUrl: string;

const studioIds: string[] = [];
const userIds: string[] = [];
const artistIds: string[] = [];
const clientIds: string[] = [];
const inquiryIds: string[] = [];

// A full-week, wide-open 09:00-17:00 schedule -- isolates the residency
// gate as the only thing that could produce an empty result, same
// isolation strategy Part 3's own fixture used.
const FULL_WEEK_SCHEDULE = Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, startTime: "09:00", endTime: "17:00" }));

let homeStudioId: string;
let homeOwnerUserId: string;
let hostStudioId: string;
let hostOwnerUserId: string;
let mobileArtistId: string;

// A second, entirely separate studio+artist pair with ZERO Residency rows
// ever -- the regression fixture, kept fully isolated from the
// guesting/timezone fixture above so nothing about the residency gate can
// leak into it by accident.
let plainStudioId: string;
let plainOwnerUserId: string;
let plainArtistId: string;
let homeServiceId: string;

before(async () => {
  homeStudioId = (await prisma.studio.create({ data: { name: `Avail Home ${suffix}`, slug: `avail-home-${suffix}` } })).id;
  hostStudioId = (await prisma.studio.create({ data: { name: `Avail Host ${suffix}`, slug: `avail-host-${suffix}` } })).id;
  plainStudioId = (await prisma.studio.create({ data: { name: `Avail Plain ${suffix}`, slug: `avail-plain-${suffix}` } })).id;
  studioIds.push(homeStudioId, hostStudioId, plainStudioId);

  // Deliberately timezone-DISTINCT: home on the west coast, host on the
  // east coast -- if preferred hours were ever accidentally carried over
  // from home's timezone instead of being reinterpreted at the querying
  // studio, these two would disagree by exactly the PT/ET offset and the
  // two-timezone test below would catch it immediately.
  await prisma.studioSettings.create({ data: { studioId: homeStudioId, timezone: "America/Los_Angeles" } });
  await prisma.studioSettings.create({ data: { studioId: hostStudioId, timezone: "America/New_York" } });
  await prisma.studioSettings.create({ data: { studioId: plainStudioId, timezone: "America/Chicago" } });

  const homeOwner = await prisma.user.create({ data: { email: `${suffix}-home-owner@test.invalid`, role: Role.OWNER, studioId: homeStudioId } });
  homeOwnerUserId = homeOwner.id;
  const hostOwner = await prisma.user.create({ data: { email: `${suffix}-host-owner@test.invalid`, role: Role.OWNER, studioId: hostStudioId } });
  hostOwnerUserId = hostOwner.id;
  const plainOwner = await prisma.user.create({ data: { email: `${suffix}-plain-owner@test.invalid`, role: Role.OWNER, studioId: plainStudioId } });
  plainOwnerUserId = plainOwner.id;
  userIds.push(homeOwnerUserId, hostOwnerUserId, plainOwnerUserId);

  const mobileArtistUser = await prisma.user.create({ data: { email: `${suffix}-mobile-artist@test.invalid`, role: Role.ARTIST, studioId: homeStudioId } });
  userIds.push(mobileArtistUser.id);
  const mobileArtist = await prisma.artist.create({
    data: { userId: mobileArtistUser.id, specialties: [], portfolioImages: [], preferredSchedule: FULL_WEEK_SCHEDULE },
  });
  mobileArtistId = mobileArtist.id;
  artistIds.push(mobileArtistId);
  await prisma.studioMembership.create({ data: { studioId: homeStudioId, artistId: mobileArtistId, type: StudioMembershipType.HOME } });
  await prisma.studioMembership.create({ data: { studioId: hostStudioId, artistId: mobileArtistId, type: StudioMembershipType.GUEST } });

  // Covers both consumers' default search windows in full -- the staff
  // route's 21 days AND self-schedule's wider 90 (SELF_SCHEDULE_SEARCH_DAYS
  // in routes/selfSchedule.ts) -- so "home refused / host succeeds" holds
  // for the ENTIRE window either route could look at, no matter which real
  // calendar day this suite happens to run on.
  const residencyMembership = await prisma.studioMembership.findFirstOrThrow({ where: { studioId: hostStudioId, artistId: mobileArtistId } });
  const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const windowEnd = new Date(Date.now() + 100 * 24 * 60 * 60 * 1000);
  await prisma.residency.create({
    data: { membershipId: residencyMembership.id, artistId: mobileArtistId, startDate: windowStart, endDate: windowEnd, status: ResidencyStatus.CONFIRMED },
  });
  // A second, non-overlapping CONFIRMED stint at a fixed far-future date --
  // exclusively for the two-timezone test below, which needs a controlled
  // `now` (not real wall-clock time) to avoid flakiness, and therefore
  // needs a residency window that actually covers that controlled date.
  await prisma.residency.create({
    data: {
      membershipId: residencyMembership.id,
      artistId: mobileArtistId,
      startDate: new Date("2027-07-01"),
      endDate: new Date("2027-07-31"),
      status: ResidencyStatus.CONFIRMED,
    },
  });

  const plainArtistUser = await prisma.user.create({ data: { email: `${suffix}-plain-artist@test.invalid`, role: Role.ARTIST, studioId: plainStudioId } });
  userIds.push(plainArtistUser.id);
  const plainArtist = await prisma.artist.create({
    data: { userId: plainArtistUser.id, specialties: [], portfolioImages: [], preferredSchedule: FULL_WEEK_SCHEDULE },
  });
  plainArtistId = plainArtist.id;
  artistIds.push(plainArtistId);
  await prisma.studioMembership.create({ data: { studioId: plainStudioId, artistId: plainArtistId, type: StudioMembershipType.HOME } });

  const homeIntakeForm = await prisma.intakeForm.create({ data: { studioId: homeStudioId, name: "Intake", slug: `${suffix}-intake` } });
  const homeService = await prisma.service.create({
    data: { studioId: homeStudioId, name: "Tattoo", slug: `${suffix}-tattoo`, pricingModel: "RANGE", depositModel: "TIER_BASED", intakeFormId: homeIntakeForm.id },
  });
  homeServiceId = homeService.id;

  const app = express();
  app.use(express.json());
  app.use("/scheduling", schedulingRouter);
  app.use("/self-schedule", selfScheduleRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await prisma.inquiry.deleteMany({ where: { id: { in: inquiryIds } } });
  await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
  await prisma.service.deleteMany({ where: { studioId: { in: studioIds } } });
  await prisma.intakeForm.deleteMany({ where: { studioId: { in: studioIds } } });
  await prisma.residency.deleteMany({ where: { artistId: { in: artistIds } } });
  await prisma.studioMembership.deleteMany({ where: { artistId: { in: artistIds } } });
  await prisma.artist.deleteMany({ where: { id: { in: artistIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.studioSettings.deleteMany({ where: { studioId: { in: studioIds } } });
  await prisma.studio.deleteMany({ where: { id: { in: studioIds } } });
});

test("real HTTP, staff route: home is refused (empty) during a confirmed residency at the host", async () => {
  const res = await fetch(`${baseUrl}/scheduling/suggested-times?artistId=${mobileArtistId}&durationMinutes=60`, {
    headers: { Authorization: `Bearer ${tokenFor(homeOwnerUserId, homeStudioId, Role.OWNER)}` },
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as unknown[];
  assert.equal(body.length, 0, "home staff must get zero suggested times while the artist is on a confirmed residency elsewhere");
});

test("real HTTP, staff route: host succeeds within the residency window", async () => {
  const res = await fetch(`${baseUrl}/scheduling/suggested-times?artistId=${mobileArtistId}&durationMinutes=60`, {
    headers: { Authorization: `Bearer ${tokenFor(hostOwnerUserId, hostStudioId, Role.OWNER)}` },
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { startTime: string }[];
  assert.ok(body.length > 0, "host staff must get real suggested times during the artist's own confirmed residency");
});

// Function-level (getSuggestedTimes called directly with an injected `now`,
// same convention as Part 3's own residencyAvailability.test.ts), not real
// HTTP -- neither /scheduling/suggested-times nor /self-schedule/verify
// accepts a `now` override, and the real HTTP tests above already prove
// this route returns non-empty results at the host; pinning `now` here
// removes the "did the real wall clock already pass today's 9am-5pm
// window" flakiness that a live-clock version of this exact assertion
// would otherwise have, while proving a genuinely different claim than
// those tests do (WHICH timezone the hours are interpreted in, not just
// whether any candidate exists).
test("two-timezone proof: preferred hours during the residency are interpreted in the HOST's own timezone, not carried over from home", async () => {
  const { getSuggestedTimes } = await import("./schedulingAssistant");
  // Well before 09:00 Eastern on the target civil date, so the very first
  // slot-step candidate is exactly the window's own opening time --
  // isolates "which timezone" from "did `now` already eat into today."
  const now = new Date("2027-07-15T05:00:00.000Z"); // 01:00 America/New_York
  const [first] = await getSuggestedTimes(mobileArtistId, 60, hostStudioId, { now, searchDays: 1 });
  assert.ok(first, "expected at least one suggested time to check");

  const dateKey = civilDateKey(first.startTime, "America/New_York");
  const expectedEasternInterpretation = zonedTimeToUtc(dateKey, "09:00", "America/New_York");
  const wrongPacificInterpretation = zonedTimeToUtc(dateKey, "09:00", "America/Los_Angeles");

  assert.equal(
    first.startTime.getTime(),
    expectedEasternInterpretation.getTime(),
    "the first candidate must be 09:00 in the HOST's (Eastern) timezone",
  );
  assert.notEqual(
    expectedEasternInterpretation.getTime(),
    wrongPacificInterpretation.getTime(),
    "sanity: the Eastern and Pacific interpretations of the same preferredSchedule entry must genuinely differ, proving this isn't a coincidental match",
  );
});

test("real HTTP, public client-facing route: self-scheduling at the artist's HOME inquiry is refused during the host residency", async () => {
  const client = await prisma.client.create({ data: { studioId: homeStudioId, firstName: "Home", lastName: "Client", email: `${suffix}-selfsched@test.invalid`, referralCode: `${suffix}-selfsched-ref` } });
  clientIds.push(client.id);
  const inquiry = await prisma.inquiry.create({
    data: {
      studioId: homeStudioId,
      clientId: client.id,
      serviceId: homeServiceId,
      assignedArtistId: mobileArtistId,
      channel: "EMAIL",
      description: "Self-schedule refusal test",
      colorOrBlackGrey: "Color",
      placement: "Arm",
      estimatedSize: "Small",
      hasBeenTattooedBefore: false,
      referenceImages: [],
      placementImages: [],
      timeEstimateHoursMin: 1,
      timeEstimateHoursMax: 1,
      selfScheduleToken: `${suffix}-token`,
      selfScheduleTokenExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });
  inquiryIds.push(inquiry.id);

  const res = await fetch(`${baseUrl}/self-schedule/verify/${suffix}-token`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { availableDates: string[] };
  assert.deepEqual(body.availableDates, [], "a client trying to self-schedule at the artist's HOME studio must see zero available dates while a confirmed residency elsewhere is active");
});

test("regression: an ordinary, never-guesting artist's home scheduling is unaffected (real HTTP + gate-identity proof)", async () => {
  const res = await fetch(`${baseUrl}/scheduling/suggested-times?artistId=${plainArtistId}&durationMinutes=60`, {
    headers: { Authorization: `Bearer ${tokenFor(plainOwnerUserId, plainStudioId, Role.OWNER)}` },
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as unknown[];
  assert.ok(body.length > 0, "an artist with zero Residency rows must still get normal suggested times at their own home studio");

  // Direct proof the new gate is a mathematical no-op for this exact case
  // (home studio, zero confirmed residencies, any date) -- combined with
  // the Part 5 report's cited diff showing dayWindow's only change is this
  // gate's own early-return, this is the "byte-for-byte unchanged"
  // evidence: the gate can never have returned anything but `true` here,
  // so every line of pre-existing logic below it in dayWindow ran exactly
  // as before this epic touched the file.
  const arbitraryDateKeys = ["2020-01-01", "2026-08-08", "2030-12-31", "1999-06-15"];
  for (const dateKey of arbitraryDateKeys) {
    assert.equal(
      isArtistBookableAtStudioOnDate(plainStudioId, plainStudioId, [], dateKey),
      true,
      `gate must be unconditionally true at home with zero residencies, for ${dateKey}`,
    );
  }
});
