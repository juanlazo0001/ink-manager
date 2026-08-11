// Regression coverage for the flash governance split (REPORT.md: "Flash
// governance split" -- approved, closing the exact swap "Permission-
// context fix Part 4" flagged and deliberately deferred). Same "real
// Prisma, real HTTP, self-contained fixtures created here and torn down
// in `after`" convention as permissionContext.test.ts. Run with
// `npx tsx --test src/routes/flashGovernance.test.ts` (or `npm test`).
//
// Five scenarios:
//
// 1. NEGATIVE: staff (OWNER) editing another artist's flash-piece CONTENT
//    at a studio where that artist's delegation toggle is OFF -> 403, and
//    the piece is left untouched.
// 2. Lifecycle unaffected by (1): the SAME OWNER, SAME studio, SAME
//    delegation-OFF artist -- retiring one of that artist's pieces still
//    succeeds. Proves the matrix key (flashGallery.manage) still governs
//    the studio-facing lifecycle action untouched by this split.
// 3. POSITIVE: staff (OWNER) editing another artist's flash-piece CONTENT
//    at a studio where that artist's delegation toggle is ON -> 200, and
//    the new values persist.
// 4. Artist always: the delegation-OFF artist editing their OWN piece,
//    at their OWN studio -- succeeds regardless of their own delegation
//    setting (the isSelf carve-out is unconditional, untouched by this
//    change).
// 5. Solo unaffected: a genuinely solo owner-artist editing their OWN
//    piece in their OWN studio -- succeeds, same isSelf carve-out, proving
//    the split didn't regress the common solo-studio case.

import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma";
import { JWT_SECRET } from "../lib/jwt";
import { Role } from "../../generated/prisma/enums";
import flashPiecesRouter from "./flashPieces";

function tokenFor(userId: string, studioId: string, role: Role): string {
  return jwt.sign({ userId, studioId, role }, JWT_SECRET);
}

const suffix = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let server: http.Server;
let baseUrl: string;

let studioOffId: string; // delegation OFF for its artist
let studioOnId: string; // delegation ON for its artist
let soloStudioId: string; // genuinely solo owner-artist

let ownerOffUserId: string;
let artistOffUserId: string;
let artistOffId: string;

let ownerOnUserId: string;
let artistOnUserId: string;
let artistOnId: string;

let soloOwnerUserId: string;
let soloArtistId: string;

const studioIds: string[] = [];
const userIds: string[] = [];
const artistIds: string[] = [];
const membershipIds: string[] = [];
const pieceIds: string[] = [];

async function makeStudio(name: string) {
  const studio = await prisma.studio.create({ data: { slug: `${suffix}-${name}`, name: `Test ${name}` } });
  studioIds.push(studio.id);
  return studio.id;
}

async function makeArtist(email: string, studioId: string, role: Role) {
  const user = await prisma.user.create({ data: { email, role, studioId } });
  userIds.push(user.id);
  const artist = await prisma.artist.create({ data: { userId: user.id, specialties: [], portfolioImages: [] } });
  artistIds.push(artist.id);
  return { userId: user.id, artistId: artist.id };
}

async function makeMembership(studioId: string, artistId: string, allowsStudioProfileEdits: boolean) {
  const membership = await prisma.studioMembership.create({
    data: { studioId, artistId, type: "HOME", allowsStudioProfileEdits },
  });
  membershipIds.push(membership.id);
  return membership.id;
}

async function makePiece(studioId: string, artistId: string, title: string) {
  const piece = await prisma.flashPiece.create({
    data: {
      studioId,
      artistId,
      imageUrl: "https://example.invalid/flash.png",
      title,
      priceCents: 15000,
      estimatedDurationMinutes: 90,
      isOneOfOne: false,
    },
  });
  pieceIds.push(piece.id);
  return piece.id;
}

let pieceOffContent: string;
let pieceOffLifecycle: string;
let pieceOn: string;
let pieceArtistOwn: string;
let pieceSolo: string;

