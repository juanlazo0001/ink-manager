import { Router } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import type { AuthPayload } from "../middleware/auth";
import { Role } from "../../generated/prisma/enums";
import type { Prisma } from "../../generated/prisma/client";
import { hasPermission, requirePermission } from "../lib/permissions";
import { diffObjects, logAudit } from "../lib/audit";
import { isStringArray, isValidDateOrNull, isValidPreferredSchedule } from "../lib/artistValidation";
import { emitInvalidation } from "../lib/realtime/registry";
import { isSoloStudioArtist } from "../lib/soloStudio";
import { generateUniqueSlug } from "./studios";
import { JWT_SECRET } from "../lib/jwt";

const router = Router();

const PUBLIC_ARTIST_INCLUDE = { user: { select: { name: true } } } as const;
type PublicArtist = Prisma.ArtistGetPayload<{ include: typeof PUBLIC_ARTIST_INCLUDE }>;

// Public: lets the unauthenticated intake form populate a "preferred artist"
// dropdown. Only exposes id/name, never bio/specialties/user contact info.
// Scoped by studioSlug (from the form's /inquiry/:studioSlug URL) so each
// studio only ever sees its own artists.
router.get("/public", async (req, res) => {
  const studioSlug = req.query.studioSlug;
  if (typeof studioSlug !== "string" || !studioSlug) {
    return res.status(400).json({ error: "studioSlug is required" });
  }

  const studio = await prisma.studio.findUnique({ where: { slug: studioSlug } });
  if (!studio) {
    return res.status(404).json({ error: "Studio not found" });
  }

  const artists = await prisma.artist.findMany({
    where: { user: { studioId: studio.id, role: Role.ARTIST, isActive: true } },
    include: PUBLIC_ARTIST_INCLUDE,
    orderBy: { user: { name: "asc" } },
  });

  res.json(artists.map((artist: PublicArtist) => ({ id: artist.id, name: artist.user.name ?? "Unnamed artist" })));
});

router.use(requireAuth);

router.post("/", requirePermission("artists.manage"), async (req, res) => {
  const { userId, bio, specialties } = req.body ?? {};

  if (!userId) {
    return res.status(400).json({ error: "userId is required" });
  }

  if (specialties !== undefined && !Array.isArray(specialties)) {
    return res.status(400).json({ error: "specialties must be an array of strings" });
  }

  const targetUser = await prisma.user.findUnique({ where: { id: userId } });

  if (!targetUser || targetUser.role !== Role.ARTIST || targetUser.studioId !== req.user!.studioId) {
    return res.status(400).json({ error: "userId must belong to an existing ARTIST user in your studio" });
  }

  const artist = await prisma.artist.create({
    data: { userId, bio, specialties: specialties ?? [], portfolioImages: [] },
  });

  emitInvalidation({ type: "artist.changed", studioId: req.user!.studioId, artistId: artist.id });

  res.status(201).json(artist);
});

// Solo artist architecture, Phase 4: the HOME membership row is where
// allowsStudioProfileEdits lives -- an array (Prisma's shape for a
// filtered to-many include), same convention artistServices below already
// uses, even though exactly one HOME row exists per artist in practice.
const HOME_MEMBERSHIP_INCLUDE = {
  memberships: { where: { type: "HOME" as const }, select: { allowsStudioProfileEdits: true } },
} as const;

const ARTIST_INCLUDE = {
  user: { select: { id: true, email: true, role: true, name: true, phone: true, avatarUrl: true, studioId: true } },
  // Service lines: which services this artist is tagged as offering (see
  // ArtistService) -- the detail page's checkboxes read this to know
  // what's currently checked.
  artistServices: { select: { serviceId: true } },
  ...HOME_MEMBERSHIP_INCLUDE,
} as const;

