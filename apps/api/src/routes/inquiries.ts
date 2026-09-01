import { Router } from "express";
import crypto from "node:crypto";
import { prisma } from "../lib/prisma";
import {
  AppointmentStatus,
  Channel,
  FlashPieceStatus,
  FlashReviewMode,
  InquiryStatus,
  MessageChannel,
  MessageDirection,
} from "../../generated/prisma/enums";
import { Prisma } from "../../generated/prisma/client";
import { optionalAuth, requireAuth, requireRole } from "../middleware/auth";
import { Role } from "../../generated/prisma/enums";
import { hasPermission, requirePermission } from "../lib/permissions";
import { diffObjects, logAudit } from "../lib/audit";
import { validateGiftCardForAttachment, validateGiftCardsForAttachment } from "../lib/giftCards";
import { getOrCreateClientConversation, getOrCreateStaffConversation } from "../lib/conversations";
import { sendClientSms } from "../lib/clientSms";
import { sendClientEmail } from "../lib/clientEmail";
import { renderClientEmailHtml } from "../lib/emailTemplate";
import { shortenUrl } from "../lib/shortLinks";
import { isSupportedLocale } from "../lib/locale";
import { normalizePhone } from "../lib/phone";
import { syncPrimaryEmail, syncPrimaryPhone } from "../lib/clientContacts";
import { findBufferConflict, formatBufferWarning, resolveSchedulingBufferMs } from "../lib/schedulingConflict";
import { PUBLIC_APP_URL } from "../lib/publicUrl";
import { emitInvalidation, emitUserInvalidation } from "../lib/realtime/registry";
import { notifyInquiryAssigned } from "../lib/notifications";
import { approveFlashRequest } from "../lib/flashApproval";
import { resolveRequiredDepositCents, resolveDepositTiers } from "../lib/depositTiers";
import { generateAndSendDepositForm } from "../lib/deposits";
import { generateAndSendEstimate, saveEstimateDraft } from "../lib/estimates";
import { generateUniqueReferralCode } from "../lib/referrals";
import {
  studioHasActiveMembership,
  callerBelongsToStudio,
  hasPermissionAt,
  hasPermissionOrSoloArtistAt,
  rolesByStudioForCaller,
} from "../lib/artistAccess";
import {
  applyArtistFieldVisibility,
  getArtistFieldVisibility,
  getArtistFieldVisibilityForStudios,
} from "../lib/artistFieldVisibility";
import { SELF_SCHEDULE_TOKEN_TTL_DAYS } from "../lib/selfSchedule";
import { IntakeFieldKind } from "../../generated/prisma/enums";
import { NOTE_AUTHOR_SELECT, canModifyNote, isBlankHtml, isValidAttachments } from "../lib/notes";
import { getEffectiveIntakeFormFields, validateCustomFieldAnswers } from "../lib/intakeFormFields";
import { resolveIntakeForm } from "../lib/intakeForms";
import { resolveServiceForIntakeForm } from "../lib/services";
import { buildImageMeta, mergeImageMeta, resolveImageMeta } from "../lib/imageMeta";

const router = Router();

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

// Public: the intake form fetches a prefill draft by its capability token
// (never PII in the URL, just this opaque token) to populate matching
// fields before the client has typed anything. Invalid/expired/used tokens
// return a plain 404 -- the form falls back to loading empty, no error
// banner drama (this is a quiet nice-to-have, not a broken link).
router.get("/prefill/:token", async (req, res) => {
  const token = req.params.token as string;

  const draft = await prisma.prefillDraft.findUnique({ where: { token } });
  if (!draft || draft.usedAt || draft.expiresAt < new Date()) {
    return res.status(404).json({ error: "Not found" });
  }

  res.json({ payload: draft.payload });
});

// Public *and* staff: the intake form is unauthenticated and always hits
// this route with a studioSlug. Front desk logging a walk-in/phone inquiry
// on a customer's behalf (StaffInquiryForm) hits the same route while
// authenticated -- optionalAuth populates req.user in that case, which is
// used below both to skip the studioSlug requirement (the studio is
// already known from the JWT) and to attribute the create in the audit log.
// Either way this creates the Client (or reuses an existing one, matched by
// email within the studio) and the Inquiry together, so the studio's
// pipeline sees a single lead rather than a duplicate client every time the
// same person submits again.
router.post("/", optionalAuth, async (req, res) => {
  const body = req.body ?? {};
  const isStaffRequest = Boolean(req.user);

  // optionalAuth only distinguishes "was there a valid token" -- it doesn't
  // restrict which role that token belongs to. This route has no requireAuth
  // middleware to hang requirePermission off of (it's dual-purpose: public
  // intake form + authenticated staff walk-in log), so the permission check
  // is inline via hasPermission() directly, same public-only-carve-out
  // reasoning as the other in-route checks in this handler (custom-field
  // required-ness, etc.).
  if (isStaffRequest && !(await hasPermission(req.user!.studioId, req.user!.role, "inquiries.create"))) {
    return res.status(403).json({ error: "Forbidden" });
  }

  if (!isStaffRequest && (typeof body.studioSlug !== "string" || !body.studioSlug)) {
    return res.status(400).json({ error: "Missing required field(s): studioSlug" });
  }

  const studio = isStaffRequest
    ? await prisma.studio.findUnique({ where: { id: req.user!.studioId }, include: { settings: true } })
    : await prisma.studio.findUnique({ where: { slug: body.studioSlug }, include: { settings: true } });
  if (!studio) {
    return res.status(404).json({ error: "Studio not found" });
  }

  // Which of this studio's (possibly several) named forms this submission
  // is for -- a specific one by formSlug (public path only; staff logging
  // a walk-in/phone inquiry has no form-picker UI, so always resolves to
  // the studio's current default) or the default when omitted, same
  // resolution GET /studio-settings/public and POST /prefill-drafts use.
  const requestedFormSlug = !isStaffRequest && typeof body.formSlug === "string" ? body.formSlug : null;
  const form = await resolveIntakeForm(studio.id, requestedFormSlug);
  if (!form) {
    return res.status(404).json({ error: "Intake form not found" });
  }

  // Package Q (revised): every SYSTEM field on this FORM's live, configured
  // set drives what's required/shown here -- a field the studio has
  // disabled is dropped entirely (never validated, never extracted from
  // the body), the same list the public form itself rendered from. Two
  // keys have no data-safe "unspecified" value at the DB layer (Channel has
  // no such enum member; a NOT NULL Boolean can't represent "unanswered")
  // -- see the channel/hasBeenTattooedBefore handling below, documented in
  // REPORT.md as a deliberate judgment call.
  const liveFields = await getEffectiveIntakeFormFields(form.id);
  const enabledSystemFields = new Map(
    liveFields
      .filter((f) => f.fieldKind === IntakeFieldKind.SYSTEM && f.enabled && f.systemFieldKey)
      .map((f) => [f.systemFieldKey as string, f]),
  );
  const isShown = (key: string) => enabledSystemFields.has(key);
  const isRequired = (key: string) => enabledSystemFields.get(key)?.required ?? false;

  const missingLabels: string[] = [];
  const checkRequired = (key: string, present: boolean) => {
    if (isRequired(key) && !present) {
      missingLabels.push(enabledSystemFields.get(key)?.label ?? key);
    }
  };

  if (body.referenceImages !== undefined && !isStringArray(body.referenceImages)) {
    return res.status(400).json({ error: "referenceImages must be an array of strings" });
  }
  if (body.placementImages !== undefined && !isStringArray(body.placementImages)) {
    return res.status(400).json({ error: "placementImages must be an array of strings" });
  }
  if (body.hasBeenTattooedBefore !== undefined && typeof body.hasBeenTattooedBefore !== "boolean") {
    return res.status(400).json({ error: "hasBeenTattooedBefore must be a boolean" });
  }
  if (body.channel !== undefined && !Object.values(Channel).includes(body.channel)) {
    return res.status(400).json({ error: `channel must be one of: ${Object.values(Channel).join(", ")}` });
  }

  checkRequired("name", Boolean(body.firstName) && Boolean(body.lastName));
  checkRequired("email", Boolean(body.email));
  checkRequired("phone", Boolean(body.phone));
  checkRequired("referralSource", typeof body.channel === "string" && body.channel.length > 0);
  checkRequired("description", Boolean(body.description));
  checkRequired("colorOrBlackGrey", Boolean(body.colorOrBlackGrey));
  checkRequired("placement", Boolean(body.placement));
  checkRequired("size", Boolean(body.estimatedSize));
  checkRequired("preferredArtist", Boolean(body.preferredArtistId));
  checkRequired("budget", Boolean(body.budget));
  checkRequired("desiredTiming", Boolean(body.desiredTiming));
  // hasBeenTattooedBefore is a NOT NULL boolean column -- "required" here
  // means "must be explicitly answered", same as the old hardcoded check.
  checkRequired("hasBeenTattooedBefore", body.hasBeenTattooedBefore !== undefined);
  // Package I: both photo types default to required:true in
  // SYSTEM_FIELD_DEFAULTS, matching the old unconditional behavior --
  // unlike before, a studio can now deliberately relax this per-field.
  checkRequired("referenceImages", isStringArray(body.referenceImages) && body.referenceImages.length > 0);
  checkRequired("placementImages", isStringArray(body.placementImages) && body.placementImages.length > 0);

  if (missingLabels.length > 0) {
    return res.status(400).json({ error: `Missing required field(s): ${missingLabels.join(", ")}` });
  }

  // A2P 10DLC compliance (Twilio review fix): the PUBLIC intake form's
  // consent checkbox is unchecked-by-default and GENUINELY OPTIONAL -- it
  // is deliberately NOT a submit gate here, and must never become one
  // again. Forced consent (a submission that cannot go through without the
  // box ticked) is precisely what a carrier reviewer rejects; the earlier
  // version of this route returned 400 on an unticked box, which is the
  // defect this replaces. An unticked box submits normally and simply
  // records no consent (smsConsentGivenAt stays null), which every send
  // path then treats exactly like an opt-out -- see lib/clientSms.ts.
  //
  // The checkbox is still kept OUTSIDE the configurable field list on the
  // form itself (always rendered, fixed position, never reorderable or
  // disableable) -- what changed is that it no longer blocks submission.

  const firstName = isShown("name") && typeof body.firstName === "string" ? body.firstName.trim() : "";
  const lastName = isShown("name") && typeof body.lastName === "string" ? body.lastName.trim() : "";
  const email = isShown("email") && typeof body.email === "string" && body.email.trim() ? body.email.trim() : null;
  const phone = isShown("phone") && typeof body.phone === "string" && body.phone.trim() ? body.phone.trim() : null;
  // No enum member represents "unspecified" for channel, so a hidden/blank
  // referralSource field falls back to EMAIL rather than leaving the NOT
  // NULL column unfillable -- documented in REPORT.md, not spec'd
  // explicitly by the task.
  const channel: Channel = typeof body.channel === "string" && body.channel.length > 0 ? body.channel : Channel.EMAIL;
  const description = isShown("description") && typeof body.description === "string" ? body.description.trim() : "";
  const colorOrBlackGrey =
    isShown("colorOrBlackGrey") && typeof body.colorOrBlackGrey === "string" ? body.colorOrBlackGrey.trim() : "";
  const placement = isShown("placement") && typeof body.placement === "string" ? body.placement.trim() : "";
  const estimatedSize = isShown("size") && typeof body.estimatedSize === "string" ? body.estimatedSize.trim() : "";
  const hasBeenTattooedBefore =
    isShown("hasBeenTattooedBefore") && typeof body.hasBeenTattooedBefore === "boolean"
      ? body.hasBeenTattooedBefore
      : false;
  const budget = isShown("budget") && typeof body.budget === "string" && body.budget.trim() ? body.budget.trim() : null;
  const desiredTiming =
    isShown("desiredTiming") && typeof body.desiredTiming === "string" && body.desiredTiming.trim()
      ? body.desiredTiming.trim()
      : null;
  const preferredArtistId =
    isShown("preferredArtist") && typeof body.preferredArtistId === "string" && body.preferredArtistId
      ? body.preferredArtistId
      : null;
  const referenceImages = isShown("referenceImages") && isStringArray(body.referenceImages) ? body.referenceImages : [];
  const placementImages = isShown("placementImages") && isStringArray(body.placementImages) ? body.placementImages : [];
  const draftToken = body.draftToken;
  const smsConsent = body.smsConsent;
  const referralCode = body.referralCode;
  const submittedCustomFieldAnswers = body.customFieldAnswers;

  // A draft token riding along is optional and best-effort -- an invalid/
  // stale one (already used, expired, wrong studio) never blocks a real
  // submission, it's just not marked used.
  let draft: { id: string } | null = null;
  if (typeof draftToken === "string" && draftToken.length > 0) {
    const found = await prisma.prefillDraft.findUnique({ where: { token: draftToken } });
    if (found && found.studioId === studio.id && !found.usedAt && found.expiresAt >= new Date()) {
      draft = found;
    }
  }

  if (preferredArtistId) {
    const preferredArtist = await prisma.artist.findUnique({
      where: { id: preferredArtistId },
      include: { user: true },
    });

    // Same guest-artist allowance as the assign-artist route below --
    // public intake can list a studio's active GUEST artists as pickable
    // too (they already show up in the studio-facing artist picker), not
    // just HOME ones.
    const preferredArtistBelongsToStudio =
      preferredArtist != null &&
      (preferredArtist.user.studioId === studio.id || (await studioHasActiveMembership(studio.id, preferredArtist.id)));
    if (!preferredArtistBelongsToStudio) {
      return res.status(400).json({ error: "preferredArtistId must belong to this studio" });
    }
  }

  // 6a Epic Part 4: the artist's own public page's BOOK flow -- distinct
  // from preferredArtistId above, which is a soft, customer-stated
  // preference gated behind the studio's own intake-form field
  // configuration (isShown("preferredArtist")) and never auto-assigns.
  // Clicking through FROM the artist's own page is a deliberate,
  // artist-initiated deep link, not a generic form field a studio may or
  // may not have enabled -- so this ALWAYS assigns directly, regardless of
  // that studio's intake-form configuration, reusing the exact same
  // assignedArtistId/assignedAt/ARTIST_ASSIGNED shape PATCH /:id/assign's
  // own first-assignment branch already uses (see below), just applied at
  // creation instead of as a separate later staff action.
  let bookingArtistId: string | null = null;
  if (typeof body.bookingArtistId === "string" && body.bookingArtistId) {
    const bookingArtist = await prisma.artist.findUnique({ where: { id: body.bookingArtistId }, include: { user: true } });
    const bookingArtistBelongsToStudio =
      bookingArtist != null &&
      (bookingArtist.user.studioId === studio.id || (await studioHasActiveMembership(studio.id, bookingArtist.id)));
    if (!bookingArtistBelongsToStudio) {
      return res.status(400).json({ error: "bookingArtistId must belong to this studio" });
    }
    bookingArtistId = body.bookingArtistId;
  }

  // Package O: "A friend referred me" -- only meaningful for channel ===
  // REFERRAL (any referralCode riding along on a different channel is
  // ignored, not honored, so a client can't backdoor a referral relationship
  // in through e.g. "Instagram"). Scoped to this studio the same way every
  // other lookup here is -- a code from a different studio 404s exactly
  // like an unknown one, never leaking whether it exists elsewhere.
  let referrer: { id: string } | null = null;
  if (channel === Channel.REFERRAL) {
    // Referral program master toggle (StudioSettings.referralProgramEnabled,
    // default true) -- a studio that's turned the whole program off
    // shouldn't have this channel option honored even if a stale client
    // bundle (or a direct API call) still submits it. The frontend forms
    // (IntakeForm.tsx, StaffInquiryForm.tsx) already drop "A friend
    // referred them" from the channel picker entirely when this is off;
    // this is the backend's own defense-in-depth copy of that same rule.
    if (studio.settings?.referralProgramEnabled === false) {
      return res.status(400).json({ error: "This studio's referral program is not currently active." });
    }
    if (typeof referralCode !== "string" || referralCode.trim().length === 0) {
      return res.status(400).json({ error: "A friend's referral code is required for this option" });
    }
    referrer = await prisma.client.findFirst({
      where: { studioId: studio.id, referralCode: referralCode.trim().toUpperCase() },
      select: { id: true },
    });
    if (!referrer) {
      return res.status(400).json({ error: "We couldn't find that referral code" });
    }

    // Self-referral guard. An exact "same Client record" self-referral is
    // already structurally impossible here -- referredByClientId (below)
    // is only ever set while creating a brand-new Client row, whose id
    // doesn't exist yet and so can never equal referrer.id. The real gap
    // is the "second profile" case: the same person submits again with a
    // DIFFERENT email (or phone) than their existing record, so the
    // existingClient lookup below (email-then-phone, first match wins)
    // fails to match them to their own record, they get a second Client
    // row, and use their own code against it. Checked against BOTH the
    // referrer's current Client.email/phone scalars (email case-
    // insensitively, matching how it's stored -- unlike ClientEmail rows
    // below, the raw scalar is never lowercased at creation) AND their
    // full known-contacts history (ClientEmail/ClientPhone alias tables,
    // see clientContacts.ts) -- a referrer created via inbound SMS
    // (webhooks.ts) has no alias rows at all, so the scalar check alone
    // covers them, while a referrer with a past secondary email/phone
    // from a mass-import merge is only caught by the alias check.
    const normalizedEmail = email ? email.toLowerCase() : null;
    const normalizedPhone = phone ? normalizePhone(phone) : null;
    if (normalizedEmail || normalizedPhone) {
      const selfReferralMatch = await prisma.client.findFirst({
        where: {
          id: referrer.id,
          OR: [
            ...(normalizedEmail
              ? [
                  { email: { equals: normalizedEmail, mode: Prisma.QueryMode.insensitive } },
                  { emails: { some: { email: normalizedEmail } } },
                ]
              : []),
            ...(normalizedPhone ? [{ phone: normalizedPhone }, { phones: { some: { phone: normalizedPhone } } }] : []),
          ],
        },
        select: { id: true },
      });
      if (selfReferralMatch) {
        return res.status(400).json({ error: "You can't redeem your own referral code." });
      }
    }
  }

  // Package Q (revised): re-validated against THIS studio's own current
  // live field definitions -- never the submitting client's own claims
  // about what a question says/requires. Required-ness for CUSTOM fields
  // is only enforced on the PUBLIC path: StaffInquiryForm (a walk-in/phone
  // call logged on the client's behalf) has no UI for these questions at
  // all -- staff can't be blocked by a question they were never shown and
  // may not have thought to ask over the phone.
  const effectiveFields = isStaffRequest
    ? liveFields.map((f) => (f.fieldKind === IntakeFieldKind.CUSTOM ? { ...f, required: false } : f))
    : liveFields;
  const customFieldAnswersResult = validateCustomFieldAnswers(effectiveFields, submittedCustomFieldAnswers);
  if ("error" in customFieldAnswersResult) {
    return res.status(400).json({ error: customFieldAnswersResult.error });
  }

  // Staff can explicitly pick an existing client via StaffInquiryForm's own
  // search box (GET /clients/merge-search), rather than relying on this
  // form's typed email/phone happening to exactly match what's already on
  // file -- a typo, a different email the client used this time, or a
  // studio with email disabled can all defeat the fallback match below,
  // which is exactly the "walk-in gets logged as a brand-new client
  // instead of their existing one" gap this closes. Staff-only (the public
  // intake form has no client list to search, and shouldn't be able to
  // attach a submission to an arbitrary id it has no legitimate way to
  // know) -- ignored entirely on the public path rather than erroring, the
  // same treatment every other staff-only field on this dual-purpose route
  // gets.
  let pinnedClient: { id: string; studioId: string; smsConsentGivenAt: Date | null } | null = null;
  if (isStaffRequest && typeof body.existingClientId === "string" && body.existingClientId) {
    pinnedClient = await prisma.client.findUnique({
      where: { id: body.existingClientId },
      select: { id: true, studioId: true, smsConsentGivenAt: true },
    });
    if (!pinnedClient || pinnedClient.studioId !== studio.id) {
      return res.status(400).json({ error: "existingClientId must belong to your studio" });
    }
  }

  // Matched by whichever contact method the studio actually collected --
  // email first (the historical default), falling back to phone if email
  // was disabled/omitted, and treating the submission as a brand-new
  // client if neither is present (only reachable when a studio has
  // disabled BOTH being required, since at least one must stay enabled).
  const existingClient = pinnedClient
    ? pinnedClient
    : email
      ? await prisma.client.findFirst({ where: { studioId: studio.id, email } })
      : phone
        ? await prisma.client.findFirst({ where: { studioId: studio.id, phone: normalizePhone(phone) } })
        : null;

  // Consent is only ever SET here, never overwritten -- a returning
  // client's original consent timestamp (from whichever submission first
  // gave it) is preserved across every later one, staff or public.
  const givesConsentNow = !isStaffRequest && smsConsent === true;

  // Multi-language public forms, fix pass: intake has no Client to PATCH
  // .../locale against until this exact moment (see LanguagePicker's own
  // comment on why intake is the one flow that persists locale at
  // submission time instead) -- public path only, an explicit choice
  // always wins, same as persistClientLocale's own semantics elsewhere.
  const preferredLocale =
    !isStaffRequest && isSupportedLocale(body.preferredLocale) ? body.preferredLocale : null;

  let client;
  if (existingClient) {
    const updateData: Prisma.ClientUpdateInput = {
      ...(givesConsentNow && !existingClient.smsConsentGivenAt
        ? { smsConsentGivenAt: new Date(), smsConsentSource: "intake_form" }
        : {}),
      ...(preferredLocale ? { preferredLocale } : {}),
    };
    client = Object.keys(updateData).length > 0
      ? await prisma.client.update({ where: { id: existingClient.id }, data: updateData })
      : existingClient;
  } else {
    // Package O: referredByClientId is only ever set here, at the brand-new
    // client's own creation -- "a NEW client can enter someone else's
    // code" per the task's own framing. A returning client (the
    // existingClient branch above) already has an established identity;
    // retroactively attaching a referrer to them here would be meaningless
    // (their first deposit, if any, is long past) and isn't what this
    // channel option represents.
    const newClientReferralCode = await generateUniqueReferralCode();
    client = await prisma.$transaction(async (tx) => {
      const created = await tx.client.create({
        data: {
          studioId: studio.id,
          firstName,
          lastName,
          email,
          phone: phone ? normalizePhone(phone) : phone,
          referralCode: newClientReferralCode,
          referredByClientId: referrer?.id ?? null,
          preferredLocale,
          ...(givesConsentNow ? { smsConsentGivenAt: new Date(), smsConsentSource: "intake_form" } : {}),
        },
      });
      await syncPrimaryPhone(tx, created.id, created.phone);
      await syncPrimaryEmail(tx, created.id, created.email);
      return created;
    });
  }

  // uploadedById null on the public path -- the client submitted these
  // themselves, no authenticated staff user to attribute them to.
  const imageUploaderId = isStaffRequest ? req.user!.userId : null;

  // Service lines: which service this inquiry is for, derived from the
  // intake form it came through (every Service points at exactly one form)
  // -- see resolveServiceForIntakeForm's own comment for the "Tattoo"
  // fallback. Required as of the serviceId migration; there is always at
  // least a studio's own Tattoo service to fall back to, so this should
  // never actually be null in practice.
  const service = await resolveServiceForIntakeForm(studio.id, form.id);
  if (!service) {
    return res.status(500).json({ error: "This studio has no service configured -- contact support" });
  }

  const inquiry = await prisma.inquiry.create({
    data: {
      studioId: studio.id,
      clientId: client.id,
      intakeFormId: form.id,
      serviceId: service.id,
      // Service lines: a service with requiresCandidacyReview: true (e.g.
      // Powder Brows) lands in CANDIDACY_REVIEW instead of the default NEW
      // -- before the normal pricing/estimate stage. False (Tattoo) never
      // sets this, same default NEW as before this feature existed.
      // bookingArtistId (6a Epic Part 4) takes the SAME precedence a
      // studio's own manual first-assignment would (ARTIST_ASSIGNED),
      // except candidacy review still wins if this service requires it --
      // an orthogonal, pre-existing gate this deep link doesn't bypass,
      // even though the artist becomes assigned either way.
      status: service.requiresCandidacyReview
        ? InquiryStatus.CANDIDACY_REVIEW
        : bookingArtistId
          ? InquiryStatus.ARTIST_ASSIGNED
          : InquiryStatus.NEW,
      channel,
      description,
      colorOrBlackGrey,
      placement,
      estimatedSize,
      hasBeenTattooedBefore,
      budget,
      desiredTiming,
      preferredArtistId,
      assignedArtistId: bookingArtistId,
      assignedAt: bookingArtistId ? new Date() : null,
      referenceImages,
      placementImages,
      referenceImagesMeta: buildImageMeta(referenceImages, imageUploaderId) as unknown as Prisma.InputJsonValue,
      placementImagesMeta: buildImageMeta(placementImages, imageUploaderId) as unknown as Prisma.InputJsonValue,
      customFieldAnswers: customFieldAnswersResult.value as unknown as Prisma.InputJsonValue | undefined,
    },
  });

  if (draft) {
    await prisma.prefillDraft.update({ where: { id: draft.id }, data: { usedAt: new Date() } });
  }

  if (isStaffRequest) {
    await logAudit({
      studioId: studio.id,
      actorUserId: req.user!.userId,
      entityType: "Inquiry",
      entityId: inquiry.id,
      action: "create-by-staff",
      // clientId deliberately omitted -- this Inquiry's own Activity
      // History is only ever viewed already scoped to (and displaying) its
      // one client, so a raw client cuid here was never anything but
      // unresolved noise, unlike assignedArtistId (which genuinely
      // changes over the Inquiry's life and is worth diffing).
      changes: { channel },
    });
  }

  emitInvalidation({ type: "inquiry.created", studioId: studio.id });

  res.status(201).json(inquiry);
});

