import { Router } from "express";
import { prisma } from "../lib/prisma";
import { Role } from "../../generated/prisma/enums";
import { requireAuth, requireRole } from "../middleware/auth";

const router = Router();
router.use(requireAuth);
router.use(requireRole(Role.OWNER, Role.FRONT_DESK, Role.ARTIST));

const SECTIONS = ["inquiries", "appointments", "clients"] as const;
type Section = (typeof SECTIONS)[number];

async function getSeenMap(userId: string): Promise<Record<Section, Date | null>> {
  const rows = await prisma.sectionSeen.findMany({ where: { userId, section: { in: [...SECTIONS] } } });
  const map: Record<Section, Date | null> = { inquiries: null, appointments: null, clients: null };
  for (const row of rows) {
    map[row.section as Section] = row.lastSeenAt;
  }
  return map;
}

// Cheap by design: each count is a single indexed createdAt-range query, no
// joins beyond the scoping the index already covers.
router.get("/", async (req, res) => {
  const { studioId, userId, role } = req.user!;
  const seen = await getSeenMap(userId);

  if (role === Role.ARTIST) {
    const artist = await prisma.artist.findUnique({ where: { userId } });
    if (!artist) {
      return res.json({ inquiries: 0, appointments: 0, clients: 0 });
    }

    const [inquiries, appointments] = await Promise.all([
      prisma.inquiry.count({
        where: { assignedArtistId: artist.id, ...(seen.inquiries ? { createdAt: { gt: seen.inquiries } } : {}) },
      }),
      prisma.appointment.count({
        where: { artistId: artist.id, ...(seen.appointments ? { createdAt: { gt: seen.appointments } } : {}) },
      }),
    ]);

    // ARTIST has no Clients nav item -- not worth a query.
    return res.json({ inquiries, appointments, clients: 0 });
  }

  const [inquiries, appointments, clients] = await Promise.all([
    prisma.inquiry.count({ where: { studioId, ...(seen.inquiries ? { createdAt: { gt: seen.inquiries } } : {}) } }),
    prisma.appointment.count({
      where: { studioId, ...(seen.appointments ? { createdAt: { gt: seen.appointments } } : {}) },
    }),
    prisma.client.count({
      where: { studioId, mergedIntoId: null, ...(seen.clients ? { createdAt: { gt: seen.clients } } : {}) },
    }),
  ]);

  res.json({ inquiries, appointments, clients });
});

// Deliberately NOT audited: marking a nav section seen happens on every
// page visit and carries no business meaning -- logging it would just be
// noise in the audit trail, unlike an actual mutation.
router.post("/seen", async (req, res) => {
  const { userId, studioId } = req.user!;
  const { section } = req.body ?? {};

  if (typeof section !== "string" || !SECTIONS.includes(section as Section)) {
    return res.status(400).json({ error: `section must be one of: ${SECTIONS.join(", ")}` });
  }

  await prisma.sectionSeen.upsert({
    where: { userId_section: { userId, section } },
    update: { lastSeenAt: new Date() },
    create: { userId, studioId, section, lastSeenAt: new Date() },
  });

  res.status(204).send();
});

export default router;
