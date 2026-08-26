import { prisma } from "./prisma";
import type { Prisma } from "../../generated/prisma/client";
import { NotificationType, ConversationType, InquiryStatus } from "../../generated/prisma/enums";
import { emitUserInvalidation } from "./realtime/registry";
import { sendExpoPushes, isExpoPushToken, type ExpoPushMessage } from "./expoPush";

// The notification system's one entry point, plus the three v1 emitters
// built on it.
//
// Design rule this whole file follows: a notification is EMITTED FROM THE
// SAME PLACE the existing WebSocket invalidation already fires. Nothing
// here introduces a new definition of "something happened" -- every one of
// the three events below already had a live-update call site, and this
// persists what that call site was previously only broadcasting to
// whoever happened to be connected at that instant.
//
// Three deliveries, in a deliberate order:
//
//   1. the Notification row      -- the durable one; the bell is a feed
//                                   over these, so this must succeed
//   2. emitUserInvalidation      -- the open tab updates now
//   3. Expo push                 -- the phone in a pocket
//
// Only (1) is allowed to fail loudly. (2) and (3) are best-effort and
// swallow their own errors, because a socket that is down or an Expo
// outage must never turn into a failed HTTP response on the message
// somebody was actually trying to send. Same contract emitInvalidation
// and the job runner already hold.

export interface NotifyInput {
  studioId: string;
  /** Recipients. De-duplicated here, and the actor is always dropped. */
  userIds: string[];
  type: NotificationType;
  title: string;
  body: string;
  /** The deep link: what kind of thing to open, and which one. */
  entityType: string;
  entityId: string;
  payload?: Record<string, unknown>;
  /** Who caused it. Never notified about their own action. */
  actorUserId?: string | null;
}

// React Query key prefixes, matching lib/realtime/registry.ts's own
// hand-kept contract with apps/web. ["notifications"] backs the bell feed;
// ["notification-unread"] backs its badge, which is a separate, much
// cheaper query so the badge does not have to load a page of rows.
const NOTIFICATION_KEYS: unknown[][] = [["notifications"], ["notification-unread"]];

export async function notify(input: NotifyInput): Promise<void> {
  const recipients = [...new Set(input.userIds)].filter((id) => id && id !== input.actorUserId);
  if (recipients.length === 0) return;

  await prisma.notification.createMany({
    data: recipients.map((userId) => ({
      studioId: input.studioId,
      userId,
      type: input.type,
      title: input.title,
      body: input.body,
      entityType: input.entityType,
      entityId: input.entityId,
      // Cast, not a looser NotifyInput type: callers should keep writing
      // plain objects. Prisma's Json input union does not accept a bare
      // Record<string, unknown> because `unknown` could be a function or
      // a symbol -- neither of which any caller here passes.
      payload: (input.payload as Prisma.InputJsonObject | undefined) ?? undefined,
      actorUserId: input.actorUserId ?? null,
    })),
  });

  for (const userId of recipients) {
    emitUserInvalidation(userId, NOTIFICATION_KEYS);
  }

  await pushToUsers(recipients, input);
}

// Fire-and-forget in effect: awaited so errors are contained here rather
// than becoming an unhandled rejection, but it can only ever resolve.
async function pushToUsers(userIds: string[], input: NotifyInput): Promise<void> {
  try {
    // pushEnabled governs PUSH ONLY. The rows above are written and the
    // socket fired regardless -- someone who has switched push off still
    // has a correct bell, which is the point of it being one switch and
    // not two.
    const tokens = await prisma.pushToken.findMany({
      where: { userId: { in: userIds }, user: { pushEnabled: true, isActive: true } },
      select: { token: true },
    });
    if (tokens.length === 0) return;

    const messages: ExpoPushMessage[] = tokens
      .map((t) => t.token)
      // A malformed token makes Expo reject the entire chunk it is in,
      // not just that one message -- so one bad row would cost up to 99
      // good pushes. Filtered before it can.
      .filter(isExpoPushToken)
      .map((token) => ({
        to: token,
        title: input.title,
        body: input.body,
        data: {
          type: input.type,
          entityType: input.entityType,
          entityId: input.entityId,
          ...(input.payload ?? {}),
        },
      }));

    const { tickets, deadTokens } = await sendExpoPushes(messages);

    if (tickets.length > 0) {
      // Queued for lib/jobs/pushReceiptCheck.ts -- Expo's send call
      // reports acceptance, never delivery.
      await prisma.pushReceipt.createMany({
        data: tickets.map((t) => ({ ticketId: t.ticketId, token: t.token })),
        skipDuplicates: true,
      });
    }

    if (deadTokens.length > 0) {
      await prisma.pushToken.deleteMany({ where: { token: { in: deadTokens } } });
    }
  } catch (err) {
    console.error("[notifications] push delivery failed", err);
  }
}

