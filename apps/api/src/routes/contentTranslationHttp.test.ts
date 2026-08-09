// Multi-language public forms, Part 4: HTTP-level proof that the
// translation-read wiring built on top of lib/contentTranslation.ts's
// unit-tested helpers actually works end to end through real routes --
// unit tests prove the logic; this proves it's actually wired in.

import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { prisma } from "../lib/prisma";
import { publicRouter as studioSettingsPublicRouter } from "./studioSettings";
import { publicRouter as depositsPublicRouter } from "./deposits";
import flashPiecesRouter from "./flashPieces";

const suffix = `ct-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let server: http.Server;
let baseUrl: string;

const studioIds: string[] = [];
const clientIds: string[] = [];
const serviceIds: string[] = [];
const inquiryIds: string[] = [];
const intakeFormIds: string[] = [];
const depositFormIds: string[] = [];
const flashPieceIds: string[] = [];
const userIds: string[] = [];
const artistIds: string[] = [];

before(async () => {
  const app = express();
  app.use(express.json());
  app.use("/studio-settings", studioSettingsPublicRouter);
  app.use("/deposits", depositsPublicRouter);
  app.use("/flash-pieces", flashPiecesRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await prisma.depositForm.deleteMany({ where: { id: { in: depositFormIds } } });
  await prisma.flashPiece.deleteMany({ where: { id: { in: flashPieceIds } } });
  await prisma.inquiry.deleteMany({ where: { id: { in: inquiryIds } } });
  await prisma.intakeFormField.deleteMany({ where: { intakeFormId: { in: intakeFormIds } } });
  await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
  await prisma.service.deleteMany({ where: { id: { in: serviceIds } } });
  await prisma.intakeForm.deleteMany({ where: { id: { in: intakeFormIds } } });
  await prisma.artist.deleteMany({ where: { id: { in: artistIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.studioSettings.deleteMany({ where: { studioId: { in: studioIds } } });
  await prisma.studio.deleteMany({ where: { id: { in: studioIds } } });
});

test("GET /studio-settings/public?locale=es: an untouched SYSTEM field gets the platform's own Spanish default (seed-equality)", async () => {
  const studio = await prisma.studio.create({ data: { name: `Studio ${suffix}`, slug: `studio-${suffix}` } });
  studioIds.push(studio.id);
  await prisma.studioSettings.create({ data: { studioId: studio.id } });

  const intakeForm = await prisma.intakeForm.create({
    data: { studioId: studio.id, name: "Default", slug: "default", isDefault: true },
  });
  intakeFormIds.push(intakeForm.id);

  // Real DB row, but label left exactly at the platform seed ("Name") --
  // this is the "studio never customized it" case the seed-equality rule
  // exists for.
  await prisma.intakeFormField.create({
    data: {
      studioId: studio.id,
      intakeFormId: intakeForm.id,
      fieldKind: "SYSTEM",
      systemFieldKey: "name",
      label: "Name",
      required: true,
      enabled: true,
      order: 0,
    },
  });

  const res = await fetch(`${baseUrl}/studio-settings/public?studioSlug=${studio.slug}&locale=es`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { resolvedLocale: string; intakeFormFields: { systemFieldKey: string; label: string }[] };
  assert.equal(body.resolvedLocale, "es");
  const nameField = body.intakeFormFields.find((f) => f.systemFieldKey === "name");
  assert.equal(nameField?.label, "Nombre");
});

test("GET /studio-settings/public?locale=es: a customized SYSTEM field (diverged from the seed) with no translation row falls back to its own English", async () => {
  const studio = await prisma.studio.create({ data: { name: `Studio ${suffix}-2`, slug: `studio-${suffix}-2` } });
  studioIds.push(studio.id);
  await prisma.studioSettings.create({ data: { studioId: studio.id } });

  const intakeForm = await prisma.intakeForm.create({
    data: { studioId: studio.id, name: "Default", slug: "default", isDefault: true },
  });
  intakeFormIds.push(intakeForm.id);

  await prisma.intakeFormField.create({
    data: {
      studioId: studio.id,
      intakeFormId: intakeForm.id,
      fieldKind: "SYSTEM",
      systemFieldKey: "name",
      label: "Full Legal Name", // diverged from the "Name" seed
      required: true,
      enabled: true,
      order: 0,
    },
  });

  const res = await fetch(`${baseUrl}/studio-settings/public?studioSlug=${studio.slug}&locale=es`);
  const body = (await res.json()) as { intakeFormFields: { systemFieldKey: string; label: string }[] };
  const nameField = body.intakeFormFields.find((f) => f.systemFieldKey === "name");
  assert.equal(nameField?.label, "Full Legal Name");
});

test("GET /studio-settings/public?locale=es: a field's own IntakeFormFieldTranslation row always wins", async () => {
  const studio = await prisma.studio.create({ data: { name: `Studio ${suffix}-3`, slug: `studio-${suffix}-3` } });
  studioIds.push(studio.id);
  await prisma.studioSettings.create({ data: { studioId: studio.id } });

  const intakeForm = await prisma.intakeForm.create({
    data: { studioId: studio.id, name: "Default", slug: "default", isDefault: true },
  });
  intakeFormIds.push(intakeForm.id);

  const field = await prisma.intakeFormField.create({
    data: {
      studioId: studio.id,
      intakeFormId: intakeForm.id,
      fieldKind: "CUSTOM",
      customQuestionType: "TEXT",
      label: "Favorite color?",
      required: false,
      enabled: true,
      order: 0,
    },
  });

  await prisma.intakeFormFieldTranslation.create({
    data: { intakeFormFieldId: field.id, studioId: studio.id, locale: "es", label: "¿Color favorito?" },
  });

  const resEs = await fetch(`${baseUrl}/studio-settings/public?studioSlug=${studio.slug}&locale=es`);
  const bodyEs = (await resEs.json()) as { intakeFormFields: { label: string }[] };
  assert.equal(bodyEs.intakeFormFields[0]?.label, "¿Color favorito?");

  const resEn = await fetch(`${baseUrl}/studio-settings/public?studioSlug=${studio.slug}&locale=en`);
  const bodyEn = (await resEn.json()) as { intakeFormFields: { label: string }[] };
  assert.equal(bodyEn.intakeFormFields[0]?.label, "Favorite color?");
});

test("GET /deposits/verify/:token?locale=es applies the service's ServiceTranslation to depositBreakdownNote", async () => {
  const studio = await prisma.studio.create({ data: { name: `Studio ${suffix}-4`, slug: `studio-${suffix}-4` } });
  studioIds.push(studio.id);
  await prisma.studioSettings.create({ data: { studioId: studio.id } });

  const client = await prisma.client.create({
    data: { studioId: studio.id, firstName: "Jane", lastName: "Doe", referralCode: `REF${suffix}` },
  });
  clientIds.push(client.id);

  const intakeForm = await prisma.intakeForm.create({
    data: { studioId: studio.id, name: "Default", slug: "default", isDefault: true },
  });
  intakeFormIds.push(intakeForm.id);

  const service = await prisma.service.create({
    data: {
      studioId: studio.id,
      name: "Tattoo",
      slug: "tattoo",
      pricingModel: "RANGE",
      depositModel: "TIER_BASED",
      depositBreakdownNote: "$50 deposit + $10 fee",
      intakeFormId: intakeForm.id,
    },
  });
  serviceIds.push(service.id);

  await prisma.serviceTranslation.create({
    data: { serviceId: service.id, studioId: studio.id, locale: "es", depositBreakdownNote: "$50 de depósito + $10 de cargo" },
  });

  const inquiry = await prisma.inquiry.create({
    data: {
      studioId: studio.id,
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
      status: "DEPOSIT_PENDING",
    },
  });
  inquiryIds.push(inquiry.id);

  const depositForm = await prisma.depositForm.create({
    data: {
      inquiryId: inquiry.id,
      token: `dep-${suffix}`,
      tokenExpiresAt: new Date(Date.now() + 86400000),
      depositAmount: 50,
      feeAmount: 10,
      totalCharged: 60,
    },
  });
  depositFormIds.push(depositForm.id);

  const resEs = await fetch(`${baseUrl}/deposits/verify/dep-${suffix}?locale=es`);
  const bodyEs = (await resEs.json()) as { depositBreakdownNote: string; resolvedLocale: string };
  assert.equal(bodyEs.resolvedLocale, "es");
  assert.equal(bodyEs.depositBreakdownNote, "$50 de depósito + $10 de cargo");

  const resEn = await fetch(`${baseUrl}/deposits/verify/dep-${suffix}`);
  const bodyEn = (await resEn.json()) as { depositBreakdownNote: string };
  assert.equal(bodyEn.depositBreakdownNote, "$50 deposit + $10 fee");

  // Multi-language public forms, Part 5: the language picker's own
  // persistence -- PATCH .../locale writes Client.preferredLocale, so a
  // LATER verify call with no explicit ?locale= at all still resolves to
  // the client's own stored choice.
  const patchRes = await fetch(`${baseUrl}/deposits/dep-${suffix}/locale`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ locale: "es" }),
  });
  assert.equal(patchRes.status, 200);

  const updatedClient = await prisma.client.findUnique({ where: { id: client.id } });
  assert.equal(updatedClient?.preferredLocale, "es");

  const resNoParam = await fetch(`${baseUrl}/deposits/verify/dep-${suffix}`);
  const bodyNoParam = (await resNoParam.json()) as { resolvedLocale: string; depositBreakdownNote: string };
  assert.equal(bodyNoParam.resolvedLocale, "es");
  assert.equal(bodyNoParam.depositBreakdownNote, "$50 de depósito + $10 de cargo");
});

test("PATCH /deposits/:token/locale rejects an unsupported locale", async () => {
  const studio = await prisma.studio.create({ data: { name: `Studio ${suffix}-6`, slug: `studio-${suffix}-6` } });
  studioIds.push(studio.id);
  const client = await prisma.client.create({
    data: { studioId: studio.id, firstName: "A", lastName: "B", referralCode: `REF6${suffix}` },
  });
  clientIds.push(client.id);
  const intakeForm = await prisma.intakeForm.create({
    data: { studioId: studio.id, name: "Default", slug: "default", isDefault: true },
  });
  intakeFormIds.push(intakeForm.id);
  const service = await prisma.service.create({
    data: { studioId: studio.id, name: "Tattoo", slug: "tattoo", pricingModel: "RANGE", depositModel: "TIER_BASED", intakeFormId: intakeForm.id },
  });
  serviceIds.push(service.id);
  const inquiry = await prisma.inquiry.create({
    data: {
      studioId: studio.id,
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
      token: `dep6-${suffix}`,
      tokenExpiresAt: new Date(Date.now() + 86400000),
      depositAmount: 50,
      feeAmount: 10,
      totalCharged: 60,
    },
  });
  depositFormIds.push(depositForm.id);

  const res = await fetch(`${baseUrl}/deposits/dep6-${suffix}/locale`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ locale: "fr" }),
  });
  assert.equal(res.status, 400);
});

test("GET /flash-pieces/public?locale=es applies FlashPieceTranslation to title/description", async () => {
  const studio = await prisma.studio.create({ data: { name: `Studio ${suffix}-5`, slug: `studio-${suffix}-5` } });
  studioIds.push(studio.id);

  const user = await prisma.user.create({ data: { email: `artist-${suffix}@test.invalid`, role: "ARTIST", studioId: studio.id, name: "Test Artist" } });
  userIds.push(user.id);
  const artist = await prisma.artist.create({ data: { userId: user.id, specialties: [], portfolioImages: [] } });
  artistIds.push(artist.id);

  const piece = await prisma.flashPiece.create({
    data: {
      studioId: studio.id,
      artistId: artist.id,
      imageUrl: "https://example.com/a.png",
      title: "Rose",
      description: "A red rose",
      priceCents: 5000,
      estimatedDurationMinutes: 60,
      status: "AVAILABLE",
    },
  });
  flashPieceIds.push(piece.id);

  await prisma.flashPieceTranslation.create({
    data: { flashPieceId: piece.id, studioId: studio.id, locale: "es", title: "Rosa", description: "Una rosa roja" },
  });

  const res = await fetch(`${baseUrl}/flash-pieces/public?studioSlug=${studio.slug}&artistId=${artist.id}&locale=es`);
  const body = (await res.json()) as { pieces: { title: string; description: string }[] };
  assert.equal(body.pieces[0]?.title, "Rosa");
  assert.equal(body.pieces[0]?.description, "Una rosa roja");
});
