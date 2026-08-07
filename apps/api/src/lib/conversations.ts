import { prisma } from "./prisma";
import { ConversationType, Role } from "../../generated/prisma/enums";
import type { Prisma } from "../../generated/prisma/client";
import { logAudit } from "./audit";
import { hasPermission } from "./permissions";
import { callerBelongsToStudio, activeStudioIdsForCaller } from "./artistAccess";

// Computed ONCE per request (see routes/conversations.ts's own middleware)
// rather than re-derived inside visibleConversationWhere/canViewConversation
// on every call -- both are called many times per request (once per
// single-thread route, plus the list route), and hasPermission is a DB
// round-trip; passing the already-resolved flags through keeps those
// functions synchronous and cheap, matching how they worked before this
// expansion made thread-type visibility configurable.
export interface ConversationVisibilityFlags {
  canViewClientThreads: boolean;
  canViewStaffThreads: boolean;
}

export async function getConversationVisibilityFlags(
  studioId: string,
  role: Role,
): Promise<ConversationVisibilityFlags> {
  const [canViewClientThreads, canViewStaffThreads] = await Promise.all([
    hasPermission(studioId, role, "conversations.viewClientThreads"),
    hasPermission(studioId, role, "conversations.viewStaffThreads"),
  ]);
  return { canViewClientThreads, canViewStaffThreads };
}

// Front desk was always the intermediary between clients and artists --
// artists never saw client threads, only their own staff thread; OWNER/
// FRONT_DESK saw everything in the studio (the shared-inbox decision).
// That's now expressed as two independently-toggleable permissions
// (conversations.viewClientThreads/viewStaffThreads) instead of a fixed
// rule, but OWNER's own unconditional access and ARTIST's "-own" scoping
// on STAFF/GROUP threads are unchanged -- flags just gates whether each
// thread-type clause is included at all.
// studioIds: every studio the caller has a live relationship with (HOME +
// active GUESTs for an ARTIST, just their one studio for staff -- see
// activeStudioIdsForCaller). Artist mobility bug fix: this used to take a
// single studioId (always the caller's HOME), so a guest artist's own
// STAFF/GROUP thread living under a GUEST studio's Conversation.studioId
// never matched at all -- invisible on their own list, permanently.
export function visibleConversationWhere(
  studioIds: string[],
  userId: string,
  role: Role,
  flags: ConversationVisibilityFlags,
): Prisma.ConversationWhereInput {
  const clauses: Prisma.ConversationWhereInput[] = [];

  if (flags.canViewClientThreads) {
    clauses.push({ type: ConversationType.CLIENT });
  }

  if (flags.canViewStaffThreads) {
    if (role === Role.ARTIST) {
      // "-own" scoping stays in effect regardless of the toggle -- an
      // artist's staff-thread visibility is always just their own 1:1
      // thread plus any GROUP thread they've been added to, never another
      // staff member's.
      clauses.push(
        { type: ConversationType.STAFF, staffUserId: userId },
        { type: ConversationType.GROUP, participants: { some: { userId } } },
      );
    } else {
      clauses.push({ type: ConversationType.STAFF }, { type: ConversationType.GROUP });
    }
  }

  // Neither toggle is on -- matches nothing, rather than falling back to
  // an unfiltered { studioId } that would silently ignore both flags.
  if (clauses.length === 0) return { studioId: { in: studioIds }, id: "__no_visible_conversations__" };

  return { studioId: { in: studioIds }, OR: clauses };
}

export async function canViewConversation(
  conversation: {
    studioId: string;
    type: ConversationType;
    staffUserId: string | null;
    participants?: { userId: string }[];
  },
  studioId: string,
  userId: string,
  role: Role,
  flags: ConversationVisibilityFlags,
): Promise<boolean> {
  // Artist mobility bug fix: HOME or active GUEST membership at the
  // CONVERSATION's own studio, not a plain equality against the caller's
  // home studioId -- a guest artist's own staff thread at their guest
  // studio was otherwise unreachable even via a direct link/notification.
  if (!(await callerBelongsToStudio({ studioId, role, userId }, conversation.studioId))) return false;

  if (conversation.type === ConversationType.CLIENT) {
    return flags.canViewClientThreads;
  }

  if (!flags.canViewStaffThreads) return false;

  if (role === Role.ARTIST) {
    if (conversation.type === ConversationType.STAFF) return conversation.staffUserId === userId;
    if (conversation.type === ConversationType.GROUP) {
      return (conversation.participants ?? []).some((p) => p.userId === userId);
    }
    return false;
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
  // hasPermission (inside getConversationVisibilityFlags) already
  // short-circuits true for OWNER without a DB round-trip, so no separate
  // OWNER case is needed here.
  const flags = await getConversationVisibilityFlags(studioId, role);
  const studioIds = await activeStudioIdsForCaller({ studioId, role, userId });
  const conversations = await prisma.conversation.findMany({
    where: visibleConversationWhere(studioIds, userId, role, flags),
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
// the share-to-artist route, and Phase 7B-2's artist reminder digest,
// which passes null since no staff member drove that creation) that need
// to land a message in a staff member's thread without going through the
// user-facing POST /conversations route -- same idempotent get-or-create
// semantics, just as a function.
export async function getOrCreateStaffConversation(
  studioId: string,
  staffUserId: string,
  actorUserId: string | null,
): Promise<{ conversation: { id: string; archivedAt: Date | null }; created: boolean }> {
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

// Get-or-create for a CLIENT thread, callable from server-side flows (the
// inbound Twilio SMS webhook, since there's no browser request to drive
// POST /conversations for an inbound text) -- same idempotent semantics
// as that route's own inline clientId branch, extracted here so both share
// one implementation. actorUserId is null for a system-triggered create
// (an inbound message from a client isn't "created" by any staff member).
export async function getOrCreateClientConversation(
  studioId: string,
  clientId: string,
  actorUserId: string | null,
): Promise<{ conversation: { id: string }; created: boolean }> {
  const existing = await prisma.conversation.findUnique({ where: { clientId } });
  if (existing) return { conversation: existing, created: false };

  const created = await prisma.conversation.create({
    data: { studioId, type: ConversationType.CLIENT, clientId },
  });

  await logAudit({
    studioId,
    actorUserId,
    entityType: "Conversation",
    entityId: created.id,
    action: "create",
    changes: { type: "CLIENT", clientId },
  });

  return { conversation: created, created: true };
}
