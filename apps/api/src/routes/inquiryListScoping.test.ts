// GET /inquiries/assigned-to-me: list/detail scoping consistency.
//
// The list and its own detail route used to disagree about WHERE a
// permission is evaluated, and the list had no studio filter at all:
//
//   list   -> requirePermission("inquiries.view"), read against the
//             caller's HOME studio (req.user.studioId), and a query keyed
//             on assignedArtistId ALONE
//   detail -> hasPermissionAt(inquiry.studio.id, "inquiries.view"), read
//             against the RECORD's studio
//
// Two consequences, both covered below:
//
//  1. An artist whose home grants inquiries.view but whose HOST studio
//     denies it for ARTIST could list every project assigned to them
//     there and 403 opening any of them. Reproduced in dev; the reported
//     symptom.
//  2. The inverse, and the ghost-access case nobody reported: with no
//     studio filter, an artist kept seeing a studio's projects in this
//     list after their GUEST membership ENDED. Forever. The detail route
//     already closed that (effectiveRoleAt returns null with no live
//     membership); this list never did.
//
// The decision recorded in the architect thread is that the DETAIL
// route's semantics win. So the invariant every test here asserts is the
// same one, stated two ways: NO ROW IS LISTED THAT CANNOT BE OPENED, and
// no row that CAN be opened is missing from the list.

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

function tokenFor(userId: string, studioId: string, role: Role): string {
  return jwt.sign({ userId, studioId, role }, JWT_SECRET);
}

