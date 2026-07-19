import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth, requireRole } from "../middleware/auth";
import { Role } from "../../generated/prisma/enums";
import { diffObjects, logAudit } from "../lib/audit";

const router = Router();

router.use(requireAuth);
router.use(requireRole(Role.OWNER, Role.FRONT_DESK));

// One row per studio, created by the Phase 1 migration's backfill -- every
// studio should already have one, but fall back to creating it on read in
// case a studio is ever created without going through that path again.
async function getOrCreateSettings(studioId: string) {
  const existing = await prisma.studioSettings.findUnique({ where: { studioId } });
  if (existing) return existing;
  return prisma.studioSettings.create({ data: { studioId } });
}

router.get("/", async (req, res) => {
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
      "waiverHealthQuestions",
      "waiverClauses",
      "messageTemplates",
      "showSidebarBadges",
    ] as (keyof typeof existing)[]),
  });

  res.json(updated);
});

export default router;
