import { prisma } from "./prisma";
import { Role } from "../../generated/prisma/enums";

// Solo artist architecture, Phase 3: a studio where the only active
// OWNER/FRONT_DESK user, if any, IS this artist's own account -- i.e.
// there is no other human who could meaningfully review/gate their
// bookings. Deliberately checks OWNER/FRONT_DESK only, never other
// ARTIST-role colleagues: the "artists never create/reschedule their own
// appointments" rule exists specifically so a staff gatekeeper reviews
// artist-created bookings -- if no such gatekeeper exists at all, the rule
// has nothing left to protect, regardless of how many other artists
// happen to share the studio. A solo artist's own account is commonly
// itself role: OWNER (the studio-bootstrap flow always creates the first
// user as OWNER; nothing in the schema prevents that same User row from
// also having an Artist profile) -- excluding artistUserId from the count
// is what makes that self-is-owner case correctly read as solo, not
// blocked by the artist's own OWNER row.
export async function isSoloStudioArtist(studioId: string, artistUserId: string): Promise<boolean> {
  const otherStaffCount = await prisma.user.count({
    where: {
      studioId,
      isActive: true,
      id: { not: artistUserId },
      role: { in: [Role.OWNER, Role.FRONT_DESK] },
    },
  });
  return otherStaffCount === 0;
}