// Phase 7A: everything except the terminal enum values. Used by mark-lost
// (valid FROM any of these) and reopen (valid target TO any of these) --
// broader than coldLeadSweep.ts's own eligible-statuses list, since
// reopening a lost Projects-side inquiry (e.g. back to CONFIRMED) is
// legitimate and isn't the sweep's concern. TRANSFERRED joined
// CLOSED_LOST/COLD_LEAD here in the transfer-to-artist epic -- unlike
// those two, it has no reopen path at all (enforced separately, see
// POST /:id/reopen's own status check), but it still must not be a valid
// artist-assign/estimate-send target, same as any other terminal status.
const NON_TERMINAL_STATUSES: InquiryStatus[] = (Object.values(InquiryStatus) as InquiryStatus[]).filter(
  (s) => s !== InquiryStatus.CLOSED_LOST && s !== InquiryStatus.COLD_LEAD && s !== InquiryStatus.TRANSFERRED,
);

// The "converted to a Project" line, mirrored from apps/web's own
// PROJECTS_TAB_STATUSES (Inquiries.tsx) -- deposit paid through completed.
// Package H: once here, the estimate that got the client to pay is history,
// not a draft; PATCH /:id below rejects further edits to it.
const PROJECT_STATUSES: InquiryStatus[] = [InquiryStatus.SCHEDULING, InquiryStatus.WAITLISTED, InquiryStatus.CONFIRMED];

// Bug fix: DEPOSIT_PENDING is deliberately NOT part of PROJECT_STATUSES above
// (it stays on the Inquiries tab, not Projects -- see Inquiries.tsx's own
// INQUIRIES_TAB_STATUSES/PROJECTS_TAB_STATUSES split) but a deposit FORM
// already exists once an inquiry reaches it, same as every PROJECT_STATUSES
// stage. POST /:id/send-estimate unconditionally resets status back to
// AWAITING_CLIENT_RESPONSE -- correct for a first send or a BUDGET_NEGOTIATION
// back-and-forth (nothing downstream exists yet to break), but calling it on
// a DEPOSIT_PENDING inquiry silently regressed the pipeline backward past
// "Deposit requested" while leaving that already-generated deposit form
// (possibly already paid) sitting there untouched and now orphaned -- exactly
// the "editing the estimate doesn't work" report this fixes. This is the
// narrower "a deposit form already exists, only a reasoned revision is safe"
// line -- used ONLY to gate which of the two estimate-editing routes below is
// reachable, never to reclassify DEPOSIT_PENDING as a Project anywhere else.
const ESTIMATE_REVISION_ONLY_STATUSES: InquiryStatus[] = [InquiryStatus.DEPOSIT_PENDING, ...PROJECT_STATUSES];

const INQUIRY_INCLUDE = {
  // phones/emails (minimal -- just presence) added for the send-channel
  // picker's own availability check, which reads the real contact rows
  // rather than the singular email/phone scalars above -- those can drift
  // null even when a client genuinely has a phone/email on file (a real,
  // live-reproduced bug: POST /clients/:id/phones and /emails used to
  // never sync back to the scalar). Fixed at the write path too
  // (routes/clients.ts), but the read side stays defensive regardless.
  client: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      // A2P compliance: the send-channel picker (SendChannelButton) needs
      // both to decide whether SMS is even offerable for this client, and
      // to name the reason when it isn't. Consent is genuinely optional at
      // intake, so "phone on file, no consent" is an ordinary state.
      smsConsentGivenAt: true,
      smsOptedOutAt: true,
      phones: { select: { id: true } },
      emails: { select: { id: true } },
    },
  },
  transferredToStudio: { select: { id: true, name: true } },
  projectCompletedBy: { select: { id: true, name: true, email: true } },
  preferredArtist: { select: { id: true, user: { select: { name: true, email: true, avatarUrl: true } } } },
  // email/avatarUrl added for the Kanban board's card (Package E) --
  // renders through the shared ArtistAvatar component, which needs both to
  // avoid falling back to a raw email string. hourlyRateCents/flatRateCents
  // feed the estimate form's per-session price auto-suggestion.
  assignedArtist: {
    select: {
      id: true,
      hourlyRateCents: true,
      flatRateCents: true,
      // Flash requests + review mode expansion: InquiryDetail.tsx's own
      // FlashApprovalPanel needs this to know whether ITS Approve/Decline
      // buttons are actually actionable -- when this artist's own mode is
      // ARTIST, front desk's click would 403 (see this file's own
      // POST /:id/flash/approve comment).
      flashReviewMode: true,
      user: { select: { id: true, name: true, email: true, avatarUrl: true } },
    },
  },
  // View parity + studio-review mode: InquiryDetail.tsx's flash-approval
  // widget now renders the same FlashApprovalPanel MyFlashRequestDetail.tsx
  // does (art/price/duration), which needs this -- previously the widget
  // only had placement/placementImages off the Inquiry itself.
  flashPiece: {
    select: { title: true, imageUrl: true, priceCents: true, estimatedDurationMinutes: true, isOneOfOne: true },
  },
  appointment: { select: { id: true, startTime: true, endTime: true, status: true } },
  // UI-1 §3: every appointment/session under this project (1:many via
  // Appointment.inquiryId), for the project detail page's nested
  // Appointments section -- distinct from the singular `appointment`
  // above, which is only the original scheduling-flow slot.
  sessions: {
    select: {
      id: true,
      startTime: true,
      endTime: true,
      status: true,
      artist: { select: { id: true, user: { select: { name: true, email: true, avatarUrl: true } } } },
      // Project pipeline timeline: checkedOutAt (Session Complete) and the
      // waiver's own status (Waiver Verified) for whichever session is the
      // earliest not-yet-checked-out one -- derived client-side from this
      // same already-ordered (startTime asc) array, no separate fetch.
      checkedOutAt: true,
      // id/signedAt added (alongside the pre-existing status) so the
      // Project detail page's Appointments widget can offer the same
      // branded waiver PDF download ClientDetail.tsx already has -- still
      // no health answers/ID image/signature here, those stay behind
      // GET /waivers/:id's own OWNER/FRONT_DESK floor untouched.
      liabilityWaiver: { select: { id: true, status: true, signedAt: true } },
      // Package N: checkout/finished-tattoo photos, grouped by the session
      // that produced them -- this is what lets the Project page show
      // "Session 1 -- [date]" with its own photos rather than one flat
      // ungrouped gallery.
      photos: {
        select: {
          id: true,
          url: true,
          uploadedAt: true,
          uploadedBy: { select: { id: true, name: true, email: true } },
        },
        orderBy: { uploadedAt: "desc" },
      },
    },
    orderBy: { startTime: "asc" },
  },
  // Multi-session planning: purely additive -- empty for every project that
  // never declared more than one session at estimate time. Ordered by the
  // staff-declared sessionNumber, not creation order, since (unlike
  // depositForms below) generation order is deliberately unconstrained --
  // session 3's deposit form can be generated before session 2's.
  plannedSessions: {
    select: {
      id: true,
      sessionNumber: true,
      estimatedHoursMin: true,
      estimatedHoursMax: true,
      estimatedPriceLow: true,
      estimatedPriceHigh: true,
      // Flat-rate pricing: so the estimate-entry form can correctly seed
      // its per-session "hide duration from client" checkbox when
      // re-opening an existing plan for editing/revision.
      showDurationToClient: true,
      depositFormId: true,
      appointmentId: true,
      // proposedStartAt/proposedEndAt (Package [scheduling-auto-book]): lets
      // the frontend tell "genuinely not booked yet" apart from "was paid,
      // had a tentative time, and auto-booking hit a conflict" -- see
      // apps/web/src/pages/InquiryDetail.tsx's Session Plan widget.
      depositForm: {
        select: {
          id: true,
          signedAt: true,
          paidAt: true,
          paidManually: true,
          paidVia: true,
          proposedStartAt: true,
          proposedEndAt: true,
        },
      },
      appointment: { select: { id: true, startTime: true, endTime: true, status: true, checkedOutAt: true } },
    },
    orderBy: { sessionNumber: "asc" },
  },
  // Package M: one project can now have several, one per tattoo session --
  // oldest first, so the UI can label them "Session 1", "Session 2", etc.
  // in the order they were actually generated.
  depositForms: {
    select: {
      id: true,
      token: true,
      tokenExpiresAt: true,
      sessionNumber: true,
      depositAmount: true,
      feeAmount: true,
      totalCharged: true,
      signedAt: true,
      signatureName: true,
      signatureData: true,
      paidManually: true,
      paidAt: true,
      paidVia: true,
      proposedStartAt: true,
      proposedEndAt: true,
      // Session-Plan/DepositForm linkage bug fix: the Session Plan widget's
      // display now resolves each session's deposit status by sessionNumber
      // against this same flat list (never PlannedSession.depositFormId
      // alone -- see lib/deposits.ts's own send-guard comment for why that
      // FK can't be trusted), same as the guard already does server-side.
      // Two rows CAN legitimately share a sessionNumber (an un-planned form
      // generated before a plan existed, followed by a plan-generated one)
      // -- createdAt is what lets the frontend pick the latest, matching
      // the guard's own `orderBy: { createdAt: "desc" }`.
      createdAt: true,
      giftCard: { select: { id: true, code: true, amountCents: true, status: true } },
    },
    orderBy: { sessionNumber: "asc" },
  },
  // Service lines: pricingModel/depositModel drive how the frontend renders
  // and collects the price estimate/deposit for THIS inquiry (one flat
  // number vs. a range, flat deposit + breakdown note vs. tier lookup).
  service: {
    select: {
      id: true,
      name: true,
      pricingModel: true,
      depositModel: true,
      flatPriceCents: true,
      flatDepositCents: true,
      depositBreakdownNote: true,
      requiresCandidacyReview: true,
    },
  },
} as const;

// Artist-facing projection: used by GET /assigned-to-me (list) and
// GET /assigned-to-me/:id (single project detail) -- both scoped to
// assignedArtistId === the requesting artist's own id, never the full
// INQUIRY_INCLUDE above. Sessions/photos/notes are the artist's own working
// data for the tattoo (schedule, checkout photos, staff notes about the
// project) and are included in full; deposit/financial specifics are
// deliberately reduced to a signed/paid status only -- no dollar amounts,
// no signature image or name, no payment method, no gift card details --
// the same "operational status yes, financial specifics no" split
// reports.viewFinancial already draws for the Dashboard (see reports.ts).
const ARTIST_INQUIRY_SELECT = {
  id: true,
  channel: true,
  description: true,
  colorOrBlackGrey: true,
  placement: true,
  estimatedSize: true,
  hasBeenTattooedBefore: true,
  budget: true,
  desiredTiming: true,
  referenceImages: true,
  placementImages: true,
  createdAt: true,
  updatedAt: true,
  status: true,
  priceEstimateLow: true,
  priceEstimateHigh: true,
  timeEstimateHoursMin: true,
  timeEstimateHoursMax: true,
  projectCompletedAt: true,
  client: { select: { firstName: true, lastName: true } },
  assignedArtist: {
    // hourlyRateCents/flatRateCents: needed for the artist's own Approve
    // flow to get the same rate auto-suggestion staff's estimate builder
    // has always had (see EstimateFieldsEditor) -- an artist's own rate is
    // not one of the "outside the estimate they're authoring" financial
    // limits scoped elsewhere, since it's the exact number driving the
    // estimate they're entering right now.
    select: {
      id: true,
      hourlyRateCents: true,
      flatRateCents: true,
      user: { select: { id: true, name: true, email: true, avatarUrl: true } },
    },
  },
  // Artist mobility: lets both /assigned-to-me routes below tell the caller
  // which studio a project actually belongs to -- needed now that
  // /assigned-to-me/:id is also reachable by an OWNER whose own home
  // studio isn't necessarily this project's studio (see fromGuestStudio on
  // each route's own response).
  studio: { select: { id: true, name: true } },
  service: { select: { id: true, name: true, pricingModel: true } },
  appointment: { select: { id: true, startTime: true, endTime: true, status: true } },
  sessions: {
    select: {
      id: true,
      startTime: true,
      endTime: true,
      status: true,
      checkedOutAt: true,
      // Tipping: an artist's own tip is theirs to see regardless of this
      // studio's general "pricing & financial detail" visibility toggle --
      // deliberately NOT added to artistFieldVisibility's delete-list, so
      // this field always survives applyArtistFieldVisibility below.
      tipCents: true,
      liabilityWaiver: { select: { status: true } },
      photos: {
        select: { id: true, url: true, uploadedAt: true },
        orderBy: { uploadedAt: "desc" },
      },
    },
    orderBy: { startTime: "asc" },
  },
  plannedSessions: {
    select: {
      id: true,
      sessionNumber: true,
      estimatedHoursMin: true,
      estimatedHoursMax: true,
      estimatedPriceLow: true,
      estimatedPriceHigh: true,
      // Limited, same as depositForms below -- signed/paid status only.
      depositForm: { select: { signedAt: true, paidAt: true } },
    },
    orderBy: { sessionNumber: "asc" },
  },
  depositForms: {
    select: { id: true, sessionNumber: true, signedAt: true, paidAt: true, paidManually: true },
    orderBy: { sessionNumber: "asc" },
  },
  // New: InquiryNote has no artist/staff-only distinction in the schema
  // (see that model's own comment), so every note on the project is
  // included -- this is a deliberate widening (an artist previously had no
  // access to inquiry notes at all, regardless of permission), matching
  // the task's explicit request to let an artist review "notes" on their
  // own assigned project.
  notes: {
    // Only notes staff has explicitly marked visible -- see
    // InquiryNote.visibleToArtist's own schema comment. Everything else
    // (the studio-internal default) never reaches this response.
    where: { visibleToArtist: true },
    select: { id: true, bodyHtml: true, attachments: true, createdAt: true, author: NOTE_AUTHOR_SELECT },
    orderBy: { createdAt: "desc" },
  },
} as const;

