import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { Role } from "../../generated/prisma/enums";
import { DEFAULT_THEME_PRESET, THEME_PRESET_ACCENT_COLORS, isValidThemePreset } from "../lib/themePresets";
import { issueGiftCardForPaidDeposit, createDepositCheckoutSession, createOrRetrieveDepositPaymentIntent } from "../lib/deposits";
import { getChargeableConnectedAccountId } from "../lib/stripeConnect";
import { generateDepositFormPdf } from "../lib/pdf";
import { redactedSessionHours } from "../lib/plannedSessions";
import { getOrCreateClientConversation } from "../lib/conversations";
import { sendClientSms } from "../lib/clientSms";
import { emitInvalidation } from "../lib/realtime/registry";
import { callerBelongsToStudio, effectiveRoleAt, hasPermissionAt } from "../lib/artistAccess";
import { resolveRequestLocale, withLocale, persistClientLocale } from "../lib/contentTranslation";
import { shortenUrl } from "../lib/shortLinks";
import { PUBLIC_APP_URL, API_PUBLIC_URL } from "../lib/publicUrl";
import { serveDataUrl } from "./publicAssets";

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

// Multi-language public forms, Part 5: TERMS above is Finding 1's
// platform-owned copy (see the frontend's own deposit.terms dictionary for
// the display-side half of this) -- this is the Spanish counterpart, kept
// here rather than in lib/pdfStrings.ts since TERMS itself already lives in
// this file and termsForLocale is what actually gets snapshotted onto
// DepositForm.termsSnapshot at sign time, not just used for PDF chrome.
// Keys must match TERMS exactly; termsForLocale below is the only place
// that reads this map, so a missing key surfaces as English text rather
// than a runtime crash.
const TERMS_ES: Record<(typeof TERM_KEYS)[number], string> = {
  agreedNonRefundable:
    "Se requiere un depósito para fijar una cita. Los depósitos no son reembolsables y se aplican al precio final del tatuaje.",
  agreedLatePolicy:
    "Los artistas se reservan el derecho de reprogramar la cita si el cliente llega con más de 15 minutos de retraso sin previo aviso.",
  agreedNoShowForfeit:
    "La falta de asistencia sin aviso previo resulta en la pérdida del depósito. Se requiere un aviso de 48 horas para cambiar una cita programada.",
  agreedNewDepositAfterNoShow:
    "Después de una falta de asistencia sin aviso previo, se requiere un nuevo depósito para programar otra cita.",
  agreedRescheduleLimit:
    "Las citas pueden reprogramarse hasta 3 veces; el depósito se pierde en la tercera reprogramación.",
  agreedExpiration: "Los depósitos vencen un año después de la fecha en que fueron creados.",
  agreedIdAndVoucher:
    "El cliente debe traer una identificación oficial con fotografía y el comprobante de depósito (emitido después del pago) el día de la cita.",
  agreedAge18: "El cliente reconfirma que tiene al menos 18 años de edad.",
};

