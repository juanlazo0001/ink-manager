import { Router } from "express";
import crypto from "node:crypto";
import bcrypt from "bcrypt";
import { prisma } from "../lib/prisma";
import { requireAuth, requireRole } from "../middleware/auth";
import { BOOTSTRAP_SECRET } from "../lib/bootstrapSecret";
import { Role } from "../../generated/prisma/enums";
import { Prisma } from "../../generated/prisma/client";
import type { RolePermission } from "../../generated/prisma/client";
import { serializeUser } from "./users";
import { CONFIGURABLE_ROLES, DEFAULT_ROLE_PERMISSIONS, PERMISSION_KEYS, requirePermission } from "../lib/permissions";
import type { PermissionKey } from "../lib/permissions";
import { validateImageDataUrl } from "../lib/images";
import { diffObjects, logAudit } from "../lib/audit";
import { normalizePhone } from "../lib/phone";
import { isStringArray, isValidDateOrNull, isValidPreferredSchedule } from "../lib/artistValidation";
import { slugify } from "../lib/slug";
import { PUBLIC_APP_URL } from "../lib/publicUrl";
import { sendPlatformEmail } from "../lib/platformEmail";
import { renderPlatformEmailHtml } from "../lib/emailTemplate";
import { emitInvalidation } from "../lib/realtime/registry";
import { createArtistMembershipInvite, resendArtistMembershipInvite } from "../lib/artistMembershipInvites";

const router = Router();

const SALT_ROUNDS = 10;

// CUSTOMER is not a real staff role -- no CUSTOMER-role user can ever
// authenticate into any staff route (confirmed during the View As
// permissions audit). Team member create/update accepts a role for a
// person who logs into the studio portal, so it validates against this
// list rather than every Role enum value. CONFIGURABLE_ROLES (lib/
// permissions.ts) intentionally still includes CUSTOMER -- that's the
// separate Permissions-matrix tab, unrelated to who can be a team member.
const STAFF_ROLES = [Role.OWNER, Role.FRONT_DESK, Role.ARTIST] as const;

// Generates a unique, stable public slug for a new studio's intake-form URL
// (/inquiry/:studioSlug). Appends -2, -3, ... on collision; never reused
// once assigned, since studio links get shared publicly.
export async function generateUniqueSlug(name: string): Promise<string> {
  const base = slugify(name) || "studio";
  let candidate = base;
  let suffix = 2;

  while (await prisma.studio.findUnique({ where: { slug: candidate } })) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }

  return candidate;
}

