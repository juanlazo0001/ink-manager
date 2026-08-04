import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { Role } from "../../generated/prisma/enums";
import { getEffectivePermissions } from "../lib/permissions";
import { validateImageDataUrl } from "../lib/images";
import { normalizePhone } from "../lib/phone";
import { isSoloStudioArtist as isSoloStudioArtistCheck, isSoloStudio as isSoloStudioCheck } from "../lib/soloStudio";
import { logAudit } from "../lib/audit";
import { emitInvalidation } from "../lib/realtime/registry";

const router = Router();

router.use(requireAuth);

// Explicit allowlist (pick the safe fields), not a denylist (spread
// everything then destructure out the unsafe ones) -- the account-
// lifecycle work added several sensitive columns to User (inviteToken,
// passwordResetToken, emailChangeToken, pendingEmail, deactivatedById,
// etc.). A denylist silently leaks any NEW sensitive column a future
// change adds until someone remembers to also exclude it here; an
// allowlist can't leak a column it was never told to include. `password`
// specifically is caught by every call site's own `{ password: _password,
// ...rest }` destructuring before this even runs, but this function no
// longer trusts that as the only line of defense.
export function serializeUser(user: {
  id: string;
  email: string;
  name: string | null;
  phone: string | null;
  avatarUrl: string | null;
  role: Role;
  studioId: string;
  createdAt: Date;
  locationId: string | null;
  isActive: boolean;
  inviteToken: string | null;
  inviteTokenExpiresAt: Date | null;
  deactivatedAt: Date | null;
  deactivatedById: string | null;
  pendingEmail: string | null;
  artist: {
    id: string;
    bio: string | null;
    specialties: string[];
    allowsClientSelfScheduling: boolean;
    memberships: { allowsStudioProfileEdits: boolean }[];
  } | null;
}) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    phone: user.phone,
    avatarUrl: user.avatarUrl,
    role: user.role,
    studioId: user.studioId,
    createdAt: user.createdAt,
    locationId: user.locationId,
    isActive: user.isActive,
    // Derived, not the raw token -- the Team page's pending-invites
    // section needs to know a user is still pending and when that invite
    // expires, never the token itself (that would let anyone who can see
    // the team list activate someone else's invite).
    pending: user.inviteToken != null,
    inviteExpiresAt: user.inviteTokenExpiresAt,
    deactivatedAt: user.deactivatedAt,
    deactivatedById: user.deactivatedById,
    // The new address a change-email request is waiting to be confirmed
    // to -- never the token itself, same reasoning as inviteExpiresAt.
    pendingEmail: user.pendingEmail,
    artist: user.artist ?? undefined,
  };
}

// No :userId param anywhere in this file — every route acts on
// req.user.userId from the verified JWT, so there is no code path that
// could edit or expose another user's account, regardless of role.
router.get("/me", async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.userId },
    // Artist mobility, Part 2: filtered to the CURRENT active HOME row
    // (studioId + endedAt: null), not just type: HOME -- an artist can now
    // have more than one HOME row over their history (Part 1), and an
    // unfiltered lookup could return a stale, ended one from a studio
    // they've since left, picked arbitrarily depending on array order.
    include: {
      artist: {
        select: {
          id: true,
          bio: true,
          specialties: true,
          allowsClientSelfScheduling: true,
          // Every currently-active membership (HOME and any GUEST rows),
          // split into the two response shapes below in code -- Prisma's
          // `select` can't alias one relation field into two differently-
          // filtered response keys, so this fetches everything once
          // (type included) rather than declaring `memberships` twice.
          // The GUEST half is new: previously GET /me only ever surfaced
          // the HOME row, so a guest artist had no way to confirm their
          // own active guest status anywhere except a studio's own Team
          // page. Also backs the per-membership delegation toggle (PATCH
          // /artists/:id/memberships/:membershipId/profile-delegation) --
          // the existing profile-delegation route only ever targets the
          // artist's OWN current session studioId (their HOME studio), so
          // it has no way to delegate access to a studio they're merely
          // guesting at.
          memberships: {
            where: { endedAt: null },
            select: {
              id: true,
              type: true,
              allowsStudioProfileEdits: true,
              createdAt: true,
              studio: { select: { id: true, name: true } },
            },
            orderBy: { createdAt: "asc" },
          },
        },
      },
    },
  });

  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  const allMemberships = user.artist?.memberships ?? [];
  const userWithSplitMemberships = user.artist
    ? {
        ...user,
        artist: {
          ...user.artist,
          // Same shape the frontend already expects (HOME row only,
          // allowsStudioProfileEdits) -- unchanged for every existing
          // caller of profile.artist.memberships.
          memberships: allMemberships
            .filter((m) => m.type === "HOME")
            .map((m) => ({ allowsStudioProfileEdits: m.allowsStudioProfileEdits })),
          guestMemberships: allMemberships
            .filter((m) => m.type === "GUEST")
            .map((m) => ({ id: m.id, allowsStudioProfileEdits: m.allowsStudioProfileEdits, createdAt: m.createdAt, studio: m.studio })),
        },
      }
    : user;

  const { password: _password, ...safeUser } = userWithSplitMemberships;
  const permissions = await getEffectivePermissions(user.studioId, user.role);
  // Solo artist architecture, Phase 3: lets Profile.tsx show the
  // self-scheduling toggle only where it's actually reachable (a solo
  // artist toggling it directly) vs. a plain read-only "ask your studio"
  // note for a multi-person studio's artist. Keyed on having an Artist
  // profile at all, not on role === ARTIST -- a solo studio's first user is
  // commonly OWNER with an Artist profile attached (see soloStudio.ts), and
  // that account needs this exactly as much as a role: ARTIST one does.
  const isSoloStudioArtist = user.artist ? await isSoloStudioArtistCheck(user.studioId, user.id) : false;
  // UI simplification pass: role-agnostic, studio-level (see
  // lib/soloStudio.ts's own comment on why this is a different question
  // from isSoloStudioArtist above) -- drives hiding Team/Conversations'
  // Team tab/the profile-delegation toggle for every role, not just artists.
  const isSoloStudio = await isSoloStudioCheck(user.studioId);
  res.json({ ...serializeUser(safeUser), permissions, isSoloStudioArtist, isSoloStudio });
});

