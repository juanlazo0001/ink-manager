import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth, requireRole } from "../middleware/auth";
import { Role } from "../../generated/prisma/enums";

const router = Router();

const MAX_RESULTS = 100;

// Fields whose stored value is a raw foreign-key id rather than something
// human-readable on its own -- resolved below so the activity feed reads as
// "Assigned artist: — → Jordan Vega" instead of a bare cuid.
const ARTIST_ID_FIELDS = new Set(["assignedArtistId"]);
const APPOINTMENT_ID_FIELDS = new Set(["appointmentId"]);

type FromTo = { from: unknown; to: unknown };

function isFromTo(value: unknown): value is FromTo {
  return typeof value === "object" && value !== null && "from" in value && "to" in value;
}

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

  const artistIds = new Set<string>();
  const appointmentIds = new Set<string>();
  for (const log of logs) {
    const changes = log.changes as Record<string, unknown> | null;
    if (!changes) continue;
    for (const [field, value] of Object.entries(changes)) {
      if (!isFromTo(value)) continue;
      const ids = ARTIST_ID_FIELDS.has(field) ? artistIds : APPOINTMENT_ID_FIELDS.has(field) ? appointmentIds : null;
      if (!ids) continue;
      if (typeof value.from === "string") ids.add(value.from);
      if (typeof value.to === "string") ids.add(value.to);
    }
  }

  const [artists, appointments] = await Promise.all([
    artistIds.size > 0
      ? prisma.artist.findMany({
          where: { id: { in: [...artistIds] } },
          select: { id: true, user: { select: { name: true, email: true } } },
        })
      : [],
    appointmentIds.size > 0
      ? prisma.appointment.findMany({ where: { id: { in: [...appointmentIds] } }, select: { id: true, startTime: true } })
      : [],
  ]);
  const artistLabels = new Map(artists.map((a) => [a.id, a.user.name ?? a.user.email]));
  const appointmentLabels = new Map(appointments.map((a) => [a.id, a.startTime.toISOString()]));

  const resolveId = (field: string, value: unknown): unknown => {
    if (typeof value !== "string") return value;
    if (ARTIST_ID_FIELDS.has(field)) return artistLabels.get(value) ?? value;
    if (APPOINTMENT_ID_FIELDS.has(field)) return appointmentLabels.get(value) ?? value;
    return value;
  };

  const enriched = logs.map((log) => {
    const changes = log.changes as Record<string, unknown> | null;
    if (!changes) return log;

    const nextChanges: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(changes)) {
      nextChanges[field] = isFromTo(value)
        ? { from: resolveId(field, value.from), to: resolveId(field, value.to) }
        : value;
    }
    return { ...log, changes: nextChanges };
  });

  res.json(enriched);
});

export default router;