// The inbox list only renders these fields -- preferredArtist/depositForm
// are detail-page-only, so the list query skips them.
// updatedAt/priceEstimateLow/High/assignedArtist were added for the Kanban
// board's card (Package E): "time in this stage" (updatedAt), the estimate
// range, and the assigned artist's avatar+name -- the List view simply
// ignores fields it doesn't render.
// estimateSentAt/estimateOpenedAt (Package H): distinguishes "estimate sent,
// not opened yet" from "opened, awaiting response" on the List/Kanban views
// without a new stored status -- see deriveEstimateSubStatus below.
// appointment.startTime (Package H): the Projects tab's "Scheduled Date"
// column.
const INQUIRY_LIST_SELECT = {
  id: true,
  channel: true,
  description: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  priceEstimateLow: true,
  priceEstimateHigh: true,
  estimateSentAt: true,
  estimateOpenedAt: true,
  referenceImages: true,
  // Project pipeline stage (the list/Kanban status pill, mirrors
  // InquiryDetail.tsx's own Pipeline widget -- see deriveProjectStage in
  // lib/kanban.ts): the one field of the 5-stage derivation that isn't
  // reachable through a relation.
  projectCompletedAt: true,
  client: { select: { firstName: true, lastName: true } },
  assignedArtist: { select: { id: true, user: { select: { id: true, name: true, email: true, avatarUrl: true } } } },
  appointment: { select: { startTime: true } },
  // Needs Scheduling indicator + the Projects tab's "Scheduled Date" column
  // fallback: the newer 1:many "sessions under this project" link
  // (Appointment.inquiryId), which `appointment` above (the older 1:1
  // link) does NOT reflect for most projects scheduled through the current
  // multi-session flow -- `appointment` was usually null already, this
  // select just never had `sessions` to fall back to at all.
  // checkedOutAt/liabilityWaiver.status added alongside id/startTime for
  // the same project-stage derivation above -- previously only existence +
  // earliest date, not enough to tell Scheduled/Waiver Verified/Session
  // Complete apart.
  sessions: {
    select: { id: true, startTime: true, checkedOutAt: true, liabilityWaiver: { select: { status: true } } },
    orderBy: { startTime: "asc" },
  },
  // Service lines: MyInquiries.tsx's artist approve form and the Kanban
  // board both need pricingModel to know whether to collect/display one
  // flat price or a low/high range.
  service: { select: { id: true, name: true, pricingModel: true, depositModel: true, flatDepositCents: true, depositBreakdownNote: true } },
} as const;

// Excluded from the default inbox the same way merged clients are excluded
// from the client list -- fully intact, still reachable via GET /:id.
const NOT_ARCHIVED = { archivedAt: null } as const;

const SORT_OPTIONS = ["createdAt_desc", "createdAt_asc", "updatedAt_desc", "clientName_asc", "clientName_desc"] as const;
type SortOption = (typeof SORT_OPTIONS)[number];

function sortOrderBy(sort: SortOption): Prisma.InquiryOrderByWithRelationInput[] {
  switch (sort) {
    case "createdAt_asc":
      return [{ createdAt: "asc" }];
    case "updatedAt_desc":
      return [{ updatedAt: "desc" }];
    case "clientName_asc":
      return [{ client: { firstName: "asc" } }, { client: { lastName: "asc" } }];
    case "clientName_desc":
      return [{ client: { firstName: "desc" } }, { client: { lastName: "desc" } }];
    case "createdAt_desc":
    default:
      return [{ createdAt: "desc" }];
  }
}

// Artist mobility: JS-side counterpart to sortOrderBy, used only when
// merging a guest-studio sub-query's own already-DB-sorted rows into the
// home list below -- two separately-sorted arrays need a real merge/re-sort
// to interleave correctly, Prisma's `orderBy` only ever sorts within one
// `findMany` call.
function sortComparator(sort: SortOption): (a: InquirySortFields, b: InquirySortFields) => number {
  switch (sort) {
    case "createdAt_asc":
      return (a, b) => a.createdAt.getTime() - b.createdAt.getTime();
    case "updatedAt_desc":
      return (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime();
    case "clientName_asc":
      return (a, b) =>
        `${a.client.firstName} ${a.client.lastName}`.localeCompare(`${b.client.firstName} ${b.client.lastName}`);
    case "clientName_desc":
      return (a, b) =>
        `${b.client.firstName} ${b.client.lastName}`.localeCompare(`${a.client.firstName} ${a.client.lastName}`);
    case "createdAt_desc":
    default:
      return (a, b) => b.createdAt.getTime() - a.createdAt.getTime();
  }
}
interface InquirySortFields {
  createdAt: Date;
  updatedAt: Date;
  client: { firstName: string; lastName: string };
}

// Normalizes a query param that Express may hand back as a single string,
// an array (repeated ?key=a&key=b), or undefined -- every multi-select
// filter below (status, artistId) takes this same shape.
function queryStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  if (typeof value === "string" && value.length > 0) return [value];
  return [];
}

// Staff-facing inbox: every inquiry submitted for this studio. Package H:
// sort + multi-select status/artist filters + name/description search all
// moved server-side here (previously the whole studio's inquiries were
// fetched once and filtered/sorted client-side) -- the point isn't just
// performance, it's that filtering a full unpaginated fetch client-side
// silently stops being correct the moment `take` below ever needs
// lowering or real pagination gets added; a filter a client applies to
// only the first page it already has would quietly under-report matches
// that exist further back. Doing it in the query keeps that always true.
// The general, unfiltered list -- stays OWNER/FRONT_DESK-only regardless
// of the inquiries.view toggle. ARTIST's own version of "view" is fully
// served by the separately-scoped GET /assigned-to-me below (assignedArtistId
// === their own artist id); this route has no such scoping, so granting it
// via the same key ARTIST defaults to true for would let an artist see
// every inquiry in the studio, not just their own -- exactly the kind of
// default-widening this expansion's own "-own" convention exists to avoid.
router.get("/", requireAuth, requireRole(Role.OWNER, Role.FRONT_DESK), requirePermission("inquiries.view"), async (req, res) => {
  const { studioId } = req.user!;

  const statusValues = queryStringArray(req.query.status).filter((s): s is InquiryStatus =>
    (Object.values(InquiryStatus) as string[]).includes(s),
  );

  const artistValues = queryStringArray(req.query.artistId);
  const wantsUnassigned = artistValues.includes("unassigned");
  const artistIds = artistValues.filter((v) => v !== "unassigned");

  let artistWhere: Prisma.InquiryWhereInput | undefined;
  if (artistIds.length > 0 && wantsUnassigned) {
    artistWhere = { OR: [{ assignedArtistId: { in: artistIds } }, { assignedArtistId: null }] };
  } else if (artistIds.length > 0) {
    artistWhere = { assignedArtistId: { in: artistIds } };
  } else if (wantsUnassigned) {
    artistWhere = { assignedArtistId: null };
  }

  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  // Same multi-word AND-of-OR pattern as clients.ts's own search -- a
  // two-word query like "Emily Rodriguez" needs both words satisfied,
  // each by whichever field actually has it.
  const words = q.split(/\s+/).filter(Boolean);
  const searchWhere: Prisma.InquiryWhereInput | undefined =
    words.length > 0
      ? {
          AND: words.map((word) => {
            const contains = { contains: word, mode: "insensitive" as const };
            return {
              OR: [
                { description: contains },
                { client: { firstName: contains } },
                { client: { lastName: contains } },
              ],
            };
          }),
        }
      : undefined;

  const sortParam = typeof req.query.sort === "string" ? req.query.sort : "createdAt_desc";
  const sort: SortOption = (SORT_OPTIONS as readonly string[]).includes(sortParam)
    ? (sortParam as SortOption)
    : "createdAt_desc";

  const inquiries = await prisma.inquiry.findMany({
    where: {
      studioId,
      ...NOT_ARCHIVED,
      ...(statusValues.length > 0 ? { status: { in: statusValues } } : {}),
      ...(artistWhere ?? {}),
      ...(searchWhere ?? {}),
    },
    select: INQUIRY_LIST_SELECT,
    orderBy: sortOrderBy(sort),
    take: 100,
  });

  // Artist mobility: this caller may ALSO be an artist with active GUEST
  // memberships elsewhere -- if so, blend in whatever's assigned to them at
  // those studios too, so "my Inquiries & Projects page" isn't blind to
  // guest work the way it was before (assign-artist already accepted a
  // guest, nothing ever surfaced it back to them). No-op for the overwhelming
  // majority of callers (no Artist row, or none guesting anywhere), and
  // skipped outright when the caller's own artistId/unassigned filter
  // wouldn't have matched them anyway -- these rows are always assigned to
  // the caller by construction, never "unassigned" or a different artist.
  const requestingArtist = await prisma.artist.findUnique({ where: { userId: req.user!.userId }, select: { id: true } });
  const includeGuestAssignments =
    requestingArtist != null && !wantsUnassigned && (artistIds.length === 0 || artistIds.includes(requestingArtist.id));

  let combined: Array<(typeof inquiries)[number] & { fromGuestStudio: { id: string; name: string } | null }> = inquiries.map(
    (inquiry) => ({ ...inquiry, fromGuestStudio: null }),
  );

  if (includeGuestAssignments) {
    const guestMemberships = await prisma.studioMembership.findMany({
      where: { artistId: requestingArtist!.id, type: "GUEST", endedAt: null },
      select: { studioId: true },
    });

    if (guestMemberships.length > 0) {
      const guestStudioIds = guestMemberships.map((m) => m.studioId);
      const guestRows = await prisma.inquiry.findMany({
        where: {
          studioId: { in: guestStudioIds },
          assignedArtistId: requestingArtist!.id,
          ...NOT_ARCHIVED,
          ...(statusValues.length > 0 ? { status: { in: statusValues } } : {}),
          ...(searchWhere ?? {}),
        },
        select: { ...INQUIRY_LIST_SELECT, studio: { select: { id: true, name: true } } },
        orderBy: sortOrderBy(sort),
        take: 100,
      });

      // Phase 5: these rows describe a studio where THIS caller's
      // effective role is ARTIST (a guest membership, never a home
      // relationship) regardless of their real role at their own home --
      // same "effective role at the record's studio" rule the solo-guest
      // access fix established. Each row gets its OWN guest studio's
      // visibility settings, since a caller can guest at several studios
      // with different toggles at once.
      const visibilityByStudio = await getArtistFieldVisibilityForStudios(guestStudioIds);
      const guestInquiries = guestRows.map(({ studio, ...rest }) => ({
        ...applyArtistFieldVisibility(rest, visibilityByStudio.get(studio.id)!),
        fromGuestStudio: studio,
      }));
      combined = [...combined, ...guestInquiries].sort(sortComparator(sort)).slice(0, 100);
    }
  }

  res.json(combined);
});

// Artist-facing inbox: inquiries currently assigned to the requesting
// artist and awaiting their review. Registered before the "/:id" route
// below so Express doesn't try to match "assigned-to-me" as an :id.
//
// ?scope=all (Package E's Kanban board): an artist has zero access to
// GET / or GET /:id (both OWNER/FRONT_DESK-only) -- this is their ONLY
// window into inquiry data, so their filtered Kanban board reuses this
// same route with the ARTIST_ASSIGNED-only filter dropped, rather than
// opening up either staff-only route. Default (no scope param) behavior
// is completely unchanged, so MyInquiries.tsx's existing approve/decline
// inbox is unaffected.
// List/detail scoping consistency fix. This route previously carried the
// plain, home-studio-scoped requirePermission("inquiries.view") middleware
// and NO studio filter on the query at all -- assignedArtistId alone. Two
// things followed from that, both reproduced:
//
// 1. The list and its own detail route disagreed about WHERE a permission
//    is evaluated. The middleware read the caller's HOME studio's matrix;
//    GET /assigned-to-me/:id reads the RECORD's studio via hasPermissionAt.
//    An artist whose home grants inquiries.view but whose host studio
//    denies it for ARTIST could list every project assigned to them there
//    and get a 403 opening any of them -- and the inverse (home denies,
//    host grants) made a project they were fully entitled to open
//    unreachable, because the list it would be found in 403'd wholesale.
//
// 2. Worse, and not in the original report: with no studio filter, an
//    artist kept seeing a studio's projects after their GUEST membership
//    ENDED -- forever. That is the ghost-access bug class CLAUDE.md's
//    artist-scoping section exists for, and the same one the historical
//    GET /artists roster bug was. The detail route already closed it
//    (effectiveRoleAt returns null with no live membership, so
//    hasPermissionAt 403s); this list never did.
//
// Both close with one change: resolve the studios this caller has a LIVE
// relationship with and effectively holds inquiries.view at RIGHT NOW --
// evaluated per studio with their effective role there, exactly as the
// detail route does -- and scope the query to that set. The decision
// recorded in the architect thread is that the detail route's semantics
// win; this is the list matching them.
//
// The old 403-on-denied is deliberately preserved for the single-studio
// artist (the overwhelmingly common case): no qualifying studio at all
// still 403s rather than quietly returning an empty list. It only widens
// where it genuinely must -- a caller entitled at ONE of several studios
// now gets that studio's rows instead of a blanket 403.
router.get("/assigned-to-me", requireAuth, requireRole(Role.ARTIST), async (req, res) => {
  const artist = await prisma.artist.findUnique({ where: { userId: req.user!.userId } });
  if (!artist) {
    return res.json([]);
  }

  // Home + every ACTIVE membership, each with the effective role that
  // governs the caller THERE (home keeps their real role; every guest
  // studio is Role.ARTIST) -- one Artist lookup and one membership query,
  // not one round trip per studio.
  const rolesByStudio = await rolesByStudioForCaller(req.user!);
  const permissionChecks = await Promise.all(
    [...rolesByStudio].map(async ([sid, role]) => [sid, await hasPermission(sid, role, "inquiries.view")] as const),
  );
  const allowedStudioIds = permissionChecks.filter(([, allowed]) => allowed).map(([sid]) => sid);

  if (allowedStudioIds.length === 0) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const scopeAll = req.query.scope === "all";

  const inquiries = await prisma.inquiry.findMany({
    where: {
      assignedArtistId: artist.id,
      studioId: { in: allowedStudioIds },
      ...(scopeAll ? NOT_ARCHIVED : { status: InquiryStatus.ARTIST_ASSIGNED }),
    },
    select: ARTIST_INQUIRY_SELECT,
    orderBy: scopeAll ? { updatedAt: "desc" } : { assignedAt: "desc" },
  });

  // Phase 5: a single response can still span several studios with
  // different visibility settings (every studio in allowedStudioIds
  // above), so this stays batched per distinct studioId, not one lookup
  // per row.
  const visibilityByStudio = await getArtistFieldVisibilityForStudios(inquiries.map((i) => i.studio.id));

  // Same fromGuestStudio convention as GET / -- null for a project at the
  // caller's own home studio, { id, name } for one at a studio where
  // they're only an active GUEST (allowedStudioIds above spans both, so
  // both are still possible here).
  res.json(
    inquiries.map(({ studio, ...rest }) => ({
      ...applyArtistFieldVisibility(rest, visibilityByStudio.get(studio.id)!),
      fromGuestStudio: studio.id !== req.user!.studioId ? studio : null,
    })),
  );
});

// Single-project detail for the artist's own board (Kanban card click,
// direct URL/refresh) -- same ARTIST_INQUIRY_SELECT projection as the list
// above, scoped identically to assignedArtistId === their own artist id.
// Registered before the generic "/:id" below for the same reason
// "assigned-to-me" itself is.
//
// Artist mobility: also reachable by role OWNER, not just plain ARTIST --
// a solo studio's owner is role OWNER with their own attached Artist
// profile (soloStudio.ts), so this is the route their guest-studio project
// cards (blended into GET / above, see fromGuestStudio) link to for detail.
// Still scoped to assignedArtistId === their own artist id regardless of
// role, and still 404s cleanly for an OWNER with no Artist row at all.
router.get(
  "/assigned-to-me/:id",
  requireAuth,
  requireRole(Role.ARTIST, Role.OWNER),
  async (req, res) => {
    const artist = await prisma.artist.findUnique({ where: { userId: req.user!.userId } });
    if (!artist) {
      return res.status(404).json({ error: "Inquiry not found" });
    }

    const inquiry = await prisma.inquiry.findFirst({
      where: { id: req.params.id as string, assignedArtistId: artist.id },
      select: ARTIST_INQUIRY_SELECT,
    });

    if (!inquiry) {
      return res.status(404).json({ error: "Inquiry not found" });
    }

    // Permission-context fix: evaluated at the inquiry's own studio -- this
    // route can genuinely return a GUEST-studio inquiry (see
    // fromGuestStudio below), so view rights follow that studio, not the
    // caller's home.
    if (!(await hasPermissionAt(req.user!, inquiry.studio.id, "inquiries.view"))) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const { studio, ...rest } = inquiry;
    const visibility = await getArtistFieldVisibility(studio.id);
    res.json({
      ...applyArtistFieldVisibility(rest, visibility),
      fromGuestStudio: studio.id !== req.user!.studioId ? studio : null,
    });
  },
);

// Flash requests + artist review toggle: a deliberately separate,
// narrower detail route for MyFlashRequestDetail.tsx -- NOT a reuse of
// GET /assigned-to-me/:id just above, because that route is gated by
// hasPermissionAt(..., "inquiries.view"), a real matrix key some studios
// have toggled off for ARTIST (seen in this repo's own dev fixtures).
// This request is theirs alone to decide either way (same "inalienable,
// no matrix gates it" shape as POST /:id/flash/approve and /decline
// below), so the identity check itself -- assignedArtistId === their own
// artist id -- IS the entire authorization, same as those two routes.
// Registered before the generic "/:id" below for the same reason
// "assigned-to-me" is.
router.get("/my-flash-requests/:id", requireAuth, async (req, res) => {
  const artist = await prisma.artist.findUnique({ where: { userId: req.user!.userId } });
  if (!artist) {
    return res.status(404).json({ error: "Flash request not found" });
  }

  const inquiry = await prisma.inquiry.findFirst({
    where: { id: req.params.id as string, assignedArtistId: artist.id, flashPieceId: { not: null } },
    select: {
      id: true,
      status: true,
      placement: true,
      placementImages: true,
      createdAt: true,
      client: { select: { firstName: true, lastName: true } },
      flashPiece: {
        select: { title: true, imageUrl: true, priceCents: true, estimatedDurationMinutes: true, isOneOfOne: true },
      },
    },
  });

  if (!inquiry) {
    return res.status(404).json({ error: "Flash request not found" });
  }

  res.json(inquiry);
});

