import { Router } from "express";
import { prisma } from "../lib/prisma";
import { Prisma } from "../../generated/prisma/client";
import { IntegrationChannel, IntegrationStatus, Role } from "../../generated/prisma/enums";
import { requireAuth, requireRole } from "../middleware/auth";
import { logAudit } from "../lib/audit";
import { decryptSecret, encryptSecret, isEncryptionConfigured, maskAccountSid } from "../lib/secrets";
import { sendSms, validateTwilioAccount, type TwilioCredentials } from "../lib/twilio";
import { TWILIO_SMS_WEBHOOK_URL, TWILIO_STATUS_CALLBACK_URL } from "../lib/publicUrl";
import { normalizePhone } from "../lib/phone";

const router = Router();
router.use(requireAuth);

// Broader than the OWNER-only routes below: the composer (any staff role)
// needs to know whether SMS is connected to show an accurate send hint,
// but never needs the masked credential details GET / below exposes.
router.get("/status", requireRole(Role.OWNER, Role.FRONT_DESK, Role.ARTIST), async (req, res) => {
  const integration = await prisma.studioIntegration.findUnique({
    where: { studioId_channel: { studioId: req.user!.studioId, channel: IntegrationChannel.SMS } },
  });

  res.json({ sms: integration?.status === IntegrationStatus.CONNECTED });
});

router.use(requireRole(Role.OWNER));

// Every channel shows a card, even ones with nothing connected yet --
// synthesized as NOT_CONNECTED when no StudioIntegration row exists,
// rather than only listing rows that happen to exist.
router.get("/", async (req, res) => {
  const studioId = req.user!.studioId;

  const rows = await prisma.studioIntegration.findMany({ where: { studioId } });
  const byChannel = new Map(rows.map((row) => [row.channel, row]));

  const channels = Object.values(IntegrationChannel).map((channel) => {
    const row = byChannel.get(channel);
    return {
      channel,
      status: row?.status ?? IntegrationStatus.NOT_CONNECTED,
      displayName: row?.displayName ?? null,
      connectedAt: row?.connectedAt ?? null,
      lastError: row?.lastError ?? null,
      metadata: row?.metadata ?? null,
    };
  });

  res.json({ channels, smsWebhookUrl: TWILIO_SMS_WEBHOOK_URL });
});

router.post("/:channel/connect", async (req, res) => {
  const studioId = req.user!.studioId;
  const channel = req.params.channel as string;

  if (channel !== IntegrationChannel.SMS) {
    return res.status(400).json({ error: `${channel} is not supported yet -- coming soon` });
  }

  if (!isEncryptionConfigured()) {
    return res.status(503).json({ error: "Integrations aren't available right now -- ask an admin to check the server configuration" });
  }

  const { accountSid, authToken, fromNumber } = req.body ?? {};

  if (typeof accountSid !== "string" || !accountSid.trim()) {
    return res.status(400).json({ error: "Account SID is required" });
  }
  if (typeof authToken !== "string" || !authToken.trim()) {
    return res.status(400).json({ error: "Auth Token is required" });
  }
  if (typeof fromNumber !== "string" || !fromNumber.trim()) {
    return res.status(400).json({ error: "From number is required" });
  }

  const credentials: TwilioCredentials = { accountSid: accountSid.trim(), authToken: authToken.trim() };
  const normalizedFrom = fromNumber.trim();

  const validation = await validateTwilioAccount(credentials, normalizedFrom);

  if (!validation.valid) {
    // On failure, nothing secret is ever stored -- only the channel/status/
    // error, so the card can show "last attempt failed: <reason>" without
    // ever having persisted the bad (or good) credentials.
    await prisma.studioIntegration.upsert({
      where: { studioId_channel: { studioId, channel: IntegrationChannel.SMS } },
      create: { studioId, channel: IntegrationChannel.SMS, status: IntegrationStatus.ERROR, lastError: validation.error },
      update: {
        status: IntegrationStatus.ERROR,
        lastError: validation.error,
        encryptedSecret: null,
        metadata: Prisma.JsonNull,
        displayName: null,
        connectedAt: null,
      },
    });

    return res.status(400).json({ error: validation.error });
  }

  const encryptedSecret = encryptSecret(JSON.stringify(credentials));
  const displayName = `${maskAccountSid(credentials.accountSid)} · ${normalizedFrom}`;
  const connectedAt = new Date();

  await prisma.studioIntegration.upsert({
    where: { studioId_channel: { studioId, channel: IntegrationChannel.SMS } },
    create: {
      studioId,
      channel: IntegrationChannel.SMS,
      status: IntegrationStatus.CONNECTED,
      encryptedSecret,
      metadata: { phoneNumber: normalizedFrom },
      displayName,
      connectedAt,
      lastError: null,
    },
    update: {
      status: IntegrationStatus.CONNECTED,
      encryptedSecret,
      metadata: { phoneNumber: normalizedFrom },
      displayName,
      connectedAt,
      lastError: null,
    },
  });

  // No secret material in the audit entry -- channel + masked display only.
  await logAudit({
    studioId,
    actorUserId: req.user!.userId,
    entityType: "StudioIntegration",
    entityId: `${studioId}:SMS`,
    action: "integration_connected",
    changes: { channel: "SMS", displayName },
  });

  res.json({ channel: IntegrationChannel.SMS, status: IntegrationStatus.CONNECTED, displayName, connectedAt });
});

