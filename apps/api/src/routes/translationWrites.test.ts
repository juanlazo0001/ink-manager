// Multi-language public forms, Part 6: staff-facing write endpoints for
// studio-content translations (StudioSettings/CustomPolicy/Service/
// FlashPiece/IntakeFormField), plus the regression test for the
// IntakeFormField delete-and-recreate hazard found while building this --
// see routes/intakeForms.ts's own PUT /:id/fields comment for the full
// story. Real HTTP against the real routers, real DB.

import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma";
import { JWT_SECRET } from "../lib/jwt";
import { Role } from "../../generated/prisma/enums";
import { staffRouter as studioSettingsStaffRouter } from "./studioSettings";
import { staffRouter as customPoliciesStaffRouter } from "./customPolicies";
import servicesRouter from "./services";
import flashPiecesRouter from "./flashPieces";
import intakeFormsRouter from "./intakeForms";

function tokenFor(userId: string, studioId: string, role: Role): string {
  return jwt.sign({ userId, studioId, role }, JWT_SECRET);
}

const suffix = `tw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let server: http.Server;
let baseUrl: string;

let studioId: string;
let ownerUserId: string;
let ownerToken: string;
let intakeFormId: string;

const studioIds: string[] = [];
const userIds: string[] = [];
const intakeFormIds: string[] = [];
const customPolicyIds: string[] = [];
const serviceIds: string[] = [];
const artistIds: string[] = [];
const flashPieceIds: string[] = [];

before(async () => {
  const app = express();
  app.use(express.json());
  app.use("/studio-settings", studioSettingsStaffRouter);
  app.use("/custom-policies", customPoliciesStaffRouter);
  app.use("/services", servicesRouter);
  app.use("/flash-pieces", flashPiecesRouter);
  app.use("/intake-forms", intakeFormsRouter);
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
  ownerUserId = owner.id;
  userIds.push(owner.id);
  ownerToken = tokenFor(ownerUserId, studioId, Role.OWNER);

  const intakeForm = await prisma.intakeForm.create({
    data: { studioId, name: "Default", slug: "default", isDefault: true },
  });
  intakeFormId = intakeForm.id;
  intakeFormIds.push(intakeForm.id);
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await prisma.auditLog.deleteMany({ where: { studioId: { in: studioIds } } });
  await prisma.flashPiece.deleteMany({ where: { id: { in: flashPieceIds } } });
  await prisma.studioMembership.deleteMany({ where: { artistId: { in: artistIds } } });
  await prisma.artist.deleteMany({ where: { id: { in: artistIds } } });
  await prisma.customPolicy.deleteMany({ where: { id: { in: customPolicyIds } } });
  await prisma.service.deleteMany({ where: { id: { in: serviceIds } } });
  await prisma.intakeFormField.deleteMany({ where: { intakeFormId: { in: intakeFormIds } } });
  await prisma.intakeForm.deleteMany({ where: { id: { in: intakeFormIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.studioSettings.deleteMany({ where: { studioId: { in: studioIds } } });
  await prisma.studio.deleteMany({ where: { id: { in: studioIds } } });
});

test("PATCH /studio-settings upserts a StudioSettingsTranslation and GET / echoes it back", async () => {
  const patchRes = await fetch(`${baseUrl}/studio-settings`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ translations: { es: { refundPolicy: "Sin reembolsos." } } }),
  });
  assert.equal(patchRes.status, 200);

  const getRes = await fetch(`${baseUrl}/studio-settings`, { headers: { Authorization: `Bearer ${ownerToken}` } });
  const body = (await getRes.json()) as { translations: Record<string, { refundPolicy: string | null }> };
  assert.equal(body.translations.es?.refundPolicy, "Sin reembolsos.");

  // A second PATCH touching a DIFFERENT field must not clobber the first.
  await fetch(`${baseUrl}/studio-settings`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ translations: { es: { depositPolicy: "Se requiere depósito." } } }),
  });
  const getRes2 = await fetch(`${baseUrl}/studio-settings`, { headers: { Authorization: `Bearer ${ownerToken}` } });
  const body2 = (await getRes2.json()) as { translations: Record<string, { refundPolicy: string | null; depositPolicy: string | null }> };
  assert.equal(body2.translations.es?.refundPolicy, "Sin reembolsos.");
  assert.equal(body2.translations.es?.depositPolicy, "Se requiere depósito.");
});

test("PATCH /studio-settings rejects a translations entry for an untranslatable field", async () => {
  const res = await fetch(`${baseUrl}/studio-settings`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ translations: { es: { calendarInviteTemplate: "nope" } } }),
  });
  assert.equal(res.status, 400);
});

test("POST /custom-policies with translations, then PATCH updates them, GET / reflects both", async () => {
  const createRes = await fetch(`${baseUrl}/custom-policies`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ title: "Aftercare", bodyHtml: "<p>Keep it clean.</p>", translations: { es: { title: "Cuidado posterior" } } }),
  });
  assert.equal(createRes.status, 201);
  const created = (await createRes.json()) as { id: string };
  customPolicyIds.push(created.id);

  await fetch(`${baseUrl}/custom-policies/${created.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ translations: { es: { bodyHtml: "<p>Mantenlo limpio.</p>" } } }),
  });

  const listRes = await fetch(`${baseUrl}/custom-policies`, { headers: { Authorization: `Bearer ${ownerToken}` } });
  const list = (await listRes.json()) as { id: string; translations: Record<string, { title: string | null; bodyHtml: string | null }> }[];
  const policy = list.find((p) => p.id === created.id);
  assert.equal(policy?.translations.es?.title, "Cuidado posterior");
  assert.equal(policy?.translations.es?.bodyHtml, "<p>Mantenlo limpio.</p>");
});