// List view only renders id/bio/specialties/portfolioImages plus a handful
// of user fields -- role/phone/studioId are detail-page-only.
const ARTIST_LIST_SELECT = {
  id: true,
  bio: true,
  specialties: true,
  portfolioImages: true,
  instagramHandle: true,
  facebookProfileUrl: true,
  isGuest: true,
  guestStartDate: true,
  guestEndDate: true,
  // Reference rate(s) -- needed in the list view (not just the detail
  // page) since the estimate form's per-session price auto-suggestion
  // reads whichever artist is assigned from wherever that artist list was
  // already fetched from.
  hourlyRateCents: true,
  flatRateCents: true,
  // Per-artist scheduling buffer override -- null means "use the studio's
  // own StudioSettings.schedulingBufferMinutes default". Needed wherever
  // an artist's own bufferWarning might show, not just the detail page.
  schedulingBufferMinutes: true,
  // Client self-scheduling exploration: same "needed in the list view too,
  // not just the detail page" reasoning as schedulingBufferMinutes above.
  allowsClientSelfScheduling: true,
  // Calendar's per-column artist-unavailable grey-shading (Phase: studio
  // hours + calendar shading) needs this in the list view too, not just
  // the detail page.
  preferredSchedule: true,
  // Service lines: InquiryDetail.tsx's practitioner picker filters to only
  // artists tagged as offering the inquiry's own service -- needs this in
  // the list view too, not just the detail page.
  artistServices: { select: { serviceId: true } },
  user: { select: { id: true, email: true, name: true, avatarUrl: true } },
  ...HOME_MEMBERSHIP_INCLUDE,
} as const;

// Self-heals any ARTIST-role user in the studio who doesn't have an Artist
// profile yet -- e.g. one created before this existed, or via some other
// path that didn't go through the studios.ts user routes. Keeps the Team
// and Artists pages from ever silently falling out of sync. This is a rare
// edge case, so re-checking a studio within RECHECK_MS of its last check is
// skipped -- avoids an extra DB round trip on every single list load.
const RECHECK_MS = 60_000;
const lastChecked = new Map<string, number>();

async function ensureArtistProfiles(studioId: string) {
  const last = lastChecked.get(studioId);
  if (last != null && Date.now() - last < RECHECK_MS) return;

  const missing = await prisma.user.findMany({
    where: { studioId, role: Role.ARTIST, artist: null },
    select: { id: true },
  });

  if (missing.length > 0) {
    await prisma.artist.createMany({
      data: missing.map((u) => ({ userId: u.id, specialties: [], portfolioImages: [] })),
    });
  }

  lastChecked.set(studioId, Date.now());
}

router.get("/", requirePermission("artists.view"), async (req, res) => {
  await ensureArtistProfiles(req.user!.studioId);

  const artists = await prisma.artist.findMany({
    where: { user: { studioId: req.user!.studioId } },
    select: ARTIST_LIST_SELECT,
    orderBy: { user: { name: "asc" } },
    take: 100,
  });

  res.json(artists);
});

router.get("/:id", requirePermission("artists.view"), async (req, res) => {
  const id = req.params.id as string;

  const artist = await prisma.artist.findUnique({ where: { id }, include: ARTIST_INCLUDE });

  if (!artist || artist.user.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Artist not found" });
  }

  res.json(artist);
});