// ---------------------------------------------------------------------
// v1 emitters
// ---------------------------------------------------------------------

function truncate(value: string, max = 120): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

function displayName(user: { name: string | null; email: string } | null | undefined): string {
  if (!user) return "Someone";
  return user.name?.trim() || user.email;
}

/**
 * A message was written in a conversation.
 *
 * Who counts as "a conversation you participate in" is the one genuinely
 * open question in v1, and it differs by thread type:
 *
 *   STAFF / GROUP -- unambiguous. The thread has an explicit membership:
 *     staffUser (the person whose 1:1 thread it is) plus every
 *     ConversationParticipant added by an @mention upgrade.
 *
 *   CLIENT -- there is no membership. A client thread is visible to
 *     whoever's permissions let them see it, which at most studios is all
 *     of front desk. Notifying everyone entitled to LOOK at a thread would
 *     mean every inbound client text pushing to the whole studio, which is
 *     how a notification system becomes something people switch off. So:
 *     the artist(s) assigned to that client's live projects, plus anyone
 *     who has actually written in the thread before. Targeted, and matches
 *     "participate in" literally rather than "could read".
 *
 * The author is always dropped, by notify() itself.
 */
export async function notifyMessageCreated(params: {
  conversationId: string;
  messageId: string;
  studioId: string;
  authorUserId: string | null;
  body: string;
  hasAttachments: boolean;
}): Promise<void> {
  const conversation = await prisma.conversation.findUnique({
    where: { id: params.conversationId },
    select: {
      id: true,
      type: true,
      staffUserId: true,
      participants: { select: { userId: true } },
      client: {
        select: {
          firstName: true,
          lastName: true,
          inquiries: {
            where: { status: { notIn: [InquiryStatus.CLOSED_LOST, InquiryStatus.COLD_LEAD, InquiryStatus.TRANSFERRED] } },
            select: { assignedArtist: { select: { userId: true } } },
          },
        },
      },
    },
  });
  if (!conversation) return;

  let recipients: string[];
  let threadLabel: string;

  if (conversation.type === ConversationType.CLIENT) {
    const assignedArtistUserIds = (conversation.client?.inquiries ?? [])
      .map((i) => i.assignedArtist?.userId)
      .filter((id): id is string => !!id);

    // Anyone who has already spoken here. Distinct authors only -- a
    // thread with 400 messages must not mean 400 rows to read.
    const priorAuthors = await prisma.message.findMany({
      where: { conversationId: conversation.id, authorUserId: { not: null } },
      select: { authorUserId: true },
      distinct: ["authorUserId"],
    });

    recipients = [...assignedArtistUserIds, ...priorAuthors.map((m) => m.authorUserId!)];
    threadLabel = `${conversation.client?.firstName ?? ""} ${conversation.client?.lastName ?? ""}`.trim() || "a client";
  } else {
    recipients = [
      ...(conversation.staffUserId ? [conversation.staffUserId] : []),
      ...conversation.participants.map((p) => p.userId),
    ];
    threadLabel = "your team thread";
  }

  const author = params.authorUserId
    ? await prisma.user.findUnique({ where: { id: params.authorUserId }, select: { name: true, email: true } })
    : null;

  // An inbound client message has no author at all -- naming the client
  // rather than "Someone" is the honest rendering there.
  const from = params.authorUserId ? displayName(author) : threadLabel;

  // Mute, applied here rather than inside notify(): muting is a property
  // of a CONVERSATION, and MESSAGE_CREATED is the only type that has one.
  // Putting the filter in the one emitter that can be muted keeps notify()
  // from needing to know what a conversation is.
  //
  // What a mute suppresses, exactly: the Notification row -- and therefore
  // the bell feed entry, the unread badge and the push, all three at once,
  // because all three are that row. What it does NOT suppress is the
  // conversation's own unread count in the thread list
  // (getUnreadCountForConversation, a separate and older mechanism reading
  // ConversationRead). That is the behaviour every messaging app has and
  // the one people expect: the thread still shows it has something new,
  // you just are not interrupted about it. Suppressing that too would make
  // a muted thread indistinguishable from a silent one.
  //
  // Compared at read time against `now`, with no cleanup job: an expired
  // mute simply stops matching, so there is no window in which a lapsed
  // mute still suppresses anything.
  const now = new Date();
  const mutedStates = await prisma.userConversationState.findMany({
    where: { conversationId: conversation.id, userId: { in: recipients }, mutedUntil: { gt: now } },
    select: { userId: true },
  });
  if (mutedStates.length > 0) {
    const muted = new Set(mutedStates.map((m) => m.userId));
    recipients = recipients.filter((id) => !muted.has(id));
    if (recipients.length === 0) return;
  }

  await notify({
    studioId: params.studioId,
    userIds: recipients,
    type: NotificationType.MESSAGE_CREATED,
    title: `New message from ${from}`,
    // attachments is asked directly rather than inferred from an empty
    // body -- inference is wrong for a message carrying BOTH, which is
    // the same mistake both clients' list previews made.
    body: params.body.trim() ? truncate(params.body) : params.hasAttachments ? "Sent an image" : "Sent a message",
    entityType: "Conversation",
    entityId: conversation.id,
    payload: { conversationId: conversation.id, messageId: params.messageId },
    actorUserId: params.authorUserId,
  });
}

