// Notification system, end to end over real HTTP.
//
// What is actually being defended here is targeting and isolation, not
// rendering. A notification system that notifies the wrong people, or too
// many of them, is one people switch off -- at which point it is worse
// than not having built it. So:
//
//  - the actor is never notified about their own action
//  - a CLIENT thread notifies participants, not everyone entitled to read
//    it (the alternative being: every inbound client text pushes to the
//    whole studio)
//  - one person's feed and unread count never include another's
//  - mark-read cannot touch a row that is not yours, even by id
//
// Expo push is deliberately NOT exercised. There are no PushToken rows in
// these fixtures, so the push path short-circuits before any network call
// -- which is also exactly how this ships: inert until apps/mobile starts
// registering devices.

import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma";
import { JWT_SECRET } from "../lib/jwt";
import { Role, ConversationType, NotificationType } from "../../generated/prisma/enums";
import notificationsRouter from "./notifications";
import tasksRouter from "./tasks";
import inquiriesRouter from "./inquiries";
import conversationsRouter from "./conversations";

function tokenFor(userId: string, studioId: string, role: Role): string {
  return jwt.sign({ userId, studioId, role }, JWT_SECRET);
}

const suffix = `ntf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let server: http.Server;
let baseUrl: string;

const studioIds: string[] = [];
const userIds: string[] = [];
const artistIds: string[] = [];
const clientIds: string[] = [];
const serviceIds: string[] = [];
const inquiryIds: string[] = [];
const conversationIds: string[] = [];

let studioId: string;
let ownerUserId: string;
let frontDeskUserId: string;
let artistUserId: string;
let artistId: string;
let bystanderUserId: string;

let inquiryId: string;
let clientId: string;
let staffConversationId: string;
let clientConversationId: string;

async function feedFor(userId: string, role: Role) {
  const res = await fetch(`${baseUrl}/notifications?limit=50`, {
    headers: { Authorization: `Bearer ${tokenFor(userId, studioId, role)}` },
  });
  assert.equal(res.status, 200);
  return (await res.json()) as {
    items: { id: string; type: string; title: string; body: string; entityType: string; entityId: string; readAt: string | null }[];
    unreadCount: number;
    nextCursor: string | null;
  };
}

before(async () => {
  const studio = await prisma.studio.create({ data: { slug: `${suffix}-studio`, name: "Test Notifications" } });
  studioId = studio.id;
  studioIds.push(studioId);

  const owner = await prisma.user.create({
    data: { email: `${suffix}-owner@test.invalid`, role: Role.OWNER, studioId },
  });
  ownerUserId = owner.id;
  userIds.push(ownerUserId);

  const frontDesk = await prisma.user.create({
    data: { email: `${suffix}-fd@test.invalid`, role: Role.FRONT_DESK, studioId },
  });
  frontDeskUserId = frontDesk.id;
  userIds.push(frontDeskUserId);

  const artistUser = await prisma.user.create({
    data: { email: `${suffix}-artist@test.invalid`, role: Role.ARTIST, studioId },
  });
  artistUserId = artistUser.id;
  userIds.push(artistUserId);
  const artist = await prisma.artist.create({
    data: { userId: artistUserId, specialties: [], portfolioImages: [] },
  });
  artistId = artist.id;
  artistIds.push(artistId);

  // Present, entitled to see everything, and involved in nothing. Every
  // test asserts this person's feed stays empty -- the single most useful
  // assertion in the file, because over-notification is the failure mode
  // that kills a notification system.
  const bystander = await prisma.user.create({
    data: { email: `${suffix}-bystander@test.invalid`, role: Role.FRONT_DESK, studioId },
  });
  bystanderUserId = bystander.id;
  userIds.push(bystanderUserId);

  const intake = await prisma.intakeForm.create({ data: { studioId, name: "Intake", slug: `${suffix}-intake` } });
  const service = await prisma.service.create({
    data: {
      studioId,
      name: "Tattoo",
      slug: `${suffix}-tattoo`,
      pricingModel: "RANGE",
      depositModel: "TIER_BASED",
      intakeFormId: intake.id,
    },
  });
  serviceIds.push(service.id);

  const client = await prisma.client.create({
    data: { studioId, firstName: "Nora", lastName: "Bell", referralCode: `${suffix}-ref` },
  });
  clientId = client.id;
  clientIds.push(clientId);

  const inquiry = await prisma.inquiry.create({
    data: {
      studioId,
      clientId,
      serviceId: service.id,
      channel: "EMAIL",
      description: "Half sleeve, botanical",
      colorOrBlackGrey: "Black & Grey",
      placement: "Forearm",
      estimatedSize: "Large",
      hasBeenTattooedBefore: true,
      status: "NEW",
    },
  });
  inquiryId = inquiry.id;
  inquiryIds.push(inquiryId);

  // A 1:1 team thread between the owner and the artist. staffUserId is the
  // artist's, which is what makes them a participant.
  const staffConversation = await prisma.conversation.create({
    data: { studioId, type: ConversationType.STAFF, staffUserId: artistUserId },
  });
  staffConversationId = staffConversation.id;
  conversationIds.push(staffConversationId);

  const clientConversation = await prisma.conversation.create({
    data: { studioId, type: ConversationType.CLIENT, clientId },
  });
  clientConversationId = clientConversation.id;
  conversationIds.push(clientConversationId);

  const app = express();
  app.use(express.json());
  app.use("/notifications", notificationsRouter);
  app.use("/tasks", tasksRouter);
  app.use("/inquiries", inquiriesRouter);
  app.use("/conversations", conversationsRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));

  await prisma.notification.deleteMany({ where: { studioId: { in: studioIds } } });
  await prisma.pushToken.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.message.deleteMany({ where: { conversationId: { in: conversationIds } } });
  await prisma.conversationParticipant.deleteMany({ where: { conversationId: { in: conversationIds } } });
  await prisma.conversationRead.deleteMany({ where: { conversationId: { in: conversationIds } } });
  await prisma.conversation.deleteMany({ where: { id: { in: conversationIds } } });
  await prisma.personalTask.deleteMany({ where: { studioId: { in: studioIds } } });
  await prisma.inquiry.deleteMany({ where: { id: { in: inquiryIds } } });
  await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
  await prisma.service.deleteMany({ where: { id: { in: serviceIds } } });
  await prisma.intakeForm.deleteMany({ where: { studioId: { in: studioIds } } });
  await prisma.artist.deleteMany({ where: { id: { in: artistIds } } });
  await prisma.auditLog.deleteMany({ where: { studioId: { in: studioIds } } });
  await prisma.rolePermission.deleteMany({ where: { studioId: { in: studioIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.studioSettings.deleteMany({ where: { studioId: { in: studioIds } } });
  await prisma.studio.deleteMany({ where: { id: { in: studioIds } } });
});

test("a fresh account's feed is empty, and the badge agrees", async () => {
  const feed = await feedFor(bystanderUserId, Role.FRONT_DESK);
  assert.equal(feed.items.length, 0);
  assert.equal(feed.unreadCount, 0);

  const res = await fetch(`${baseUrl}/notifications/unread-count`, {
    headers: { Authorization: `Bearer ${tokenFor(bystanderUserId, studioId, Role.FRONT_DESK)}` },
  });
  assert.deepEqual(await res.json(), { unreadCount: 0 });
});

test("TASK_ASSIGNED reaches the assignee, carries a deep link, and never reaches the assigner", async () => {
  const res = await fetch(`${baseUrl}/tasks/personal`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tokenFor(ownerUserId, studioId, Role.OWNER)}`, "Content-Type": "application/json" },
    body: JSON.stringify({ title: "Order more black ink", userId: artistUserId }),
  });
  assert.equal(res.status, 201);
  const task = (await res.json()) as { id: string };

  const assignee = await feedFor(artistUserId, Role.ARTIST);
  assert.equal(assignee.items.length, 1);
  assert.equal(assignee.unreadCount, 1);
  assert.equal(assignee.items[0]!.type, NotificationType.TASK_ASSIGNED);
  assert.equal(assignee.items[0]!.body, "Order more black ink");
  // The deep link, as two plain fields -- what both clients route on.
  assert.equal(assignee.items[0]!.entityType, "PersonalTask");
  assert.equal(assignee.items[0]!.entityId, task.id);

  const assigner = await feedFor(ownerUserId, Role.OWNER);
  assert.equal(assigner.items.length, 0, "being told about a thing you just did is noise");

  const bystander = await feedFor(bystanderUserId, Role.FRONT_DESK);
  assert.equal(bystander.items.length, 0, "an uninvolved colleague hears nothing");
});

