import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth, requireRole } from "../middleware/auth";
import { Role } from "../../generated/prisma/enums";
import { diffObjects, logAudit } from "../lib/audit";
import { DEFAULT_DEPOSIT_TIERS, validateDepositTiers } from "../lib/depositTiers";
import { THEME_PRESET_KEYS, isValidThemePreset } from "../lib/themePresets";
import { getEffectiveIntakeFormFields } from "../lib/intakeFormFields";
import { resolveIntakeForm } from "../lib/intakeForms";
import { hasPermission, type PermissionKey } from "../lib/permissions";
import { emitInvalidation } from "../lib/realtime/registry";
import { normalizeArtistFieldVisibility } from "../lib/artistFieldVisibility";
import { resolveRequestLocale, resolveSystemFieldLabel, withLocale } from "../lib/contentTranslation";
import { isSupportedLocale } from "../lib/locale";

// Public: /privacy/:studioSlug and /terms/:studioSlug (unauthenticated) need
// to read these two fields by slug, same "public sub-router mounted first"
// split already used by giftCards.ts/waivers.ts/customPolicies.ts -- kept in
// this same file rather than a new one since it's two fields off the same
// model the staff router below already owns end to end.
const publicRouter = Router();

publicRouter.get("/public", async (req, res) => {
  const studioSlug = req.query.studioSlug;
  if (typeof studioSlug !== "string" || !studioSlug) {
    return res.status(400).json({ error: "studioSlug is required" });
  }

  const studio = await prisma.studio.findUnique({ where: { slug: studioSlug } });
  if (!studio) {
    return res.status(404).json({ error: "Studio not found" });
  }

  const settings = await prisma.studioSettings.findUnique({
    where: { studioId: studio.id },
    include: { translations: true },
  });

  // formSlug absent -> whichever form is currently the default, same
  // resolution POST /inquiries and POST /prefill-drafts use -- so
  // /inquiry/{studio-slug} (no form-slug segment) keeps resolving to
  // exactly what it always has, zero disruption for every already-shared
  // or bookmarked link.
  const formSlug = typeof req.query.formSlug === "string" ? req.query.formSlug : null;
  const form = await resolveIntakeForm(studio.id, formSlug);
  if (!form) {
    return res.status(404).json({ error: "Intake form not found" });
  }

  // Package Q (revised): every enabled field (system + custom), in the
  // form's own configured order -- a disabled field is dropped entirely
  // here, never sent to the public form at all. Same fallback-to-defaults
  // helper POST /inquiries validates submissions against, so the two never
  // disagree about what a form with zero rows requires.
  const allFields = await getEffectiveIntakeFormFields(form.id);

  // Multi-language public forms: no Client exists yet at this, the very
  // first step of the whole funnel -- resolution here can only ever use
  // ?locale= or the studio's own defaultLocale.
  const locale = resolveRequestLocale(req.query.locale, null, settings?.defaultLocale);
  const settingsTranslation = settings?.translations.find((t) => t.locale === locale);
  const localizedSettings = settings
    ? withLocale(settings, settingsTranslation, [
        "privacyPolicy",
        "termsAndConditions",
        "refundPolicy",
        "depositPolicy",
        "reschedulePolicy",
        "communicationPolicy",
      ])
    : null;

  // Real DB rows only -- a form with zero customized rows yet (the
  // synthetic SYSTEM_FIELD_DEFAULTS fallback inside getEffectiveIntakeFormFields)
  // has field.id values that are just the field's own key string ("name",
  // "email", ...), never a real cuid, so this naturally returns zero rows
  // for that case rather than needing a separate branch -- the
  // SEED-EQUALITY fallback inside resolveSystemFieldLabel handles every
  // untouched field correctly on its own.
  const fieldTranslations = await prisma.intakeFormFieldTranslation.findMany({
    where: { intakeFormFieldId: { in: allFields.map((f) => f.id) }, locale },
  });
  const fieldTranslationById = new Map(fieldTranslations.map((t) => [t.intakeFormFieldId, t]));

  const localizedFields = allFields
    .filter((f) => f.enabled)
    .map((f) => {
      const translation = fieldTranslationById.get(f.id);
      if (f.fieldKind === "SYSTEM") {
        return {
          ...f,
          label: resolveSystemFieldLabel(f.systemFieldKey, f.label, locale, translation?.label),
          helpText: translation?.helpText || f.helpText,
        };
      }
      // CUSTOM: never platform-seeded, always the studio's own translation
      // row if present, else their own (English or whatever) label as-is.
      return withLocale(f, translation, ["label", "helpText", "options"]);
    });

  res.json({
    resolvedLocale: locale,
    studioName: studio.name,
    // OG-preview infra: server.mjs's /inquiry SSR handler uses this the
    // same way every other public route's own verify endpoint does --
    // just the presence/absence, never the raw data: URL itself (see
    // routes/publicAssets.ts).
    studioLogoUrl: studio.logoUrl,
    formName: form.name,
    privacyPolicy: localizedSettings?.privacyPolicy ?? null,
    termsAndConditions: localizedSettings?.termsAndConditions ?? null,
    refundPolicy: localizedSettings?.refundPolicy ?? null,
    depositPolicy: localizedSettings?.depositPolicy ?? null,
    reschedulePolicy: localizedSettings?.reschedulePolicy ?? null,
    communicationPolicy: localizedSettings?.communicationPolicy ?? null,
    // Drives whether the public intake form even offers "A friend referred
    // me" as a channel option -- default true matches every studio's
    // always-on behavior before this flag existed.
    referralProgramEnabled: settings?.referralProgramEnabled ?? true,
    intakeFormFields: localizedFields,
  });
});

