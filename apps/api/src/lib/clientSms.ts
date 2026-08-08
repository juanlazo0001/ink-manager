import { prisma } from "./prisma";
import { IntegrationChannel, IntegrationStatus, MessageChannel, MessageDirection } from "../../generated/prisma/enums";
import { decryptSecret } from "./secrets";
import { sendSms, type TwilioCredentials } from "./twilio";
import { TWILIO_STATUS_CALLBACK_URL } from "./publicUrl";
import { logAudit } from "./audit";
import { emitInvalidation } from "./realtime/registry";

type SendSmsMessageResult =
  | { sent: true; messageId: string; providerSid: string }
  | { sent: false; reason: "not_connected" | "send_failed"; error?: string };

// Shared by both the real-send success path and the logged-failure path in
// sendSmsMessage below -- same row shape either way (channel SMS,
// direction OUTBOUND), just a different metadata.deliveryStatus/
// providerSid. Centralizing this avoids the message-row-plus-
// conversation-bump-plus-broadcast triplet drifting out of sync between
// the two call sites.
//
// Real-time audit (Part 2): this is the ONE place every outbound SMS this
// app ever sends actually creates its Message row -- the composer's own
// POST /:id/messages route emits this itself for its own direct-send
// path, but every OTHER caller (deposit-form/waiver/estimate auto-sends,
// gift-card text receipts, reminder jobs) previously created this exact
// same row with no broadcast at all, so another staff member watching the
// same client's thread never saw the message appear live. Emitting here,
// in the shared function underlying every one of those callers, closes
// all of them at once instead of one at a time.
async function createOutboundSmsMessage(params: {
  studioId: string;
  conversationId: string;
  body: string;
  actorUserId: string | null;
  replyToId?: string;
  metadata: { providerSid?: string; deliveryStatus: string; error?: string };
}) {
  const { studioId, conversationId, body, actorUserId, replyToId, metadata } = params;
  const now = new Date();
  const message = await prisma.$transaction(async (tx) => {
    const created = await tx.message.create({
      data: {
        studioId,
        conversationId,
        channel: MessageChannel.SMS,
        direction: MessageDirection.OUTBOUND,
        body,
        authorUserId: actorUserId,
        replyToId,
        metadata,
        createdAt: now,
      },
    });
    // New activity un-archives -- see Conversation.archivedAt's own schema
    // comment. Harmless no-op when it wasn't archived.
    await tx.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: now, archivedAt: null, archivedById: null },
    });
    return created;
  });

  emitInvalidation({ type: "conversation.updated", studioId, conversationId });
  return message;
}

// The one real-SMS send path -- the conversation composer, every Part
// 7B-2 client/artist reminder, and the estimate follow-up all go through
// this. By default a Message row is created ONLY on provider acceptance;
// a failed send persists nothing, so a failed attempt looks identical to
// "never tried" from the thread's point of view -- see
// logAttemptEvenOnFailure below for the one deliberate exception.
// Recipient-specific checks (client opted-out/no-phone, artist no-phone)
// live in the two wrapper functions below, not here -- this only knows
// "studio, conversation, phone, body."

