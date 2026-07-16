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

const TEXT_FIELDS = ["refundPolicy", "depositPolicy", "reschedulePolicy", "communicationPolicy", "calendarInviteTemplate"] as const;

router.patch("/", requireRole(Role.OWNER), async (req, res) => {
  const body = req.body ?? {};
  const existing = await getOrCreateSettings(req.user!.studioId);

  const data: Record<string, string | number | null> = {};

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
    ] as (keyof typeof existing)[]),
  });

  res.json(updated);
});

export default router;
