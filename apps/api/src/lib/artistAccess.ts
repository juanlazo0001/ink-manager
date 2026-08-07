import { prisma } from "./prisma";
import { Role } from "../../generated/prisma/enums";
import type { AuthPayload } from "../middleware/auth";
import { hasPermission, type PermissionKey } from "./permissions";
import { isSoloStudioArtist } from "./soloStudio";

// Artist mobility, Part 2: "does this studio have any live relationship
// with this artist at all" -- HOME or GUEST, doesn't matter which. Broader
// than `artist.user.studioId === studioId` (which only ever means HOME):
// this is what gates whether a studio can even SEE a guest artist in their
// Team/Artists list, open their detail page, or assign them to an
// appointment. Editing rights are a separate, narrower question --
// see each route's own HOME-only vs delegation-scoped comments.
export async function studioHasActiveMembership(studioId: string, artistId: string): Promise<boolean> {
  const membership = await prisma.studioMembership.findFirst({
    where: { studioId, artistId, endedAt: null },
    select: { id: true },
  });
  return membership !== null;
}

// Bug-class fix (4th instance -- deposit-forms/:id/pdf, waivers/:id/status,
// inquiries.ts's various requirePermission-only routes, appointments.ts
// equivalents): a whole family of routes was written as a plain
// `record.studioId === req.user!.studioId` check, before StudioMembership
// existed. For a staff caller (OWNER/FRONT_DESK, who only ever belong to
// one studio, no membership concept) that's correct -- their JWT's studioId
// claim never changes across the token's lifetime, so this short-circuits
// on the first branch with no extra query. For an ARTIST caller, this
// resolves their own artist row and checks BOTH their current (freshly
// read, not JWT-cached) home studio and an active GUEST membership at the
// record's actual studio, so a legitimately guest-assigned artist isn't
// 404'd out of their own work.
//
// Ghost-access regression, caught before it shipped: an EARLIER version of
// this function short-circuited on `user.studioId === recordStudioId`
// (the raw JWT claim) for every role, ARTIST included. That's exactly the
// same "ended membership still grants access" bug class as the historical
// GET /artists roster bug (see studioHasActiveMembership's own comment) --
// go-solo and artist-invite-accept (routes/artists.ts, routes/
// artistInvites.ts) both explicitly document that a caller's EXISTING JWT
// keeps the OLD home studioId until they receive and apply a freshly-
// minted token, which can be up to the full 7-day token lifetime away on a
// second device/tab that never refreshes. During that window the old
// home's StudioMembership row is already `endedAt`-set, but the stale JWT
// claim alone would have granted ghost access to it via the equality
// shortcut, bypassing the active-membership check entirely. Fixed by never
// trusting the ARTIST caller's OWN studioId claim -- User.studioId is
// re-read fresh from the DB instead (kept in sync with the current HOME by
// both transfer routes, in the same transaction that ends the old
// membership), so this is the artist-mobility-safe equivalent of the
// existing "record's own home OR active GUEST" pattern used everywhere the
// codebase resolves a DIFFERENT artist's studio (e.g. PATCH /inquiries/:id/assign).
export async function callerBelongsToStudio(
  user: Pick<AuthPayload, "studioId" | "role" | "userId">,
  recordStudioId: string,
): Promise<boolean> {
  if (user.role !== Role.ARTIST) return user.studioId === recordStudioId;

  const artist = await prisma.artist.findUnique({
    where: { userId: user.userId },
    select: { id: true, user: { select: { studioId: true } } },
  });
  return (
    artist != null &&
    (artist.user.studioId === recordStudioId || (await studioHasActiveMembership(recordStudioId, artist.id)))
  );
}

