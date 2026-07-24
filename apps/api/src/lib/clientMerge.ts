import type { Prisma } from "../../generated/prisma/client";
import { prisma } from "./prisma";

// Every model with a direct clientId FK -- re-enumerate this on future
// schema changes rather than assuming the list below stays complete.
// (DepositForm relates via Inquiry, not Client directly, so it moves for
// free when Inquiry does and doesn't need its own re-point here.)
export async function repointClientRelations(tx: Prisma.TransactionClient, sourceId: string, survivorId: string) {
  const [appointments, inquiries, giftCards] = await Promise.all([
    tx.appointment.updateMany({ where: { clientId: sourceId }, data: { clientId: survivorId } }),
    tx.inquiry.updateMany({ where: { clientId: sourceId }, data: { clientId: survivorId } }),
    tx.giftCard.updateMany({ where: { clientId: sourceId }, data: { clientId: survivorId } }),
  ]);

  return {
    Appointment: appointments.count,
    Inquiry: inquiries.count,
    GiftCard: giftCards.count,
  };
}

// Conversation.clientId is unique (one thread per client, ever) so it
// can't be handled by the blind updateMany in repointClientRelations above
// -- if the survivor already has its own thread, re-pointing the source's
// thread onto the same clientId would violate that constraint and blow up
// the whole merge transaction. Handled as its own step instead:
//   - source has no thread: nothing to do.
//   - only source has a thread: simple re-point.
//   - both have one: fold the source thread's messages into the survivor's
//     thread (so nothing is lost), merge per-user read state (keep the
//     more recent lastReadAt), then delete the now-empty source thread.
export async function mergeConversations(
  tx: Prisma.TransactionClient,
  sourceClientId: string,
  survivorClientId: string,
): Promise<{ merged: boolean; movedMessages: number }> {
  const [sourceConversation, survivorConversation] = await Promise.all([
    tx.conversation.findUnique({ where: { clientId: sourceClientId } }),
    tx.conversation.findUnique({ where: { clientId: survivorClientId } }),
  ]);

  if (!sourceConversation) {
    return { merged: false, movedMessages: 0 };
  }

  if (!survivorConversation) {
    await tx.conversation.update({ where: { id: sourceConversation.id }, data: { clientId: survivorClientId } });
    return { merged: false, movedMessages: 0 };
  }

  const movedMessages = await tx.message.updateMany({
    where: { conversationId: sourceConversation.id },
    data: { conversationId: survivorConversation.id },
  });

  const newestLastMessageAt =
    [sourceConversation.lastMessageAt, survivorConversation.lastMessageAt]
      .filter((d): d is Date => d !== null)
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

  await tx.conversation.update({
    where: { id: survivorConversation.id },
    data: { lastMessageAt: newestLastMessageAt },
  });

  const sourceReads = await tx.conversationRead.findMany({ where: { conversationId: sourceConversation.id } });

  for (const read of sourceReads) {
    const survivorRead = await tx.conversationRead.findUnique({
      where: { conversationId_userId: { conversationId: survivorConversation.id, userId: read.userId } },
    });

    if (survivorRead) {
      if (read.lastReadAt > survivorRead.lastReadAt) {
        await tx.conversationRead.update({ where: { id: survivorRead.id }, data: { lastReadAt: read.lastReadAt } });
      }
      await tx.conversationRead.delete({ where: { id: read.id } });
    } else {
      await tx.conversationRead.update({ where: { id: read.id }, data: { conversationId: survivorConversation.id } });
    }
  }

  await tx.conversation.delete({ where: { id: sourceConversation.id } });

  return { merged: true, movedMessages: movedMessages.count };
}

