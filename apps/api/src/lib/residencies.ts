import { prisma } from "./prisma";
import { ResidencyStatus } from "../../generated/prisma/enums";
import { civilDateKey } from "./studioTime";

// 6a Epic: the cross-studio overlap invariant -- an artist can have no
// date-overlapping CONFIRMED residencies across ANY studios, home
// included. This is the single application-layer enforcement point,
// called from both required checkpoints (routes/residencies.ts's create
// and accept actions, plus artistInvites.ts's own first-stint accept) so
// there is exactly one place this rule is expressed, not two copies that
// could drift. The database's own EXCLUDE constraint (this Residency
// model's own migration SQL) is belt-and-suspenders backing this up, never
// a substitute for it -- it has no way to produce a friendly error message
// naming the conflicting stint.
//
// Dates compared as civil (UTC-anchored) calendar dates, inclusive on both
// ends -- same convention the legacy Artist.guestStartDate/guestEndDate
// window already used, and the same boundary semantics the DB-level
// EXCLUDE constraint's own daterange(..., '[]') uses, so the two layers
// never disagree about an edge-of-range day.
export interface ResidencyOverlapConflict {
  residencyId: string;
  studioName: string;
  startDate: Date;
  endDate: Date;
}

export async function findResidencyOverlapConflict(
  artistId: string,
  startDate: Date,
  endDate: Date,
  excludeResidencyId?: string,
): Promise<ResidencyOverlapConflict | null> {
  const startKey = civilDateKey(startDate, "UTC");
  const endKey = civilDateKey(endDate, "UTC");

  const candidates = await prisma.residency.findMany({
    where: {
      artistId,
      status: ResidencyStatus.CONFIRMED,
      ...(excludeResidencyId ? { id: { not: excludeResidencyId } } : {}),
    },
    select: {
      id: true,
      startDate: true,
      endDate: true,
      membership: { select: { studio: { select: { name: true } } } },
    },
  });

  for (const candidate of candidates) {
    const candidateStartKey = civilDateKey(candidate.startDate, "UTC");
    const candidateEndKey = civilDateKey(candidate.endDate, "UTC");
    // Inclusive-range overlap: NOT (this ends before candidate starts, OR
    // this starts after candidate ends).
    const overlaps = !(endKey < candidateStartKey || startKey > candidateEndKey);
    if (overlaps) {
      return {
        residencyId: candidate.id,
        studioName: candidate.membership.studio.name,
        startDate: candidate.startDate,
        endDate: candidate.endDate,
      };
    }
  }

  return null;
}

export function residencyOverlapErrorMessage(conflict: ResidencyOverlapConflict): string {
  const start = civilDateKey(conflict.startDate, "UTC");
  const end = civilDateKey(conflict.endDate, "UTC");
  return `This artist already has a confirmed residency at ${conflict.studioName} from ${start} to ${end}, which overlaps these dates.`;
}

// 6a Epic Part 3: the residency-aware availability gate -- during a
// CONFIRMED residency at host B, the artist is bookable at B and BLOCKED
// at home and everywhere else; outside any residency window, bookable at
// home only. This is the ONE function every availability computation in
// the app (lib/schedulingAssistant.ts's getSuggestedTimes/
// getAvailableDates/getSlotsForDate) calls to decide whether a given civil
// day even has a working window to consider at THIS studio for THIS
// artist, before preferredSchedule/buffers/existing-appointments ever
// enter the picture -- see that file's own resolveAvailabilityContext for
// where this plugs in.
export interface ConfirmedResidencyWindow {
  studioId: string;
  startDate: Date;
  endDate: Date;
}

export async function getConfirmedResidenciesForArtist(artistId: string): Promise<ConfirmedResidencyWindow[]> {
  const rows = await prisma.residency.findMany({
    where: { artistId, status: ResidencyStatus.CONFIRMED },
    select: { startDate: true, endDate: true, membership: { select: { studioId: true } } },
  });
  return rows.map((r) => ({ studioId: r.membership.studioId, startDate: r.startDate, endDate: r.endDate }));
}

// dateKey: a civil "YYYY-MM-DD" already resolved in whatever timezone the
// caller cares about (studioTime.ts's civilDateKey) -- residency windows
// are compared as plain calendar dates (UTC-anchored, same as the overlap
// check above), not specific instants, so no further timezone conversion
// happens here.
export function isArtistBookableAtStudioOnDate(
  homeStudioId: string,
  targetStudioId: string,
  confirmedResidencies: ConfirmedResidencyWindow[],
  dateKey: string,
): boolean {
  const activeResidency = confirmedResidencies.find((r) => {
    const startKey = civilDateKey(r.startDate, "UTC");
    const endKey = civilDateKey(r.endDate, "UTC");
    return dateKey >= startKey && dateKey <= endKey;
  });

  if (activeResidency) {
    // On residency somewhere -- bookable ONLY at that studio, home
    // included if that's not it. A residency at home itself (nothing in
    // the schema prevents one, see the Residency model's own comment) is
    // simply the degenerate case where activeResidency.studioId ===
    // homeStudioId, handled by the exact same equality check.
    return activeResidency.studioId === targetStudioId;
  }

  // No residency active anywhere on this date -- bookable at home only.
  return targetStudioId === homeStudioId;
}

// Postgres exclusion_violation -- thrown if the DB-level EXCLUDE constraint
// ever catches something the application-layer check above missed (a
// genuine race, or a future direct-DB write). Never expected in normal
// operation; surfaced as the same clean 409 shape rather than a raw 500.
// Checked by constraint name in the error's own string form rather than a
// specific Prisma error class/code -- this constraint isn't modeled in
// Prisma's schema at all (hand-authored SQL, see the Residency model's own
// comment), so Prisma has no typed error shape for it to begin with.
export function isResidencyExclusionViolation(err: unknown): boolean {
  const text = err instanceof Error ? `${err.message}` : String(err);
  return text.includes("residency_no_overlap_confirmed");
}
