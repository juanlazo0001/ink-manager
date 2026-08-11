// Multi-language public forms, Part 6 (Task 36): full end-to-end pipeline
// checks, real HTTP + real DB. Not a repeat of contentTranslationHttp.test.ts
// (locale resolution, seed-equality) or translationWrites.test.ts (staff
// write endpoints) -- this proves those pieces actually compose: a
// Spanish-signed deposit/waiver produces a real, non-empty PDF using the
// signed locale, exercised through the exact same staff routes production
// traffic hits (auth + permission gates included).
//
// Explicitly NOT covered here (documented, not silently skipped): visual
// browser verification and a mobile-viewport pass -- no browser automation
// tool was available in this session. PDF byte CONTENT (i.e. that the
// rendered glyphs are the Spanish string, not just that pdfT was called
// with locale "es") also isn't asserted -- pdfkit compresses its content
// streams by default, and no PDF-text-extraction library is a dependency
// of this repo; adding one solely for this test was judged out of scope.
// pdfStrings.test.ts already unit-tests pdfT/pdfDateLocale's own
// correctness in isolation.

import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma";
import { JWT_SECRET } from "../lib/jwt";
import { Role } from "../../generated/prisma/enums";
import { publicRouter as depositsPublicRouter, staffRouter as depositsStaffRouter } from "./deposits";
import { publicRouter as waiversPublicRouter, staffRouter as waiversStaffRouter } from "./waivers";

function tokenFor(userId: string, studioId: string, role: Role): string {
  return jwt.sign({ userId, studioId, role }, JWT_SECRET);
}

const suffix = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let server: http.Server;
let baseUrl: string;

let studioId: string;
let ownerToken: string;

const studioIds: string[] = [];
const userIds: string[] = [];
const clientIds: string[] = [];
const intakeFormIds: string[] = [];
const serviceIds: string[] = [];
const inquiryIds: string[] = [];
const depositFormIds: string[] = [];
const appointmentIds: string[] = [];
const waiverIds: string[] = [];
const artistIds: string[] = [];

