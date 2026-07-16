import { Router } from "express";
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

const router = Router();

const SALT_ROUNDS = 10;

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Generates a unique, stable public slug for a new studio's intake-form URL
// (/inquiry/:studioSlug). Appends -2, -3, ... on collision; never reused
// once assigned, since studio links get shared publicly.
async function generateUniqueSlug(name: string): Promise<string> {
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
router.post("/:studioId/users", requireAuth, requireRole(Role.OWNER), async (req, res) => {
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

  if (!Object.values(Role).includes(role)) {
    return res.status(400).json({ error: `role must be one of: ${Object.values(Role).join(", ")}` });
  }

  let avatarUrl: string | null = null;
  if (body.avatarUrl !== undefined) {
    const result = validateImageDataUrl(body.avatarUrl, "avatarUrl");
    if ("error" in result) {
      return res.status(400).json({ error: result.error });
    }
    avatarUrl = result.value;
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  // An ARTIST-role account always gets an Artist profile (bio/specialties/
  // portfolio) in the same transaction it's created in, so the Team and
  // Artists pages never fall out of sync with each other.
  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: { email, password: passwordHash, role, studioId, avatarUrl, name: name || null, phone: phone || null },
    });

    if (role === Role.ARTIST) {
      await tx.artist.create({ data: { userId: created.id, specialties: [], portfolioImages: [] } });
    }

    return created;
  });

  const { password: _userPassword, ...userWithoutPassword } = user;
  res.status(201).json(userWithoutPassword);
});

const USER_INCLUDE_ARTIST = { artist: { select: { bio: true, specialties: true } } } as const;
type UserWithArtist = Prisma.UserGetPayload<{ include: typeof USER_INCLUDE_ARTIST }>;

// Admin-only staff directory. Unlike studio/location info (readable by any
// studio member), this lists every user's email/phone — OWNER only.
router.get("/:studioId/users", requireAuth, requireRole(Role.OWNER), async (req, res) => {
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
router.patch("/:studioId/users/:userId", requireAuth, requireRole(Role.OWNER), async (req, res) => {
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
    data[field] = typeof body[field] === "string" ? body[field].trim() || null : null;
  }

  if (body.email !== undefined) {
    if (typeof body.email !== "string" || body.email.trim().length === 0) {
      return res.status(400).json({ error: "email must be a non-empty string" });
    }
    data.email = body.email.trim();
  }

  if (body.role !== undefined && !Object.values(Role).includes(body.role)) {
    return res.status(400).json({ error: `role must be one of: ${Object.values(Role).join(", ")}` });
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
  if (body.isActive !== undefined) data.isActive = body.isActive;

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
  if (becomingArtist) {
    const alreadyHasProfile = await prisma.artist.findUnique({ where: { userId } });
    if (!alreadyHasProfile) {
      await prisma.artist.create({ data: { userId, specialties: [], portfolioImages: [] } });
    }
  }

  const updated = await prisma.user.update({ where: { id: userId }, data, include: USER_INCLUDE_ARTIST });
  const { password: _password, ...safeUser } = updated;
  res.json(serializeUser(safeUser));
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

  await prisma.$transaction(
    updates.map((update) =>
      prisma.rolePermission.upsert({
        where: { studioId_role_permissionKey: { studioId, role: update.role, permissionKey: update.permissionKey } },
        create: { studioId, role: update.role, permissionKey: update.permissionKey, allowed: update.allowed },
        update: { allowed: update.allowed },
      }),
    ),
  );

  res.json({ permissionKeys: PERMISSION_KEYS, matrix: await buildPermissionMatrix(studioId) });
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
    data[field] = typeof body[field] === "string" ? body[field].trim() || null : null;
  }

  if (body.hours !== undefined) {
    const result = normalizeHours(body.hours);
    if ("error" in result) {
      return res.status(400).json({ error: result.error });
    }
    data.hours = result.hours;
  }

  const location = await prisma.location.create({ data });
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
    data[field] = typeof body[field] === "string" ? body[field].trim() || null : null;
  }

  if (body.hours !== undefined) {
    const result = normalizeHours(body.hours);
    if ("error" in result) {
      return res.status(400).json({ error: result.error });
    }
    data.hours = result.hours;
  }

  const location = await prisma.location.update({ where: { id: locationId }, data });
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
  res.status(204).send();
});

export default router;
