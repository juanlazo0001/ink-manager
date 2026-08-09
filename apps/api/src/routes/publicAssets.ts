import { Router } from "express";
import { prisma } from "../lib/prisma";

// Public, unauthenticated: Studio.logoUrl and User.avatarUrl are stored as
// base64 data: URLs directly on the row (lib/images.ts's own comment --
// no file storage infra), which works fine as a React <img src> but can't
// serve as an og:image -- no real link-preview crawler fetches a data:
// URI for that tag, only http(s). These two routes decode the stored data
// URL and serve it as a real image response instead, purely so
// server.mjs's OG tag injection has an actual hosted URL to point at.
// Existence, not identity, is what's public here -- the same image any
// site visitor already sees inline on the studio's own public-facing
// pages, just re-served at a fetchable URL.
const router = Router();

export function serveDataUrl(res: import("express").Response, dataUrl: string): boolean {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return false;
  const [, contentType, base64] = match;
  res.setHeader("Content-Type", contentType!);
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.end(Buffer.from(base64!, "base64"));
  return true;
}

router.get("/studio-logo/:studioSlug", async (req, res) => {
  const studio = await prisma.studio.findUnique({
    where: { slug: req.params.studioSlug as string },
    select: { logoUrl: true },
  });
  if (!studio?.logoUrl || !serveDataUrl(res, studio.logoUrl)) {
    res.status(404).end();
  }
});

// Same publishedAt gate artistPublicProfile.ts's own GET /public/:publicSlug
// uses -- an unpublished artist's avatar shouldn't be fetchable via this
// side door just because their publicSlug leaked somewhere.
router.get("/artist-avatar/:publicSlug", async (req, res) => {
  const artist = await prisma.artist.findUnique({
    where: { publicSlug: req.params.publicSlug as string },
    select: { publishedAt: true, user: { select: { avatarUrl: true } } },
  });
  if (!artist?.publishedAt || !artist.user.avatarUrl || !serveDataUrl(res, artist.user.avatarUrl)) {
    res.status(404).end();
  }
});

export default router;
