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

// Solo-guest fix (REPORT.md: "Solo-guest 403 investigation" ->
// "Build the solo-guest access fix"): the caller's role is PER-STUDIO, not
// a single global fact -- a solo studio-of-one's own account is commonly
// role: OWNER (lib/soloStudio.ts's own comment), but that same User row can
// also have an Artist profile and guest at other studios, where they are
// necessarily just an ARTIST (guest relationships are artist-only by
// construction; there is no such thing as a "guest OWNER"). Every
// access/permission primitive in this file now resolves through this one
// function rather than branching on `user.role` directly, so "does this
// studio have any relationship with this caller, and what role governs it"
// is answered in exactly one place.
//
// UNION, not either/or: a caller can hold BOTH a staff hat (at their own
// home, whatever role that is) and an artist hat (at every studio where
// they have an active membership, home or guest) at once. This resolves
// which hat applies to ONE specific studio -- home equality never widens
// for a caller with no Artist profile at all (a pure OWNER/FRONT_DESK), and
// a real guest relationship is never invisible just because the caller's
// OWN role elsewhere happens not to be literally ARTIST.
//
// Bug-class history this replaces: earlier versions dispatched on
// `user.role !== Role.ARTIST` to decide whether to do this DB-backed
// resolution at all -- correct for a plain ARTIST or plain OWNER/FRONT_DESK
// with no Artist row, but silently wrong for a solo OWNER who ALSO has an
// Artist profile: their global role took the bare-equality branch, so an
// active GUEST membership elsewhere was invisible to every primitive built
// on it (list routes that query StudioMembership directly, like
// inquiries.ts's GET /, were never affected -- only the shared
// callerBelongsToStudio/hasPermissionAt primitives were blind to it).
//
// Ghost-access regression, caught before it shipped (still enforced here):
// an EARLIER version of this function short-circuited on
// `user.studioId === recordStudioId` (the raw JWT claim) for every role,
// ARTIST included. That's the same "ended membership still grants access"
// bug class as the historical GET /artists roster bug (see
// studioHasActiveMembership's own comment) -- go-solo and
// artist-invite-accept (routes/artists.ts, routes/artistInvites.ts) both
// explicitly document that a caller's EXISTING JWT keeps the OLD home
// studioId until they receive and apply a freshly-minted token, up to the
// full 7-day token lifetime away on a second device/tab that never
// refreshes. Anyone with an Artist profile has their home re-read fresh
// from the DB below, never trusted from the JWT.
export async function effectiveRoleAt(
  user: Pick<AuthPayload, "studioId" | "role" | "userId">,
  recordStudioId: string,
): Promise<Role | null> {
  const artist = await prisma.artist.findUnique({
    where: { userId: user.userId },
    select: { id: true, user: { select: { studioId: true } } },
  });

  // No Artist profile at all -- pure staff, whose User.studioId never
  // changes post-creation (only artist mobility -- transfers, go-solo --
  // ever moves a User to a different home), so the JWT claim is already
  // accurate. Home equality only, exactly as before this fix: this is the
  // "must NOT widen" half of the union.
  if (!artist) {
    return user.studioId === recordStudioId ? user.role : null;
  }

  // Has an Artist profile: their fresh (never JWT-cached) home studio
  // governs whether recordStudioId even IS home.
  if (artist.user.studioId === recordStudioId) {
    // At home, their real global role is fully in effect, whatever it is
    // (OWNER/FRONT_DESK/ARTIST) -- staff roles are never diminished at the
    // studio they actually own/work at.
    return user.role;
  }

  // Not home. The only relationship that can exist at a DIFFERENT studio is
  // an active GUEST membership -- guest relationships are always
  // artist-only, regardless of what the caller's role is at their own home.
  // A solo OWNER guesting elsewhere is exactly as much "just an ARTIST"
  // there as anyone else guesting there -- their OWNER hat never travels.
  if (await studioHasActiveMembership(recordStudioId, artist.id)) {
    return Role.ARTIST;
  }

  return null;
}

