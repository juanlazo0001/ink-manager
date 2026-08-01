import { Router } from "express";
import { prisma } from "../lib/prisma";
import { Role, FlashPieceStatus } from "../../generated/prisma/enums";
import { requireAuth } from "../middleware/auth";
import { requirePermission } from "../lib/permissions";
import { diffObjects, logAudit } from "../lib/audit";
import { emitInvalidation } from "../lib/realtime/registry";

const router = Router();

router.use(requireAuth);

const FLASH_PIECE_INCLUDE = {
  artist: { select: { id: true, user: { select: { name: true, email: true, avatarUrl: true } } } },
} as const;

// Same "-own" narrowing preferredSchedule/artistSchedules.manage already
// established: requirePermission confirms the actor has flashGallery.manage
// at all, this resolves whether an ARTIST actor is restricted to their own
// pieces. OWNER/FRONT_DESK are never restricted.
async function resolveOwnArtistId(userId: string): Promise<string | null> {
  const artist = await prisma.artist.findUnique({ where: { userId }, select: { id: true } });
  return artist?.id ?? null;
}

router.get("/", requirePermission("flashGallery.manage"), async (req, res) => {
  const studioId = req.user!.studioId;
  let artistId = typeof req.query.artistId === "string" ? req.query.artistId : undefined;

  if (req.user!.role === Role.ARTIST) {
    const ownArtistId = await resolveOwnArtistId(req.user!.userId);
    artistId = ownArtistId ?? "__none__";
  }

  const pieces = await prisma.flashPiece.findMany({
    where: { studioId, ...(artistId ? { artistId } : {}) },
    include: FLASH_PIECE_INCLUDE,
    orderBy: { createdAt: "desc" },
  });

  res.json(pieces);
});

router.post("/", requirePermission("flashGallery.manage"), async (req, res) => {
  const studioId = req.user!.studioId;
  const { imageUrl, title, description, priceCents, estimatedDurationMinutes, isOneOfOne } = req.body ?? {};

  // ARTIST never needs to pass artistId at all -- an ARTIST creating a
  // piece can only ever mean "for myself," so it's resolved here rather
  // than requiring the frontend to know/send its own id. OWNER/FRONT_DESK
  // must pass one explicitly (there's no "self" to default to).
  let artistId: string | undefined = req.body?.artistId;
  if (req.user!.role === Role.ARTIST) {
    artistId = (await resolveOwnArtistId(req.user!.userId)) ?? undefined;
    if (!artistId) {
      return res.status(400).json({ error: "No artist profile found for your account" });
    }
  }

  const missing = ["imageUrl", "title", "priceCents", "estimatedDurationMinutes"].filter(
    (field) => req.body?.[field] === undefined || req.body?.[field] === null || req.body?.[field] === "",
  );
  if (!artistId) missing.unshift("artistId");
  if (missing.length > 0) {
    return res.status(400).json({ error: `Missing required field(s): ${missing.join(", ")}` });
  }

  if (typeof priceCents !== "number" || priceCents <= 0) {
    return res.status(400).json({ error: "priceCents must be a positive number" });
  }
  if (typeof estimatedDurationMinutes !== "number" || estimatedDurationMinutes <= 0) {
    return res.status(400).json({ error: "estimatedDurationMinutes must be a positive number" });
  }
  if (isOneOfOne !== undefined && typeof isOneOfOne !== "boolean") {
    return res.status(400).json({ error: "isOneOfOne must be a boolean" });
  }

  const artist = await prisma.artist.findUnique({ where: { id: artistId }, include: { user: true } });
  if (!artist || artist.user.studioId !== studioId) {
    return res.status(400).json({ error: "artistId must belong to your studio" });
  }

  // Belt-and-suspenders: artistId was either resolved to the actor's own
  // id above (ARTIST role) or supplied by staff -- this only re-confirms
  // the resolved/supplied id is genuinely theirs, in case resolveOwnArtistId
  // and the fetched artist ever disagree.
  if (req.user!.role === Role.ARTIST && artist.userId !== req.user!.userId) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const piece = await prisma.flashPiece.create({
    data: {
      studioId,
      artistId: artistId!,
      imageUrl,
      title,
      description: description || null,
      priceCents,
      estimatedDurationMinutes,
      isOneOfOne: isOneOfOne ?? false,
    },
    include: FLASH_PIECE_INCLUDE,
  });

  await logAudit({
    studioId,
    actorUserId: req.user!.userId,
    entityType: "FlashPiece",
    entityId: piece.id,
    action: "create",
    changes: { artistId, title, priceCents, estimatedDurationMinutes, isOneOfOne: piece.isOneOfOne },
  });

  emitInvalidation({ type: "flash.changed", studioId });

  res.status(201).json(piece);
});

