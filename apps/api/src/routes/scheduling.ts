import { Router } from "express";
import { prisma } from "../lib/prisma";
import { Role } from "../../generated/prisma/enums";
import { requireAuth, requireRole } from "../middleware/auth";
import { getSuggestedTimes } from "../lib/schedulingAssistant";

const router = Router();

router.use(requireAuth);
// Same role level as every other scheduling-mutation route (POST
// /appointments, POST /inquiries/:id/schedule, POST /inquiries/:id/deposit-form)
// -- suggestions are staff-only, matching who can actually act on them.
router.use(requireRole(Role.OWNER, Role.FRONT_DESK));

// The one shared endpoint behind both Package D consumers -- the deposit
// form's pre-payment "Suggest a time" (informational only) and
// AppointmentForm.tsx's post-payment "Suggested times" panel. See
// apps/api/src/lib/schedulingAssistant.ts for the actual algorithm.
router.get("/suggested-times", async (req, res) => {
  const artistId = typeof req.query.artistId === "string" ? req.query.artistId : undefined;
  const durationMinutes =
    typeof req.query.durationMinutes === "string" ? Number(req.query.durationMinutes) : NaN;
  const excludeAppointmentId =
    typeof req.query.excludeAppointmentId === "string" ? req.query.excludeAppointmentId : undefined;

  if (!artistId) {
    return res.status(400).json({ error: "artistId is required" });
  }
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    return res.status(400).json({ error: "durationMinutes must be a positive number" });
  }

  const artist = await prisma.artist.findUnique({ where: { id: artistId }, include: { user: true } });
  if (!artist || artist.user.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Artist not found" });
  }

  const candidates = await getSuggestedTimes(artistId, durationMinutes, { excludeAppointmentId });
  res.json(candidates);
});

export default router;