// Same bug class, list-query shape: every studio a caller has a live
// relationship with (HOME + every active GUEST), for building an `IN`
// clause instead of a single equality -- used by conversations.ts's own
// list/visibility helpers, whose "which studio(s) can this caller see
// data from" question can't be answered with one studioId for an ARTIST.
// Staff (OWNER/FRONT_DESK) only ever have the one.
export async function activeStudioIdsForCaller(
  user: Pick<AuthPayload, "studioId" | "role" | "userId">,
): Promise<string[]> {
  if (user.role !== Role.ARTIST) return [user.studioId];
  const artist = await prisma.artist.findUnique({
    where: { userId: user.userId },
    select: { id: true, user: { select: { studioId: true } } },
  });
  if (!artist) return [user.studioId];
  const memberships = await prisma.studioMembership.findMany({
    where: { artistId: artist.id, endedAt: null },
    select: { studioId: true },
  });
  return [...new Set([artist.user.studioId, ...memberships.map((m) => m.studioId)])];
}

// Permission-context fix (REPORT.md: "permission-context investigation"
// and its fix entry): a permission is evaluated against the studio that
// OWNS the record being acted on, never the caller's own studioId claim --
// the same rule callerBelongsToStudio above already enforces for bare
// membership, extended to the permission MATRIX lookup. Before this,
// `hasPermission(req.user.studioId, ...)` meant a guest artist's
// capabilities at a host studio were governed by their HOME studio's
// matrix, not the host's -- confirmed exploitable with real HTTP (a guest
// artist granted appointments.reschedule only at their home studio could
// approve/confirm appointments at a host studio that denies ARTIST that
// permission entirely).
//
// Deliberately re-checks membership here (not just re-using an
// already-computed `callerBelongsToStudio` result from the caller) -- this
// function needs to be safe to call on its own, the same "self-contained
// primitive" precedent every other function in this file already follows.
export async function hasPermissionAt(
  user: Pick<AuthPayload, "studioId" | "role" | "userId">,
  recordStudioId: string,
  key: PermissionKey,
): Promise<boolean> {
  if (!(await callerBelongsToStudio(user, recordStudioId))) return false;
  return hasPermission(recordStudioId, user.role, key);
}

export interface PermissionAtResult {
  allowed: boolean;
  // Mirrors req.viaSoloArtistBypass's own purpose (lib/permissions.ts's
  // requirePermissionOrSoloArtist) -- lets the caller apply the extra
  // "only your own appointments" restriction that path specifically needs,
  // without re-deriving solo status itself.
  viaSoloArtistBypass: boolean;
}

// requirePermissionOrSoloArtist's record-scoped equivalent. The solo
// bypass is narrower than the plain permission check above: solo autonomy
// exists because there's no OWNER/FRONT_DESK gatekeeper left to protect --
// that's only true at the artist's OWN studio-of-one, never at a studio
// they're merely guesting at (which, by definition, has other staff who
// invited them and are the actual gatekeepers there). So the bypass
// requires BOTH that the record's studio genuinely IS the caller's own
// home studio -- re-read fresh from the database, never the JWT's own
// (possibly stale) studioId claim, same rule callerBelongsToStudio already
// applies -- AND that home studio is solo. A solo artist guesting
// elsewhere gets neither a real grant nor the bypass at the host, exactly
// like a brand-new, ungranted ARTIST there would.
export async function hasPermissionOrSoloArtistAt(
  user: Pick<AuthPayload, "studioId" | "role" | "userId">,
  recordStudioId: string,
  key: PermissionKey,
): Promise<PermissionAtResult> {
  if (!(await callerBelongsToStudio(user, recordStudioId))) {
    return { allowed: false, viaSoloArtistBypass: false };
  }
  if (await hasPermission(recordStudioId, user.role, key)) {
    return { allowed: true, viaSoloArtistBypass: false };
  }
  if (user.role === Role.ARTIST) {
    const artist = await prisma.artist.findUnique({
      where: { userId: user.userId },
      select: { user: { select: { studioId: true } } },
    });
    if (artist?.user.studioId === recordStudioId && (await isSoloStudioArtist(recordStudioId, user.userId))) {
      return { allowed: true, viaSoloArtistBypass: true };
    }
  }
  return { allowed: false, viaSoloArtistBypass: false };
}
