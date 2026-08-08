import { Router } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma";
import { JWT_SECRET } from "../lib/jwt";
import { Role } from "../../generated/prisma/enums";
import type { AuthPayload } from "../middleware/auth";
import { optionalAuth } from "../middleware/auth";
import { isExpiredOrInvalidArtistInvite } from "../lib/artistMembershipInvites";
import { logAudit } from "../lib/audit";
import { emitInvalidation } from "../lib/realtime/registry";
import { findResidencyOverlapConflict, residencyOverlapErrorMessage } from "../lib/residencies";
import { ResidencyStatus } from "../../generated/prisma/enums";

const router = Router();

const SALT_ROUNDS = 10;

// Public. Tells the frontend which of the two accept UIs to show: a
// password-setup form for a genuinely new identity, or a "log in to
// accept" form for an existing one. identityExists is a live read, same as
// the accept handler below re-checks it live rather than trusting
// anything decided at invite-creation time.
router.get("/artist-invite/verify/:token", async (req, res) => {
  const token = req.params.token as string;

  const invite = await prisma.artistMembershipInvite.findUnique({
    where: { token },
    include: { studio: { select: { name: true } } },
  });

  const invalidity = isExpiredOrInvalidArtistInvite(invite);
  if (invalidity) {
    const status = invalidity.code === "invalid" ? 404 : 410;
    return res.status(status).json(invalidity);
  }

  const identityExists = (await prisma.user.findUnique({ where: { email: invite!.email }, select: { id: true } })) !== null;

  res.json({
    studioName: invite!.studio.name,
    membershipType: invite!.membershipType,
    email: invite!.email,
    identityExists,
  });
});

