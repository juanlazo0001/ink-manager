import { prisma } from "./prisma";

// Phase 5: studio-level, ARTIST-effective-role field visibility on
// Inquiry/Project responses. Extends (never replaces) the pre-existing
// hardcoded ARTIST_INQUIRY_SELECT/INQUIRY_LIST_SELECT projections in
// routes/inquiries.ts -- those already exclude client contact info, full
// deposit dollar amounts/signatures, and every staff-only workflow field
// (tokens, closedReason/lostReason, customFieldAnswers, etc.) unconditionally,
// regardless of these settings. This module can only further RESTRICT what's
// already in those projections, never grant anything back.
//
// Both keys default to `true` (current, pre-feature behavior) so shipping
// this changes nothing until a studio deliberately opts in -- see
// REPORT.md's "Phase 5, Part 1" investigation for why exactly these two
// groups (not the task's other three examples, which don't correspond to
// any field actually in these projections today).
export interface ArtistFieldVisibility {
  pricingDetail: boolean;
  internalNotes: boolean;
}

export const DEFAULT_ARTIST_FIELD_VISIBILITY: ArtistFieldVisibility = {
  pricingDetail: true,
  internalNotes: true,
};

export function normalizeArtistFieldVisibility(raw: unknown): ArtistFieldVisibility {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_ARTIST_FIELD_VISIBILITY };
  const r = raw as Record<string, unknown>;
  return {
    pricingDetail: typeof r.pricingDetail === "boolean" ? r.pricingDetail : DEFAULT_ARTIST_FIELD_VISIBILITY.pricingDetail,
    internalNotes: typeof r.internalNotes === "boolean" ? r.internalNotes : DEFAULT_ARTIST_FIELD_VISIBILITY.internalNotes,
  };
}

export async function getArtistFieldVisibility(studioId: string): Promise<ArtistFieldVisibility> {
  const settings = await prisma.studioSettings.findUnique({
    where: { studioId },
    select: { artistFieldVisibility: true },
  });
  return normalizeArtistFieldVisibility(settings?.artistFieldVisibility);
}

// Batched form for a caller's blended, multi-studio list (GET
// /assigned-to-me, and the guest-blended branch of staff GET /) -- one
// query for every distinct studioId in the result set, not one round trip
// per row. A studio with no StudioSettings row at all (shouldn't happen --
// see studioSettings.ts's own getOrCreateSettings -- but defensive here
// since this reads directly, not through that helper) falls back to the
// same default as a settings row with a null artistFieldVisibility.
export async function getArtistFieldVisibilityForStudios(
  studioIds: string[],
): Promise<Map<string, ArtistFieldVisibility>> {
  const uniqueIds = [...new Set(studioIds)];
  const rows = await prisma.studioSettings.findMany({
    where: { studioId: { in: uniqueIds } },
    select: { studioId: true, artistFieldVisibility: true },
  });
  const map = new Map<string, ArtistFieldVisibility>();
  for (const id of uniqueIds) map.set(id, { ...DEFAULT_ARTIST_FIELD_VISIBILITY });
  for (const row of rows) map.set(row.studioId, normalizeArtistFieldVisibility(row.artistFieldVisibility));
  return map;
}

// Post-fetch stripping, not a per-route static `select` swap: GET
// /assigned-to-me's own query can return rows from several different
// studios (home + every active guest) in ONE response, each of which may
// have different settings -- there is no single Prisma `select` that could
// express "different shape per row" at query time. Deletes keys entirely
// (never nulls them) so a hidden field is genuinely ABSENT from the JSON,
// not present-but-null -- verified directly in Part 3's adversarial HTTP
// checks. Defensive against shape differences between the DETAIL
// projection (ARTIST_INQUIRY_SELECT) and the LIST projection
// (INQUIRY_LIST_SELECT) -- `delete` on a key that was never present is a
// safe no-op, so the same function serves both call shapes without a
// separate variant.
export function applyArtistFieldVisibility<T extends Record<string, unknown>>(
  row: T,
  visibility: ArtistFieldVisibility,
): T {
  const result: Record<string, unknown> = { ...row };

  if (!visibility.pricingDetail) {
    delete result.priceEstimateLow;
    delete result.priceEstimateHigh;
    delete result.timeEstimateHoursMin;
    delete result.timeEstimateHoursMax;
    delete result.budget;
    delete result.depositForms;

    if (result.service && typeof result.service === "object") {
      const service = { ...(result.service as Record<string, unknown>) };
      delete service.flatDepositCents;
      delete service.depositBreakdownNote;
      result.service = service;
    }

    if (Array.isArray(result.plannedSessions)) {
      result.plannedSessions = result.plannedSessions.map((session) => {
        if (!session || typeof session !== "object") return session;
        const stripped = { ...(session as Record<string, unknown>) };
        delete stripped.estimatedHoursMin;
        delete stripped.estimatedHoursMax;
        delete stripped.estimatedPriceLow;
        delete stripped.estimatedPriceHigh;
        delete stripped.depositForm;
        return stripped;
      });
    }
  }

  if (!visibility.internalNotes) {
    delete result.notes;
  }

  return result as T;
}