// Manual-use only: creates a Studio and its first OWNER together. Never expose
// this as a public signup flow — it's gated by BOOTSTRAP_SECRET, not real auth.
router.post("/bootstrap", async (req, res) => {
  const bootstrapSecret = req.header("X-Bootstrap-Secret");

  if (!bootstrapSecret || bootstrapSecret !== BOOTSTRAP_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const body = req.body ?? {};
  const missing = ["studioName", "ownerEmail", "ownerPassword"].filter((field) => !body[field]);
  if (missing.length > 0) {
    return res.status(400).json({ error: `Missing required field(s): ${missing.join(", ")}` });
  }

  const { studioName, ownerEmail, ownerPassword } = body;
  const passwordHash = await bcrypt.hash(ownerPassword, SALT_ROUNDS);
  const slug = await generateUniqueSlug(studioName);

  const { studio, owner } = await prisma.$transaction(async (tx) => {
    const studio = await tx.studio.create({ data: { name: studioName, slug } });
    const owner = await tx.user.create({
      data: { email: ownerEmail, password: passwordHash, role: Role.OWNER, studioId: studio.id },
    });
    return { studio, owner };
  });

  const { password: _password, ...ownerWithoutPassword } = owner;
  res.status(201).json({ studio, owner: ownerWithoutPassword });
});

// Any authenticated studio member can read studio info (name/logo are shown
// to everyone in the portal chrome); only OWNER can change it, below.
router.get("/:studioId", requireAuth, async (req, res) => {
  const studioId = req.params.studioId as string;

  if (studioId !== req.user!.studioId) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const studio = await prisma.studio.findUnique({ where: { id: studioId } });

  if (!studio) {
    return res.status(404).json({ error: "Studio not found" });
  }

  res.json(studio);
});

// Plain optional text fields an OWNER can set on their studio profile. Each
// is nullable; an empty string clears the field back to null.
const OPTIONAL_TEXT_FIELDS = ["website"] as const;

// Studio profile editing is a configurable permission (see lib/permissions)
// — OWNER always has it; other roles depend on the studio's matrix.
// logoUrl is either a base64 data URL (new/changed logo) or null (remove).
router.patch("/:studioId", requireAuth, requirePermission("studio.manage"), async (req, res) => {
  const studioId = req.params.studioId as string;

  if (studioId !== req.user!.studioId) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const body = req.body ?? {};
  const data: Record<string, string | null> = {};

  if (body.name !== undefined) {
    if (typeof body.name !== "string" || body.name.trim().length === 0) {
      return res.status(400).json({ error: "name must be a non-empty string" });
    }
    data.name = body.name.trim();
  }

  for (const field of OPTIONAL_TEXT_FIELDS) {
    if (body[field] === undefined) continue;

    if (body[field] !== null && typeof body[field] !== "string") {
      return res.status(400).json({ error: `${field} must be a string or null` });
    }

    data[field] = typeof body[field] === "string" ? body[field].trim() || null : null;
  }

  if (body.logoUrl !== undefined) {
    const result = validateImageDataUrl(body.logoUrl, "logoUrl");
    if ("error" in result) {
      return res.status(400).json({ error: result.error });
    }
    data.logoUrl = result.value;
  }

  const studio = await prisma.studio.update({ where: { id: studioId }, data });
  res.json(studio);
});

// The only way to add staff (front desk, artists, additional owners) going
// forward. An OWNER can only create users within their own studio.
router.post("/:studioId/users", requireAuth, requirePermission("team.manage"), async (req, res) => {
  const studioId = req.params.studioId as string;

  if (studioId !== req.user!.studioId) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const body = req.body ?? {};
  const missing = ["email", "password", "role"].filter((field) => !body[field]);
  if (missing.length > 0) {
    return res.status(400).json({ error: `Missing required field(s): ${missing.join(", ")}` });
  }

  const { email, password, role, name, phone } = body;

  if (!STAFF_ROLES.includes(role)) {
    return res.status(400).json({ error: `role must be one of: ${STAFF_ROLES.join(", ")}` });
  }

  let avatarUrl: string | null = null;
  if (body.avatarUrl !== undefined) {
    const result = validateImageDataUrl(body.avatarUrl, "avatarUrl");
    if ("error" in result) {
      return res.status(400).json({ error: result.error });
    }
    avatarUrl = result.value;
  }

  if (body.locationId !== undefined && body.locationId !== null && typeof body.locationId !== "string") {
    return res.status(400).json({ error: "locationId must be a string or null" });
  }
  if (body.locationId) {
    const location = await prisma.location.findUnique({ where: { id: body.locationId } });
    if (!location || location.studioId !== studioId) {
      return res.status(400).json({ error: "locationId must belong to your studio" });
    }
  }

  // The comprehensive artist-creation page collects the full profile up
  // front (bio, specialties, portfolio, social links, preferred schedule,
  // guest window) rather than the bare name/email/password this endpoint
  // used to accept -- all optional, and only meaningful when role is
  // ARTIST, but validated here (not just silently accepted) since they end
  // up in the same all-or-nothing transaction as the User/Artist rows
  // below. This closes the gap that used to force a series of separate
  // PATCH calls after creation to fill in a new artist's profile, each one
  // a place a partial, half-configured account could be left behind.
  const {
    bio,
    specialties,
    portfolioImages,
    instagramHandle,
    facebookProfileUrl,
    preferredSchedule,
    isGuest,
    guestStartDate,
    guestEndDate,
  } = body;

  if (bio !== undefined && bio !== null && typeof bio !== "string") {
    return res.status(400).json({ error: "bio must be a string or null" });
  }
  if (specialties !== undefined && !isStringArray(specialties)) {
    return res.status(400).json({ error: "specialties must be an array of strings" });
  }
  if (portfolioImages !== undefined && !isStringArray(portfolioImages)) {
    return res.status(400).json({ error: "portfolioImages must be an array of strings" });
  }
  if (instagramHandle !== undefined && instagramHandle !== null && typeof instagramHandle !== "string") {
    return res.status(400).json({ error: "instagramHandle must be a string or null" });
  }
  if (facebookProfileUrl !== undefined && facebookProfileUrl !== null && typeof facebookProfileUrl !== "string") {
    return res.status(400).json({ error: "facebookProfileUrl must be a string or null" });
  }
  if (preferredSchedule !== undefined && preferredSchedule !== null && !isValidPreferredSchedule(preferredSchedule)) {
    return res.status(400).json({
      error: "preferredSchedule must be null or an array of { dayOfWeek: 0-6, startTime: 'HH:MM', endTime: 'HH:MM' }",
    });
  }
  if (isGuest !== undefined && typeof isGuest !== "boolean") {
    return res.status(400).json({ error: "isGuest must be a boolean" });
  }
  if (guestStartDate !== undefined && !isValidDateOrNull(guestStartDate)) {
    return res.status(400).json({ error: "guestStartDate must be a valid date or null" });
  }
  if (guestEndDate !== undefined && !isValidDateOrNull(guestEndDate)) {
    return res.status(400).json({ error: "guestEndDate must be a valid date or null" });
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  // An ARTIST-role account always gets an Artist profile in the same
  // transaction it's created in, so the Team and Artists pages never fall
  // out of sync with each other -- and now that profile can arrive fully
  // populated, not just an empty shell waiting on follow-up edits.
  let createdArtistId: string | null = null;

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        email,
        password: passwordHash,
        role,
        studioId,
        avatarUrl,
        name: name || null,
        phone: phone ? normalizePhone(phone) : null,
        locationId: body.locationId || null,
      },
    });

    if (role === Role.ARTIST) {
      const artist = await tx.artist.create({
        data: {
          userId: created.id,
          bio: bio?.trim() || null,
          specialties: specialties ?? [],
          portfolioImages: portfolioImages ?? [],
          instagramHandle: instagramHandle?.trim().replace(/^@/, "") || null,
          facebookProfileUrl: facebookProfileUrl?.trim() || null,
          preferredSchedule: preferredSchedule ?? undefined,
          isGuest: isGuest ?? false,
          guestStartDate: guestStartDate ? new Date(guestStartDate) : null,
          guestEndDate: guestEndDate ? new Date(guestEndDate) : null,
        },
      });
      createdArtistId = artist.id;
    }

    return tx.user.findUniqueOrThrow({ where: { id: created.id }, include: USER_INCLUDE_ARTIST });
  });

  await logAudit({
    studioId,
    actorUserId: req.user!.userId,
    entityType: "User",
    entityId: user.id,
    action: "create",
    changes: { email, role, name: name || null },
  });

  emitInvalidation({ type: "team.changed", studioId });
  if (createdArtistId) {
    emitInvalidation({ type: "artist.changed", studioId, artistId: createdArtistId });
  }

  res.status(201).json(serializeUser(user));
});

export const INVITE_TOKEN_TTL_DAYS = 7;

export function inviteEmailContent(studioName: string, inviteUrl: string) {
  return {
    subject: `You've been invited to join ${studioName} on Ink Manager`,
    text: `You've been invited to join ${studioName} on Ink Manager. Set up your account here: ${inviteUrl}\n\nThis link expires in ${INVITE_TOKEN_TTL_DAYS} days.`,
    html: renderPlatformEmailHtml({
      heading: "You've been invited",
      bodyParagraphs: [`You've been invited to join ${studioName} on Ink Manager. Click the button below to set up your account.`],
      buttonText: "Set up your account",
      buttonUrl: inviteUrl,
      footnote: `This link expires in ${INVITE_TOKEN_TTL_DAYS} days.`,
    }),
  };
}