// Same reasoning as GET / above -- stays OWNER/FRONT_DESK-only regardless
// of the inquiries.view toggle; an artist's own inquiries are reached via
// GET /assigned-to-me instead, which has its own assignedArtistId scoping.
router.get("/:id", requireAuth, requireRole(Role.OWNER, Role.FRONT_DESK), requirePermission("inquiries.view"), async (req, res) => {
  const id = req.params.id as string;

  const inquiry = await prisma.inquiry.findUnique({ where: { id }, include: INQUIRY_INCLUDE });

  if (!inquiry || inquiry.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Inquiry not found" });
  }

  // Same shortLinks.shortenUrl every other public link on this server goes
  // through (SMS sends, the client-facing shareable-links composer) --
  // idempotent by target URL, so this returns the exact same short code
  // already handed out elsewhere for the same token, not a new one. The
  // page previously reconstructed a full-length `${origin}/estimate/...`
  // URL client-side from the raw token instead, which is what a client
  // actually saw if they opened the "Share this link" box on a page reload
  // rather than right after the initial send.
  const now = new Date();
  const estimateActive = !!(inquiry.estimateToken && inquiry.estimateTokenExpiresAt && inquiry.estimateTokenExpiresAt > now);
  const estimateUrl = estimateActive ? await shortenUrl(`${PUBLIC_APP_URL}/estimate/${inquiry.estimateToken}`) : null;

  // Same reasoning as estimateUrl above, for a Project's revised-estimate
  // link (POST /:id/revise-estimate) -- without this, the "share the link
  // below manually" fallback text on a resent revision had no actual link
  // to show once the initial POST response (which only lived in that
  // request's memory) was gone, e.g. after a page reload.
  const revisionActive = !!(
    inquiry.estimateRevisionToken &&
    inquiry.estimateRevisionTokenExpiresAt &&
    inquiry.estimateRevisionTokenExpiresAt > now
  );
  const revisionUrl = revisionActive
    ? await shortenUrl(`${PUBLIC_APP_URL}/estimate-revision/${inquiry.estimateRevisionToken}`)
    : null;

  const depositForms = await Promise.all(
    inquiry.depositForms.map(async (form) => {
      const active = !form.signedAt && form.tokenExpiresAt > now;
      return { ...form, url: active ? await shortenUrl(`${PUBLIC_APP_URL}/deposit/${form.token}`) : null };
    }),
  );

  // Read-only, resolved-metadata companions to the plain referenceImages/
  // placementImages arrays above -- those stay untouched (every edit/upload
  // call site still reads/writes the bare url list), these are additive,
  // for the detail page's display only.
  const [referenceImagesDetail, placementImagesDetail] = await Promise.all([
    resolveImageMeta(inquiry.referenceImages, inquiry.referenceImagesMeta),
    resolveImageMeta(inquiry.placementImages, inquiry.placementImagesMeta),
  ]);

  res.json({ ...inquiry, estimateUrl, revisionUrl, depositForms, referenceImagesDetail, placementImagesDetail });
});

// Detail-field edits only -- status transitions stay in their own dedicated
// routes above/below (assign, respond, schedule, waitlist), never here.
const REQUIRED_STRING_FIELDS = ["description", "colorOrBlackGrey", "placement", "estimatedSize"] as const;
const NULLABLE_STRING_FIELDS = ["budget", "desiredTiming"] as const;
const NUMERIC_FIELDS = [
  "priceEstimateLow",
  "priceEstimateHigh",
  "timeEstimateHoursMin",
  "timeEstimateHoursMax",
] as const;
const IMAGE_ARRAY_FIELDS = ["referenceImages", "placementImages"] as const;
const IMAGE_META_FIELDS = {
  referenceImages: "referenceImagesMeta",
  placementImages: "placementImagesMeta",
} as const;

router.patch("/:id", requireAuth, async (req, res) => {
  const id = req.params.id as string;
  const body = req.body ?? {};

  if ("status" in body) {
    return res.status(400).json({ error: "status cannot be changed through this route" });
  }

  const inquiry = await prisma.inquiry.findUnique({
    where: { id },
    include: { _count: { select: { plannedSessions: true } } },
  });
  if (!inquiry || !(await callerBelongsToStudio(req.user!, inquiry.studioId))) {
    return res.status(404).json({ error: "Inquiry not found" });
  }

  // Permission-context fix: evaluated at the inquiry's own studio.
  if (!(await hasPermissionAt(req.user!, inquiry.studioId, "inquiries.edit"))) {
    return res.status(403).json({ error: "Forbidden" });
  }

  // Package H: once converted to a Project, the estimate is what the
  // client actually paid a deposit against -- staff can still see it, but
  // editing it after the fact would silently rewrite the number the client
  // agreed to. Only blocks the estimate fields specifically; description/
  // placement/budget/etc. stay editable. Package L's InquiryNote entries
  // are a separate log with their own routes, not covered by this route.
  const editsEstimate = NUMERIC_FIELDS.some((field) => body[field] !== undefined);
  if (editsEstimate && PROJECT_STATUSES.includes(inquiry.status)) {
    return res.status(400).json({
      error: "The estimate can't be edited after this inquiry has converted to a Project (deposit already paid).",
    });
  }

  // Bug fix: once a real session plan exists, PlannedSession rows are the
  // only source of truth for these four fields -- send-estimate/
  // revise-estimate already null out (hours) or recompute-as-a-sum (price)
  // the top-level columns whenever a plan is declared, specifically so they
  // never drift out of sync with the sessions. This route had no such
  // awareness at all (it predates per-session planning) and could silently
  // overwrite either one directly, straight out of sync with the sessions,
  // regardless of status. Sessions -- via send-estimate/revise-estimate --
  // are the only sanctioned way to change these four fields from here on.
  if (editsEstimate && inquiry._count.plannedSessions > 0) {
    return res.status(400).json({
      error: "This inquiry has a session plan -- edit each session's own hours/price via Generate & Send Estimate or Revise Estimate instead.",
    });
  }

  const data: Record<string, string | number | null | string[] | Prisma.InputJsonValue> = {};

  for (const field of REQUIRED_STRING_FIELDS) {
    if (body[field] === undefined) continue;
    if (typeof body[field] !== "string" || body[field].trim().length === 0) {
      return res.status(400).json({ error: `${field} must be a non-empty string` });
    }
    data[field] = body[field].trim();
  }

  for (const field of NULLABLE_STRING_FIELDS) {
    if (body[field] === undefined) continue;
    if (body[field] !== null && typeof body[field] !== "string") {
      return res.status(400).json({ error: `${field} must be a string or null` });
    }
    data[field] = typeof body[field] === "string" ? body[field].trim() || null : null;
  }

  for (const field of NUMERIC_FIELDS) {
    if (body[field] === undefined) continue;
    if (body[field] !== null && typeof body[field] !== "number") {
      return res.status(400).json({ error: `${field} must be a number or null` });
    }
    data[field] = body[field];
  }

  for (const field of IMAGE_ARRAY_FIELDS) {
    if (body[field] === undefined) continue;
    if (!isStringArray(body[field])) {
      return res.status(400).json({ error: `${field} must be an array of strings` });
    }
    data[field] = body[field];
    const metaField = IMAGE_META_FIELDS[field];
    data[metaField] = mergeImageMeta(inquiry[metaField], body[field], req.user!.userId) as unknown as Prisma.InputJsonValue;
  }

  const updated = await prisma.inquiry.update({ where: { id }, data, include: INQUIRY_INCLUDE });

  await logAudit({
    studioId: inquiry.studioId,
    actorUserId: req.user!.userId,
    entityType: "Inquiry",
    entityId: id,
    action: "update",
    changes: diffObjects(inquiry, data, [
      ...REQUIRED_STRING_FIELDS,
      ...NULLABLE_STRING_FIELDS,
      ...NUMERIC_FIELDS,
      ...IMAGE_ARRAY_FIELDS,
    ] as unknown as (keyof typeof inquiry)[]),
  });

  res.json(updated);
});

// Staff hands a NEW inquiry off to an artist (bumps status to
// ARTIST_ASSIGNED), assigns one late to an inquiry/project that reached a
// later status with none yet (send-estimate deliberately doesn't require
// one -- see its own comment; the deposit-form gate does), or reassigns an
// already-assigned inquiry/project to a different artist -- all three go
// through this one endpoint, distinguished below by the inquiry's current
// status/assignedArtistId rather than three separate routes. Reassignment
// only swaps assignedArtistId/assignedAt; it deliberately does not touch
// any estimate/pricing the previous artist already entered (that's a
// distinct piece of state, not owned by "who's assigned" alone) or any
// appointment already booked (Appointment.artistId is independent --
// scheduling assigns its own artist, not derived from the inquiry's).
router.patch("/:id/assign", requireAuth, async (req, res) => {
  const id = req.params.id as string;
  const { artistId } = req.body ?? {};

  if (!artistId) {
    return res.status(400).json({ error: "artistId is required" });
  }

  const inquiry = await prisma.inquiry.findUnique({ where: { id } });
  if (!inquiry || !(await callerBelongsToStudio(req.user!, inquiry.studioId))) {
    return res.status(404).json({ error: "Inquiry not found" });
  }

  // Permission-context fix: evaluated at the inquiry's own studio.
  if (!(await hasPermissionAt(req.user!, inquiry.studioId, "inquiries.assignArtist"))) {
    return res.status(403).json({ error: "Forbidden" });
  }

  if (!NON_TERMINAL_STATUSES.includes(inquiry.status)) {
    return res.status(400).json({ error: "Can't assign an artist to a closed or cold-lead inquiry" });
  }

  const artist = await prisma.artist.findUnique({ where: { id: artistId }, include: { user: true } });
  // Artist mobility: a studio can assign its own active GUEST artists too,
  // not just HOME ones -- same check appointments.ts's own artistId
  // validation uses. artist.user.studioId alone only answers "whose HOME
  // studio is this," never "does this studio have a live relationship with
  // them," so a solo artist guesting elsewhere was always rejected here
  // even though GET /artists already lists them as assignable.
  //
  // Studio-scoping bug fix: checked against the inquiry's own studio, not
  // req.user!.studioId (the caller's possibly-different HOME studio) -- a
  // guest-assigned caller acting on a project at their guest studio must
  // validate the target artist against THAT studio, or a legitimate same-
  // studio artist gets wrongly rejected.
  const artistBelongsToStudio =
    artist != null &&
    (artist.user.studioId === inquiry.studioId || (await studioHasActiveMembership(inquiry.studioId, artist.id)));
  if (!artistBelongsToStudio) {
    return res.status(400).json({ error: "artistId must belong to your studio" });
  }

  const isFirstAssignment = inquiry.status === InquiryStatus.NEW;
  const isReassignment = !isFirstAssignment && !!inquiry.assignedArtistId;
  const updateData = isFirstAssignment
    ? { assignedArtistId: artistId, assignedAt: new Date(), status: InquiryStatus.ARTIST_ASSIGNED }
    : { assignedArtistId: artistId, assignedAt: new Date() };

  const updated = await prisma.inquiry.update({
    where: { id },
    data: updateData,
    include: INQUIRY_INCLUDE,
  });

  await logAudit({
    studioId: inquiry.studioId,
    actorUserId: req.user!.userId,
    entityType: "Inquiry",
    entityId: id,
    action: isFirstAssignment ? "status_change" : isReassignment ? "artist_reassigned" : "artist_assigned",
    changes: diffObjects(
      inquiry,
      updateData,
      isFirstAssignment ? ["status", "assignedArtistId", "assignedAt"] : ["assignedArtistId", "assignedAt"],
    ),
  });

  emitInvalidation({ type: "inquiry.updated", studioId: inquiry.studioId, inquiryId: id });

  // Notification v1, emitted from the same call site as the live-update
  // event above. Scoped to the INQUIRY's own studio, not the caller's --
  // a front desk can assign a project to a guest artist whose home studio
  // is elsewhere, and the notification belongs where the work is, which is
  // the same rule the audit log entry right above already follows.
  await notifyInquiryAssigned({
    inquiryId: id,
    studioId: inquiry.studioId,
    artistId,
    actorUserId: req.user!.userId,
  });

  res.json(updated);
});

const DECISIONS = ["APPROVE", "DECLINE"] as const;

// Artist's response to an inquiry assigned to them. APPROVE records the
// artist's own estimate and hands it back to staff (AWAITING_CLIENT_RESPONSE).
// DECLINE unassigns it and puts it back in the pool (NEW) with a note for
// staff explaining why, so it can be reassigned.
// View parity: widened to also allow OWNER, same as GET /assigned-to-me/:id
// just above -- a solo studio's owner is role OWNER with their own attached
// Artist profile, and MyProjectDetail.tsx (which this endpoint backs,
// including its own newly-added Decline button) is already reachable by
// that role for a guest-studio assignment. The artist!.id scoping below
// already narrows correctly regardless of which role got here.
router.patch("/:id/respond", requireAuth, requireRole(Role.ARTIST, Role.OWNER), async (req, res) => {
  const id = req.params.id as string;
  const { decision, priceEstimateLow, priceEstimateHigh, timeEstimateHoursMin, timeEstimateHoursMax, sessions, declineNote } =
    req.body ?? {};

  if (!DECISIONS.includes(decision)) {
    return res.status(400).json({ error: `decision must be one of: ${DECISIONS.join(", ")}` });
  }

  const artist = await prisma.artist.findUnique({ where: { userId: req.user!.userId } });
  const inquiry = await prisma.inquiry.findUnique({ where: { id } });

  if (!inquiry) {
    return res.status(404).json({ error: "Inquiry not found" });
  }

  // Artist mobility bug fix: req.user!.studioId is this caller's own HOME
  // studio (copied from User.studioId at login, same value artist.user.studioId
  // would return) -- a plain equality against inquiry.studioId alone always
  // 404'd a guest artist responding to their own assigned project at a
  // guest studio, before the assignedArtistId check below even ran. Same
  // studioHasActiveMembership(HOME or GUEST) pattern as PATCH /:id/assign.
  const artistBelongsToProjectStudio =
    artist != null &&
    (req.user!.studioId === inquiry.studioId || (await studioHasActiveMembership(inquiry.studioId, artist.id)));

  if (!artistBelongsToProjectStudio) {
    return res.status(404).json({ error: "Inquiry not found" });
  }

  if (inquiry.assignedArtistId !== artist!.id) {
    return res.status(403).json({ error: "This inquiry is not assigned to you" });
  }

  // Permission-context fix: evaluated at the PROJECT's studio (same one
  // artistBelongsToProjectStudio just confirmed), not req.user!.studioId --
  // a guest artist's ability to enter their own estimate follows the
  // studio the project actually lives at.
  if (!(await hasPermissionAt(req.user!, inquiry.studioId, "inquiries.enterEstimate"))) {
    return res.status(403).json({ error: "Forbidden" });
  }

  if (decision === "DECLINE") {
    if (typeof declineNote !== "string" || declineNote.trim().length === 0) {
      return res.status(400).json({ error: "declineNote is required when declining" });
    }

    const declineData = {
      assignedArtistId: null,
      assignedAt: null,
      status: InquiryStatus.NEW,
      declineNote: declineNote.trim(),
    };

    const updated = await prisma.inquiry.update({
      where: { id },
      data: declineData,
      include: INQUIRY_INCLUDE,
    });

    // studioId: inquiry.studioId (the PROJECT's studio), not req.user!.studioId
    // (this artist's own possibly-different home studio) -- same guest-artist
    // scoping bug class fixed elsewhere in this file; getting this wrong here
    // would log the audit entry under the wrong studio and broadcast the live
    // update to the wrong studio's connected staff.
    await logAudit({
      studioId: inquiry.studioId,
      actorUserId: req.user!.userId,
      entityType: "Inquiry",
      entityId: id,
      action: "status_change",
      changes: diffObjects(inquiry, declineData, ["status", "assignedArtistId", "assignedAt", "declineNote"]),
    });

    emitInvalidation({ type: "inquiry.updated", studioId: inquiry.studioId, inquiryId: id });

    return res.json(updated);
  }

  // Same real send path staff's own Generate & Send Estimate uses (see
  // lib/estimates.ts) -- gated per-studio by inquiries.artistSendEstimate,
  // checked against the PROJECT's studio (inquiry.studioId), not this
  // artist's own home studio, so a guest artist's send behavior follows the
  // studio they're actually working for. Off: the artist still fully
  // prepares and saves the same fields (identical validation either way,
  // see lib/estimates.ts's shared validateEstimateInputs) but nothing is
  // sent to the client -- front desk picks it up from here via the normal
  // Estimate section on this same inquiry.
  const canSendDirectly = await hasPermissionAt(req.user!, inquiry.studioId, "inquiries.artistSendEstimate");

  if (canSendDirectly) {
    const result = await generateAndSendEstimate(id, {
      studioId: inquiry.studioId,
      actorUserId: req.user!.userId,
      priceEstimateLow,
      priceEstimateHigh,
      timeEstimateHoursMin,
      timeEstimateHoursMax,
      sessions,
    });
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error });
    }
    const updated = await prisma.inquiry.findUnique({ where: { id }, include: INQUIRY_INCLUDE });
    return res.status(201).json({ ...updated, estimateUrl: result.estimateUrl, estimateSendResult: result.estimateSendResult });
  }

  const saved = await saveEstimateDraft(id, {
    studioId: inquiry.studioId,
    actorUserId: req.user!.userId,
    priceEstimateLow,
    priceEstimateHigh,
    timeEstimateHoursMin,
    timeEstimateHoursMax,
    sessions,
  });
  if (!saved.ok) {
    return res.status(saved.status).json({ error: saved.error });
  }

  const updated = await prisma.inquiry.findUnique({ where: { id }, include: INQUIRY_INCLUDE });
  res.json(updated);
});

// Staff sends (or resends, with revised numbers) the client-facing estimate
// link. Valid from AWAITING_CLIENT_RESPONSE (first send) or
// BUDGET_NEGOTIATION (resend after the client pushed back on price) — either
// way it lands the client back in AWAITING_CLIENT_RESPONSE to review the
// (possibly updated) numbers.
router.post("/:id/send-estimate", requireAuth, async (req, res) => {
  const id = req.params.id as string;
  const { priceEstimateLow, priceEstimateHigh, timeEstimateHoursMin, timeEstimateHoursMax, sessions, channel } =
    req.body ?? {};

  if (channel !== undefined && channel !== "SMS" && channel !== "EMAIL") {
    return res.status(400).json({ error: "channel must be SMS or EMAIL" });
  }

  const inquiry = await prisma.inquiry.findUnique({ where: { id }, select: { studioId: true } });
  if (!inquiry || !(await callerBelongsToStudio(req.user!, inquiry.studioId))) {
    return res.status(404).json({ error: "Inquiry not found" });
  }

  // Permission-context fix: evaluated at the inquiry's own studio.
  if (!(await hasPermissionAt(req.user!, inquiry.studioId, "inquiries.sendEstimate"))) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const result = await generateAndSendEstimate(id, {
    studioId: inquiry.studioId,
    actorUserId: req.user!.userId,
    priceEstimateLow,
    priceEstimateHigh,
    timeEstimateHoursMin,
    timeEstimateHoursMax,
    sessions,
    channel,
  });
  if (!result.ok) {
    return res.status(result.status).json({ error: result.error });
  }

  const updated = await prisma.inquiry.findUnique({ where: { id }, include: INQUIRY_INCLUDE });
  res.status(201).json({ ...updated, estimateUrl: result.estimateUrl, estimateSendResult: result.estimateSendResult });
});

const REVISION_TOKEN_TTL_DAYS = 7;

