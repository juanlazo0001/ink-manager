import { Router } from "express";
import { prisma } from "../lib/prisma";
import { ConversationType, MessageChannel, MessageDirection, Role } from "../../generated/prisma/enums";
import { requireAuth, requireRole } from "../middleware/auth";
import { logAudit } from "../lib/audit";
import { canViewConversation, getUnreadCountForConversation, visibleConversationWhere } from "../lib/conversations";

const router = Router();
router.use(requireAuth);
router.use(requireRole(Role.OWNER, Role.FRONT_DESK, Role.ARTIST));

const VALID_CHANNELS = Object.values(MessageChannel);
const VALID_DIRECTIONS = Object.values(MessageDirection);

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

const COUNTERPART_SELECT = {
  client: { select: { id: true, firstName: true, lastName: true, mergedIntoId: true } },
  staffUser: { select: { id: true, name: true, email: true, role: true } },
} as const;

function toCounterpart(conversation: {
  type: ConversationType;
  client: { id: string; firstName: string; lastName: string } | null;
  staffUser: { id: string; name: string | null; email: string; role: Role } | null;
}) {
  if (conversation.type === ConversationType.CLIENT && conversation.client) {
    return { id: conversation.client.id, name: `${conversation.client.firstName} ${conversation.client.lastName}` };
  }
  if (conversation.type === ConversationType.STAFF && conversation.staffUser) {
    return { id: conversation.staffUser.id, name: conversation.staffUser.name ?? conversation.staffUser.email };
  }
  return null;
}

// List visible conversations, sorted by most recent activity. Each item
// includes a preview of the last message and the requester's own unread
// count (never someone else's -- unread-ness is per-user).
router.get("/", async (req, res) => {
  const { studioId, userId, role } = req.user!;
  const typeFilter = typeof req.query.type === "string" ? req.query.type : undefined;

  if (typeFilter && !Object.values(ConversationType).includes(typeFilter as ConversationType)) {
    return res.status(400).json({ error: `type must be one of: ${Object.values(ConversationType).join(", ")}` });
  }

  const conversations = await prisma.conversation.findMany({
    where: { ...visibleConversationWhere(studioId, userId, role), ...(typeFilter ? { type: typeFilter as ConversationType } : {}) },
    include: {
      ...COUNTERPART_SELECT,
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
    },
    orderBy: { lastMessageAt: "desc" },
  });

  const withUnread = await Promise.all(
    conversations.map(async (conversation) => ({
      id: conversation.id,
      type: conversation.type,
      clientId: conversation.clientId,
      staffUserId: conversation.staffUserId,
      lastMessageAt: conversation.lastMessageAt,
      counterpart: toCounterpart(conversation),
      lastMessage: conversation.messages[0]
        ? {
            body: conversation.messages[0].body,
            channel: conversation.messages[0].channel,
            direction: conversation.messages[0].direction,
            createdAt: conversation.messages[0].createdAt,
          }
        : null,
      unreadCount: await getUnreadCountForConversation(conversation.id, userId),
    })),
  );

  res.json(withUnread);
});

// Roster for starting a new STAFF thread -- who in the studio can be
// messaged, and whether a thread with them already exists. OWNER/FRONT_DESK
// only: an ARTIST only ever has their own single thread (auto-created on
// first message), never a reason to browse a roster.
router.get("/staff", requireRole(Role.OWNER, Role.FRONT_DESK), async (req, res) => {
  const staff = await prisma.user.findMany({
    where: { studioId: req.user!.studioId, isActive: true, role: { not: Role.CUSTOMER } },
    select: { id: true, name: true, email: true, role: true, staffConversation: { select: { id: true } } },
    orderBy: { name: "asc" },
  });

  res.json(
    staff.map((u) => ({
      id: u.id,
      name: u.name ?? u.email,
      email: u.email,
      role: u.role,
      conversationId: u.staffConversation?.id ?? null,
    })),
  );
});

// Get-or-create: threads are unique per counterpart, so this is idempotent
// and the UI never needs to know whether one already existed. Exactly one
// of clientId/staffUserId must be given -- Prisma can't express "exactly
// one of these two nullable FKs" as a real constraint, so it's validated
// here instead.
router.post("/", async (req, res) => {
  const { studioId, userId, role } = req.user!;
  const { clientId, staffUserId } = req.body ?? {};

  if (!!clientId === !!staffUserId) {
    return res.status(400).json({ error: "Provide exactly one of clientId or staffUserId" });
  }

  if (clientId) {
    if (role === Role.ARTIST) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    const client = await prisma.client.findUnique({ where: { id: clientId } });
    if (!client || client.studioId !== studioId) {
      return res.status(404).json({ error: "Client not found" });
    }
    if (client.mergedIntoId) {
      return res.status(400).json({
        error: `This client was merged -- message the survivor client instead (${client.mergedIntoId}).`,
      });
    }

    const existing = await prisma.conversation.findUnique({ where: { clientId } });
    if (existing) return res.json(existing);

    const created = await prisma.conversation.create({ data: { studioId, type: ConversationType.CLIENT, clientId } });
    await logAudit({
      studioId,
      actorUserId: userId,
      entityType: "Conversation",
      entityId: created.id,
      action: "create",
      changes: { type: "CLIENT", clientId },
    });
    return res.status(201).json(created);
  }

  // staffUserId path
  if (role === Role.ARTIST && staffUserId !== userId) {
    return res.status(403).json({ error: "You can only open your own conversation" });
  }

  const staffMember = await prisma.user.findUnique({ where: { id: staffUserId } });
  if (!staffMember || staffMember.studioId !== studioId) {
    return res.status(404).json({ error: "Staff member not found" });
  }

  const existing = await prisma.conversation.findUnique({ where: { staffUserId } });
  if (existing) return res.json(existing);

  const created = await prisma.conversation.create({ data: { studioId, type: ConversationType.STAFF, staffUserId } });
  await logAudit({
    studioId,
    actorUserId: userId,
    entityType: "Conversation",
    entityId: created.id,
    action: "create",
    changes: { type: "STAFF", staffUserId },
  });
  res.status(201).json(created);
});

