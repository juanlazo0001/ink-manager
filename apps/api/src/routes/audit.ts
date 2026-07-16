import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth, requireRole } from "../middleware/auth";
import { Role } from "../../generated/prisma/enums";

const router = Router();

const MAX_RESULTS = 100;

router.get("/", requireAuth, requireRole(Role.OWNER, Role.FRONT_DESK), async (req, res) => {
  const entityType = typeof req.query.entityType === "string" ? req.query.entityType : undefined;
  const entityId = typeof req.query.entityId === "string" ? req.query.entityId : undefined;

  if (!entityType || !entityId) {
    return res.status(400).json({ error: "entityType and entityId query params are required" });
  }

  const logs = await prisma.auditLog.findMany({
    where: { studioId: req.user!.studioId, entityType, entityId },
    include: { actorUser: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: "desc" },
    take: MAX_RESULTS,
  });

  res.json(logs);
});

export default router;
