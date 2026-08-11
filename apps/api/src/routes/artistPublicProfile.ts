import { Router } from "express";
import { prisma } from "../lib/prisma";
import { ResidencyStatus } from "../../generated/prisma/enums";
import { resolveRequestLocale } from "../lib/contentTranslation";
import { API_PUBLIC_URL } from "../lib/publicUrl";

// 6a Epic Part 4: genuinely public, unauthenticated -- artists.ts's own
// router has a blanket `router.use(requireAuth)`, so this lives in its own
// file, mounted at the same /artists path but registered BEFORE that
// router in index.ts (same "public router mounted first" convention as
// giftCards.ts/waivers.ts/customPolicies.ts, defensively -- this specific
// two-segment path can't structurally collide with artists.ts's own
// GET /:id, but the convention costs nothing to follow anyway).
const router = Router();

interface StudioSummary {
  id: string;
  name: string;
  slug: string;
  // Best-effort, same "single-location fallback, never guess wrong for a
  // multi-location studio" rule deposits.ts's own resolvedAddress uses --
  // there's no assigned-artist-location signal to prefer here (this page
  // has no specific appointment/inquiry context), so it's purely the
  // single-location case or nothing.
  address: string | null;
  // Real fetchable URL (via publicAssets, same "existence, not identity,
  // is public here" convention as artist-avatar below) -- sourced from
  // Studio.iconLogo specifically, NOT the studio's general logoUrl (see
  // that field's own schema comment for why these are separate uploads).
  // Null means no icon logo on file, not a fetch that might 404; the
  // frontend renders a Fraunces initial in a thin ring for that case.
  iconLogoUrl: string | null;
}

async function studioSummary(studioId: string, name: string, slug: string): Promise<StudioSummary> {
  const [locations, studio] = await Promise.all([
    prisma.location.findMany({ where: { studioId }, select: { address: true } }),
    prisma.studio.findUnique({ where: { id: studioId }, select: { iconLogo: true } }),
  ]);
  return {
    id: studioId,
    name,
    slug,
    address: locations.length === 1 ? (locations[0]!.address ?? null) : null,
    iconLogoUrl: studio?.iconLogo ? `${API_PUBLIC_URL}/public-assets/studio-icon-logo/${slug}` : null,
  };
}

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
      instagramHandle: true,
      facebookProfileUrl: true,
      portfolioImages: true,
      flashPieces: { select: { id: true }, take: 1 },
      user: { select: { name: true, avatarUrl: true, studioId: true } },
    },
  });

  // Unpublished or missing slug -> 404, indistinguishable from each other
  // (never leak "this slug exists but isn't published yet" to a stranger).
  if (!artist || !artist.publishedAt) {
    return res.status(404).json({ error: "This artist page isn't available." });
  }

  const homeStudioRow = await prisma.studio.findUnique({
    where: { id: artist.user.studioId },
    select: { id: true, name: true, slug: true, settings: { select: { defaultLocale: true } } },
  });
  // Should be unreachable (publish requires a real home studio to exist),
  // but never assume -- a studio-deletion edge case shouldn't crash this
  // public page.
  if (!homeStudioRow) {
    return res.status(404).json({ error: "This artist page isn't available." });
  }

  // Multi-language public forms (retrofit -- this page predated that epic
  // and was out of scope then): no Client/studio-content concept here, so
  // resolution is just explicit ?locale= over the home studio's own
  // defaultLocale, same two-tier precedence intake's pre-client state uses.
  const locale = resolveRequestLocale(req.query.locale, null, homeStudioRow.settings?.defaultLocale);

  const homeStudio = await studioSummary(homeStudioRow.id, homeStudioRow.name, homeStudioRow.slug);

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

  const upcomingResidencies = await Promise.all(
    upcomingResidencyRows.map(async (r) => ({
      studio: await studioSummary(r.membership.studio.id, r.membership.studio.name, r.membership.studio.slug),
      startDate: r.startDate,
      endDate: r.endDate,
    })),
  );

  res.json({
    // Real id, not just publicSlug -- needed by the frontend's BOOK
    // (bookingArtistId) and FLASH (/flash/:studioSlug/:artistId) links,
    // both of which take a real Artist.id, same as every other consumer
    // of those two mechanisms (never the public-facing slug itself).
    id: artist.id,
    name: artist.user.name ?? "This artist",
    // Real, cacheable, publishedAt-gated URL -- see publicAssets.ts's own
    // artist-avatar route comment for why this is preferred over the raw
    // (potentially large inline data:) avatarUrl. Null when the artist
    // never uploaded one.
    avatarUrl: artist.user.avatarUrl ? `${API_PUBLIC_URL}/public-assets/artist-avatar/${artist.publicSlug}` : null,
    bio: artist.bio,
    specialties: artist.specialties,
    publicSlug: artist.publicSlug,
    homeStudio,
    upcomingResidencies,
    // v2: only the two fields the profile wizard's own social step
    // actually collects -- ArtistPublicPage.tsx renders an icon per
    // non-null field, and nothing at all when both are null.
    instagramHandle: artist.instagramHandle,
    facebookProfileUrl: artist.facebookProfileUrl,
    // Ambient background texture: null when the artist has neither a
    // portfolio image nor a flash piece on file -- avoids a guaranteed-404
    // fetch on the frontend when we already know there's nothing to show.
    // publicAssets' own route re-derives which source image to use
    // (portfolio first, flash as fallback); this only checks presence.
    backgroundImageUrl:
      artist.portfolioImages.length > 0 || artist.flashPieces.length > 0
        ? `${API_PUBLIC_URL}/public-assets/artist-background/${artist.publicSlug}`
        : null,
    resolvedLocale: locale,
  });
});

export default router;
