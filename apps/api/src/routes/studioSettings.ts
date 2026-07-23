import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth, requireRole } from "../middleware/auth";
import { Role } from "../../generated/prisma/enums";
import { diffObjects, logAudit } from "../lib/audit";
import { DEFAULT_DEPOSIT_TIERS, validateDepositTiers } from "../lib/depositTiers";
import { THEME_PRESET_KEYS, isValidThemePreset } from "../lib/themePresets";

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

  const settings = await prisma.studioSettings.findUnique({ where: { studioId: studio.id } });

  res.json({
    studioName: studio.name,
    privacyPolicy: settings?.privacyPolicy ?? null,
    termsAndConditions: settings?.termsAndConditions ?? null,
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
  res.json({ ...settings, depositTiers });
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
// template" menu lists). All 5 keys are required non-empty strings: the
// frontend always sends the complete object (merging in whichever one
// template it just edited), so the ticker job never has to fall back to
// a hardcoded default at send time.
const REMINDER_TEMPLATE_KEYS = [
  "clientWeekBefore",
  "clientNightBefore",
  "clientMorningOf",
  "artistDayBefore",
  "estimateFollowUp",
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

staffRouter.patch("/", requireRole(Role.OWNER), async (req, res) => {
  const body = req.body ?? {};
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

  if (body.coldLeadDays !== undefined) {
    if (typeof body.coldLeadDays !== "number" || body.coldLeadDays <= 0) {
      return res.status(400).json({ error: "coldLeadDays must be a positive number" });
    }
    data.coldLeadDays = body.coldLeadDays;
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

  const updated = await prisma.studioSettings.update({ where: { studioId: req.user!.studioId }, data });

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
    ] as (keyof typeof existing)[]),
  });

  res.json(updated);
});

export { publicRouter, staffRouter };
