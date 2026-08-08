import { Router } from "express";
import { prisma } from "../lib/prisma";
import { ResidencyStatus } from "../../generated/prisma/enums";

// 6a Epic Part 4: genuinely public, unauthenticated -- artists.ts's own
// router has a blanket `router.use(requireAuth)`, so this lives in its own
// file, mounted at the same /artists path but registered BEFORE that
// router in index.ts (same "public router mounted first" convention as
// giftCards.ts/waivers.ts/customPolicies.ts, defensively -- this specific
// two-segment path can't structurally collide with artists.ts's own
// GET /:id, but the convention costs nothing to follow anyway).
const router = Router();

router.get("/public/:publicSlug", async (req, res) => {
  const publicSlug = req.params.publicSlug as string;

  const artist = await prisma.artist.findUnique({
    where: { publicSlug },
    select: {
      id: true,
      bio: true,
      specialties: true,
      publishedAt: true,
      publicSlug: true,
      user: { select: { name: true, avatarUrl: true, studioId: true } },
    },
  });

  // Unpublished or missing slug -> 404, indistinguishable from each other
  // (never leak "this slug exists but isn't published yet" to a stranger).
  if (!artist || !artist.publishedAt) {
    return res.status(404).json({ error: "This artist page isn't available." });
  }

  const homeStudio = await prisma.studio.findUnique({
    where: { id: artist.user.studioId },
    select: { id: true, name: true, slug: true },
  });
  // Should be unreachable (publish requires a real home studio to exist),
  // but never assume -- a studio-deletion edge case shouldn't crash this
  // public page.
  if (!homeStudio) {
    return res.status(404).json({ error: "This artist page isn't available." });
  }

  // Upcoming locations: home base plus every future CONFIRMED residency
  // (endDate today-or-later) -- a past or PENDING/DECLINED/CANCELLED one
  // never appears here, matching Part 3's own "PENDING unlocks nothing"
  // rule (a client should never see, let alone book into, a stint the
  // artist hasn't actually confirmed).
  const now = new Date();
  const upcomingResidencyRows = await prisma.residency.findMany({
    where: { artistId: artist.id, status: ResidencyStatus.CONFIRMED, endDate: { gte: now } },
    select: {
      startDate: true,
      endDate: true,
      membership: { select: { studio: { select: { id: true, name: true, slug: true } } } },
    },
    orderBy: { startDate: "asc" },
  });

  res.json({
    // Real id, not just publicSlug -- needed by the frontend's BOOK
    // (bookingArtistId) and FLASH (/flash/:studioSlug/:artistId) links,
    // both of which take a real Artist.id, same as every other consumer
    // of those two mechanisms (never the public-facing slug itself).
    id: artist.id,
    name: artist.user.name ?? "This artist",
    avatarUrl: artist.user.avatarUrl,
    bio: artist.bio,
    specialties: artist.specialties,
    publicSlug: artist.publicSlug,
    homeStudio,
    upcomingResidencies: upcomingResidencyRows.map((r) => ({
      studio: r.membership.studio,
      startDate: r.startDate,
      endDate: r.endDate,
    })),
  });
});

export default router;
