import { prisma } from "./prisma";
import { IntegrationChannel, IntegrationStatus, MessageChannel, MessageDirection } from "../../generated/prisma/enums";
import { decryptSecret } from "./secrets";
import { sendSms, type TwilioCredentials } from "./twilio";
import { TWILIO_STATUS_CALLBACK_URL } from "./publicUrl";
import { logAudit } from "./audit";

type SendSmsMessageResult =
  | { sent: true; messageId: string; providerSid: string }
  | { sent: false; reason: "not_connected" | "send_failed"; error?: string };

// The one real-SMS send path -- the conversation composer, every Part
// 7B-2 client/artist reminder, and the estimate follow-up all go through
// this. A Message row is created ONLY on provider acceptance; a failed
// send persists nothing, so a failed attempt looks identical to "never
// tried" from the thread's point of view. Recipient-specific checks
// (client opted-out/no-phone, artist no-phone) live in the two wrapper
// functions below, not here -- this only knows "studio, conversation,
// phone, body."
async function sendSmsMessage(params: {
  studioId: string;
  conversationId: string;
  toPhone: string;
  body: string;
  actorUserId: string | null;
}): Promise<SendSmsMessageResult> {
  const { studioId, conversationId, toPhone, body, actorUserId } = params;

  const integration = await prisma.studioIntegration.findUnique({
    where: { studioId_channel: { studioId, channel: IntegrationChannel.SMS } },
  });

  if (!integration || integration.status !== IntegrationStatus.CONNECTED || !integration.encryptedSecret) {
    return { sent: false, reason: "not_connected" };
  }

  const metadata = (integration.metadata as { phoneNumber?: string } | null) ?? {};
  const fromNumber = metadata.phoneNumber;
  if (!fromNumber) {
    return { sent: false, reason: "not_connected" };
  }

  let credentials: TwilioCredentials;
  try {
    credentials = JSON.parse(decryptSecret(integration.encryptedSecret)) as TwilioCredentials;
  } catch {
    return { sent: false, reason: "send_failed", error: "Stored credentials could not be read" };
  }

  const toNumber = `+1${toPhone}`;

  let result;
  try {
    result = await sendSms(credentials, fromNumber, toNumber, body, TWILIO_STATUS_CALLBACK_URL);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Twilio send failed";
    return { sent: false, reason: "send_failed", error: message };
  }

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
        metadata: { providerSid: result!.sid, deliveryStatus: result!.status },
        createdAt: now,
      },
    });
    await tx.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: now } });
    return created;
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
}): Promise<SendClientSmsResult> {
  const { studioId, clientId, conversationId, body, actorUserId, bypassOptOutCheck } = params;

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

  return sendSmsMessage({ studioId, conversationId, toPhone: client.phone, body, actorUserId });
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
