import { Router } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma";
import { JWT_SECRET } from "../lib/jwt";
import type { AuthPayload } from "../middleware/auth";

const router = Router();

const SALT_ROUNDS = 10;

function isExpiredOrInvalid(user: { inviteTokenExpiresAt: Date | null } | null) {
  if (!user) {
    return { code: "invalid", error: "This invite link is invalid." } as const;
  }
  if (!user.inviteTokenExpiresAt || user.inviteTokenExpiresAt < new Date()) {
    return { code: "expired", error: "This invite link has expired. Ask your studio owner to resend it." } as const;
  }
  return null;
}

// Public. Minimal, safe info only -- studio name and the role being
// offered, never anything else about the studio or its other members.
// Same discipline as every other public verify route in this app
// (estimates.ts, waivers.ts, etc.).
router.get("/invite/verify/:token", async (req, res) => {
  const token = req.params.token as string;

  const user = await prisma.user.findUnique({
    where: { inviteToken: token },
    select: { inviteTokenExpiresAt: true, role: true, email: true, studio: { select: { name: true } } },
  });

  const invalidity = isExpiredOrInvalid(user);
  if (invalidity) {
    const status = invalidity.code === "invalid" ? 404 : 410;
    return res.status(status).json(invalidity);
  }

  res.json({ studioName: user!.studio.name, role: user!.role, email: user!.email });
});

// Public. Sets the password for the first time, activates the account,
// and (same convenience as accepting most other first-time setup flows)
// signs them straight in rather than making them immediately re-enter the
// password they just chose.
router.post("/invite/accept/:token", async (req, res) => {
  const token = req.params.token as string;
  const { password } = req.body ?? {};

  if (typeof password !== "string" || password.length < 8) {
    return res.status(400).json({ error: "password must be at least 8 characters" });
  }

  const user = await prisma.user.findUnique({ where: { inviteToken: token } });

  const invalidity = isExpiredOrInvalid(user);
  if (invalidity) {
    const status = invalidity.code === "invalid" ? 404 : 410;
    return res.status(status).json(invalidity);
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  // Invalidated on use, same as every other single-use token in this app
  // -- a second POST with the same (now-cleared) token finds no matching
  // row at all, falling into the same 404 "invalid" branch above as a
  // token that never existed.
  const activated = await prisma.user.update({
    where: { id: user!.id },
    data: {
      password: passwordHash,
      inviteToken: null,
      inviteTokenExpiresAt: null,
      isActive: true,
    },
  });

  const payload: AuthPayload = { userId: activated.id, studioId: activated.studioId, role: activated.role };
  const jwtToken = jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });

  res.json({ token: jwtToken });
});

export default router;