const staffRouter = Router();

staffRouter.use(requireAuth);

// One row per studio, created by the Phase 1 migration's backfill -- every
// studio should already have one, but fall back to creating it on read in
// case a studio is ever created without going through that path again.
async function getOrCreateSettings(studioId: string) {
  const existing = await prisma.studioSettings.findUnique({ where: { studioId } });
  if (existing) return existing;
  return prisma.studioSettings.create({ data: { studioId } });
}

// Read is open to any authenticated studio member (Phase: Calendar's
// business-hours grey-shading needs this for ARTIST-role users too, not
// just OWNER/FRONT_DESK) -- policy/waiver text and business hours aren't
// sensitive the way write access is. PATCH below stays OWNER-only.
staffRouter.get("/", requireRole(Role.OWNER, Role.FRONT_DESK, Role.ARTIST), async (req, res) => {
  const settings = await getOrCreateSettings(req.user!.studioId);
  // Materializes the literal prior hardcoded breakpoints for any studio
  // that hasn't saved its own tiers yet, so the Settings UI (and anyone
  // else reading this route) sees the studio's actual current effective
  // behavior rather than an empty list -- computeDepositTier applies this
  // same fallback independently (see lib/depositTiers.ts), this is purely
  // about not showing a misleadingly-empty editor.
  const depositTiers = Array.isArray(settings.depositTiers) && settings.depositTiers.length > 0
    ? settings.depositTiers
    : DEFAULT_DEPOSIT_TIERS;
  // Same materialize-the-default treatment as depositTiers above -- the
  // Settings UI renders two real checkboxes, not a tri-state "unset" one.
  const artistFieldVisibility = normalizeArtistFieldVisibility(settings.artistFieldVisibility);

  // Multi-language public forms, Part 6: keyed by locale, same shape PATCH
  // accepts under body.translations -- lets the Settings editor pre-fill
  // each field's Spanish draft without a second round-trip.
  const translationRows = await prisma.studioSettingsTranslation.findMany({ where: { studioId: req.user!.studioId } });
  const translations: Record<string, Record<string, unknown>> = {};
  for (const row of translationRows) {
    const fields: Record<string, unknown> = {};
    for (const field of STUDIO_SETTINGS_TRANSLATABLE_FIELDS) {
      fields[field] = row[field];
    }
    translations[row.locale] = fields;
  }

  res.json({ ...settings, depositTiers, artistFieldVisibility, translations });
});

