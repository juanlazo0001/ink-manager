// Language becomes customer-specific: HTTP-level proof for the staff
// escape hatch (PATCH /clients/:id preferredLocale), the one new field
// this feature adds to EDITABLE_CLIENT_FIELDS. Sibling test to
// contentTranslationHttp.test.ts, same real HTTP + real DB conventions.

import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma";
import { JWT_SECRET } from "../lib/jwt";
import { Role } from "../../generated/prisma/enums";
import clientsRouter from "./clients";

function tokenFor(userId: string, studioId: string, role: Role): string {
  return jwt.sign({ userId, studioId, role }, JWT_SECRET);
}

const suffix = `cpl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let server: http.Server;
let baseUrl: string;

const studioIds: string[] = [];
const userIds: string[] = [];
const clientIds: string[] = [];

before(async () => {
  const app = express();
  app.use(express.json());
  app.use("/clients", clientsRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await prisma.auditLog.deleteMany({ where: { studioId: { in: studioIds } } });
  await prisma.rolePermission.deleteMany({ where: { studioId: { in: studioIds } } });
  await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.studio.deleteMany({ where: { id: { in: studioIds } } });
});

test("PATCH /clients/:id sets and clears preferredLocale", async () => {
  const studio = await prisma.studio.create({ data: { name: `Studio ${suffix}`, slug: `studio-${suffix}` } });
  studioIds.push(studio.id);
  const owner = await prisma.user.create({
    data: { email: `owner-${suffix}@test.invalid`, role: Role.OWNER, studioId: studio.id, name: "Test Owner" },
  });
  userIds.push(owner.id);
  const ownerToken = tokenFor(owner.id, studio.id, Role.OWNER);

  const client = await prisma.client.create({
    data: { studioId: studio.id, firstName: "Jane", lastName: "Doe", referralCode: `REF${suffix}` },
  });
  clientIds.push(client.id);

  const setRes = await fetch(`${baseUrl}/clients/${client.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ preferredLocale: "es" }),
  });
  assert.equal(setRes.status, 200);
  const setBody = (await setRes.json()) as { preferredLocale: string | null };
  assert.equal(setBody.preferredLocale, "es");

  const clearRes = await fetch(`${baseUrl}/clients/${client.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ preferredLocale: null }),
  });
  assert.equal(clearRes.status, 200);
  const clearBody = (await clearRes.json()) as { preferredLocale: string | null };
  assert.equal(clearBody.preferredLocale, null);
});

test("PATCH /clients/:id rejects an unsupported preferredLocale", async () => {
  const studio = await prisma.studio.create({ data: { name: `Studio ${suffix}-2`, slug: `studio-${suffix}-2` } });
  studioIds.push(studio.id);
  const owner = await prisma.user.create({
    data: { email: `owner2-${suffix}@test.invalid`, role: Role.OWNER, studioId: studio.id, name: "Test Owner" },
  });
  userIds.push(owner.id);
  const ownerToken = tokenFor(owner.id, studio.id, Role.OWNER);

  const client = await prisma.client.create({
    data: { studioId: studio.id, firstName: "A", lastName: "B", referralCode: `REF2${suffix}` },
  });
  clientIds.push(client.id);

  const res = await fetch(`${baseUrl}/clients/${client.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ preferredLocale: "fr" }),
  });
  assert.equal(res.status, 400);

  const unchanged = await prisma.client.findUnique({ where: { id: client.id } });
  assert.equal(unchanged?.preferredLocale, null);
});

test("PATCH /clients/:id preferredLocale is matrix-gated by clients.edit like every other field", async () => {
  const studio = await prisma.studio.create({ data: { name: `Studio ${suffix}-3`, slug: `studio-${suffix}-3` } });
  studioIds.push(studio.id);
  const artistUser = await prisma.user.create({
    data: { email: `artist-${suffix}@test.invalid`, role: Role.ARTIST, studioId: studio.id, name: "Test Artist" },
  });
  userIds.push(artistUser.id);
  await prisma.rolePermission.upsert({
    where: { studioId_role_permissionKey: { studioId: studio.id, role: Role.ARTIST, permissionKey: "clients.edit" } },
    update: { allowed: false },
    create: { studioId: studio.id, role: Role.ARTIST, permissionKey: "clients.edit", allowed: false },
  });
  const artistToken = tokenFor(artistUser.id, studio.id, Role.ARTIST);

  const client = await prisma.client.create({
    data: { studioId: studio.id, firstName: "C", lastName: "D", referralCode: `REF3${suffix}` },
  });
  clientIds.push(client.id);

  const res = await fetch(`${baseUrl}/clients/${client.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${artistToken}` },
    body: JSON.stringify({ preferredLocale: "es" }),
  });
  assert.equal(res.status, 403);
});
