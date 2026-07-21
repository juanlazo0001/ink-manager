import { Router } from "express";
import { prisma } from "../lib/prisma";
import { Role } from "../../generated/prisma/enums";
import { requireAuth, requireRole } from "../middleware/auth";
import { diffObjects, logAudit } from "../lib/audit";

// Public: the studio's own /policies page lists every isPublic custom
// policy, keyed by studio slug -- same unauthenticated, studio-scoped GET
// shape as GET /artists/public?studioSlug=. Sanitization happens entirely
// client-side at render time (sanitizeHtml.ts), matching every other
// StudioSettings HTML policy field -- this route returns the raw stored
// HTML as-is, same as every other public route that returns policy text.
const publicRouter = Router();

publicRouter.get("/public", async (req, res) => {
  const studioSlug = req.query.studioSlug;
  if (typeof studioSlug !== "string" || !studioSlug) {
    return res.status(400).json({ error: "studioSlug is required" });
  }

  const studio = await prisma.studio.findUnique({ where: { slug: studioSlug } });
  if (!studio) {
    return res.status(404).json({ error: "Studio not found" });
  }

  const policies = await prisma.customPolicy.findMany({
    where: { studioId: studio.id, isPublic: true },
    select: { id: true, title: true, bodyHtml: true },
    orderBy: { order: "asc" },
  });

  res.json({ studioName: studio.name, policies });
});

const staffRouter = Router();

staffRouter.use(requireAuth);

// View is OWNER + FRONT_DESK, matching the fixed 8 HTML policy fields'
// own view/edit split (Settings.tsx's canViewPolicies/canEditPolicies) --
// mutations below stay OWNER-only.
staffRouter.get("/", requireRole(Role.OWNER, Role.FRONT_DESK), async (req, res) => {
  const policies = await prisma.customPolicy.findMany({
    where: { studioId: req.user!.studioId },
    orderBy: { order: "asc" },
  });
  res.json(policies);
});

staffRouter.post("/", requireRole(Role.OWNER), async (req, res) => {
  const body = req.body ?? {};

  if (typeof body.title !== "string" || body.title.trim().length === 0) {
    return res.status(400).json({ error: "title is required" });
  }
  if (body.bodyHtml !== undefined && body.bodyHtml !== null && typeof body.bodyHtml !== "string") {
    return res.status(400).json({ error: "bodyHtml must be a string or null" });
  }
  if (body.isPublic !== undefined && typeof body.isPublic !== "boolean") {
    return res.status(400).json({ error: "isPublic must be a boolean" });
  }

  // New policies land at the end of the existing order, not order: 0 --
  // otherwise every new policy would jump to the front of the list.
  const count = await prisma.customPolicy.count({ where: { studioId: req.user!.studioId } });

  const created = await prisma.customPolicy.create({
    data: {
      studioId: req.user!.studioId,
      title: body.title.trim(),
      bodyHtml: typeof body.bodyHtml === "string" ? body.bodyHtml : null,
      isPublic: body.isPublic ?? false,
      order: count,
    },
  });

  await logAudit({
    studioId: req.user!.studioId,
    actorUserId: req.user!.userId,
    entityType: "CustomPolicy",
    entityId: created.id,
    action: "create",
    changes: { title: created.title, isPublic: created.isPublic },
  });

  res.status(201).json(created);
});

staffRouter.patch("/:id", requireRole(Role.OWNER), async (req, res) => {
  const id = req.params.id as string;
  const body = req.body ?? {};

  const existing = await prisma.customPolicy.findUnique({ where: { id } });
  if (!existing || existing.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Custom policy not found" });
  }

  const data: Record<string, unknown> = {};

  if (body.title !== undefined) {
    if (typeof body.title !== "string" || body.title.trim().length === 0) {
      return res.status(400).json({ error: "title must be a non-empty string" });
    }
    data.title = body.title.trim();
  }

  if (body.bodyHtml !== undefined) {
    if (body.bodyHtml !== null && typeof body.bodyHtml !== "string") {
      return res.status(400).json({ error: "bodyHtml must be a string or null" });
    }
    data.bodyHtml = body.bodyHtml;
  }

  if (body.isPublic !== undefined) {
    if (typeof body.isPublic !== "boolean") {
      return res.status(400).json({ error: "isPublic must be a boolean" });
    }
    data.isPublic = body.isPublic;
  }

  const updated = await prisma.customPolicy.update({ where: { id }, data });

  await logAudit({
    studioId: req.user!.studioId,
    actorUserId: req.user!.userId,
    entityType: "CustomPolicy",
    entityId: id,
    action: "update",
    changes: diffObjects(existing, data, ["title", "bodyHtml", "isPublic"] as (keyof typeof existing)[]),
  });

  res.json(updated);
});

staffRouter.delete("/:id", requireRole(Role.OWNER), async (req, res) => {
  const id = req.params.id as string;

  const existing = await prisma.customPolicy.findUnique({ where: { id } });
  if (!existing || existing.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Custom policy not found" });
  }

  await prisma.customPolicy.delete({ where: { id } });

  await logAudit({
    studioId: req.user!.studioId,
    actorUserId: req.user!.userId,
    entityType: "CustomPolicy",
    entityId: id,
    action: "delete",
    changes: { title: existing.title },
  });

  res.status(204).end();
});

// Body: { orderedIds: string[] } -- every one of the studio's custom
// policy ids, in the new display order. All-or-nothing: rejects if the
// set of ids doesn't exactly match what the studio actually has, rather
// than silently reordering a partial list.
staffRouter.post("/reorder", requireRole(Role.OWNER), async (req, res) => {
  const body = req.body ?? {};
  const { orderedIds } = body;

  if (!Array.isArray(orderedIds) || orderedIds.some((id) => typeof id !== "string")) {
    return res.status(400).json({ error: "orderedIds must be an array of strings" });
  }

  const existing = await prisma.customPolicy.findMany({
    where: { studioId: req.user!.studioId },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((p) => p.id));

  if (orderedIds.length !== existingIds.size || orderedIds.some((id) => !existingIds.has(id))) {
    return res.status(400).json({ error: "orderedIds must contain exactly the studio's current custom policy ids" });
  }

  await prisma.$transaction(
    orderedIds.map((id, index) => prisma.customPolicy.update({ where: { id }, data: { order: index } })),
  );

  await logAudit({
    studioId: req.user!.studioId,
    actorUserId: req.user!.userId,
    entityType: "CustomPolicy",
    entityId: req.user!.studioId,
    action: "reorder",
    changes: { orderedIds },
  });

  const reordered = await prisma.customPolicy.findMany({
    where: { studioId: req.user!.studioId },
    orderBy: { order: "asc" },
  });
  res.json(reordered);
});

export { publicRouter, staffRouter };