export async function callerBelongsToStudio(
  user: Pick<AuthPayload, "studioId" | "role" | "userId">,
  recordStudioId: string,
): Promise<boolean> {
  return (await effectiveRoleAt(user, recordStudioId)) !== null;
}

// Same bug class, list-query shape: every studio a caller has a live
// relationship with (HOME + every active GUEST), for building an `IN`
// clause instead of a single equality -- used by conversations.ts's own
// list/visibility helpers, whose "which studio(s) can this caller see
// data from" question can't be answered with one studioId for an ARTIST.
// Dispatches on "has an Artist profile," same as effectiveRoleAt above --
// not on literal role, so a solo OWNER's guest studios are included too.
export async function activeStudioIdsForCaller(
  user: Pick<AuthPayload, "studioId" | "role" | "userId">,
): Promise<string[]> {
  return [...(await rolesByStudioForCaller(user)).keys()];
}

// Superset of activeStudioIdsForCaller for a consumer that needs the
// PER-STUDIO role too, not just the id list -- e.g. conversations.ts's
// visibility scoping, which must not apply a caller's home-role-derived
// clause (or home-derived permission flags) uniformly across a studio
// they only GUEST at. Same union-of-hats rule as effectiveRoleAt: home
// keeps the caller's real global role, every active guest studio is
// always Role.ARTIST.
export async function rolesByStudioForCaller(
  user: Pick<AuthPayload, "studioId" | "role" | "userId">,
): Promise<Map<string, Role>> {
  const artist = await prisma.artist.findUnique({
    where: { userId: user.userId },
    select: { id: true, user: { select: { studioId: true } } },
  });
  if (!artist) return new Map([[user.studioId, user.role]]);

  const roles = new Map<string, Role>([[artist.user.studioId, user.role]]);
  const memberships = await prisma.studioMembership.findMany({
    where: { artistId: artist.id, endedAt: null },
    select: { studioId: true },
  });
  for (const membership of memberships) {
    if (!roles.has(membership.studioId)) roles.set(membership.studioId, Role.ARTIST);
  }
  return roles;
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
// Solo-guest fix: evaluates the permission matrix using the caller's
// EFFECTIVE role AT recordStudioId, never their raw `user.role` claim.
// This matters even more than it looks: `hasPermission` short-circuits
// `true` unconditionally for OWNER (see lib/permissions.ts). If this
// passed a solo OWNER's global role straight through once
// effectiveRoleAt/callerBelongsToStudio correctly recognized their guest
// membership, they would get UNCONDITIONAL, matrix-bypassing access to
// every permission at every studio they merely guest at -- the opposite,
// far worse failure mode from the 403 this whole fix exists to close.
// effectiveRoleAt returns Role.ARTIST for a guest studio specifically to
// prevent this: a solo OWNER guesting elsewhere is governed by the host's
// real ARTIST matrix, exactly like any other guest artist.
export async function hasPermissionAt(
  user: Pick<AuthPayload, "studioId" | "role" | "userId">,
  recordStudioId: string,
  key: PermissionKey,
): Promise<boolean> {
  const role = await effectiveRoleAt(user, recordStudioId);
  if (!role) return false;
  return hasPermission(recordStudioId, role, key);
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
  const role = await effectiveRoleAt(user, recordStudioId);
  if (!role) {
    return { allowed: false, viaSoloArtistBypass: false };
  }
  // Same reasoning as hasPermissionAt above: the EFFECTIVE role at this
  // studio, never the caller's raw global role -- a solo OWNER guesting
  // elsewhere must be checked as an ARTIST there, not get OWNER's
  // unconditional matrix bypass.
  if (await hasPermission(recordStudioId, role, key)) {
    return { allowed: true, viaSoloArtistBypass: false };
  }
  if (role === Role.ARTIST) {
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
