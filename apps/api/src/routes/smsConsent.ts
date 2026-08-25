import { Router } from "express";
import { prisma } from "../lib/prisma";
import { logAudit } from "../lib/audit";
import { emitInvalidation } from "../lib/realtime/registry";
import {
  SMS_CONSENT_SOURCE_LINK,
  checkConsentEligibility,
  resolveClientPhone,
  sendOptInConfirmation,
} from "../lib/smsConsent";

// Public, unauthenticated: the client's own half of post-add SMS consent.
// Same random-token-plus-expiry pattern as the waiver, deposit and
// estimate flows (CLAUDE.md's standing rule for any new public flow), and
// like the waiver this token is genuinely SINGLE-USE -- consumed on
// submit, so a forwarded link is inert afterwards.
//
// Why this exists at all rather than only the staff-recorded path: under
// A2P 10DLC the strongest evidence of consent is the subscriber's own
// affirmative action, timestamped. Staff attesting on a client's behalf is
// acceptable but weaker, and it is the studio's word rather than the
// client's. This gives the studio the stronger option whenever the client
// isn't standing at the counter.
const publicRouter = Router();

// Shown on the page so the client can see WHICH number they're opting in
// for without the page publishing the full number to anyone who gets the
// link. Last four only: enough to recognise your own phone, useless to
// someone who doesn't already know it.
function maskPhone(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return null;
  return `(•••) •••-${digits.slice(-4)}`;
}

type LinkProblem = { status: number; code: string; error: string };

function problemFor(client: { smsConsentTokenExpiresAt: Date | null } | null): LinkProblem | null {
  if (!client) {
    return { status: 404, code: "invalid", error: "This link is invalid." };
  }
  if (!client.smsConsentTokenExpiresAt || client.smsConsentTokenExpiresAt < new Date()) {
    return { status: 410, code: "expired", error: "This link has expired. Ask the studio for a new one." };
  }
  return null;
}

publicRouter.get("/:token", async (req, res) => {
  const token = req.params.token as string;

  const client = await prisma.client.findUnique({
    where: { smsConsentToken: token },
    include: {
      phones: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }], take: 1 },
      studio: {
        select: {
          name: true,
          slug: true,
          logoUrl: true,
          settings: { select: { themePreset: true } },
          locations: { select: { phone: true }, take: 1 },
        },
      },
    },
  });

  const problem = problemFor(client);
  if (problem) return res.status(problem.status).json({ code: problem.code, error: problem.error });

  // A client who already consented (or opted out) between the link being
  // issued and opened gets told so plainly rather than silently
  // re-stamping or, worse, appearing to re-opt-in someone who said stop.
  const eligibility = checkConsentEligibility(client!);
  if (!eligibility.ok) {
    return res.status(409).json({ code: eligibility.code, error: eligibility.error });
  }

  res.json({
    studioName: client!.studio.name,
    studioSlug: client!.studio.slug,
    studioLogoUrl: client!.studio.logoUrl,
    studioPhone: client!.studio.locations[0]?.phone ?? null,
    themePreset: client!.studio.settings?.themePreset ?? null,
    clientFirstName: client!.firstName,
    maskedPhone: maskPhone(resolveClientPhone(client!)),
  });
});

publicRouter.post("/:token", async (req, res) => {
  const token = req.params.token as string;

  const client = await prisma.client.findUnique({
    where: { smsConsentToken: token },
    include: { phones: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }], take: 1 } },
  });

  const problem = problemFor(client);
  if (problem) return res.status(problem.status).json({ code: problem.code, error: problem.error });

  const eligibility = checkConsentEligibility(client!);
  if (!eligibility.ok) {
    return res.status(409).json({ code: eligibility.code, error: eligibility.error });
  }

  // Consent and token-consumption in one write: there is no window in
  // which the client is opted in but the link is still live, or vice
  // versa. The unique constraint on smsConsentToken means a concurrent
  // second submit of the same token finds nothing on its own lookup.
  await prisma.client.update({
    where: { id: client!.id },
    data: {
      smsConsentGivenAt: new Date(),
      smsConsentSource: SMS_CONSENT_SOURCE_LINK,
      smsConsentToken: null,
      smsConsentTokenExpiresAt: null,
    },
  });

  await logAudit({
    studioId: client!.studioId,
    // No actor: this is the CLIENT's own action, not a staff member's.
    // Recording a staff user here would misattribute the one thing this
    // whole flow exists to prove.
    actorUserId: null,
    entityType: "Client",
    entityId: client!.id,
    action: "sms_opted_in",
    changes: { via: SMS_CONSENT_SOURCE_LINK, consentRecorded: true },
  });

  emitInvalidation({ type: "client.updated", studioId: client!.studioId, clientId: client!.id });

  // Same confirmation the inbound START path sends. Deliberately not
  // awaited into the response's success: the consent IS recorded at this
  // point, and a studio with no SMS integration connected (or a Twilio
  // hiccup) must not make the client's own opt-in look like it failed.
  try {
    await sendOptInConfirmation(client!.studioId, client!.id);
  } catch (err) {
    console.error("[sms-consent] opt-in confirmation failed to send", err);
  }

  res.json({ ok: true });
});

export { publicRouter };
