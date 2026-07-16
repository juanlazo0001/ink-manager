import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { Role, AppointmentStatus } from "../../generated/prisma/enums";
import { requirePermission } from "../lib/permissions";
import { logAudit } from "../lib/audit";
import { validateGiftCardForAttachment } from "../lib/giftCards";

const router = Router();

router.use(requireAuth);

// Every appointment needs both an inquiry (the project it belongs to) and
// an attached ACTIVE gift card (the deposit) -- N appointments require N
// gift cards. A client with no available card can't get an appointment
// booked here; the error says so explicitly rather than a generic 400.
router.post("/", requirePermission("appointments.create"), async (req, res) => {
  const body = req.body ?? {};

  const missing = ["artistId", "clientId", "startTime", "endTime", "inquiryId", "giftCardId"].filter(
    (field) => !body[field],
  );
  if (missing.length > 0) {
    return res.status(400).json({ error: `Missing required field(s): ${missing.join(", ")}` });
  }

  const { artistId, clientId, startTime, endTime, notes, inquiryId, giftCardId } = body;

  const start = new Date(startTime);
  const end = new Date(endTime);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
    return res.status(400).json({ error: "startTime and endTime must be valid dates, with startTime before endTime" });
  }

  const studioId = req.user!.studioId;

  const [artist, client, inquiry] = await Promise.all([
    prisma.artist.findUnique({ where: { id: artistId }, include: { user: true } }),
    prisma.client.findUnique({ where: { id: clientId } }),
    prisma.inquiry.findUnique({ where: { id: inquiryId } }),
  ]);

  if (!artist || artist.user.studioId !== studioId) {
    return res.status(400).json({ error: "artistId must belong to your studio" });
  }

  if (!client || client.studioId !== studioId) {
    return res.status(400).json({ error: "clientId must belong to your studio" });
  }

  if (!inquiry || inquiry.studioId !== studioId || inquiry.clientId !== clientId) {
    return res.status(400).json({ error: "inquiryId must belong to this client in your studio" });
  }

  const giftCardResult = await validateGiftCardForAttachment(giftCardId, studioId, clientId);
  if ("error" in giftCardResult) {
    return res.status(400).json({
      error: `${giftCardResult.error} — collect a deposit or issue a gift card for this client first.`,
    });
  }

  const appointment = await prisma.$transaction(async (tx) => {
    const created = await tx.appointment.create({
      data: {
        artistId,
        clientId,
        inquiryId,
        startTime: start,
        endTime: end,
        notes,
        studioId,
        status: AppointmentStatus.CONFIRMED,
      },
    });

    await tx.giftCard.update({ where: { id: giftCardId }, data: { appointmentId: created.id } });

    return created;
  });

  await logAudit({
    studioId,
    actorUserId: req.user!.userId,
    entityType: "Appointment",
    entityId: appointment.id,
    action: "create",
    changes: { artistId, clientId, inquiryId, giftCardId, startTime: start, endTime: end },
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
