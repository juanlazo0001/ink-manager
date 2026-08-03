import { prisma } from "./prisma";

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