const TEXT_FIELDS = [
  "refundPolicy",
  "depositPolicy",
  "reschedulePolicy",
  "communicationPolicy",
  "calendarInviteTemplate",
  "estimateTerms",
  "waiverAcknowledgment",
  "waiverPhotoRelease",
  "privacyPolicy",
  "termsAndConditions",
] as const;

// Curated, not the full ~400-zone IANA list -- Settings' timezone control
// is a plain-language <select>, not a technical picker (Phase UI-3's
// standing design mandate). Extend this list if a studio outside these
// zones signs up; each value must remain a real IANA identifier since
// lib/jobs/coldLeadSweep.ts and formatRelativeDateTime consume it directly.
const VALID_TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
] as const;

const HEALTH_QUESTION_TYPES = ["yes_no", "yes_no_explain"];

// Multi-language public forms, Part 4/6: the fields StudioSettingsTranslation
// actually has a column for -- a subset of TEXT_FIELDS above
// (calendarInviteTemplate is staff-only chrome, never shown to a client, so
// it deliberately has no translation column) plus the two waiver JSON
// fields, which aren't in TEXT_FIELDS at all (they get their own dedicated
// list editor on StudioSettings itself).
const STUDIO_SETTINGS_TRANSLATABLE_FIELDS = [
  "refundPolicy",
  "depositPolicy",
  "reschedulePolicy",
  "communicationPolicy",
  "estimateTerms",
  "waiverHealthQuestions",
  "waiverClauses",
  "waiverAcknowledgment",
  "waiverPhotoRelease",
  "privacyPolicy",
  "termsAndConditions",
] as const;

function isValidHealthQuestions(value: unknown): boolean {
  if (!Array.isArray(value)) return false;

  return value.every((entry) => {
    if (typeof entry !== "object" || entry === null) return false;
    const q = entry as Record<string, unknown>;

    if (typeof q.question !== "string" || q.question.trim().length === 0) return false;
    if (!HEALTH_QUESTION_TYPES.includes(q.type as string)) return false;
    if (q.explainPrompt !== undefined && typeof q.explainPrompt !== "string") return false;

    return true;
  });
}

function isValidClauses(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every((c) => typeof c === "string" && c.trim().length > 0);
}

const BUSINESS_HOURS_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

// Same family as Artist.preferredSchedule -- one entry per weekday, but
// open/close times are only required when that day is actually open (a
// closed day just needs isOpen: false, no times to validate).
function isValidBusinessHours(value: unknown): boolean {
  if (!Array.isArray(value)) return false;

  return value.every((entry) => {
    if (typeof entry !== "object" || entry === null) return false;
    const d = entry as Record<string, unknown>;

    if (typeof d.dayOfWeek !== "number" || !Number.isInteger(d.dayOfWeek) || d.dayOfWeek < 0 || d.dayOfWeek > 6) {
      return false;
    }
    if (typeof d.isOpen !== "boolean") return false;

    if (d.isOpen) {
      if (typeof d.openTime !== "string" || !BUSINESS_HOURS_TIME_PATTERN.test(d.openTime)) return false;
      if (typeof d.closeTime !== "string" || !BUSINESS_HOURS_TIME_PATTERN.test(d.closeTime)) return false;
    }

    return true;
  });
}

// Phase 7B-2: the automated reminder cadence's own plain-text SMS
// templates -- a fixed-shape object (one field per reminder type), unlike
// messageTemplates above (an open-ended array the composer's "insert
// template" menu lists). All keys are required non-empty strings: the
// frontend always sends the complete object (merging in whichever one
// template it just edited), so the ticker job (and the Twilio inbound
// webhook, for the two keyword auto-replies below) never has to fall back
// to a hardcoded default at send time. optInConfirmation/helpResponse are
// sent from routes/webhooks.ts on a matched inbound START/YES/UNSTOP or
// HELP keyword, not on the ticker's own 15-minute cadence -- same shape,
// same editor, different trigger.
const REMINDER_TEMPLATE_KEYS = [
  "clientWeekBefore",
  "clientNightBefore",
  "clientMorningOf",
  "artistDayBefore",
  "estimateFollowUp",
  "optInConfirmation",
  "helpResponse",
] as const;

