// Unread counts must count an inbound client message.
//
// The bug this locks down: Message.authorUserId is NULLABLE, and Prisma
// compiles `authorUserId: { not: userId }` to a bare
// `"authorUserId" <> $1`. Under SQL's three-valued logic that is UNKNOWN
// -- not TRUE -- for a NULL row, so NULL rows are silently EXCLUDED. The
// Twilio webhook writes an inbound SMS with authorUserId null (nobody was
// logged in to author it), so an arriving client text was counted by
// NEITHER unread function: no gutter dot, nothing in the UNREAD filter, no
// nav badge.
//
// Why the existing suite could not have caught it, and why this file is
// written the way it is: every pre-existing fixture authored its messages
// as a logged-in user, so the NULL case was never exercised and the tests
// passed just as happily under the wrong implementation. Per the standing
// rule -- a test must be able to FAIL under the plausible-wrong
// implementation -- the assertions here are:
//
//   * STRICT equality on counts (`=== 1`), never `>= 1`. A `>=` would pass
//     against a function that counts everything, which is the opposite
//     wrong answer and just as broken.
//   * Every suppression assertion (own message must NOT count) is paired
//     with a positive sibling in the same test, so "returns 0 for
//     everything" cannot masquerade as correct suppression.
//   * Both functions are driven through their real HTTP surfaces --
//     GET /conversations for the per-thread count, GET /nav-counts for the
//     conversation-level one -- because those are what the clients read
//     and the whole finding was that the clients were faithfully rendering
//     a wrong number.

import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma";
import { JWT_SECRET } from "../lib/jwt";
import { Role, ConversationType, MessageChannel, MessageDirection } from "../../generated/prisma/enums";
import conversationsRouter from "./conversations";
import navCountsRouter from "./navCounts";

function tokenFor(userId: string, studioId: string, role: Role): string {
  return jwt.sign({ userId, studioId, role }, JWT_SECRET);
}

