import { prisma } from "./prisma";
import { IntegrationChannel, IntegrationStatus, MessageChannel, MessageDirection } from "../../generated/prisma/enums";
import { decryptSecret } from "./secrets";
import { sendGmailMessage, getValidAccessToken, getRfc822MessageId } from "./gmail";
import { logAudit } from "./audit";
import { emitInvalidation } from "./realtime/registry";

// Send-channel picker + email as a client channel. Same three-layer shape
// as clientSms.ts (createOutboundSmsMessage -> sendSmsMessage ->
// sendClientSms), copied rather than shared -- two near-identical private
// helpers for two different channels is fine, matching this codebase's own
// existing precedent of not forcing an abstraction over two call sites.
async function createOutboundEmailMessage(params: {
  studioId: string;
  conversationId: string;
  subject: string;
  body: string;
  actorUserId: string | null;
  metadata: { deliveryStatus: string; via: "gmail" | "platform"; error?: string };
}) {
  const { studioId, conversationId, subject, body, actorUserId, metadata } = params;
  const now = new Date();
  const message = await prisma.$transaction(async (tx) => {
    const created = await tx.message.create({
      data: {
        studioId,
        conversationId,
        channel: MessageChannel.EMAIL,
        direction: MessageDirection.OUTBOUND,
        body,
        authorUserId: actorUserId,
        metadata: { ...metadata, subject },
        createdAt: now,
      },
    });
    await tx.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: now, archivedAt: null, archivedById: null },
    });
    return created;
  });

  emitInvalidation({ type: "conversation.updated", studioId, conversationId });
  return message;
}

// Platform-level sender: the same Bird API sendPlatformEmail already
// proved works ("CONFIRMED WORKING... real send, HTTP 202" -- see that
// file's own comment), but NOT that function itself -- its own comment
// explicitly says not to extend it toward per-studio/client-facing use
// (fixed sender address, no reply-to, account-notification copy only).
// This is a separate, parallel low-level call: a studio-branded `from`
// display name and an optional reply-to, on the same platform-wide
// BIRD_API_KEY/sending domain -- no per-studio connection, which is the
// entire point (works for every studio, not just ones with Gmail
// connected).
const PLATFORM_SENDER_ADDRESS = "accounts@mail.inkmanager.app";

