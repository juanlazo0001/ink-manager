import { Router } from "express";
import { prisma } from "../lib/prisma";
import { Prisma } from "../../generated/prisma/client";
import { IntegrationChannel, IntegrationStatus, Role } from "../../generated/prisma/enums";
import { requireAuth, requireRole } from "../middleware/auth";
import { logAudit } from "../lib/audit";
import { decryptSecret, encryptSecret, isEncryptionConfigured, maskAccountSid, maskEmail } from "../lib/secrets";
import { sendSms, validateTwilioAccount, type TwilioCredentials } from "../lib/twilio";
import { TWILIO_SMS_WEBHOOK_URL, TWILIO_STATUS_CALLBACK_URL, GMAIL_OAUTH_REDIRECT_URI, PUBLIC_APP_URL } from "../lib/publicUrl";
import { normalizePhone } from "../lib/phone";
import {
  buildGmailAuthUrl,
  exchangeCodeForTokens,
  getGmailProfile,
  getValidAccessToken,
  isGmailConfigured,
  revokeGmailToken,
  sendGmailMessage,
  signGmailOAuthState,
  verifyGmailOAuthState,
} from "../lib/gmail";

// Public: Google's redirect after the user grants (or denies) consent hits
// this directly -- it can't carry this app's own Bearer JWT (a full-page
// browser navigation, not an authenticated fetch), so identity for "which
// studio/user started this" travels entirely through the signed `state`
// param instead. Mounted before the authenticated router below in index.ts,
// same public-router-first convention as gift-cards/waivers/custom-policies.
const publicRouter = Router();

publicRouter.get("/email/callback", async (req, res) => {
  const code = typeof req.query.code === "string" ? req.query.code : null;
  const state = typeof req.query.state === "string" ? req.query.state : null;
  const oauthError = typeof req.query.error === "string" ? req.query.error : null;

  const redirectTo = (params: Record<string, string>) =>
    res.redirect(`${PUBLIC_APP_URL}/settings?${new URLSearchParams({ tab: "integrations", ...params }).toString()}`);

  if (!state) {
    // No verifiable claim of which studio this belongs to -- nothing to
    // mark ERROR against, just bounce back with a generic failure.
    return redirectTo({ email: "error", message: "Invalid or expired connection attempt -- please try again." });
  }

  const claim = verifyGmailOAuthState(state);
  if (!claim) {
    return redirectTo({ email: "error", message: "Invalid or expired connection attempt -- please try again." });
  }

  const { studioId, actorUserId } = claim;

  async function fail(message: string) {
    // On failure, nothing secret is ever stored -- only status/error,
    // matching the SMS connect route's own "nothing half-stored" rule.
    await prisma.studioIntegration.upsert({
      where: { studioId_channel: { studioId, channel: IntegrationChannel.EMAIL } },
      create: { studioId, channel: IntegrationChannel.EMAIL, status: IntegrationStatus.ERROR, lastError: message },
      update: {
        status: IntegrationStatus.ERROR,
        lastError: message,
        encryptedSecret: null,
        metadata: Prisma.JsonNull,
        displayName: null,
        connectedAt: null,
      },
    });
    return redirectTo({ email: "error", message });
  }

  if (oauthError) {
    return fail(oauthError === "access_denied" ? "Google sign-in was cancelled." : oauthError);
  }
  if (!code) {
    return fail("Google did not return an authorization code.");
  }

  let tokens;
  try {
    tokens = await exchangeCodeForTokens(code, GMAIL_OAUTH_REDIRECT_URI);
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Could not exchange the authorization code with Google");
  }

  if (!tokens.refreshToken) {
    return fail(
      "Google did not return a refresh token -- if this Google account already granted access before, remove Ink Manager under your Google Account's third-party app settings and try connecting again.",
    );
  }

  let emailAddress: string;
  try {
    const profile = await getGmailProfile(tokens.accessToken);
    emailAddress = profile.emailAddress;
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Could not read the connected Gmail address");
  }

  const encryptedSecret = encryptSecret(tokens.refreshToken);
  const displayName = maskEmail(emailAddress);
  const connectedAt = new Date();
  const metadata = {
    emailAddress,
    tokenExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000).toISOString(),
    lastPolledAt: connectedAt.toISOString(),
  };

  await prisma.studioIntegration.upsert({
    where: { studioId_channel: { studioId, channel: IntegrationChannel.EMAIL } },
    create: {
      studioId,
      channel: IntegrationChannel.EMAIL,
      status: IntegrationStatus.CONNECTED,
      encryptedSecret,
      metadata,
      displayName,
      connectedAt,
      lastError: null,
    },
    update: {
      status: IntegrationStatus.CONNECTED,
      encryptedSecret,
      metadata,
      displayName,
      connectedAt,
      lastError: null,
    },
  });

  // No secret material in the audit entry -- channel + masked display only,
  // same as every other integration connect.
  await logAudit({
    studioId,
    actorUserId,
    entityType: "StudioIntegration",
    entityId: `${studioId}:EMAIL`,
    action: "integration_connected",
    changes: { channel: "EMAIL", displayName },
  });

  return redirectTo({ email: "connected" });
});

