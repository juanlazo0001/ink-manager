import { prisma } from "./prisma";
import { ConversationType, Role } from "../../generated/prisma/enums";
import type { Prisma } from "../../generated/prisma/client";
import type { AuthPayload } from "../middleware/auth";
import { logAudit } from "./audit";
import { hasPermission } from "./permissions";
import { effectiveRoleAt, rolesByStudioForCaller } from "./artistAccess";

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
//
// Solo-guest fix: self-contained (takes the caller, not a pre-resolved
// studioId list) and builds one clause GROUP PER STUDIO, each evaluated
// with that studio's own role and that studio's own permission flags --
// never one role/one flags pair applied uniformly across every studio the
// caller can see. A flat approach broke exactly for a solo OWNER-with-
// Artist-profile: their home flags (OWNER always sees both thread types)
// would have leaked into a GUEST studio's clause too, potentially
// surfacing that host's private staff 1:1s/groups even where the host's
// OWN ARTIST matrix denies conversations.viewStaffThreads. Every active
// guest studio is always governed by Role.ARTIST (rolesByStudioForCaller),
// exactly like effectiveRoleAt/hasPermissionAt -- staff roles never travel.
export async function visibleConversationWhere(
  user: Pick<AuthPayload, "studioId" | "role" | "userId">,
): Promise<Prisma.ConversationWhereInput> {
  const rolesByStudio = await rolesByStudioForCaller(user);

  const groups = await Promise.all(
    [...rolesByStudio].map(async ([studioId, role]) => {
      const flags = await getConversationVisibilityFlags(studioId, role);
      const clauses: Prisma.ConversationWhereInput[] = [];

      if (flags.canViewClientThreads) {
        clauses.push({ type: ConversationType.CLIENT });
      }

      if (flags.canViewStaffThreads) {
        if (role === Role.ARTIST) {
          // "-own" scoping stays in effect regardless of the toggle -- an
          // artist's staff-thread visibility is always just their own 1:1
          // thread plus any GROUP thread they've been added to, never
          // another staff member's.
          clauses.push(
            { type: ConversationType.STAFF, staffUserId: user.userId },
            { type: ConversationType.GROUP, participants: { some: { userId: user.userId } } },
          );
        } else {
          clauses.push({ type: ConversationType.STAFF }, { type: ConversationType.GROUP });
        }
      }

      const group: Prisma.ConversationWhereInput | null = clauses.length > 0 ? { studioId, OR: clauses } : null;
      return group;
    }),
  );

  const nonEmptyGroups = groups.filter((g): g is Prisma.ConversationWhereInput => g !== null);

  // No studio has either toggle on -- matches nothing, rather than falling
  // back to an unfiltered `{ studioId: { in: [...] } }` that would
  // silently ignore both flags everywhere.
  if (nonEmptyGroups.length === 0) return { id: "__no_visible_conversations__" };

  return { OR: nonEmptyGroups };
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
): Promise<boolean> {
  // Artist mobility bug fix, solo-guest fix: the caller's EFFECTIVE role AT
  // the conversation's own studio -- HOME or active GUEST membership, and
  // never the caller's raw global role once resolved. A guest artist's own
  // staff thread at their guest studio was otherwise unreachable even via
  // a direct link/notification (the original artist-mobility fix); a solo
  // OWNER's own global role must not leak OWNER-level staff-thread
  // visibility into a studio they only guest at (this fix).
  const effectiveRole = await effectiveRoleAt({ studioId, role, userId }, conversation.studioId);
  if (!effectiveRole) return false;

  // Flags re-derived fresh against the CONVERSATION's own studio and the
  // caller's effective role there -- never the once-per-request flags
  // computed against the caller's home, which would otherwise apply a
  // solo OWNER's home-granted visibility to a guest studio's own,
  // possibly-stricter ARTIST matrix.
  const flags = await getConversationVisibilityFlags(conversation.studioId, effectiveRole);

  if (conversation.type === ConversationType.CLIENT) {
    return flags.canViewClientThreads;
  }

  if (!flags.canViewStaffThreads) return false;

  if (effectiveRole === Role.ARTIST) {
    if (conversation.type === ConversationType.STAFF) return conversation.staffUserId === userId;
    if (conversation.type === ConversationType.GROUP) {
      return (conversation.participants ?? []).some((p) => p.userId === userId);
    }
    return false;
  }

  return true;
}

