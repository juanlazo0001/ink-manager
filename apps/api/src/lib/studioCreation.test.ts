// Embedded payments default-on rollout: both studio-creation paths
// (createStudioWithOwner, shared by self-serve signup and the
// create-studio.ts platform-operator script, and Go Solo's own separate
// transaction in routes/artists.ts) now eagerly create a StudioSettings
// row rather than relying on getOrCreateSettings' lazy fallback -- a
// brand new studio's very first payment link can be created before
// anyone ever opens Settings, and every payment-flow read path falls
// back to `?? false` when the row doesn't exist. This covers both paths
// actually producing a row with the schema's own (now-true)
// embeddedPaymentsEnabled default, immediately, with no extra read.

import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import jwt from "jsonwebtoken";
import { prisma } from "./prisma";
import { JWT_SECRET } from "./jwt";
import { Role } from "../../generated/prisma/enums";
import { createStudioWithOwner } from "./studioCreation";
import artistsRouter from "../routes/artists";

function tokenFor(userId: string, studioId: string, role: Role): string {
  return jwt.sign({ userId, studioId, role }, JWT_SECRET);
}

const suffix = `sc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let server: http.Server;
let baseUrl: string;

const studioIds: string[] = [];
const userIds: string[] = [];
const artistIds: string[] = [];

before(async () => {
  const app = express();
  app.use(express.json());
  app.use("/artists", artistsRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await prisma.auditLog.deleteMany({ where: { studioId: { in: studioIds } } });
  await prisma.studioMembership.deleteMany({ where: { studioId: { in: studioIds } } });
  await prisma.studioSettings.deleteMany({ where: { studioId: { in: studioIds } } });
  await prisma.artist.deleteMany({ where: { id: { in: artistIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.studio.deleteMany({ where: { id: { in: studioIds } } });
});

test("createStudioWithOwner eagerly creates a StudioSettings row with embeddedPaymentsEnabled on", async () => {
  const { studio, owner } = await createStudioWithOwner({
    studioName: `Test Studio ${suffix}`,
    ownerEmail: `owner-${suffix}@example.com`,
    ownerName: "Test Owner",
    ownerPhone: null,
    soloArtist: false,
    auth: {
      mode: "invite",
      inviteToken: `invite-${suffix}`,
      inviteTokenExpiresAt: new Date(Date.now() + 86400000),
    },
  });
  studioIds.push(studio.id);
  userIds.push(owner.id);

  const settings = await prisma.studioSettings.findUnique({ where: { studioId: studio.id } });
  assert.ok(settings, "StudioSettings row should exist immediately, not just on first Settings read");
  assert.equal(settings!.embeddedPaymentsEnabled, true);
});

test("POST /artists/:id/go-solo eagerly creates a StudioSettings row with embeddedPaymentsEnabled on", async () => {
  const oldStudio = await prisma.studio.create({ data: { slug: `${suffix}-old`, name: "Old Studio" } });
  studioIds.push(oldStudio.id);

  const user = await prisma.user.create({
    data: { email: `solo-${suffix}@example.com`, role: Role.ARTIST, studioId: oldStudio.id, name: "Solo Artist" },
  });
  userIds.push(user.id);

  const artist = await prisma.artist.create({ data: { userId: user.id, specialties: [], portfolioImages: [] } });
  artistIds.push(artist.id);

  await prisma.studioMembership.create({
    data: { studioId: oldStudio.id, artistId: artist.id, type: "HOME", allowsStudioProfileEdits: true },
  });

  const token = tokenFor(user.id, oldStudio.id, Role.ARTIST);
  const res = await fetch(`${baseUrl}/artists/${artist.id}/go-solo`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ studioName: `Solo Studio ${suffix}` }),
  });
  assert.equal(res.status, 201);
  const body = (await res.json()) as { studio: { id: string } };
  studioIds.push(body.studio.id);

  const settings = await prisma.studioSettings.findUnique({ where: { studioId: body.studio.id } });
  assert.ok(settings, "StudioSettings row should exist immediately after go-solo, not just on first Settings read");
  assert.equal(settings!.embeddedPaymentsEnabled, true);
});
