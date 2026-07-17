import { prisma } from "../prisma";
import { MessageDirection } from "../../../generated/prisma/enums";
import { type SystemTask, type TaskSource } from "./types";

// Unlike the other four sources, this one genuinely depends on the
// requesting user (unread-ness is per-user) -- see the widened TaskSource
// signature in types.ts. Only ever surfaces CLIENT conversations in
// practice: STAFF-thread messages are always OUTBOUND (see conversations.ts),
// so a STAFF thread's latest message can never be INBOUND.
async function fetch(studioId: string, userId: string): Promise<SystemTask[]> {
  const conversations = await prisma.conversation.findMany({
    where: { studioId },
    include: {
      client: { select: { firstName: true, lastName: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  if (conversations.length === 0) return [];

  const reads = await prisma.conversationRead.findMany({
    where: { userId, conversationId: { in: conversations.map((c) => c.id) } },
  });
  const readMap = new Map(reads.map((r) => [r.conversationId, r.lastReadAt]));

  const tasks: SystemTask[] = [];

  for (const conversation of conversations) {
    const lastMessage = conversation.messages[0];
    if (!lastMessage || lastMessage.direction !== MessageDirection.INBOUND) continue;

    const lastReadAt = readMap.get(conversation.id);
    if (lastReadAt && lastReadAt >= lastMessage.createdAt) continue;

    const counterpartName = conversation.client
      ? `${conversation.client.firstName} ${conversation.client.lastName}`
      : "Unknown";

    tasks.push({
      type: "NEW_CONVERSATION",
      title: `New message from ${counterpartName}`,
      entityType: "Conversation",
      entityId: conversation.id,
      // Folds lastMessageAt in, same pattern as ESTIMATE_FOLLOWUP: a
      // *newer* unread message is a new business event and should resurface
      // even if an older unread state on this same conversation was
      // dismissed.
      dismissalKey: `${conversation.id}:${lastMessage.createdAt.toISOString()}`,
      deepLink: `/conversations/${conversation.id}`,
      actionableAt: lastMessage.createdAt,
    });
  }

  return tasks;
}

export const newConversationSource: TaskSource = { type: "NEW_CONVERSATION", label: "New client messages", fetch };
