import { Router } from "express";
import { prisma } from "../lib/prisma";
import { Prisma } from "../../generated/prisma/client";
import { IntegrationChannel, IntegrationStatus, Role } from "../../generated/prisma/enums";
import { requireAuth, requireRole } from "../middleware/auth";
import { logAudit } from "../lib/audit";
import { decryptSecret, encryptSecret, isEncryptionConfigured, maskAccountSid, maskEmail, maskStripeAccountId } from "../lib/secrets";
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
import { createOnboardingLink, createStandardConnectedAccount, getConnectedAccountStatus } from "../lib/stripeConnect";
import { isStripeConfigured } from "../lib/stripe";
import { isPlatformSmsConfigured, sendPlatformSms } from "../lib/platformSms";

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

// Phase 7C: Stripe Connect (Standard) onboarding. Unlike Gmail's OAuth
// flow, there's no authorization code to exchange server-side on return --
// the connected account id is already known (created below, before the
// redirect), so there's no need for a public callback route at all. Stripe
// redirects the browser straight back to this SPA's own /settings page
// (return_url/refresh_url), which still holds this OWNER's JWT in
// localStorage across that round trip -- it calls the authenticated
// /stripe/refresh-status route below to sync the latest charges_enabled/
// payouts_enabled, same "confirm status via the API, don't trust the
// redirect alone" approach Stripe's own docs recommend.
//
// Reused for BOTH the very first connect attempt and "Finish setup" when
// onboarding was left incomplete -- the existing connected account id (if
// any) is reused, never re-created; only a fresh single-use Account Link
// is generated each time.
router.post("/stripe/connect", async (req, res) => {
  if (!isStripeConfigured()) {
    return res.status(503).json({ error: "Stripe isn't available right now -- ask an admin to check the server configuration" });
  }

  const studioId = req.user!.studioId;

  const existing = await prisma.studioIntegration.findUnique({
    where: { studioId_channel: { studioId, channel: IntegrationChannel.STRIPE } },
  });
  const existingMetadata = (existing?.metadata as { stripeAccountId?: string } | null) ?? null;

  let accountId = existingMetadata?.stripeAccountId ?? null;
  if (!accountId) {
    accountId = await createStandardConnectedAccount();

    await prisma.studioIntegration.upsert({
      where: { studioId_channel: { studioId, channel: IntegrationChannel.STRIPE } },
      create: {
        studioId,
        channel: IntegrationChannel.STRIPE,
        status: IntegrationStatus.CONNECTED,
        displayName: maskStripeAccountId(accountId),
        metadata: { stripeAccountId: accountId, chargesEnabled: false, payoutsEnabled: false },
        connectedAt: new Date(),
        lastError: null,
      },
      update: {
        status: IntegrationStatus.CONNECTED,
        displayName: maskStripeAccountId(accountId),
        metadata: { stripeAccountId: accountId, chargesEnabled: false, payoutsEnabled: false },
        connectedAt: new Date(),
        lastError: null,
      },
    });

    // No secret material here to leak either way -- confirmed anyway, same
    // convention as every other integration_connected entry: channel +
    // masked display only. Logged once, at account creation, not on every
    // "Finish setup" Account Link regeneration.
    await logAudit({
      studioId,
      actorUserId: req.user!.userId,
      entityType: "StudioIntegration",
      entityId: `${studioId}:STRIPE`,
      action: "integration_connected",
      changes: { channel: "STRIPE", displayName: maskStripeAccountId(accountId) },
    });
  }

  const returnUrl = `${PUBLIC_APP_URL}/settings?tab=integrations&stripe=return`;
  const refreshUrl = `${PUBLIC_APP_URL}/settings?tab=integrations&stripe=refresh`;

  let url: string;
  try {
    url = await createOnboardingLink(accountId, refreshUrl, returnUrl);
  } catch (err) {
    return res.status(502).json({ error: err instanceof Error ? err.message : "Failed to start Stripe onboarding" });
  }

  res.json({ url });
});