// Team account lifecycle: invite a teammate to an EXISTING studio (never
// public signup -- that's explicitly out of scope for this feature). A
// pending invite is a real User row from the moment this creates it (so it
// can carry a role/studio/token and show up in the Team page's own
// pending-invites section), just with no password yet -- see the schema
// comment on User.password for why that column is nullable. Distinct from
// POST /:studioId/users just above: that route is an admin directly
// setting someone's password (kept as-is, still useful e.g. for an owner
// handing over a printed credential in person); this route never learns
// the invitee's password at all, which is the point of an invite flow.
router.post("/:studioId/invites", requireAuth, requirePermission("team.manage"), async (req, res) => {
  const studioId = req.params.studioId as string;

  if (studioId !== req.user!.studioId) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const body = req.body ?? {};
  const { email, role, name, phone, membershipType } = body;

  if (!email || typeof email !== "string") {
    return res.status(400).json({ error: "email is required" });
  }
  if (!STAFF_ROLES.includes(role)) {
    return res.status(400).json({ error: `role must be one of: ${STAFF_ROLES.join(", ")}` });
  }
  if (phone !== undefined && phone !== null && typeof phone !== "string") {
    return res.status(400).json({ error: "phone must be a string or null" });
  }

  const trimmedEmail = email.trim();

  // Artist mobility, Part 2: an Artist invite is a completely separate
  // mechanism from here down -- see lib/artistMembershipInvites.ts's own
  // comment for why (it needs to support inviting an email that already
  // belongs to a real account, which this route's User-pending-row
  // approach below fundamentally can't: User.email is unique, so there's
  // no second row to create). The studio picks HOME or GUEST; the
  // new-identity-vs-existing-identity resolution happens once, at accept,
  // never here.
  if (role === Role.ARTIST) {
    if (membershipType !== "HOME" && membershipType !== "GUEST") {
      return res.status(400).json({ error: "membershipType must be HOME or GUEST when inviting an Artist" });
    }

    const studioForInvite = await prisma.studio.findUniqueOrThrow({ where: { id: studioId }, select: { name: true } });
    const invite = await createArtistMembershipInvite({
      studioId,
      studioName: studioForInvite.name,
      email: trimmedEmail,
      membershipType,
    });

    await logAudit({
      studioId,
      actorUserId: req.user!.userId,
      entityType: "ArtistMembershipInvite",
      entityId: invite.id,
      action: "invite_sent",
      changes: { email: trimmedEmail, membershipType },
    });

    emitInvalidation({ type: "team.changed", studioId });

    return res.status(201).json({
      id: invite.id,
      email: invite.email,
      membershipType: invite.membershipType,
      tokenExpiresAt: invite.tokenExpiresAt,
    });
  }

  const existing = await prisma.user.findUnique({ where: { email: trimmedEmail } });
  if (existing) {
    return res.status(409).json({ error: "A user with that email already exists." });
  }

  const studio = await prisma.studio.findUniqueOrThrow({ where: { id: studioId }, select: { name: true } });
  const inviteToken = crypto.randomBytes(32).toString("hex");
  const inviteTokenExpiresAt = new Date(Date.now() + INVITE_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

  // role is OWNER or FRONT_DESK here -- ARTIST already returned above via
  // the separate ArtistMembershipInvite path, so this never needs its own
  // Artist-profile-creation branch the way POST /:studioId/users still
  // does for a directly-created ARTIST-role user.
  const invited = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        email: trimmedEmail,
        role,
        studioId,
        name: typeof name === "string" && name.trim() ? name.trim() : null,
        phone: typeof phone === "string" && phone.trim() ? normalizePhone(phone) : null,
        password: null,
        inviteToken,
        inviteTokenExpiresAt,
      },
    });

    return tx.user.findUniqueOrThrow({ where: { id: created.id }, include: USER_INCLUDE_ARTIST });
  });

  await logAudit({
    studioId,
    actorUserId: req.user!.userId,
    entityType: "User",
    entityId: invited.id,
    action: "invite_sent",
    changes: { email: trimmedEmail, role },
  });

  const inviteUrl = `${PUBLIC_APP_URL}/invite/${inviteToken}`;
  sendPlatformEmail({ to: trimmedEmail, ...inviteEmailContent(studio.name, inviteUrl) }).catch((err) => {
    console.error("Failed to send invite email", { userId: invited.id, err });
  });

  emitInvalidation({ type: "team.changed", studioId });

  res.status(201).json(serializeUser(invited));
});