// The ONLY sanctioned way to change a Project's (already-converted
// inquiry's) estimate -- PATCH /:id above hard-blocks the estimate fields
// once PROJECT_STATUSES.includes(status), specifically so a number the
// client already paid a deposit against can't be silently rewritten. This
// route is the deliberate, controlled exception: requires a staff-typed
// reason, never touches `status` (unlike send-estimate, which moves a
// pre-conversion inquiry to AWAITING_CLIENT_RESPONSE -- that would yank an
// already-scheduled/deposited Project out of the Projects tab), and sends
// the client a message with both the new numbers and the reason so they
// can see why it changed, plus a link to a separate approve/flag page
// (distinct token/fields from the pre-conversion estimateToken flow -- see
// estimateRevision* fields on the schema and routes/estimates.ts's
// /revision/verify + /revision/respond).
// Stays OWNER/FRONT_DESK-only regardless of the inquiries.enterEstimate
// toggle -- this key's ARTIST default (true) exists for their own,
// scoped PATCH /:id/respond (initial estimate entry on their own assigned
// inquiry, pre-conversion); revising an estimate on an ALREADY-CONVERTED
// project is a materially different, bigger capability ARTIST has never
// had, not requested by this expansion, and this route has no per-artist
// scoping to safely extend it through.
router.post("/:id/revise-estimate", requireAuth, requireRole(Role.OWNER, Role.FRONT_DESK), requirePermission("inquiries.enterEstimate"), async (req, res) => {
  const id = req.params.id as string;
  const { priceEstimateLow, priceEstimateHigh, timeEstimateHoursMin, timeEstimateHoursMax, sessions, reason, channel } =
    req.body ?? {};

  if (typeof reason !== "string" || reason.trim().length === 0) {
    return res.status(400).json({ error: "A reason is required to revise a Project's estimate" });
  }

  if (channel !== undefined && channel !== "SMS" && channel !== "EMAIL") {
    return res.status(400).json({ error: "channel must be SMS or EMAIL" });
  }

  const inquiry = await prisma.inquiry.findUnique({
    where: { id },
    include: {
      plannedSessions: { include: { depositForm: { select: { paidAt: true } } } },
      // Token-lifecycle bug fix: needed to re-check self-scheduling
      // eligibility below, same condition estimates.ts's own PROCEED
      // branch uses.
      assignedArtist: { select: { allowsClientSelfScheduling: true } },
    },
  });
  if (!inquiry || inquiry.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Inquiry not found" });
  }

  if (!ESTIMATE_REVISION_ONLY_STATUSES.includes(inquiry.status)) {
    return res.status(400).json({
      error: "This route is only for revising an estimate that already has a deposit request or further -- use Generate & Send Estimate before that.",
    });
  }

  for (const [field, value] of Object.entries({
    priceEstimateLow,
    priceEstimateHigh,
    timeEstimateHoursMin,
    timeEstimateHoursMax,
  })) {
    if (value !== undefined && typeof value !== "number") {
      return res.status(400).json({ error: `${field} must be a number` });
    }
  }

  // A session already backed by a paid deposit or a booked appointment
  // can't be silently altered or removed by a revision -- real money or a
  // real booking already depends on its hour range. Everything else about
  // the plan stays freely editable. Computed before the sessions[] validation
  // below so that loop can skip locked slots entirely -- see its own comment.
  const lockedSessions = inquiry.plannedSessions.filter(
    (ps) => ps.depositForm?.paidAt != null || ps.appointmentId != null,
  );
  const lockedSessionNumbers = new Set(lockedSessions.map((s) => s.sessionNumber));
  const highestLockedSessionNumber = lockedSessions.reduce((max, s) => Math.max(max, s.sessionNumber), 0);
  const existingByNumber = new Map(inquiry.plannedSessions.map((ps) => [ps.sessionNumber, ps]));

  // Multi-session planning: an explicit `sessions` array -- any length,
  // including 0 or 1 -- means staff is declaring/editing the project's
  // session plan as part of this revision. Omitting the field entirely
  // leaves any existing plan completely untouched (a price-only revision
  // on a project whose plan isn't being touched this time, or one that
  // never had a plan at all).
  let plannedSessionInputs:
    | {
        estimatedHoursMin: number;
        estimatedHoursMax: number;
        estimatedPriceLow: number;
        estimatedPriceHigh: number;
        showDurationToClient: boolean;
      }[]
    | null = null;
  if (sessions !== undefined) {
    if (!Array.isArray(sessions)) {
      return res.status(400).json({ error: "sessions must be an array" });
    }
    for (const [index, session] of sessions.entries()) {
      // Bug fix: a locked slot's hours/price are never actually written from
      // this submission (see the reconciliation block below, which already
      // ignores whatever was submitted for a locked sessionNumber and keeps
      // the stored row untouched) -- validating it anyway meant a legacy
      // multi-session Project whose sessions predate per-session pricing
      // (estimatedPriceLow/High still null, since there's no historical
      // backfill value for them) could NEVER be revised again: every locked
      // slot's pass-through submission defaults its price to 0 client-side,
      // which this loop then unconditionally rejected as "must be positive"
      // -- even though staff has no way to fix a number they can't edit.
      if (lockedSessionNumbers.has(index + 1)) continue;
      if (
        typeof session !== "object" ||
        session === null ||
        typeof session.estimatedHoursMin !== "number" ||
        typeof session.estimatedHoursMax !== "number" ||
        typeof session.estimatedPriceLow !== "number" ||
        typeof session.estimatedPriceHigh !== "number"
      ) {
        return res.status(400).json({ error: `Session ${index + 1} needs a numeric hour range and price range` });
      }
      if (session.estimatedHoursMin <= 0 || session.estimatedHoursMax <= 0) {
        return res.status(400).json({ error: `Session ${index + 1}'s hour range must be positive` });
      }
      if (session.estimatedHoursMin > session.estimatedHoursMax) {
        return res
          .status(400)
          .json({ error: `Session ${index + 1}'s minimum hours must be less than or equal to its maximum` });
      }
      if (session.estimatedPriceLow <= 0 || session.estimatedPriceHigh <= 0) {
        return res.status(400).json({ error: `Session ${index + 1}'s price range must be positive` });
      }
      if (session.estimatedPriceLow > session.estimatedPriceHigh) {
        return res
          .status(400)
          .json({ error: `Session ${index + 1}'s minimum price must be less than or equal to its maximum` });
      }
      if (session.showDurationToClient !== undefined && typeof session.showDurationToClient !== "boolean") {
        return res.status(400).json({ error: `Session ${index + 1}'s showDurationToClient must be a boolean` });
      }
    }
    plannedSessionInputs = sessions.map((session) => ({
      ...session,
      showDurationToClient: session.showDurationToClient ?? true,
    }));
  }

  // The actual session count this revision ends up with, once any locked
  // sessions beyond what staff submitted are preserved -- drives whether
  // the top-level time-estimate fields get nulled out below, same rule
  // POST /:id/send-estimate uses (a real plan replaces them).
  const finalSessionCount = plannedSessionInputs
    ? Math.max(plannedSessionInputs.length, highestLockedSessionNumber)
    : inquiry.plannedSessions.length;
  const hasPlan = finalSessionCount > 1;

  // Every final session's own price, summed -- same "sessions replace the
  // top-level field" relationship as send-estimate, but here a session's
  // price can come from three places depending on what this call actually
  // touched: a locked session keeps its already-stored price (untouchable,
  // same as its hours); an unlocked session newly submitted this call uses
  // that submission; anything else (plan not touched this call) keeps
  // whatever price is already stored for that slot.
  const sessionPriceTotals = hasPlan
    ? (() => {
        let low = 0;
        let high = 0;
        for (let num = 1; num <= finalSessionCount; num++) {
          const locked = lockedSessions.find((s) => s.sessionNumber === num);
          if (locked) {
            low += locked.estimatedPriceLow ?? 0;
            high += locked.estimatedPriceHigh ?? 0;
            continue;
          }
          const submitted = plannedSessionInputs?.[num - 1];
          if (submitted) {
            low += submitted.estimatedPriceLow;
            high += submitted.estimatedPriceHigh;
            continue;
          }
          const existing = existingByNumber.get(num);
          low += existing?.estimatedPriceLow ?? 0;
          high += existing?.estimatedPriceHigh ?? 0;
        }
        return { priceEstimateLow: low, priceEstimateHigh: high };
      })()
    : null;

  // Same "effective value" fallback as send-estimate -- staff can revise
  // just the price and leave the time estimate (or vice versa) without
  // resubmitting every field. The top-level time-estimate pair is skipped
  // entirely once this revision has (or keeps) a real session plan.
  const effective = {
    priceEstimateLow: sessionPriceTotals ? sessionPriceTotals.priceEstimateLow : (priceEstimateLow ?? inquiry.priceEstimateLow),
    priceEstimateHigh: sessionPriceTotals
      ? sessionPriceTotals.priceEstimateHigh
      : (priceEstimateHigh ?? inquiry.priceEstimateHigh),
    ...(hasPlan
      ? {}
      : {
          timeEstimateHoursMin: timeEstimateHoursMin ?? inquiry.timeEstimateHoursMin,
          timeEstimateHoursMax: timeEstimateHoursMax ?? inquiry.timeEstimateHoursMax,
        }),
  };

  for (const [field, value] of Object.entries(effective)) {
    if (value == null) {
      return res.status(400).json({ error: `${field} is required to revise the estimate` });
    }
    if (value <= 0) {
      return res.status(400).json({ error: `${field} must be a positive number` });
    }
  }

  if (effective.priceEstimateLow! > effective.priceEstimateHigh!) {
    return res.status(400).json({ error: "priceEstimateLow must be less than or equal to priceEstimateHigh" });
  }

  if (!hasPlan && effective.timeEstimateHoursMin! > effective.timeEstimateHoursMax!) {
    return res
      .status(400)
      .json({ error: "timeEstimateHoursMin must be less than or equal to timeEstimateHoursMax" });
  }

  const trimmedReason = reason.trim();
  const estimateRevisionToken = crypto.randomBytes(32).toString("hex");
  const estimateRevisionTokenExpiresAt = new Date(Date.now() + REVISION_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

  // Token-lifecycle bug fix (Bug B): this route is the ONLY resend
  // mechanism available once an inquiry reaches DEPOSIT_PENDING (see
  // POST /:id/send-estimate's own ESTIMATE_REVISION_ONLY_STATUSES guard) --
  // which includes a self-scheduling-eligible inquiry that's approved but
  // hasn't booked yet, a state this route was never built to consider
  // (its whole premise is "already scheduled/deposited"). Re-checks the
  // SAME eligibility condition as estimates.ts's own PROCEED branch, using
  // THIS revision's own hasPlan/effective (not the pre-revision values --
  // staff may be changing the plan as part of this call), and explicitly
  // excludes a later PROJECT_STATUS (a genuinely converted Project really
  // is past self-scheduling) and an already-completed booking.
  const selfScheduleEligible =
    inquiry.status === InquiryStatus.DEPOSIT_PENDING &&
    inquiry.selfScheduleBookedAt == null &&
    inquiry.assignedArtist?.allowsClientSelfScheduling === true &&
    !hasPlan &&
    effective.timeEstimateHoursMin != null &&
    effective.timeEstimateHoursMax != null;

  const freshSelfScheduleToken = selfScheduleEligible ? crypto.randomBytes(32).toString("hex") : null;

  const reviseData = {
    priceEstimateLow: effective.priceEstimateLow,
    priceEstimateHigh: effective.priceEstimateHigh,
    timeEstimateHoursMin: hasPlan ? null : effective.timeEstimateHoursMin,
    timeEstimateHoursMax: hasPlan ? null : effective.timeEstimateHoursMax,
    estimateRevisionReason: trimmedReason,
    estimateRevisionToken,
    estimateRevisionTokenExpiresAt,
    estimateRevisionSentAt: new Date(),
    // A fresh revision supersedes whatever the client made of the last one
    // -- reset so the new numbers/reason get their own, unanswered
    // approve/flag prompt rather than inheriting a stale response.
    estimateRevisionRespondedAt: null,
    estimateRevisionApproved: null,
    ...(freshSelfScheduleToken
      ? {
          // Superseding an old, still-live, not-yet-booked token -- record
          // it so that link shows "a newer link was sent" instead of a
          // bare "invalid" (see previousSelfScheduleToken's own schema
          // comment). Nothing to record if there wasn't one yet (this
          // inquiry's very first time reaching self-scheduling eligibility
          // via a revision, e.g. the artist only just opted in).
          ...(inquiry.selfScheduleToken ? { previousSelfScheduleToken: inquiry.selfScheduleToken } : {}),
          selfScheduleToken: freshSelfScheduleToken,
          selfScheduleTokenExpiresAt: new Date(Date.now() + SELF_SCHEDULE_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000),
        }
      : {}),
  };

  // Reconcile PlannedSession rows to match plannedSessionInputs, if
  // provided. A locked session's own hour range and existence are never
  // touched regardless of what was submitted for its slot -- see the
  // lockedSessions filter above.
  //
  // Linkage bug fix (same root cause and same fix shape as lib/estimates.ts's
  // reconcilePlannedSessions -- this route has its own independent, copy-
  // pasted reconciliation block rather than calling that shared function,
  // so the same gap had to be fixed here too): a plan revised on an inquiry
  // that already has an un-planned DepositForm previously created/updated
  // PlannedSession rows with depositFormId left null, even when a real,
  // possibly-already-paid DepositForm with the same sessionNumber already
  // existed on the inquiry -- the Session Plan widget then showed that
  // session as "Deposit not yet generated" and left it fully actionable
  // (Send Deposit Form) despite already being paid.
  if (plannedSessionInputs) {
    const existingDepositForms = await prisma.depositForm.findMany({
      where: { inquiryId: id },
      select: { id: true, sessionNumber: true },
      orderBy: { createdAt: "asc" },
    });
    const depositFormIdBySessionNumber = new Map(existingDepositForms.map((df) => [df.sessionNumber, df.id]));

    const toUpdate: {
      id: string;
      estimatedHoursMin: number;
      estimatedHoursMax: number;
      estimatedPriceLow: number;
      estimatedPriceHigh: number;
      showDurationToClient: boolean;
      depositFormId?: string;
    }[] = [];
    const toCreate: {
      sessionNumber: number;
      estimatedHoursMin: number;
      estimatedHoursMax: number;
      estimatedPriceLow: number;
      estimatedPriceHigh: number;
      showDurationToClient: boolean;
      depositFormId?: string;
    }[] = [];

    plannedSessionInputs.forEach((session, index) => {
      const sessionNumber = index + 1;
      if (lockedSessionNumbers.has(sessionNumber)) return;
      const existing = existingByNumber.get(sessionNumber);
      const matchingDepositFormId = depositFormIdBySessionNumber.get(sessionNumber);
      if (existing) {
        toUpdate.push({
          id: existing.id,
          estimatedHoursMin: session.estimatedHoursMin,
          estimatedHoursMax: session.estimatedHoursMax,
          estimatedPriceLow: session.estimatedPriceLow,
          estimatedPriceHigh: session.estimatedPriceHigh,
          showDurationToClient: session.showDurationToClient,
          // Only ever fills a currently-null link -- never overwrites an
          // already-linked row (that link was set by the real send-
          // deposit-form flow, always the more authoritative source for it).
          ...(existing.depositFormId == null && matchingDepositFormId ? { depositFormId: matchingDepositFormId } : {}),
        });
      } else {
        toCreate.push({
          sessionNumber,
          estimatedHoursMin: session.estimatedHoursMin,
          estimatedHoursMax: session.estimatedHoursMax,
          estimatedPriceLow: session.estimatedPriceLow,
          estimatedPriceHigh: session.estimatedPriceHigh,
          showDurationToClient: session.showDurationToClient,
          ...(matchingDepositFormId ? { depositFormId: matchingDepositFormId } : {}),
        });
      }
    });

    // Any existing sessionNumber beyond the submitted length: delete it if
    // unlocked (staff is shrinking the plan and nothing real depends on it
    // yet), otherwise leave it in place -- a locked session can never be
    // removed by a revision.
    const toDeleteIds = inquiry.plannedSessions
      .filter((ps) => ps.sessionNumber > plannedSessionInputs!.length && !lockedSessionNumbers.has(ps.sessionNumber))
      .map((ps) => ps.id);

    await prisma.$transaction([
      ...toUpdate.map((s) =>
        prisma.plannedSession.update({
          where: { id: s.id },
          data: {
            estimatedHoursMin: s.estimatedHoursMin,
            estimatedHoursMax: s.estimatedHoursMax,
            estimatedPriceLow: s.estimatedPriceLow,
            estimatedPriceHigh: s.estimatedPriceHigh,
            showDurationToClient: s.showDurationToClient,
            ...(s.depositFormId ? { depositFormId: s.depositFormId } : {}),
          },
        }),
      ),
      ...(toCreate.length > 0
        ? [prisma.plannedSession.createMany({ data: toCreate.map((s) => ({ inquiryId: id, ...s })) })]
        : []),
      ...(toDeleteIds.length > 0 ? [prisma.plannedSession.deleteMany({ where: { id: { in: toDeleteIds } } })] : []),
    ]);
  }

  const updated = await prisma.inquiry.update({
    where: { id },
    data: reviseData,
    include: INQUIRY_INCLUDE,
  });

  await logAudit({
    studioId: req.user!.studioId,
    actorUserId: req.user!.userId,
    entityType: "Inquiry",
    entityId: id,
    action: "estimate_revised",
    changes: {
      ...diffObjects(inquiry, reviseData, [
        "priceEstimateLow",
        "priceEstimateHigh",
        "timeEstimateHoursMin",
        "timeEstimateHoursMax",
      ]),
      reason: trimmedReason,
    },
  });

  const revisionUrl = await shortenUrl(`${PUBLIC_APP_URL}/estimate-revision/${estimateRevisionToken}`);

  // Same best-effort real-SMS path as send-estimate (see that route's own
  // comment) -- the revision is already saved and audited above regardless
  // of whether the text goes out; staff still has the link on-screen to
  // share manually either way.
  const studio = await prisma.studio.findUnique({ where: { id: req.user!.studioId }, select: { name: true } });
  const revisionConversationId = (
    await getOrCreateClientConversation(req.user!.studioId, updated.clientId, req.user!.userId)
  ).conversation.id;
  const revisionMessage = `Hi ${updated.client.firstName}, the estimate for your tattoo with ${studio?.name ?? "us"} has been updated to $${effective.priceEstimateLow}-$${effective.priceEstimateHigh} (${effective.timeEstimateHoursMin}-${effective.timeEstimateHoursMax} hrs). Reason: ${trimmedReason}. Please review: ${revisionUrl}`;
  const revisionSendResult =
    channel === "EMAIL"
      ? await sendClientEmail({
          studioId: req.user!.studioId,
          clientId: updated.clientId,
          conversationId: revisionConversationId,
          subject: `Your estimate was updated -- ${studio?.name ?? "our studio"}`,
          bodyText: revisionMessage,
          bodyHtml: renderClientEmailHtml({
            studioName: studio?.name ?? "Your studio",
            heading: "Your estimate was updated",
            bodyParagraphs: [
              `Hi ${updated.client.firstName}, the estimate for your tattoo has been updated to $${effective.priceEstimateLow}-$${effective.priceEstimateHigh} (${effective.timeEstimateHoursMin}-${effective.timeEstimateHoursMax} hrs).`,
              `Reason: ${trimmedReason}`,
            ],
            buttonText: "Review estimate",
            buttonUrl: revisionUrl,
          }),
          actorUserId: req.user!.userId,
          logAttemptEvenOnFailure: true,
        })
      : await sendClientSms({
          studioId: req.user!.studioId,
          clientId: updated.clientId,
          conversationId: revisionConversationId,
          body: revisionMessage,
          actorUserId: req.user!.userId,
          logAttemptEvenOnFailure: true,
        });

  emitInvalidation({ type: "inquiry.updated", studioId: req.user!.studioId, inquiryId: id });

  res.status(201).json({ ...updated, revisionUrl, revisionSendResult });
});

// Creates the real Appointment once the deposit's been paid (SCHEDULING is
// only reachable after mark-paid issues a gift card -- Phase 3), links it
// back to the Inquiry, and attaches the gift card in the same transaction.
// Doesn't block on a tight same-day schedule for the artist — just flags
// it via bufferWarning so staff can decide.
router.post("/:id/schedule", requireAuth, async (req, res) => {
  const id = req.params.id as string;
  const { startTime, endTime, giftCardIds } = req.body ?? {};

  if (!startTime || !endTime) {
    return res.status(400).json({ error: "startTime and endTime are required" });
  }

  if (!Array.isArray(giftCardIds) || giftCardIds.length === 0 || !giftCardIds.every((v) => typeof v === "string")) {
    return res.status(400).json({ error: "giftCardIds must be a non-empty array of strings" });
  }

  const start = new Date(startTime);
  const end = new Date(endTime);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
    return res.status(400).json({ error: "startTime and endTime must be valid dates, with startTime before endTime" });
  }

  const inquiry = await prisma.inquiry.findUnique({ where: { id }, include: { service: true } });
  if (!inquiry || !(await callerBelongsToStudio(req.user!, inquiry.studioId))) {
    return res.status(404).json({ error: "Inquiry not found" });
  }

  // Permission-context fix: evaluated at the inquiry's own studio.
  if (!(await hasPermissionAt(req.user!, inquiry.studioId, "inquiries.edit"))) {
    return res.status(403).json({ error: "Forbidden" });
  }

  if (inquiry.status !== InquiryStatus.SCHEDULING) {
    return res.status(400).json({ error: "Only an inquiry in SCHEDULING can be scheduled" });
  }

  if (!inquiry.assignedArtistId) {
    return res.status(400).json({ error: "This inquiry has no assigned artist" });
  }

  // Studio-scoping bug fix: everything below is scoped to the PROJECT's own
  // studio, not req.user!.studioId (the caller's possibly-different HOME
  // studio) -- getting this wrong would look up the wrong studio's deposit
  // tiers/buffer settings, validate gift cards against the wrong studio,
  // and (worst of all) create the new Appointment itself under the wrong
  // studio.
  const [studioSettings, assignedArtist] = await Promise.all([
    prisma.studioSettings.findUnique({
      where: { studioId: inquiry.studioId },
      select: { depositTiers: true, schedulingBufferMinutes: true },
    }),
    prisma.artist.findUnique({ where: { id: inquiry.assignedArtistId }, select: { schedulingBufferMinutes: true } }),
  ]);
  const requiredCents = resolveRequiredDepositCents(
    inquiry.service,
    inquiry.priceEstimateLow,
    inquiry.priceEstimateHigh,
    resolveDepositTiers(studioSettings?.depositTiers),
  );

  const giftCardResult = await validateGiftCardsForAttachment(
    giftCardIds,
    inquiry.studioId,
    inquiry.clientId,
    requiredCents,
  );
  if ("error" in giftCardResult) {
    return res.status(400).json({ error: giftCardResult.error });
  }

  const bufferMs = resolveSchedulingBufferMs(
    assignedArtist?.schedulingBufferMinutes,
    studioSettings?.schedulingBufferMinutes,
  );
  const conflict = await findBufferConflict(inquiry.assignedArtistId, start, end, undefined, bufferMs);

  const appointment = await prisma.$transaction(async (tx) => {
    const created = await tx.appointment.create({
      data: {
        studioId: inquiry.studioId,
        artistId: inquiry.assignedArtistId!,
        clientId: inquiry.clientId,
        inquiryId: id,
        startTime: start,
        endTime: end,
        status: AppointmentStatus.CONFIRMED,
      },
    });

    /*
     * ─── THE DEPOSIT IS CONSUMED HERE, AND THAT IS INTENDED ─────────
     *
     * CONFIRMED INTENTIONAL BY THE OWNER, 2026-09-01. This is standard
     * operating procedure, not a coupling to unpick: a deposit is taken
     * FOR a session, so booking that session is exactly when it gets
     * applied to it.
     *
     * Written down because it has already been read as a bug once.
     * Session AR-3b found that `POST /inquiries/:id/schedule` is not a
     * calendar action — it requires a non-empty `giftCardIds`, and in
     * one transaction it creates a CONFIRMED appointment AND attaches
     * those gift cards to it — and declined to build the mobile half on
     * the grounds that a booking which moves money was an owner call
     * rather than an implementer's. That was the right call to escalate,
     * and it has now been answered: this is what it is meant to do.
     *
     * The AA–BC handoff identified stale documentation as this
     * codebase's most common defect class — four of its ten findings
     * were a comment that was true when written and never revisited. So
     * this is recorded while it is known, rather than left for the next
     * session to rediscover and "fix". See CLAUDE.md, "Money and
     * deposits".
     *
     * A CONSULTATION is the money-free path and skips the gift-card
     * requirement entirely; that is the one mobile books today.
     */
    await Promise.all(
      giftCardIds.map((giftCardId: string) =>
        tx.giftCard.update({ where: { id: giftCardId }, data: { appointmentId: created.id } }),
      ),
    );

    return created;
  });

  const scheduleData = { appointmentId: appointment.id, status: InquiryStatus.CONFIRMED };

  const updated = await prisma.inquiry.update({
    where: { id },
    data: scheduleData,
    include: INQUIRY_INCLUDE,
  });

  await logAudit({
    studioId: inquiry.studioId,
    actorUserId: req.user!.userId,
    entityType: "Inquiry",
    entityId: id,
    action: "status_change",
    changes: diffObjects(inquiry, scheduleData, ["status", "appointmentId"]),
  });

  emitInvalidation({ type: "appointment.changed", studioId: inquiry.studioId });
  emitInvalidation({ type: "inquiry.updated", studioId: inquiry.studioId, inquiryId: id });

  res.status(201).json({
    ...updated,
    bufferWarning: formatBufferWarning(conflict, bufferMs),
  });
});