const OPTIONAL_TEXT_FIELDS = ["name", "phone"] as const;

router.patch("/me", async (req, res) => {
  const existing = await prisma.user.findUnique({ where: { id: req.user!.userId } });

  if (!existing) {
    return res.status(404).json({ error: "User not found" });
  }

  const body = req.body ?? {};
  const data: Record<string, string | null> = {};

  for (const field of OPTIONAL_TEXT_FIELDS) {
    if (body[field] === undefined) continue;

    if (body[field] !== null && typeof body[field] !== "string") {
      return res.status(400).json({ error: `${field} must be a string or null` });
    }

    if (field === "phone") {
      data.phone = typeof body.phone === "string" && body.phone.trim() ? normalizePhone(body.phone) : null;
    } else {
      data[field] = typeof body[field] === "string" ? body[field].trim() || null : null;
    }
  }

  if (body.avatarUrl !== undefined) {
    const result = validateImageDataUrl(body.avatarUrl, "avatarUrl");
    if ("error" in result) {
      return res.status(400).json({ error: result.error });
    }
    data.avatarUrl = result.value;
  }

  // Email and password changes moved to their own dedicated, confirmation-
  // gated flows (account-lifecycle work) -- POST /auth/change-email (sends
  // a confirm link to the NEW address, never switches over until that
  // link is used) and POST /auth/change-password (updates
  // passwordChangedAt so existing sessions are invalidated, which this
  // route never did). Both still require currentPassword, same as before;
  // this route is profile-fields-only now. body.email/newPassword/
  // currentPassword are silently ignored here rather than erroring, since
  // Profile.tsx's old combined form no longer sends them, but no other
  // caller of this route needs to be treated as invalid via a leftover key.

  // bio/specialties used to be editable here too (ARTIST role only), but
  // that duplicated the exact same fields PATCH /artists/:id already
  // handles (now self-editable there regardless of studio permissions --
  // see requirePermissionOrSelfArtist) -- confusing to have the same data
  // savable from two different forms on two different pages. Profile.tsx
  // no longer sends bio/specialties here at all; this route is genuinely
  // account-fields-only now (name/phone/avatar).

  const updated = await prisma.user.update({
    where: { id: req.user!.userId },
    data,
    // Filtered to the CURRENT active HOME row (endedAt: null), not just
    // type: HOME -- same fix already applied to GET /me just above and to
    // artists.ts/studios.ts's own equivalent includes (artist mobility
    // Part 2 and its follow-up) -- missed here until now.
    include: { artist: { select: { id: true, bio: true, specialties: true, allowsClientSelfScheduling: true, memberships: { where: { type: "HOME", endedAt: null }, select: { allowsStudioProfileEdits: true } } } } },
  });

  const { password: _password, ...safeUser } = updated;
  const permissions = await getEffectivePermissions(updated.studioId, updated.role);
  res.json({ ...serializeUser(safeUser), permissions });
});