async function sendSmsMessage(params: {
  studioId: string;
  conversationId: string;
  toPhone: string;
  body: string;
  actorUserId: string | null;
  // Quoted reply -- purely an internal UI relationship (see the Message
  // model's own replyTo comment), never anything Twilio itself knows
  // about. Only the composer's direct-send path ever actually passes one;
  // reminder jobs/auto-sends never do.
  replyToId?: string;
  // Design intent (REPORT.md: "Conversations logging on sent forms"): a
  // one-shot, user-initiated form/link send (deposit form, waiver,
  // estimate) should surface in Conversations regardless of whether the
  // channel attempt itself succeeded -- staff watching the thread need to
  // know a form was generated and an SMS was ATTEMPTED, even if Twilio
  // rejected it or no integration is connected, since the deposit
  // URL/token still exists and needs to reach the client some other way.
  // Deliberately opt-in, not the new default for every caller of this
  // function: reminderTicker.ts's client-reminder cadence retries the same
  // appointment on every tick until it succeeds or ages out of its window
  // (it never sets the dedup field on a `sent: false` result), so making
  // this unconditional would log a fresh "Not delivered" message into the
  // client's thread on every retry for any studio without SMS connected --
  // real spam, not a fix. Only the deposit-form auto-send call opts in
  // today; see lib/deposits.ts's own comment at its call site.
  logAttemptEvenOnFailure?: boolean;
}): Promise<SendSmsMessageResult> {
  const { studioId, conversationId, toPhone, body, actorUserId, replyToId, logAttemptEvenOnFailure } = params;

  async function failed(reason: "not_connected" | "send_failed", error?: string): Promise<SendSmsMessageResult> {
    if (logAttemptEvenOnFailure) {
      await createOutboundSmsMessage({
        studioId,
        conversationId,
        body,
        actorUserId,
        replyToId,
        // Reuses the exact metadata shape/value ConversationsPanel.tsx's
        // smsStatusLabel already renders as "Not delivered" for a Twilio-
        // reported failure -- no frontend change needed to display this.
        metadata: { deliveryStatus: "failed", ...(error ? { error } : {}) },
      });
    }
    return { sent: false, reason, error };
  }

  const integration = await prisma.studioIntegration.findUnique({
    where: { studioId_channel: { studioId, channel: IntegrationChannel.SMS } },
  });

  if (!integration || integration.status !== IntegrationStatus.CONNECTED || !integration.encryptedSecret) {
    return failed("not_connected");
  }

  const metadata = (integration.metadata as { phoneNumber?: string } | null) ?? {};
  const fromNumber = metadata.phoneNumber;
  if (!fromNumber) {
    return failed("not_connected");
  }

  let credentials: TwilioCredentials;
  try {
    credentials = JSON.parse(decryptSecret(integration.encryptedSecret)) as TwilioCredentials;
  } catch {
    return failed("send_failed", "Stored credentials could not be read");
  }

  const toNumber = `+1${toPhone}`;

  let result;
  try {
    result = await sendSms(credentials, fromNumber, toNumber, body, TWILIO_STATUS_CALLBACK_URL);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Twilio send failed";
    return failed("send_failed", message);
  }

  const message = await createOutboundSmsMessage({
    studioId,
    conversationId,
    body,
    actorUserId,
    replyToId,
    metadata: { providerSid: result.sid, deliveryStatus: result.status },
  });

  await logAudit({
    studioId,
    actorUserId,
    entityType: "Message",
    entityId: message.id,
    action: "sms_sent",
    changes: { conversationId, providerSid: result.sid },
  });

  return { sent: true, messageId: message.id, providerSid: result.sid };
}

export type SendClientSmsResult =
  | { sent: true; messageId: string; providerSid: string }
  | { sent: false; reason: "not_connected" | "no_phone" | "opted_out" | "send_failed"; error?: string };

// Client-facing wrapper: refuses an opted-out or phoneless client before
// ever reaching Twilio, regardless of connection status or what the UI
// happens to show -- this is the actual enforcement point.
//
// bypassOptOutCheck exists for exactly one caller: the inbound HELP-keyword
// auto-reply (routes/webhooks.ts). CTIA/A2P convention (and the task that
// added it) requires HELP to work regardless of current opt-in/opt-out
// status -- it's basic customer service, not a marketing message. Every
// other caller (reminders, composer, opt-in confirmation) leaves this
// false/omitted and gets the normal enforcement.
export async function sendClientSms(params: {
  studioId: string;
  clientId: string;
  conversationId: string;
  body: string;
  actorUserId: string | null;
  bypassOptOutCheck?: boolean;
  replyToId?: string;
  // See sendSmsMessage's own comment on this flag -- passed through
  // unchanged. Deliberately NOT applied to the no_phone/opted_out branches
  // right below: those are pre-flight checks on the recipient, not a
  // channel attempt (nothing was ever dialed), so there's no "attempt" to
  // log there the way there is for not_connected/send_failed.
  logAttemptEvenOnFailure?: boolean;
}): Promise<SendClientSmsResult> {
  const { studioId, clientId, conversationId, body, actorUserId, bypassOptOutCheck, replyToId, logAttemptEvenOnFailure } =
    params;

  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client) {
    return { sent: false, reason: "no_phone" };
  }
  if (client.smsOptedOutAt && !bypassOptOutCheck) {
    return { sent: false, reason: "opted_out" };
  }
  if (!client.phone) {
    return { sent: false, reason: "no_phone" };
  }

  return sendSmsMessage({
    studioId,
    conversationId,
    toPhone: client.phone,
    body,
    actorUserId,
    replyToId,
    logAttemptEvenOnFailure,
  });
}

export type SendStaffSmsResult =
  | { sent: true; messageId: string; providerSid: string }
  | { sent: false; reason: "not_connected" | "no_phone" | "send_failed"; error?: string };

// Staff-facing wrapper (Phase 7B-2's artist day-before digest) -- same
// send path, logged into the artist's own STAFF conversation so it's
// visible in-app exactly like any other message they've been sent, not a
// send with no record anywhere.
export async function sendStaffSms(params: {
  studioId: string;
  userId: string;
  conversationId: string;
  body: string;
  actorUserId: string | null;
}): Promise<SendStaffSmsResult> {
  const { studioId, userId, conversationId, body, actorUserId } = params;

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.phone) {
    return { sent: false, reason: "no_phone" };
  }

  return sendSmsMessage({ studioId, conversationId, toPhone: user.phone, body, actorUserId });
}
