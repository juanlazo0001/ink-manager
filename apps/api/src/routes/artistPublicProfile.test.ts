// Core coverage for 6a Epic Part 4 (public artist page). Exhaustive
// end-to-end booking-flow and live-browser verification lands in Part 5 --
// this establishes the publish/unpublish mechanics, the
// publishable-requires-location rule, the public fetch's 404 behavior,
// and the booking-artist pre-assignment mechanism work correctly.

import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma";
import { JWT_SECRET } from "../lib/jwt";
import { Role } from "../../generated/prisma/enums";
import artistsRouter from "./artists";
import artistPublicProfileRouter from "./artistPublicProfile";
import inquiriesRouter from "./inquiries";

function tokenFor(userId: string, studioId: string, role: Role): string {
  return jwt.sign({ userId, studioId, role }, JWT_SECRET);
}

const suffix = `pub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let server: http.Server;
let baseUrl: string;

const studioIds: string[] = [];
const userIds: string[] = [];
const artistIds: string[] = [];
const clientIds: string[] = [];
const serviceIds: string[] = [];
const inquiryIds: string[] = [];
const locationIds: string[] = [];

let studioId: string;
let studioSlug: string;
let artistUserId: string;
let artistId: string;

before(async () => {
  const studio = await prisma.studio.create({ data: { name: `Pub Studio ${suffix}`, slug: `pub-studio-${suffix}` } });
  studioId = studio.id;
  studioSlug = studio.slug;
  studioIds.push(studioId);

  const artistUser = await prisma.user.create({ data: { email: `${suffix}-artist@test.invalid`, role: Role.ARTIST, studioId, name: "Public Test Artist" } });
  artistUserId = artistUser.id;
  userIds.push(artistUserId);
  const artist = await prisma.artist.create({ data: { userId: artistUserId, specialties: ["Blackwork"], portfolioImages: [], bio: "Test bio" } });
  artistId = artist.id;
  artistIds.push(artistId);

  const app = express();
  app.use(express.json());
  app.use("/artists", artistPublicProfileRouter);
  app.use("/artists", artistsRouter);
  app.use("/inquiries", inquiriesRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  const clientsInScope = await prisma.client.findMany({ where: { studioId: { in: studioIds } }, select: { id: true } });
  const clientIdsInScope = clientsInScope.map((c) => c.id);
  await prisma.inquiry.deleteMany({ where: { studioId: { in: studioIds } } });
  await prisma.clientEmail.deleteMany({ where: { clientId: { in: clientIdsInScope } } });
  await prisma.clientPhone.deleteMany({ where: { clientId: { in: clientIdsInScope } } });
  await prisma.client.deleteMany({ where: { studioId: { in: studioIds } } });
  await prisma.service.deleteMany({ where: { id: { in: serviceIds } } });
  await prisma.intakeForm.deleteMany({ where: { studioId: { in: studioIds } } });
  await prisma.location.deleteMany({ where: { id: { in: locationIds } } });
  await prisma.artist.deleteMany({ where: { id: { in: artistIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.auditLog.deleteMany({ where: { studioId: { in: studioIds } } });
  await prisma.studio.deleteMany({ where: { id: { in: studioIds } } });
});

test("public fetch of a never-published slug -> 404", async () => {
  const res = await fetch(`${baseUrl}/artists/public/${suffix}-nonexistent`);
  assert.equal(res.status, 404);
});

test("publish is blocked when the home studio has no location on file", async () => {
  const token = tokenFor(artistUserId, studioId, Role.ARTIST);
  const res = await fetch(`${baseUrl}/artists/${artistId}/publish`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ publish: true, publicSlug: `${suffix}-slug` }),
  });
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string };
  assert.match(body.error, /location/i);
});

test("publish succeeds once a location exists; the public page is then reachable and unpublished afterward 404s again", async () => {
  const location = await prisma.location.create({ data: { studioId, name: "Main shop" } });
  locationIds.push(location.id);

  const token = tokenFor(artistUserId, studioId, Role.ARTIST);
  const publishRes = await fetch(`${baseUrl}/artists/${artistId}/publish`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ publish: true, publicSlug: `${suffix}-slug` }),
  });
  assert.equal(publishRes.status, 200);

  const publicRes = await fetch(`${baseUrl}/artists/public/${suffix}-slug`);
  assert.equal(publicRes.status, 200);
  const publicBody = (await publicRes.json()) as { id: string; name: string; homeStudio: { slug: string } };
  assert.equal(publicBody.id, artistId);
  assert.equal(publicBody.name, "Public Test Artist");
  assert.equal(publicBody.homeStudio.slug, studioSlug);

  const unpublishRes = await fetch(`${baseUrl}/artists/${artistId}/publish`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ publish: false }),
  });
  assert.equal(unpublishRes.status, 200);

  const afterUnpublishRes = await fetch(`${baseUrl}/artists/public/${suffix}-slug`);
  assert.equal(afterUnpublishRes.status, 404, "an unpublished artist's slug must 404, not just stop appearing somewhere");
});

test("a different artist cannot publish someone else's page (self-only, no staff bypass)", async () => {
  const otherStudio = await prisma.studio.create({ data: { name: `Pub Other ${suffix}`, slug: `pub-other-${suffix}` } });
  studioIds.push(otherStudio.id);
  const ownerUser = await prisma.user.create({ data: { email: `${suffix}-owner@test.invalid`, role: Role.OWNER, studioId } });
  userIds.push(ownerUser.id);

  const token = tokenFor(ownerUser.id, studioId, Role.OWNER);
  const res = await fetch(`${baseUrl}/artists/${artistId}/publish`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ publish: false }),
  });
  assert.equal(res.status, 404, "not even the artist's own studio OWNER can publish/unpublish on their behalf");
});

test("booking via a public-page BOOK link pre-assigns the artist directly (not just preferredArtistId)", async () => {
  const location = await prisma.location.findFirst({ where: { studioId } });
  if (!location) {
    await prisma.location.create({ data: { studioId, name: "Main shop 2" } }).then((l) => locationIds.push(l.id));
  }

  const intake = await prisma.intakeForm.create({ data: { studioId, name: "Intake", slug: `${suffix}-intake` } });
  const service = await prisma.service.create({
    data: { studioId, name: "Tattoo", slug: `${suffix}-tattoo`, pricingModel: "RANGE", depositModel: "TIER_BASED", intakeFormId: intake.id },
  });
  serviceIds.push(service.id);

  const res = await fetch(`${baseUrl}/inquiries`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      studioSlug,
      formSlug: intake.slug,
      firstName: "Book",
      lastName: "Client",
      email: `${suffix}-bookclient@test.invalid`,
      channel: "EMAIL",
      description: "From the artist's public page",
      colorOrBlackGrey: "Color",
      placement: "Arm",
      estimatedSize: "Small",
      hasBeenTattooedBefore: false,
      referenceImages: ["https://example.test/ref.png"],
      placementImages: ["https://example.test/placement.png"],
      smsConsent: true,
      bookingArtistId: artistId,
    }),
  });
  assert.equal(res.status, 201);
  const body = (await res.json()) as { id: string; assignedArtistId: string | null; status: string };
  inquiryIds.push(body.id);
  clientIds.push((await prisma.inquiry.findUniqueOrThrow({ where: { id: body.id }, select: { clientId: true } })).clientId);

  assert.equal(body.assignedArtistId, artistId, "bookingArtistId must directly assign, unlike the soft preferredArtistId field");
  assert.equal(body.status, "ARTIST_ASSIGNED");
});