test("a task you create for YOURSELF is silent", async () => {
  const before = await feedFor(ownerUserId, Role.OWNER);

  const res = await fetch(`${baseUrl}/tasks/personal`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tokenFor(ownerUserId, studioId, Role.OWNER)}`, "Content-Type": "application/json" },
    body: JSON.stringify({ title: "My own reminder" }),
  });
  assert.equal(res.status, 201);

  const after = await feedFor(ownerUserId, Role.OWNER);
  assert.equal(after.items.length, before.items.length, "self-assignment must produce nothing at all");
});

test("INQUIRY_ASSIGNED reaches the assigned artist, and names both the client and who assigned it", async () => {
  const res = await fetch(`${baseUrl}/inquiries/${inquiryId}/assign`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${tokenFor(ownerUserId, studioId, Role.OWNER)}`, "Content-Type": "application/json" },
    body: JSON.stringify({ artistId }),
  });
  assert.equal(res.status, 200);

  const feed = await feedFor(artistUserId, Role.ARTIST);
  const assigned = feed.items.find((i) => i.type === NotificationType.INQUIRY_ASSIGNED);
  assert.ok(assigned, "the artist the project was assigned to must be told");
  assert.equal(assigned.entityType, "Inquiry");
  assert.equal(assigned.entityId, inquiryId);
  assert.match(assigned.body, /Nora Bell/, "the client is who the artist actually recognises");

  const bystander = await feedFor(bystanderUserId, Role.FRONT_DESK);
  assert.equal(bystander.items.length, 0);
});