// The exact wording shown to the client at sign time, snapshotted onto
// DepositForm.termsSnapshot -- so a later edit to TERMS/TERMS_ES never
// retroactively changes what an already-signed deposit form appears to say
// (same guarantee LiabilityWaiver's own snapshots already provide).
function termsForLocale(locale: string): { key: string; label: string }[] {
  if (locale === "es") {
    return TERMS.map((t) => ({ key: t.key, label: TERMS_ES[t.key] }));
  }
  return TERMS.map((t) => ({ key: t.key, label: t.label }));
}

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
          studio: {
            include: {
              settings: {
                select: {
                  themePreset: true,
                  referralProgramEnabled: true,
                  embeddedPaymentsEnabled: true,
                  defaultLocale: true,
                  timezone: true,
                },
              },
              // Confirmation-screen appointment card: no Appointment/
              // Inquiry/Artist row anywhere in this schema carries a
              // locationId (only User.locationId exists, unused by any
              // listing route today -- see lib/schedulingAssistant.ts's own
              // comment on this exact gap). This is only fetched to support
              // the "studio has exactly one location" fallback below, never
              // to pick among several.
              locations: { select: { id: true, address: true } },
            },
          },
          assignedArtist: {
            include: {
              // The one real per-artist location signal that exists --
              // preferred over the studio-has-one-location fallback below
              // when set, since it's more specific. name/avatarUrl are the
              // only other user fields this route ever reads (artistName/
              // artistAvatarUrl/artistPublicAvatarUrl below).
              user: { select: { name: true, avatarUrl: true, location: { select: { address: true } } } },
            },
          },
          appointment: { select: { startTime: true, endTime: true } },
          // translations: tiny (at most a couple of locales per studio) --
          // fetched in full and matched in JS rather than a second
          // locale-filtered query, same as every other public verify
          // route this epic touches.
          service: { select: { depositBreakdownNote: true, translations: true } },
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
      plannedSession: {
        select: {
          sessionNumber: true,
          estimatedHoursMin: true,
          estimatedHoursMax: true,
          showDurationToClient: true,
          // Confirmation-screen fix: a planned session's own auto-booked
          // (or already-booked) appointment is NEVER reflected on
          // Inquiry.appointmentId -- that legacy singular slot is only
          // ever set for a project's first-ever appointment
          // (issueGiftCardForPaidDeposit's own comment on this). Without
          // this, session 2+'s confirmation screen would show session 1's
          // time (or nothing), not the session this payment just booked.
          appointment: { select: { startTime: true, endTime: true } },
        },
      },
      // Confirmation-screen enrichment: null until paid (issued fresh by
      // issueGiftCardForPaidDeposit at payment time), so this is also the
      // natural "has this been paid" signal for the gift-card card below.
      giftCard: { select: { code: true, amountCents: true, expiresAt: true } },
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

  // Multi-language public forms: the only studio-authored content on this
  // page is the service's own depositBreakdownNote -- studio name/logo,
  // artist name, and the 8 terms are either plain data or platform
  // strings (see deposit.terms in the frontend's own dictionary for the
  // terms' own Finding-1 treatment).
  const locale = resolveRequestLocale(req.query.locale, inquiry.client.preferredLocale, inquiry.studio.settings?.defaultLocale);
  const serviceTranslation = inquiry.service.translations.find((t) => t.locale === locale);
  const localizedService = withLocale(inquiry.service, serviceTranslation, ["depositBreakdownNote"]);

  // Multi-session-aware appointment resolution: a planned session's own
  // resulting appointment (auto-booked, or already-booked via self-
  // schedule+approve) is never reflected on Inquiry.appointmentId -- only
  // via PlannedSession.appointmentId. Falls back to the legacy singular
  // Inquiry.appointmentId for every un-planned deposit form, which covers
  // both the classic first-session flow and self-schedule+approve (both
  // set that field). Both null means genuinely not-yet-confirmed --
  // either no proposed time was ever picked, or auto-book hit a
  // scheduling conflict and never created an Appointment at all (see
  // issueGiftCardForPaidDeposit's own comment on that derivation).
  const resolvedAppointment = depositForm!.plannedSession?.appointment ?? inquiry.appointment ?? null;

  // Best-effort address -- see the query's own comment above on why this
  // can't be a clean per-appointment lookup. Prefer the assigned artist's
  // own location; only guess from "the studio has exactly one location"
  // when that's not set; omit entirely rather than guess wrong for a
  // multi-location studio with no artist-location signal.
  const resolvedAddress =
    inquiry.assignedArtist?.user.location?.address ??
    (inquiry.studio.locations.length === 1 ? inquiry.studio.locations[0].address : null) ??
    null;

  // Gift-card card: only ever non-null once paid (issued fresh at payment
  // time). Shortened the same way every other gift-card link in this app
  // already is (deposits.ts's own referral-reward SMS, giftCards.ts's
  // text-receipt action) -- shortenUrl is idempotent by target URL, so
  // this never creates a duplicate ShortLink row on a repeat page load.
  const giftCard = depositForm!.giftCard;
  const giftCardPublicUrl = giftCard ? await shortenUrl(`${PUBLIC_APP_URL}/gift-card/${giftCard.code}`) : null;

  // Hero avatar: deliberately NOT the raw artistAvatarUrl below (a
  // potentially large inline data: URL, already used unconditionally by
  // the pre-payment agreement screen, left untouched) -- a real cacheable
  // image URL instead. FIXED: originally routed through the publicAssets
  // artist-avatar endpoint (keyed by publicSlug, gated on publishedAt) --
  // that gate is for the SEPARATE opt-in public marketing/booking page,
  // and 404s for any artist who hasn't set that up, which is the common
  // case, not the exception (confirmed live against a real production
  // artist with a real avatarUrl on file and publicSlug/publishedAt both
  // null). Scoped by this deposit's own token instead (this route's own
  // new GET /:token/artist-avatar, right above /verify) -- the same
  // credential that already governs the raw avatarUrl exposure elsewhere
  // on this page, so this isn't wider exposure, just a cacheable URL for
  // the same information. Still null (initials fallback) whenever there's
  // genuinely no avatar to serve.
  // API_PUBLIC_URL, not PUBLIC_APP_URL -- this endpoint lives on the API
  // server (a genuinely different domain from the web frontend, see
  // lib/publicUrl.ts's own comment), unlike every other link this route
  // builds (gift-card page, etc.), which all correctly point at the web app.
  const artistPublicAvatarUrl = inquiry.assignedArtist?.user.avatarUrl
    ? `${API_PUBLIC_URL}/deposits/${token}/artist-avatar`
    : null;

  res.json({
    resolvedLocale: locale,
    clientFirstName: inquiry.client.firstName,
    // Surfaced on the "your deposit is paid" success state, only when the
    // studio's referral program is actually on -- reuses the code already
    // generated at this client's own creation, not a new code system (see
    // referrals.ts). Default true (StudioSettings.referralProgramEnabled)
    // matches every studio's always-on behavior before this flag existed.
    clientReferralCode: inquiry.client.referralCode,
    referralProgramEnabled: inquiry.studio.settings?.referralProgramEnabled ?? true,
    studioName: inquiry.studio.name,
    studioSlug: inquiry.studio.slug,
    // OG-preview infra: same field the pre-sign verify response already
    // returns further down this file -- was missing here, so a deposit
    // link's preview fell back to the platform's generic mark for every
    // studio once the client had already signed, not just before.
    studioLogoUrl: inquiry.studio.logoUrl,
    themePreset: inquiry.studio.settings?.themePreset ?? DEFAULT_THEME_PRESET,
    artistName: inquiry.assignedArtist?.user.name ?? null,
    artistAvatarUrl: inquiry.assignedArtist?.user.avatarUrl ?? null,
    // Confirmation screen: a real cacheable image URL for the hero
    // specifically -- see the resolution comment above for why this is a
    // separate field from artistAvatarUrl, not a replacement for it.
    artistPublicAvatarUrl,
    appointmentStart: resolvedAppointment?.startTime ?? null,
    appointmentEnd: resolvedAppointment?.endTime ?? null,
    // Purely informational -- only meaningful once there's no real
    // appointment yet (a real one always takes precedence in the UI).
    proposedStartAt: depositForm!.proposedStartAt,
    proposedEndAt: depositForm!.proposedEndAt,
    // Confirmation screen: IANA identifier, always present (StudioSettings
    // itself defaults to "America/New_York") -- the appointment card
    // states the timezone explicitly rather than letting a client assume
    // it's in their own.
    studioTimezone: inquiry.studio.settings?.timezone ?? "America/New_York",
    studioAddress: resolvedAddress,
    // Confirmation screen: null until paid. amountCents is the deposit
    // amount the card was issued for (see issueGiftCardForPaidDeposit),
    // not necessarily depositAmount below if a future issuance path ever
    // diverges -- read from the card's own row, not re-derived.
    giftCard: giftCard
      ? { code: giftCard.code, amountCents: giftCard.amountCents, expiresAt: giftCard.expiresAt, publicUrl: giftCardPublicUrl }
      : null,
    depositAmount: depositForm!.depositAmount,
    feeAmount: depositForm!.feeAmount,
    totalCharged: depositForm!.totalCharged,
    // Shown alongside the total on the public deposit page when set (e.g.
    // Powder Brows' "$50 deposit + $10 processing fee") -- purely
    // informational, null for every service that doesn't set one.
    depositBreakdownNote: localizedService.depositBreakdownNote,
    // Multi-session planning: null for every un-planned deposit form.
    plannedSession: depositForm!.plannedSession
      ? {
          sessionNumber: depositForm!.plannedSession.sessionNumber,
          totalSessions: inquiry.plannedSessions.length,
          ...redactedSessionHours(depositForm!.plannedSession),
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
    // Embedded payments migration: drives whether the frontend mounts a
    // Payment Element inline or falls back to today's redirect-to-Stripe-
    // Checkout button. Independent of stripeConnected -- a studio can be
    // Stripe-connected without this flag on (the default), in which case
    // behavior is byte-for-byte what it was before this migration.
    embeddedPaymentsEnabled: inquiry.studio.settings?.embeddedPaymentsEnabled ?? false,
    terms: TERMS,
  });
});