router.patch("/:id", requirePermission("artists.manage"), async (req, res) => {
  const id = req.params.id as string;
  let {
    bio,
    specialties,
    portfolioImages,
    instagramHandle,
    facebookProfileUrl,
  } = req.body ?? {};
  const {
    isGuest,
    guestStartDate,
    guestEndDate,
    serviceIds,
    hourlyRateCents,
    flatRateCents,
    schedulingBufferMinutes,
    allowsClientSelfScheduling,
  } = req.body ?? {};

  const artist = await prisma.artist.findUnique({
    where: { id },
    include: { user: true, artistServices: { select: { serviceId: true } }, ...HOME_MEMBERSHIP_INCLUDE },
  });
  if (!artist || artist.user.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Artist not found" });
  }

  // Solo artist architecture, Phase 4: bio/specialties/portfolioImages/
  // instagramHandle/facebookProfileUrl are the artist's own shared
  // profile data (see StudioMembership.allowsStudioProfileEdits' own
  // schema comment for the exact scope) -- editable by staff only when
  // this artist has explicitly delegated that, or when staff IS the
  // artist (requirePermission above already confirmed artists.manage, so
  // an ARTIST reaching this route at all means a studio explicitly
  // granted them that broad permission -- rare, but self-edits still
  // shouldn't need delegation from themselves). Every OTHER field
  // (rates, scheduling buffer, guest status, self-scheduling, service
  // tags) is untouched by this check -- staff with artists.manage can
  // always edit those, exactly as before. Silently dropped rather than
  // rejecting the whole request, so a staff member without delegation can
  // still save changes to the fields they DO have access to in the same
  // request the UI already sends as one combined save.
  const isSelf = artist.userId === req.user!.userId;
  const canEditProfileFields = isSelf || (artist.memberships[0]?.allowsStudioProfileEdits ?? false);
  if (!canEditProfileFields) {
    bio = undefined;
    specialties = undefined;
    portfolioImages = undefined;
    instagramHandle = undefined;
    facebookProfileUrl = undefined;
  }

  if (serviceIds !== undefined) {
    if (!isStringArray(serviceIds)) {
      return res.status(400).json({ error: "serviceIds must be an array of strings" });
    }
    const validCount = await prisma.service.count({
      where: { id: { in: serviceIds }, studioId: req.user!.studioId },
    });
    if (validCount !== new Set(serviceIds).size) {
      return res.status(400).json({ error: "serviceIds must all reference existing services in your studio" });
    }
  }

  if (bio !== undefined && bio !== null && typeof bio !== "string") {
    return res.status(400).json({ error: "bio must be a string or null" });
  }

  if (specialties !== undefined && !isStringArray(specialties)) {
    return res.status(400).json({ error: "specialties must be an array of strings" });
  }

  if (portfolioImages !== undefined && !isStringArray(portfolioImages)) {
    return res.status(400).json({ error: "portfolioImages must be an array of strings" });
  }

  // Loose validation on purpose -- a handle (not a URL) for Instagram, a
  // full URL for Facebook, both optional. No format enforcement beyond
  // "it's a string" -- staff can paste whatever they were given.
  if (instagramHandle !== undefined && instagramHandle !== null && typeof instagramHandle !== "string") {
    return res.status(400).json({ error: "instagramHandle must be a string or null" });
  }

  if (facebookProfileUrl !== undefined && facebookProfileUrl !== null && typeof facebookProfileUrl !== "string") {
    return res.status(400).json({ error: "facebookProfileUrl must be a string or null" });
  }

  if (isGuest !== undefined && typeof isGuest !== "boolean") {
    return res.status(400).json({ error: "isGuest must be a boolean" });
  }

  if (guestStartDate !== undefined && !isValidDateOrNull(guestStartDate)) {
    return res.status(400).json({ error: "guestStartDate must be a valid date or null" });
  }

  if (guestEndDate !== undefined && !isValidDateOrNull(guestEndDate)) {
    return res.status(400).json({ error: "guestEndDate must be a valid date or null" });
  }

  if (
    hourlyRateCents !== undefined &&
    hourlyRateCents !== null &&
    (typeof hourlyRateCents !== "number" || hourlyRateCents < 0)
  ) {
    return res.status(400).json({ error: "hourlyRateCents must be a non-negative number or null" });
  }

  if (
    flatRateCents !== undefined &&
    flatRateCents !== null &&
    (typeof flatRateCents !== "number" || flatRateCents < 0)
  ) {
    return res.status(400).json({ error: "flatRateCents must be a non-negative number or null" });
  }

  if (
    schedulingBufferMinutes !== undefined &&
    schedulingBufferMinutes !== null &&
    (typeof schedulingBufferMinutes !== "number" || schedulingBufferMinutes < 0)
  ) {
    return res.status(400).json({ error: "schedulingBufferMinutes must be a non-negative number or null" });
  }

  if (allowsClientSelfScheduling !== undefined && typeof allowsClientSelfScheduling !== "boolean") {
    return res.status(400).json({ error: "allowsClientSelfScheduling must be a boolean" });
  }

  const data = {
    ...(bio !== undefined ? { bio: bio?.trim() || null } : {}),
    ...(specialties !== undefined ? { specialties } : {}),
    ...(portfolioImages !== undefined ? { portfolioImages } : {}),
    ...(instagramHandle !== undefined
      ? { instagramHandle: instagramHandle?.trim().replace(/^@/, "") || null }
      : {}),
    ...(facebookProfileUrl !== undefined ? { facebookProfileUrl: facebookProfileUrl?.trim() || null } : {}),
    ...(isGuest !== undefined ? { isGuest } : {}),
    ...(guestStartDate !== undefined ? { guestStartDate: guestStartDate ? new Date(guestStartDate) : null } : {}),
    ...(guestEndDate !== undefined ? { guestEndDate: guestEndDate ? new Date(guestEndDate) : null } : {}),
    ...(hourlyRateCents !== undefined ? { hourlyRateCents } : {}),
    ...(flatRateCents !== undefined ? { flatRateCents } : {}),
    ...(schedulingBufferMinutes !== undefined ? { schedulingBufferMinutes } : {}),
    ...(allowsClientSelfScheduling !== undefined ? { allowsClientSelfScheduling } : {}),
  };

  const nextServiceIds: string[] | undefined = serviceIds !== undefined ? [...new Set(serviceIds as string[])] : undefined;
  const previousServiceIds = artist.artistServices.map((s) => s.serviceId);

  const [updated] = await prisma.$transaction([
    prisma.artist.update({ where: { id }, data, include: ARTIST_INCLUDE }),
    ...(nextServiceIds !== undefined
      ? [
          prisma.artistService.deleteMany({ where: { artistId: id } }),
          prisma.artistService.createMany({ data: nextServiceIds.map((serviceId) => ({ artistId: id, serviceId })) }),
        ]
      : []),
  ]);

  await logAudit({
    studioId: req.user!.studioId,
    actorUserId: req.user!.userId,
    entityType: "Artist",
    entityId: id,
    action: "update",
    changes: {
      ...diffObjects(artist, data, [
        "bio",
        "specialties",
        "portfolioImages",
        "instagramHandle",
        "facebookProfileUrl",
        "isGuest",
        "guestStartDate",
        "guestEndDate",
        "hourlyRateCents",
        "flatRateCents",
        "schedulingBufferMinutes",
        "allowsClientSelfScheduling",
      ]),
      ...(nextServiceIds !== undefined ? { serviceIds: { from: previousServiceIds, to: nextServiceIds } } : {}),
    },
  });

  emitInvalidation({ type: "artist.changed", studioId: req.user!.studioId, artistId: id });

  res.json(updated);
});