before(async () => {
  studioOffId = await makeStudio("flashgov-off");
  studioOnId = await makeStudio("flashgov-on");
  soloStudioId = await makeStudio("flashgov-solo");

  // OWNER at studioOffId -- a real gatekeeper, staff acting on the
  // delegation-OFF artist's behalf.
  const ownerOff = await prisma.user.create({ data: { email: `${suffix}-owner-off@test.invalid`, role: Role.OWNER, studioId: studioOffId } });
  userIds.push(ownerOff.id);
  ownerOffUserId = ownerOff.id;
  const artistOff = await makeArtist(`${suffix}-artist-off@test.invalid`, studioOffId, Role.ARTIST);
  artistOffUserId = artistOff.userId;
  artistOffId = artistOff.artistId;
  await makeMembership(studioOffId, artistOffId, false);

  // OWNER at studioOnId -- staff acting on the delegation-ON artist's behalf.
  const ownerOn = await prisma.user.create({ data: { email: `${suffix}-owner-on@test.invalid`, role: Role.OWNER, studioId: studioOnId } });
  userIds.push(ownerOn.id);
  ownerOnUserId = ownerOn.id;
  const artistOn = await makeArtist(`${suffix}-artist-on@test.invalid`, studioOnId, Role.ARTIST);
  artistOnUserId = artistOn.userId;
  artistOnId = artistOn.artistId;
  await makeMembership(studioOnId, artistOnId, true);

  // Genuinely solo studio: the ONLY active user, role OWNER, also an
  // Artist (createStudioWithOwner's own soloArtist:true shape) --
  // allowsStudioProfileEdits: true, matching that path's real backfill
  // default (irrelevant here anyway, since isSelf never consults it).
  const soloOwner = await prisma.user.create({ data: { email: `${suffix}-solo-owner@test.invalid`, role: Role.OWNER, studioId: soloStudioId } });
  userIds.push(soloOwner.id);
  soloOwnerUserId = soloOwner.id;
  const soloArtist = await prisma.artist.create({ data: { userId: soloOwner.id, specialties: [], portfolioImages: [] } });
  artistIds.push(soloArtist.id);
  soloArtistId = soloArtist.id;
  await makeMembership(soloStudioId, soloArtistId, true);

  [pieceOffContent, pieceOffLifecycle, pieceOn, pieceArtistOwn, pieceSolo] = await Promise.all([
    makePiece(studioOffId, artistOffId, "Off-studio content target"),
    makePiece(studioOffId, artistOffId, "Off-studio lifecycle target"),
    makePiece(studioOnId, artistOnId, "On-studio content target"),
    makePiece(studioOffId, artistOffId, "Artist's own piece"),
    makePiece(soloStudioId, soloArtistId, "Solo artist's own piece"),
  ]);

  const app = express();
  app.use(express.json());
  app.use("/flash-pieces", flashPiecesRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));

  await prisma.flashPiece.deleteMany({ where: { id: { in: pieceIds } } });
  await prisma.studioMembership.deleteMany({ where: { id: { in: membershipIds } } });
  await prisma.artist.deleteMany({ where: { id: { in: artistIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.auditLog.deleteMany({ where: { studioId: { in: studioIds } } });
  await prisma.studio.deleteMany({ where: { id: { in: studioIds } } });
});

test("delegation OFF: staff content-edit on another artist's piece -> 403, untouched", async () => {
  const token = tokenFor(ownerOffUserId, studioOffId, Role.OWNER);
  const res = await fetch(`${baseUrl}/flash-pieces/${pieceOffContent}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ title: "Staff tried to rename this" }),
  });
  assert.equal(res.status, 403);

  const piece = await prisma.flashPiece.findUnique({ where: { id: pieceOffContent } });
  assert.equal(piece?.title, "Off-studio content target", "must be left untouched, not silently renamed");
});

test("delegation OFF: matrix-granted lifecycle action (retire) still works", async () => {
  const token = tokenFor(ownerOffUserId, studioOffId, Role.OWNER);
  const res = await fetch(`${baseUrl}/flash-pieces/${pieceOffLifecycle}/retire`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200);

  const piece = await prisma.flashPiece.findUnique({ where: { id: pieceOffLifecycle } });
  assert.equal(piece?.status, "RETIRED");
});

test("delegation ON: staff content-edit on another artist's piece -> 200, persists", async () => {
  const token = tokenFor(ownerOnUserId, studioOnId, Role.OWNER);
  const res = await fetch(`${baseUrl}/flash-pieces/${pieceOn}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ title: "Staff renamed this with delegation on" }),
  });
  assert.equal(res.status, 200);

  const piece = await prisma.flashPiece.findUnique({ where: { id: pieceOn } });
  assert.equal(piece?.title, "Staff renamed this with delegation on");
});

test("artist always: editing your OWN piece succeeds regardless of your own delegation setting", async () => {
  const token = tokenFor(artistOffUserId, studioOffId, Role.ARTIST);
  const res = await fetch(`${baseUrl}/flash-pieces/${pieceArtistOwn}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ title: "Artist renamed their own piece" }),
  });
  assert.equal(res.status, 200);

  const piece = await prisma.flashPiece.findUnique({ where: { id: pieceArtistOwn } });
  assert.equal(piece?.title, "Artist renamed their own piece");
});

test("solo unaffected: solo owner-artist editing their own piece in their own studio -> 200", async () => {
  const token = tokenFor(soloOwnerUserId, soloStudioId, Role.OWNER);
  const res = await fetch(`${baseUrl}/flash-pieces/${pieceSolo}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ title: "Solo artist renamed their own piece" }),
  });
  assert.equal(res.status, 200);

  const piece = await prisma.flashPiece.findUnique({ where: { id: pieceSolo } });
  assert.equal(piece?.title, "Solo artist renamed their own piece");
});