// Multi-language public forms, Part 5: the language picker's own
// persistence -- fired the moment a client toggles it, so every later
// link (a future deposit, waiver, estimate...) for this same client
// defaults to their own choice. Reuses this exact same token-scoped
// pattern (CLAUDE.md's own "public unauthenticated flows" rule) rather
// than inventing a new mechanism.
publicRouter.patch("/:token/locale", async (req, res) => {
  const token = req.params.token as string;
  const depositForm = await prisma.depositForm.findUnique({ where: { token }, select: { inquiry: { select: { clientId: true } } } });
  if (!depositForm) {
    return res.status(404).json({ error: "This link is invalid." });
  }
  const result = await persistClientLocale(depositForm.inquiry.clientId, req.body?.locale);
  if (!result.ok) {
    return res.status(400).json({ error: result.error });
  }
  res.json({ success: true });
});

// Confirmation-screen hero avatar, fixed: the publicAssets artist-avatar
// endpoint (keyed by publicSlug, gated on publishedAt) only ever serves an
// artist who's opted into the SEPARATE public marketing/booking page --
// most real artists never do that, so it 404s for exactly the common case
// (confirmed live against production: a real studio's real artist, real
// avatarUrl on file, publicSlug/publishedAt both null). Scoped by this
// deposit's own token instead -- the same credential that already governs
// every other field on this page (including the raw artistAvatarUrl the
// pre-payment screen shows unconditionally), so this isn't a new/wider
// exposure, just the same information at a real cacheable URL instead of
// inline in the JSON payload. No expiry check (matching publicAssets.ts's
// own simplicity) -- an artist's photo isn't sensitive enough to warrant
// it, and a stale/expired token still identifies the same real deposit row.
publicRouter.get("/:token/artist-avatar", async (req, res) => {
  const token = req.params.token as string;

  const depositForm = await prisma.depositForm.findUnique({
    where: { token },
    select: { inquiry: { select: { assignedArtist: { select: { user: { select: { avatarUrl: true } } } } } } },
  });

  const avatarUrl = depositForm?.inquiry.assignedArtist?.user.avatarUrl;
  if (!avatarUrl || !serveDataUrl(res, avatarUrl)) {
    res.status(404).end();
  }
});

