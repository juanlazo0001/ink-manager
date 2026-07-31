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

  // A Client (and Appointment/Inquiry's own linked client) has separate
  // firstName/lastName columns -- searching "John Smith" against each
  // independently (the old behavior) never matches either one, since
  // neither column contains the full two-word string. Splitting into
  // words and requiring EVERY word to match SOME name field (first OR
  // last) fixes that while leaving single-word queries behaving exactly
  // as before (one word -> one AND-clause -> the same OR-across-both-
  // fields check that already existed). Same pattern already established
  // in clients.ts's own merge-search route.
  const nameWords = q.split(/\s+/).filter(Boolean);
  const clientNameMatch = {
    AND: nameWords.map((word) => ({
      OR: [{ firstName: { contains: word, mode: "insensitive" as const } }, { lastName: { contains: word, mode: "insensitive" as const } }],
    })),
  };

  const [clients, inquiries, artists, appointments] = await Promise.all([
    prisma.client.findMany({
      where: {
        studioId,
        mergedIntoId: null,
        archivedAt: null,
        OR: [clientNameMatch, { email: contains }, { phone: contains }],
      },
      select: { id: true, firstName: true, lastName: true, email: true, phone: true },
      orderBy: { createdAt: "desc" },
      take: RESULT_LIMIT,
    }),
    prisma.inquiry.findMany({
      where: {
        studioId,
        OR: [{ description: contains }, { placement: contains }, { client: clientNameMatch }],
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
        OR: [{ notes: contains }, { client: clientNameMatch }, { artist: { user: { name: contains } } }],
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
