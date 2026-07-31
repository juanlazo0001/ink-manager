import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { requirePermission } from "../lib/permissions";
import { Role } from "../../generated/prisma/enums";
import { DEFAULT_THEME_PRESET, THEME_PRESET_ACCENT_COLORS, isValidThemePreset } from "../lib/themePresets";
import { PUBLIC_APP_URL } from "../lib/publicUrl";
import { issueGiftCardForPaidDeposit } from "../lib/deposits";
import { getChargeableConnectedAccountId } from "../lib/stripeConnect";
import { createDirectChargeCheckoutSession } from "../lib/stripe";
import { generateDepositFormPdf } from "../lib/pdf";

// Exact SOP wording, in the order the client must agree to each one.
const TERMS = [
  {
    key: "agreedNonRefundable",
    label:
      "A deposit is required to set an appointment. Deposits are non-refundable and are applied to the final price of the tattoo.",
  },
  {
    key: "agreedLatePolicy",
    label: "Artists reserve the right to reschedule the appointment if the client is more than 15 minutes late without notification.",
  },
  {
    key: "agreedNoShowForfeit",
    label: "A no-call/no-show forfeits the deposit. A 48-hour notice is required to change a scheduled appointment.",
  },
  {
    key: "agreedNewDepositAfterNoShow",
    label: "After a no-call/no-show, a new deposit is required to set up another appointment.",
  },
  {
    key: "agreedRescheduleLimit",
    label: "Appointments may be rescheduled up to 3 times; the deposit is forfeited on the 3rd reschedule.",
  },
  {
    key: "agreedExpiration",
    label: "Deposits expire one year after the date they were created.",
  },
  {
    key: "agreedIdAndVoucher",
    label: "Client must bring a government-issued ID and the Deposit Voucher (issued after payment) on the day of the appointment.",
  },
  {
    key: "agreedAge18",
    label: "Client reconfirms they are at least 18 years of age.",
  },
] as const;

const TERM_KEYS = TERMS.map((t) => t.key);

// Phase 7C: "already signed" is no longer unconditionally terminal -- a
// studio with Stripe connected still needs this same token to work AFTER
// signing, so the client can pay (or retry paying, if they abandoned
// Stripe's checkout page and came back). Only a deposit that's actually
// been PAID is never treated as invalid/expired here at all -- GET /verify
// below always returns the full success shape for a paid deposit
// (including paidVia), and the frontend shows a distinct "you've already
// paid" state driven by that data rather than by an error branch. "Signed,
// not yet paid, Stripe connected" is likewise a valid, resumable state
// (see POST /:token/checkout-session below) -- only a genuinely invalid
// token, an unpaid-and-expired one, or (for studios without Stripe) an
// already-signed one are real errors.
function isExpiredOrInvalid(
  depositForm: { signedAt: Date | null; tokenExpiresAt: Date; paidVia: string | null } | null,
  stripeConnected: boolean,
) {
  if (!depositForm) {
    return { code: "invalid", error: "This link is invalid." } as const;
  }

  if (depositForm.paidVia) {
    return null;
  }

  if (depositForm.signedAt && !stripeConnected) {
    return { code: "already_signed", error: "This deposit form has already been signed." } as const;
  }

  if (depositForm.tokenExpiresAt < new Date()) {
    return { code: "expired", error: "This link has expired." } as const;
  }

  return null;
}

// Public: same pattern as consent form / estimate links.
const publicRouter = Router();

