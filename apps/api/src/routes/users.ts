import { Router } from "express";
import bcrypt from "bcrypt";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { Role } from "../../generated/prisma/enums";
import { getEffectivePermissions } from "../lib/permissions";
import { validateImageDataUrl } from "../lib/images";
import { normalizePhone } from "../lib/phone";

const router = Router();

router.use(requireAuth);

const SALT_ROUNDS = 10;

export function serializeUser(user: {
  id: string;
  email: string;
  name: string | null;
  phone: string | null;
  avatarUrl: string | null;
  role: Role;
  studioId: string;
  createdAt: Date;
  artist: { bio: string | null; specialties: string[] } | null;
}) {
  const { artist, ...rest } = user;
  return { ...rest, artist: artist ?? undefined };
}

// No :userId param anywhere in this file — every route acts on
// req.user.userId from the verified JWT, so there is no code path that
// could edit or expose another user's account, regardless of role.
router.get("/me", async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.userId },
    include: { artist: { select: { bio: true, specialties: true } } },
  });

  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  const { password: _password, ...safeUser } = user;
  const permissions = await getEffectivePermissions(user.studioId, user.role);
  res.json({ ...serializeUser(safeUser), permissions });
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

  const changingEmail = typeof body.email === "string" && body.email.trim() !== existing.email;
  const changingPassword = body.newPassword !== undefined;

  if (changingEmail || changingPassword) {
    if (typeof body.currentPassword !== "string" || body.currentPassword.length === 0) {
      return res.status(400).json({ error: "currentPassword is required to change your email or password" });
    }

    const currentPasswordMatches = await bcrypt.compare(body.currentPassword, existing.password);
    if (!currentPasswordMatches) {
      return res.status(401).json({ error: "Current password is incorrect" });
    }
  }

  if (changingEmail) {
    if (body.email.trim().length === 0) {
      return res.status(400).json({ error: "email must be a non-empty string" });
    }
    data.email = body.email.trim();
  }

  if (changingPassword) {
    if (typeof body.newPassword !== "string" || body.newPassword.length < 8) {
      return res.status(400).json({ error: "newPassword must be at least 8 characters" });
    }
    data.password = await bcrypt.hash(body.newPassword, SALT_ROUNDS);
  }

  // Artist-only fields: no-op for any other role, and no-op if the caller's
  // role is ARTIST but somehow has no Artist row yet (created separately by
  // an OWNER via POST /artists — out of scope here).
  if (req.user!.role === Role.ARTIST && (body.bio !== undefined || body.specialties !== undefined)) {
    const artist = await prisma.artist.findUnique({ where: { userId: req.user!.userId } });

    if (artist) {
      const artistData: { bio?: string | null; specialties?: string[] } = {};

      if (body.bio !== undefined) {
        if (body.bio !== null && typeof body.bio !== "string") {
          return res.status(400).json({ error: "bio must be a string or null" });
        }
        artistData.bio = typeof body.bio === "string" ? body.bio.trim() || null : null;
      }

      if (body.specialties !== undefined) {
        if (!Array.isArray(body.specialties) || body.specialties.some((s: unknown) => typeof s !== "string")) {
          return res.status(400).json({ error: "specialties must be an array of strings" });
        }
        artistData.specialties = body.specialties;
      }

      await prisma.artist.update({ where: { userId: req.user!.userId }, data: artistData });
    }
  }

  const updated = await prisma.user.update({
    where: { id: req.user!.userId },
    data,
    include: { artist: { select: { bio: true, specialties: true } } },
  });

  const { password: _password, ...safeUser } = updated;
  const permissions = await getEffectivePermissions(updated.studioId, updated.role);
  res.json({ ...serializeUser(safeUser), permissions });
});

export default router;