router.post("/:channel/disconnect", async (req, res) => {
  const studioId = req.user!.studioId;
  const channel = req.params.channel as IntegrationChannel;

  if (!Object.values(IntegrationChannel).includes(channel)) {
    return res.status(400).json({ error: "Unknown channel" });
  }

  const existing = await prisma.studioIntegration.findUnique({ where: { studioId_channel: { studioId, channel } } });
  if (!existing || existing.status === IntegrationStatus.NOT_CONNECTED) {
    return res.status(404).json({ error: "This channel is not connected" });
  }

  await prisma.studioIntegration.update({
    where: { studioId_channel: { studioId, channel } },
    data: {
      status: IntegrationStatus.NOT_CONNECTED,
      encryptedSecret: null,
      metadata: Prisma.JsonNull,
      displayName: null,
      connectedAt: null,
      lastError: null,
    },
  });

  await logAudit({
    studioId,
    actorUserId: req.user!.userId,
    entityType: "StudioIntegration",
    entityId: `${studioId}:${channel}`,
    action: "integration_disconnected",
    changes: { channel },
  });

  res.json({ channel, status: IntegrationStatus.NOT_CONNECTED });
});

router.post("/:channel/test-message", async (req, res) => {
  const studioId = req.user!.studioId;
  const channel = req.params.channel as string;

  if (channel !== IntegrationChannel.SMS) {
    return res.status(400).json({ error: `${channel} does not support test messages yet` });
  }

  const { to } = req.body ?? {};
  if (typeof to !== "string" || !to.trim()) {
    return res.status(400).json({ error: "A phone number to send to is required" });
  }

  const integration = await prisma.studioIntegration.findUnique({
    where: { studioId_channel: { studioId, channel: IntegrationChannel.SMS } },
  });
  if (!integration || integration.status !== IntegrationStatus.CONNECTED || !integration.encryptedSecret) {
    return res.status(400).json({ error: "SMS is not connected for this studio" });
  }

  const metadata = (integration.metadata as { phoneNumber?: string } | null) ?? {};
  if (!metadata.phoneNumber) {
    return res.status(400).json({ error: "SMS integration is missing its from-number" });
  }

  let credentials: TwilioCredentials;
  try {
    credentials = JSON.parse(decryptSecret(integration.encryptedSecret)) as TwilioCredentials;
  } catch {
    return res.status(500).json({ error: "Stored credentials could not be read" });
  }

  const normalized = normalizePhone(to.trim());
  const toE164 = normalized.length === 10 ? `+1${normalized}` : to.trim();

  try {
    const result = await sendSms(
      credentials,
      metadata.phoneNumber,
      toE164,
      "This is a test message from Ink Manager -- your SMS integration is connected.",
      TWILIO_STATUS_CALLBACK_URL,
    );
    res.json({ sent: true, sid: result.sid });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to send the test message";
    res.status(400).json({ error: message });
  }
});

export default router;
