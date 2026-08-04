import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import type { Role } from "../../generated/prisma/enums";
import { getEffectivePermissions } from "../lib/permissions";
import { validateImageDataUrl } from "../lib/images";
import { normalizePhone } from "../lib/phone";
import { isSoloStudioArtist as isSoloStudioArtistCheck, isSoloStudio as isSoloStudioCheck } from "../lib/soloStudio";

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
          memberships: { where: { type: "HOME", endedAt: null }, select: { allowsStudioProfileEdits: true } },
        },
      },
    },
  });

  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  const { password: _password, ...safeUser } = user;
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

export default router;