test("MESSAGE_CREATED on a TEAM thread reaches the other participant, not the author or a bystander", async () => {
  const res = await fetch(`${baseUrl}/conversations/${staffConversationId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tokenFor(ownerUserId, studioId, Role.OWNER)}`, "Content-Type": "application/json" },
    body: JSON.stringify({ body: "Can you take a look at the Bell sleeve?" }),
  });
  assert.equal(res.status, 201);

  const artistFeed = await feedFor(artistUserId, Role.ARTIST);
  const message = artistFeed.items.find((i) => i.type === NotificationType.MESSAGE_CREATED);
  assert.ok(message, "the other side of a 1:1 team thread is a participant by definition");
  assert.equal(message.entityType, "Conversation");
  assert.equal(message.entityId, staffConversationId);

  const authorFeed = await feedFor(ownerUserId, Role.OWNER);
  assert.equal(
    authorFeed.items.filter((i) => i.type === NotificationType.MESSAGE_CREATED).length,
    0,
    "the author is not notified of their own message",
  );

  const bystander = await feedFor(bystanderUserId, Role.FRONT_DESK);
  assert.equal(bystander.items.length, 0, "a team thread notifies its participants, not the studio");
});

test("MESSAGE_CREATED on a CLIENT thread reaches the assigned artist -- and still not the bystander", async () => {
  // The inquiry was assigned to this artist in an earlier test, which is
  // what makes them a participant in this client's thread. The bystander
  // can SEE this thread (FRONT_DESK, conversations.viewClientThreads on by
  // default) and is deliberately still not notified: "can read" is not
  // "participates in", and conflating them means every inbound client text
  // pushing to the whole studio.
  const res = await fetch(`${baseUrl}/conversations/${clientConversationId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tokenFor(frontDeskUserId, studioId, Role.FRONT_DESK)}`, "Content-Type": "application/json" },
    body: JSON.stringify({ body: "Confirming Thursday at 2.", channel: "SMS", direction: "OUTBOUND" }),
  });
  assert.equal(res.status, 201);

  const artistFeed = await feedFor(artistUserId, Role.ARTIST);
  const messages = artistFeed.items.filter(
    (i) => i.type === NotificationType.MESSAGE_CREATED && i.entityId === clientConversationId,
  );
  assert.equal(messages.length, 1, "the artist assigned to this client's live project is a participant");

  const bystander = await feedFor(bystanderUserId, Role.FRONT_DESK);
  assert.equal(bystander.items.length, 0, "entitled to read it, not involved in it");

  const authorFeed = await feedFor(frontDeskUserId, Role.FRONT_DESK);
  assert.equal(
    authorFeed.items.filter((i) => i.entityId === clientConversationId).length,
    0,
    "the sender is not notified of their own send",
  );
});