// New identity: public, body { password } -- creates the account (User +
// Artist + membership) in one go, same shape as POST /invite/accept/:token
// for a team invite, just with an Artist profile and membership attached
// immediately rather than deferred.
//
// Existing identity: requires the caller to already be authenticated AS
// THAT PERSON (checked via optionalAuth + a live email match, not trusted
// from the invite record) -- there is no password-setup step since they
// already have one. This is the one guard standing between "studio invites
// a real person's email" and "that person's real account gets silently
// modified" -- nothing here ever mutates an existing account without the
// request being authenticated as that exact account.
router.post("/artist-invite/accept/:token", optionalAuth, async (req, res) => {
  const token = req.params.token as string;

  const invite = await prisma.artistMembershipInvite.findUnique({ where: { token } });
  const invalidity = isExpiredOrInvalidArtistInvite(invite);
  if (invalidity) {
    const status = invalidity.code === "invalid" ? 404 : 410;
    return res.status(status).json(invalidity);
  }

  const existingUser = await prisma.user.findUnique({ where: { email: invite!.email } });

  if (!existingUser) {
    const { password } = req.body ?? {};
    if (typeof password !== "string" || password.length < 8) {
      return res.status(400).json({ error: "password must be at least 8 characters" });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    const { user, artist } = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: invite!.email,
          role: Role.ARTIST,
          studioId: invite!.studioId,
          password: passwordHash,
          isActive: true,
          name: invite!.name,
          // Same reasoning as invites.ts's team-invite accept -- clicking
          // this emailed link IS the ownership proof (see
          // User.emailVerifiedAt's own schema comment).
          emailVerifiedAt: new Date(),
        },
      });
      const artist = await tx.artist.create({ data: { userId: user.id, specialties: [], portfolioImages: [] } });
      const membership = await tx.studioMembership.create({
        data: { studioId: invite!.studioId, artistId: artist.id, type: invite!.membershipType, allowsStudioProfileEdits: false },
      });
      // 6a Epic: a brand-new identity's first GUEST stint lands CONFIRMED
      // directly -- accepting the invite IS the artist's consent, per this
      // epic's own design. No overlap check needed here specifically (a
      // brand-new Artist row has zero prior residencies to conflict with
      // by construction), but the shared function is still called for
      // consistency and defense -- see the existing-identity branch below
      // for the case where it can actually fire.
      if (invite!.membershipType === "GUEST" && invite!.residencyStartDate && invite!.residencyEndDate) {
        await tx.residency.create({
          data: {
            membershipId: membership.id,
            artistId: artist.id,
            startDate: invite!.residencyStartDate,
            endDate: invite!.residencyEndDate,
            status: ResidencyStatus.CONFIRMED,
          },
        });
      }
      await tx.artistMembershipInvite.delete({ where: { id: invite!.id } });
      // Part 2 (guest-artist onboarding): a real, skippable-not-blocking
      // nudge on a genuinely new identity's own task list -- createdById
      // set to themselves (not left null/system) so it lands in Tasks.tsx's
      // "My tasks" grouping rather than "Assigned by others", which would
      // read as a colleague assigned it and show "Assigned by a deleted
      // user" once createdBy resolves to nothing. No dueAt -- this is an
      // encouragement, not a deadline.
      await tx.personalTask.create({
        data: {
          studioId: invite!.studioId,
          userId: user.id,
          createdById: user.id,
          title: "Complete your artist profile",
          notes: "Add a bio, your specialties, and a few portfolio pieces so clients and your studio can get to know your work.",
        },
      });
      return { user, artist };
    });

    await logAudit({
      studioId: invite!.studioId,
      actorUserId: user.id,
      entityType: "StudioMembership",
      entityId: artist.id,
      action: "artist_invite_accepted_new_identity",
      changes: { membershipType: invite!.membershipType },
    });

    emitInvalidation({ type: "team.changed", studioId: invite!.studioId });
    emitInvalidation({ type: "artist.changed", studioId: invite!.studioId, artistId: artist.id });
    if (invite!.membershipType === "GUEST") {
      emitInvalidation({ type: "residency.changed", studioId: invite!.studioId, artistId: artist.id });
    }

    const payload: AuthPayload = { userId: user.id, studioId: invite!.studioId, role: Role.ARTIST };
    const jwtToken = jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
    return res.json({ token: jwtToken, membershipType: invite!.membershipType });
  }

  if (!req.user || req.user.userId !== existingUser.id) {
    return res.status(401).json({
      error: `Log in as ${existingUser.email} to accept this invite.`,
      requiresLogin: true,
      email: existingUser.email,
    });
  }

  const oldStudioId = existingUser.studioId;

  // 6a Epic: overlap validation on accept, checked BEFORE the transaction
  // so a conflict is a clean 409 with nothing created, not a rollback.
  // Only meaningful for an EXISTING identity -- they may already have
  // other CONFIRMED residencies to conflict with, unlike a brand-new
  // identity (handled above, where this can never fire).
  if (invite!.membershipType === "GUEST" && invite!.residencyStartDate && invite!.residencyEndDate) {
    const existingArtistForOverlap = await prisma.artist.findUnique({ where: { userId: existingUser.id } });
    if (existingArtistForOverlap) {
      const conflict = await findResidencyOverlapConflict(
        existingArtistForOverlap.id,
        invite!.residencyStartDate,
        invite!.residencyEndDate,
      );
      if (conflict) {
        return res.status(409).json({ error: residencyOverlapErrorMessage(conflict) });
      }
    }
  }

  const { artist, freshToken } = await prisma.$transaction(async (tx) => {
    let artist = await tx.artist.findUnique({ where: { userId: existingUser.id } });
    if (!artist) {
      artist = await tx.artist.create({ data: { userId: existingUser.id, specialties: [], portfolioImages: [] } });
    }

    let freshToken: string | null = null;

    if (invite!.membershipType === "HOME") {
      await tx.user.update({ where: { id: existingUser.id }, data: { studioId: invite!.studioId, role: Role.ARTIST } });
      await tx.studioMembership.updateMany({
        where: { artistId: artist.id, type: "HOME", endedAt: null },
        data: { endedAt: new Date() },
      });
      await tx.studioMembership.create({
        data: { studioId: invite!.studioId, artistId: artist.id, type: "HOME", allowsStudioProfileEdits: false },
      });
      // Same fix as artists.ts's /go-solo route: FlashPiece carries its own
      // independent studioId, so it doesn't follow User.studioId
      // automatically -- without this, existing pieces stay attached to
      // (and visible/manageable at) the studio this artist just left.
      await tx.flashPiece.updateMany({ where: { artistId: artist.id, studioId: oldStudioId }, data: { studioId: invite!.studioId } });
      const payload: AuthPayload = { userId: existingUser.id, studioId: invite!.studioId, role: Role.ARTIST };
      freshToken = jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
    } else {
      // GUEST: purely additive -- existingUser.studioId/role untouched,
      // whatever HOME membership they already have (here or elsewhere) is
      // completely unaffected.
      const membership = await tx.studioMembership.create({
        data: { studioId: invite!.studioId, artistId: artist.id, type: "GUEST", allowsStudioProfileEdits: false },
      });
      // 6a Epic: the first stint, CONFIRMED directly -- accepting the
      // invite IS the consent. Re-checked against the DB-level EXCLUDE
      // constraint too (this create can still throw if the pre-transaction
      // check above raced with another confirmation) -- an unhandled
      // throw here aborts the whole transaction, which is the correct
      // outcome: no membership left behind with no valid residency.
      if (invite!.residencyStartDate && invite!.residencyEndDate) {
        await tx.residency.create({
          data: {
            membershipId: membership.id,
            artistId: artist.id,
            startDate: invite!.residencyStartDate,
            endDate: invite!.residencyEndDate,
            status: ResidencyStatus.CONFIRMED,
          },
        });
      }
    }

    await tx.artistMembershipInvite.delete({ where: { id: invite!.id } });

    return { artist, freshToken };
  });

  await logAudit({
    studioId: invite!.studioId,
    actorUserId: existingUser.id,
    entityType: "StudioMembership",
    entityId: artist.id,
    action: "artist_invite_accepted_existing_identity",
    changes: { membershipType: invite!.membershipType, fromStudioId: invite!.membershipType === "HOME" ? oldStudioId : undefined },
  });

  emitInvalidation({ type: "team.changed", studioId: invite!.studioId });
  emitInvalidation({ type: "artist.changed", studioId: invite!.studioId, artistId: artist.id });
  if (invite!.membershipType === "HOME" && oldStudioId !== invite!.studioId) {
    emitInvalidation({ type: "team.changed", studioId: oldStudioId });
    emitInvalidation({ type: "artist.changed", studioId: oldStudioId, artistId: artist.id });
  }
  if (invite!.membershipType === "GUEST") {
    emitInvalidation({ type: "residency.changed", studioId: invite!.studioId, artistId: artist.id });
  }

  res.json({ token: freshToken, membershipType: invite!.membershipType });
});

export default router;
