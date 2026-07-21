import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth, requireRole } from "../middleware/auth";
import { Role } from "../../generated/prisma/enums";

const router = Router();

router.use(requireAuth);
router.use(requireRole(Role.OWNER, Role.FRONT_DESK));

const RESULT_LIMIT = 6;

router.get("/", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const studioId = req.user!.studioId;

  if (q.length < 2) {
    return res.json({ clients: [], inquiries: [], artists: [], appointments: [] });
  }

  const contains = { contains: q, mode: "insensitive" as const };

  const [clients, inquiries, artists, appointments] = await Promise.all([
    prisma.client.findMany({
      where: {
        studioId,
        mergedIntoId: null,
        archivedAt: null,
        OR: [{ firstName: contains }, { lastName: contains }, { email: contains }, { phone: contains }],
      },
      select: { id: true, firstName: true, lastName: true, email: true, phone: true },
      orderBy: { createdAt: "desc" },
      take: RESULT_LIMIT,
    }),
    prisma.inquiry.findMany({
      where: {
        studioId,
        OR: [
          { description: contains },
          { placement: contains },
          { client: { OR: [{ firstName: contains }, { lastName: contains }] } },
        ],
      },
      select: {
        id: true,
        status: true,
        description: true,
        client: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: "desc" },
      take: RESULT_LIMIT,
    }),
    prisma.artist.findMany({
      where: { user: { studioId, OR: [{ name: contains }, { email: contains }] } },
      select: { id: true, user: { select: { name: true, email: true, avatarUrl: true } } },
      take: RESULT_LIMIT,
    }),
    prisma.appointment.findMany({
      where: {
        studioId,
        OR: [
          { notes: contains },
          { client: { OR: [{ firstName: contains }, { lastName: contains }] } },
          { artist: { user: { name: contains } } },
        ],
      },
      select: {
        id: true,
        startTime: true,
        status: true,
        client: { select: { firstName: true, lastName: true } },
        artist: { select: { user: { select: { name: true, avatarUrl: true } } } },
      },
      orderBy: { startTime: "desc" },
      take: RESULT_LIMIT,
    }),
  ]);

  res.json({ clients, inquiries, artists, appointments });
});

export default router;