/** A project was assigned to an artist. Notifies that artist's user account. */
export async function notifyInquiryAssigned(params: {
  inquiryId: string;
  studioId: string;
  artistId: string;
  actorUserId: string;
}): Promise<void> {
  const [artist, inquiry, actor] = await Promise.all([
    prisma.artist.findUnique({ where: { id: params.artistId }, select: { userId: true } }),
    prisma.inquiry.findUnique({
      where: { id: params.inquiryId },
      select: { description: true, client: { select: { firstName: true, lastName: true } } },
    }),
    prisma.user.findUnique({ where: { id: params.actorUserId }, select: { name: true, email: true } }),
  ]);
  if (!artist || !inquiry) return;

  const clientName = `${inquiry.client.firstName} ${inquiry.client.lastName}`.trim();

  await notify({
    studioId: params.studioId,
    userIds: [artist.userId],
    type: NotificationType.INQUIRY_ASSIGNED,
    title: `${displayName(actor)} assigned you a project`,
    body: clientName ? `${clientName} — ${truncate(inquiry.description, 80)}` : truncate(inquiry.description),
    entityType: "Inquiry",
    entityId: params.inquiryId,
    actorUserId: params.actorUserId,
  });
}

/**
 * A personal task was created with someone else as the assignee.
 *
 * Self-assignment produces nothing: notify() drops the actor from its own
 * recipient list, so a task you make for yourself is silent without this
 * call site needing to check.
 */
export async function notifyTaskAssigned(params: {
  taskId: string;
  studioId: string;
  assigneeUserId: string;
  actorUserId: string;
  title: string;
  dueAt: Date | null;
}): Promise<void> {
  const actor = await prisma.user.findUnique({
    where: { id: params.actorUserId },
    select: { name: true, email: true },
  });

  await notify({
    studioId: params.studioId,
    userIds: [params.assigneeUserId],
    type: NotificationType.TASK_ASSIGNED,
    title: `${displayName(actor)} assigned you a task`,
    body: truncate(params.title),
    entityType: "PersonalTask",
    entityId: params.taskId,
    // dueAt is a calendar DATE written as local midnight (see CLAUDE.md's
    // timezone section) -- passed through as the raw ISO string for the
    // client to render with its own matching helper, never formatted into
    // a sentence here, where there is no viewer whose zone to use.
    payload: params.dueAt ? { dueAt: params.dueAt.toISOString() } : undefined,
    actorUserId: params.actorUserId,
  });
}
