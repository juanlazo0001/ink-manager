// Permanently deleting a team member who is an ARTIST used to fail with a raw
// Prisma P2003 (RestrictViolation), seen live in the production logs: the
// route deleted only ArtistReminderLog before calling artist.delete(), while
// StudioMembership -- which EVERY artist has, since it is how an artist
// belongs to a studio -- still referenced the row. Artist mobility introduced
// that table after this route was written and the deletion path was never
// revisited.
//
// These tests run against the real database through the real router, because
// the defect is a foreign-key constraint: a mocked Prisma would have happily
// "passed" the broken version. Every fixture is suffixed and torn down.

import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma";
import { JWT_SECRET } from "../lib/jwt";
import {
  Role,
  ServiceDepositModel,
  ServicePricingModel,
  StudioMembershipType,
} from "../../generated/prisma/enums";
import { createStudioWithOwner } from "../lib/studioCreation";
import studiosRouter from "./studios";

const suffix = `sd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let server: http.Server;
let baseUrl: string;
let studioId: string;
let ownerId: string;
let ownerToken: string;

function tokenFor(userId: string, sid: string, role: Role): string {
  return jwt.sign({ userId, studioId: sid, role }, JWT_SECRET);
}

async function del(userId: string, token: string) {
  const res = await fetch(`${baseUrl}/studios/${studioId}/users/${userId}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ confirm: "DELETE" }),
  });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

// A studio member who is a real artist: user + Artist profile + the
// StudioMembership that makes them a member. That membership is the row the
// old implementation tripped over.
async function makeArtist(label: string) {
  const user = await prisma.user.create({
    data: {
      email: `${label}-${suffix}@example.test`,
      name: `Artist ${label}`,
      password: "x",
      role: Role.ARTIST,
      studioId,
      isActive: true,
    },
  });
  const artist = await prisma.artist.create({ data: { userId: user.id } });
  const membership = await prisma.studioMembership.create({
    data: { studioId, artistId: artist.id, type: StudioMembershipType.HOME },
  });
  return { user, artist, membership };
}

// Service requires an intake form, so the two go together.
async function makeService(label: string) {
  const form = await prisma.intakeForm.create({
    data: { studioId, name: `Form ${label} ${suffix}`, slug: `form-${label}-${suffix}` },
  });
  const service = await prisma.service.create({
    data: {
      studioId,
      name: `Service ${label} ${suffix}`,
      slug: `svc-${label}-${suffix}`,
      pricingModel: ServicePricingModel.RANGE,
      depositModel: ServiceDepositModel.TIER_BASED,
      intakeFormId: form.id,
    },
  });
  return { form, service };
}

