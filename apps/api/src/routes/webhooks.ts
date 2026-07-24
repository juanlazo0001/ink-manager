import { Router } from "express";
import { prisma } from "../lib/prisma";
import {
  ConversationType,
  IntegrationChannel,
  IntegrationStatus,
  MessageChannel,
  MessageDirection,
} from "../../generated/prisma/enums";
import { decryptSecret } from "../lib/secrets";
import { verifyTwilioSignature, type TwilioCredentials } from "../lib/twilio";
import { TWILIO_SMS_WEBHOOK_URL, TWILIO_STATUS_CALLBACK_URL } from "../lib/publicUrl";
import { getOrCreateClientConversation } from "../lib/conversations";
import { normalizePhone } from "../lib/phone";
import { reuploadTwilioMedia } from "../lib/cloudinary";
import { logAudit } from "../lib/audit";
import { generateUniqueReferralCode } from "../lib/referrals";
import { sendClientSms } from "../lib/clientSms";
import { renderTemplate, type ReminderTemplates } from "../lib/reminderTemplates";

const router = Router();

const EMPTY_TWIML = "<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response></Response>";

function twiml(res: import("express").Response) {
  res.set("Content-Type", "text/xml");
  res.status(200).send(EMPTY_TWIML);
}

const STOP_KEYWORDS = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"]);
const START_KEYWORDS = new Set(["START", "UNSTOP", "YES"]);
const HELP_KEYWORDS = new Set(["HELP"]);

// Both auto-replies render the studio's own saved template (the same
// StudioSettings.reminderTemplates JSON field/editor as the reminder
// cadence, just two more keys) and send it through the exact same
// sendClientSms path every other outbound SMS in this app uses. If a
// studio hasn't got the template saved yet (predates this feature, or
// simply left it blank -- though the Settings validation requires a
// non-empty string once the object is touched at all), this silently
// no-ops rather than sending a broken/empty message -- same "skip if not
// configured" spirit reminderTicker.ts's own `if (sendTimes && templates)`
// gate already uses for the cadence.
async function sendOptInConfirmation(studioId: string, clientId: string): Promise<void> {
  const [studio, settings] = await Promise.all([
    prisma.studio.findUnique({ where: { id: studioId }, select: { name: true } }),
    prisma.studioSettings.findUnique({ where: { studioId }, select: { reminderTemplates: true } }),
  ]);
  const templates = settings?.reminderTemplates as unknown as ReminderTemplates | null;
  if (!templates?.optInConfirmation) return;

  const body = renderTemplate(templates.optInConfirmation, { studioName: studio?.name ?? "our studio" });
  const { conversation } = await getOrCreateClientConversation(studioId, clientId, null);
  await sendClientSms({ studioId, clientId, conversationId: conversation.id, body, actorUserId: null });
}

// HELP fires regardless of current opt-in/opt-out status -- basic
// customer service, not a marketing message, per CTIA convention (and
// this task) -- bypassOptOutCheck is the one sanctioned exception to
// sendClientSms's normal opted-out gate. Studio contact info comes from
// its first Location (Studio/StudioSettings have no dedicated phone/email
// field of their own); a studio with none seeded just renders those two
// placeholders empty rather than blocking the reply entirely.
async function sendHelpResponse(studioId: string, clientId: string): Promise<void> {
  const [studio, settings, location] = await Promise.all([
    prisma.studio.findUnique({ where: { id: studioId }, select: { name: true } }),
    prisma.studioSettings.findUnique({ where: { studioId }, select: { reminderTemplates: true } }),
    prisma.location.findFirst({ where: { studioId }, select: { phone: true, email: true } }),
  ]);
  const templates = settings?.reminderTemplates as unknown as ReminderTemplates | null;
  if (!templates?.helpResponse) return;

  const body = renderTemplate(templates.helpResponse, {
    studioName: studio?.name ?? "our studio",
    studioPhone: location?.phone ?? "",
    studioEmail: location?.email ?? "",
  });
  const { conversation } = await getOrCreateClientConversation(studioId, clientId, null);
  await sendClientSms({
    studioId,
    clientId,
    conversationId: conversation.id,
    body,
    actorUserId: null,
    bypassOptOutCheck: true,
  });
}

