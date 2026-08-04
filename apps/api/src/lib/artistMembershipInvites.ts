import crypto from "node:crypto";
import { prisma } from "./prisma";
import { PUBLIC_APP_URL } from "./publicUrl";
import { sendPlatformEmail } from "./platformEmail";
import { renderPlatformEmailHtml } from "./emailTemplate";
import { emitUserInvalidation } from "./realtime/registry";
import type { StudioMembershipType } from "../../generated/prisma/enums";

export const ARTIST_INVITE_TOKEN_TTL_DAYS = 7;

function sendArtistInviteEmail(params: { inviteId: string; email: string; studioName: string; membershipType: StudioMembershipType; token: string }) {
  const { inviteId, email, studioName, membershipType, token } = params;
  const inviteUrl = `${PUBLIC_APP_URL}/artist-invite/${token}`;
  const membershipLabel = membershipType === "HOME" ? "as their home studio" : "as a guest artist";
  sendPlatformEmail({
    to: email,
    subject: `You've been invited to join ${studioName} on Ink Manager`,
    text: `You've been invited to join ${studioName} on Ink Manager ${membershipLabel}. Accept here: ${inviteUrl}\n\nThis link expires in ${ARTIST_INVITE_TOKEN_TTL_DAYS} days.`,
    html: renderPlatformEmailHtml({
      heading: "You've been invited",
      bodyParagraphs: [`You've been invited to join ${studioName} on Ink Manager ${membershipLabel}. Click the button below to accept.`],
      buttonText: "Accept invite",
      buttonUrl: inviteUrl,
      footnote: `This link expires in ${ARTIST_INVITE_TOKEN_TTL_DAYS} days.`,
    }),
  }).catch((err) => {
    console.error("Failed to send artist invite email", { inviteId, err });
  });
}

// If the target email already belongs to a real account, push a live
// "tasks" refresh to their own session -- the same query key
// tasksQueryKey(userId) resolves to on the frontend -- so the new pending
// invite (surfaced by lib/tasks/artistInvitePending.ts) appears on their
// Tasks page immediately if they happen to have it open, not just on their
// next natural navigation there. A brand-new identity has no account (and
// therefore no socket) to push to -- this is a no-op for that case, not an
// error, since email is the only discovery path that can exist for them.
async function notifyExistingIdentity(email: string) {
  const existingUser = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existingUser) {
    emitUserInvalidation(existingUser.id, [["tasks", existingUser.id]]);
  }
}

// Artist mobility, Part 2: studio-initiated invite specifically for an
// Artist membership. Deliberately never touches User/Artist at creation
// time -- whether the target email belongs to a brand-new or an existing
// identity is only ever resolved once, live, at accept time (see
// routes/artistInvites.ts's accept handler) so nothing here can go stale
// or drift from what's actually true when the person clicks the link days
// later.
export async function createArtistMembershipInvite(params: {
  studioId: string;
  studioName: string;
  email: string;
  membershipType: StudioMembershipType;
}) {
  const { studioId, studioName, email, membershipType } = params;

  const token = crypto.randomBytes(32).toString("hex");
  const tokenExpiresAt = new Date(Date.now() + ARTIST_INVITE_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

  const invite = await prisma.artistMembershipInvite.create({
    data: { studioId, email, membershipType, token, tokenExpiresAt },
  });

  sendArtistInviteEmail({ inviteId: invite.id, email, studioName, membershipType, token });
  notifyExistingIdentity(email).catch((err) => console.error("Failed to notify existing identity of new artist invite", { email, err }));

  return invite;
}

// Same "invalidated by construction" shape as the regular team-invite
// resend (routes/studios.ts): overwriting the token outright means a
// follow-up request with the stale one simply finds no matching row,
// rather than needing a separate revocation step.
export async function resendArtistMembershipInvite(params: { inviteId: string; email: string; studioName: string; membershipType: StudioMembershipType }) {
  const { inviteId, email, studioName, membershipType } = params;

  const token = crypto.randomBytes(32).toString("hex");
  const tokenExpiresAt = new Date(Date.now() + ARTIST_INVITE_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

  await prisma.artistMembershipInvite.update({ where: { id: inviteId }, data: { token, tokenExpiresAt } });

  sendArtistInviteEmail({ inviteId, email, studioName, membershipType, token });
  notifyExistingIdentity(email).catch((err) => console.error("Failed to notify existing identity of resent artist invite", { email, err }));
}

export function isExpiredOrInvalidArtistInvite(invite: { tokenExpiresAt: Date } | null) {
  if (!invite) {
    return { code: "invalid", error: "This invite link is invalid." } as const;
  }
  if (invite.tokenExpiresAt < new Date()) {
    return { code: "expired", error: "This invite link has expired. Ask the studio to resend it." } as const;
  }
  return null;
}