test("POST /services with translations, then PATCH updates them, GET / reflects both", async () => {
  const createRes = await fetch(`${baseUrl}/services`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({
      name: "Tattoo",
      pricingModel: "RANGE",
      depositModel: "TIER_BASED",
      intakeFormId,
      translations: { es: { name: "Tatuaje" } },
    }),
  });
  assert.equal(createRes.status, 201);
  const created = (await createRes.json()) as { id: string };
  serviceIds.push(created.id);

  await fetch(`${baseUrl}/services/${created.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ translations: { es: { depositBreakdownNote: "$50 de depósito" } } }),
  });

  const listRes = await fetch(`${baseUrl}/services`, { headers: { Authorization: `Bearer ${ownerToken}` } });
  const list = (await listRes.json()) as { id: string; translations: Record<string, { name: string | null; depositBreakdownNote: string | null }> }[];
  const service = list.find((s) => s.id === created.id);
  assert.equal(service?.translations.es?.name, "Tatuaje");
  assert.equal(service?.translations.es?.depositBreakdownNote, "$50 de depósito");
});

test("POST /flash-pieces with translations, then PATCH updates them, GET / reflects both", async () => {
  const user = await prisma.user.create({ data: { email: `artist-tw-${suffix}@test.invalid`, role: "ARTIST", studioId, name: "Test Artist" } });
  userIds.push(user.id);
  const artist = await prisma.artist.create({ data: { userId: user.id, specialties: [], portfolioImages: [] } });
  artistIds.push(artist.id);
  // Flash governance split: the later PATCH below is the OWNER editing
  // (translation) content on this artist's behalf, on purpose -- this
  // test is about translation round-tripping, not authorization (that has
  // its own dedicated coverage in flashGovernance.test.ts), so delegation
  // is granted here to keep testing what this test has always tested.
  await prisma.studioMembership.create({ data: { studioId, artistId: artist.id, type: "HOME", allowsStudioProfileEdits: true } });

  const createRes = await fetch(`${baseUrl}/flash-pieces`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({
      artistId: artist.id,
      imageUrl: "https://example.com/a.png",
      title: "Rose",
      description: "A red rose",
      priceCents: 5000,
      estimatedDurationMinutes: 60,
      translations: { es: { title: "Rosa" } },
    }),
  });
  assert.equal(createRes.status, 201);
  const created = (await createRes.json()) as { id: string };
  flashPieceIds.push(created.id);

  await fetch(`${baseUrl}/flash-pieces/${created.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ translations: { es: { description: "Una rosa roja" } } }),
  });

  const listRes = await fetch(`${baseUrl}/flash-pieces`, { headers: { Authorization: `Bearer ${ownerToken}` } });
  const list = (await listRes.json()) as { id: string; translations: Record<string, { title: string | null; description: string | null }> }[];
  const piece = list.find((p) => p.id === created.id);
  assert.equal(piece?.translations.es?.title, "Rosa");
  assert.equal(piece?.translations.es?.description, "Una rosa roja");
});

