// Per-user conversation state: pin, mute, and the fact that neither is
// visible to anyone but the person who set it.
//
// The thing most worth defending here is the word "per-user". Everything
// adjacent to this on Conversation is deliberately studio-wide --
// archivedAt says so in its own schema comment ("one shared record, not a
// personal mailbox") -- so the failure mode this model introduces is
// leakage: one person's pin reordering a colleague's list, or one person's
// mute silencing a colleague's notifications. Every test below asserts the
// second user is unaffected, not merely that the first user got what they
// asked for.
//
// Also covered: the pin cap is enforced in the transaction (not by the
// client), a mute suppresses the notification row and therefore all three
// of bell/badge/push, an EXPIRED mute behaves as unmuted with no cleanup
// job having run, and a non-member gets 404 rather than a 403 that would
// confirm the thread exists.

import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma";
import { JWT_SECRET } from "../lib/jwt";
import { Role, ConversationType } from "../../generated/prisma/enums";
import conversationsRouter from "./conversations";
import notificationsRouter from "./notifications";

function tokenFor(userId: string, studioId: string, role: Role): string {
  return jwt.sign({ userId, studioId, role }, JWT_SECRET);
}

const suffix = `ucs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let server: http.Server;
let baseUrl: string;

const studioIds: string[] = [];
const userIds: string[] = [];
const clientIds: string[] = [];
const artistIds: string[] = [];
const conversationIds: string[] = [];

let studioId: string;
let outsiderStudioId: string;

let ownerUserId: string;
let frontDeskUserId: string;
let outsiderUserId: string;
let insiderArtistUserId: string;
let foreignStaffThread: string;

let threadA: string;
let threadB: string;
let threadC: string;
let threadD: string;

function authOwner() {
  return { Authorization: `Bearer ${tokenFor(ownerUserId, studioId, Role.OWNER)}`, "Content-Type": "application/json" };
}
function authFrontDesk() {
  return {
    Authorization: `Bearer ${tokenFor(frontDeskUserId, studioId, Role.FRONT_DESK)}`,
    "Content-Type": "application/json",
  };
}
function authOutsider() {
  return {
    Authorization: `Bearer ${tokenFor(outsiderUserId, outsiderStudioId, Role.OWNER)}`,
    "Content-Type": "application/json",
  };
}

interface ListRow {
  id: string;
  viewerState: { isPinned: boolean; pinnedAt: string | null; mutedUntil: string | null };
}

async function list(headers: Record<string, string>): Promise<ListRow[]> {
  const res = await fetch(`${baseUrl}/conversations`, { headers });
  assert.equal(res.status, 200);
  return (await res.json()) as ListRow[];
}

async function setState(
  headers: Record<string, string>,
  conversationId: string,
  body: Record<string, unknown>,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${baseUrl}/conversations/${conversationId}/viewer-state`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

async function makeClientThread(sid: string, tag: string): Promise<string> {
  const client = await prisma.client.create({
    data: { studioId: sid, firstName: "Thread", lastName: tag, referralCode: `${suffix}-${tag}` },
  });
  clientIds.push(client.id);
  const conversation = await prisma.conversation.create({
    data: { studioId: sid, type: ConversationType.CLIENT, clientId: client.id, lastMessageAt: new Date() },
  });
  conversationIds.push(conversation.id);
  return conversation.id;
}