// Alternative to scheduling right away: keeps the inquiry out of active
// scheduling without losing it, for a client who wants to wait for a
// specific slot. The optional note is stored the same way an artist's
// decline note is -- a single "most recent status note" field.
router.post("/:id/waitlist", requireAuth, async (req, res) => {
  const id = req.params.id as string;
  const { note } = req.body ?? {};

  if (note !== undefined && typeof note !== "string") {
    return res.status(400).json({ error: "note must be a string" });
  }

  const inquiry = await prisma.inquiry.findUnique({ where: { id } });
  if (!inquiry || !(await callerBelongsToStudio(req.user!, inquiry.studioId))) {
    return res.status(404).json({ error: "Inquiry not found" });
  }

  // Permission-context fix: evaluated at the inquiry's own studio.
  if (!(await hasPermissionAt(req.user!, inquiry.studioId, "inquiries.edit"))) {
    return res.status(403).json({ error: "Forbidden" });
  }

  if (inquiry.status !== InquiryStatus.SCHEDULING) {
    return res.status(400).json({ error: "Only an inquiry in SCHEDULING can be waitlisted" });
  }

  const waitlistData = { status: InquiryStatus.WAITLISTED, declineNote: note?.trim() || null };

  const updated = await prisma.inquiry.update({
    where: { id },
    data: waitlistData,
    include: INQUIRY_INCLUDE,
  });

  await logAudit({
    studioId: inquiry.studioId,
    actorUserId: req.user!.userId,
    entityType: "Inquiry",
    entityId: id,
    action: "status_change",
    changes: diffObjects(inquiry, waitlistData, ["status", "declineNote"]),
  });

  emitInvalidation({ type: "inquiry.updated", studioId: inquiry.studioId, inquiryId: id });

  res.json(updated);
});

// Package H: the other missing workflow action -- /waitlist above had no
// reverse. Symmetric with it: the only thing this undoes is that exact
// transition, back to SCHEDULING (never straight to CONFIRMED -- picking an
// actual time slot stays its own deliberate step through /schedule).
router.post("/:id/unwaitlist", requireAuth, async (req, res) => {
  const id = req.params.id as string;

  const inquiry = await prisma.inquiry.findUnique({ where: { id } });
  if (!inquiry || !(await callerBelongsToStudio(req.user!, inquiry.studioId))) {
    return res.status(404).json({ error: "Inquiry not found" });
  }

  // Permission-context fix: evaluated at the inquiry's own studio.
  if (!(await hasPermissionAt(req.user!, inquiry.studioId, "inquiries.edit"))) {
    return res.status(403).json({ error: "Forbidden" });
  }

  if (inquiry.status !== InquiryStatus.WAITLISTED) {
    return res.status(400).json({ error: "Only a WAITLISTED inquiry can be removed from the waitlist" });
  }

  const unwaitlistData = { status: InquiryStatus.SCHEDULING };

  const updated = await prisma.inquiry.update({
    where: { id },
    data: unwaitlistData,
    include: INQUIRY_INCLUDE,
  });

  await logAudit({
    studioId: inquiry.studioId,
    actorUserId: req.user!.userId,
    entityType: "Inquiry",
    entityId: id,
    action: "status_change",
    changes: diffObjects(inquiry, unwaitlistData, ["status"]),
  });

  emitInvalidation({ type: "inquiry.updated", studioId: inquiry.studioId, inquiryId: id });

  res.json(updated);
});

// The missing workflow action: marks an inquiry lost. Valid from any
// non-terminal status (Inquiries-side or Projects-side alike -- a
// confirmed project can still fall through). Deliberately conversation-
// agnostic: a separate workstream adds a chat-side entry point that calls
// this same route, so nothing here assumes it was reached from a thread.
router.post("/:id/mark-lost", requireAuth, async (req, res) => {
  const id = req.params.id as string;
  const { reason } = req.body ?? {};

  if (reason !== undefined && reason !== null && typeof reason !== "string") {
    return res.status(400).json({ error: "reason must be a string" });
  }

  const inquiry = await prisma.inquiry.findUnique({ where: { id } });
  if (!inquiry || !(await callerBelongsToStudio(req.user!, inquiry.studioId))) {
    return res.status(404).json({ error: "Inquiry not found" });
  }

  // Permission-context fix: evaluated at the inquiry's own studio.
  if (!(await hasPermissionAt(req.user!, inquiry.studioId, "inquiries.markLost"))) {
    return res.status(403).json({ error: "Forbidden" });
  }

  if (!NON_TERMINAL_STATUSES.includes(inquiry.status)) {
    return res.status(400).json({ error: "This inquiry is already in a terminal state (CLOSED_LOST, COLD_LEAD, or TRANSFERRED)" });
  }

  const lostData = {
    status: InquiryStatus.CLOSED_LOST,
    lostAt: new Date(),
    lostReason: typeof reason === "string" && reason.trim().length > 0 ? reason.trim() : null,
  };

  const updated = await prisma.inquiry.update({ where: { id }, data: lostData, include: INQUIRY_INCLUDE });

  await logAudit({
    studioId: inquiry.studioId,
    actorUserId: req.user!.userId,
    entityType: "Inquiry",
    entityId: id,
    action: "status_change",
    changes: diffObjects(inquiry, lostData, ["status", "lostAt", "lostReason"]),
  });

  emitInvalidation({ type: "inquiry.updated", studioId: inquiry.studioId, inquiryId: id });

  res.json(updated);
});

// Flash gallery + review mode expansion: review of a FLASH_PENDING_APPROVAL
// inquiry (the placement photo/description + customer info submitted
// through POST /flash-pieces/:id/request). Approve moves straight to
// FLASH_PAYMENT_PENDING and generates the payment link (see
// lib/flashApproval.ts's approveFlashRequest, shared with the instant-
// booking auto-approve path on the request route itself).
//
// Who may call this: if the flash piece's OWN artist has flashReviewMode
// ARTIST, this is THEIRS alone -- an unconditional identity check, no
// permission matrix involved at all, same "inalienable, no staff bypass"
// shape as the transfer-to-artist epic's own accept/decline. Otherwise
// (STUDIO) it's front desk's call, matrix-gated exactly like appointment
// approvals -- hasPermissionOrSoloArtistAt + the same "only your own"
// narrowing appointments.ts's own POST /:id/approve applies for a genuine
// solo studio's owner-artist (there's no OWNER/FRONT_DESK gatekeeper left
// to protect there). NONE never reaches FLASH_PENDING_APPROVAL at all
// (auto-approved at creation).
router.post("/:id/flash/approve", requireAuth, async (req, res) => {
  const id = req.params.id as string;

  const inquiry = await prisma.inquiry.findUnique({
    where: { id },
    include: { flashPiece: { include: { artist: { select: { userId: true, flashReviewMode: true } } } } },
  });
  if (!inquiry || !(await callerBelongsToStudio(req.user!, inquiry.studioId))) {
    return res.status(404).json({ error: "Inquiry not found" });
  }

  const pieceArtist = inquiry.flashPiece?.artist;
  const isOwnArtist = pieceArtist?.userId === req.user!.userId;
  const artistOwnsApproval = pieceArtist?.flashReviewMode === FlashReviewMode.ARTIST;

  if (artistOwnsApproval) {
    if (!isOwnArtist) {
      return res.status(403).json({ error: "Only the assigned artist can approve this flash request" });
    }
  } else {
    const { allowed, viaSoloArtistBypass } = await hasPermissionOrSoloArtistAt(req.user!, inquiry.studioId, "inquiries.edit");
    if (!allowed) {
      return res.status(403).json({ error: "Forbidden" });
    }
    if (viaSoloArtistBypass && pieceArtist?.userId !== req.user!.userId) {
      return res.status(403).json({ error: "As a solo artist, you can only manage your own flash pieces" });
    }
  }

  if (inquiry.status !== InquiryStatus.FLASH_PENDING_APPROVAL) {
    return res.status(400).json({ error: "This inquiry isn't awaiting flash approval" });
  }

  const { paymentUrl, flashPaymentSendResult } = await approveFlashRequest(id, req.user!.userId, {
    autoSend: req.body?.autoSend !== false,
  });

  emitInvalidation({ type: "task.changed", studioId: inquiry.studioId });

  if (pieceArtist) {
    emitUserInvalidation(pieceArtist.userId, [["tasks", pieceArtist.userId]]);
  }

  const updated = await prisma.inquiry.findUniqueOrThrow({ where: { id }, include: INQUIRY_INCLUDE });

  res.json({ ...updated, paymentUrl, flashPaymentSendResult });
});

// Decline: closes the inquiry the same way mark-lost does (reuses
// CLOSED_LOST + closedReason, per the task's own "reuse existing
// CLOSED_LOST-style handling if it fits" instruction), and -- the part
// that's genuinely different from a normal decline -- reopens a one-of-one
// piece back to AVAILABLE so it isn't stuck reserved forever behind a
// declined request. A repeatable piece was never taken off the gallery in
// the first place (see POST /flash-pieces/:id/request), so there's
// nothing to reopen for one.
//
// Reachable from FLASH_PAYMENT_PENDING as well as FLASH_PENDING_APPROVAL
// (Part 3): a stalled payment -- the client never pays, or never returns to
// finish self-scheduling after paying -- deliberately has no automatic
// expiry (same judgment call the self-scheduling branch itself already
// made for its own token: see REPORT.md), so this is the manual escape
// hatch staff needs for a one-of-one piece stuck reserved behind a booking
// that's genuinely never going to complete.
//
// Review mode expansion: the artist-inalienable identity bypass (see
// POST /:id/flash/approve's own comment) applies ONLY to declining at
// FLASH_PENDING_APPROVAL -- the original "should I take this booking"
// decision the task asked to be theirs. A stalled payment at
// FLASH_PAYMENT_PENDING is a different concern (administrative cleanup of
// an abandoned checkout the client already saw and didn't finish, not a
// business decision about the artist's own work) and stays staff-only
// regardless of the mode -- the route comment above already calls this
// "the manual escape hatch STAFF needs," which the artist's own mode was
// never meant to take away.
router.post("/:id/flash/decline", requireAuth, async (req, res) => {
  const id = req.params.id as string;
  const { reason } = req.body ?? {};

  if (reason !== undefined && reason !== null && typeof reason !== "string") {
    return res.status(400).json({ error: "reason must be a string" });
  }

  const inquiry = await prisma.inquiry.findUnique({
    where: { id },
    include: { flashPiece: { include: { artist: { select: { userId: true, flashReviewMode: true } } } } },
  });
  if (!inquiry || !(await callerBelongsToStudio(req.user!, inquiry.studioId))) {
    return res.status(404).json({ error: "Inquiry not found" });
  }

  const pieceArtist = inquiry.flashPiece?.artist;
  const isOwnArtist = pieceArtist?.userId === req.user!.userId;
  const artistOwnsThisDecision =
    inquiry.status === InquiryStatus.FLASH_PENDING_APPROVAL && pieceArtist?.flashReviewMode === FlashReviewMode.ARTIST;

  if (artistOwnsThisDecision) {
    if (!isOwnArtist) {
      return res.status(403).json({ error: "Only the assigned artist can decline this flash request" });
    }
  } else {
    const { allowed, viaSoloArtistBypass } = await hasPermissionOrSoloArtistAt(req.user!, inquiry.studioId, "inquiries.markLost");
    if (!allowed) {
      return res.status(403).json({ error: "Forbidden" });
    }
    if (viaSoloArtistBypass && pieceArtist?.userId !== req.user!.userId) {
      return res.status(403).json({ error: "As a solo artist, you can only manage your own flash pieces" });
    }
  }

  if (inquiry.status !== InquiryStatus.FLASH_PENDING_APPROVAL && inquiry.status !== InquiryStatus.FLASH_PAYMENT_PENDING) {
    return res.status(400).json({ error: "This inquiry isn't awaiting flash approval or payment" });
  }

  if (inquiry.flashPaidAt) {
    return res.status(400).json({ error: "This flash booking has already been paid -- it can no longer be declined this way." });
  }

  const closedData = {
    status: InquiryStatus.CLOSED_LOST,
    lostAt: new Date(),
    lostReason: typeof reason === "string" && reason.trim().length > 0 ? reason.trim() : "Flash request declined.",
    flashPaymentToken: null,
    flashPaymentTokenExpiresAt: null,
  };

  const [updated] = await prisma.$transaction([
    prisma.inquiry.update({ where: { id }, data: closedData, include: INQUIRY_INCLUDE }),
    ...(inquiry.flashPiece?.isOneOfOne
      ? [
          prisma.flashPiece.update({
            where: { id: inquiry.flashPiece.id },
            data: { status: FlashPieceStatus.AVAILABLE },
          }),
        ]
      : []),
  ]);

  await logAudit({
    studioId: inquiry.studioId,
    actorUserId: req.user!.userId,
    entityType: "Inquiry",
    entityId: id,
    action: "flash_request_declined",
    changes: diffObjects(inquiry, closedData, ["status", "lostAt", "lostReason"]),
  });

  emitInvalidation({ type: "inquiry.updated", studioId: inquiry.studioId, inquiryId: id });
  emitInvalidation({ type: "task.changed", studioId: inquiry.studioId });
  if (inquiry.flashPiece?.isOneOfOne) {
    emitInvalidation({ type: "flash.changed", studioId: inquiry.studioId });
  }
  if (pieceArtist) {
    emitUserInvalidation(pieceArtist.userId, [["tasks", pieceArtist.userId]]);
  }

  res.json(updated);
});