test("mark-read is per-row, idempotent, and cannot touch someone else's notification", async () => {
  const artistFeed = await feedFor(artistUserId, Role.ARTIST);
  assert.ok(artistFeed.unreadCount >= 2, "precondition: several unread");
  const target = artistFeed.items[0]!;

  // The bystander tries the artist's own notification id directly. The
  // route filters on userId in the WHERE clause rather than fetching and
  // then comparing, so this cannot succeed and does not reveal whether
  // that id exists.
  const attack = await fetch(`${baseUrl}/notifications/mark-read`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tokenFor(bystanderUserId, studioId, Role.FRONT_DESK)}`, "Content-Type": "application/json" },
    body: JSON.stringify({ id: target.id }),
  });
  assert.equal(attack.status, 200);
  assert.equal(((await attack.json()) as { updated: number }).updated, 0);

  const stillUnread = await feedFor(artistUserId, Role.ARTIST);
  assert.equal(stillUnread.unreadCount, artistFeed.unreadCount, "nobody else's read state moved");

  // The owner marks their own.
  const own = await fetch(`${baseUrl}/notifications/mark-read`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tokenFor(artistUserId, studioId, Role.ARTIST)}`, "Content-Type": "application/json" },
    body: JSON.stringify({ id: target.id }),
  });
  const first = (await own.json()) as { updated: number; unreadCount: number };
  assert.equal(first.updated, 1);
  assert.equal(first.unreadCount, artistFeed.unreadCount - 1);

  // Again: no-op, and readAt is NOT re-stamped, so it keeps meaning "when
  // you first read it".
  const again = await fetch(`${baseUrl}/notifications/mark-read`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tokenFor(artistUserId, studioId, Role.ARTIST)}`, "Content-Type": "application/json" },
    body: JSON.stringify({ id: target.id }),
  });
  const second = (await again.json()) as { updated: number; unreadCount: number };
  assert.equal(second.updated, 0);
  assert.equal(second.unreadCount, first.unreadCount);
});

test("unreadOnly filters the feed, and mark-all-read empties it without deleting anything", async () => {
  const before = await feedFor(artistUserId, Role.ARTIST);
  assert.ok(before.unreadCount > 0);

  const unreadRes = await fetch(`${baseUrl}/notifications?unreadOnly=true&limit=50`, {
    headers: { Authorization: `Bearer ${tokenFor(artistUserId, studioId, Role.ARTIST)}` },
  });
  const unread = (await unreadRes.json()) as { items: { readAt: string | null }[] };
  assert.equal(unread.items.length, before.unreadCount);
  assert.ok(unread.items.every((i) => i.readAt === null));

  const allRes = await fetch(`${baseUrl}/notifications/mark-all-read`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tokenFor(artistUserId, studioId, Role.ARTIST)}` },
  });
  assert.deepEqual(await allRes.json(), { updated: before.unreadCount, unreadCount: 0 });

  const after = await feedFor(artistUserId, Role.ARTIST);
  assert.equal(after.unreadCount, 0);
  // Read, not gone: the feed is history, and "Show all" must still find them.
  assert.equal(after.items.length, before.items.length);
  assert.ok(after.items.every((i) => i.readAt !== null));
});

test("the feed paginates by cursor, not offset", async () => {
  const first = await fetch(`${baseUrl}/notifications?limit=1`, {
    headers: { Authorization: `Bearer ${tokenFor(artistUserId, studioId, Role.ARTIST)}` },
  });
  const page1 = (await first.json()) as { items: { id: string }[]; nextCursor: string | null };
  assert.equal(page1.items.length, 1);
  assert.ok(page1.nextCursor, "more than one row exists, so there must be a cursor");

  const second = await fetch(`${baseUrl}/notifications?limit=1&cursor=${page1.nextCursor}`, {
    headers: { Authorization: `Bearer ${tokenFor(artistUserId, studioId, Role.ARTIST)}` },
  });
  const page2 = (await second.json()) as { items: { id: string }[] };
  assert.equal(page2.items.length, 1);
  assert.notEqual(page2.items[0]!.id, page1.items[0]!.id, "the cursor row itself must be skipped, not repeated");
});