// Unlike repointClientRelations above, these aren't re-pointed (the
// source keeps its own ClientPhone/ClientEmail rows -- it still exists,
// history stays inspectable there too) -- they're copied onto the
// survivor as secondary aliases, skipping anything already identical on
// the survivor. Reading the source's full ClientPhone/ClientEmail set
// (not just its Client.phone/email scalar) means this also picks up
// aliases the source itself carried over from an earlier merge, so a
// chain of merges never loses a contact along the way. The survivor's
// own primary is never touched here.
export async function carryOverContactAliases(tx: Prisma.TransactionClient, sourceId: string, survivorId: string) {
  const [sourcePhones, survivorPhones, sourceEmails, survivorEmails] = await Promise.all([
    tx.clientPhone.findMany({ where: { clientId: sourceId } }),
    tx.clientPhone.findMany({ where: { clientId: survivorId } }),
    tx.clientEmail.findMany({ where: { clientId: sourceId } }),
    tx.clientEmail.findMany({ where: { clientId: survivorId } }),
  ]);

  const survivorPhoneSet = new Set(survivorPhones.map((p) => p.phone));
  const addedPhones: { phone: string; label: string | null }[] = [];
  for (const p of sourcePhones) {
    if (survivorPhoneSet.has(p.phone)) continue;
    await tx.clientPhone.create({ data: { clientId: survivorId, phone: p.phone, label: p.label, isPrimary: false } });
    survivorPhoneSet.add(p.phone);
    addedPhones.push({ phone: p.phone, label: p.label });
  }

  const survivorEmailSet = new Set(survivorEmails.map((e) => e.email));
  const addedEmails: { email: string; label: string | null }[] = [];
  for (const e of sourceEmails) {
    if (survivorEmailSet.has(e.email)) continue;
    await tx.clientEmail.create({ data: { clientId: survivorId, email: e.email, label: e.label, isPrimary: false } });
    survivorEmailSet.add(e.email);
    addedEmails.push({ email: e.email, label: e.label });
  }

  return { addedPhones, addedEmails };
}

// Soft-merge: the source client survives (marked via mergedIntoId) rather
// than being deleted, so its history stays inspectable. Every FK the
// source held moves to the survivor; nothing about the survivor's own
// fields changes. (Except its secondary contact aliases, which do gain
// the source's phone/email as new entries -- see carryOverContactAliases.)
//
// Shared verbatim by POST /:id/merge (manual merge) and the mass-import
// execute step (Package R, MERGE decisions) -- one real merge
// implementation. The caller validates the pair first (validateMergePair
// below) and writes its own audit entry afterward, since the two callers'
// audit framing (entity/actor) differs slightly.
export async function performMerge(tx: Prisma.TransactionClient, sourceId: string, survivorId: string) {
  const repointCounts = await repointClientRelations(tx, sourceId, survivorId);
  const conversationResult = await mergeConversations(tx, sourceId, survivorId);
  const aliasesAdded = await carryOverContactAliases(tx, sourceId, survivorId);
  await tx.client.update({ where: { id: sourceId }, data: { mergedIntoId: survivorId } });
  return { repointCounts, conversationResult, aliasesAdded };
}

export type MergeValidationResult =
  | { error: string; status: number }
  | { survivor: { id: string; studioId: string; mergedIntoId: string | null }; source: { id: string; studioId: string; mergedIntoId: string | null; firstName: string; lastName: string } };

// Every precondition POST /:id/merge already enforced, extracted so the
// mass-import execute step (Package R) enforces the identical set rather
// than a hand-rolled subset of it.
export async function validateMergePair(
  studioId: string,
  survivorId: string,
  sourceClientId: string,
): Promise<MergeValidationResult> {
  if (sourceClientId === survivorId) {
    return { error: "A client cannot be merged with itself", status: 400 };
  }

  const [survivor, source] = await Promise.all([
    prisma.client.findUnique({ where: { id: survivorId } }),
    prisma.client.findUnique({ where: { id: sourceClientId } }),
  ]);

  if (!survivor || survivor.studioId !== studioId) {
    return { error: "Client not found", status: 404 };
  }

  if (!source || source.studioId !== studioId) {
    return { error: "Source client not found", status: 404 };
  }

  if (survivor.mergedIntoId) {
    return { error: "The survivor client has itself already been merged into another client", status: 400 };
  }

  if (source.mergedIntoId) {
    return { error: "The source client has already been merged", status: 400 };
  }

  return { survivor, source };
}