// Reverses mark-lost OR the cold-lead sweep -- both terminal states share
// one reopen path. status is an explicit target rather than a fixed
// "back to NEW": staff know best where an inquiry should resume (one that
// was CONFIRMED before going cold shouldn't have to restart the pipeline).
router.post("/:id/reopen", requireAuth, async (req, res) => {
  const id = req.params.id as string;
  const { status } = req.body ?? {};

  if (typeof status !== "string" || !NON_TERMINAL_STATUSES.includes(status as InquiryStatus)) {
    return res.status(400).json({ error: `status must be one of: ${NON_TERMINAL_STATUSES.join(", ")}` });
  }

  const inquiry = await prisma.inquiry.findUnique({ where: { id } });
  if (!inquiry || !(await callerBelongsToStudio(req.user!, inquiry.studioId))) {
    return res.status(404).json({ error: "Inquiry not found" });
  }

  // Permission-context fix: evaluated at the inquiry's own studio.
  if (!(await hasPermissionAt(req.user!, inquiry.studioId, "inquiries.edit"))) {
    return res.status(403).json({ error: "Forbidden" });
  }

  if (inquiry.status !== InquiryStatus.CLOSED_LOST && inquiry.status !== InquiryStatus.COLD_LEAD) {
    return res.status(400).json({ error: "Only a CLOSED_LOST or COLD_LEAD inquiry can be reopened" });
  }

  const reopenData = { status: status as InquiryStatus, lostAt: null, lostReason: null };

  const updated = await prisma.inquiry.update({ where: { id }, data: reopenData, include: INQUIRY_INCLUDE });

  await logAudit({
    studioId: inquiry.studioId,
    actorUserId: req.user!.userId,
    entityType: "Inquiry",
    entityId: id,
    action: "status_change",
    changes: diffObjects(inquiry, reopenData, ["status", "lostAt", "lostReason"]),
  });

  emitInvalidation({ type: "inquiry.updated", studioId: inquiry.studioId, inquiryId: id });

  res.json(updated);
});

// On-Hold, Part 3: pause a project without losing its place in the
// pipeline -- statusBeforeHold captures wherever it was AT THE MOMENT of
// holding (not derivable afterward, since `status` itself becomes ON_HOLD),
// so release can restore it exactly. Deliberately scoped to PROJECT_STATUSES
// only (SCHEDULING/WAITLISTED/CONFIRMED) -- the task's own language is
// "place a PROJECT on hold," and restricting to the Projects tab's three
// statuses keeps ON_HOLD's tab/Kanban placement unambiguous (always
// Projects, never Inquiries) rather than needing a rule for what happens to
// a pre-conversion lead that's paused.
router.post("/:id/hold", requireAuth, async (req, res) => {
  const id = req.params.id as string;
  const { reason } = req.body ?? {};

  if (reason !== undefined && reason !== null && typeof reason !== "string") {
    return res.status(400).json({ error: "reason must be a string" });
  }

  const inquiry = await prisma.inquiry.findUnique({ where: { id } });
  if (!inquiry || !(await callerBelongsToStudio(req.user!, inquiry.studioId))) {
    return res.status(404).json({ error: "Inquiry not found" });
  }

  // Permission-context fix: evaluated at the inquiry's own studio, same
  // precedent as every other action route in this file.
  if (!(await hasPermissionAt(req.user!, inquiry.studioId, "inquiries.edit"))) {
    return res.status(403).json({ error: "Forbidden" });
  }

  if (!PROJECT_STATUSES.includes(inquiry.status)) {
    return res.status(400).json({ error: "Only a converted project (Scheduling, Waitlisted, or Confirmed) can be put on hold" });
  }

  const holdData = {
    statusBeforeHold: inquiry.status,
    status: InquiryStatus.ON_HOLD,
    holdReason: typeof reason === "string" && reason.trim().length > 0 ? reason.trim() : null,
    heldAt: new Date(),
  };

  const updated = await prisma.inquiry.update({ where: { id }, data: holdData, include: INQUIRY_INCLUDE });

  await logAudit({
    studioId: inquiry.studioId,
    actorUserId: req.user!.userId,
    entityType: "Inquiry",
    entityId: id,
    action: "status_change",
    changes: diffObjects(inquiry, holdData, ["status", "statusBeforeHold", "holdReason", "heldAt"]),
  });

  emitInvalidation({ type: "inquiry.updated", studioId: inquiry.studioId, inquiryId: id });

  res.json(updated);
});

// On-Hold, Part 3: the reverse of hold above -- restores whatever status
// was captured at hold time and clears the three hold-only fields. No body
// needed (unlike reopen, which must be told a target since CLOSED_LOST/
// COLD_LEAD don't remember where they came from) -- statusBeforeHold
// already knows.
router.post("/:id/release", requireAuth, async (req, res) => {
  const id = req.params.id as string;

  const inquiry = await prisma.inquiry.findUnique({ where: { id } });
  if (!inquiry || !(await callerBelongsToStudio(req.user!, inquiry.studioId))) {
    return res.status(404).json({ error: "Inquiry not found" });
  }

  if (!(await hasPermissionAt(req.user!, inquiry.studioId, "inquiries.edit"))) {
    return res.status(403).json({ error: "Forbidden" });
  }

  if (inquiry.status !== InquiryStatus.ON_HOLD || !inquiry.statusBeforeHold) {
    return res.status(400).json({ error: "This project is not currently on hold" });
  }

  const releaseData = {
    status: inquiry.statusBeforeHold,
    statusBeforeHold: null,
    holdReason: null,
    heldAt: null,
  };

  const updated = await prisma.inquiry.update({ where: { id }, data: releaseData, include: INQUIRY_INCLUDE });

  await logAudit({
    studioId: inquiry.studioId,
    actorUserId: req.user!.userId,
    entityType: "Inquiry",
    entityId: id,
    action: "status_change",
    changes: diffObjects(inquiry, releaseData, ["status", "statusBeforeHold", "holdReason", "heldAt"]),
  });

  emitInvalidation({ type: "inquiry.updated", studioId: inquiry.studioId, inquiryId: id });

  res.json(updated);
});

// Service lines: the first of CANDIDACY_REVIEW's three actions -- proceeds
// a candidate straight into the normal pipeline (NEW), where staff assign
// an artist and get a price estimate exactly as any other inquiry would.
// The other two actions are deliberately NOT separate routes: "Mark Not a
// Candidate" reuses POST /:id/mark-lost exactly (same route, same audit
// trail, just a UI-supplied reason), and "Schedule Consultation" reuses the
// existing consultation appointment feature (POST /appointments with
// appointmentType: CONSULTATION) without touching this inquiry's status at
// all -- it stays in CANDIDACY_REVIEW until staff return to make the final
// call.
router.post("/:id/mark-good-candidate", requireAuth, async (req, res) => {
  const id = req.params.id as string;

  const inquiry = await prisma.inquiry.findUnique({ where: { id } });
  if (!inquiry || !(await callerBelongsToStudio(req.user!, inquiry.studioId))) {
    return res.status(404).json({ error: "Inquiry not found" });
  }

  // Permission-context fix: evaluated at the inquiry's own studio.
  if (!(await hasPermissionAt(req.user!, inquiry.studioId, "inquiries.edit"))) {
    return res.status(403).json({ error: "Forbidden" });
  }

  if (inquiry.status !== InquiryStatus.CANDIDACY_REVIEW) {
    return res.status(400).json({ error: "Only an inquiry in CANDIDACY_REVIEW can be marked a good candidate" });
  }

  const goodCandidateData = { status: InquiryStatus.NEW };

  const updated = await prisma.inquiry.update({ where: { id }, data: goodCandidateData, include: INQUIRY_INCLUDE });

  await logAudit({
    studioId: inquiry.studioId,
    actorUserId: req.user!.userId,
    entityType: "Inquiry",
    entityId: id,
    action: "status_change",
    changes: diffObjects(inquiry, goodCandidateData, ["status"]),
  });

  emitInvalidation({ type: "inquiry.updated", studioId: inquiry.studioId, inquiryId: id });

  res.json(updated);
});

// Project pipeline timeline's final stage -- deliberately NOT derived from
// session/checkout state (unlike Scheduled/Waiver Verified/Session
// Complete, computed client-side in InquiryDetail.tsx). A separate route
// from /reopen above: that one reverses a terminal InquiryStatus
// (CLOSED_LOST/COLD_LEAD), this one only ever touches
// projectCompletedAt/projectCompletedById -- a converted project's status
// stays SCHEDULING/WAITLISTED/CONFIRMED throughout, whether or not it's
// been marked complete.
router.post("/:id/complete-project", requireAuth, async (req, res) => {
  const id = req.params.id as string;

  const inquiry = await prisma.inquiry.findUnique({ where: { id } });
  if (!inquiry || !(await callerBelongsToStudio(req.user!, inquiry.studioId))) {
    return res.status(404).json({ error: "Inquiry not found" });
  }

  // Permission-context fix: evaluated at the inquiry's own studio.
  if (!(await hasPermissionAt(req.user!, inquiry.studioId, "inquiries.edit"))) {
    return res.status(403).json({ error: "Forbidden" });
  }

  if (!PROJECT_STATUSES.includes(inquiry.status)) {
    return res.status(400).json({ error: "Only a converted project (deposit paid) can be marked complete" });
  }

  if (inquiry.projectCompletedAt) {
    return res.status(400).json({ error: "This project has already been marked complete" });
  }

  const completeData = { projectCompletedAt: new Date(), projectCompletedById: req.user!.userId };

  const updated = await prisma.inquiry.update({ where: { id }, data: completeData, include: INQUIRY_INCLUDE });

  await logAudit({
    studioId: inquiry.studioId,
    actorUserId: req.user!.userId,
    entityType: "Inquiry",
    entityId: id,
    action: "project_completed",
    changes: diffObjects(inquiry, completeData, ["projectCompletedAt", "projectCompletedById"]),
  });

  emitInvalidation({ type: "inquiry.updated", studioId: inquiry.studioId, inquiryId: id });

  res.json(updated);
});

// Same safety-net pattern as /reopen above (an explicit reversal for a
// click made by mistake, or a client returning for further work after
// being marked complete) -- clears exactly the two fields
// complete-project set, nothing else.
router.post("/:id/reopen-project", requireAuth, async (req, res) => {
  const id = req.params.id as string;

  const inquiry = await prisma.inquiry.findUnique({ where: { id } });
  if (!inquiry || !(await callerBelongsToStudio(req.user!, inquiry.studioId))) {
    return res.status(404).json({ error: "Inquiry not found" });
  }

  // Permission-context fix: evaluated at the inquiry's own studio.
  if (!(await hasPermissionAt(req.user!, inquiry.studioId, "inquiries.edit"))) {
    return res.status(403).json({ error: "Forbidden" });
  }

  if (!inquiry.projectCompletedAt) {
    return res.status(400).json({ error: "This project has not been marked complete" });
  }

  const reopenData = { projectCompletedAt: null, projectCompletedById: null };

  const updated = await prisma.inquiry.update({ where: { id }, data: reopenData, include: INQUIRY_INCLUDE });

  await logAudit({
    studioId: inquiry.studioId,
    actorUserId: req.user!.userId,
    entityType: "Inquiry",
    entityId: id,
    action: "project_reopened",
    changes: diffObjects(inquiry, reopenData, ["projectCompletedAt", "projectCompletedById"]),
  });

  emitInvalidation({ type: "inquiry.updated", studioId: inquiry.studioId, inquiryId: id });

  res.json(updated);
});

// Generates (or, if unsigned, regenerates) a client-facing deposit form
// link. Valid either pre-conversion (DEPOSIT_PENDING, the original
// session) or post-conversion (PROJECT_STATUSES -- Package M's "send
// another deposit form" for a later session), and the tier is computed
// from the artist's own estimate, not anything the client stated.
//
// Package M: an inquiry can now carry several DepositForm rows (one per
// tattoo session) instead of exactly one. This route still does both
// things it always did -- create the first one, or rotate the token on an
// existing UNSIGNED one ("Resend") -- it just decides which based on the
// most recent row rather than a unique-by-inquiry lookup: if that latest
// row is missing or already signed, a new session gets created (next
// sessionNumber); if it's still unsigned, that's the one being resent.
// This also covers the case where an inquiry converted via
// attach-gift-card (skipping the deposit-form flow entirely for its first
// session) and only reaches this route for the first time on session 2 --
// "latest row missing" is true there too, so it still creates session 1.
router.post("/:id/deposit-form", requireAuth, async (req, res) => {
  const id = req.params.id as string;
  const { proposedStartAt, proposedEndAt, autoSend, plannedSessionId, amountMode, channel } = req.body ?? {};

  if (plannedSessionId !== undefined && typeof plannedSessionId !== "string") {
    return res.status(400).json({ error: "plannedSessionId must be a string" });
  }
  if (amountMode !== undefined && amountMode !== "DEPOSIT" && amountMode !== "FULL_PREPAY") {
    return res.status(400).json({ error: "amountMode must be DEPOSIT or FULL_PREPAY" });
  }
  if (channel !== undefined && channel !== "SMS" && channel !== "EMAIL") {
    return res.status(400).json({ error: "channel must be SMS or EMAIL" });
  }

  // Artist mobility bug fix: verify the caller against the PROJECT's own
  // studio, then pass THAT confirmed studioId through -- generateAndSendDepositForm
  // trusts studioId as already-authenticated (its own comment) and uses it
  // for every write inside (deposit form, conversation, gift-card studioId),
  // so this must be the inquiry's real studio, not blindly req.user!.studioId
  // (which is only the caller's HOME studio and would wrongly 404 a
  // legitimately guest-assigned artist).
  const inquiry = await prisma.inquiry.findUnique({ where: { id }, select: { studioId: true } });
  if (!inquiry || !(await callerBelongsToStudio(req.user!, inquiry.studioId))) {
    return res.status(404).json({ error: "Inquiry not found" });
  }

  // Permission-context fix: evaluated at the inquiry's own studio.
  if (!(await hasPermissionAt(req.user!, inquiry.studioId, "inquiries.edit"))) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const result = await generateAndSendDepositForm(id, {
    studioId: inquiry.studioId,
    actorUserId: req.user!.userId,
    proposedStartAt: typeof proposedStartAt === "string" ? proposedStartAt : undefined,
    proposedEndAt: typeof proposedEndAt === "string" ? proposedEndAt : undefined,
    autoSend,
    plannedSessionId,
    amountMode,
    channel,
  });

  if (!result.ok) {
    return res.status(result.status).json({ error: result.error });
  }

  res.status(201).json({ ...result.depositForm, depositUrl: result.depositUrl, depositSendResult: result.depositSendResult });
});

// Package D: staff picks (or clears) a tentative, informational-only time
// from getSuggestedTimes to show on the public deposit page. Deliberately
// separate from POST /:id/deposit-form above -- that route rotates the
// token/expiry every call, which would invalidate a link already sent to
// the client; this only ever touches the two proposed* columns. No
// Appointment is created or referenced here, and no gift card is involved
// -- purely informational, matching the deposit-form's own pre-payment,
// pre-real-scheduling position in the pipeline.
router.patch(
  "/:id/deposit-form/proposed-time",
  requireAuth,
  async (req, res) => {
    const id = req.params.id as string;
    const body = req.body ?? {};
    const { proposedStartAt, proposedEndAt } = body;

    // Package M: several deposit forms can exist for this inquiry now --
    // this route only ever makes sense against whichever one is still
    // awaiting the client's signature (the tentative time is purely
    // pre-signing, informational context), so it targets the most recent
    // still-unsigned session rather than assuming there's only one.
    const inquiry = await prisma.inquiry.findUnique({
      where: { id },
      include: { depositForms: { where: { signedAt: null }, orderBy: { sessionNumber: "desc" }, take: 1 } },
    });
    if (!inquiry || !(await callerBelongsToStudio(req.user!, inquiry.studioId))) {
      return res.status(404).json({ error: "Inquiry not found" });
    }

    // Permission-context fix: evaluated at the inquiry's own studio.
    if (!(await hasPermissionAt(req.user!, inquiry.studioId, "inquiries.edit"))) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const pending = inquiry.depositForms[0];
    if (!pending) {
      return res.status(400).json({ error: "This inquiry has no deposit form awaiting signature" });
    }

    // Both set or both cleared -- never a dangling start with no end.
    const bothNull = proposedStartAt === null && proposedEndAt === null;
    const bothStrings = typeof proposedStartAt === "string" && typeof proposedEndAt === "string";
    if (!bothNull && !bothStrings) {
      return res.status(400).json({ error: "proposedStartAt and proposedEndAt must both be set or both be null" });
    }
    if (bothStrings && !(new Date(proposedStartAt) < new Date(proposedEndAt))) {
      return res.status(400).json({ error: "proposedStartAt must be before proposedEndAt" });
    }

    const updated = await prisma.depositForm.update({
      where: { id: pending.id },
      data: {
        proposedStartAt: bothStrings ? new Date(proposedStartAt) : null,
        proposedEndAt: bothStrings ? new Date(proposedEndAt) : null,
      },
    });

    await logAudit({
      studioId: inquiry.studioId,
      actorUserId: req.user!.userId,
      entityType: "DepositForm",
      entityId: updated.id,
      action: "update",
      changes: { proposedStartAt: updated.proposedStartAt, proposedEndAt: updated.proposedEndAt },
    });

    res.json(updated);
  },
);

// Alternative to the deposit-form flow above: the client already has an
// available gift card on file (e.g. from an earlier project, or issued
// directly by staff) that can secure this booking, so there's nothing to
// send/sign -- just move straight to SCHEDULING. Deliberately does NOT
// touch GiftCard.appointmentId here; the actual attach happens at
// POST /:id/schedule like every other card, same as mark-paid's freshly-
// issued card isn't attached to anything until that same step.
//
// Staff routinely hits "Send Deposit Form" before ever checking whether the
// client already has a card on file, so this stays available even after an
// unsigned DepositForm already exists -- it's only blocked once the client
// has actually signed one (a real commitment shouldn't be silently
// discarded). An unsigned one gets deleted here rather than left behind, so
// its public link can't still be signed for an inquiry that's already
// moved on without it.
router.post("/:id/attach-gift-card", requireAuth, async (req, res) => {
  const id = req.params.id as string;
  const { giftCardId } = req.body ?? {};

  if (!giftCardId) {
    return res.status(400).json({ error: "giftCardId is required" });
  }

  // Only reachable pre-conversion (DEPOSIT_PENDING, gated below), so at
  // most one DepositForm row can exist for this inquiry at this point --
  // Package M's multi-session rows only ever get created post-conversion.
  const inquiry = await prisma.inquiry.findUnique({ where: { id }, include: { depositForms: true } });
  if (!inquiry || !(await callerBelongsToStudio(req.user!, inquiry.studioId))) {
    return res.status(404).json({ error: "Inquiry not found" });
  }

  // Permission-context fix: evaluated at the inquiry's own studio.
  if (!(await hasPermissionAt(req.user!, inquiry.studioId, "inquiries.edit"))) {
    return res.status(403).json({ error: "Forbidden" });
  }

  if (inquiry.status !== InquiryStatus.DEPOSIT_PENDING) {
    return res.status(400).json({ error: "Only an inquiry in DEPOSIT_PENDING can skip to an existing gift card" });
  }

  // Same artist-assignment requirement as POST /:id/deposit-form -- this
  // route reaches the identical DEPOSIT_PENDING -> SCHEDULING transition
  // by a different door (an existing card instead of a freshly paid one),
  // so it needs the same gate or staff could route around the requirement
  // entirely whenever a client happens to have a spare card on file.
  if (!inquiry.assignedArtistId) {
    return res.status(400).json({ error: "Assign an artist before requesting a deposit" });
  }

  const existingDepositForm = inquiry.depositForms[0] as (typeof inquiry.depositForms)[number] | undefined;

  if (existingDepositForm?.signedAt) {
    return res.status(400).json({ error: "This client has already signed a deposit form for this inquiry" });
  }

  const giftCardResult = await validateGiftCardForAttachment(giftCardId, inquiry.studioId, inquiry.clientId);
  if ("error" in giftCardResult) {
    return res.status(400).json({ error: giftCardResult.error });
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (existingDepositForm) {
      await tx.depositForm.delete({ where: { id: existingDepositForm.id } });
    }
    return tx.inquiry.update({ where: { id }, data: { status: InquiryStatus.SCHEDULING } });
  });

  await logAudit({
    studioId: inquiry.studioId,
    actorUserId: req.user!.userId,
    entityType: "Inquiry",
    entityId: id,
    action: "status_change",
    changes: {
      ...diffObjects(inquiry, { status: InquiryStatus.SCHEDULING }, ["status"]),
      satisfiedByExistingGiftCardId: giftCardId,
      ...(existingDepositForm ? { discardedUnsignedDepositFormId: existingDepositForm.id } : {}),
    },
  });

  emitInvalidation({ type: "inquiry.updated", studioId: inquiry.studioId, inquiryId: id });

  res.json(updated);
});