async function sendViaBirdOnBehalfOfStudio(params: {
  studioName: string;
  replyTo: string | null;
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<{ messageId: string }> {
  const apiKey = process.env.BIRD_API_KEY;
  if (!apiKey) {
    throw new Error("Platform email is not configured (BIRD_API_KEY)");
  }

  const region = process.env.BIRD_REGION || "us1";
  const response = await fetch(`https://${region}.platform.bird.com/v1/email/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `${params.studioName} via Ink Manager <${PLATFORM_SENDER_ADDRESS}>`,
      to: [params.to],
      subject: params.subject,
      text: params.text,
      html: params.html,
      // Empirically confirmed live (REPORT.md): Bird's API wants reply_to
      // as an array of strings, not a bare string -- rejected with
      // E01001 "got string, want array" on the first real send attempt.
      // The `from` display-name-plus-angle-bracket format, by contrast,
      // was accepted without complaint.
      ...(params.replyTo ? { reply_to: [params.replyTo] } : {}),
    }),
  });

  if (!response.ok) {
    const responseText = await response.text().catch(() => "");
    throw new Error(`Bird send failed (${response.status}): ${responseText}`);
  }

  const data = (await response.json().catch(() => null)) as { id?: string } | null;
  return { messageId: data?.id ?? "unknown" };
}

export type SendClientEmailResult =
  | { sent: true; messageId: string }
  | { sent: false; reason: "no_email" | "send_failed"; error?: string };

// Client-facing entry point -- mirrors sendClientSms's own shape exactly.
// Resolution order: this studio's own connected Gmail first (real two-way
// threading, already proven in routes/conversations.ts) when connected;
// the platform Bird sender otherwise (no per-studio setup required, so
// every studio gets a working email channel regardless of whether they
// ever visit Settings). Callers never need to know or care which
// mechanism actually ran.
export async function sendClientEmail(params: {
  studioId: string;
  clientId: string;
  conversationId: string;
  subject: string;
  bodyText: string;
  bodyHtml: string;
  actorUserId: string | null;
  // See sendSmsMessage's own comment (clientSms.ts) on this flag -- same
  // "log every attempt, including a clean failure" contract, opt-in per
  // caller for the same reasons.
  logAttemptEvenOnFailure?: boolean;
}): Promise<SendClientEmailResult> {
  const { studioId, clientId, conversationId, subject, bodyText, bodyHtml, actorUserId, logAttemptEvenOnFailure } = params;

  async function failed(reason: "send_failed", error?: string): Promise<SendClientEmailResult> {
    if (logAttemptEvenOnFailure) {
      await createOutboundEmailMessage({
        studioId,
        conversationId,
        subject,
        body: bodyText,
        actorUserId,
        metadata: { deliveryStatus: "failed", via: "platform", ...(error ? { error } : {}) },
      });
    }
    return { sent: false, reason, error };
  }

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    include: { emails: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }], take: 1 } },
  });
  // Legacy-singular bug fix (validation pass, live-reproduced): same gap
  // sendClientSms's own comment describes, for email -- Client.email can
  // drift null even when a real ClientEmail row exists (POST /:id/emails'
  // own write-path gap, now fixed, but this falls back regardless so an
  // already-drifted client isn't wrongly refused).
  const resolvedEmail = client?.email ?? client?.emails[0]?.email ?? null;
  if (!resolvedEmail) {
    return { sent: false, reason: "no_email" };
  }

  const integration = await prisma.studioIntegration.findUnique({
    where: { studioId_channel: { studioId, channel: IntegrationChannel.EMAIL } },
  });

  if (integration?.status === IntegrationStatus.CONNECTED && integration.encryptedSecret) {
    const metadata = (integration.metadata as { emailAddress?: string } | null) ?? {};
    if (metadata.emailAddress) {
      try {
        const refreshToken = decryptSecret(integration.encryptedSecret);
        const accessToken = await getValidAccessToken(studioId, refreshToken);
        const sendResult = await sendGmailMessage({
          accessToken,
          from: metadata.emailAddress,
          to: resolvedEmail,
          subject,
          body: bodyText,
        });
        const rfc822MessageId = await getRfc822MessageId(accessToken, sendResult.id);

        const message = await createOutboundEmailMessage({
          studioId,
          conversationId,
          subject,
          body: bodyText,
          actorUserId,
          metadata: { deliveryStatus: "sent", via: "gmail" },
        });
        // rfc822MessageId/gmailThreadId aren't part of the shared metadata
        // shape createOutboundEmailMessage writes (that shape is common to
        // both the Gmail and platform paths) -- a second, targeted update
        // adds them only for this path, same as routes/conversations.ts's
        // own composer send already does for a reply's own threading.
        await prisma.message.update({
          where: { id: message.id },
          data: {
            metadata: {
              deliveryStatus: "sent",
              via: "gmail",
              subject,
              gmailMessageId: sendResult.id,
              gmailThreadId: sendResult.threadId,
              rfc822MessageId,
            },
          },
        });

        await logAudit({
          studioId,
          actorUserId,
          entityType: "Message",
          entityId: message.id,
          action: "email_sent",
          changes: { conversationId, gmailMessageId: sendResult.id },
        });

        return { sent: true, messageId: message.id };
      } catch (err) {
        const errMessage = err instanceof Error ? err.message : "Gmail send failed";
        return failed("send_failed", errMessage);
      }
    }
  }

  const studio = await prisma.studio.findUnique({ where: { id: studioId }, select: { name: true } });
  const primaryLocation = await prisma.location.findFirst({ where: { studioId }, select: { email: true } });

  try {
    const result = await sendViaBirdOnBehalfOfStudio({
      studioName: studio?.name ?? "Your studio",
      replyTo: primaryLocation?.email ?? null,
      to: resolvedEmail,
      subject,
      text: bodyText,
      html: bodyHtml,
    });

    const message = await createOutboundEmailMessage({
      studioId,
      conversationId,
      subject,
      body: bodyText,
      actorUserId,
      metadata: { deliveryStatus: "sent", via: "platform" },
    });

    await logAudit({
      studioId,
      actorUserId,
      entityType: "Message",
      entityId: message.id,
      action: "email_sent",
      changes: { conversationId, birdMessageId: result.messageId },
    });

    return { sent: true, messageId: message.id };
  } catch (err) {
    const errMessage = err instanceof Error ? err.message : "Email send failed";
    return failed("send_failed", errMessage);
  }
}
