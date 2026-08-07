import { Router } from "express";
import { prisma } from "../lib/prisma";
import { Channel, FlashPieceStatus, InquiryStatus, Role } from "../../generated/prisma/enums";
import { requireAuth } from "../middleware/auth";
import { requirePermission } from "../lib/permissions";
import { diffObjects, logAudit } from "../lib/audit";
import { emitInvalidation } from "../lib/realtime/registry";
import { normalizePhone } from "../lib/phone";
import { syncPrimaryEmail, syncPrimaryPhone } from "../lib/clientContacts";
import { generateUniqueReferralCode } from "../lib/referrals";
import { DEFAULT_THEME_PRESET } from "../lib/themePresets";
import { studioHasActiveMembership, callerBelongsToStudio, activeStudioIdsForCaller } from "../lib/artistAccess";

const router = Router();

const FLASH_PIECE_INCLUDE = {
  artist: { select: { id: true, user: { select: { name: true, email: true, avatarUrl: true } } } },
} as const;

// Public: one artist's available flash pieces -- studio + artist scoped,
// same two-segment shape as the existing /inquiry/:studioSlug public
// convention. Repeatable pieces (isOneOfOne: false) always show while
// AVAILABLE; a one-of-one piece disappears the instant someone requests it
// (status moves to PENDING_APPROVAL, see POST /:id/request below) and
// never reappears once RETIRED or BOOKED -- this query is naturally
// correct for all of that just by filtering on AVAILABLE, no separate
// isOneOfOne branching needed.
router.get("/public", async (req, res) => {
  const studioSlug = req.query.studioSlug;
  const artistId = req.query.artistId;

  if (typeof studioSlug !== "string" || !studioSlug || typeof artistId !== "string" || !artistId) {
    return res.status(400).json({ error: "studioSlug and artistId are required" });
  }

  const studio = await prisma.studio.findUnique({
    where: { slug: studioSlug },
    include: { settings: { select: { themePreset: true } } },
  });
  if (!studio) {
    return res.status(404).json({ error: "Studio not found" });
  }

  const artist = await prisma.artist.findUnique({ where: { id: artistId }, include: { user: true } });
  // Artist mobility bug fix: a guest artist's public gallery page at their
  // GUEST studio was 404ing (their user.studioId is only ever their HOME).
  const artistBelongsToStudio =
    artist != null && (artist.user.studioId === studio.id || (await studioHasActiveMembership(studio.id, artist.id)));
  if (!artistBelongsToStudio) {
    return res.status(404).json({ error: "Artist not found" });
  }

  const pieces = await prisma.flashPiece.findMany({
    where: { studioId: studio.id, artistId, status: FlashPieceStatus.AVAILABLE },
    select: {
      id: true,
      imageUrl: true,
      title: true,
      description: true,
      priceCents: true,
      estimatedDurationMinutes: true,
      isOneOfOne: true,
    },
    orderBy: { createdAt: "desc" },
  });

  res.json({
    studioName: studio.name,
    studioSlug: studio.slug,
    studioLogoUrl: studio.logoUrl,
    themePreset: studio.settings?.themePreset ?? DEFAULT_THEME_PRESET,
    artistId: artist.id,
    artistName: artist.user.name ?? "this artist",
    artistAvatarUrl: artist.user.avatarUrl,
    pieces,
  });
});

