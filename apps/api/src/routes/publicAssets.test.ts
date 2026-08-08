// OG-preview infrastructure: Studio.logoUrl and User.avatarUrl are stored
// as base64 data: URLs (lib/images.ts), which no link-preview crawler can
// fetch as an og:image. These two routes decode and re-serve them as real
// image responses so server.mjs has a real hosted URL to point at.

import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { prisma } from "../lib/prisma";
import { Role } from "../../generated/prisma/enums";
import publicAssetsRouter from "./publicAssets";

const suffix = `pa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let server: http.Server;
let baseUrl: string;

const studioIds: string[] = [];
const userIds: string[] = [];
const artistIds: string[] = [];

// 1x1 transparent PNG.
const TINY_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

before(async () => {
  const app = express();
  app.use("/public-assets", publicAssetsRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await prisma.artist.deleteMany({ where: { id: { in: artistIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.studio.deleteMany({ where: { id: { in: studioIds } } });
});

test("GET /public-assets/studio-logo/:studioSlug serves the decoded image", async () => {
  const studio = await prisma.studio.create({
    data: { slug: `${suffix}-logo`, name: "Logo Studio", logoUrl: TINY_PNG_DATA_URL },
  });
  studioIds.push(studio.id);

  const res = await fetch(`${baseUrl}/public-assets/studio-logo/${studio.slug}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/png");
  const buf = Buffer.from(await res.arrayBuffer());
  assert.ok(buf.length > 0);
});

test("GET /public-assets/studio-logo/:studioSlug 404s when the studio has no logo", async () => {
  const studio = await prisma.studio.create({ data: { slug: `${suffix}-nologo`, name: "No Logo Studio" } });
  studioIds.push(studio.id);

  const res = await fetch(`${baseUrl}/public-assets/studio-logo/${studio.slug}`);
  assert.equal(res.status, 404);
});

test("GET /public-assets/studio-logo/:studioSlug 404s for an unknown slug", async () => {
  const res = await fetch(`${baseUrl}/public-assets/studio-logo/does-not-exist-${suffix}`);
  assert.equal(res.status, 404);
});

test("GET /public-assets/artist-avatar/:publicSlug serves the decoded image for a published artist", async () => {
  const studio = await prisma.studio.create({ data: { slug: `${suffix}-avatar-studio`, name: "Avatar Studio" } });
  studioIds.push(studio.id);
  const user = await prisma.user.create({
    data: { email: `avatar-${suffix}@example.com`, role: Role.ARTIST, studioId: studio.id, avatarUrl: TINY_PNG_DATA_URL },
  });
  userIds.push(user.id);
  const artist = await prisma.artist.create({
    data: {
      userId: user.id,
      specialties: [],
      portfolioImages: [],
      publicSlug: `${suffix}-artist`,
      publishedAt: new Date(),
    },
  });
  artistIds.push(artist.id);

  const res = await fetch(`${baseUrl}/public-assets/artist-avatar/${artist.publicSlug}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/png");
});

test("GET /public-assets/artist-avatar/:publicSlug 404s for an unpublished artist even with an avatar set", async () => {
  const studio = await prisma.studio.create({ data: { slug: `${suffix}-unpub-studio`, name: "Unpub Studio" } });
  studioIds.push(studio.id);
  const user = await prisma.user.create({
    data: { email: `unpub-${suffix}@example.com`, role: Role.ARTIST, studioId: studio.id, avatarUrl: TINY_PNG_DATA_URL },
  });
  userIds.push(user.id);
  const artist = await prisma.artist.create({
    data: { userId: user.id, specialties: [], portfolioImages: [], publicSlug: `${suffix}-unpub-artist` },
  });
  artistIds.push(artist.id);

  const res = await fetch(`${baseUrl}/public-assets/artist-avatar/${artist.publicSlug}`);
  assert.equal(res.status, 404);
});