function isValidReminderTemplates(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const t = value as Record<string, unknown>;
  return REMINDER_TEMPLATE_KEYS.every((key) => typeof t[key] === "string" && (t[key] as string).trim().length > 0);
}

const REMINDER_SEND_TIME_KEYS = ["weekBeforeTime", "nightBeforeTime", "morningOfTime", "artistDayBeforeTime"] as const;

function isValidReminderSendTimes(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const t = value as Record<string, unknown>;
  return REMINDER_SEND_TIME_KEYS.every(
    (key) => typeof t[key] === "string" && BUSINESS_HOURS_TIME_PATTERN.test(t[key] as string),
  );
}

// Phase 5: both keys optional (a partial update -- e.g. flipping only
// pricingDetail -- must not require re-sending internalNotes too) and, when
// present, must be a real boolean -- an unrecognized key is silently
// ignored rather than rejected, same tolerance normalizeArtistFieldVisibility
// (lib/artistFieldVisibility.ts) already has for a stored value predating a
// future third key.
function isValidArtistFieldVisibility(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.pricingDetail !== undefined && typeof v.pricingDetail !== "boolean") return false;
  if (v.internalNotes !== undefined && typeof v.internalNotes !== "boolean") return false;
  return true;
}

function isValidMessageTemplates(value: unknown): boolean {
  if (!Array.isArray(value)) return false;

  return value.every((entry) => {
    if (typeof entry !== "object" || entry === null) return false;
    const t = entry as Record<string, unknown>;
    return (
      typeof t.id === "string" &&
      t.id.trim().length > 0 &&
      typeof t.name === "string" &&
      t.name.trim().length > 0 &&
      typeof t.body === "string" &&
      t.body.trim().length > 0
    );
  });
}

// This one route accepts fields from several different settings domains
// (policies, defaults, theme, referral, deposit tiers, message templates),
// each governed by its own configurable permission key -- unlike every
// other route in this expansion, a single requirePermission(key) can't gate
// the whole thing, so each field-group present in the body is checked
// against its own key BEFORE any validation/write runs. A request touching
// even one field the actor isn't allowed to change is rejected outright
// (403, nothing applied) rather than silently dropping just that field.
function presentSettingsPermissionGroups(body: Record<string, unknown>): Set<PermissionKey> {
  const groups = new Set<PermissionKey>();

  if (
    TEXT_FIELDS.some((f) => body[f] !== undefined) ||
    body.waiverHealthQuestions !== undefined ||
    body.waiverClauses !== undefined ||
    body.translations !== undefined
  ) {
    groups.add("settings.managePolicies");
  }

  if (
    body.estimateFollowUpHours !== undefined ||
    body.giftCardDefaultExpirationDays !== undefined ||
    body.coldLeadDays !== undefined ||
    body.timezone !== undefined ||
    body.showSidebarBadges !== undefined ||
    body.businessHours !== undefined ||
    body.reminderTemplates !== undefined ||
    body.reminderSendTimes !== undefined ||
    body.schedulingBufferMinutes !== undefined ||
    body.depositFeeCents !== undefined ||
    body.reminderWeekBeforeDays !== undefined ||
    body.reminderNightBeforeDays !== undefined
  ) {
    groups.add("settings.manageDefaults");
  }

  if (
    body.referralRewardAmountCents !== undefined ||
    body.referralAllowRepeatRedemption !== undefined ||
    body.referralProgramEnabled !== undefined
  ) {
    groups.add("settings.manageReferral");
  }
  if (body.messageTemplates !== undefined) groups.add("conversations.manageTemplates");
  if (body.depositTiers !== undefined) groups.add("depositTiers.manage");
  if (body.themePreset !== undefined) groups.add("settings.manageTheme");
  if (body.artistFieldVisibility !== undefined) groups.add("settings.manageArtistVisibility");

  return groups;
}