// Explicit allowlist projection for the sanitized artist share -- named
// fields only, built up rather than derived by deleting keys from a full
// inquiry object, so nothing client-identifying (name/email/phone/DOB/
// address/emergency contact/health data/ID images) can leak through by
// accident as new Inquiry fields get added later. Deliberately just these
// seven fields plus photos -- no preferred artist, no staff-internal price/
// time estimate, both of which used to leak into this share before.
function buildSharedInquiryProjection(inquiry: {
  description: string;
  colorOrBlackGrey: string;
  placement: string;
  estimatedSize: string;
  hasBeenTattooedBefore: boolean;
  budget: string | null;
  desiredTiming: string | null;
  referenceImages: string[];
  placementImages: string[];
}): { body: string; attachments: string[] } {
  const lines = [
    `Tattoo: ${inquiry.description}`,
    `Style: ${inquiry.colorOrBlackGrey}`,
    `Placement: ${inquiry.placement}`,
    `Size: ${inquiry.estimatedSize}`,
    `Previously tattooed: ${inquiry.hasBeenTattooedBefore ? "Yes" : "No"}`,
  ];

  if (inquiry.budget) lines.push(`Budget: ${inquiry.budget}`);
  if (inquiry.desiredTiming) lines.push(`Desired timing: ${inquiry.desiredTiming}`);

  return { body: lines.join("\n"), attachments: [...inquiry.referenceImages, ...inquiry.placementImages] };
}

// Preview: exactly what would be composed into the artist's thread, before
// an artist is even picked -- the projection never depends on who receives
// it, so the frontend's confirmation modal can show this ahead of send (and
// let staff edit it there before sending -- see the optional body override
// below).
router.get("/:id/share-to-artist/preview", requireAuth, async (req, res) => {
  const id = req.params.id as string;

  const inquiry = await prisma.inquiry.findUnique({ where: { id } });
  if (!inquiry || !(await callerBelongsToStudio(req.user!, inquiry.studioId))) {
    return res.status(404).json({ error: "Inquiry not found" });
  }

  // Permission-context fix: evaluated at the inquiry's own studio.
  if (!(await hasPermissionAt(req.user!, inquiry.studioId, "inquiries.shareWithArtist"))) {
    return res.status(403).json({ error: "Forbidden" });
  }

  res.json(buildSharedInquiryProjection(inquiry));
});

// Sends a sanitized copy of an inquiry's tattoo details into the front-desk
// <-> artist STAFF thread. `body` is optional -- staff can edit the
// generated preview in the share modal before sending, so this accepts
// their edited text as an override; omitted (or blank), it falls back to
// the same fixed projection the preview above shows. Unlike the client-
// facing composer, this is staff talking to staff, so free-text here isn't
// the PII risk the original fixed-projection-only design was guarding
// against -- that guard was about auto-including client-identifying
// fields, not about staff's own wording.
router.post("/:id/share-to-artist", requireAuth, async (req, res) => {
  const id = req.params.id as string;
  const { userId } = req.user!;
  const { artistUserId, body: customBody } = req.body ?? {};

  if (typeof artistUserId !== "string" || artistUserId.trim().length === 0) {
    return res.status(400).json({ error: "artistUserId is required" });
  }

  if (customBody !== undefined && typeof customBody !== "string") {
    return res.status(400).json({ error: "body must be a string" });
  }

  const inquiry = await prisma.inquiry.findUnique({ where: { id } });
  if (!inquiry || !(await callerBelongsToStudio(req.user!, inquiry.studioId))) {
    return res.status(404).json({ error: "Inquiry not found" });
  }

  // Permission-context fix: evaluated at the inquiry's own studio.
  if (!(await hasPermissionAt(req.user!, inquiry.studioId, "inquiries.shareWithArtist"))) {
    return res.status(403).json({ error: "Forbidden" });
  }
  // Artist mobility bug fix: everything below is scoped to the PROJECT's
  // own studio (which the check above just confirmed the caller has a real
  // relationship with -- HOME or GUEST), not the caller's own req.user!.studioId
  // -- those two only ever differ for a guest-artist caller, and using the
  // caller's home studio here would create the conversation/message/audit
  // log under the wrong studio and wrongly reject a guest target artist too.
  const studioId = inquiry.studioId;

  const artist = await prisma.artist.findUnique({ where: { userId: artistUserId }, include: { user: true } });
  const targetArtistBelongsToStudio =
    artist != null && (artist.user.studioId === studioId || (await studioHasActiveMembership(studioId, artist.id)));
  if (!targetArtistBelongsToStudio || artist!.user.role !== Role.ARTIST) {
    return res.status(400).json({ error: "artistUserId must be an artist in your studio" });
  }

  const { conversation } = await getOrCreateStaffConversation(studioId, artistUserId, userId);
  const { body: defaultBody, attachments } = buildSharedInquiryProjection(inquiry);
  const body = customBody && customBody.trim().length > 0 ? customBody.trim() : defaultBody;
  const now = new Date();

  const [message] = await prisma.$transaction([
    prisma.message.create({
      data: {
        studioId,
        conversationId: conversation.id,
        channel: MessageChannel.IN_APP,
        direction: MessageDirection.OUTBOUND,
        body,
        attachments: attachments.length > 0 ? attachments : undefined,
        authorUserId: userId,
        // Set at creation only -- messages stay immutable. Lets the UI
        // render this as a distinct "Shared inquiry" card instead of a
        // plain text bubble.
        metadata: { kind: "shared_inquiry", inquiryId: id },
        createdAt: now,
      },
    }),
    // New activity un-archives -- see Conversation.archivedAt's own schema
    // comment. Harmless no-op when it wasn't archived.
    prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: now, archivedAt: null, archivedById: null },
    }),
  ]);

  await logAudit({
    studioId,
    actorUserId: userId,
    entityType: "Inquiry",
    entityId: id,
    action: "shared_to_artist",
    changes: { artistUserId },
  });

  res.status(201).json({ conversationId: conversation.id, messageId: message.id });
});

// Archive: soft, reversible hide -- same treatment as Client.archivedAt.
router.post("/:id/archive", requireAuth, async (req, res) => {
  const id = req.params.id as string;
  const inquiry = await prisma.inquiry.findUnique({ where: { id } });
  if (!inquiry || !(await callerBelongsToStudio(req.user!, inquiry.studioId))) {
    return res.status(404).json({ error: "Inquiry not found" });
  }

  // Permission-context fix: evaluated at the inquiry's own studio.
  if (!(await hasPermissionAt(req.user!, inquiry.studioId, "inquiries.edit"))) {
    return res.status(403).json({ error: "Forbidden" });
  }

  if (inquiry.archivedAt) {
    return res.json(inquiry);
  }

  const updated = await prisma.inquiry.update({ where: { id }, data: { archivedAt: new Date() } });

  await logAudit({
    studioId: inquiry.studioId,
    actorUserId: req.user!.userId,
    entityType: "Inquiry",
    entityId: id,
    action: "archive",
    changes: { archivedAt: updated.archivedAt },
  });

  res.json(updated);
});

router.post("/:id/unarchive", requireAuth, async (req, res) => {
  const id = req.params.id as string;
  const inquiry = await prisma.inquiry.findUnique({ where: { id } });
  if (!inquiry || !(await callerBelongsToStudio(req.user!, inquiry.studioId))) {
    return res.status(404).json({ error: "Inquiry not found" });
  }

  // Permission-context fix: evaluated at the inquiry's own studio.
  if (!(await hasPermissionAt(req.user!, inquiry.studioId, "inquiries.edit"))) {
    return res.status(403).json({ error: "Forbidden" });
  }

  if (!inquiry.archivedAt) {
    return res.json(inquiry);
  }

  const updated = await prisma.inquiry.update({ where: { id }, data: { archivedAt: null } });

  await logAudit({
    studioId: inquiry.studioId,
    actorUserId: req.user!.userId,
    entityType: "Inquiry",
    entityId: id,
    action: "unarchive",
    changes: { archivedAt: null },
  });

  res.json(updated);
});

// Shared between the delete-preview and the audit snapshot written just
// before the real DELETE below.
async function gatherInquiryDeletionSummary(inquiryId: string) {
  const appointments = await prisma.appointment.findMany({ where: { inquiryId }, select: { id: true } });
  const appointmentIds = appointments.map((a) => a.id);

  const [waivers, depositFormCount, attachedGiftCards, conversationTagCount, plannedSessionCount] = await Promise.all([
    prisma.liabilityWaiver.count({ where: { appointmentId: { in: appointmentIds } } }),
    // Package M: could be several now (one per session), not just 0 or 1.
    prisma.depositForm.count({ where: { inquiryId } }),
    prisma.giftCard.findMany({
      where: { appointmentId: { in: appointmentIds } },
      select: { id: true, code: true, amountCents: true, status: true },
    }),
    prisma.conversationTag.count({
      where: {
        OR: [
          { entityType: "Inquiry", entityId: inquiryId },
          { entityType: "Appointment", entityId: { in: appointmentIds } },
        ],
      },
    }),
    // Multi-session planning: 0 for any project that never declared more
    // than one session.
    prisma.plannedSession.count({ where: { inquiryId } }),
  ]);

  return {
    appointments: appointmentIds.length,
    waivers,
    depositForms: depositFormCount,
    giftCardsToDetach: attachedGiftCards.map((card) => ({ id: card.id, code: card.code, amountCents: card.amountCents, status: card.status })),
    conversationTags: conversationTagCount,
    plannedSessions: plannedSessionCount,
  };
}

// OWNER only, always available regardless of attached history. Scoped to
// this inquiry's own tree -- unlike client-delete, any gift card attached
// to one of this inquiry's appointments is DETACHED (appointmentId ->
// null), never destroyed: it's the client's money, independent of this
// one project.
router.delete("/:id", requireAuth, requireRole(Role.OWNER), async (req, res) => {
  const id = req.params.id as string;
  const { confirm } = req.body ?? {};

  if (confirm !== "DELETE") {
    return res.status(400).json({ error: 'Type "DELETE" to confirm this action.' });
  }

  const inquiry = await prisma.inquiry.findUnique({ where: { id } });
  if (!inquiry || inquiry.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Inquiry not found" });
  }

  const summary = await gatherInquiryDeletionSummary(id);

  await prisma.$transaction(async (tx) => {
    const appointments = await tx.appointment.findMany({ where: { inquiryId: id }, select: { id: true } });
    const appointmentIds = appointments.map((a) => a.id);

    // Detach, don't destroy -- the client's money survives this delete.
    await tx.giftCard.updateMany({ where: { appointmentId: { in: appointmentIds } }, data: { appointmentId: null } });

    await tx.liabilityWaiver.deleteMany({ where: { appointmentId: { in: appointmentIds } } });
    await tx.conversationTag.deleteMany({
      where: {
        OR: [
          { entityType: "Inquiry", entityId: id },
          { entityType: "Appointment", entityId: { in: appointmentIds } },
        ],
      },
    });
    await tx.depositForm.deleteMany({ where: { inquiryId: id } });

    // Inquiry.appointmentId is an optional back-reference to one of these
    // same appointments -- null it before deleting them, or that FK blocks
    // the appointment delete below.
    await tx.inquiry.update({ where: { id }, data: { appointmentId: null } });
    await tx.appointment.deleteMany({ where: { inquiryId: id } });

    // Multi-session planning: PlannedSession.inquiryId is ON DELETE
    // RESTRICT (its depositFormId/appointmentId links are already SET
    // NULL by the deletes above, so those never block anything) -- without
    // this, deleting the Inquiry itself below would fail with a foreign
    // key violation for any project that ever declared more than one
    // session.
    await tx.plannedSession.deleteMany({ where: { inquiryId: id } });
    await tx.inquiry.delete({ where: { id } });
  });

  await logAudit({
    studioId: req.user!.studioId,
    actorUserId: req.user!.userId,
    entityType: "Inquiry",
    entityId: id,
    action: "permanently_deleted",
    changes: {
      inquiry: { description: inquiry.description, status: inquiry.status, clientId: inquiry.clientId },
      ...summary,
    },
  });

  res.json({ success: true, detachedGiftCards: summary.giftCardsToDetach });
});

router.get("/:id/delete-preview", requireAuth, requireRole(Role.OWNER), async (req, res) => {
  const id = req.params.id as string;
  const inquiry = await prisma.inquiry.findUnique({ where: { id } });
  if (!inquiry || inquiry.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Inquiry not found" });
  }

  const summary = await gatherInquiryDeletionSummary(id);
  res.json(summary);
});

// Manually-written commentary log -- a dedicated GET rather than folding
// into GET /:id, since bodyHtml can grow (rich text, several entries) and
// most callers of the inquiry detail fetch don't need it on every load.
// Same OWNER/FRONT_DESK gate as GET /:id itself (Package L: "ARTIST has no
// access, matches page-level gating") -- an ARTIST can't load the inquiry
// detail page at all, so they never reach this route either.
router.get("/:id/notes", requireAuth, async (req, res) => {
  const id = req.params.id as string;

  const inquiry = await prisma.inquiry.findUnique({ where: { id }, select: { studioId: true } });
  if (!inquiry || !(await callerBelongsToStudio(req.user!, inquiry.studioId))) {
    return res.status(404).json({ error: "Inquiry not found" });
  }

  // Permission-context fix: evaluated at the inquiry's own studio.
  if (!(await hasPermissionAt(req.user!, inquiry.studioId, "inquiries.notes.manage"))) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const notes = await prisma.inquiryNote.findMany({
    where: { inquiryId: id },
    include: { author: NOTE_AUTHOR_SELECT },
    orderBy: { createdAt: "desc" },
  });

  res.json(notes);
});

router.post("/:id/notes", requireAuth, async (req, res) => {
  const id = req.params.id as string;
  const { bodyHtml, attachments, visibleToArtist } = req.body ?? {};

  if (typeof bodyHtml !== "string" || isBlankHtml(bodyHtml)) {
    return res.status(400).json({ error: "bodyHtml is required" });
  }

  if (attachments !== undefined && !isValidAttachments(attachments)) {
    return res.status(400).json({ error: "attachments must be an array of {url, filename, mimeType}" });
  }

  if (visibleToArtist !== undefined && typeof visibleToArtist !== "boolean") {
    return res.status(400).json({ error: "visibleToArtist must be a boolean" });
  }

  const inquiry = await prisma.inquiry.findUnique({ where: { id }, select: { studioId: true } });
  if (!inquiry || !(await callerBelongsToStudio(req.user!, inquiry.studioId))) {
    return res.status(404).json({ error: "Inquiry not found" });
  }

  // Permission-context fix: evaluated at the inquiry's own studio.
  if (!(await hasPermissionAt(req.user!, inquiry.studioId, "inquiries.notes.manage"))) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const note = await prisma.inquiryNote.create({
    data: {
      studioId: inquiry.studioId,
      inquiryId: id,
      authorId: req.user!.userId,
      bodyHtml: bodyHtml.trim(),
      attachments: attachments && attachments.length > 0 ? attachments : undefined,
      visibleToArtist: visibleToArtist ?? false,
    },
    include: { author: NOTE_AUTHOR_SELECT },
  });

  await logAudit({
    studioId: inquiry.studioId,
    actorUserId: req.user!.userId,
    entityType: "InquiryNote",
    entityId: note.id,
    action: "create",
    changes: { inquiryId: id },
  });

  emitInvalidation({ type: "inquiry.updated", studioId: inquiry.studioId, inquiryId: id });

  res.status(201).json(note);
});

router.patch("/:id/notes/:noteId", requireAuth, async (req, res) => {
  const id = req.params.id as string;
  const noteId = req.params.noteId as string;
  const { bodyHtml, attachments, visibleToArtist } = req.body ?? {};

  if (typeof bodyHtml !== "string" || isBlankHtml(bodyHtml)) {
    return res.status(400).json({ error: "bodyHtml is required" });
  }

  if (attachments !== undefined && !isValidAttachments(attachments)) {
    return res.status(400).json({ error: "attachments must be an array of {url, filename, mimeType}" });
  }

  if (visibleToArtist !== undefined && typeof visibleToArtist !== "boolean") {
    return res.status(400).json({ error: "visibleToArtist must be a boolean" });
  }

  const note = await prisma.inquiryNote.findUnique({ where: { id: noteId } });
  if (!note || note.inquiryId !== id || !(await callerBelongsToStudio(req.user!, note.studioId))) {
    return res.status(404).json({ error: "Note not found" });
  }

  // Permission-context fix: evaluated at the note's own studio.
  if (!(await hasPermissionAt(req.user!, note.studioId, "inquiries.notes.manage"))) {
    return res.status(403).json({ error: "Forbidden" });
  }

  if (!canModifyNote(note, req)) {
    return res.status(403).json({ error: "Only this note's author or an OWNER can edit it" });
  }

  const trimmed = bodyHtml.trim();
  // attachments is only ever sent as the edit form's full, current list
  // (additions and removals already applied client-side) -- undefined
  // means "this PATCH doesn't touch attachments at all" (kept as-is),
  // distinct from an explicit [] meaning "remove them all" (Prisma.JsonNull,
  // not plain null/undefined, is required to actually clear a Json? column).
  const attachmentsUpdate: Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined =
    attachments === undefined ? undefined : attachments.length > 0 ? attachments : Prisma.JsonNull;

  const updated = await prisma.inquiryNote.update({
    where: { id: noteId },
    data: { bodyHtml: trimmed, attachments: attachmentsUpdate, visibleToArtist },
    include: { author: NOTE_AUTHOR_SELECT },
  });

  await logAudit({
    studioId: note.studioId,
    actorUserId: req.user!.userId,
    entityType: "InquiryNote",
    entityId: noteId,
    action: "update",
    changes: diffObjects(note, { bodyHtml: trimmed }, ["bodyHtml"]),
  });

  emitInvalidation({ type: "inquiry.updated", studioId: note.studioId, inquiryId: id });

  res.json(updated);
});

router.delete("/:id/notes/:noteId", requireAuth, async (req, res) => {
  const id = req.params.id as string;
  const noteId = req.params.noteId as string;

  const note = await prisma.inquiryNote.findUnique({ where: { id: noteId } });
  if (!note || note.inquiryId !== id || !(await callerBelongsToStudio(req.user!, note.studioId))) {
    return res.status(404).json({ error: "Note not found" });
  }

  // Permission-context fix: evaluated at the note's own studio.
  if (!(await hasPermissionAt(req.user!, note.studioId, "inquiries.notes.manage"))) {
    return res.status(403).json({ error: "Forbidden" });
  }

  if (!canModifyNote(note, req)) {
    return res.status(403).json({ error: "Only this note's author or an OWNER can delete it" });
  }

  await prisma.inquiryNote.delete({ where: { id: noteId } });

  await logAudit({
    studioId: note.studioId,
    actorUserId: req.user!.userId,
    entityType: "InquiryNote",
    entityId: noteId,
    action: "delete",
    changes: { inquiryId: id, deletedBodyHtml: note.bodyHtml },
  });

  emitInvalidation({ type: "inquiry.updated", studioId: note.studioId, inquiryId: id });

  res.json({ success: true });
});

export default router;
