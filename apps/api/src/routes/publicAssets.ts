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

// Personalized payment-confirmation background: fetches a Cloudinary-hosted
// source image (a client's own uploaded inquiry reference image) through
// Cloudinary's own URL-based transformation (w_800/e_blur:2000/q_auto/
// f_auto -- downscaled, heavily blurred, aggressively compressed, best
// format for the requesting browser), then proxies the ALREADY-TRANSFORMED
// bytes back under our own URL rather than ever handing the browser a
// Cloudinary URL directly. Two reasons this proxies instead of redirecting:
// (1) every caller of this (deposits.ts, flashPayments.ts) scopes access by
// a payment token, not by knowing the Cloudinary URL -- a redirect would
// leak that real, permanent, transformation-strippable URL into the page's
// own network log/devtools, at which point the blur is just a client-side
// suggestion, not an enforced property; (2) matches serveDataUrl's own
// established shape (this app's other "real image, not a data: URI"
// endpoints) of always terminating in bytes-we-serve. "Processed server-
// side and cached" per this feature's own design -- the actual blur pixel
// work happens at Cloudinary (a real image-processing server, not a live
// CSS filter: blur() the client would have to recompute every scroll/
// repaint), cached at Cloudinary's own edge AND behind our own
// Cache-Control below.
const CLOUDINARY_HOST = "res.cloudinary.com";
const REFERENCE_BACKGROUND_TRANSFORM = "w_800,e_blur:2000,q_auto,f_auto";

export async function serveBlurredRemoteImage(res: import("express").Response, sourceUrl: string): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    return false;
  }

  // Defensive: only ever proxies a real Cloudinary delivery URL (what
  // every referenceImages entry actually is -- see uploads.ts) rather than
  // blindly server-side-fetching whatever string happens to be stored,
  // which would otherwise be a same-origin-request SSRF surface.
  if (parsed.hostname !== CLOUDINARY_HOST || !parsed.pathname.includes("/upload/")) {
    return false;
  }

  const transformedUrl = sourceUrl.replace("/upload/", `/upload/${REFERENCE_BACKGROUND_TRANSFORM}/`);

  let response: Response;
  try {
    response = await fetch(transformedUrl);
  } catch {
    return false;
  }

  const contentType = response.headers.get("content-type");
  if (!response.ok || !contentType?.startsWith("image/")) {
    return false;
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.end(bytes);
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