before(async () => {
  const app = express();
  app.use(express.json());
  app.use("/deposits", depositsPublicRouter);
  app.use("/deposit-forms", depositsStaffRouter);
  app.use("/waivers", waiversPublicRouter);
  app.use("/waivers-staff", waiversStaffRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;

  const studio = await prisma.studio.create({ data: { name: `Studio ${suffix}`, slug: `studio-${suffix}` } });
  studioId = studio.id;
  studioIds.push(studio.id);
  await prisma.studioSettings.create({ data: { studioId: studio.id } });

  const owner = await prisma.user.create({
    data: { email: `owner-${suffix}@test.invalid`, role: Role.OWNER, studioId: studio.id, name: "Test Owner" },
  });
  userIds.push(owner.id);
  ownerToken = tokenFor(owner.id, studioId, Role.OWNER);
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await prisma.auditLog.deleteMany({ where: { studioId: { in: studioIds } } });
  await prisma.depositForm.deleteMany({ where: { id: { in: depositFormIds } } });
  await prisma.liabilityWaiver.deleteMany({ where: { id: { in: waiverIds } } });
  await prisma.appointment.deleteMany({ where: { id: { in: appointmentIds } } });
  await prisma.artist.deleteMany({ where: { id: { in: artistIds } } });
  await prisma.inquiry.deleteMany({ where: { id: { in: inquiryIds } } });
  await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
  await prisma.service.deleteMany({ where: { id: { in: serviceIds } } });
  await prisma.intakeForm.deleteMany({ where: { id: { in: intakeFormIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.studioSettings.deleteMany({ where: { studioId: { in: studioIds } } });
  await prisma.studio.deleteMany({ where: { id: { in: studioIds } } });
});

test("end-to-end: Spanish-signed deposit produces a real PDF via the staff export route", async () => {
  const client = await prisma.client.create({
    data: { studioId, firstName: "Jane", lastName: "Doe", referralCode: `REFE2E${suffix}` },
  });
  clientIds.push(client.id);

  const intakeForm = await prisma.intakeForm.create({
    data: { studioId, name: "Default", slug: `default-${suffix}`, isDefault: true },
  });
  intakeFormIds.push(intakeForm.id);

  const service = await prisma.service.create({
    data: { studioId, name: "Tattoo", slug: `tattoo-${suffix}`, pricingModel: "RANGE", depositModel: "TIER_BASED", intakeFormId: intakeForm.id },
  });
  serviceIds.push(service.id);

  const inquiry = await prisma.inquiry.create({
    data: {
      studioId,
      clientId: client.id,
      serviceId: service.id,
      channel: "EMAIL",
      description: "test",
      colorOrBlackGrey: "Color",
      placement: "Arm",
      estimatedSize: "Small",
      hasBeenTattooedBefore: false,
      referenceImages: [],
      placementImages: [],
    },
  });
  inquiryIds.push(inquiry.id);

  const depositForm = await prisma.depositForm.create({
    data: {
      inquiryId: inquiry.id,
      token: `depe2e-${suffix}`,
      tokenExpiresAt: new Date(Date.now() + 86400000),
      depositAmount: 50,
      feeAmount: 10,
      totalCharged: 60,
    },
  });
  depositFormIds.push(depositForm.id);

  // Client's browser reports Spanish (no picker/query override anymore).
  const signRes = await fetch(`${baseUrl}/deposits/sign/depe2e-${suffix}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "Accept-Language": "es" },
    body: JSON.stringify({
      agreedNonRefundable: true,
      agreedLatePolicy: true,
      agreedNoShowForfeit: true,
      agreedNewDepositAfterNoShow: true,
      agreedRescheduleLimit: true,
      agreedExpiration: true,
      agreedIdAndVoucher: true,
      agreedAge18: true,
      signatureName: "Jane Doe",
      signatureData: "data:image/png;base64,AAAA",
    }),
  });
  assert.equal(signRes.status, 200);

  const signed = await prisma.depositForm.findUniqueOrThrow({ where: { id: depositForm.id } });
  assert.equal(signed.signedLocale, "es");
  assert.ok(signed.termsSnapshot, "termsSnapshot must be populated at sign time");

  // Staff exports the PDF -- exercises resolveDeposit's locale threading
  // into generateDepositFormPdf end to end, through the real auth +
  // permission gate, not a direct function call.
  const pdfRes = await fetch(`${baseUrl}/deposit-forms/${depositForm.id}/pdf`, {
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  assert.equal(pdfRes.status, 200);
  assert.equal(pdfRes.headers.get("content-type"), "application/pdf");
  const buf = Buffer.from(await pdfRes.arrayBuffer());
  assert.ok(buf.length > 1000, "PDF must be a real, non-trivial document, not an empty/error body");
  assert.equal(buf.subarray(0, 5).toString("latin1"), "%PDF-", "must be a well-formed PDF file");
});

test("end-to-end: Spanish-signed waiver (seed-equality translation) produces a real PDF via the staff export route", async () => {
  const client = await prisma.client.create({
    data: { studioId, firstName: "Jane", lastName: "Doe", referralCode: `REFE2EW${suffix}` },
  });
  clientIds.push(client.id);

  const user = await prisma.user.create({ data: { email: `artist-e2e-${suffix}@test.invalid`, role: "ARTIST", studioId, name: "Test Artist" } });
  userIds.push(user.id);
  const artist = await prisma.artist.create({ data: { userId: user.id, specialties: [], portfolioImages: [] } });
  artistIds.push(artist.id);

  const intakeForm = await prisma.intakeForm.create({
    data: { studioId, name: "Waiver Intake", slug: `waiver-intake-${suffix}`, isDefault: false },
  });
  intakeFormIds.push(intakeForm.id);

  const service = await prisma.service.create({
    data: { studioId, name: "Piercing", slug: `piercing-${suffix}`, pricingModel: "RANGE", depositModel: "TIER_BASED", intakeFormId: intakeForm.id },
  });
  serviceIds.push(service.id);

  const inquiry = await prisma.inquiry.create({
    data: {
      studioId,
      clientId: client.id,
      serviceId: service.id,
      channel: "EMAIL",
      description: "test",
      colorOrBlackGrey: "Color",
      placement: "Ear",
      estimatedSize: "Small",
      hasBeenTattooedBefore: false,
      referenceImages: [],
      placementImages: [],
    },
  });
  inquiryIds.push(inquiry.id);

  const appointment = await prisma.appointment.create({
    data: {
      studioId,
      artistId: artist.id,
      clientId: client.id,
      inquiryId: inquiry.id,
      startTime: new Date(Date.now() + 86400000),
      endTime: new Date(Date.now() + 90000000),
    },
  });
  appointmentIds.push(appointment.id);

  const waiver = await prisma.liabilityWaiver.create({
    data: {
      studioId,
      clientId: client.id,
      appointmentId: appointment.id,
      healthQuestionsSnapshot: [],
      clausesSnapshot: [],
      token: `waie2e-${suffix}`,
      tokenExpiresAt: new Date(Date.now() + 86400000),
    },
  });
  waiverIds.push(waiver.id);

  const signRes = await fetch(`${baseUrl}/waivers/sign/waie2e-${suffix}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "Accept-Language": "es" },
    body: JSON.stringify({
      legalName: "Jane Doe",
      dateOfBirth: "1990-01-01",
      emergencyContactName: "John Doe",
      emergencyContactPhone: "9195551234",
      healthAnswers: [],
      idImageUrl: "https://example.com/id.png",
      clauseInitials: [],
      signatureName: "Jane Doe",
      signatureData: "data:image/png;base64,AAAA",
    }),
  });
  assert.equal(signRes.status, 200);

  const signed = await prisma.liabilityWaiver.findUniqueOrThrow({ where: { id: waiver.id } });
  assert.equal(signed.signedLocale, "es");

  const pdfRes = await fetch(`${baseUrl}/waivers-staff/${waiver.id}/pdf`, {
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  assert.equal(pdfRes.status, 200);
  assert.equal(pdfRes.headers.get("content-type"), "application/pdf");
  const buf = Buffer.from(await pdfRes.arrayBuffer());
  assert.ok(buf.length > 500, "PDF must be a real, non-trivial document, not an empty/error body");
  assert.equal(buf.subarray(0, 5).toString("latin1"), "%PDF-", "must be a well-formed PDF file");
});