// Public: no requireAuth. Twilio POSTs application/x-www-form-urlencoded --
// index.ts registers express.urlencoded() globally so req.body is already
// parsed by the time this runs.
router.post("/twilio/sms", async (req, res) => {
  const body = req.body ?? {};
  const to = typeof body.To === "string" ? body.To : "";
  const from = typeof body.From === "string" ? body.From : "";
  const messageSid = typeof body.MessageSid === "string" ? body.MessageSid : "";
  const messageBody = typeof body.Body === "string" ? body.Body : "";
  const numMedia = Number.parseInt(typeof body.NumMedia === "string" ? body.NumMedia : "0", 10) || 0;

  if (!to || !from || !messageSid) {
    return res.status(400).send("Missing required Twilio parameters");
  }

  // Resolve the studio FIRST, by the To number matching a CONNECTED SMS
  // integration -- only then do we have a token to validate the signature
  // against. This ordering (studio-by-number before signature check) is
  // the multi-tenant hinge: without it there's no way to know whose secret
  // to verify against at all.
  const integration = await prisma.studioIntegration.findFirst({
    where: {
      channel: IntegrationChannel.SMS,
      status: IntegrationStatus.CONNECTED,
      metadata: { path: ["phoneNumber"], equals: to },
    },
  });

  if (!integration || !integration.encryptedSecret) {
    return res.status(403).send("Unknown number");
  }

  let credentials: TwilioCredentials;
  try {
    credentials = JSON.parse(decryptSecret(integration.encryptedSecret)) as TwilioCredentials;
  } catch {
    return res.status(403).send("Could not verify signature");
  }

  const signatureValid = verifyTwilioSignature(
    credentials.authToken,
    req.header("X-Twilio-Signature"),
    TWILIO_SMS_WEBHOOK_URL,
    body,
  );

  if (!signatureValid) {
    return res.status(403).send("Invalid signature");
  }

  const studioId = integration.studioId;

  // Idempotent against Twilio's own webhook retries -- a replayed
  // MessageSid is a no-op, not a duplicate message.
  const existingMessage = await prisma.message.findFirst({
    where: { studioId, metadata: { path: ["providerSid"], equals: messageSid } },
  });
  if (existingMessage) {
    return twiml(res);
  }

  const normalizedFrom = normalizePhone(from);

  // Reuse existing normalization and check secondary aliases too, not just
  // the primary phone field (Client.phone alone would miss a client who
  // texts from a number they only added as a secondary contact).
  let client = await prisma.client.findFirst({
    where: {
      studioId,
      OR: [{ phone: normalizedFrom }, { phones: { some: { phone: normalizedFrom } } }],
    },
  });

  if (!client) {
    client = await prisma.client.create({
      data: {
        studioId,
        firstName: "Unknown",
        lastName: "(new SMS contact)",
        phone: normalizedFrom,
        referralCode: await generateUniqueReferralCode(),
      },
    });
    await prisma.clientPhone.create({
      data: { clientId: client.id, phone: normalizedFrom, isPrimary: true },
    });
    await logAudit({
      studioId,
      actorUserId: null,
      entityType: "Client",
      entityId: client.id,
      action: "create",
      changes: { source: "inbound_sms", phone: normalizedFrom },
    });
  }

  // STOP/START are handled alongside normal message creation, not instead
  // of it -- the opt-out/opt-in message itself still lands in the thread,
  // it's not swallowed.
  const keyword = messageBody.trim().toUpperCase();
  if (STOP_KEYWORDS.has(keyword) && !client.smsOptedOutAt) {
    await prisma.client.update({ where: { id: client.id }, data: { smsOptedOutAt: new Date() } });
    await logAudit({
      studioId,
      actorUserId: null,
      entityType: "Client",
      entityId: client.id,
      action: "sms_opted_out",
      changes: { via: "inbound_keyword", keyword },
    });
  } else if (START_KEYWORDS.has(keyword) && client.smsOptedOutAt) {
    await prisma.client.update({ where: { id: client.id }, data: { smsOptedOutAt: null } });
    await logAudit({
      studioId,
      actorUserId: null,
      entityType: "Client",
      entityId: client.id,
      action: "sms_opted_in",
      changes: { via: "inbound_keyword", keyword },
    });
    await sendOptInConfirmation(studioId, client.id);
  } else if (HELP_KEYWORDS.has(keyword)) {
    await sendHelpResponse(studioId, client.id);
  }

  const { conversation } = await getOrCreateClientConversation(studioId, client.id, null);

  const attachments: string[] = [];
  for (let i = 0; i < numMedia; i += 1) {
    const mediaUrl = body[`MediaUrl${i}`];
    if (typeof mediaUrl !== "string") continue;
    try {
      const secureUrl = await reuploadTwilioMedia(mediaUrl, credentials.accountSid, credentials.authToken);
      attachments.push(secureUrl);
    } catch (err) {
      console.error("Failed to re-upload inbound MMS media", { mediaUrl, err });
    }
  }

  const now = new Date();
  const message = await prisma.$transaction(async (tx) => {
    const created = await tx.message.create({
      data: {
        studioId,
        conversationId: conversation.id,
        channel: MessageChannel.SMS,
        direction: MessageDirection.INBOUND,
        body: messageBody,
        attachments: attachments.length > 0 ? attachments : undefined,
        authorUserId: null,
        metadata: { providerSid: messageSid },
        createdAt: now,
      },
    });
    await tx.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: now } });
    return created;
  });

  await logAudit({
    studioId,
    actorUserId: null,
    entityType: "Message",
    entityId: message.id,
    action: "sms_received",
    changes: { conversationId: conversation.id, providerSid: messageSid },
  });

  return twiml(res);
});