before(async () => {
  const studio = await prisma.studio.create({ data: { slug: `${suffix}-studio`, name: "Test UCS" } });
  studioId = studio.id;
  studioIds.push(studioId);

  const outsiderStudio = await prisma.studio.create({ data: { slug: `${suffix}-outsider`, name: "Test UCS Outsider" } });
  outsiderStudioId = outsiderStudio.id;
  studioIds.push(outsiderStudioId);

  const owner = await prisma.user.create({ data: { email: `${suffix}-owner@test.invalid`, role: Role.OWNER, studioId } });
  ownerUserId = owner.id;
  userIds.push(ownerUserId);

  const frontDesk = await prisma.user.create({
    data: { email: `${suffix}-fd@test.invalid`, role: Role.FRONT_DESK, studioId },
  });
  frontDeskUserId = frontDesk.id;
  userIds.push(frontDeskUserId);

  // A real OWNER, of a real studio, with no relationship to the first one.
  const outsider = await prisma.user.create({
    data: { email: `${suffix}-outsider@test.invalid`, role: Role.OWNER, studioId: outsiderStudioId },
  });
  outsiderUserId = outsider.id;
  userIds.push(outsiderUserId);

  threadA = await makeClientThread(studioId, "a");
  // Both staff must be REAL recipients of threadA for the mute tests below
  // to mean anything. A CLIENT thread's recipients are the artists assigned
  // to that client's live projects plus anyone who has already written in
  // the thread (lib/notifications.ts) -- so each of them writes one, which
  // is the cheaper of the two arms to set up.
  //
  // Without this the mute tests pass VACUOUSLY: with an empty recipient
  // list, "the muted user got no notification" is true whether or not mute
  // does anything at all. Found exactly that way -- the expired-mute test
  // failed and exposed it.
  for (const authorUserId of [ownerUserId, frontDeskUserId]) {
    await prisma.message.create({
      data: {
        studioId,
        conversationId: threadA,
        channel: "SMS",
        direction: "OUTBOUND",
        body: "Seeding this staff member as a participant in the thread",
        authorUserId,
      },
    });
  }
  // A real ARTIST of the SAME studio, and a STAFF thread that is NOT
  // theirs. "Non-member" is a distinct case from "cross-studio": this
  // caller passes every studio check and still must not reach the thread,
  // because canViewConversation keeps ARTIST's "-own" scoping on
  // STAFF/GROUP threads -- their own 1:1 plus groups they were added to,
  // never a colleague's.
  const insiderArtistUser = await prisma.user.create({
    data: { email: `${suffix}-artist@test.invalid`, role: Role.ARTIST, studioId },
  });
  insiderArtistUserId = insiderArtistUser.id;
  userIds.push(insiderArtistUserId);
  const insiderArtist = await prisma.artist.create({
    data: { userId: insiderArtistUserId, specialties: [], portfolioImages: [] },
  });
  artistIds.push(insiderArtist.id);

  const othersStaffThread = await prisma.conversation.create({
    data: { studioId, type: ConversationType.STAFF, staffUserId: frontDeskUserId, lastMessageAt: new Date() },
  });
  foreignStaffThread = othersStaffThread.id;
  conversationIds.push(foreignStaffThread);

  threadB = await makeClientThread(studioId, "b");
  threadC = await makeClientThread(studioId, "c");
  threadD = await makeClientThread(studioId, "d");

  const app = express();
  app.use(express.json());
  app.use("/conversations", conversationsRouter);
  app.use("/notifications", notificationsRouter);
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
  await prisma.artist.deleteMany({ where: { id: { in: artistIds } } });
  await prisma.auditLog.deleteMany({ where: { studioId: { in: studioIds } } });
  await prisma.rolePermission.deleteMany({ where: { studioId: { in: studioIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.studioSettings.deleteMany({ where: { studioId: { in: studioIds } } });
  await prisma.studio.deleteMany({ where: { id: { in: studioIds } } });
});

test("viewerState is present and null-safe for a user who has never stored a row", async () => {
  const rows = await list(authOwner());
  assert.ok(rows.length >= 4);
  for (const row of rows) {
    assert.ok(row.viewerState, "every row carries a viewerState, even with no stored row");
    assert.equal(row.viewerState.isPinned, false);
    assert.equal(row.viewerState.pinnedAt, null);
    assert.equal(row.viewerState.mutedUntil, null);
  }
});

test("a pin is the requester's alone -- it does not appear in, or reorder, a colleague's list", async () => {
  // threadA is the OLDEST by lastMessageAt (created first), so if it
  // surfaces at position 0 that can only be the pin, not the default sort.
  const before = await list(authOwner());
  assert.notEqual(before[0]!.id, threadA, "precondition: threadA is not already first");

  const { status, json } = await setState(authOwner(), threadA, { isPinned: true });
  assert.equal(status, 200);
  assert.equal((json.viewerState as { isPinned: boolean }).isPinned, true);
  assert.ok((json.viewerState as { pinnedAt: string | null }).pinnedAt, "pinnedAt is set alongside isPinned");

  const ownerRows = await list(authOwner());
  assert.equal(ownerRows[0]!.id, threadA, "pinned first, for the person who pinned it");
  assert.equal(ownerRows[0]!.viewerState.isPinned, true);

  // The whole point of the model.
  const fdRows = await list(authFrontDesk());
  assert.equal(fdRows.find((r) => r.id === threadA)!.viewerState.isPinned, false, "not pinned for anyone else");
  assert.notEqual(fdRows[0]!.id, threadA, "and their list order is untouched");
});

test("most recently pinned sorts to the top of the pinned group", async () => {
  await setState(authOwner(), threadB, { isPinned: true });

  const rows = await list(authOwner());
  assert.equal(rows[0]!.id, threadB, "the newer pin leads");
  assert.equal(rows[1]!.id, threadA);
  assert.equal(rows[2]!.viewerState.isPinned, false, "and the unpinned remainder follows");
});

test("the pin cap is 3, enforced server-side with a typed 409", async () => {
  const third = await setState(authOwner(), threadC, { isPinned: true });
  assert.equal(third.status, 200, "three is allowed");

  const fourth = await setState(authOwner(), threadD, { isPinned: true });
  assert.equal(fourth.status, 409);
  assert.equal(fourth.json.code, "PIN_LIMIT", "a typed code -- clients must not have to match on prose");

  // The rejection wrote nothing.
  const stored = await prisma.userConversationState.findUnique({
    where: { userId_conversationId: { userId: ownerUserId, conversationId: threadD } },
  });
  assert.equal(stored, null, "a rejected pin leaves no row behind -- the transaction rolled back");

  // The cap is per-user, not per-studio: a colleague with none of their
  // own pinned is unaffected by someone else being at the limit.
  const colleague = await setState(authFrontDesk(), threadD, { isPinned: true });
  assert.equal(colleague.status, 200, "the cap counts the requester's own pins only");
});

test("re-pinning something already pinned is not counted against the cap", async () => {
  // The owner is at 3. Re-pinning one they already hold must succeed --
  // it adds nothing.
  const again = await setState(authOwner(), threadA, { isPinned: true });
  assert.equal(again.status, 200, "already pinned, so no new pin to cap");

  // And muting while at the cap is likewise unaffected: the count only
  // runs when a pin would actually be added.
  const mute = await setState(authOwner(), threadD, { mutedUntil: new Date(Date.now() + 60_000).toISOString() });
  assert.equal(mute.status, 200, "a mute is not a pin");

  // Clean up so later tests start from a known pin count.
  await setState(authOwner(), threadD, { mutedUntil: null });
});

test("unpinning clears pinnedAt, and frees a slot", async () => {
  const cleared = await setState(authOwner(), threadC, { isPinned: false });
  assert.equal(cleared.status, 200);
  assert.equal((cleared.json.viewerState as { isPinned: boolean }).isPinned, false);
  assert.equal(
    (cleared.json.viewerState as { pinnedAt: string | null }).pinnedAt,
    null,
    "a stale pinnedAt would sort wrongly the moment it was pinned again",
  );

  const nowFits = await setState(authOwner(), threadD, { isPinned: true });
  assert.equal(nowFits.status, 200, "unpinning freed the slot");
  await setState(authOwner(), threadD, { isPinned: false });
});

test("a mute suppresses the muted user's notification -- and only theirs", async () => {
  // Both users are participants in threadA by virtue of being staff who
  // can see client threads. The owner mutes it; the front desk does not.
  await setState(authOwner(), threadA, { mutedUntil: new Date(Date.now() + 60 * 60_000).toISOString() });

  const beforeOwner = await prisma.notification.count({ where: { userId: ownerUserId } });
  const beforeFd = await prisma.notification.count({ where: { userId: frontDeskUserId } });

  // A third party writes into the thread, so neither of the two is the
  // author and neither is excluded for that reason.
  await prisma.message.create({
    data: {
      studioId,
      conversationId: threadA,
      channel: "SMS",
      direction: "INBOUND",
      body: "Inbound while one of them has it muted",
      authorUserId: null,
    },
  });
  const { notifyMessageCreated } = await import("../lib/notifications");
  await notifyMessageCreated({
    conversationId: threadA,
    messageId: "test-message",
    studioId,
    authorUserId: null,
    body: "Inbound while one of them has it muted",
    hasAttachments: false,
  });

  const afterOwner = await prisma.notification.count({ where: { userId: ownerUserId } });
  assert.equal(afterOwner, beforeOwner, "the muted user gets no row -- so no bell entry, no badge, no push");

  // STRICT +1, not >=. Both users are prior authors in this thread and so
  // both are genuine recipients; if this were >= it would pass even with
  // an empty recipient list, which would make the assertion above
  // meaningless too.
  const afterFd = await prisma.notification.count({ where: { userId: frontDeskUserId } });
  assert.equal(afterFd, beforeFd + 1, "the unmuted colleague is entirely unaffected -- and IS a real recipient");
});

test("an EXPIRED mute behaves as unmuted, with no cleanup job having run", async () => {
  // Set deliberately in the past. Nothing sweeps this row; the comparison
  // happens at read time, so it must simply stop matching.
  await prisma.userConversationState.update({
    where: { userId_conversationId: { userId: ownerUserId, conversationId: threadA } },
    data: { mutedUntil: new Date(Date.now() - 60_000) },
  });

  const stillStored = await prisma.userConversationState.findUnique({
    where: { userId_conversationId: { userId: ownerUserId, conversationId: threadA } },
  });
  assert.ok(stillStored?.mutedUntil, "precondition: the row is still there, un-swept");

  const before = await prisma.notification.count({ where: { userId: ownerUserId } });
  const { notifyMessageCreated } = await import("../lib/notifications");
  await notifyMessageCreated({
    conversationId: threadA,
    messageId: "test-message-2",
    studioId,
    authorUserId: null,
    body: "After the mute lapsed",
    hasAttachments: false,
  });
  const after = await prisma.notification.count({ where: { userId: ownerUserId } });
  assert.equal(after, before + 1, "a lapsed mute suppresses nothing");
});

test("mutedUntil: null clears a mute", async () => {
  const { status, json } = await setState(authOwner(), threadA, { mutedUntil: null });
  assert.equal(status, 200);
  assert.equal((json.viewerState as { mutedUntil: string | null }).mutedUntil, null);
});

test("an outsider gets 404, not 403 -- and cannot read the state either", async () => {
  const write = await setState(authOutsider(), threadA, { isPinned: true });
  assert.equal(write.status, 404, "404, so a non-member cannot confirm the thread exists");
  assert.notEqual(write.json.code, "PIN_LIMIT");

  const stored = await prisma.userConversationState.findUnique({
    where: { userId_conversationId: { userId: outsiderUserId, conversationId: threadA } },
  });
  assert.equal(stored, null, "and nothing was written");

  const rows = await list(authOutsider());
  assert.equal(
    rows.find((r) => r.id === threadA),
    undefined,
    "the thread is not in their list at all",
  );
});

test("a bad body is rejected before anything is written", async () => {
  const empty = await setState(authOwner(), threadB, {});
  assert.equal(empty.status, 400);

  const badPin = await setState(authOwner(), threadB, { isPinned: "yes" });
  assert.equal(badPin.status, 400);

  const badMute = await setState(authOwner(), threadB, { mutedUntil: "not-a-date" });
  assert.equal(badMute.status, 400);

  // studioId and userId in the body are ignored outright -- both are
  // derived from the JWT and the conversation row. Asserted by checking
  // the row that IS written carries the conversation's studio, not the
  // attacker-supplied one.
  const injected = await setState(authOwner(), threadB, {
    isPinned: false,
    studioId: outsiderStudioId,
    userId: outsiderUserId,
  });
  assert.equal(injected.status, 200);
  const row = await prisma.userConversationState.findUnique({
    where: { userId_conversationId: { userId: ownerUserId, conversationId: threadB } },
  });
  assert.equal(row?.studioId, studioId, "studioId came from the conversation, not the body");
  const forged = await prisma.userConversationState.findUnique({
    where: { userId_conversationId: { userId: outsiderUserId, conversationId: threadB } },
  });
  assert.equal(forged, null, "userId came from the JWT, not the body");
});

test("a NON-MEMBER inside the same studio also gets 404 -- distinct from the cross-studio case", async () => {
  // Everything about this caller's studio checks out: same studioId, real
  // active membership, a genuine ARTIST of this studio. What they are not
  // is a member of THIS thread -- it is another staff member's 1:1.
  // canViewConversation's "-own" scoping is what stops them, and this is
  // the case a bare `conversation.studioId === jwt.studioId` check (the
  // work order's original draft) would have let straight through.
  const headers = {
    Authorization: `Bearer ${tokenFor(insiderArtistUserId, studioId, Role.ARTIST)}`,
    "Content-Type": "application/json",
  };

  const write = await setState(headers, foreignStaffThread, { isPinned: true });
  assert.equal(write.status, 404, "same studio, not a member of this thread -- still 404, never 403");

  const stored = await prisma.userConversationState.findUnique({
    where: { userId_conversationId: { userId: insiderArtistUserId, conversationId: foreignStaffThread } },
  });
  assert.equal(stored, null, "and nothing was written");

  // Their own list does not contain it either -- the read side and the
  // write side agree about membership, which is the whole reason both go
  // through canViewConversation rather than two separate checks.
  const rows = await list(headers);
  assert.equal(
    rows.find((r) => r.id === foreignStaffThread),
    undefined,
    "not in their list, so the read and write sides cannot disagree",
  );
});
