import { prisma } from "../prisma";
import { type SystemTask, type TaskSource } from "./types";

// Deliberately NOT in TASK_SOURCE_REGISTRY (registry.ts): every other
// source is studioId-scoped "front-desk work" content, gated behind
// tasks.viewQueue (false by default for ARTIST -- see routes/tasks.ts's own
// comment). A pending ArtistMembershipInvite is the opposite shape
// entirely -- personal to whoever's email it's addressed to, from a
// DIFFERENT studio than the one in their JWT, and exactly the role
// (ARTIST, or a solo OWNER+Artist) that tasks.viewQueue excludes by
// default. Called directly from routes/tasks.ts's GET / instead, merged
// into `system` unconditionally regardless of that permission -- an
// invite existing-identity artists otherwise have no in-app way to
// discover at all besides email (which, in dev, doesn't even send -- see
// REPORT.md's "Internal studio-creation mechanism" entry).
async function fetch(_studioId: string, userId: string): Promise<SystemTask[]> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  if (!user) return [];

  const invites = await prisma.artistMembershipInvite.findMany({
    where: { email: user.email, tokenExpiresAt: { gt: new Date() } },
    include: { studio: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });

  return invites.map((invite) => ({
    type: "ARTIST_INVITE_PENDING",
    title: `${invite.studio.name} invited you to join ${invite.membershipType === "HOME" ? "as their home studio" : "as a guest artist"}`,
    entityType: "ArtistMembershipInvite",
    entityId: invite.id,
    // Folds tokenExpiresAt in, same pattern as ESTIMATE_FOLLOWUP/
    // NEW_CONVERSATION: a resend changes this (new token, new expiry), so
    // a dismissed invite resurfaces after the studio resends it, rather
    // than staying hidden forever because the underlying invite id never
    // changes.
    dismissalKey: `${invite.id}:${invite.tokenExpiresAt.toISOString()}`,
    deepLink: `/artist-invite/${invite.token}`,
    actionableAt: invite.createdAt,
  }));
}

export const artistInvitePendingSource: TaskSource = {
  type: "ARTIST_INVITE_PENDING",
  label: "Studio invites awaiting your response",
  fetch,
};