router.patch("/:id", requirePermission("flashGallery.manage"), async (req, res) => {
  const id = req.params.id as string;
  const studioId = req.user!.studioId;

  const existing = await prisma.flashPiece.findUnique({ where: { id }, include: { artist: true } });
  if (!existing || existing.studioId !== studioId) {
    return res.status(404).json({ error: "Flash piece not found" });
  }

  if (req.user!.role === Role.ARTIST && existing.artist.userId !== req.user!.userId) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const { imageUrl, title, description, priceCents, estimatedDurationMinutes, isOneOfOne } = req.body ?? {};

  if (priceCents !== undefined && (typeof priceCents !== "number" || priceCents <= 0)) {
    return res.status(400).json({ error: "priceCents must be a positive number" });
  }
  if (
    estimatedDurationMinutes !== undefined &&
    (typeof estimatedDurationMinutes !== "number" || estimatedDurationMinutes <= 0)
  ) {
    return res.status(400).json({ error: "estimatedDurationMinutes must be a positive number" });
  }
  if (isOneOfOne !== undefined && typeof isOneOfOne !== "boolean") {
    return res.status(400).json({ error: "isOneOfOne must be a boolean" });
  }

  const data = {
    ...(imageUrl !== undefined ? { imageUrl } : {}),
    ...(title !== undefined ? { title } : {}),
    ...(description !== undefined ? { description: description || null } : {}),
    ...(priceCents !== undefined ? { priceCents } : {}),
    ...(estimatedDurationMinutes !== undefined ? { estimatedDurationMinutes } : {}),
    ...(isOneOfOne !== undefined ? { isOneOfOne } : {}),
  };

  const updated = await prisma.flashPiece.update({ where: { id }, data, include: FLASH_PIECE_INCLUDE });

  await logAudit({
    studioId,
    actorUserId: req.user!.userId,
    entityType: "FlashPiece",
    entityId: id,
    action: "update",
    changes: diffObjects(existing, data, ["imageUrl", "title", "description", "priceCents", "estimatedDurationMinutes", "isOneOfOne"]),
  });

  emitInvalidation({ type: "flash.changed", studioId });

  res.json(updated);
});

// Retire: a manual, one-way staff/artist action -- reachable from AVAILABLE
// only (a piece already PENDING_APPROVAL or BOOKED needs the in-flight
// request resolved first, not pulled out from under it; an already-RETIRED
// piece has nothing left to do here). Distinct dedicated route (rather than
// folding into PATCH's generic field update) for the same reason
// mark-lost/reopen get their own routes elsewhere -- a clear, audited,
// singular action rather than a raw status field write.
router.post("/:id/retire", requirePermission("flashGallery.manage"), async (req, res) => {
  const id = req.params.id as string;
  const studioId = req.user!.studioId;

  const existing = await prisma.flashPiece.findUnique({ where: { id }, include: { artist: true } });
  if (!existing || existing.studioId !== studioId) {
    return res.status(404).json({ error: "Flash piece not found" });
  }

  if (req.user!.role === Role.ARTIST && existing.artist.userId !== req.user!.userId) {
    return res.status(403).json({ error: "Forbidden" });
  }

  if (existing.status !== FlashPieceStatus.AVAILABLE) {
    return res.status(400).json({ error: `Can't retire a piece that's currently ${existing.status}` });
  }

  const updated = await prisma.flashPiece.update({
    where: { id },
    data: { status: FlashPieceStatus.RETIRED },
    include: FLASH_PIECE_INCLUDE,
  });

  await logAudit({
    studioId,
    actorUserId: req.user!.userId,
    entityType: "FlashPiece",
    entityId: id,
    action: "retire",
    changes: { status: { from: existing.status, to: FlashPieceStatus.RETIRED } },
  });

  emitInvalidation({ type: "flash.changed", studioId });

  res.json(updated);
});

export default router;
