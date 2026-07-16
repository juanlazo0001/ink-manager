import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { Role } from "../../generated/prisma/enums";
import type { Prisma } from "../../generated/prisma/client";
import { requirePermission } from "../lib/permissions";

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

  res.status(201).json(artist);
});

const ARTIST_INCLUDE = {
  user: { select: { id: true, email: true, role: true, name: true, phone: true, avatarUrl: true, studioId: true } },
} as const;

// List view only renders id/bio/specialties/portfolioImages plus a handful
// of user fields -- role/phone/studioId are detail-page-only.
const ARTIST_LIST_SELECT = {
  id: true,
  bio: true,
  specialties: true,
  portfolioImages: true,
  user: { select: { id: true, email: true, name: true, avatarUrl: true } },
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

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

router.patch("/:id", requirePermission("artists.manage"), async (req, res) => {
  const id = req.params.id as string;
  const { bio, specialties, portfolioImages } = req.body ?? {};

  const artist = await prisma.artist.findUnique({ where: { id }, include: { user: true } });
  if (!artist || artist.user.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Artist not found" });
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

  const updated = await prisma.artist.update({
    where: { id },
    data: {
      ...(bio !== undefined ? { bio: bio?.trim() || null } : {}),
      ...(specialties !== undefined ? { specialties } : {}),
      ...(portfolioImages !== undefined ? { portfolioImages } : {}),
    },
    include: ARTIST_INCLUDE,
  });

  res.json(updated);
});

export default router;
