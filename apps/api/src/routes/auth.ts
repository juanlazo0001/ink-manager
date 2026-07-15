import { Router } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma";
import { JWT_SECRET } from "../lib/jwt";
import type { AuthPayload } from "../middleware/auth";

const router = Router();

// Compared against when no user is found, so lookup failures and password
// mismatches take the same amount of time and don't leak which one occurred.
const DUMMY_PASSWORD_HASH = "$2b$10$ty/pJLsBz1GB9M5f62ncJeCjuhSWkSjnEOiYd5dKmTolbjHQJ.bzu";

router.post("/login", async (req, res) => {
  const { email, password } = req.body ?? {};

  if (!email || !password) {
    return res.status(400).json({ error: "email and password are required" });
  }

  const user = await prisma.user.findUnique({ where: { email } });
  const passwordMatches = await bcrypt.compare(password, user?.password ?? DUMMY_PASSWORD_HASH);

  if (!user || !passwordMatches) {
    return res.status(401).json({ error: "invalid credentials" });
  }

  if (!user.isActive) {
    return res.status(401).json({ error: "This account has been deactivated. Contact your studio owner." });
  }

  const payload: AuthPayload = { userId: user.id, studioId: user.studioId, role: user.role };
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });

  res.json({ token });
});

export default router;
