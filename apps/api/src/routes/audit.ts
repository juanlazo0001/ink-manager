import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { requirePermission } from "../lib/permissions";

const router = Router();

const MAX_RESULTS = 100;

// Fields whose stored value is a raw foreign-key id rather than something
// human-readable on its own -- resolved below so the activity feed reads as
// "Assigned artist: — → Jordan Vega" instead of a bare cuid. Grouped by
// which model the id belongs to, since each needs its own lookup query and
// its own way of turning a row into a display label.
//
// Usability audit: originally only ARTIST/APPOINTMENT existed, and only for
// {from,to}-shaped diff values -- a plain (non-diff) value like a bare
// `{ giftCardId: "..." }` logged at creation time was never touched by this
// mechanism at all, regardless of field name. Both gaps are fixed below:
// CLIENT/GIFT_CARD categories added, and every category now resolves plain
// values and string arrays too, not just diff pairs.
const ID_FIELD_CATEGORIES = {
  artist: new Set(["assignedArtistId"]),
  appointment: new Set(["appointmentId", "fromAppointmentId", "toAppointmentId", "detachedFromAppointment"]),
  client: new Set([
    "clientId",
    "otherClientId",
    "sourceClientId",
    "survivorId",
    "referrerClientId",
    "referredClientId",
    // Transfer-to-artist epic: the two sides of a transfer's own client
    // pointer -- same "raw cuid means nothing to a human" problem every
    // other category here already solves.
    "destinationClientId",
    "originClientId",
  ]),
  giftCard: new Set([
    "giftCardId",
    "giftCardIds",
    "exemptGiftCardIds",
    "newGiftCardId",
    "derivedFromGiftCardId",
    "satisfiedByExistingGiftCardId",
  ]),
  // Transfer-to-artist epic: the origin/destination studio a transfer's
  // own audit rows reference -- resolved to the studio's name, not left
  // as a bare id, same treatment as every category above.
  studio: new Set(["originStudioId", "destinationStudioId"]),
  // Transfer-to-artist epic: the fresh project execution created at the
  // destination, referenced from the origin-side "transferred" row.
  inquiry: new Set(["destinationInquiryId"]),
} as const;

type IdCategory = keyof typeof ID_FIELD_CATEGORIES;

function categoryForField(field: string): IdCategory | null {
  for (const category of Object.keys(ID_FIELD_CATEGORIES) as IdCategory[]) {
    if (ID_FIELD_CATEGORIES[category].has(field)) return category;
  }
  return null;
}

type FromTo = { from: unknown; to: unknown };

function isFromTo(value: unknown): value is FromTo {
  return typeof value === "object" && value !== null && "from" in value && "to" in value;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

// Walks every changed field's value in whichever of the three shapes it
// might be (a bare string, a {from,to} diff pair, or a string array like
// giftCardIds) and hands each raw string to `visit`. One shared walker for
// both the collect and the resolve passes below, so the two can never
// silently drift out of sync about which shapes they handle.
function walkIdValues(value: unknown, visit: (id: string) => void): void {
  if (typeof value === "string") {
    visit(value);
  } else if (isFromTo(value)) {
    if (typeof value.from === "string") visit(value.from);
    if (typeof value.to === "string") visit(value.to);
  } else if (isStringArray(value)) {
    value.forEach(visit);
  }
}

function mapIdValues(value: unknown, resolve: (id: string) => unknown): unknown {
  if (typeof value === "string") {
    return resolve(value);
  }
  if (isFromTo(value)) {
    return { from: typeof value.from === "string" ? resolve(value.from) : value.from, to: typeof value.to === "string" ? resolve(value.to) : value.to };
  }
  if (isStringArray(value)) {
    return value.map(resolve);
  }
  return value;
}

router.get("/", requireAuth, requirePermission("audit.view"), async (req, res) => {
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

  const idsByCategory: Record<IdCategory, Set<string>> = {
    artist: new Set(),
    appointment: new Set(),
    client: new Set(),
    giftCard: new Set(),
    studio: new Set(),
    inquiry: new Set(),
  };

  for (const log of logs) {
    const changes = log.changes as Record<string, unknown> | null;
    if (!changes) continue;
    for (const [field, value] of Object.entries(changes)) {
      const category = categoryForField(field);
      if (!category) continue;
      walkIdValues(value, (id) => idsByCategory[category].add(id));
    }
  }

  const [artists, appointments, clients, giftCards, studios, inquiries] = await Promise.all([
    idsByCategory.artist.size > 0
      ? prisma.artist.findMany({
          where: { id: { in: [...idsByCategory.artist] } },
          select: { id: true, user: { select: { name: true, email: true } } },
        })
      : [],
    idsByCategory.appointment.size > 0
      ? prisma.appointment.findMany({
          where: { id: { in: [...idsByCategory.appointment] } },
          select: { id: true, startTime: true },
        })
      : [],
    idsByCategory.client.size > 0
      ? prisma.client.findMany({
          where: { id: { in: [...idsByCategory.client] } },
          select: { id: true, firstName: true, lastName: true },
        })
      : [],
    idsByCategory.giftCard.size > 0
      ? prisma.giftCard.findMany({ where: { id: { in: [...idsByCategory.giftCard] } }, select: { id: true, code: true } })
      : [],
    idsByCategory.studio.size > 0
      ? prisma.studio.findMany({ where: { id: { in: [...idsByCategory.studio] } }, select: { id: true, name: true } })
      : [],
    idsByCategory.inquiry.size > 0
      ? prisma.inquiry.findMany({ where: { id: { in: [...idsByCategory.inquiry] } }, select: { id: true, description: true } })
      : [],
  ]);

  const labelsByCategory: Record<IdCategory, Map<string, string>> = {
    artist: new Map(artists.map((a) => [a.id, a.user.name ?? a.user.email])),
    appointment: new Map(appointments.map((a) => [a.id, a.startTime.toISOString()])),
    client: new Map(clients.map((c) => [c.id, `${c.firstName} ${c.lastName}`.trim()])),
    giftCard: new Map(giftCards.map((g) => [g.id, g.code])),
    studio: new Map(studios.map((s) => [s.id, s.name])),
    inquiry: new Map(inquiries.map((i) => [i.id, i.description])),
  };

  const enriched = logs.map((log) => {
    const changes = log.changes as Record<string, unknown> | null;
    if (!changes) return log;

    const nextChanges: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(changes)) {
      const category = categoryForField(field);
      nextChanges[field] = category
        ? mapIdValues(value, (id) => labelsByCategory[category].get(id) ?? id)
        : value;
    }
    return { ...log, changes: nextChanges };
  });

  res.json(enriched);
});

export default router;
