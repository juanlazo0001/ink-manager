import { prisma } from "./prisma";

// Sidecar upload metadata for Inquiry.referenceImages/placementImages --
// tracked going forward only (see the schema doc comment on those fields).
// A url with no entry here predates this feature; the frontend renders
// that as "no data," never backfilled.

export interface ImageMetaEntry {
  uploadedAt: string;
  uploadedById: string | null;
}

export type ImageMetaMap = Record<string, ImageMetaEntry>;

// Fresh metadata for a brand-new set of urls (inquiry creation, whether by
// the public intake form or a staff-logged walk-in) -- uploadedById null
// means the client submitted it themselves (no authenticated staff user to
// attribute it to on that path).
export function buildImageMeta(urls: string[], uploadedById: string | null): ImageMetaMap {
  const now = new Date().toISOString();
  const meta: ImageMetaMap = {};
  for (const url of urls) {
    meta[url] = { uploadedAt: now, uploadedById };
  }
  return meta;
}

// Reconciles metadata when an existing image list is edited: a url no
// longer present is dropped, a url that already had an entry keeps it
// completely unchanged (re-saving the same list is never treated as a
// fresh upload), and a genuinely new url gets attributed to whoever's
// editing right now.
export function mergeImageMeta(existingMeta: unknown, newUrls: string[], uploadedById: string | null): ImageMetaMap {
  const existing = (existingMeta && typeof existingMeta === "object" ? existingMeta : {}) as ImageMetaMap;
  const now = new Date().toISOString();
  const merged: ImageMetaMap = {};
  for (const url of newUrls) {
    merged[url] = existing[url] ?? { uploadedAt: now, uploadedById };
  }
  return merged;
}

export interface ResolvedImageDetail {
  url: string;
  uploadedAt: string | null;
  uploadedBy: { id: string; name: string | null; email: string } | null;
}

// Read-side resolution: the raw metadata only stores uploadedById, same as
// AppointmentPhoto's own real relation column -- this resolves it to a
// display-ready {id, name, email} the same shape, in one batched query
// regardless of how many distinct uploaders a given image list has. A url
// with no entry in `meta` (predates this feature) resolves to
// uploadedAt/uploadedBy both null -- the frontend shows "no data" for that,
// never a fabricated timestamp.
export async function resolveImageMeta(urls: string[], meta: unknown): Promise<ResolvedImageDetail[]> {
  const metaMap = (meta && typeof meta === "object" ? meta : {}) as ImageMetaMap;
  const uploaderIds = [...new Set(urls.map((url) => metaMap[url]?.uploadedById).filter((id): id is string => !!id))];

  const uploaders =
    uploaderIds.length > 0
      ? await prisma.user.findMany({ where: { id: { in: uploaderIds } }, select: { id: true, name: true, email: true } })
      : [];
  const uploaderMap = new Map(uploaders.map((u) => [u.id, u]));

  return urls.map((url) => {
    const entry = metaMap[url];
    return {
      url,
      uploadedAt: entry?.uploadedAt ?? null,
      uploadedBy: entry?.uploadedById ? (uploaderMap.get(entry.uploadedById) ?? null) : null,
    };
  });
}