publicRouter.get("/verify/:token", async (req, res) => {
  const token = req.params.token as string;

  const depositForm = await prisma.depositForm.findUnique({
    where: { token },
    include: {
      inquiry: {
        include: {
          client: true,
          studio: { include: { settings: { select: { themePreset: true } } } },
          assignedArtist: { include: { user: true } },
          appointment: true,
          service: { select: { depositBreakdownNote: true } },
          // Multi-session planning: only its length is needed here (the
          // "of Y" in "Session X of Y") -- the specific session THIS
          // deposit form is for comes from depositForm.plannedSession
          // below instead.
          plannedSessions: { select: { id: true } },
        },
      },
      // Null for every un-planned deposit form (today's default) -- only
      // present when this token was generated for a specific
      // PlannedSession, so the page can show "Session 2 of 3 -- estimated
      // 6-8 hours" for context.
      plannedSession: { select: { sessionNumber: true, estimatedHoursMin: true, estimatedHoursMax: true } },
    },
  });

  const stripeAccountId = depositForm ? await getChargeableConnectedAccountId(depositForm.inquiry.studioId) : null;
  const stripeConnected = stripeAccountId !== null;

  const invalidity = isExpiredOrInvalid(depositForm, stripeConnected);
  if (invalidity) {
    const status = invalidity.code === "invalid" ? 404 : 410;
    return res.status(status).json(invalidity);
  }

  const { inquiry } = depositForm!;

  res.json({
    clientFirstName: inquiry.client.firstName,
    studioName: inquiry.studio.name,
    studioSlug: inquiry.studio.slug,
    themePreset: inquiry.studio.settings?.themePreset ?? DEFAULT_THEME_PRESET,
    artistName: inquiry.assignedArtist?.user.name ?? null,
    artistAvatarUrl: inquiry.assignedArtist?.user.avatarUrl ?? null,
    appointmentStart: inquiry.appointment?.startTime ?? null,
    appointmentEnd: inquiry.appointment?.endTime ?? null,
    // Purely informational -- only meaningful once there's no real
    // appointment yet (a real one always takes precedence in the UI).
    proposedStartAt: depositForm!.proposedStartAt,
    proposedEndAt: depositForm!.proposedEndAt,
    depositAmount: depositForm!.depositAmount,
    feeAmount: depositForm!.feeAmount,
    totalCharged: depositForm!.totalCharged,
    // Shown alongside the total on the public deposit page when set (e.g.
    // Powder Brows' "$50 deposit + $10 processing fee") -- purely
    // informational, null for every service that doesn't set one.
    depositBreakdownNote: inquiry.service.depositBreakdownNote,
    // Multi-session planning: null for every un-planned deposit form.
    plannedSession: depositForm!.plannedSession
      ? {
          sessionNumber: depositForm!.plannedSession.sessionNumber,
          totalSessions: inquiry.plannedSessions.length,
          estimatedHoursMin: depositForm!.plannedSession.estimatedHoursMin,
          estimatedHoursMax: depositForm!.plannedSession.estimatedHoursMax,
        }
      : null,
    // Phase 7C: drives the frontend's state branching -- paidVia set means
    // "you've already paid" (a real success state, not an error, regardless
    // of expiration); otherwise, signed + Stripe connected means "show a
    // Pay Now button" instead of the sign form, and signed + Stripe NOT
    // connected means today's original "thanks, we'll collect it
    // separately" flow, unchanged.
    signedAt: depositForm!.signedAt,
    paidVia: depositForm!.paidVia,
    stripeConnected,
    terms: TERMS,
  });
});

