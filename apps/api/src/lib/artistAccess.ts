import { prisma } from "./prisma";
import { Role } from "../../generated/prisma/enums";
import type { AuthPayload } from "../middleware/auth";

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
// one studio, no membership concept) that's correct and this short-circuits
// on the first branch with no extra query. For an ARTIST caller,
// `req.user!.studioId` is only their HOME studio (copied from User.studioId
// at login) -- this resolves their own artist row and additionally checks
// an active GUEST membership at the record's actual studio, so a legitimately
// guest-assigned artist isn't 404'd out of their own work. Every other role
// (CUSTOMER) simply has no membership concept and falls through to false.
export async function callerBelongsToStudio(
  user: Pick<AuthPayload, "studioId" | "role" | "userId">,
  recordStudioId: string,
): Promise<boolean> {
  if (user.studioId === recordStudioId) return true;
  if (user.role !== Role.ARTIST) return false;
  const artist = await prisma.artist.findUnique({ where: { userId: user.userId }, select: { id: true } });
  return artist != null && (await studioHasActiveMembership(recordStudioId, artist.id));
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