const suffix = `ils-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let server: http.Server;
let baseUrl: string;

const studioIds: string[] = [];
const userIds: string[] = [];
const artistIds: string[] = [];
const clientIds: string[] = [];
const serviceIds: string[] = [];
const inquiryIds: string[] = [];
const membershipIds: string[] = [];

let homeStudioId: string;
let hostStudioId: string;
let endedStudioId: string;

let artistUserId: string;
let artistId: string;

let homeInquiryId: string;
let hostInquiryId: string;
let endedInquiryId: string;

let endedMembershipId: string;

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

async function makeInquiry(studioId: string, tag: string): Promise<string> {
  const client = await prisma.client.create({
    data: { studioId, firstName: "Test", lastName: tag, referralCode: `${suffix}-${tag}-ref` },
  });
  clientIds.push(client.id);
  const inquiry = await prisma.inquiry.create({
    data: {
      studioId,
      clientId: client.id,
      serviceId: await makeService(studioId),
      assignedArtistId: artistId,
      assignedAt: new Date(),
      channel: "EMAIL",
      description: `List/detail scoping test -- ${tag}`,
      colorOrBlackGrey: "Color",
      placement: "Forearm",
      estimatedSize: "Small",
      hasBeenTattooedBefore: false,
      status: "ARTIST_ASSIGNED",
    },
  });
  inquiryIds.push(inquiry.id);
  return inquiry.id;
}

async function setOverride(studioId: string, role: Role, permissionKey: string, allowed: boolean) {
  await prisma.rolePermission.upsert({
    where: { studioId_role_permissionKey: { studioId, role, permissionKey } },
    update: { allowed },
    create: { studioId, role, permissionKey, allowed },
  });
}

async function listIds(): Promise<{ status: number; ids: string[] }> {
  const res = await fetch(`${baseUrl}/inquiries/assigned-to-me?scope=all`, {
    headers: { Authorization: `Bearer ${tokenFor(artistUserId, homeStudioId, Role.ARTIST)}` },
  });
  if (res.status !== 200) return { status: res.status, ids: [] };
  const rows = (await res.json()) as { id: string }[];
  return { status: 200, ids: rows.map((r) => r.id) };
}

async function detailStatus(inquiryId: string): Promise<number> {
  const res = await fetch(`${baseUrl}/inquiries/assigned-to-me/${inquiryId}`, {
    headers: { Authorization: `Bearer ${tokenFor(artistUserId, homeStudioId, Role.ARTIST)}` },
  });
  return res.status;
}

// The whole point, asserted directly rather than inferred: walk every id
// the list returned and confirm each one actually opens.
async function assertEveryListedRowOpens(ids: string[]) {
  for (const id of ids) {
    assert.equal(await detailStatus(id), 200, `listed row ${id} must be openable -- a list must not show a 403`);
  }
}

before(async () => {
  homeStudioId = await makeStudio("home");
  hostStudioId = await makeStudio("host");
  endedStudioId = await makeStudio("ended");

  const artistUser = await prisma.user.create({
    data: { email: `${suffix}-artist@test.invalid`, role: Role.ARTIST, studioId: homeStudioId },
  });
  artistUserId = artistUser.id;
  userIds.push(artistUserId);
  const artist = await prisma.artist.create({
    data: { userId: artistUserId, specialties: [], portfolioImages: [] },
  });
  artistId = artist.id;
  artistIds.push(artistId);

  const hostMembership = await prisma.studioMembership.create({
    data: { studioId: hostStudioId, artistId, type: StudioMembershipType.GUEST },
  });
  membershipIds.push(hostMembership.id);

  // Live for now -- ended inside the ghost-access test itself, so the
  // "before" and "after" of that transition are both observed.
  const endedMembership = await prisma.studioMembership.create({
    data: { studioId: endedStudioId, artistId, type: StudioMembershipType.GUEST },
  });
  endedMembershipId = endedMembership.id;
  membershipIds.push(endedMembershipId);

  homeInquiryId = await makeInquiry(homeStudioId, "home");
  hostInquiryId = await makeInquiry(hostStudioId, "host");
  endedInquiryId = await makeInquiry(endedStudioId, "ended");

  const app = express();
  app.use(express.json());
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
  await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
  await prisma.service.deleteMany({ where: { id: { in: serviceIds } } });
  await prisma.intakeForm.deleteMany({ where: { studioId: { in: studioIds } } });
  await prisma.studioMembership.deleteMany({ where: { id: { in: membershipIds } } });
  await prisma.artist.deleteMany({ where: { id: { in: artistIds } } });
  await prisma.rolePermission.deleteMany({ where: { studioId: { in: studioIds } } });
  await prisma.auditLog.deleteMany({ where: { studioId: { in: studioIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.studioSettings.deleteMany({ where: { studioId: { in: studioIds } } });
  await prisma.studio.deleteMany({ where: { id: { in: studioIds } } });
});

test("baseline: all three studios granting inquiries.view -- every assigned project is listed, and every listed project opens", async () => {
  const { status, ids } = await listIds();
  assert.equal(status, 200);
  assert.ok(ids.includes(homeInquiryId), "home project must be listed");
  assert.ok(ids.includes(hostInquiryId), "guest-studio project must be listed");
  assert.ok(ids.includes(endedInquiryId), "the second guest studio's project must be listed while that membership is live");
  await assertEveryListedRowOpens(ids);
});

test("the reported bug: a HOST studio that denies ARTIST inquiries.view no longer contributes rows that 403 on open", async () => {
  await setOverride(hostStudioId, Role.ARTIST, "inquiries.view", false);

  // The detail route's answer is the one that wins, and it has not moved.
  assert.equal(await detailStatus(hostInquiryId), 403, "the host studio genuinely denies this caller");

  const { status, ids } = await listIds();
  assert.equal(status, 200, "the caller is still entitled at their home studio, so the list itself must not 403");
  assert.equal(ids.includes(hostInquiryId), false, "the un-openable host row must be gone from the list");
  assert.ok(ids.includes(homeInquiryId), "their home project is unaffected");
  await assertEveryListedRowOpens(ids);

  await setOverride(hostStudioId, Role.ARTIST, "inquiries.view", true);
});

test("the inverse: HOME denying inquiries.view no longer hides a guest-studio project the caller CAN open", async () => {
  // Previously the home-studio-scoped middleware 403'd this whole route,
  // so a project the caller was fully entitled to open was unreachable --
  // the list it would have been found in refused to load at all.
  await setOverride(homeStudioId, Role.ARTIST, "inquiries.view", false);

  assert.equal(await detailStatus(hostInquiryId), 200, "the host studio still grants it, so it still opens");
  assert.equal(await detailStatus(homeInquiryId), 403, "their own home studio now denies it");

  const { status, ids } = await listIds();
  assert.equal(status, 200);
  assert.ok(ids.includes(hostInquiryId), "the openable guest-studio project must be findable");
  assert.equal(ids.includes(homeInquiryId), false, "the home project no longer opens, so it must not be listed");
  await assertEveryListedRowOpens(ids);

  await setOverride(homeStudioId, Role.ARTIST, "inquiries.view", true);
});

test("no studio grants it at all: still a 403, not a silently empty list", async () => {
  // Deliberately preserved. For the single-studio artist -- the
  // overwhelmingly common case -- behaviour is byte-identical to before
  // this fix: denied means 403, not 200 with nothing in it.
  await setOverride(homeStudioId, Role.ARTIST, "inquiries.view", false);
  await setOverride(hostStudioId, Role.ARTIST, "inquiries.view", false);
  await setOverride(endedStudioId, Role.ARTIST, "inquiries.view", false);

  const { status } = await listIds();
  assert.equal(status, 403, "a fully-denied caller gets the same 403 they always did");

  await setOverride(homeStudioId, Role.ARTIST, "inquiries.view", true);
  await setOverride(hostStudioId, Role.ARTIST, "inquiries.view", true);
  await setOverride(endedStudioId, Role.ARTIST, "inquiries.view", true);
});

test("ghost access: ending a GUEST membership removes that studio's projects from the list, not just from the detail route", async () => {
  // The bug this closes was never reported and is the more serious half.
  // With no studio filter on the query, an artist kept seeing a studio's
  // projects here after the relationship ended -- indefinitely, since
  // nothing else in the route referred to the studio at all.
  const before = await listIds();
  assert.ok(before.ids.includes(endedInquiryId), "precondition: visible while the membership is live");
  assert.equal(await detailStatus(endedInquiryId), 200, "precondition: openable while the membership is live");

  await prisma.studioMembership.update({ where: { id: endedMembershipId }, data: { endedAt: new Date() } });

  assert.equal(
    await detailStatus(endedInquiryId),
    403,
    "the detail route already enforced this correctly -- effectiveRoleAt returns null with no live membership",
  );

  const after = await listIds();
  assert.equal(after.status, 200);
  assert.equal(after.ids.includes(endedInquiryId), false, "and now the list agrees, instead of showing it forever");
  assert.ok(after.ids.includes(homeInquiryId), "unrelated studios are untouched");
  assert.ok(after.ids.includes(hostInquiryId));
  await assertEveryListedRowOpens(after.ids);
});
