import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { Role, AppointmentStatus } from "../../generated/prisma/enums";
import { requirePermission } from "../lib/permissions";

const router = Router();

router.use(requireAuth);

router.post("/", requirePermission("appointments.create"), async (req, res) => {
  const body = req.body ?? {};

  const missing = ["artistId", "clientId", "startTime", "endTime"].filter((field) => !body[field]);
  if (missing.length > 0) {
    return res.status(400).json({ error: `Missing required field(s): ${missing.join(", ")}` });
  }

  const { artistId, clientId, startTime, endTime, notes } = body;

  const start = new Date(startTime);
  const end = new Date(endTime);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
    return res.status(400).json({ error: "startTime and endTime must be valid dates, with startTime before endTime" });
  }

  const studioId = req.user!.studioId;

  const [artist, client] = await Promise.all([
    prisma.artist.findUnique({ where: { id: artistId }, include: { user: true } }),
    prisma.client.findUnique({ where: { id: clientId } }),
  ]);

  if (!artist || artist.user.studioId !== studioId) {
    return res.status(400).json({ error: "artistId must belong to your studio" });
  }

  if (!client || client.studioId !== studioId) {
    return res.status(400).json({ error: "clientId must belong to your studio" });
  }

  const appointment = await prisma.appointment.create({
    data: { artistId, clientId, startTime: start, endTime: end, notes, studioId },
  });

  res.status(201).json(appointment);
});

router.get("/", requirePermission("appointments.view"), async (req, res) => {
  const { studioId, role, userId } = req.user!;
  const clientId = typeof req.query.clientId === "string" ? req.query.clientId : undefined;

  let artistId: string | undefined;

  if (role === Role.ARTIST) {
    const artist = await prisma.artist.findUnique({ where: { userId } });

    if (!artist) {
      return res.json([]);
    }

    artistId = artist.id;
  }

  const appointments = await prisma.appointment.findMany({
    where: {
      studioId,
      ...(clientId ? { clientId } : {}),
      ...(artistId ? { artistId } : {}),
    },
    include: {
      artist: { select: { id: true, user: { select: { email: true } } } },
      client: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: { startTime: "asc" },
    take: 100,
  });

  res.json(appointments);
});

router.patch("/:id", requirePermission("appointments.manage"), async (req, res) => {
  const id = req.params.id as string;
  const { status } = req.body ?? {};

  if (!status) {
    return res.status(400).json({ error: "status is required" });
  }

  if (!Object.values(AppointmentStatus).includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${Object.values(AppointmentStatus).join(", ")}` });
  }

  const appointment = await prisma.appointment.findUnique({ where: { id } });

  if (!appointment || appointment.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Appointment not found" });
  }

  const updated = await prisma.appointment.update({
    where: { id },
    data: { status },
  });

  res.json(updated);
});

export default router;