// Advisory weekly availability -- editable by OWNER/FRONT_DESK for any
// artist, or by the artist themselves for their own profile only (checked
// via the JWT's own userId, never a client-supplied id).
router.patch("/:id/preferred-schedule", requirePermission("artistSchedules.manage"), async (req, res) => {
  const id = req.params.id as string;
  const { preferredSchedule } = req.body ?? {};

  const artist = await prisma.artist.findUnique({ where: { id }, include: { user: true } });
  if (!artist || artist.user.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Artist not found" });
  }

  // requirePermission above already confirmed the actor has
  // artistSchedules.manage -- this is the "-own" scoping on top of it:
  // ARTIST's grant is always self-only, staying in effect regardless of
  // the toggle, same convention as every other "-own" key in this
  // expansion. OWNER/FRONT_DESK have no such restriction.
  const isSelf = req.user!.role === Role.ARTIST && artist.userId === req.user!.userId;
  if (req.user!.role === Role.ARTIST && !isSelf) {
    return res.status(403).json({ error: "Forbidden" });
  }

  if (preferredSchedule !== null && !isValidPreferredSchedule(preferredSchedule)) {
    return res.status(400).json({
      error: "preferredSchedule must be null or an array of { dayOfWeek: 0-6, startTime: 'HH:MM', endTime: 'HH:MM' }",
    });
  }

  const updated = await prisma.artist.update({
    where: { id },
    data: { preferredSchedule },
    include: ARTIST_INCLUDE,
  });

  await logAudit({
    studioId: req.user!.studioId,
    actorUserId: req.user!.userId,
    entityType: "Artist",
    entityId: id,
    action: "update",
    changes: diffObjects(artist, { preferredSchedule }, ["preferredSchedule"]),
  });

  emitInvalidation({ type: "artist.changed", studioId: req.user!.studioId, artistId: id });

  res.json(updated);
});