// Regenerates the token (invalidating the old one outright -- it's simply
// overwritten, so a follow-up request with the stale token finds no
// matching row) and re-sends. Only valid for a still-pending invite --
// resending to an already-activated or deactivated account isn't a
// meaningful action and would be a confusing way to reset either of those.
router.post("/:studioId/invites/:userId/resend", requireAuth, requirePermission("team.manage"), async (req, res) => {
  const studioId = req.params.studioId as string;
  const userId = req.params.userId as string;

  if (studioId !== req.user!.studioId) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const existing = await loadStudioUser(studioId, userId);
  if (!existing || !existing.inviteToken) {
    return res.status(404).json({ error: "No pending invite found for that user." });
  }

  const studio = await prisma.studio.findUniqueOrThrow({ where: { id: studioId }, select: { name: true } });
  const inviteToken = crypto.randomBytes(32).toString("hex");
  const inviteTokenExpiresAt = new Date(Date.now() + INVITE_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

  await prisma.user.update({ where: { id: userId }, data: { inviteToken, inviteTokenExpiresAt } });

  await logAudit({
    studioId,
    actorUserId: req.user!.userId,
    entityType: "User",
    entityId: userId,
    action: "invite_resent",
    changes: { email: existing.email },
  });

  const inviteUrl = `${PUBLIC_APP_URL}/invite/${inviteToken}`;
  sendPlatformEmail({ to: existing.email, ...inviteEmailContent(studio.name, inviteUrl) }).catch((err) => {
    console.error("Failed to send invite email", { userId, err });
  });

  res.json({ message: "Invite resent." });
});

// Cancel: the invitee never had a real account (no password was ever
// set), so this deletes the row outright rather than deactivating it --
// nothing about a pending invite is worth preserving the way an actual
// staff member's history is. Also only valid for a still-pending invite,
// same reasoning as resend above (an active account is deactivated, not
// "cancelled").
router.delete("/:studioId/invites/:userId", requireAuth, requirePermission("team.manage"), async (req, res) => {
  const studioId = req.params.studioId as string;
  const userId = req.params.userId as string;

  if (studioId !== req.user!.studioId) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const existing = await loadStudioUser(studioId, userId);
  if (!existing || !existing.inviteToken) {
    return res.status(404).json({ error: "No pending invite found for that user." });
  }

  await logAudit({
    studioId,
    actorUserId: req.user!.userId,
    entityType: "User",
    entityId: userId,
    action: "invite_cancelled",
    changes: { email: existing.email },
  });

  await prisma.user.delete({ where: { id: userId } });

  emitInvalidation({ type: "team.changed", studioId });

  res.status(204).send();
});

// Artist mobility, Part 2 left this genuinely invisible to staff once
// sent: ArtistMembershipInvite is deliberately decoupled from User (see
// that model's own schema comment), so it never showed up in the regular
// invite list above, which only ever queried pending User rows. Same
// three actions (list/resend/cancel) as the regular team-invite flow,
// just against the separate table.
router.get("/:studioId/artist-invites", requireAuth, requirePermission("team.manage"), async (req, res) => {
  const studioId = req.params.studioId as string;

  if (studioId !== req.user!.studioId) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const invites = await prisma.artistMembershipInvite.findMany({
    where: { studioId },
    orderBy: { createdAt: "asc" },
  });

  res.json(invites);
});

router.post("/:studioId/artist-invites/:inviteId/resend", requireAuth, requirePermission("team.manage"), async (req, res) => {
  const studioId = req.params.studioId as string;
  const inviteId = req.params.inviteId as string;

  if (studioId !== req.user!.studioId) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const existing = await prisma.artistMembershipInvite.findUnique({ where: { id: inviteId } });
  if (!existing || existing.studioId !== studioId) {
    return res.status(404).json({ error: "No pending invite found." });
  }

  const studio = await prisma.studio.findUniqueOrThrow({ where: { id: studioId }, select: { name: true } });
  await resendArtistMembershipInvite({
    inviteId,
    email: existing.email,
    studioName: studio.name,
    membershipType: existing.membershipType,
  });

  await logAudit({
    studioId,
    actorUserId: req.user!.userId,
    entityType: "ArtistMembershipInvite",
    entityId: inviteId,
    action: "invite_resent",
    changes: { email: existing.email },
  });

  res.json({ message: "Invite resent." });
});

router.delete("/:studioId/artist-invites/:inviteId", requireAuth, requirePermission("team.manage"), async (req, res) => {
  const studioId = req.params.studioId as string;
  const inviteId = req.params.inviteId as string;

  if (studioId !== req.user!.studioId) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const existing = await prisma.artistMembershipInvite.findUnique({ where: { id: inviteId } });
  if (!existing || existing.studioId !== studioId) {
    return res.status(404).json({ error: "No pending invite found." });
  }

  await logAudit({
    studioId,
    actorUserId: req.user!.userId,
    entityType: "ArtistMembershipInvite",
    entityId: inviteId,
    action: "invite_cancelled",
    changes: { email: existing.email },
  });

  await prisma.artistMembershipInvite.delete({ where: { id: inviteId } });

  emitInvalidation({ type: "team.changed", studioId });

  res.status(204).send();
});

const USER_INCLUDE_ARTIST = {
  artist: {
    select: {
      id: true,
      bio: true,
      specialties: true,
      allowsClientSelfScheduling: true,
      // Artist mobility, Part 2's own bug fix (GET /me, artists.ts) missed
      // this call site -- filtered to the CURRENT active HOME row, not
      // just type: HOME, for the same reason: an artist with more than one
      // HOME over their history would otherwise return an arbitrary one.
      memberships: { where: { type: "HOME", endedAt: null }, select: { allowsStudioProfileEdits: true } },
    },
  },
} as const;
type UserWithArtist = Prisma.UserGetPayload<{ include: typeof USER_INCLUDE_ARTIST }>;

// Admin-only staff directory. Unlike studio/location info (readable by any
// studio member), this lists every user's email/phone — OWNER only.
router.get("/:studioId/users", requireAuth, requirePermission("team.manage"), async (req, res) => {
  const studioId = req.params.studioId as string;

  if (studioId !== req.user!.studioId) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const users = await prisma.user.findMany({
    where: { studioId },
    orderBy: { createdAt: "asc" },
    include: USER_INCLUDE_ARTIST,
  });

  res.json(
    users.map((user: UserWithArtist) => {
      const { password: _password, ...safeUser } = user;
      return serializeUser(safeUser);
    }),
  );
});

async function loadStudioUser(studioId: string, userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  return user && user.studioId === studioId ? user : null;
}

const ADMIN_USER_TEXT_FIELDS = ["name", "phone"] as const;

// OWNER can edit any user in their studio: role, active status, basic
// profile fields, and can reset a password directly (no current password
// needed — this is admin authority over the studio, not self-service).
router.patch("/:studioId/users/:userId", requireAuth, requirePermission("team.manage"), async (req, res) => {
  const studioId = req.params.studioId as string;
  const userId = req.params.userId as string;

  if (studioId !== req.user!.studioId) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const existing = await loadStudioUser(studioId, userId);
  if (!existing) {
    return res.status(404).json({ error: "User not found" });
  }

  const body = req.body ?? {};
  const data: Record<string, string | boolean | null> = {};

  for (const field of ADMIN_USER_TEXT_FIELDS) {
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

  if (body.email !== undefined) {
    if (typeof body.email !== "string" || body.email.trim().length === 0) {
      return res.status(400).json({ error: "email must be a non-empty string" });
    }
    data.email = body.email.trim();
  }

  if (body.role !== undefined && !STAFF_ROLES.includes(body.role)) {
    return res.status(400).json({ error: `role must be one of: ${STAFF_ROLES.join(", ")}` });
  }

  if (body.isActive !== undefined && typeof body.isActive !== "boolean") {
    return res.status(400).json({ error: "isActive must be a boolean" });
  }

  if (body.avatarUrl !== undefined) {
    const result = validateImageDataUrl(body.avatarUrl, "avatarUrl");
    if ("error" in result) {
      return res.status(400).json({ error: result.error });
    }
    data.avatarUrl = result.value;
  }

  if (body.locationId !== undefined) {
    if (body.locationId !== null && typeof body.locationId !== "string") {
      return res.status(400).json({ error: "locationId must be a string or null" });
    }

    if (body.locationId !== null) {
      const location = await prisma.location.findUnique({ where: { id: body.locationId } });
      if (!location || location.studioId !== studioId) {
        return res.status(400).json({ error: "locationId must belong to your studio" });
      }
    }

    data.locationId = body.locationId;
  }

  // A studio can never be left without at least one active owner. If this
  // user currently is one and the update would take that away (role change
  // off OWNER, or deactivation), there must be another active owner.
  const staysActiveOwner = (body.role ?? existing.role) === Role.OWNER && (body.isActive ?? existing.isActive);
  const currentlyActiveOwner = existing.role === Role.OWNER && existing.isActive;

  if (currentlyActiveOwner && !staysActiveOwner) {
    const otherActiveOwners = await prisma.user.count({
      where: { studioId, role: Role.OWNER, isActive: true, id: { not: userId } },
    });
    if (otherActiveOwners === 0) {
      return res.status(400).json({ error: "This studio must have at least one active owner." });
    }
  }

  if (body.role !== undefined) data.role = body.role;

  // Team account lifecycle: deactivatedAt/deactivatedById are audit
  // metadata riding alongside the pre-existing isActive toggle, not a
  // second, competing status signal -- isActive is still the one field
  // every other read path (login, the JWT middleware's live session
  // check, etc.) actually checks. Kept in sync here, in the same update,
  // so the two can never drift apart: going inactive stamps who/when,
  // going active again clears both back to null.
  const isDeactivating = body.isActive !== undefined && body.isActive !== existing.isActive;
  if (body.isActive !== undefined) {
    data.isActive = body.isActive;
    data.deactivatedAt = body.isActive ? null : new Date().toISOString();
    data.deactivatedById = body.isActive ? null : req.user!.userId;
  }

  if (body.newPassword !== undefined) {
    if (typeof body.newPassword !== "string" || body.newPassword.length < 8) {
      return res.status(400).json({ error: "newPassword must be at least 8 characters" });
    }
    data.password = await bcrypt.hash(body.newPassword, SALT_ROUNDS);
  }

  // Same guarantee as creation: switching a user's role to ARTIST always
  // leaves them with an Artist profile, so the Team and Artists pages stay
  // in sync regardless of which page changed the role.
  const becomingArtist = body.role === Role.ARTIST && existing.role !== Role.ARTIST;
  let affectedArtistId: string | null = null;
  if (becomingArtist) {
    const alreadyHasProfile = await prisma.artist.findUnique({ where: { userId } });
    affectedArtistId = alreadyHasProfile
      ? alreadyHasProfile.id
      : (await prisma.artist.create({ data: { userId, specialties: [], portfolioImages: [] } })).id;
  } else if (existing.role === Role.ARTIST || body.role === Role.ARTIST) {
    // Already an artist (or staying one) -- other fields on this route
    // (isActive/deactivation, locationId, name/phone) still affect how
    // that artist shows up on the Artists/Team pages.
    affectedArtistId = (await prisma.artist.findUnique({ where: { userId }, select: { id: true } }))?.id ?? null;
  }

  const updated = await prisma.user.update({ where: { id: userId }, data, include: USER_INCLUDE_ARTIST });

  // Distinct action names (not just a generic "update") so deactivation/
  // reactivation reads clearly in the audit trail, same reasoning as
  // invite_sent/invite_resent/invite_cancelled above rather than a single
  // catch-all "update" for every kind of team-management change.
  if (isDeactivating) {
    await logAudit({
      studioId,
      actorUserId: req.user!.userId,
      entityType: "User",
      entityId: userId,
      action: body.isActive ? "user_reactivated" : "user_deactivated",
      changes: { email: existing.email },
    });
  }

  if (body.locationId !== undefined) {
    await logAudit({
      studioId,
      actorUserId: req.user!.userId,
      entityType: "User",
      entityId: userId,
      action: "update",
      changes: diffObjects(existing, { locationId: data.locationId }, ["locationId"]),
    });
  }

  emitInvalidation({ type: "team.changed", studioId });
  if (affectedArtistId) {
    emitInvalidation({ type: "artist.changed", studioId, artistId: affectedArtistId });
  }

  const { password: _password, ...safeUser } = updated;
  res.json(serializeUser(safeUser));
});

// Shared between the delete-preview and the audit snapshot written just
// before the actual DELETE below -- both need the same full picture.
// Distinguishes what's preserved (business content, now nullable-authored
// per the migration that shipped alongside this feature) from what's
// deleted outright (ephemeral, per-user records with no value once the
// account is gone) -- see the DELETE route for exactly which is which.
async function gatherStaffDeletionSummary(userId: string) {
  const [
    artist,
    giftCardsIssued,
    inquiryNotes,
    appointmentPhotos,
    conversationTags,
    personalTasksCreatedForOthers,
    personalTasksOwn,
    taskDismissals,
    sectionSeens,
    conversationReads,
    conversationParticipants,
    dismissedDuplicatePairs,
    prefillDrafts,
    importBatches,
  ] = await Promise.all([
    prisma.artist.findUnique({ where: { userId }, select: { id: true } }),
    prisma.giftCard.count({ where: { issuedById: userId } }),
    prisma.inquiryNote.count({ where: { authorId: userId } }),
    prisma.appointmentPhoto.count({ where: { uploadedById: userId } }),
    prisma.conversationTag.count({ where: { createdById: userId } }),
    prisma.personalTask.count({ where: { createdById: userId, userId: { not: userId } } }),
    prisma.personalTask.count({ where: { userId } }),
    prisma.taskDismissal.count({ where: { userId } }),
    prisma.sectionSeen.count({ where: { userId } }),
    prisma.conversationRead.count({ where: { userId } }),
    prisma.conversationParticipant.count({ where: { userId } }),
    prisma.dismissedDuplicatePair.count({ where: { dismissedById: userId } }),
    prisma.prefillDraft.count({ where: { createdById: userId } }),
    prisma.importBatch.count({ where: { uploadedById: userId } }),
  ]);

  // An artist's own appointment/inquiry history is categorically bigger
  // than "remove a staff account" -- unwinding it isn't something this
  // route attempts. Checked regardless of whether the underlying FK is
  // itself nullable (Inquiry's artist fields are); an inquiry that was
  // actually assigned to or preferred this specific artist is real
  // workflow history worth protecting, not just an FK technicality.
  let artistAppointments = 0;
  let artistAssignedInquiries = 0;
  if (artist) {
    [artistAppointments, artistAssignedInquiries] = await Promise.all([
      prisma.appointment.count({ where: { artistId: artist.id } }),
      prisma.inquiry.count({
        where: { OR: [{ assignedArtistId: artist.id }, { preferredArtistId: artist.id }] },
      }),
    ]);
  }

  return {
    isArtist: !!artist,
    artistAppointments,
    artistAssignedInquiries,
    // Preserved (nullable author/creator), not destroyed:
    giftCardsIssued,
    inquiryNotes,
    appointmentPhotos,
    conversationTags,
    personalTasksCreatedForOthers,
    // Deleted outright, ephemeral/no value once the account is gone:
    personalTasksOwn,
    taskDismissals,
    sectionSeens,
    conversationReads,
    conversationParticipants,
    dismissedDuplicatePairs,
    prefillDrafts,
    importBatches,
  };
}

function blockedByArtistHistory(summary: { isArtist: boolean; artistAppointments: number; artistAssignedInquiries: number }) {
  return summary.isArtist && (summary.artistAppointments > 0 || summary.artistAssignedInquiries > 0);
}

// OWNER only, always available regardless of attached history (except the
// one hard block below) -- the strong in-app confirmation (exact-match
// "DELETE" text input) is the safeguard, same convention as Client/
// Inquiry/Appointment delete elsewhere in this app.
router.get("/:studioId/users/:userId/delete-preview", requireAuth, requirePermission("team.manage"), async (req, res) => {
  const studioId = req.params.studioId as string;
  const userId = req.params.userId as string;

  if (studioId !== req.user!.studioId) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const existing = await loadStudioUser(studioId, userId);
  if (!existing) {
    return res.status(404).json({ error: "User not found" });
  }

  const isLastActiveOwner =
    existing.role === Role.OWNER && existing.isActive
      ? (await prisma.user.count({
          where: { studioId, role: Role.OWNER, isActive: true, id: { not: userId } },
        })) === 0
      : false;

  const summary = await gatherStaffDeletionSummary(userId);

  res.json({
    ...summary,
    isSelf: userId === req.user!.userId,
    isLastActiveOwner,
    blockedByArtistHistory: blockedByArtistHistory(summary),
  });
});

// True permanent delete -- OWNER only. Business content this user merely
// touched (gift cards issued, inquiry notes authored, appointment photos
// uploaded, conversation tags created, personal tasks created for a
// teammate) survives with a null author/creator -- see this schema's
// nullable-FK migration alongside this route. Ephemeral per-user records
// (task dismissals, read receipts, own personal tasks, duplicate-pair
// dismissals, prefill drafts, import batches) are destroyed outright, same
// "no life independent of the user" reasoning already used elsewhere for
// e.g. AppointmentPhoto vs. its parent Appointment. An artist with any
// appointment or assigned/preferred-inquiry history is hard-blocked --
// deactivation is the only option for them here (see blockedByArtistHistory).
router.delete("/:studioId/users/:userId", requireAuth, requirePermission("team.manage"), async (req, res) => {
  const studioId = req.params.studioId as string;
  const userId = req.params.userId as string;
  const { confirm } = req.body ?? {};

  if (confirm !== "DELETE") {
    return res.status(400).json({ error: 'Type "DELETE" to confirm this action.' });
  }

  if (studioId !== req.user!.studioId) {
    return res.status(403).json({ error: "Forbidden" });
  }

  if (userId === req.user!.userId) {
    return res.status(400).json({
      error: "You cannot delete your own account. Have another owner do it, or use your Profile page instead.",
    });
  }

  const existing = await loadStudioUser(studioId, userId);
  if (!existing) {
    return res.status(404).json({ error: "User not found" });
  }

  // Same last-active-owner guard as the PATCH route above -- a studio can
  // never be left without at least one active owner.
  if (existing.role === Role.OWNER && existing.isActive) {
    const otherActiveOwners = await prisma.user.count({
      where: { studioId, role: Role.OWNER, isActive: true, id: { not: userId } },
    });
    if (otherActiveOwners === 0) {
      return res.status(400).json({ error: "This studio must have at least one active owner." });
    }
  }

  const summary = await gatherStaffDeletionSummary(userId);
  const deletedArtistId = summary.isArtist
    ? (await prisma.artist.findUnique({ where: { userId }, select: { id: true } }))?.id ?? null
    : null;
  if (blockedByArtistHistory(summary)) {
    return res.status(400).json({
      error:
        `This artist has ${summary.artistAppointments} appointment(s) and ${summary.artistAssignedInquiries} ` +
        `assigned/preferred inquiry(ies) -- deleting their full history isn't supported here. ` +
        `Deactivate their account instead (Edit → uncheck "Active").`,
    });
  }

  await prisma.$transaction(async (tx) => {
    // Ephemeral, per-user records with no value once the account is gone.
    await tx.taskDismissal.deleteMany({ where: { userId } });
    await tx.sectionSeen.deleteMany({ where: { userId } });
    await tx.conversationRead.deleteMany({ where: { userId } });
    await tx.conversationParticipant.deleteMany({ where: { userId } });
    await tx.dismissedDuplicatePair.deleteMany({ where: { dismissedById: userId } });
    await tx.prefillDraft.deleteMany({ where: { createdById: userId } });

    // ImportRow.importBatchId is required (RESTRICT) -- rows before batch.
    const batches = await tx.importBatch.findMany({ where: { uploadedById: userId }, select: { id: true } });
    if (batches.length > 0) {
      await tx.importRow.deleteMany({ where: { importBatchId: { in: batches.map((b) => b.id) } } });
      await tx.importBatch.deleteMany({ where: { uploadedById: userId } });
    }

    // This user's OWN personal to-dos go with them; a task they merely
    // created for a teammate survives (createdById -> null automatically,
    // via the FK's ON DELETE SET NULL, when the User row is deleted below
    // -- no explicit reassignment needed).
    await tx.personalTask.deleteMany({ where: { userId } });

    // Confirmed zero appointment/inquiry history above -- safe to remove
    // the Artist profile itself along with its own ephemeral digest log.
    if (summary.isArtist) {
      await tx.artistReminderLog.deleteMany({ where: { artist: { userId } } });
      await tx.artist.delete({ where: { userId } });
    }

    // GiftCard.issuedById, InquiryNote.authorId, AppointmentPhoto.
    // uploadedById, ConversationTag.createdById, and any remaining
    // PersonalTask.createdById all SET NULL automatically at the database
    // level the moment this row is gone -- no explicit reassignment here.
    await tx.user.delete({ where: { id: userId } });
  });

  await logAudit({
    studioId,
    actorUserId: req.user!.userId,
    entityType: "User",
    entityId: userId,
    action: "permanently_deleted",
    changes: { email: existing.email, name: existing.name, role: existing.role, ...summary },
  });

  emitInvalidation({ type: "team.changed", studioId });
  if (deletedArtistId) {
    emitInvalidation({ type: "artist.changed", studioId, artistId: deletedArtistId });
  }

  res.json({ success: true });
});

async function buildPermissionMatrix(studioId: string) {
  const overrides = await prisma.rolePermission.findMany({ where: { studioId } });
  const overrideMap = new Map(overrides.map((o: RolePermission) => [`${o.role}:${o.permissionKey}`, o.allowed]));

  const matrix: Record<string, Record<PermissionKey, boolean>> = {};
  for (const role of CONFIGURABLE_ROLES) {
    matrix[role] = {} as Record<PermissionKey, boolean>;
    for (const key of PERMISSION_KEYS) {
      const override = overrideMap.get(`${role}:${key}`);
      matrix[role][key] = override ?? DEFAULT_ROLE_PERMISSIONS[role].has(key);
    }
  }

  return matrix;
}

// The permissions matrix itself is intentionally NOT one of the
// configurable permissions — always hardcoded OWNER-only, same as team
// management above. Letting a role grant itself more access would defeat
// the whole point of a permission system.
router.get("/:studioId/permissions", requireAuth, requireRole(Role.OWNER), async (req, res) => {
  const studioId = req.params.studioId as string;

  if (studioId !== req.user!.studioId) {
    return res.status(403).json({ error: "Forbidden" });
  }

  res.json({ permissionKeys: PERMISSION_KEYS, matrix: await buildPermissionMatrix(studioId) });
});

router.patch("/:studioId/permissions", requireAuth, requireRole(Role.OWNER), async (req, res) => {
  const studioId = req.params.studioId as string;

  if (studioId !== req.user!.studioId) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const updates = (req.body ?? {}).updates;
  if (!Array.isArray(updates)) {
    return res.status(400).json({ error: "updates must be an array" });
  }

  for (const update of updates) {
    if (
      typeof update !== "object" ||
      update === null ||
      !CONFIGURABLE_ROLES.includes(update.role) ||
      !PERMISSION_KEYS.includes(update.permissionKey) ||
      typeof update.allowed !== "boolean"
    ) {
      return res.status(400).json({
        error: "each update must have role (FRONT_DESK/ARTIST/CUSTOMER), permissionKey, and allowed (boolean)",
      });
    }
  }

  const before = await buildPermissionMatrix(studioId);

  // One bulk INSERT ... ON CONFLICT DO UPDATE instead of N individual
  // upsert() round trips -- this expansion grew the matrix from 8 keys to
  // ~49, and the Settings UI's "Save changes" sends every displayed
  // key for both roles at once (up to ~98 rows). N sequential upserts
  // against the remote Postgres instance blew Prisma's default 5s
  // interactive-transaction timeout (P2028) well before N got anywhere
  // near that size in production use -- this single statement is one round
  // trip regardless of how large the matrix grows.
  if (updates.length > 0) {
    const rows = Prisma.join(
      updates.map(
        (update) =>
          Prisma.sql`(${crypto.randomUUID()}, ${studioId}, ${update.role}::"Role", ${update.permissionKey}, ${update.allowed})`,
      ),
    );
    await prisma.$executeRaw`
      INSERT INTO "RolePermission" ("id", "studioId", "role", "permissionKey", "allowed")
      VALUES ${rows}
      ON CONFLICT ("studioId", "role", "permissionKey")
      DO UPDATE SET "allowed" = EXCLUDED."allowed"
    `;
  }

  const after = await buildPermissionMatrix(studioId);

  await logAudit({
    studioId,
    actorUserId: req.user!.userId,
    entityType: "StudioPermissions",
    entityId: studioId,
    action: "permissions_updated",
    changes: diffObjects(before, after, CONFIGURABLE_ROLES as unknown as (keyof typeof before)[]),
  });

  res.json({ permissionKeys: PERMISSION_KEYS, matrix: after });
});

// Weekly hours: an array of exactly 7 entries, one per day (0 = Sunday … 6 =
// Saturday), each either closed or an "HH:mm" 24-hour open/close pair.
const HOURS_TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

function normalizeHours(value: unknown): { hours: Prisma.InputJsonValue } | { error: string } {
  if (!Array.isArray(value) || value.length !== 7) {
    return { error: "hours must be an array of 7 day entries" };
  }

  const seenDays = new Set<number>();
  const normalized: { day: number; closed: boolean; open: string | null; close: string | null }[] = [];

  for (const entry of value) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      typeof entry.day !== "number" ||
      !Number.isInteger(entry.day) ||
      entry.day < 0 ||
      entry.day > 6 ||
      typeof entry.closed !== "boolean"
    ) {
      return { error: "each hours entry must have a day (0-6) and closed (boolean)" };
    }

    if (seenDays.has(entry.day)) {
      return { error: `duplicate day ${entry.day} in hours` };
    }
    seenDays.add(entry.day);

    if (entry.closed) {
      normalized.push({ day: entry.day, closed: true, open: null, close: null });
      continue;
    }

    if (typeof entry.open !== "string" || !HOURS_TIME_REGEX.test(entry.open)) {
      return { error: `open time for day ${entry.day} must be in HH:mm 24-hour format` };
    }
    if (typeof entry.close !== "string" || !HOURS_TIME_REGEX.test(entry.close)) {
      return { error: `close time for day ${entry.day} must be in HH:mm 24-hour format` };
    }

    normalized.push({ day: entry.day, closed: false, open: entry.open, close: entry.close });
  }

  normalized.sort((a, b) => a.day - b.day);
  return { hours: normalized };
}