publicRouter.patch("/sign/:token", async (req, res) => {
  const token = req.params.token as string;
  const body = req.body ?? {};
  const { signatureName, signatureData } = body;

  const depositForm = await prisma.depositForm.findUnique({
    where: { token },
    include: { inquiry: { select: { studioId: true } } },
  });

  if (!depositForm) {
    return res.status(404).json({ code: "invalid", error: "This link is invalid." });
  }

  // Checked explicitly here, ahead of isExpiredOrInvalid -- that shared
  // function deliberately treats an already-paid deposit as "not invalid"
  // (GET /verify needs to keep returning the full success shape so the
  // frontend can show a real "you've already paid" state), but signing
  // itself is a write action that must always be blocked once paid,
  // regardless of context.
  if (depositForm.paidVia) {
    return res.status(400).json({ error: "This deposit has already been paid." });
  }

  // stripeConnected: false here is deliberate, not a placeholder -- signing
  // itself must only ever happen once, regardless of Stripe status (unlike
  // GET /verify and POST /checkout-session below, where an already-signed,
  // Stripe-connected, unpaid form is a valid resumable state). Passing
  // false makes "already signed" correctly block a re-sign attempt no
  // matter whether Stripe is connected for this studio.
  const invalidity = isExpiredOrInvalid(depositForm, false);
  if (invalidity) {
    const status = invalidity.code === "invalid" ? 404 : 410;
    return res.status(status).json(invalidity);
  }

  const allAgreed = TERM_KEYS.every((key) => body[key] === true);
  if (!allAgreed) {
    return res.status(400).json({ error: "All terms must be agreed to." });
  }

  if (typeof signatureName !== "string" || signatureName.trim().length === 0) {
    return res.status(400).json({ error: "signatureName is required" });
  }

  if (typeof signatureData !== "string" || signatureData.trim().length === 0) {
    return res.status(400).json({ error: "signatureData is required" });
  }

  await prisma.depositForm.update({
    where: { id: depositForm!.id },
    data: {
      agreedNonRefundable: true,
      agreedLatePolicy: true,
      agreedNoShowForfeit: true,
      agreedNewDepositAfterNoShow: true,
      agreedRescheduleLimit: true,
      agreedExpiration: true,
      agreedIdAndVoucher: true,
      agreedAge18: true,
      signatureName: signatureName.trim(),
      signatureData,
      signedAt: new Date(),
    },
  });

  // Phase 7C: lets the frontend immediately follow up with
  // POST /:token/checkout-session and redirect to Stripe when connected --
  // a studio without Stripe connected gets today's original "thanks, we'll
  // collect it separately" screen, unchanged.
  const stripeAccountId = await getChargeableConnectedAccountId(depositForm!.inquiry.studioId);
  res.json({ success: true, stripeConnected: stripeAccountId !== null });
});

// Phase 7C: creates a real Stripe Checkout Session for this deposit --
// called right after signing (when Stripe is connected), and again if the
// client abandoned Stripe's own checkout page and returns to retry paying
// (GET /verify reports signedAt + stripeConnected so the frontend knows to
// show a "Pay Now" button rather than the sign form in that case). A fresh
// session is generated every time this is called, never reused -- Checkout
// Sessions expire on their own schedule, and generating a new one is
// simpler and more robust than trying to detect/resurrect a stale one.
publicRouter.post("/:token/checkout-session", async (req, res) => {
  const token = req.params.token as string;

  const depositForm = await prisma.depositForm.findUnique({
    where: { token },
    include: { inquiry: { select: { studioId: true } } },
  });

  if (!depositForm) {
    return res.status(404).json({ error: "This link is invalid." });
  }

  if (depositForm.paidVia) {
    return res.status(400).json({ error: "This deposit has already been paid." });
  }

  if (!depositForm.signedAt) {
    return res.status(400).json({ error: "Please sign the deposit agreement first." });
  }

  const stripeAccountId = await getChargeableConnectedAccountId(depositForm.inquiry.studioId);
  if (!stripeAccountId) {
    return res.status(400).json({ error: "Online payment isn't available for this studio right now." });
  }

  const totalCents = Math.round(depositForm.totalCharged * 100);

  let session;
  try {
    session = await createDirectChargeCheckoutSession({
      connectedAccountId: stripeAccountId,
      amountCents: totalCents,
      productName: "Deposit",
      successUrl: `${PUBLIC_APP_URL}/deposit/${token}?paid=1`,
      cancelUrl: `${PUBLIC_APP_URL}/deposit/${token}?canceled=1`,
      metadata: { depositFormId: depositForm.id },
    });
  } catch (err) {
    return res.status(502).json({ error: err instanceof Error ? err.message : "Failed to start Stripe checkout" });
  }

  await prisma.depositForm.update({
    where: { id: depositForm.id },
    data: { stripeCheckoutSessionId: session.id },
  });

  res.json({ url: session.url });
});

// Staff-facing: marking a deposit paid is a separate, authenticated step
// from the client signing -- money hasn't necessarily moved yet at sign
// time, this is what confirms it actually has.
const staffRouter = Router();

