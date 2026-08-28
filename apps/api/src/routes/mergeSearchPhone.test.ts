// GET /clients/merge-search must find people by the phone number a human
// would type, and POST .../messages must say WHY it refused in a way a
// client can branch on.
//
// The phone half, stated plainly: Client.phone is stored NORMALIZED --
// bare digits, no punctuation (lib/phone.ts, enforced on every write). The
// search matched the raw query text against that column, so it matched a
// typed "3055550142" and could never match "(305) 555-0142" -- the exact
// string apps/web's own PhoneInput renders, and therefore the one a person
// reads off the screen and retypes. It also read only the phone SCALAR, so
// secondary ClientPhone rows were invisible to search entirely.
//
// The falsifier is the first test: it fails on main today. The rest guard
// the things a fix could plausibly break on the way past it -- the
// per-word AND, and name/email matching.

import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma";
import { JWT_SECRET } from "../lib/jwt";
import { Role, ConversationType, IntegrationChannel, IntegrationStatus } from "../../generated/prisma/enums";
import clientsRouter from "./clients";
import conversationsRouter from "./conversations";

function tokenFor(userId: string, studioId: string, role: Role): string {
  return jwt.sign({ userId, studioId, role }, JWT_SECRET);
}

const suffix = `msp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let server: http.Server;
let baseUrl: string;

const studioIds: string[] = [];
const userIds: string[] = [];
const clientIds: string[] = [];
const conversationIds: string[] = [];

let studioId: string;
let ownerUserId: string;

/** Stored phone 3055550142. Searched for as "(305) 555-0142". */
let mariaId: string;
/** No `phone` scalar at all -- only a SECONDARY ClientPhone row, 7185559911. */
let secondaryOnlyId: string;
/** Shares the 0142 digit run with maria, so "maria 0142" must not match them. */
let otherId: string;
/** No SMS consent -- the coded-400 case. */
let noConsentClientId: string;
let noConsentConversationId: string;

function headers() {
  return { Authorization: `Bearer ${tokenFor(ownerUserId, studioId, Role.OWNER)}`, "Content-Type": "application/json" };
}

async function search(q: string): Promise<string[]> {
  const res = await fetch(`${baseUrl}/clients/merge-search?q=${encodeURIComponent(q)}`, { headers: headers() });
  assert.equal(res.status, 200, `merge-search should 200 for ${JSON.stringify(q)}`);
  const rows = (await res.json()) as { id: string }[];
  return rows.map((r) => r.id);
}

before(async () => {
  const studio = await prisma.studio.create({ data: { slug: `${suffix}-studio`, name: "Merge search phone" } });
  studioId = studio.id;
  studioIds.push(studioId);

  const owner = await prisma.user.create({
    data: { email: `${suffix}-owner@test.invalid`, role: Role.OWNER, studioId },
  });
  ownerUserId = owner.id;
  userIds.push(ownerUserId);

  // Stored the way every write path stores it: normalized, bare digits.
  const maria = await prisma.client.create({
    data: {
      studioId,
      firstName: "Maria",
      lastName: "Quintero",
      email: `${suffix}-maria@test.invalid`,
      phone: "3055550142",
      referralCode: `${suffix}-maria`,
    },
  });
  mariaId = maria.id;
  clientIds.push(mariaId);

  // No scalar phone whatsoever -- findable ONLY through the relation.
  const secondary = await prisma.client.create({
    data: { studioId, firstName: "Dana", lastName: "Okonkwo", referralCode: `${suffix}-dana` },
  });
  secondaryOnlyId = secondary.id;
  clientIds.push(secondaryOnlyId);
  await prisma.clientPhone.create({
    data: { clientId: secondaryOnlyId, phone: "7185559911", isPrimary: true },
  });

  // Shares the "0142" run with Maria but is not named Maria. This is what
  // makes the mixed-query test able to fail: without a real second match
  // on the digits, "finds only Maria" would be true by accident.
  const other = await prisma.client.create({
    data: {
      studioId,
      firstName: "Tomas",
      lastName: "Reyes",
      phone: "9995550142",
      referralCode: `${suffix}-tomas`,
    },
  });
  otherId = other.id;
  clientIds.push(otherId);

  const noConsent = await prisma.client.create({
    data: { studioId, firstName: "Sam", lastName: "Noconsent", phone: "4045557777", referralCode: `${suffix}-sam` },
  });
  noConsentClientId = noConsent.id;
  clientIds.push(noConsentClientId);
  const convo = await prisma.conversation.create({
    data: { studioId, type: ConversationType.CLIENT, clientId: noConsentClientId },
  });
  noConsentConversationId = convo.id;
  conversationIds.push(noConsentConversationId);

  // The consent gate lives inside sendClientSms, and the route only CALLS
  // it when the studio's SMS integration is CONNECTED -- otherwise the
  // send falls through to the log-only path and returns 201, which is
  // what the first draft of this test hit. So the integration has to be
  // connected for the refusal to be reachable at all.
  //
  // Safe without any Twilio credentials: sendClientSms refuses on consent
  // BEFORE it looks at the integration or dials anything (see its own
  // ordering, and smsConsentOptional.test.ts's assertion of exactly that),
  // so nothing here can reach the network.
  await prisma.studioIntegration.create({
    data: {
      studioId,
      channel: IntegrationChannel.SMS,
      status: IntegrationStatus.CONNECTED,
      displayName: "Test SMS",
    },
  });

  const app = express();
  app.use(express.json());
  app.use("/clients", clientsRouter);
  app.use("/conversations", conversationsRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));

  await prisma.message.deleteMany({ where: { conversationId: { in: conversationIds } } });
  await prisma.conversationRead.deleteMany({ where: { conversationId: { in: conversationIds } } });
  await prisma.userConversationState.deleteMany({ where: { conversationId: { in: conversationIds } } });
  await prisma.conversation.deleteMany({ where: { id: { in: conversationIds } } });
  await prisma.clientPhone.deleteMany({ where: { clientId: { in: clientIds } } });
  await prisma.clientEmail.deleteMany({ where: { clientId: { in: clientIds } } });
  await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
  await prisma.studioIntegration.deleteMany({ where: { studioId: { in: studioIds } } });
  await prisma.auditLog.deleteMany({ where: { studioId: { in: studioIds } } });
  await prisma.rolePermission.deleteMany({ where: { studioId: { in: studioIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.studioSettings.deleteMany({ where: { studioId: { in: studioIds } } });
  await prisma.studio.deleteMany({ where: { id: { in: studioIds } } });
});

test("THE FALSIFIER: a formatted phone query finds the client stored as bare digits", async () => {
  // Fails on main. "(305) 555-0142" is exactly what the UI renders and a
  // person retypes; the stored value is "3055550142".
  const hits = await search("(305) 555-0142");
  assert.deepEqual(hits, [mariaId], "the formatted query must find her, and only her");
});

test("the raw-digit query still works -- the case that already worked must not regress", async () => {
  const hits = await search("3055550142");
  assert.deepEqual(hits, [mariaId]);
});

test("other human phone formats reach her too", async () => {
  for (const q of ["305-555-0142", "305.555.0142", "+1 (305) 555-0142", "1-305-555-0142"]) {
    assert.deepEqual(await search(q), [mariaId], `format ${JSON.stringify(q)} must find her`);
  }
});

test("a client findable ONLY through a secondary ClientPhone row is found (+1)", async () => {
  // Dana has no `phone` scalar at all, so this can only pass through the
  // relation arm.
  const hits = await search("(718) 555-9911");
  assert.deepEqual(hits, [secondaryOnlyId]);

  const raw = await search("7185559911");
  assert.deepEqual(raw, [secondaryOnlyId], "and by raw digits as well");
});

test("a digits query matching nobody returns empty (+0)", async () => {
  // The paired negative. Without it, a function returning every client
  // would satisfy every positive assertion above.
  assert.deepEqual(await search("2125550000"), [], "no client has this number");
  assert.deepEqual(await search("(212) 555-0000"), [], "formatted, equally absent");
});

test("a mixed name+digits query requires BOTH words -- the per-word AND survives", async () => {
  // Tomas shares the 0142 run; Maria is the only one satisfying both
  // words. If the phone arm had been hoisted to the top level, this would
  // return both.
  const both = await search("maria 0142");
  assert.deepEqual(both, [mariaId], "only the client matching the name AND the digits");

  // And the digits alone genuinely do match two people -- which is what
  // makes the assertion above meaningful rather than accidentally true.
  const digitsOnly = await search("0142");
  assert.equal(digitsOnly.length, 2, "the digit run alone is shared");
  assert.ok(digitsOnly.includes(mariaId) && digitsOnly.includes(otherId));
});

test("a mixed query whose name half matches nobody returns empty", async () => {
  assert.deepEqual(await search("zzzznotaname 0142"), [], "the AND must still be able to reject");
});

test("name and email matching are unchanged -- one regression case each", async () => {
  assert.deepEqual(await search("Quintero"), [mariaId], "surname");
  assert.deepEqual(await search("Maria Quintero"), [mariaId], "two-word name, per-word AND");
  assert.deepEqual(await search(`${suffix}-maria@test.invalid`), [mariaId], "email");
  assert.deepEqual(await search("Okonkwo"), [secondaryOnlyId], "a client with no scalar phone is still findable by name");
});

test("the consent refusal carries a stable code alongside the unchanged message", async () => {
  const res = await fetch(`${baseUrl}/conversations/${noConsentConversationId}/messages`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ body: "This must be refused.", channel: "SMS", direction: "OUTBOUND" }),
  });

  // The studio's SMS integration is CONNECTED in the fixture, so this
  // takes the real-send branch and reaches the consent gate -- which
  // refuses before dialing anything. Without a connected integration the
  // route falls through to the log-only path and returns 201, and this
  // assertion would never have been exercised.
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error?: string; code?: string };

  assert.equal(body.code, "no_sms_consent", "a machine-readable discriminator, not prose to match on");
  assert.equal(
    body.error,
    "This client has no SMS consent on file and cannot be texted",
    "and the existing message is unchanged -- this addition is additive",
  );
});