// Public: Twilio's delivery-status callback (statusCallback param on every
// outbound send -- see lib/clientSms.ts and routes/integrations.ts's test-
// message). We don't know which studio a status update is for until we've
// found the Message it refers to (via providerSid), so signature
// verification necessarily happens AFTER that lookup here, unlike the
// inbound-SMS webhook above.
router.post("/twilio/status", async (req, res) => {
  const body = req.body ?? {};
  const messageSid = typeof body.MessageSid === "string" ? body.MessageSid : "";
  const messageStatus = typeof body.MessageStatus === "string" ? body.MessageStatus : "";

  if (!messageSid || !messageStatus) {
    return res.status(400).send("Missing required Twilio parameters");
  }

  const message = await prisma.message.findFirst({
    where: { metadata: { path: ["providerSid"], equals: messageSid } },
  });

  if (!message) {
    return res.status(404).send("Unknown message");
  }

  const integration = await prisma.studioIntegration.findUnique({
    where: { studioId_channel: { studioId: message.studioId, channel: IntegrationChannel.SMS } },
  });

  if (!integration?.encryptedSecret || !TWILIO_STATUS_CALLBACK_URL) {
    return res.status(403).send("Could not verify signature");
  }

  let credentials: TwilioCredentials;
  try {
    credentials = JSON.parse(decryptSecret(integration.encryptedSecret)) as TwilioCredentials;
  } catch {
    return res.status(403).send("Could not verify signature");
  }

  const signatureValid = verifyTwilioSignature(
    credentials.authToken,
    req.header("X-Twilio-Signature"),
    TWILIO_STATUS_CALLBACK_URL,
    body,
  );

  if (!signatureValid) {
    return res.status(403).send("Invalid signature");
  }

  // Message is otherwise immutable (schema doc-comment, no PATCH/DELETE
  // route exists) -- this metadata-only delivery-status update is the one
  // sanctioned exception, server-side only, never via any user-facing route.
  const existingMetadata = (message.metadata as Record<string, unknown> | null) ?? {};
  await prisma.message.update({
    where: { id: message.id },
    data: { metadata: { ...existingMetadata, deliveryStatus: messageStatus } },
  });

  return twiml(res);
});

export default router;