const router = Router();
router.use(requireAuth);

// Broader than the OWNER-only routes below: the composer (any staff role)
// needs to know which channels are actually connected -- to show an
// accurate SMS send hint, and to grey out channels with no live
// integration (Instagram/Facebook/Email) in the channel picker -- but
// never needs the masked credential details GET / below exposes. PHONE/
// OTHER aren't real IntegrationChannel values (no connect/disconnect flow
// exists for either), so they're deliberately absent here and always
// stay selectable on the frontend regardless of this response.
router.get("/status", requireRole(Role.OWNER, Role.FRONT_DESK, Role.ARTIST), async (req, res) => {
  const rows = await prisma.studioIntegration.findMany({
    where: {
      studioId: req.user!.studioId,
      channel: {
        in: [IntegrationChannel.SMS, IntegrationChannel.EMAIL, IntegrationChannel.INSTAGRAM, IntegrationChannel.FACEBOOK],
      },
    },
  });
  const connected = new Set(
    rows.filter((row) => row.status === IntegrationStatus.CONNECTED).map((row) => row.channel),
  );

  res.json({
    sms: connected.has(IntegrationChannel.SMS),
    email: connected.has(IntegrationChannel.EMAIL),
    instagram: connected.has(IntegrationChannel.INSTAGRAM),
    facebook: connected.has(IntegrationChannel.FACEBOOK),
  });
});

router.use(requireRole(Role.OWNER));

// Returns the Google consent URL to navigate the browser to -- a full-page
// redirect, not something this JSON route can do itself, since only the
// browser holds the session that then comes back through Google's own
// redirect to the public callback above.
router.get("/email/connect-url", async (req, res) => {
  if (!isGmailConfigured()) {
    return res.status(503).json({ error: "Email integration isn't available right now -- ask an admin to check the server configuration" });
  }

  const state = signGmailOAuthState(req.user!.studioId, req.user!.userId);
  const url = buildGmailAuthUrl(GMAIL_OAUTH_REDIRECT_URI, state);
  res.json({ url });
});

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

  if (channel === IntegrationChannel.EMAIL && existing.encryptedSecret) {
    try {
      const refreshToken = decryptSecret(existing.encryptedSecret);
      await revokeGmailToken(refreshToken);
    } catch {
      // Best-effort -- local state is cleared regardless below. Local
      // status is the source of truth for "connected" in this app, not
      // whatever Google's revoke endpoint did or didn't do.
    }
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

  if (channel === IntegrationChannel.EMAIL) {
    const { to } = req.body ?? {};
    if (typeof to !== "string" || !to.trim()) {
      return res.status(400).json({ error: "An email address to send to is required" });
    }

    const integration = await prisma.studioIntegration.findUnique({
      where: { studioId_channel: { studioId, channel: IntegrationChannel.EMAIL } },
    });
    if (!integration || integration.status !== IntegrationStatus.CONNECTED || !integration.encryptedSecret) {
      return res.status(400).json({ error: "Email is not connected for this studio" });
    }

    const metadata = (integration.metadata as { emailAddress?: string } | null) ?? {};
    if (!metadata.emailAddress) {
      return res.status(400).json({ error: "Email integration is missing its connected address" });
    }

    let refreshToken: string;
    try {
      refreshToken = decryptSecret(integration.encryptedSecret);
    } catch {
      return res.status(500).json({ error: "Stored credentials could not be read" });
    }

    try {
      const accessToken = await getValidAccessToken(studioId, refreshToken);
      const result = await sendGmailMessage({
        accessToken,
        from: metadata.emailAddress,
        to: to.trim(),
        subject: "Test email from Ink Manager",
        body: "This is a test email from Ink Manager -- your Gmail integration is connected.",
      });
      return res.json({ sent: true, id: result.id });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to send the test email";
      return res.status(400).json({ error: message });
    }
  }

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

export { publicRouter, router as staffRouter };