// Public: the lightweight submission form's own client lookup -- reuses
// the exact same email-then-phone matching POST /inquiries' general
// intake already does (see that route's own existingClient logic), just
// exposed as its own two-step-UX-friendly endpoint so the form can show
// "Welcome back" and skip fields already on file BEFORE the customer
// fills out the rest, rather than silently deduping only at submission
// time the way the general intake form does.
router.get("/lookup-public", async (req, res) => {
  const studioSlug = req.query.studioSlug;
  const phone = req.query.phone;
  const email = req.query.email;

  if (typeof studioSlug !== "string" || !studioSlug) {
    return res.status(400).json({ error: "studioSlug is required" });
  }
  if ((typeof email !== "string" || !email) && (typeof phone !== "string" || !phone)) {
    return res.status(400).json({ error: "phone or email is required" });
  }

  const studio = await prisma.studio.findUnique({ where: { slug: studioSlug } });
  if (!studio) {
    return res.status(404).json({ error: "Studio not found" });
  }

  const client =
    typeof email === "string" && email
      ? await prisma.client.findFirst({ where: { studioId: studio.id, email } })
      : await prisma.client.findFirst({ where: { studioId: studio.id, phone: normalizePhone(phone as string) } });

  if (!client) {
    return res.json({ found: false });
  }

  res.json({
    found: true,
    firstName: client.firstName,
    lastName: client.lastName,
    email: client.email,
    phone: client.phone,
  });
});

// Public: the lightweight submission itself -- NOT routed through the
// general POST /inquiries (that route's configurable-intake-form-field
// machinery doesn't apply here; flash's form is fixed and much shorter by
// design). Creates a real Inquiry so the request gets the same pipeline/
// dashboard visibility as any other, with artist/price/duration already
// fixed from the piece -- no assignment or estimate step.
router.post("/:id/request", async (req, res) => {
  const id = req.params.id as string;
  const { placementDescription, placementPhotoUrl, firstName, lastName, email, phone } = req.body ?? {};

  if (
    typeof placementDescription !== "string" ||
    !placementDescription.trim() ||
    typeof placementPhotoUrl !== "string" ||
    !placementPhotoUrl ||
    typeof firstName !== "string" ||
    !firstName.trim() ||
    typeof lastName !== "string" ||
    !lastName.trim() ||
    ((typeof email !== "string" || !email.trim()) && (typeof phone !== "string" || !phone.trim()))
  ) {
    return res.status(400).json({ error: "Missing required field(s)" });
  }

  const piece = await prisma.flashPiece.findUnique({ where: { id } });
  if (!piece || piece.status !== FlashPieceStatus.AVAILABLE) {
    return res.status(409).json({ error: "This piece is no longer available -- please pick another." });
  }

  const studioId = piece.studioId;

  // Atomic claim, one-of-one only: the conditional WHERE makes this a
  // genuine race winner-take-all -- if two people request the same piece
  // within milliseconds of each other, only the first update actually
  // matches a row (count 1); the second's WHERE no longer matches (the
  // status already moved), so it correctly loses rather than both
  // silently succeeding. A repeatable piece never leaves AVAILABLE here.
  if (piece.isOneOfOne) {
    const claimed = await prisma.flashPiece.updateMany({
      where: { id, status: FlashPieceStatus.AVAILABLE },
      data: { status: FlashPieceStatus.PENDING_APPROVAL },
    });
    if (claimed.count === 0) {
      return res.status(409).json({ error: "This piece was just requested by someone else -- please pick another." });
    }
  }

  const normalizedPhone = typeof phone === "string" && phone.trim() ? normalizePhone(phone) : null;
  const trimmedEmail = typeof email === "string" && email.trim() ? email.trim() : null;

  const existingClient = trimmedEmail
    ? await prisma.client.findFirst({ where: { studioId, email: trimmedEmail } })
    : normalizedPhone
      ? await prisma.client.findFirst({ where: { studioId, phone: normalizedPhone } })
      : null;

  let client;
  if (existingClient) {
    client = existingClient;
  } else {
    const referralCode = await generateUniqueReferralCode();
    client = await prisma.$transaction(async (tx) => {
      const created = await tx.client.create({
        data: {
          studioId,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: trimmedEmail,
          phone: normalizedPhone,
          referralCode,
        },
      });
      await syncPrimaryPhone(tx, created.id, created.phone);
      await syncPrimaryEmail(tx, created.id, created.email);
      return created;
    });
  }

  // Same "Tattoo" fallback resolveServiceForIntakeForm uses, minus the
  // intake-form lookup step this flow has no form context for at all.
  const service = await prisma.service.findFirst({ where: { studioId, slug: "tattoo" } });
  if (!service) {
    if (piece.isOneOfOne) {
      await prisma.flashPiece.update({ where: { id }, data: { status: FlashPieceStatus.AVAILABLE } });
    }
    return res.status(500).json({ error: "This studio has no service configured -- contact support" });
  }

  const priceDollars = piece.priceCents / 100;
  const durationHours = piece.estimatedDurationMinutes / 60;

  const inquiry = await prisma.inquiry.create({
    data: {
      studioId,
      clientId: client.id,
      serviceId: service.id,
      channel: Channel.FLASH_GALLERY,
      description: `Flash: ${piece.title}`,
      // Not asked on this lightweight form -- the flash piece's own photo
      // already shows exactly what this is, unlike a custom-design inquiry
      // where these fields carry real information.
      colorOrBlackGrey: "See flash design",
      estimatedSize: "See flash design",
      placement: placementDescription.trim(),
      // Not collected by this form at all -- judgment call, flagged in
      // REPORT.md rather than silently assumed either way.
      hasBeenTattooedBefore: false,
      placementImages: [placementPhotoUrl],
      status: InquiryStatus.FLASH_PENDING_APPROVAL,
      priceEstimateLow: priceDollars,
      priceEstimateHigh: priceDollars,
      timeEstimateHoursMin: durationHours,
      timeEstimateHoursMax: durationHours,
      assignedArtistId: piece.artistId,
      assignedAt: new Date(),
      flashPieceId: piece.id,
    },
  });

  await logAudit({
    studioId,
    actorUserId: null,
    entityType: "Inquiry",
    entityId: inquiry.id,
    action: "flash_request_submitted",
    changes: { flashPieceId: piece.id, clientId: client.id },
  });

  emitInvalidation({ type: "inquiry.created", studioId });
  emitInvalidation({ type: "flash.changed", studioId });

  res.status(201).json({ success: true });
});

