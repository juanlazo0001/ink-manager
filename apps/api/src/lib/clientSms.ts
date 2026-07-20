import { prisma } from "./prisma";
import { ConversationType, IntegrationChannel, IntegrationStatus, MessageChannel, MessageDirection } from "../../generated/prisma/enums";
import { decryptSecret } from "./secrets";
import { sendSms, type TwilioCredentials } from "./twilio";
import { TWILIO_STATUS_CALLBACK_URL } from "./publicUrl";
import { logAudit } from "./audit";

export type SendClientSmsResult =
  | { sent: true; messageId: string; providerSid: string }
  | { sent: false; reason: "not_connected" | "no_phone" | "opted_out" | "send_failed"; error?: string };

// The one real-SMS send path -- both the conversation composer (channel
// SMS, direction OUTBOUND, on a CLIENT thread) and every reminder job in
// Part 2 call this, rather than each placing its own Twilio call. A
// Message row is created ONLY on provider acceptance; a failed send
// persists nothing, matching how a failed attempt should look identical
// to "never tried" from the thread's point of view.
export async function sendClientSms(params: {
  studioId: string;
  clientId: string;
  conversationId: string;
  body: string;
  actorUserId: string | null;
}): Promise<SendClientSmsResult> {
  const { studioId, clientId, conversationId, body, actorUserId } = params;

  const integration = await prisma.studioIntegration.findUnique({
    where: { studioId_channel: { studioId, channel: IntegrationChannel.SMS } },
  });

  if (!integration || integration.status !== IntegrationStatus.CONNECTED || !integration.encryptedSecret) {
    return { sent: false, reason: "not_connected" };
  }

  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client) {
    return { sent: false, reason: "no_phone" };
  }
  if (client.smsOptedOutAt) {
    return { sent: false, reason: "opted_out" };
  }
  if (!client.phone) {
    return { sent: false, reason: "no_phone" };
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

  const toNumber = `+1${client.phone}`;

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
