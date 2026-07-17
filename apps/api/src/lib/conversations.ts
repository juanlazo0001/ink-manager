import { prisma } from "./prisma";
import { ConversationType, Role } from "../../generated/prisma/enums";
import type { Prisma } from "../../generated/prisma/client";
import { logAudit } from "./audit";

// Front desk is always the intermediary between clients and artists --
// artists never see client threads, only their own staff thread. OWNER/
// FRONT_DESK see everything in the studio (the shared-inbox decision).
export function visibleConversationWhere(studioId: string, userId: string, role: Role): Prisma.ConversationWhereInput {
  if (role === Role.ARTIST) {
    return { studioId, type: ConversationType.STAFF, staffUserId: userId };
  }
  return { studioId };
}

export function canViewConversation(
  conversation: { studioId: string; type: ConversationType; staffUserId: string | null },
  studioId: string,
  userId: string,
  role: Role,
): boolean {
  if (conversation.studioId !== studioId) return false;
  if (role === Role.ARTIST) {
    return conversation.type === ConversationType.STAFF && conversation.staffUserId === userId;
  }
  return true;
}

// Messages after the user's own lastReadAt (or all messages if they've
// never read this thread), excluding messages that user themselves
// authored -- your own message is never "unread" to you.
export async function getUnreadCountForConversation(conversationId: string, userId: string): Promise<number> {
  const read = await prisma.conversationRead.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
  });

  return prisma.message.count({
    where: {
      conversationId,
      authorUserId: { not: userId },
      ...(read ? { createdAt: { gt: read.lastReadAt } } : {}),
    },
  });
}

// Count of CONVERSATIONS (not messages) with at least one unread message,
// for the nav bubble -- a deliberately different strategy from the
// created-after-seen sections in navCounts.ts (see the section-strategy
// pattern there).
export async function getUnreadConversationCount(studioId: string, userId: string, role: Role): Promise<number> {
  const conversations = await prisma.conversation.findMany({
    where: visibleConversationWhere(studioId, userId, role),
    select: { id: true },
  });

  if (conversations.length === 0) return 0;

  const reads = await prisma.conversationRead.findMany({
    where: { userId, conversationId: { in: conversations.map((c) => c.id) } },
  });
  const readMap = new Map(reads.map((r) => [r.conversationId, r.lastReadAt]));

  const unreadFlags = await Promise.all(
    conversations.map((conversation) => {
      const lastReadAt = readMap.get(conversation.id);
      return prisma.message.findFirst({
        where: {
          conversationId: conversation.id,
          authorUserId: { not: userId },
          ...(lastReadAt ? { createdAt: { gt: lastReadAt } } : {}),
        },
        select: { id: true },
      });
    }),
  );

  return unreadFlags.filter(Boolean).length;
}

// Get-or-create for a STAFF thread, callable from server-side flows (like
// the share-to-artist route) that need to land a message in a staff
// member's thread without going through the user-facing POST /conversations
// route -- same idempotent get-or-create semantics, just as a function.
export async function getOrCreateStaffConversation(
  studioId: string,
  staffUserId: string,
  actorUserId: string,
): Promise<{ conversation: { id: string }; created: boolean }> {
  const existing = await prisma.conversation.findUnique({ where: { staffUserId } });
  if (existing) return { conversation: existing, created: false };

  const created = await prisma.conversation.create({
    data: { studioId, type: ConversationType.STAFF, staffUserId },
  });

  await logAudit({
    studioId,
    actorUserId,
    entityType: "Conversation",
    entityId: created.id,
    action: "create",
    changes: { type: "STAFF", staffUserId },
  });

  return { conversation: created, created: true };
}