// Part 3: artist self-deletion (extended later to solo owner-artists too,
// see isEligible below). Self only -- there is no studioId/userId param,
// always "whoever's token this is." Never reachable from any studio/staff-
// facing route (see Part 4's own adversarial confirmation that no such
// path exists) -- a studio can remove an artist's MEMBERSHIP (POST
// /studios/:studioId/artists/:artistId/remove), never their account.
//
// Anonymize-in-place, not a cascade delete: the User/Artist rows are never
// removed, only scrubbed, so every historical FK a real Appointment/
// Inquiry/GiftCard/AuditLog/etc. already holds keeps resolving to a real
// row instead of a dangling or nulled-out one -- same "preserve history,
// only change access" principle deactivation and go-solo/studio-departure
// already use elsewhere in this app, just permanent and personal-data-
// scrubbing rather than just an access flag.
router.post("/me/delete-account", async (req, res) => {
  const { confirm } = req.body ?? {};

  if (confirm !== "DELETE") {
    return res.status(400).json({ error: 'Type "DELETE" to confirm this action.' });
  }

  const userId = req.user!.userId;

  // A solo owner-artist (go-solo's own studio, or any studio that has
  // simply shrunk to just them) is functionally identical to a plain
  // ARTIST here -- there's no other staff whose access this could disrupt,
  // and no one left to run the studio for. Any other OWNER (one with
  // active colleagues) is deliberately excluded: that's "delete my
  // business," a materially bigger and more dangerous action than
  // "delete my own artist account," and not what this route does.
  const isEligible =
    req.user!.role === Role.ARTIST ||
    (req.user!.role === Role.OWNER && (await isSoloStudioArtistCheck(req.user!.studioId, userId)));
  if (!isEligible) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const artist = await prisma.artist.findUnique({ where: { userId }, select: { id: true } });
  if (!artist) {
    return res.status(404).json({ error: "Artist profile not found" });
  }

  // Every studio this artist has ever had an ACTIVE membership at -- not
  // just their current studioId, since a real GUEST membership elsewhere
  // is exactly as real and needs to be ended and its studio notified too.
  const activeMemberships = await prisma.studioMembership.findMany({
    where: { artistId: artist.id, endedAt: null },
    select: { studioId: true },
  });
  const affectedStudioIds = [...new Set(activeMemberships.map((m) => m.studioId))];

  // Flash pieces: genuinely no history (never appeared in any real
  // client Inquiry) are safe to remove outright, same as the staff
  // hard-delete route's own "no history = safe to fully remove"
  // reasoning. A piece with real inquiry history is retired instead
  // (RETIRED already exists for exactly this -- "manually pulled from
  // the gallery" -- see FlashPieceStatus's own comment) rather than
  // destroyed, so the studio's own historical record of what was
  // requested/booked from it survives intact.
  const flashPieces = await prisma.flashPiece.findMany({
    where: { artistId: artist.id },
    select: { id: true, _count: { select: { inquiries: true } } },
  });
  const flashPieceIdsToDelete = flashPieces.filter((p) => p._count.inquiries === 0).map((p) => p.id);
  const flashPieceIdsToRetire = flashPieces.filter((p) => p._count.inquiries > 0).map((p) => p.id);

  await prisma.$transaction(async (tx) => {
    if (activeMemberships.length > 0) {
      await tx.studioMembership.updateMany({
        where: { artistId: artist.id, endedAt: null },
        data: { endedAt: new Date() },
      });
    }

    if (flashPieceIdsToDelete.length > 0) {
      await tx.flashPiece.deleteMany({ where: { id: { in: flashPieceIdsToDelete } } });
    }
    if (flashPieceIdsToRetire.length > 0) {
      await tx.flashPiece.updateMany({ where: { id: { in: flashPieceIdsToRetire } }, data: { status: "RETIRED" } });
    }

    // Personal profile content -- exactly what item 1's task description
    // calls out: bio, portfolio, and (via flash pieces above) their own
    // gallery. Social links included as the same category of personal
    // content. Rates/scheduling-buffer/services stay untouched -- not
    // personal data, and moot the moment every membership above ends.
    await tx.artist.update({
      where: { id: artist.id },
      data: {
        bio: null,
        specialties: [],
        portfolioImages: [],
        instagramHandle: null,
        facebookProfileUrl: null,
      },
    });

    // Login credentials + email, permanently. The synthetic email is
    // unique-safe (userId is unique) and frees the real address for reuse
    // -- someone signing up again with it later finds no trace it was
    // ever taken. password: null makes login mathematically impossible
    // (bcrypt.compare against a real hash never matches null), isActive:
    // false is the same authority every other login/session check in this
    // app already keys off, and every outstanding token is cleared so
    // none of the account's three separate token-based flows (invite,
    // password reset, email change) can be used to claw back in.
    await tx.user.update({
      where: { id: userId },
      data: {
        email: `deleted-${userId}@deleted.inkmanager.invalid`,
        name: "Deleted User",
        phone: null,
        avatarUrl: null,
        password: null,
        isActive: false,
        deletedAt: new Date(),
        inviteToken: null,
        inviteTokenExpiresAt: null,
        passwordResetToken: null,
        passwordResetTokenExpiresAt: null,
        pendingEmail: null,
        emailChangeToken: null,
        emailChangeTokenExpiresAt: null,
      },
    });
  });

  await logAudit({
    studioId: req.user!.studioId,
    actorUserId: userId,
    entityType: "User",
    entityId: userId,
    action: "self_deleted_account",
    changes: { affectedStudioIds, flashPiecesDeleted: flashPieceIdsToDelete.length, flashPiecesRetired: flashPieceIdsToRetire.length },
  });

  for (const studioId of affectedStudioIds) {
    emitInvalidation({ type: "team.changed", studioId });
    emitInvalidation({ type: "artist.changed", studioId, artistId: artist.id });
  }

  res.json({ success: true });
});

export default router;
