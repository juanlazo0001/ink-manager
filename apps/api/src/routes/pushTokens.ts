import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { isExpoPushToken } from "../lib/expoPush";

const router = Router();
router.use(requireAuth);

// Device registration for push. Called by apps/mobile at login and again
// on every launch -- Expo rotates these, so re-registration is the normal
// case, not an error path.
//
// Upserts on the TOKEN, not on (user, token). That matters: a phone handed
// to a different person, or a reinstall that lands on a recycled token,
// must MOVE to whoever registered it last rather than existing twice --
// otherwise the previous holder keeps receiving pushes on hardware they no
// longer have. PushToken.token is @unique for exactly this reason.
router.post("/", async (req, res) => {
  const { userId } = req.user!;
  const { token, platform, deviceName } = req.body ?? {};

  // Validated here rather than only at send time, because a malformed
  // token makes Expo reject the entire 100-message chunk it lands in --
  // one bad row would cost up to 99 unrelated pushes. Keeping the table
  // clean is cheaper than filtering it on every send (which lib/
  // notifications.ts also does, belt and braces).
  if (!isExpoPushToken(token)) {
    return res.status(400).json({ error: "token must be a valid Expo push token, e.g. ExponentPushToken[...]" });
  }

  if (typeof platform !== "string" || !["ios", "android"].includes(platform)) {
    return res.status(400).json({ error: 'platform must be "ios" or "android"' });
  }

  if (deviceName !== undefined && deviceName !== null && typeof deviceName !== "string") {
    return res.status(400).json({ error: "deviceName must be a string or null" });
  }

  const name = typeof deviceName === "string" ? deviceName.trim().slice(0, 120) || null : null;

  const saved = await prisma.pushToken.upsert({
    where: { token },
    update: { userId, platform, deviceName: name, lastSeenAt: new Date() },
    create: { token, userId, platform, deviceName: name },
  });

  res.status(201).json({ id: saved.id, token: saved.token, platform: saved.platform, lastSeenAt: saved.lastSeenAt });
});

// Logout, or an explicit "stop pushing to this device". Deleting by token
// AND userId together so a caller can only ever unregister their own
// device, and a token that is not theirs comes back 204 rather than
// revealing whether it exists at all.
router.delete("/:token", async (req, res) => {
  await prisma.pushToken.deleteMany({ where: { token: req.params.token as string, userId: req.user!.userId } });
  res.status(204).send();
});

// The per-user switch. PUSH ONLY -- the in-app bell feed is never
// suppressed by it. A notification you can go and look at is not an
// interruption, and hiding a record someone still holds is how people end
// up not knowing something happened.
router.patch("/preferences", async (req, res) => {
  const { pushEnabled } = req.body ?? {};
  if (typeof pushEnabled !== "boolean") {
    return res.status(400).json({ error: "pushEnabled must be a boolean" });
  }

  const updated = await prisma.user.update({
    where: { id: req.user!.userId },
    data: { pushEnabled },
    select: { pushEnabled: true },
  });

  res.json(updated);
});

export default router;