const MESSAGES_PAGE_SIZE = 30;

// Cursor pagination on (createdAt, id); a page is the MESSAGES_PAGE_SIZE
// messages immediately before the cursor (most recent first internally),
// reversed to oldest-first before returning -- callers prepend a page when
// scrolling up, exactly like a normal chat history load.
router.get("/:id/messages", async (req, res) => {
  const id = req.params.id as string;
  const { studioId, userId, role } = req.user!;
  const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;

  const conversation = await prisma.conversation.findUnique({ where: { id }, include: COUNTERPART_SELECT });
  if (!conversation || !canViewConversation(conversation, studioId, userId, role)) {
    return res.status(404).json({ error: "Conversation not found" });
  }

  const page = await prisma.message.findMany({
    where: { conversationId: id },
    orderBy: { createdAt: "desc" },
    take: MESSAGES_PAGE_SIZE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: { author: { select: { id: true, name: true, email: true } } },
  });

  const hasMore = page.length > MESSAGES_PAGE_SIZE;
  const messages = page.slice(0, MESSAGES_PAGE_SIZE).reverse();

  res.json({
    conversation: {
      id: conversation.id,
      type: conversation.type,
      clientId: conversation.clientId,
      staffUserId: conversation.staffUserId,
      counterpart: toCounterpart(conversation),
    },
    messages,
    nextCursor: hasMore ? page[MESSAGES_PAGE_SIZE].id : null,
  });
});

router.post("/:id/messages", async (req, res) => {
  const id = req.params.id as string;
  const { studioId, userId, role } = req.user!;
  const body = req.body ?? {};

  const conversation = await prisma.conversation.findUnique({ where: { id } });
  if (!conversation || !canViewConversation(conversation, studioId, userId, role)) {
    return res.status(404).json({ error: "Conversation not found" });
  }

  let channel: MessageChannel;
  let direction: MessageDirection;

  if (conversation.type === ConversationType.STAFF) {
    // Team threads are genuinely two-way in-app -- always IN_APP/OUTBOUND
    // (authorUserId is what actually distinguishes sides on render).
    if (body.channel !== undefined && body.channel !== MessageChannel.IN_APP) {
      return res.status(400).json({ error: "Staff conversations only support the IN_APP channel" });
    }
    if (body.direction !== undefined && body.direction !== MessageDirection.OUTBOUND) {
      return res.status(400).json({ error: "Staff conversations only support OUTBOUND direction" });
    }
    channel = MessageChannel.IN_APP;
    direction = MessageDirection.OUTBOUND;
  } else {
    if (!VALID_CHANNELS.includes(body.channel)) {
      return res.status(400).json({ error: `channel must be one of: ${VALID_CHANNELS.join(", ")}` });
    }
    if (!VALID_DIRECTIONS.includes(body.direction)) {
      return res.status(400).json({ error: `direction must be one of: ${VALID_DIRECTIONS.join(", ")}` });
    }
    channel = body.channel;
    direction = body.direction;
  }

  const bodyText = typeof body.body === "string" ? body.body.trim() : "";
  const attachments = body.attachments !== undefined ? body.attachments : undefined;

  if (attachments !== undefined && attachments !== null && !isStringArray(attachments)) {
    return res.status(400).json({ error: "attachments must be an array of strings" });
  }

  if (bodyText.length === 0 && (!attachments || attachments.length === 0)) {
    return res.status(400).json({ error: "body or attachments is required" });
  }

  const now = new Date();

  const [message] = await prisma.$transaction([
    prisma.message.create({
      data: {
        studioId,
        conversationId: id,
        channel,
        direction,
        body: bodyText,
        attachments: attachments && attachments.length > 0 ? attachments : undefined,
        authorUserId: userId,
        createdAt: now,
      },
      include: { author: { select: { id: true, name: true, email: true } } },
    }),
    prisma.conversation.update({ where: { id }, data: { lastMessageAt: now } }),
  ]);

  await logAudit({
    studioId,
    actorUserId: userId,
    entityType: "Message",
    entityId: message.id,
    action: "create",
    changes: { conversationId: id, channel, direction },
  });

  res.status(201).json(message);
});

// Deliberately NOT audited: reading a thread happens on every open and
// carries no business meaning, same exception as nav-counts' seen-marking.
router.post("/:id/read", async (req, res) => {
  const id = req.params.id as string;
  const { studioId, userId, role } = req.user!;

  const conversation = await prisma.conversation.findUnique({ where: { id } });
  if (!conversation || !canViewConversation(conversation, studioId, userId, role)) {
    return res.status(404).json({ error: "Conversation not found" });
  }

  await prisma.conversationRead.upsert({
    where: { conversationId_userId: { conversationId: id, userId } },
    update: { lastReadAt: new Date() },
    create: { conversationId: id, userId, lastReadAt: new Date() },
  });

  res.status(204).send();
});

export default router;