before(async () => {
  const app = express();
  app.use(express.json());
  app.use("/studios", studiosRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}`;

  const created = await createStudioWithOwner({
    studioName: `Staff Deletion ${suffix}`,
    ownerName: "Test Owner",
    ownerEmail: `owner-${suffix}@example.test`,
    ownerPhone: null,
    soloArtist: false,
    auth: {
      mode: "invite",
      inviteToken: `invite-${suffix}`,
      inviteTokenExpiresAt: new Date(Date.now() + 86_400_000),
    },
  });
  studioId = created.studio.id;
  ownerId = created.owner.id;
  ownerToken = tokenFor(ownerId, studioId, Role.OWNER);
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  // Fixtures are suffixed, so this only ever touches this run's rows.
  const users = await prisma.user.findMany({ where: { studioId }, select: { id: true } });
  const ids = users.map((u) => u.id);
  const artists = await prisma.artist.findMany({ where: { userId: { in: ids } }, select: { id: true } });
  const artistIds = artists.map((a) => a.id);
  await prisma.residency.deleteMany({ where: { artistId: { in: artistIds } } });
  await prisma.studioMembership.deleteMany({ where: { artistId: { in: artistIds } } });
  await prisma.artistService.deleteMany({ where: { artistId: { in: artistIds } } });
  await prisma.flashPiece.deleteMany({ where: { artistId: { in: artistIds } } });
  await prisma.artistReminderLog.deleteMany({ where: { artistId: { in: artistIds } } });
  await prisma.artist.deleteMany({ where: { id: { in: artistIds } } });
  await prisma.auditLog.deleteMany({ where: { studioId } });
  await prisma.personalTask.deleteMany({ where: { userId: { in: ids } } });
  await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
  await prisma.userWidgetLayout.deleteMany({ where: { userId: { in: ids } } });
  await prisma.artistTransfer.deleteMany({ where: { originStudioId: studioId } });
  await prisma.service.deleteMany({ where: { studioId } });
  await prisma.intakeForm.deleteMany({ where: { studioId } });
  await prisma.studioSettings.deleteMany({ where: { studioId } });
  await prisma.user.deleteMany({ where: { studioId } });
  await prisma.studio.deleteMany({ where: { id: studioId } });
  await prisma.$disconnect();
});

// THE REGRESSION. Under the old implementation this returns 500 (P2003
// RestrictViolation) because the StudioMembership still points at the Artist.
test("deletes an artist who has a studio membership", async () => {
  const { user, artist, membership } = await makeArtist("plain");

  const res = await del(user.id, ownerToken);
  assert.equal(res.status, 200, `expected 200, got ${res.status} ${JSON.stringify(res.body)}`);
  assert.equal(res.body?.success, true);

  assert.equal(await prisma.user.count({ where: { id: user.id } }), 0, "user row should be gone");
  assert.equal(await prisma.artist.count({ where: { id: artist.id } }), 0, "artist row should be gone");
  assert.equal(
    await prisma.studioMembership.count({ where: { id: membership.id } }),
    0,
    "membership should be gone with the artist",
  );
});

// Each of these is a separate RESTRICT that would independently fail the
// delete, so they get their own case rather than being bundled into one.
test("deletes an artist who also has services and flash pieces", async () => {
  const { user, artist } = await makeArtist("rich");

  const { form, service } = await makeService("rich");
  await prisma.artistService.create({ data: { artistId: artist.id, serviceId: service.id } });
  const flash = await prisma.flashPiece.create({
    data: {
      artistId: artist.id,
      studioId,
      title: `Flash ${suffix}`,
      imageUrl: "https://example.test/f.png",
      priceCents: 10_000,
      estimatedDurationMinutes: 60,
    },
  });

  const res = await del(user.id, ownerToken);
  assert.equal(res.status, 200, `expected 200, got ${res.status} ${JSON.stringify(res.body)}`);
  assert.equal(res.body?.success, true);

  assert.equal(await prisma.artistService.count({ where: { artistId: artist.id } }), 0);
  assert.equal(await prisma.flashPiece.count({ where: { id: flash.id } }), 0);

  await prisma.service.deleteMany({ where: { id: service.id } });
  await prisma.intakeForm.deleteMany({ where: { id: form.id } });
});

// Positive sibling for the blocking cases below: without it, an implementation
// that simply refused every artist delete would pass those two and look
// correct. The two tests above are that sibling for the whole file.
test("a NON-artist staff member still deletes cleanly", async () => {
  const user = await prisma.user.create({
    data: {
      email: `frontdesk-${suffix}@example.test`,
      name: "Front Desk",
      password: "x",
      role: Role.FRONT_DESK,
      studioId,
      isActive: true,
    },
  });

  const res = await del(user.id, ownerToken);
  assert.equal(res.status, 200, `expected 200, got ${res.status} ${JSON.stringify(res.body)}`);
  assert.equal(res.body?.success, true);
  assert.equal(await prisma.user.count({ where: { id: user.id } }), 0);
});

// The guard this change ADDS. A transfer is shared with another studio, so
// the delete refuses rather than quietly destroying that studio's record --
// and it refuses with a readable 400 instead of the raw P2003 the old code
// produced. Falsifiable in both directions: the two passing deletes above
// prove this is a real precondition and not a blanket refusal.
test("refuses -- with a readable error -- when the artist has a studio transfer", async () => {
  const { user, artist } = await makeArtist("xfer");

  const other = await prisma.studio.create({
    data: { name: `Other Studio ${suffix}`, slug: `other-${suffix}` },
  });
  const transfer = await prisma.artistTransfer.create({
    data: {
      originStudioId: studioId,
      destinationStudioId: other.id,
      artistId: artist.id,
      initiatedById: ownerId,
    },
  });

  const res = await del(user.id, ownerToken);
  assert.equal(res.status, 400, `expected 400, got ${res.status} ${JSON.stringify(res.body)}`);
  assert.match(String(res.body?.error ?? ""), /transfer/i);

  // A refused delete must not have partially run.
  assert.equal(await prisma.user.count({ where: { id: user.id } }), 1);
  assert.equal(await prisma.artist.count({ where: { id: artist.id } }), 1);
  assert.equal(await prisma.studioMembership.count({ where: { artistId: artist.id } }), 1);

  await prisma.artistTransfer.deleteMany({ where: { id: transfer.id } });
  await prisma.studio.deleteMany({ where: { id: other.id } });
});