publicRouter.patch("/sign/:token", async (req, res) => {
  const token = req.params.token as string;
  const body = req.body ?? {};
  const { signatureName, signatureData } = body;

  const depositForm = await prisma.depositForm.findUnique({
    where: { token },
    include: {
      inquiry: {
        select: {
          studioId: true,
          client: { select: { preferredLocale: true } },
          studio: { select: { settings: { select: { defaultLocale: true } } } },
        },
      },
    },
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

  // Multi-language public forms, Part 5: captured at the moment of signing,
  // not re-derived later -- same reasoning as every other signed-document
  // snapshot in this codebase (see termsForLocale's own comment above).
  const signedLocale = resolveRequestLocale(
    req.query.locale,
    depositForm!.inquiry.client.preferredLocale,
    depositForm!.inquiry.studio.settings?.defaultLocale,
  );

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
      signedLocale,
      termsSnapshot: termsForLocale(signedLocale),
    },
  });

  // Phase 7C: lets the frontend immediately follow up with
  // POST /:token/checkout-session and redirect to Stripe when connected --
  // a studio without Stripe connected gets today's original "thanks, we'll
  // collect it separately" screen, unchanged.
  const stripeAccountId = await getChargeableConnectedAccountId(depositForm!.inquiry.studioId);

  // Real-time audit (Part 2): a client signing is entirely out-of-band from
  // any staff action -- without this, staff watching the project's Deposit
  // widget never saw "Signed, awaiting payment" appear live.
  emitInvalidation({ type: "inquiry.updated", studioId: depositForm!.inquiry.studioId, inquiryId: depositForm!.inquiryId });

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

  const depositForm = await prisma.depositForm.findUnique({ where: { token }, select: { id: true } });
  if (!depositForm) {
    return res.status(404).json({ error: "This link is invalid." });
  }

  const result = await createDepositCheckoutSession(depositForm.id);
  if (!result.ok) {
    return res.status(result.status).json({ error: result.error });
  }

  res.json({ url: result.url });
});