const LOCATION_TEXT_FIELDS = ["address", "phone", "email"] as const;

async function loadOwnedLocation(studioId: string, locationId: string) {
  const location = await prisma.location.findUnique({ where: { id: locationId } });
  return location && location.studioId === studioId ? location : null;
}

// Any authenticated studio member can list locations; creating/editing/
// deleting them is the configurable "locations.manage" permission.
router.get("/:studioId/locations", requireAuth, async (req, res) => {
  const studioId = req.params.studioId as string;

  if (studioId !== req.user!.studioId) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const locations = await prisma.location.findMany({
    where: { studioId },
    orderBy: { createdAt: "asc" },
  });

  res.json(locations);
});

router.post("/:studioId/locations", requireAuth, requirePermission("locations.manage"), async (req, res) => {
  const studioId = req.params.studioId as string;

  if (studioId !== req.user!.studioId) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const body = req.body ?? {};

  if (typeof body.name !== "string" || body.name.trim().length === 0) {
    return res.status(400).json({ error: "name must be a non-empty string" });
  }

  const data: Prisma.LocationUncheckedCreateInput = { studioId, name: body.name.trim() };

  for (const field of LOCATION_TEXT_FIELDS) {
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

  if (body.hours !== undefined) {
    const result = normalizeHours(body.hours);
    if ("error" in result) {
      return res.status(400).json({ error: result.error });
    }
    data.hours = result.hours;
  }

  const location = await prisma.location.create({ data });

  emitInvalidation({ type: "locations.changed", studioId });

  res.status(201).json(location);
});

router.patch("/:studioId/locations/:locationId", requireAuth, requirePermission("locations.manage"), async (req, res) => {
  const studioId = req.params.studioId as string;
  const locationId = req.params.locationId as string;

  if (studioId !== req.user!.studioId) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const existing = await loadOwnedLocation(studioId, locationId);
  if (!existing) {
    return res.status(404).json({ error: "Location not found" });
  }

  const body = req.body ?? {};
  const data: Prisma.LocationUpdateInput = {};

  if (body.name !== undefined) {
    if (typeof body.name !== "string" || body.name.trim().length === 0) {
      return res.status(400).json({ error: "name must be a non-empty string" });
    }
    data.name = body.name.trim();
  }

  for (const field of LOCATION_TEXT_FIELDS) {
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

  if (body.hours !== undefined) {
    const result = normalizeHours(body.hours);
    if ("error" in result) {
      return res.status(400).json({ error: result.error });
    }
    data.hours = result.hours;
  }

  const location = await prisma.location.update({ where: { id: locationId }, data });

  emitInvalidation({ type: "locations.changed", studioId });

  res.json(location);
});

router.delete("/:studioId/locations/:locationId", requireAuth, requirePermission("locations.manage"), async (req, res) => {
  const studioId = req.params.studioId as string;
  const locationId = req.params.locationId as string;

  if (studioId !== req.user!.studioId) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const existing = await loadOwnedLocation(studioId, locationId);
  if (!existing) {
    return res.status(404).json({ error: "Location not found" });
  }

  await prisma.location.delete({ where: { id: locationId } });

  emitInvalidation({ type: "locations.changed", studioId });

  res.status(204).send();
});

export default router;
