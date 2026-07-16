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
    data: { userId, bio, specialties: specialties ?? [] },
  });

  res.status(201).json(artist);
});

router.get("/", requirePermission("artists.view"), async (req, res) => {
  const artists = await prisma.artist.findMany({
    where: { user: { studioId: req.user!.studioId } },
    include: { user: { select: { id: true, email: true, role: true } } },
  });

  res.json(artists);
});

export default router;