// Embedded payments migration: the Payment Element sibling of
// POST /:token/checkout-session above -- same call sites (right after
// signing, and again on reload/retry), fetch-or-create instead of
// always-create (see createOrRetrieveDepositPaymentIntent's own comment).
// Only reachable when the studio has actually turned the flag on;
// GET /verify's own embeddedPaymentsEnabled field is what the frontend
// checks BEFORE ever calling this, but this route enforces the same gate
// independently rather than trusting the frontend's own branching.
publicRouter.post("/:token/payment-intent", async (req, res) => {
  const token = req.params.token as string;

  const depositForm = await prisma.depositForm.findUnique({ where: { token }, select: { id: true } });
  if (!depositForm) {
    return res.status(404).json({ error: "This link is invalid." });
  }

  const result = await createOrRetrieveDepositPaymentIntent(depositForm.id);
  if (!result.ok) {
    return res.status(result.status).json({ error: result.error });
  }

  res.json({ clientSecret: result.clientSecret, connectedAccountId: result.connectedAccountId });
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
staffRouter.patch("/:id/mark-paid", requireAuth, async (req, res) => {
  const id = req.params.id as string;

  const depositForm = await prisma.depositForm.findUnique({ where: { id }, include: { inquiry: true } });
  // Permission-context fix prerequisite: this 404 check was a plain
  // equality against the caller's own home studio -- upgraded to
  // callerBelongsToStudio (HOME or active GUEST) so a legitimately
  // guest-assigned artist granted deposits.markPaidManual isn't 404'd
  // before the permission check below ever runs, matching every other
  // record-scoped route in this codebase.
  if (!depositForm || !(await callerBelongsToStudio(req.user!, depositForm.inquiry.studioId))) {
    return res.status(404).json({ error: "Deposit form not found" });
  }

  // Permission-context fix: evaluated at the deposit form's own inquiry's studio.
  if (!(await hasPermissionAt(req.user!, depositForm.inquiry.studioId, "deposits.markPaidManual"))) {
    return res.status(403).json({ error: "Forbidden" });
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

  emitInvalidation({ type: "inquiry.updated", studioId: depositForm.inquiry.studioId, inquiryId: depositForm.inquiryId });

  const updated = await prisma.depositForm.findUnique({ where: { id } });
  res.json({ ...updated, giftCardId: result.giftCardId });
});

// Phase 7D: lets staff generate (or regenerate) the client's Stripe payment
// link and text it over again -- for when the client signed the deposit
// agreement, then navigated away before finishing (or never reaching)
// Stripe's own checkout page. Same gate as the deposit-form send/resend
// actions (POST /inquiries/:id/deposit-form) since this is conceptually
// the same tier of action on the same entity, not a new capability.
staffRouter.post(
  "/:id/checkout-link",
  requireAuth,
  async (req, res) => {
    const id = req.params.id as string;

    const depositForm = await prisma.depositForm.findUnique({
      where: { id },
      include: { inquiry: { select: { studioId: true, clientId: true, client: { select: { firstName: true } } } } },
    });

    // Permission-context fix prerequisite: upgraded from a plain equality
    // against the caller's own home studio to callerBelongsToStudio, same
    // reasoning as PATCH /:id/mark-paid above.
    if (!depositForm || !(await callerBelongsToStudio(req.user!, depositForm.inquiry.studioId))) {
      return res.status(404).json({ error: "Deposit form not found" });
    }

    // Permission-context fix: evaluated at the deposit form's own inquiry's studio.
    if (!(await hasPermissionAt(req.user!, depositForm.inquiry.studioId, "inquiries.edit"))) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const result = await createDepositCheckoutSession(id);
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error });
    }

    // Best-effort, same convention as every other "resend a link" action in
    // this codebase (POST /inquiries/:id/deposit-form's own depositSendResult)
    // -- the link is already generated above regardless of whether the text
    // goes out, so staff still has result.url to share manually if this
    // skips/fails. autoSend: false lets a future composer "insert into
    // draft" flow opt out, same as the estimate/deposit-form send routes.
    let sendResult: Awaited<ReturnType<typeof sendClientSms>> | null = null;
    if (req.body?.autoSend !== false) {
      const studio = await prisma.studio.findUnique({ where: { id: req.user!.studioId }, select: { name: true } });
      const conversation = await getOrCreateClientConversation(
        req.user!.studioId,
        depositForm.inquiry.clientId,
        req.user!.userId,
      );
      sendResult = await sendClientSms({
        studioId: req.user!.studioId,
        clientId: depositForm.inquiry.clientId,
        conversationId: conversation.conversation.id,
        body: `Hi ${depositForm.inquiry.client.firstName}, here's your payment link to complete your deposit for ${studio?.name ?? "our studio"}: ${result.url}`,
        actorUserId: req.user!.userId,
      });
    }

    res.json({ url: result.url, sendResult });
  },
);

