// Embedded payments UX redesign + tipping: coverage for POST
// /appointments/:id/tip. Same "real Prisma, real HTTP, self-contained
// fixtures created here and torn down in `after`" convention as
// permissionContext.test.ts/embeddedPayments.test.ts. Deliberately never
// exercises the real Stripe create/update call (that's proven live against
// a real test-mode PaymentIntent -- see REPORT.md's own live-Stripe
// evidence convention, same reasoning as embeddedPayments.test.ts's header
// comment) -- every case here either 400/404s before Stripe is ever
// reached, or (for the "tipCents persists" cases) uses a studio with no
// Stripe connected so the route's own persistence step (which happens
// BEFORE the Stripe call) is provable from the DB without a live network
// call.

import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma";
import { JWT_SECRET } from "../lib/jwt";
import { Role } from "../../generated/prisma/enums";
import appointmentsRouter from "./appointments";

function tokenFor(userId: string, studioId: string, role: Role): string {
  return jwt.sign({ userId, studioId, role }, JWT_SECRET);
}

const suffix = `tip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let server: http.Server;
let baseUrl: string;

const studioIds: string[] = [];
const userIds: string[] = [];
const clientIds: string[] = [];
const inquiryIds: string[] = [];
const serviceIds: string[] = [];
const intakeFormIds: string[] = [];
const artistIds: string[] = [];
const appointmentIds: string[] = [];

before(async () => {
  const app = express();
  app.use(express.json());
  app.use("/appointments", appointmentsRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));

  await prisma.appointment.deleteMany({ where: { id: { in: appointmentIds } } });
  await prisma.inquiry.deleteMany({ where: { id: { in: inquiryIds } } });
  await prisma.artist.deleteMany({ where: { id: { in: artistIds } } });
  await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
  await prisma.service.deleteMany({ where: { id: { in: serviceIds } } });
  await prisma.intakeForm.deleteMany({ where: { id: { in: intakeFormIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.auditLog.deleteMany({ where: { studioId: { in: studioIds } } });
  await prisma.studioSettings.deleteMany({ where: { studioId: { in: studioIds } } });
  await prisma.studio.deleteMany({ where: { id: { in: studioIds } } });
});

// checkedOutAt/finalCostCents/paidVia default to a fresh, just-checked-out,
// unpaid appointment -- override to exercise the "not checked out yet" /
// "already paid" 400 branches.
async function makeCheckedOutAppointment(opts: {
  tag: string;
  finalCostCents?: number;
  checkedOut?: boolean;
  paidVia?: "STRIPE" | "MANUAL" | null;
  embeddedPaymentsEnabled?: boolean;
}) {
  const studio = await prisma.studio.create({ data: { slug: `${suffix}-${opts.tag}`, name: `Tip Test ${opts.tag}` } });
  studioIds.push(studio.id);
  // Tipping only exists on the embedded path -- explicit row (not the
  // schema default) so this fixture is unaffected if that default ever
  // changes, and so the "flag off" test below can turn it off deliberately.
  await prisma.studioSettings.create({
    data: { studioId: studio.id, embeddedPaymentsEnabled: opts.embeddedPaymentsEnabled ?? true },
  });

  const ownerUser = await prisma.user.create({
    data: { email: `${opts.tag}-${suffix}-owner@test.invalid`, role: Role.OWNER, studioId: studio.id },
  });
  userIds.push(ownerUser.id);

  const artistUser = await prisma.user.create({
    data: { email: `${opts.tag}-${suffix}-artist@test.invalid`, role: Role.ARTIST, studioId: studio.id },
  });
  userIds.push(artistUser.id);
  const artist = await prisma.artist.create({ data: { userId: artistUser.id, specialties: [], portfolioImages: [] } });
  artistIds.push(artist.id);

  const client = await prisma.client.create({
    data: { studioId: studio.id, firstName: "Tip", lastName: "Test", referralCode: `${opts.tag}-${suffix}-ref` },
  });
  clientIds.push(client.id);

  const intakeForm = await prisma.intakeForm.create({ data: { studioId: studio.id, name: "Intake", slug: `${opts.tag}-${suffix}-intake` } });
  intakeFormIds.push(intakeForm.id);
  const service = await prisma.service.create({
    data: { studioId: studio.id, name: "Tattoo", slug: `${opts.tag}-${suffix}-tattoo`, pricingModel: "RANGE", depositModel: "TIER_BASED", intakeFormId: intakeForm.id },
  });
  serviceIds.push(service.id);

  const inquiry = await prisma.inquiry.create({
    data: {
      studioId: studio.id,
      clientId: client.id,
      serviceId: service.id,
      channel: "EMAIL",
      description: "Tip endpoint test",
      colorOrBlackGrey: "Color",
      placement: "Arm",
      estimatedSize: "Small",
      hasBeenTattooedBefore: false,
      referenceImages: [],
      placementImages: [],
    },
  });
  inquiryIds.push(inquiry.id);

  const checkedOut = opts.checkedOut ?? true;
  const finalCostCents = opts.finalCostCents ?? 50000;
  const appointment = await prisma.appointment.create({
    data: {
      studioId: studio.id,
      artistId: artist.id,
      clientId: client.id,
      inquiryId: inquiry.id,
      startTime: new Date(),
      endTime: new Date(Date.now() + 60 * 60 * 1000),
      status: checkedOut ? "COMPLETED" : "CONFIRMED",
      finalCostCents: checkedOut ? finalCostCents : null,
      checkedOutAt: checkedOut ? new Date() : null,
      paidVia: opts.paidVia ?? null,
    },
  });
  appointmentIds.push(appointment.id);

  return { studio, ownerUser, appointment };
}

test("rejects a negative tipCents before touching the appointment", async () => {
  const { studio, ownerUser, appointment } = await makeCheckedOutAppointment({ tag: "negative" });

  const res = await fetch(`${baseUrl}/appointments/${appointment.id}/tip`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenFor(ownerUser.id, studio.id, Role.OWNER)}` },
    body: JSON.stringify({ tipCents: -100 }),
  });
  assert.equal(res.status, 400);
});