// Deposits ARE gift cards: paying one issues a gift card for the same tier
// amount the deposit form shows (depositAmount, not totalCharged -- the fee
// isn't part of what the client redeems later). The inquiry moves to
// SCHEDULING rather than CONFIRMED -- an appointment can't be created
// without an attached gift card (Phase 3), so scheduling has to come after
// the card exists, not before.
staffRouter.patch("/:id/mark-paid", requireAuth, requirePermission("deposits.markPaidManual"), async (req, res) => {
  const id = req.params.id as string;

  const depositForm = await prisma.depositForm.findUnique({ where: { id }, include: { inquiry: true } });
  if (!depositForm || depositForm.inquiry.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Deposit form not found" });
  }

  if (!depositForm.signedAt) {
    return res.status(400).json({ error: "This deposit form has not been signed yet" });
  }

  if (depositForm.paidManually) {
    return res.status(400).json({ error: "This deposit has already been marked as paid" });
  }

  // Guards against a double-issue if this route were ever somehow called
  // twice for the same deposit -- paidManually already guards it above, but
  // this is the more direct invariant for the gift card itself.
  if (depositForm.giftCardId) {
    return res.status(400).json({ error: "A gift card has already been issued for this deposit" });
  }

  const result = await issueGiftCardForPaidDeposit(id, "MANUAL", req.user!.userId);
  if (!result.ok) {
    return res.status(400).json({ error: result.error });
  }

  const updated = await prisma.depositForm.findUnique({ where: { id } });
  res.json({ ...updated, giftCardId: result.giftCardId });
});

// PDF export for audit/documentation. Gated the same way this data is
// already gated everywhere else it's viewed (embedded in GET
// /inquiries/:id, itself requirePermission("inquiries.view")) rather than
// inventing a new deposits.view key -- no route to view a DepositForm on
// its own existed before this. ARTIST gets inquiries.view by default but
// scoped to their own assigned projects (same convention as
// GET /inquiries/assigned-to-me and waivers.ts's own /:id/status route),
// enforced manually below since requirePermission itself only checks the
// studio-level toggle, not row ownership.
staffRouter.get("/:id/pdf", requireAuth, requirePermission("inquiries.view"), async (req, res) => {
  const id = req.params.id as string;

  const depositForm = await prisma.depositForm.findUnique({
    where: { id },
    include: {
      inquiry: {
        include: {
          client: { select: { firstName: true, lastName: true } },
          studio: { select: { name: true, logoUrl: true, settings: { select: { themePreset: true } } } },
          service: { select: { name: true } },
        },
      },
    },
  });

  if (!depositForm || depositForm.inquiry.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Deposit form not found" });
  }

  if (req.user!.role === Role.ARTIST) {
    const artist = await prisma.artist.findUnique({ where: { userId: req.user!.userId }, select: { id: true } });
    if (!artist || depositForm.inquiry.assignedArtistId !== artist.id) {
      return res.status(404).json({ error: "Deposit form not found" });
    }
  }

  if (!depositForm.signedAt) {
    return res.status(400).json({ error: "This deposit form has not been signed yet" });
  }

  const { inquiry } = depositForm;
  const themePreset = inquiry.studio.settings?.themePreset;
  const pdf = await generateDepositFormPdf({
    studioName: inquiry.studio.name,
    studioLogoUrl: inquiry.studio.logoUrl,
    accentColor: THEME_PRESET_ACCENT_COLORS[isValidThemePreset(themePreset) ? themePreset : DEFAULT_THEME_PRESET],
    clientName: `${inquiry.client.firstName} ${inquiry.client.lastName}`,
    inquiryTitle: `${inquiry.service.name} — ${inquiry.placement}`,
    sessionNumber: depositForm.sessionNumber,
    depositAmount: depositForm.depositAmount,
    feeAmount: depositForm.feeAmount,
    totalCharged: depositForm.totalCharged,
    terms: TERMS,
    signatureName: depositForm.signatureName,
    signatureData: depositForm.signatureData,
    signedAt: depositForm.signedAt,
  });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="deposit-form-${id}.pdf"`);
  res.send(pdf);
});

export { publicRouter, staffRouter };
