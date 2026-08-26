import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";

const router = Router();
router.use(requireAuth);

// The bell feed.
//
// No permission key gates any of this, deliberately. A notification is
// addressed to ONE person by construction (Notification.userId), and the
// emitters already decided that person was entitled to know -- re-gating
// the read would mean a row could exist that its own recipient cannot see,
// which is a strictly worse state than not having created it. The same
// reasoning artistInvitePendingSource uses for bypassing tasks.viewQueue:
// something addressed to you personally is not "studio work" for a
// permission to govern.
//
// Every query below is scoped `userId: req.user.userId` -- never studioId
// -- for the same reason. A guest artist's notifications from a host
// studio must reach them wherever they happen to be logged in, and their
// JWT's studioId claim can be stale (see CLAUDE.md's artist-scoping rule),
// so it is not something to filter on here.

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

router.get("/", async (req, res) => {
  const { userId } = req.user!;

  const rawLimit = typeof req.query.limit === "string" ? Number(req.query.limit) : DEFAULT_LIMIT;
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), MAX_LIMIT) : DEFAULT_LIMIT;
  const cursor = typeof req.query.cursor === "string" && req.query.cursor ? req.query.cursor : undefined;
  const unreadOnly = req.query.unreadOnly === "true";

  // Cursor pagination, not offset: this list grows at the top constantly,
  // and an offset page-2 would silently skip or repeat rows every time
  // something new arrived between requests.
  const rows = await prisma.notification.findMany({
    where: { userId, ...(unreadOnly ? { readAt: null } : {}) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: { actor: { select: { id: true, name: true, email: true, avatarUrl: true } } },
  });

  // One row over the asked-for page is fetched purely to answer "is there
  // more" without a second count query, then dropped.
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;

  const unreadCount = await prisma.notification.count({ where: { userId, readAt: null } });

  res.json({
    items,
    unreadCount,
    nextCursor: hasMore ? items[items.length - 1]!.id : null,
  });
});

// The badge's own query. Separate from GET / on purpose: the badge is
// rendered on every page in the app and must not have to load a page of
// rows to draw a number.
router.get("/unread-count", async (req, res) => {
  const unreadCount = await prisma.notification.count({ where: { userId: req.user!.userId, readAt: null } });
  res.json({ unreadCount });
});

// Idempotent, and scoped to the caller's own rows in the WHERE clause
// rather than by a findUnique-then-check: `updateMany` with userId in the
// filter cannot touch someone else's notification even if its id is
// guessed, and returns count 0 instead of leaking whether that id exists.
router.post("/mark-read", async (req, res) => {
  const { userId } = req.user!;
  const { id, ids } = req.body ?? {};

  const requested: string[] = [
    ...(typeof id === "string" ? [id] : []),
    ...(Array.isArray(ids) ? ids.filter((v): v is string => typeof v === "string") : []),
  ];

  if (requested.length === 0) {
    return res.status(400).json({ error: "id or ids is required" });
  }

  // Already-read rows are left alone rather than re-stamped, so readAt
  // keeps meaning "when you first read it".
  const { count } = await prisma.notification.updateMany({
    where: { id: { in: requested }, userId, readAt: null },
    data: { readAt: new Date() },
  });

  const unreadCount = await prisma.notification.count({ where: { userId, readAt: null } });
  res.json({ updated: count, unreadCount });
});

router.post("/mark-all-read", async (req, res) => {
  const { userId } = req.user!;
  const { count } = await prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
  res.json({ updated: count, unreadCount: 0 });
});

export default router;