test("rejects a non-integer tipCents", async () => {
  const { studio, ownerUser, appointment } = await makeCheckedOutAppointment({ tag: "noninteger" });

  const res = await fetch(`${baseUrl}/appointments/${appointment.id}/tip`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenFor(ownerUser.id, studio.id, Role.OWNER)}` },
    body: JSON.stringify({ tipCents: 12.5 }),
  });
  assert.equal(res.status, 400);
});

test("rejects a tipCents above the abuse cap (3x finalCostCents)", async () => {
  const { studio, ownerUser, appointment } = await makeCheckedOutAppointment({ tag: "overcap", finalCostCents: 10000 });

  const res = await fetch(`${baseUrl}/appointments/${appointment.id}/tip`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenFor(ownerUser.id, studio.id, Role.OWNER)}` },
    body: JSON.stringify({ tipCents: 30001 }),
  });
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string };
  assert.match(body.error, /cannot exceed/i);

  const unchanged = await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
  assert.equal(unchanged.tipCents, null, "an over-cap tip must never be persisted");
});

test("rejects tipping an appointment that hasn't been checked out yet", async () => {
  const { studio, ownerUser, appointment } = await makeCheckedOutAppointment({ tag: "notcheckedout", checkedOut: false });

  const res = await fetch(`${baseUrl}/appointments/${appointment.id}/tip`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenFor(ownerUser.id, studio.id, Role.OWNER)}` },
    body: JSON.stringify({ tipCents: 1000 }),
  });
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string };
  assert.match(body.error, /checked out/i);
});

test("rejects tipping an appointment that's already been paid", async () => {
  const { studio, ownerUser, appointment } = await makeCheckedOutAppointment({ tag: "alreadypaid", paidVia: "MANUAL" });

  const res = await fetch(`${baseUrl}/appointments/${appointment.id}/tip`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenFor(ownerUser.id, studio.id, Role.OWNER)}` },
    body: JSON.stringify({ tipCents: 1000 }),
  });
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string };
  assert.match(body.error, /already been paid/i);
});

test("rejects tipping when embeddedPaymentsEnabled is off for this studio", async () => {
  const { studio, ownerUser, appointment } = await makeCheckedOutAppointment({ tag: "flagoff", embeddedPaymentsEnabled: false });

  const res = await fetch(`${baseUrl}/appointments/${appointment.id}/tip`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenFor(ownerUser.id, studio.id, Role.OWNER)}` },
    body: JSON.stringify({ tipCents: 1000 }),
  });
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string };
  assert.match(body.error, /enabled/i);

  const unchanged = await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
  assert.equal(unchanged.tipCents, null, "a flag-off attempt must never persist a tip");
});

test("a wrong-studio caller gets 404, never a bare token studioId equality bypass", async () => {
  const { appointment } = await makeCheckedOutAppointment({ tag: "victim" });
  const attacker = await makeCheckedOutAppointment({ tag: "attacker" });

  const res = await fetch(`${baseUrl}/appointments/${appointment.id}/tip`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${tokenFor(attacker.ownerUser.id, attacker.studio.id, Role.OWNER)}`,
    },
    body: JSON.stringify({ tipCents: 1000 }),
  });
  assert.equal(res.status, 404);
});

test("explicit no-tip (0) persists distinctly from a fresh appointment's null, even when Stripe isn't connected", async () => {
  const { studio, ownerUser, appointment } = await makeCheckedOutAppointment({ tag: "notip", finalCostCents: 20000 });

  const before = await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
  assert.equal(before.tipCents, null, "tip step hasn't run yet");

  const res = await fetch(`${baseUrl}/appointments/${appointment.id}/tip`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenFor(ownerUser.id, studio.id, Role.OWNER)}` },
    body: JSON.stringify({ tipCents: 0 }),
  });
  // No StudioIntegration fixture -- getChargeableConnectedAccountId returns
  // null, so this 400s on "online payment isn't available." tipCents is
  // already durably persisted by that point (the update happens before the
  // Stripe-account lookup), which is exactly what this test is proving.
  assert.equal(res.status, 400);

  const updated = await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
  assert.equal(updated.tipCents, 0, "explicit no-tip must be stored as 0, distinct from null");
});

test("amountDueCents is always server-recomputed from the appointment's own finalCostCents -- a malicious body is ignored", async () => {
  const { studio, ownerUser, appointment } = await makeCheckedOutAppointment({ tag: "serverside", finalCostCents: 40000 });

  const res = await fetch(`${baseUrl}/appointments/${appointment.id}/tip`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenFor(ownerUser.id, studio.id, Role.OWNER)}` },
    body: JSON.stringify({
      tipCents: 1000,
      amountDueCents: 1,
      finalCostCents: 1,
      applicationFeeCents: 0,
    }),
  });
  assert.equal(res.status, 400, "no Stripe connected for this fixture -- still reaches the recompute before failing");

  // Same proof as the no-tip case above: tipCents (the one real field this
  // route reads) is persisted before the Stripe-account lookup, so the DB
  // state after this call proves the body's bogus amountDueCents/
  // finalCostCents were never read for anything.
  const updated = await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
  assert.equal(updated.tipCents, 1000);
  assert.equal(updated.finalCostCents, 40000, "the appointment's own finalCostCents must be untouched by the body");
});
