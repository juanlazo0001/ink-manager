import { Router } from "express";
import { prisma } from "../lib/prisma";
import { Role } from "../../generated/prisma/enums";
import { requireAuth, requireRole } from "../middleware/auth";
import { getUnreadConversationCount } from "../lib/conversations";

const router = Router();
router.use(requireAuth);
router.use(requireRole(Role.OWNER, Role.FRONT_DESK, Role.ARTIST));

interface CountContext {
  studioId: string;
  userId: string;
  role: Role;
  seenAt: Date | null;
}

// Each section supplies its own counting strategy. Most are "created after
// I last looked" (seenAt, from SectionSeen); a section can opt out of that
// and compute unread-ness its own way instead -- see "conversations" below.
interface NavCountSection {
  name: string;
  // Whether this section is driven by SectionSeen at all (and therefore a
  // valid target for POST /seen). Cheap by design: every created-after
  // section query below is a single indexed createdAt-range count, no
  // joins beyond the scoping the index already covers.
  usesSeenAt: boolean;
  count(ctx: CountContext): Promise<number>;
}

const inquiriesSection: NavCountSection = {
  name: "inquiries",
  usesSeenAt: true,
  async count({ studioId, userId, role, seenAt }) {
    if (role === Role.ARTIST) {
      const artist = await prisma.artist.findUnique({ where: { userId } });
      if (!artist) return 0;
      return prisma.inquiry.count({ where: { assignedArtistId: artist.id, ...(seenAt ? { createdAt: { gt: seenAt } } : {}) } });
    }
    return prisma.inquiry.count({ where: { studioId, ...(seenAt ? { createdAt: { gt: seenAt } } : {}) } });
  },
};

const appointmentsSection: NavCountSection = {
  name: "appointments",
  usesSeenAt: true,
  async count({ studioId, userId, role, seenAt }) {
    if (role === Role.ARTIST) {
      const artist = await prisma.artist.findUnique({ where: { userId } });
      if (!artist) return 0;
      return prisma.appointment.count({ where: { artistId: artist.id, ...(seenAt ? { createdAt: { gt: seenAt } } : {}) } });
    }
    return prisma.appointment.count({ where: { studioId, ...(seenAt ? { createdAt: { gt: seenAt } } : {}) } });
  },
};

const clientsSection: NavCountSection = {
  name: "clients",
  usesSeenAt: true,
  async count({ studioId, role, seenAt }) {
    // ARTIST has no Clients nav item -- not worth a query.
    if (role === Role.ARTIST) return 0;
    return prisma.client.count({ where: { studioId, mergedIntoId: null, ...(seenAt ? { createdAt: { gt: seenAt } } : {}) } });
  },
};

const conversationsSection: NavCountSection = {
  name: "conversations",
  // Deliberately NOT seenAt-driven: "unread" here means "has at least one
  // message after my ConversationRead.lastReadAt for that specific
  // conversation" (see getUnreadConversationCount), which is cleared by
  // opening the thread (POST /conversations/:id/read), not by a generic
  // "mark section seen." POST /nav-counts/seen rejects this section name.
  usesSeenAt: false,
  async count({ studioId, userId, role }) {
    return getUnreadConversationCount(studioId, userId, role);
  },
};

const SECTIONS: NavCountSection[] = [inquiriesSection, appointmentsSection, clientsSection, conversationsSection];
const SEEN_SECTION_NAMES = SECTIONS.filter((s) => s.usesSeenAt).map((s) => s.name);

router.get("/", async (req, res) => {
  const { studioId, userId, role } = req.user!;

  const seenRows = await prisma.sectionSeen.findMany({ where: { userId, section: { in: SEEN_SECTION_NAMES } } });
  const seenMap = new Map(seenRows.map((row) => [row.section, row.lastSeenAt]));

  const entries = await Promise.all(
    SECTIONS.map(async (section) => {
      const count = await section.count({ studioId, userId, role, seenAt: seenMap.get(section.name) ?? null });
      return [section.name, count] as const;
    }),
  );

  res.json(Object.fromEntries(entries));
});

// Deliberately NOT audited: marking a nav section seen happens on every
// page visit and carries no business meaning -- logging it would just be
// noise in the audit trail, unlike an actual mutation.
router.post("/seen", async (req, res) => {
  const { userId, studioId } = req.user!;
  const { section } = req.body ?? {};

  if (typeof section !== "string" || !SEEN_SECTION_NAMES.includes(section)) {
    return res.status(400).json({ error: `section must be one of: ${SEEN_SECTION_NAMES.join(", ")}` });
  }

  await prisma.sectionSeen.upsert({
    where: { userId_section: { userId, section } },
    update: { lastSeenAt: new Date() },
    create: { userId, studioId, section, lastSeenAt: new Date() },
  });

  res.status(204).send();
});

export default router;