// "Not authored by me", written NULL-safely -- see NOT_AUTHORED_BY's own
// comment for why the obvious form is wrong.
function notAuthoredBy(userId: string) {
  return { OR: [{ authorUserId: null }, { authorUserId: { not: userId } }] };
}

// Messages after the user's own lastReadAt (or all messages if they've
// never read this thread), excluding messages that user themselves
// authored -- your own message is never "unread" to you.
//
// The author predicate goes through notAuthoredBy above rather than the
// obvious `authorUserId: { not: userId }`, and the difference was a real,
// user-visible bug for every inbound client text.
//
// Message.authorUserId is NULLABLE, and Prisma compiles `not:` on it to a
// bare `"authorUserId" <> $1`. Under SQL's three-valued logic that is
// UNKNOWN -- not TRUE -- for a NULL row, so NULL rows are silently
// EXCLUDED. An inbound SMS is written by the Twilio webhook with
// authorUserId null (nobody was logged in to author it), so an arriving
// text was never counted unread: no gutter dot, nothing in the UNREAD
// filter, no badge. Confirmed against the emitted SQL, not inferred.
export async function getUnreadCountForConversation(conversationId: string, userId: string): Promise<number> {
  const read = await prisma.conversationRead.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
  });

  return prisma.message.count({
    where: {
      conversationId,
      ...notAuthoredBy(userId),
      ...(read ? { createdAt: { gt: read.lastReadAt } } : {}),
    },
  });
}

// Count of CONVERSATIONS (not messages) with at least one unread message,
// for the nav bubble -- a deliberately different strategy from the
// created-after-seen sections in navCounts.ts (see the section-strategy
// pattern there).
//
// MUTE-AWARE, and its sibling above deliberately is not. The rule, from
// the pin/mute work: a mute suppresses the INTERRUPTION, not the
// INDICATOR.
//
//   getUnreadCountForConversation  -> the row's own dot. An INDICATOR.
//                                     Keeps accruing while muted, so a
//                                     muted thread still visibly has
//                                     something new. Mute-BLIND.
//   getUnreadConversationCount     -> the nav/tab badge. An INTERRUPTION
//                                     surface, same category as push.
//                                     Mute-AWARE, here.
//
// Muting a thread and then watching the badge keep climbing is the exact
// experience that makes people stop trusting a badge -- and apps/mobile
// had already worked around this endpoint client-side for that reason
// (lib/chatUnread.ts computes its own mute-excluding count from the list
// payload precisely because this function "never touches
// UserConversationState"). This is that fix, on the server, where it
// belongs.
export async function getUnreadConversationCount(studioId: string, userId: string, role: Role): Promise<number> {
  const conversations = await prisma.conversation.findMany({
    where: {
      ...(await visibleConversationWhere({ studioId, role, userId })),
      // Folded into the query that was already being made, rather than a
      // second pass or a per-row lookup -- same one-query-for-the-page
      // discipline as the batched viewerState in the list payload.
      //
      // NULL-safe by construction, which is why it is `none:` on a
      // forward-looking instant rather than a comparison on a value that
      // might not exist. All three "not muted" states fail to match the
      // inner filter and therefore satisfy `none`:
      //   - no UserConversationState row at all (the common case)
      //   - a row with mutedUntil null (pinned but never muted)
      //   - a row whose mutedUntil is in the past (a lapsed mute)
      // Only a mute genuinely in the future matches, and excludes.
      //
      // Scoped to `userId` INSIDE the filter: mute is per-person, so a
      // colleague muting a thread must never quiet this caller's badge.
      viewerStates: { none: { userId, mutedUntil: { gt: new Date() } } },
    },
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
          // Same NULL-safe predicate as getUnreadCountForConversation --
          // these two must agree, or the nav bubble and the per-thread
          // dot disagree about the same message.
          ...notAuthoredBy(userId),
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
