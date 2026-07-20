import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth, requireRole } from "../middleware/auth";
import { Role } from "../../generated/prisma/enums";
import { diffObjects, logAudit } from "../lib/audit";

const router = Router();

router.use(requireAuth);

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
router.get("/", requireRole(Role.OWNER, Role.FRONT_DESK, Role.ARTIST), async (req, res) => {
  const settings = await getOrCreateSettings(req.user!.studioId);
  res.json(settings);
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

router.patch("/", requireRole(Role.OWNER), async (req, res) => {
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
      "coldLeadDays",
      "timezone",
      "waiverHealthQuestions",
      "waiverClauses",
      "messageTemplates",
      "showSidebarBadges",
      "businessHours",
    ] as (keyof typeof existing)[]),
  });

  res.json(updated);
});

export default router;