// Called by Settings.tsx whenever the studio's browser returns from
// Stripe's hosted onboarding (return_url OR refresh_url both land here) --
// re-reads the account's live status from Stripe rather than trusting the
// redirect alone (a studio can bookmark/replay that URL, or Stripe's own
// account state can change independently of any one redirect).
router.post("/stripe/refresh-status", async (req, res) => {
  if (!isStripeConfigured()) {
    return res.status(503).json({ error: "Stripe isn't available right now -- ask an admin to check the server configuration" });
  }

  const studioId = req.user!.studioId;

  const existing = await prisma.studioIntegration.findUnique({
    where: { studioId_channel: { studioId, channel: IntegrationChannel.STRIPE } },
  });
  const accountId = (existing?.metadata as { stripeAccountId?: string } | null)?.stripeAccountId ?? null;

  if (!existing || !accountId) {
    return res.status(400).json({ error: "Stripe has not been connected for this studio yet" });
  }

  let accountStatus;
  try {
    accountStatus = await getConnectedAccountStatus(accountId);
  } catch (err) {
    return res.status(502).json({ error: err instanceof Error ? err.message : "Failed to check Stripe account status" });
  }

  const updated = await prisma.studioIntegration.update({
    where: { studioId_channel: { studioId, channel: IntegrationChannel.STRIPE } },
    data: {
      displayName: accountStatus.businessName ?? maskStripeAccountId(accountId),
      metadata: {
        stripeAccountId: accountId,
        chargesEnabled: accountStatus.chargesEnabled,
        payoutsEnabled: accountStatus.payoutsEnabled,
      },
    },
  });

  res.json({
    channel: IntegrationChannel.STRIPE,
    status: updated.status,
    displayName: updated.displayName,
    metadata: updated.metadata,
  });
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

  // BIRD_SMS has no per-studio credential at all (see schema.prisma's own
  // comment on the enum value) -- "connect" is just an opt-in flag, not a
  // real credential exchange, so this is its own short branch rather than
  // falling into the SID/token flow below.
  if (channel === IntegrationChannel.BIRD_SMS) {
    if (!isPlatformSmsConfigured()) {
      return res.status(503).json({ error: "Bird SMS isn't available right now -- ask an admin to check the server configuration" });
    }

    const connectedAt = new Date();
    await prisma.studioIntegration.upsert({
      where: { studioId_channel: { studioId, channel: IntegrationChannel.BIRD_SMS } },
      create: { studioId, channel: IntegrationChannel.BIRD_SMS, status: IntegrationStatus.CONNECTED, connectedAt, lastError: null },
      update: {
        status: IntegrationStatus.CONNECTED,
        connectedAt,
        lastError: null,
        encryptedSecret: null,
        metadata: Prisma.JsonNull,
        displayName: null,
      },
    });

    await logAudit({
      studioId,
      actorUserId: req.user!.userId,
      entityType: "StudioIntegration",
      entityId: `${studioId}:BIRD_SMS`,
      action: "integration_connected",
      changes: { channel: "BIRD_SMS" },
    });

    return res.json({ channel: IntegrationChannel.BIRD_SMS, status: IntegrationStatus.CONNECTED, connectedAt });
  }

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

  if (channel === IntegrationChannel.BIRD_SMS) {
    const { to } = req.body ?? {};
    if (typeof to !== "string" || !to.trim()) {
      return res.status(400).json({ error: "A phone number to send to is required" });
    }

    const integration = await prisma.studioIntegration.findUnique({
      where: { studioId_channel: { studioId, channel: IntegrationChannel.BIRD_SMS } },
    });
    if (!integration || integration.status !== IntegrationStatus.CONNECTED) {
      return res.status(400).json({ error: "Bird SMS is not connected for this studio" });
    }

    const normalized = normalizePhone(to.trim());
    const toE164 = normalized.length === 10 ? `+1${normalized}` : to.trim();

    try {
      await sendPlatformSms({
        to: toE164,
        text: "This is a test message from Ink Manager -- your Bird SMS integration is connected.",
      });
      return res.json({ sent: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to send the test message";
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
