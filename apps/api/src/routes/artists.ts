import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { Role } from "../../generated/prisma/enums";
import { requirePermission } from "../lib/permissions";

const router = Router();

// Public: lets the unauthenticated intake form populate a "preferred artist"
// dropdown. Only exposes id/name, never bio/specialties/user contact info.
// TEMPORARY SIMPLIFICATION: looks up the single existing studio rather than
// scoping by studioSlug, since only one studio exists right now.
router.get("/public", async (_req, res) => {
  const studio = await prisma.studio.findFirst();
  if (!studio) {
    return res.json([]);
  }

  const artists = await prisma.artist.findMany({
    where: { user: { studioId: studio.id, role: Role.ARTIST, isActive: true } },
    include: { user: { select: { name: true } } },
    orderBy: { user: { name: "asc" } },
  });

  res.json(artists.map((artist) => ({ id: artist.id, name: artist.user.name ?? "Unnamed artist" })));
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