router.use(requireAuth);

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
  // Artist mobility bug fix: an ARTIST's own list spans every studio they
  // CURRENTLY belong to (HOME + active GUESTs), not just home -- but still
  // scoped to ACTIVE memberships, not dropped entirely, so a piece living
  // under a studio this artist has since left/been removed from stops
  // appearing on their own list going forward (same "ended relationship,
  // not just a different one" reasoning as appointments.ts's GET / list).
  let artistStudioIds: string[] | null = null;

  if (req.user!.role === Role.ARTIST) {
    const ownArtistId = await resolveOwnArtistId(req.user!.userId);
    artistId = ownArtistId ?? "__none__";
    artistStudioIds = await activeStudioIdsForCaller(req.user!);
  }

  const pieces = await prisma.flashPiece.findMany({
    where: {
      ...(artistStudioIds ? { studioId: { in: artistStudioIds } } : { studioId }),
      ...(artistId ? { artistId } : {}),
    },
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
  // Artist mobility bug fix: a studio can also create a flash piece for its
  // own active GUEST artists, not just HOME ones -- same
  // studioHasActiveMembership pattern as every other artistId-ownership
  // check in the codebase (see lib/artistAccess.ts). Without this, staff at
  // a guest studio couldn't create a flash piece on behalf of their own
  // currently-guesting artist at all.
  const artistBelongsToStudio =
    artist != null && (artist.user.studioId === studioId || (await studioHasActiveMembership(studioId, artist.id)));
  if (!artistBelongsToStudio) {
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

  const existing = await prisma.flashPiece.findUnique({ where: { id }, include: { artist: true } });
  if (!existing || !(await callerBelongsToStudio(req.user!, existing.studioId))) {
    return res.status(404).json({ error: "Flash piece not found" });
  }
  const studioId = existing.studioId;

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

  const existing = await prisma.flashPiece.findUnique({ where: { id }, include: { artist: true } });
  if (!existing || !(await callerBelongsToStudio(req.user!, existing.studioId))) {
    return res.status(404).json({ error: "Flash piece not found" });
  }
  const studioId = existing.studioId;

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
