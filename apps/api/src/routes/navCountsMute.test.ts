// /nav-counts must not count muted threads.
//
// The product rule, established in the pin/mute work and asserted here
// from the other side: **a mute suppresses the INTERRUPTION, not the
// INDICATOR.**
//
//   GET /conversations -> unreadCount   the row's own dot. An INDICATOR.
//                                       Keeps accruing while muted.
//   GET /nav-counts    -> conversations the nav/tab badge. An
//                                       INTERRUPTION surface, same
//                                       category as push. Goes quiet.
//
// Both halves are asserted against the SAME event in the same test,
// deliberately. Split across two tests they would still pass if one
// function were simply broken in the convenient direction; together, the
// pair pins the rule itself rather than either number alone.
//
// Every inbound below is written in the webhook's shape --
// `authorUserId: null` -- which is both realistic (a client's text has no
// logged-in author) and the case that previously went uncounted
// everywhere. Using it here means these tests also stand on the NULL-safe
// predicate, not beside it.

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

const suffix = `ncm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let server: http.Server;
let baseUrl: string;

const studioIds: string[] = [];
const userIds: string[] = [];
const clientIds: string[] = [];
const conversationIds: string[] = [];

let studioId: string;
let userOneId: string;
let userTwoId: string;
/** Thread A -- the one user one mutes. */
let threadA: string;
/** Thread B -- A's twin, never muted. The control. */
let threadB: string;

function headersFor(userId: string) {
  return { Authorization: `Bearer ${tokenFor(userId, studioId, Role.OWNER)}`, "Content-Type": "application/json" };
}

async function threadUnread(userId: string, conversationId: string): Promise<number> {
  const res = await fetch(`${baseUrl}/conversations`, { headers: headersFor(userId) });
  assert.equal(res.status, 200);
  const rows = (await res.json()) as { id: string; unreadCount: number }[];
  const row = rows.find((r) => r.id === conversationId);
  assert.ok(row, "thread must be visible to this caller");
  return row.unreadCount;
}

async function navUnread(userId: string): Promise<number> {
  const res = await fetch(`${baseUrl}/nav-counts`, { headers: headersFor(userId) });
  assert.equal(res.status, 200);
  return ((await res.json()) as { conversations: number }).conversations;
}

async function markRead(userId: string, conversationId: string) {
  const res = await fetch(`${baseUrl}/conversations/${conversationId}/read`, {
    method: "POST",
    headers: headersFor(userId),
  });
  assert.ok(res.status < 400, `mark-read failed: ${res.status}`);
}

async function setMute(userId: string, conversationId: string, mutedUntil: Date | null) {
  const res = await fetch(`${baseUrl}/conversations/${conversationId}/viewer-state`, {
    method: "PATCH",
    headers: headersFor(userId),
    body: JSON.stringify({ mutedUntil: mutedUntil ? mutedUntil.toISOString() : null }),
  });
  assert.equal(res.status, 200, "viewer-state PATCH should succeed");
}

/** The Twilio webhook's row shape: INBOUND, and no author. */
async function inbound(conversationId: string, body: string) {
  await prisma.message.create({
    data: {
      studioId,
      conversationId,
      channel: MessageChannel.SMS,
      direction: MessageDirection.INBOUND,
      body,
      authorUserId: null,
    },
  });
}

/** Both users caught up on both threads, and neither thread muted. */
async function resetToQuiet() {
  await setMute(userOneId, threadA, null);
  await setMute(userOneId, threadB, null);
  await setMute(userTwoId, threadA, null);
  await setMute(userTwoId, threadB, null);
  for (const u of [userOneId, userTwoId]) {
    await markRead(u, threadA);
    await markRead(u, threadB);
  }
  assert.equal(await navUnread(userOneId), 0, "precondition: user one has a quiet badge");
  assert.equal(await navUnread(userTwoId), 0, "precondition: user two has a quiet badge");
}

async function makeThread(tag: string): Promise<string> {
  const client = await prisma.client.create({
    data: { studioId, firstName: "Thread", lastName: tag, referralCode: `${suffix}-${tag}` },
  });
  clientIds.push(client.id);
  const conversation = await prisma.conversation.create({
    data: { studioId, type: ConversationType.CLIENT, clientId: client.id, lastMessageAt: new Date() },
  });
  conversationIds.push(conversation.id);
  return conversation.id;
}

before(async () => {
  const studio = await prisma.studio.create({ data: { slug: `${suffix}-studio`, name: "Nav counts mute" } });
  studioId = studio.id;
  studioIds.push(studioId);

  const one = await prisma.user.create({ data: { email: `${suffix}-one@test.invalid`, role: Role.OWNER, studioId } });
  userOneId = one.id;
  userIds.push(userOneId);

  const two = await prisma.user.create({ data: { email: `${suffix}-two@test.invalid`, role: Role.OWNER, studioId } });
  userTwoId = two.id;
  userIds.push(userTwoId);

  threadA = await makeThread("a");
  threadB = await makeThread("b");

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
  await prisma.sectionSeen.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.auditLog.deleteMany({ where: { studioId: { in: studioIds } } });
  await prisma.rolePermission.deleteMany({ where: { studioId: { in: studioIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.studioSettings.deleteMany({ where: { studioId: { in: studioIds } } });
  await prisma.studio.deleteMany({ where: { id: { in: studioIds } } });
});

test("THE RULE: a muted thread's indicator accrues (+1) while its interruption stays quiet (+0)", async () => {
  await resetToQuiet();
  await setMute(userOneId, threadA, new Date(Date.now() + 60 * 60_000));

  await inbound(threadA, "message into a muted thread");

  // Both halves, same event, strict.
  assert.equal(await threadUnread(userOneId, threadA), 1, "INDICATOR: the row's own dot still accrues");
  assert.equal(await navUnread(userOneId), 0, "INTERRUPTION: the nav badge stays quiet");
});

test("the unmuted twin, same event shape, moves both numbers (+1 / +1)", async () => {
  await resetToQuiet();

  await inbound(threadB, "message into an unmuted thread");

  assert.equal(await threadUnread(userOneId, threadB), 1, "indicator");
  assert.equal(await navUnread(userOneId), 1, "and the interruption fires, because nothing is muted");
});

test("both at once: the badge counts the unmuted thread only, not both", async () => {
  // The sharpest form of the rule. Two threads, two identical events, one
  // muted -- the badge must read exactly 1, not 0 and not 2. A function
  // that suppressed too much or too little fails here even though each
  // half above might pass.
  await resetToQuiet();
  await setMute(userOneId, threadA, new Date(Date.now() + 60 * 60_000));

  await inbound(threadA, "muted");
  await inbound(threadB, "not muted");

  assert.equal(await threadUnread(userOneId, threadA), 1, "muted thread's indicator still accrues");
  assert.equal(await threadUnread(userOneId, threadB), 1, "unmuted thread's indicator too");
  assert.equal(await navUnread(userOneId), 1, "but the badge counts only the unmuted one");
});

test("an EXPIRED mute counts again (+1 / +1), with no cleanup job having run", async () => {
  await resetToQuiet();

  // A real row, left in place, with an instant in the past. Nothing
  // sweeps it -- the comparison happens at read time, so it must simply
  // stop matching.
  await setMute(userOneId, threadA, new Date(Date.now() + 60 * 60_000));
  await prisma.userConversationState.update({
    where: { userId_conversationId: { userId: userOneId, conversationId: threadA } },
    data: { mutedUntil: new Date(Date.now() - 60_000) },
  });
  const still = await prisma.userConversationState.findUnique({
    where: { userId_conversationId: { userId: userOneId, conversationId: threadA } },
  });
  assert.ok(still?.mutedUntil, "precondition: the row is still there, un-swept");

  await inbound(threadA, "after the mute lapsed");

  assert.equal(await threadUnread(userOneId, threadA), 1, "indicator");
  assert.equal(await navUnread(userOneId), 1, "a lapsed mute suppresses nothing");
});

test("mute is per-person: user one's mute does not quiet user two's badge", async () => {
  await resetToQuiet();
  await setMute(userOneId, threadA, new Date(Date.now() + 60 * 60_000));

  await inbound(threadA, "one of them has this muted");

  assert.equal(await navUnread(userOneId), 0, "muted for user one");
  // The assertion that makes the `userId` inside the `none:` filter load-
  // bearing: drop it and the filter would quiet everyone's badge.
  assert.equal(await navUnread(userTwoId), 1, "and emphatically NOT muted for user two");
  assert.equal(await threadUnread(userTwoId, threadA), 1, "whose indicator is unaffected too");
});

test("unmuting restores the badge, and the accrued unread is still there to count", async () => {
  await resetToQuiet();
  await setMute(userOneId, threadA, new Date(Date.now() + 60 * 60_000));

  await inbound(threadA, "arrived while muted");
  assert.equal(await navUnread(userOneId), 0, "quiet while muted");
  assert.equal(await threadUnread(userOneId, threadA), 1, "but accruing underneath");

  await setMute(userOneId, threadA, null);

  // The point of the indicator half: nothing was lost while muted, so
  // unmuting surfaces it rather than starting from zero.
  assert.equal(await navUnread(userOneId), 1, "unmuting reveals what accrued");
  assert.equal(await threadUnread(userOneId, threadA), 1);
});