const suffix = `una-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let server: http.Server;
let baseUrl: string;

const studioIds: string[] = [];
const userIds: string[] = [];
const clientIds: string[] = [];
const conversationIds: string[] = [];
const messageIds: string[] = [];

let studioId: string;
let userOneId: string;
let userTwoId: string;
let threadId: string;

function headersFor(userId: string) {
  return { Authorization: `Bearer ${tokenFor(userId, studioId, Role.OWNER)}`, "Content-Type": "application/json" };
}

/** The per-thread count, straight off GET /conversations -- what the row dot reads. */
async function threadUnread(userId: string): Promise<number> {
  const res = await fetch(`${baseUrl}/conversations`, { headers: headersFor(userId) });
  assert.equal(res.status, 200);
  const rows = (await res.json()) as { id: string; unreadCount: number }[];
  const row = rows.find((r) => r.id === threadId);
  assert.ok(row, "the thread must be visible to this caller");
  return row.unreadCount;
}

/** The conversation-level count, off GET /nav-counts -- what the nav badge reads. */
async function navUnread(userId: string): Promise<number> {
  const res = await fetch(`${baseUrl}/nav-counts`, { headers: headersFor(userId) });
  assert.equal(res.status, 200);
  return ((await res.json()) as { conversations: number }).conversations;
}

async function markRead(userId: string) {
  const res = await fetch(`${baseUrl}/conversations/${threadId}/read`, {
    method: "POST",
    headers: headersFor(userId),
  });
  assert.ok(res.status < 400, `mark-read should succeed, got ${res.status}`);
}

/**
 * Exactly the shape routes/webhooks.ts writes for a real inbound SMS --
 * INBOUND, channel SMS, and crucially `authorUserId: null`, because no one
 * is logged in when a client texts. Inserted directly, which the work
 * order sanctions: driving the real webhook would need a valid Twilio
 * signature, and the row is what is under test, not the signature check.
 */
async function insertWebhookInbound(body: string) {
  const message = await prisma.message.create({
    data: {
      studioId,
      conversationId: threadId,
      channel: MessageChannel.SMS,
      direction: MessageDirection.INBOUND,
      body,
      authorUserId: null,
    },
  });
  messageIds.push(message.id);
  return message;
}

async function insertAuthoredBy(userId: string, body: string) {
  const message = await prisma.message.create({
    data: {
      studioId,
      conversationId: threadId,
      channel: MessageChannel.SMS,
      direction: MessageDirection.OUTBOUND,
      body,
      authorUserId: userId,
    },
  });
  messageIds.push(message.id);
  return message;
}

before(async () => {
  const studio = await prisma.studio.create({ data: { slug: `${suffix}-studio`, name: "Unread NULL author" } });
  studioId = studio.id;
  studioIds.push(studioId);

  const one = await prisma.user.create({ data: { email: `${suffix}-one@test.invalid`, role: Role.OWNER, studioId } });
  userOneId = one.id;
  userIds.push(userOneId);

  const two = await prisma.user.create({ data: { email: `${suffix}-two@test.invalid`, role: Role.OWNER, studioId } });
  userTwoId = two.id;
  userIds.push(userTwoId);

  const client = await prisma.client.create({
    data: { studioId, firstName: "Inbound", lastName: "Tester", referralCode: `${suffix}-ref` },
  });
  clientIds.push(client.id);

  const conversation = await prisma.conversation.create({
    data: { studioId, type: ConversationType.CLIENT, clientId: client.id, lastMessageAt: new Date() },
  });
  threadId = conversation.id;
  conversationIds.push(threadId);

  const app = express();
  app.use(express.json());
  app.use("/conversations", conversationsRouter);
  app.use("/nav-counts", navCountsRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));

  await prisma.notification.deleteMany({ where: { studioId: { in: studioIds } } });
  await prisma.userConversationState.deleteMany({ where: { conversationId: { in: conversationIds } } });
  await prisma.message.deleteMany({ where: { conversationId: { in: conversationIds } } });
  await prisma.conversationRead.deleteMany({ where: { conversationId: { in: conversationIds } } });
  await prisma.conversationParticipant.deleteMany({ where: { conversationId: { in: conversationIds } } });
  await prisma.conversation.deleteMany({ where: { id: { in: conversationIds } } });
  await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
  await prisma.taskDismissal.deleteMany({ where: { studioId: { in: studioIds } } });
  await prisma.sectionSeen.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.auditLog.deleteMany({ where: { studioId: { in: studioIds } } });
  await prisma.rolePermission.deleteMany({ where: { studioId: { in: studioIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.studioSettings.deleteMany({ where: { studioId: { in: studioIds } } });
  await prisma.studio.deleteMany({ where: { id: { in: studioIds } } });
});

test("THE BUG: a webhook-shaped inbound (authorUserId null) counts as exactly one unread, in both functions", async () => {
  // Read first, so the count starts from a known zero rather than from
  // "whatever the fixture happened to leave".
  await markRead(userOneId);
  assert.equal(await threadUnread(userOneId), 0, "precondition: caught up");
  assert.equal(await navUnread(userOneId), 0, "precondition: no unread threads");

  await insertWebhookInbound("Hi, are you free Saturday?");

  // STRICT ===, not >=. Under the pre-fix predicate both of these returned
  // 0; a function that counted everything would return something else
  // again, and >= would let that through.
  assert.equal(await threadUnread(userOneId), 1, "the per-thread count must see the inbound");
  assert.equal(await navUnread(userOneId), 1, "and so must the conversation-level count");
});

test("a message the caller authored themselves still does NOT count -- the suppression half", async () => {
  await markRead(userOneId);
  assert.equal(await threadUnread(userOneId), 0, "precondition: caught up");

  await insertAuthoredBy(userOneId, "Sure, Saturday works.");

  assert.equal(await threadUnread(userOneId), 0, "your own message is never unread to you");
  assert.equal(await navUnread(userOneId), 0);

  // Paired positive sibling, in the SAME test and against the SAME state:
  // without this, a function that simply returned 0 for everything would
  // satisfy the suppression assertions above and look correct.
  await insertWebhookInbound("Great, see you then.");
  assert.equal(await threadUnread(userOneId), 1, "and it is still capable of counting");
  assert.equal(await navUnread(userOneId), 1);
});

test("a colleague's message counts for me, and mine counts for them -- symmetrically", async () => {
  await markRead(userOneId);
  await markRead(userTwoId);
  assert.equal(await threadUnread(userOneId), 0);
  assert.equal(await threadUnread(userTwoId), 0);

  await insertAuthoredBy(userTwoId, "I took this one, covering for you.");

  assert.equal(await threadUnread(userOneId), 1, "a colleague's message IS unread to me");
  assert.equal(await threadUnread(userTwoId), 0, "but not to its own author");
});

test("one user's reads do not touch another's counts", async () => {
  await markRead(userOneId);
  await markRead(userTwoId);

  await insertWebhookInbound("One more question.");
  assert.equal(await threadUnread(userOneId), 1);
  assert.equal(await threadUnread(userTwoId), 1);
  assert.equal(await navUnread(userOneId), 1);
  assert.equal(await navUnread(userTwoId), 1);

  // User one catches up. User two must be entirely unaffected -- unread is
  // per-person, and ConversationRead is keyed (conversation, user).
  await markRead(userOneId);
  assert.equal(await threadUnread(userOneId), 0, "user one is caught up");
  assert.equal(await threadUnread(userTwoId), 1, "user two still has it unread");
  assert.equal(await navUnread(userOneId), 0);
  assert.equal(await navUnread(userTwoId), 1);
});

test("several inbounds accumulate, and marking read clears them all at once", async () => {
  await markRead(userOneId);
  assert.equal(await threadUnread(userOneId), 0);

  await insertWebhookInbound("First.");
  await insertWebhookInbound("Second.");
  await insertWebhookInbound("Third.");

  // Exact, not "more than zero" -- an off-by-one or a de-duplicating bug
  // would survive a looser assertion.
  assert.equal(await threadUnread(userOneId), 3, "all three inbounds count");
  // The nav count is CONVERSATIONS with unread, not messages -- so three
  // messages in one thread is still one thread. Asserting both numbers in
  // the same breath is what keeps the two functions' different units from
  // being conflated.
  assert.equal(await navUnread(userOneId), 1, "one thread, however many messages");

  await markRead(userOneId);
  assert.equal(await threadUnread(userOneId), 0);
  assert.equal(await navUnread(userOneId), 0);
});