// Solo artist architecture, Phase 3: a dedicated, narrow write path for
// Artist.allowsClientSelfScheduling, distinct from the generic
// PATCH /:id (artists.manage, OWNER-only by default) that already governs
// this field for every multi-person studio -- that route is completely
// unchanged, so an OWNER can still toggle any of their artists' self-
// scheduling exactly as before. What THIS route adds is a second allow
// path: a solo artist (no OWNER/FRONT_DESK other than themselves -- see
// lib/soloStudio.ts) can toggle their OWN self-scheduling directly,
// without needing artists.manage granted at all. Deliberately its own
// route rather than folded into preferred-schedule (a different field,
// same self-only shape but no reason to conflate two independent
// settings) or into the generic PATCH /:id (whose gate is unconditionally
// artists.manage -- a solo artist without that permission could never
// reach it).
router.patch("/:id/self-scheduling", requireAuth, async (req, res) => {
  const id = req.params.id as string;
  const { allowsClientSelfScheduling } = req.body ?? {};

  if (typeof allowsClientSelfScheduling !== "boolean") {
    return res.status(400).json({ error: "allowsClientSelfScheduling must be a boolean" });
  }

  const artist = await prisma.artist.findUnique({ where: { id }, include: { user: true } });
  if (!artist || artist.user.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Artist not found" });
  }

  const isSelf = artist.userId === req.user!.userId;
  const staffAllowed = await hasPermission(req.user!.studioId, req.user!.role, "artists.manage");

  if (!staffAllowed) {
    if (req.user!.role !== Role.ARTIST || !isSelf) {
      return res.status(403).json({ error: "Forbidden" });
    }
    if (!(await isSoloStudioArtist(req.user!.studioId, req.user!.userId))) {
      return res
        .status(403)
        .json({ error: "Self-scheduling is managed by your studio -- ask an owner to enable it for you." });
    }
  }

  const updated = await prisma.artist.update({
    where: { id },
    data: { allowsClientSelfScheduling },
    include: ARTIST_INCLUDE,
  });

  await logAudit({
    studioId: req.user!.studioId,
    actorUserId: req.user!.userId,
    entityType: "Artist",
    entityId: id,
    action: "update",
    changes: diffObjects(artist, { allowsClientSelfScheduling }, ["allowsClientSelfScheduling"]),
  });

  emitInvalidation({ type: "artist.changed", studioId: req.user!.studioId, artistId: id });

  res.json(updated);
});

// Solo artist architecture, Phase 4: this toggle is artist-controlled,
// full stop -- unlike self-scheduling above (which OWNER can also set for
// any artist), there is deliberately NO staff bypass here at all. This is
// the one thing the delegation toggle exists specifically to keep out of
// staff's hands: whether studio staff may edit this artist's shared
// profile fields (bio/specialties/portfolioImages/instagramHandle/
// facebookProfileUrl -- see PATCH /:id's own enforcement) on their
// behalf. Upserts rather than requiring a pre-existing membership row --
// harmless defensive-only path today (Part 2's migration already gave
// every artist a HOME row), but keeps this route correct on its own even
// if that invariant were ever violated.
router.patch("/:id/profile-delegation", requireAuth, async (req, res) => {
  const id = req.params.id as string;
  const { allowsStudioProfileEdits } = req.body ?? {};

  if (typeof allowsStudioProfileEdits !== "boolean") {
    return res.status(400).json({ error: "allowsStudioProfileEdits must be a boolean" });
  }

  const artist = await prisma.artist.findUnique({ where: { id }, include: { user: true } });
  if (!artist || artist.user.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Artist not found" });
  }

  if (artist.userId !== req.user!.userId) {
    return res.status(403).json({ error: "Forbidden" });
  }

  // No compound-unique on (studioId, artistId) anymore now that a
  // membership can end and a new one begin (see schema.prisma's own
  // comment on StudioMembership) -- "the" membership here means the
  // active one, found by hand rather than via `upsert`'s where clause.
  const existingMembership = await prisma.studioMembership.findFirst({
    where: { studioId: req.user!.studioId, artistId: id, endedAt: null },
  });
  const membership = existingMembership
    ? await prisma.studioMembership.update({
        where: { id: existingMembership.id },
        data: { allowsStudioProfileEdits },
      })
    : await prisma.studioMembership.create({
        data: { studioId: req.user!.studioId, artistId: id, type: "HOME", allowsStudioProfileEdits },
      });

  await logAudit({
    studioId: req.user!.studioId,
    actorUserId: req.user!.userId,
    entityType: "StudioMembership",
    entityId: membership.id,
    action: "update",
    changes: { allowsStudioProfileEdits },
  });

  emitInvalidation({ type: "artist.changed", studioId: req.user!.studioId, artistId: id });

  res.json({ allowsStudioProfileEdits: membership.allowsStudioProfileEdits });
});