test("PUT /intake-forms/:id/fields: a translation survives an UNRELATED later save (the delete-and-recreate regression)", async () => {
  // Seed one CUSTOM field with no translation yet -- mirrors a studio that
  // already has a field list and is about to add its first translation.
  const putRes1 = await fetch(`${baseUrl}/intake-forms/${intakeFormId}/fields`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify([
      { fieldKind: "SYSTEM", systemFieldKey: "name", label: "Name", required: true, enabled: true },
      { fieldKind: "SYSTEM", systemFieldKey: "email", label: "Email", required: true, enabled: true },
      { fieldKind: "SYSTEM", systemFieldKey: "phone", label: "Phone", required: false, enabled: true },
      { fieldKind: "SYSTEM", systemFieldKey: "referralSource", label: "Referral", required: false, enabled: true },
      { fieldKind: "SYSTEM", systemFieldKey: "description", label: "Description", required: true, enabled: true },
      { fieldKind: "SYSTEM", systemFieldKey: "colorOrBlackGrey", label: "Color", required: true, enabled: true },
      { fieldKind: "SYSTEM", systemFieldKey: "placement", label: "Placement", required: true, enabled: true },
      { fieldKind: "SYSTEM", systemFieldKey: "size", label: "Size", required: true, enabled: true },
      { fieldKind: "SYSTEM", systemFieldKey: "hasBeenTattooedBefore", label: "Tattooed before?", required: true, enabled: true },
      { fieldKind: "SYSTEM", systemFieldKey: "preferredArtist", label: "Preferred artist", required: false, enabled: true },
      { fieldKind: "SYSTEM", systemFieldKey: "budget", label: "Budget", required: false, enabled: true },
      { fieldKind: "SYSTEM", systemFieldKey: "desiredTiming", label: "Timing", required: false, enabled: true },
      { fieldKind: "SYSTEM", systemFieldKey: "referenceImages", label: "Reference images", required: false, enabled: true },
      { fieldKind: "SYSTEM", systemFieldKey: "placementImages", label: "Placement images", required: false, enabled: true },
      {
        fieldKind: "CUSTOM",
        customQuestionType: "TEXT",
        label: "Favorite color?",
        required: false,
        enabled: true,
        translations: { es: { label: "¿Color favorito?" } },
      },
    ]),
  });
  assert.equal(putRes1.status, 200);
  const afterFirstSave = (await putRes1.json()) as { id: string; fieldKind: string; label: string; translations: Record<string, { label: string | null }> }[];
  const customField = afterFirstSave.find((f) => f.fieldKind === "CUSTOM");
  assert.equal(customField?.translations.es?.label, "¿Color favorito?");

  const fieldRow = await prisma.intakeFormField.findFirst({ where: { intakeFormId, fieldKind: "CUSTOM" } });
  assert.ok(fieldRow, "custom field row must exist after the first save");
  const idBeforeSecondSave = fieldRow!.id;

  // Second, UNRELATED save: round-trips every row's own id (as the real
  // drag-and-drop editor always does) and only tweaks one SYSTEM field's
  // label. Before the fix, PUT's deleteMany+createMany physically deleted
  // and recreated every row (id string reused, but the DB row itself was a
  // brand-new insert) -- which cascade-deleted the CUSTOM field's
  // IntakeFormFieldTranslation the instant the deleteMany ran, even though
  // a row with the same id existed again a moment later.
  const secondPayload = afterFirstSave.map((f) => ({
    id: f.id,
    fieldKind: f.fieldKind,
    systemFieldKey: (f as unknown as { systemFieldKey: string | null }).systemFieldKey,
    customQuestionType: (f as unknown as { customQuestionType: string | null }).customQuestionType,
    label: f.label === "Email" ? "Email Address" : f.label,
    required: (f as unknown as { required: boolean }).required,
    enabled: (f as unknown as { enabled: boolean }).enabled,
  }));

  const putRes2 = await fetch(`${baseUrl}/intake-forms/${intakeFormId}/fields`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify(secondPayload),
  });
  assert.equal(putRes2.status, 200);
  const afterSecondSave = (await putRes2.json()) as { id: string; fieldKind: string; label: string; translations: Record<string, { label: string | null }> }[];

  const customFieldAfter = afterSecondSave.find((f) => f.fieldKind === "CUSTOM");
  assert.equal(customFieldAfter?.id, idBeforeSecondSave, "the CUSTOM row's id must be preserved, not just its string value");
  assert.equal(
    customFieldAfter?.translations.es?.label,
    "¿Color favorito?",
    "an unrelated field-list save must not wipe a different field's translation",
  );

  // The actual row in the DB must be the SAME row (not a delete+recreate
  // that happens to reuse the id) -- its own translation row must still
  // physically exist with the exact same intakeFormFieldId foreign key.
  const translationRow = await prisma.intakeFormFieldTranslation.findFirst({ where: { intakeFormFieldId: idBeforeSecondSave, locale: "es" } });
  assert.ok(translationRow, "the translation row itself must survive an unrelated save");
});