// PDF export for audit/documentation. Gated the same way this data is
// already gated everywhere else it's viewed (embedded in GET
// /inquiries/:id, itself requirePermission("inquiries.view")) rather than
// inventing a new deposits.view key -- no route to view a DepositForm on
// its own existed before this. ARTIST gets inquiries.view by default but
// scoped to their own assigned projects (same convention as
// GET /inquiries/assigned-to-me and waivers.ts's own /:id/status route),
// enforced manually below since requirePermission itself only checks the
// studio-level toggle, not row ownership.
staffRouter.get("/:id/pdf", requireAuth, async (req, res) => {
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

  if (!depositForm) {
    return res.status(404).json({ error: "Deposit form not found" });
  }

  // Artist mobility bug fix, solo-guest fix: authorize against the
  // PROJECT's own studio (depositForm.inquiry.studioId) via the caller's
  // EFFECTIVE role there (effectiveRoleAt), not the caller's raw global
  // role or home studioId -- a guest artist's assigned project lives at a
  // studio that isn't their `user.studioId`, so a plain equality check
  // 404'd every legitimate guest-artist request before the ARTIST-specific
  // ownership check below even ran. Branching on raw `role === ARTIST` had
  // the same blind spot as every other primitive this fix touches: a solo
  // OWNER-with-Artist-profile guesting at this project's studio has global
  // role OWNER, so it took the plain-equality staff branch and 404'd even
  // though they're the project's actual assigned artist. effectiveRoleAt
  // resolves HOME-or-active-GUEST membership AND the correct per-studio
  // role in one call; staff (OWNER/FRONT_DESK with no Artist profile) get
  // identical behavior to before, since effectiveRoleAt reduces to the same
  // plain home-equality check for them.
  const roleAtProject = await effectiveRoleAt(req.user!, depositForm.inquiry.studioId);
  if (!roleAtProject) {
    return res.status(404).json({ error: "Deposit form not found" });
  }
  if (roleAtProject === Role.ARTIST) {
    const artist = await prisma.artist.findUnique({ where: { userId: req.user!.userId }, select: { id: true } });
    if (depositForm.inquiry.assignedArtistId !== artist?.id) {
      return res.status(404).json({ error: "Deposit form not found" });
    }
  }

  // Permission-context fix: evaluated at the deposit form's own inquiry's
  // studio, AFTER the ownership check above -- ordering matters: a caller
  // with no real relationship to this project must still see 404 (same as
  // before this fix), not 403, which would leak that the record exists.
  if (!(await hasPermissionAt(req.user!, depositForm.inquiry.studioId, "inquiries.view"))) {
    return res.status(403).json({ error: "Forbidden" });
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
    // Falls back to TERMS (today's live English) for any deposit form
    // signed before this snapshot existed -- termsSnapshot is null for
    // every one of those, never an empty array, so this fallback only ever
    // fires for genuinely pre-migration records.
    terms: (depositForm.termsSnapshot as unknown as { key: string; label: string }[] | null) ?? TERMS,
    signatureName: depositForm.signatureName,
    signatureData: depositForm.signatureData,
    signedAt: depositForm.signedAt,
    locale: depositForm.signedLocale,
  });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="deposit-form-${id}.pdf"`);
  res.send(pdf);
});

export { publicRouter, staffRouter };