// Artist mobility, Part 1 -- "Go Solo": self-service only, no staff bypass
// (same shape as profile-delegation above -- nobody can make this decision
// FOR an artist). Spins up a brand new studio-of-one around the artist's
// EXISTING User + Artist identity: no invite, no new account, no password
// -- they're already signed in as themselves. Reuses generateUniqueSlug
// from routes/studios.ts (the same slug logic create-studio.ts's platform-
// operator script and /studios/bootstrap already both use) rather than
// re-deriving it a third time.
//
// bio/specialties/portfolioImages/rates/flash gallery etc. all live on the
// Artist row itself, never on User or Studio -- moving User.studioId is
// the entire transition; nothing artist-level needs copying.
//
// The caller's existing JWT still carries the OLD studioId/role after this
// (requireAuth only re-validates isActive/deactivatedAt/passwordChangedAt
// live, not studioId/role -- see that file's own comment), so a fresh
// token is minted and returned, same as invite-accept/password-reset do
// after their own account-shape changes.
router.post("/:id/go-solo", requireAuth, async (req, res) => {
  const id = req.params.id as string;
  const { studioName } = req.body ?? {};

  if (typeof studioName !== "string" || !studioName.trim()) {
    return res.status(400).json({ error: "studioName is required" });
  }

  const artist = await prisma.artist.findUnique({ where: { id }, include: { user: true } });
  if (!artist || artist.user.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Artist not found" });
  }

  if (artist.userId !== req.user!.userId) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const oldStudioId = artist.user.studioId;
  const slug = await generateUniqueSlug(studioName.trim());

  const { studio, membership } = await prisma.$transaction(async (tx) => {
    const studio = await tx.studio.create({ data: { name: studioName.trim(), slug } });

    await tx.user.update({ where: { id: artist.userId }, data: { studioId: studio.id, role: Role.OWNER } });

    // Ends whatever active HOME membership this artist had (there is
    // always exactly one, per the DB's own partial unique index) --
    // updateMany rather than a fetched id, since only the WHERE shape
    // matters here, not a specific row reference.
    await tx.studioMembership.updateMany({
      where: { artistId: id, type: "HOME", endedAt: null },
      data: { endedAt: new Date() },
    });

    const membership = await tx.studioMembership.create({
      data: { studioId: studio.id, artistId: id, type: "HOME", allowsStudioProfileEdits: true },
    });

    return { studio, membership };
  });

  await logAudit({
    studioId: oldStudioId,
    actorUserId: artist.userId,
    entityType: "StudioMembership",
    entityId: membership.id,
    action: "go_solo_departed",
    changes: { newStudioId: studio.id, newStudioName: studio.name },
  });

  await logAudit({
    studioId: studio.id,
    actorUserId: artist.userId,
    entityType: "Studio",
    entityId: studio.id,
    action: "go_solo_created",
    changes: { fromStudioId: oldStudioId },
  });

  emitInvalidation({ type: "team.changed", studioId: oldStudioId });
  emitInvalidation({ type: "artist.changed", studioId: oldStudioId, artistId: id });
  emitInvalidation({ type: "team.changed", studioId: studio.id });
  emitInvalidation({ type: "artist.changed", studioId: studio.id, artistId: id });

  const payload: AuthPayload = { userId: artist.userId, studioId: studio.id, role: Role.OWNER };
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });

  res.status(201).json({ studio, token });
});

export default router;
