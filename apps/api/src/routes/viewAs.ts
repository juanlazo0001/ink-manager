import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth";
import { Role } from "../../generated/prisma/enums";
import { logAudit } from "../lib/audit";
import { resolveViewAsTarget } from "../lib/viewAs";

const router = Router();
router.use(requireAuth);

// Called by the real OWNER, WITHOUT the X-View-As-User header (view-as
// isn't active yet), so req.user here is genuinely the admin -- the
// resulting audit row's actorUserId is the real person who started this,
// never the target.
router.post("/activate", requireRole(Role.OWNER), async (req, res) => {
  const { studioId, userId } = req.user!;
  const { targetUserId } = req.body ?? {};

  if (typeof targetUserId !== "string" || targetUserId.trim().length === 0) {
    return res.status(400).json({ error: "targetUserId is required" });
  }

  const resolved = await resolveViewAsTarget(studioId, targetUserId);
  if ("error" in resolved) {
    return res.status(404).json({ error: resolved.error });
  }

  await logAudit({
    studioId,
    actorUserId: userId,
    entityType: "User",
    entityId: resolved.target.id,
    action: "view_as_started",
    changes: { targetUserId: resolved.target.id, targetName: resolved.target.name, targetRole: resolved.target.role },
  });

  res.json({ id: resolved.target.id, name: resolved.target.name, email: resolved.target.email, role: resolved.target.role });
});

// Optional per the spec -- exiting is client-side (drop the header), but
// this gives the audit trail a matching bookend. Also called without the
// header, by design (see requireAuth's exemption note).
router.post("/deactivate", requireRole(Role.OWNER), async (req, res) => {
  const { studioId, userId } = req.user!;
  const { targetUserId } = req.body ?? {};

  if (typeof targetUserId !== "string" || targetUserId.trim().length === 0) {
    return res.status(400).json({ error: "targetUserId is required" });
  }

  await logAudit({
    studioId,
    actorUserId: userId,
    entityType: "User",
    entityId: targetUserId,
    action: "view_as_ended",
    changes: { targetUserId },
  });

  res.status(204).send();
});

export default router;