staffRouter.patch("/", async (req, res) => {
  const body = req.body ?? {};
  const { studioId, role } = req.user!;

  for (const key of presentSettingsPermissionGroups(body)) {
    if (!(await hasPermission(studioId, role, key))) {
      return res.status(403).json({ error: "Forbidden" });
    }
  }

  const existing = await getOrCreateSettings(req.user!.studioId);

  const data: Record<string, unknown> = {};

  for (const field of TEXT_FIELDS) {
    if (body[field] === undefined) continue;
    if (body[field] !== null && typeof body[field] !== "string") {
      return res.status(400).json({ error: `${field} must be a string or null` });
    }
    data[field] = typeof body[field] === "string" ? body[field] : null;
  }

  if (body.estimateFollowUpHours !== undefined) {
    if (typeof body.estimateFollowUpHours !== "number" || body.estimateFollowUpHours < 0) {
      return res.status(400).json({ error: "estimateFollowUpHours must be a non-negative number" });
    }
    data.estimateFollowUpHours = body.estimateFollowUpHours;
  }

  if (body.giftCardDefaultExpirationDays !== undefined) {
    if (body.giftCardDefaultExpirationDays !== null && typeof body.giftCardDefaultExpirationDays !== "number") {
      return res.status(400).json({ error: "giftCardDefaultExpirationDays must be a number or null" });
    }
    data.giftCardDefaultExpirationDays = body.giftCardDefaultExpirationDays;
  }

  if (body.referralRewardAmountCents !== undefined) {
    if (typeof body.referralRewardAmountCents !== "number" || body.referralRewardAmountCents < 0) {
      return res.status(400).json({ error: "referralRewardAmountCents must be a non-negative number" });
    }
    data.referralRewardAmountCents = body.referralRewardAmountCents;
  }

  if (body.referralProgramEnabled !== undefined) {
    if (typeof body.referralProgramEnabled !== "boolean") {
      return res.status(400).json({ error: "referralProgramEnabled must be a boolean" });
    }
    data.referralProgramEnabled = body.referralProgramEnabled;
  }

  if (body.referralAllowRepeatRedemption !== undefined) {
    if (typeof body.referralAllowRepeatRedemption !== "boolean") {
      return res.status(400).json({ error: "referralAllowRepeatRedemption must be a boolean" });
    }
    data.referralAllowRepeatRedemption = body.referralAllowRepeatRedemption;
  }

  if (body.coldLeadDays !== undefined) {
    if (typeof body.coldLeadDays !== "number" || body.coldLeadDays <= 0) {
      return res.status(400).json({ error: "coldLeadDays must be a positive number" });
    }
    data.coldLeadDays = body.coldLeadDays;
  }

  // Settings "Defaults" tab audit (REPORT.md Part 1 proposal): three
  // previously-hardcoded constants, now studio-level numeric defaults --
  // same validation shape as estimateFollowUpHours/coldLeadDays above.
  if (body.schedulingBufferMinutes !== undefined) {
    if (typeof body.schedulingBufferMinutes !== "number" || body.schedulingBufferMinutes < 0) {
      return res.status(400).json({ error: "schedulingBufferMinutes must be a non-negative number" });
    }
    data.schedulingBufferMinutes = body.schedulingBufferMinutes;
  }

  if (body.depositFeeCents !== undefined) {
    if (typeof body.depositFeeCents !== "number" || body.depositFeeCents < 0) {
      return res.status(400).json({ error: "depositFeeCents must be a non-negative number" });
    }
    data.depositFeeCents = body.depositFeeCents;
  }

  if (body.reminderWeekBeforeDays !== undefined) {
    if (typeof body.reminderWeekBeforeDays !== "number" || body.reminderWeekBeforeDays <= 0) {
      return res.status(400).json({ error: "reminderWeekBeforeDays must be a positive number" });
    }
    data.reminderWeekBeforeDays = body.reminderWeekBeforeDays;
  }

  if (body.reminderNightBeforeDays !== undefined) {
    if (typeof body.reminderNightBeforeDays !== "number" || body.reminderNightBeforeDays <= 0) {
      return res.status(400).json({ error: "reminderNightBeforeDays must be a positive number" });
    }
    data.reminderNightBeforeDays = body.reminderNightBeforeDays;
  }

  if (body.timezone !== undefined) {
    if (typeof body.timezone !== "string" || !(VALID_TIMEZONES as readonly string[]).includes(body.timezone)) {
      return res.status(400).json({ error: `timezone must be one of: ${VALID_TIMEZONES.join(", ")}` });
    }
    data.timezone = body.timezone;
  }

  if (body.waiverHealthQuestions !== undefined) {
    if (body.waiverHealthQuestions !== null && !isValidHealthQuestions(body.waiverHealthQuestions)) {
      return res.status(400).json({
        error: "waiverHealthQuestions must be an array of { question, type: 'yes_no' | 'yes_no_explain', explainPrompt? }",
      });
    }
    data.waiverHealthQuestions = body.waiverHealthQuestions;
  }

  if (body.waiverClauses !== undefined) {
    if (body.waiverClauses !== null && !isValidClauses(body.waiverClauses)) {
      return res.status(400).json({ error: "waiverClauses must be a non-empty array of non-empty strings" });
    }
    data.waiverClauses = body.waiverClauses;
  }

  if (body.messageTemplates !== undefined) {
    if (body.messageTemplates !== null && !isValidMessageTemplates(body.messageTemplates)) {
      return res.status(400).json({ error: "messageTemplates must be an array of { id, name, body }" });
    }
    data.messageTemplates = body.messageTemplates;
  }

  if (body.showSidebarBadges !== undefined) {
    if (typeof body.showSidebarBadges !== "boolean") {
      return res.status(400).json({ error: "showSidebarBadges must be a boolean" });
    }
    data.showSidebarBadges = body.showSidebarBadges;
  }

  if (body.businessHours !== undefined) {
    if (body.businessHours !== null && !isValidBusinessHours(body.businessHours)) {
      return res.status(400).json({
        error: "businessHours must be an array of { dayOfWeek: 0-6, isOpen: boolean, openTime?: 'HH:MM', closeTime?: 'HH:MM' }",
      });
    }
    data.businessHours = body.businessHours;
  }

  if (body.reminderTemplates !== undefined) {
    if (body.reminderTemplates !== null && !isValidReminderTemplates(body.reminderTemplates)) {
      return res.status(400).json({
        error: `reminderTemplates must be an object with non-empty string values for: ${REMINDER_TEMPLATE_KEYS.join(", ")}`,
      });
    }
    data.reminderTemplates = body.reminderTemplates;
  }

  if (body.reminderSendTimes !== undefined) {
    if (body.reminderSendTimes !== null && !isValidReminderSendTimes(body.reminderSendTimes)) {
      return res.status(400).json({
        error: `reminderSendTimes must be an object with 'HH:MM' string values for: ${REMINDER_SEND_TIME_KEYS.join(", ")}`,
      });
    }
    data.reminderSendTimes = body.reminderSendTimes;
  }

  if (body.depositTiers !== undefined) {
    const validationError = validateDepositTiers(body.depositTiers);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }
    data.depositTiers = body.depositTiers;
  }

  if (body.themePreset !== undefined) {
    if (!isValidThemePreset(body.themePreset)) {
      return res.status(400).json({ error: `themePreset must be one of: ${THEME_PRESET_KEYS.join(", ")}` });
    }
    data.themePreset = body.themePreset;
  }

  if (body.artistFieldVisibility !== undefined) {
    if (body.artistFieldVisibility !== null && !isValidArtistFieldVisibility(body.artistFieldVisibility)) {
      return res.status(400).json({
        error: "artistFieldVisibility must be an object with optional boolean pricingDetail/internalNotes keys",
      });
    }
    // Merged with the current stored value, not overwritten wholesale --
    // a request touching only one key (e.g. flipping pricingDetail alone)
    // must not silently reset the other back to its default.
    data.artistFieldVisibility = {
      ...normalizeArtistFieldVisibility(existing.artistFieldVisibility),
      ...(body.artistFieldVisibility ?? {}),
    };
  }

  // Multi-language public forms, Part 6: { translations: { es: { refundPolicy: "...", ... } } }
  // -- one upsert per locale present, only touching fields actually sent
  // (undefined fields leave that locale's existing translation column
  // alone; explicit null clears it back to "fall back to English").
  // Validated the same way TEXT_FIELDS/waiverHealthQuestions/waiverClauses
  // are above -- these are the exact same fields on a sibling table, so the
  // exact same rules apply.
  const translationUpserts: { locale: string; data: Record<string, unknown> }[] = [];
  if (body.translations !== undefined) {
    if (typeof body.translations !== "object" || body.translations === null || Array.isArray(body.translations)) {
      return res.status(400).json({ error: "translations must be an object keyed by locale" });
    }
    for (const [locale, fields] of Object.entries(body.translations as Record<string, unknown>)) {
      if (!isSupportedLocale(locale) || locale === "en") {
        return res.status(400).json({ error: `translations key "${locale}" is not a supported non-English locale` });
      }
      if (typeof fields !== "object" || fields === null || Array.isArray(fields)) {
        return res.status(400).json({ error: `translations.${locale} must be an object` });
      }
      const translationData: Record<string, unknown> = {};
      for (const [field, value] of Object.entries(fields as Record<string, unknown>)) {
        if (!(STUDIO_SETTINGS_TRANSLATABLE_FIELDS as readonly string[]).includes(field)) {
          return res.status(400).json({ error: `translations.${locale}.${field} is not a translatable field` });
        }
        if (field === "waiverHealthQuestions") {
          if (value !== null && !isValidHealthQuestions(value)) {
            return res.status(400).json({ error: `translations.${locale}.waiverHealthQuestions is invalid` });
          }
        } else if (field === "waiverClauses") {
          if (value !== null && !isValidClauses(value)) {
            return res.status(400).json({ error: `translations.${locale}.waiverClauses is invalid` });
          }
        } else if (value !== null && typeof value !== "string") {
          return res.status(400).json({ error: `translations.${locale}.${field} must be a string or null` });
        }
        translationData[field] = value;
      }
      translationUpserts.push({ locale, data: translationData });
    }
  }

  const updated = await prisma.studioSettings.update({ where: { studioId: req.user!.studioId }, data });

  for (const { locale, data: translationData } of translationUpserts) {
    await prisma.studioSettingsTranslation.upsert({
      where: { studioSettingsId_locale: { studioSettingsId: updated.id, locale } },
      create: { studioSettingsId: updated.id, studioId: req.user!.studioId, locale, ...translationData },
      update: translationData,
    });
  }

  if (body.artistFieldVisibility !== undefined) {
    // Realtime standing rule: a connected artist's already-open Inquiries
    // list/detail must pick up the new field visibility without a
    // redeploy or manual refresh. Reuses the existing studio-wide
    // inquiry.updated event (no specific inquiryId -- this can affect
    // every inquiry in the studio, not one) rather than adding a new
    // event type solely for this.
    emitInvalidation({ type: "inquiry.updated", studioId: req.user!.studioId });
  }

  await logAudit({
    studioId: req.user!.studioId,
    actorUserId: req.user!.userId,
    entityType: "StudioSettings",
    entityId: updated.id,
    action: "update",
    changes: diffObjects(existing, data, [
      ...TEXT_FIELDS,
      "estimateFollowUpHours",
      "giftCardDefaultExpirationDays",
      "referralRewardAmountCents",
      "coldLeadDays",
      "timezone",
      "waiverHealthQuestions",
      "waiverClauses",
      "messageTemplates",
      "showSidebarBadges",
      "businessHours",
      "reminderTemplates",
      "reminderSendTimes",
      "depositTiers",
      "themePreset",
      "schedulingBufferMinutes",
      "depositFeeCents",
      "reminderWeekBeforeDays",
      "reminderNightBeforeDays",
      "referralAllowRepeatRedemption",
      "referralProgramEnabled",
      "artistFieldVisibility",
    ] as (keyof typeof existing)[]),
  });

  res.json({ ...updated, artistFieldVisibility: normalizeArtistFieldVisibility(updated.artistFieldVisibility) });
});

// GET/PUT for a specific form's own field list moved to routes/
// intakeForms.ts (/intake-forms/:formId/fields) once a studio could have
// more than one form -- see that file.

export { publicRouter, staffRouter };
