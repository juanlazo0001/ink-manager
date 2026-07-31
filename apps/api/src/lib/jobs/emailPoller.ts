import { prisma } from "../prisma";
import { IntegrationChannel, IntegrationStatus, MessageChannel, MessageDirection } from "../../../generated/prisma/enums";
import { registerJob, type JobDetails } from "./registry";
import { decryptSecret } from "../secrets";
import {
  extractEmailAddress,
  getFullMessage,
  getValidAccessToken,
  listInboxMessagesSince,
  markMessageRead,
} from "../gmail";
import { getOrCreateClientConversation } from "../conversations";
import { findMatchingClientForImportRow } from "../duplicateDetection";
import { generateUniqueReferralCode } from "../referrals";
import { logAudit } from "../audit";
import { emitInvalidation } from "../realtime/registry";

export const EMAIL_POLL_JOB_NAME = "emailInboxPoll";

interface EmailIntegrationMetadata {
  emailAddress?: string;
  tokenExpiresAt?: string;
  lastPolledAt?: string;
}

// Every studio with EMAIL CONNECTED, independently -- one studio's Gmail
// API error (bad/revoked refresh token, rate limit, etc.) never blocks
// another studio's poll, matching coldLeadSweep/reminderTicker's own
// per-studio isolation.
async function run(scheduledFor: Date): Promise<JobDetails> {
  const integrations = await prisma.studioIntegration.findMany({
    where: { channel: IntegrationChannel.EMAIL, status: IntegrationStatus.CONNECTED },
  });

  let studiosProcessed = 0;
  let messagesImported = 0;
  let clientsCreated = 0;
  let studioErrors = 0;

  for (const integration of integrations) {
    studiosProcessed += 1;
    if (!integration.encryptedSecret) continue;

    const metadata = (integration.metadata as EmailIntegrationMetadata | null) ?? {};
    const emailAddress = metadata.emailAddress;
    if (!emailAddress) continue;

    // Small backward buffer against clock skew / query-boundary edge cases
    // -- harmless to err wide here since gmailMessageId dedup below makes
    // re-seeing an already-imported message from the overlap a no-op. First
    // poll ever for a studio starts from connect time (set when the
    // integration was connected), not "all history."
    const sinceMs = metadata.lastPolledAt ? new Date(metadata.lastPolledAt).getTime() : scheduledFor.getTime();
    const afterEpochSeconds = Math.floor(sinceMs / 1000) - 120;

    let refreshToken: string;
    try {
      refreshToken = decryptSecret(integration.encryptedSecret);
    } catch {
      studioErrors += 1;
      continue;
    }

    let accessToken: string;
    try {
      accessToken = await getValidAccessToken(integration.studioId, refreshToken);
    } catch {
      studioErrors += 1;
      continue;
    }

    let candidates: { id: string; threadId: string }[];
    try {
      candidates = await listInboxMessagesSince(accessToken, afterEpochSeconds);
    } catch {
      studioErrors += 1;
      continue;
    }

    for (const { id: gmailMessageId } of candidates) {
      // Idempotency: a re-poll (or an overlapping window from the backward
      // buffer above) must never create a duplicate message.
      const existing = await prisma.message.findFirst({
        where: { studioId: integration.studioId, metadata: { path: ["gmailMessageId"], equals: gmailMessageId } },
      });
      if (existing) continue;

      let full;
      try {
        full = await getFullMessage(accessToken, gmailMessageId);
      } catch {
        studioErrors += 1;
        continue;
      }

      const fromEmail = extractEmailAddress(full.from);
      // No parseable sender, or a message this same connected account sent
      // to itself (shouldn't normally appear under in:inbox for our own
      // sends, but cheap to guard regardless) -- nothing to import.
      if (!fromEmail || fromEmail.toLowerCase() === emailAddress.toLowerCase()) continue;

      // Reuses the exact same phone/email matching rule the per-client
      // "potential duplicates" banner and mass-import both use --
      // lib/duplicateDetection.ts, not a separately-written lookup here.
      const matched = await findMatchingClientForImportRow(integration.studioId, null, fromEmail);
      let clientId: string;

      if (matched) {
        clientId = matched.id;
      } else {
        const created = await prisma.client.create({
          data: {
            studioId: integration.studioId,
            firstName: "Unknown",
            lastName: "(new email contact)",
            email: fromEmail,
            referralCode: await generateUniqueReferralCode(),
          },
        });
        await prisma.clientEmail.create({ data: { clientId: created.id, email: fromEmail, isPrimary: true } });
        await logAudit({
          studioId: integration.studioId,
          actorUserId: null,
          entityType: "Client",
          entityId: created.id,
          action: "create",
          changes: { source: "inbound_email", email: fromEmail },
        });
        clientId = created.id;
        clientsCreated += 1;
      }

      const { conversation } = await getOrCreateClientConversation(integration.studioId, clientId, null);

      const now = new Date();
      const message = await prisma.$transaction(async (tx) => {
        const createdMessage = await tx.message.create({
          data: {
            studioId: integration.studioId,
            conversationId: conversation.id,
            channel: MessageChannel.EMAIL,
            direction: MessageDirection.INBOUND,
            body: full.plainTextBody,
            authorUserId: null,
            metadata: {
              subject: full.subject,
              gmailMessageId,
              gmailThreadId: full.threadId,
              rfc822MessageId: full.rfc822MessageId,
            },
            createdAt: now,
          },
        });
        await tx.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: now } });
        return createdMessage;
      });

      await logAudit({
        studioId: integration.studioId,
        actorUserId: null,
        entityType: "Message",
        entityId: message.id,
        action: "email_received",
        changes: { conversationId: conversation.id, gmailMessageId, subject: full.subject },
      });

      // Real-time audit (Part 2): same gap as the inbound-SMS webhook -- a
      // background job, not a staff action, so nothing else in the app
      // would ever tell a connected client this message arrived.
      emitInvalidation({ type: "conversation.updated", studioId: integration.studioId, conversationId: conversation.id });

      // Best-effort inbox hygiene, not the correctness mechanism (see
      // lib/gmail.ts's own comment on markMessageRead) -- a failure here
      // never rolls back or re-flags the already-imported message.
      await markMessageRead(accessToken, gmailMessageId).catch(() => {});

      messagesImported += 1;
    }

    await prisma.studioIntegration.update({
      where: { id: integration.id },
      data: { metadata: { ...metadata, lastPolledAt: scheduledFor.toISOString() } },
    });
  }

  return { studiosProcessed, messagesImported, clientsCreated, studioErrors };
}

registerJob({
  name: EMAIL_POLL_JOB_NAME,
  description: "Polls each studio's connected Gmail inbox for new messages and imports them into the matching client's conversation.",
  schedule: "*/5 * * * *",
  slotMinutes: 5,
  run,
});
