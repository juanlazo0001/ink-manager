import { Router } from "express";
import { prisma } from "../lib/prisma";
import { Role } from "../../generated/prisma/enums";
import { requireAuth, requireRole } from "../middleware/auth";
import { diffObjects, logAudit } from "../lib/audit";
import { TASK_SOURCE_REGISTRY } from "../lib/tasks/registry";

const router = Router();
router.use(requireAuth);
router.use(requireRole(Role.OWNER, Role.FRONT_DESK, Role.ARTIST));

const VALID_TASK_TYPES = new Set(TASK_SOURCE_REGISTRY.map((s) => s.type));

// System tasks are front-desk work (front desk walks in and sees everything
// needing attention); ARTIST has My Inquiries for their own pipeline
// already, so they get personal tasks only here -- no system task type,
// including WAIVER_TO_VERIFY, is ever computed for that role.
router.get("/", async (req, res) => {
  const { studioId, userId, role } = req.user!;

  // "Assigned to Me": userId is always the assignee, regardless of who
  // created it -- a self-created task and one a FRONT_DESK assigned to
  // this user both land here, with no separate "claiming" step.
  const personal = await prisma.personalTask.findMany({
    where: { studioId, userId },
    include: { createdBy: { select: { id: true, name: true, email: true } } },
    orderBy: [{ completedAt: "asc" }, { dueAt: "asc" }, { createdAt: "asc" }],
  });

  if (role === Role.ARTIST) {
    return res.json({ system: [], personal });
  }

  const [sourceResults, dismissals] = await Promise.all([
    Promise.all(TASK_SOURCE_REGISTRY.map((source) => source.fetch(studioId, userId))),
    prisma.taskDismissal.findMany({ where: { studioId, userId }, select: { taskType: true, entityId: true } }),
  ]);

  const dismissedKeys = new Set(dismissals.map((d) => `${d.taskType}:${d.entityId}`));

  const system = sourceResults
    .flat()
    .filter((task) => !dismissedKeys.has(`${task.type}:${task.dismissalKey}`))
    .sort((a, b) => a.actionableAt.getTime() - b.actionableAt.getTime());

  res.json({ system, personal });
});

router.post("/dismiss", requireRole(Role.OWNER, Role.FRONT_DESK), async (req, res) => {
  const { studioId, userId } = req.user!;
  const { taskType, dismissalKey } = req.body ?? {};

  if (typeof taskType !== "string" || !VALID_TASK_TYPES.has(taskType)) {
    return res.status(400).json({ error: `taskType must be one of: ${[...VALID_TASK_TYPES].join(", ")}` });
  }

  if (typeof dismissalKey !== "string" || dismissalKey.trim().length === 0) {
    return res.status(400).json({ error: "dismissalKey is required" });
  }

  // Idempotent: dismissing something already dismissed is a no-op success,
  // not an error -- the unique constraint is what makes "absence of a row"
  // meaningful, not something callers need to work around.
  const dismissal = await prisma.taskDismissal.upsert({
    where: { userId_taskType_entityId: { userId, taskType, entityId: dismissalKey } },
    update: {},
    create: { studioId, userId, taskType, entityId: dismissalKey },
  });

  await logAudit({
    studioId,
    actorUserId: userId,
    entityType: "SystemTask",
    entityId: dismissalKey,
    action: "dismiss",
    changes: { taskType },
  });

  res.status(201).json(dismissal);
});

router.post("/personal", async (req, res) => {
  const { studioId, userId, role } = req.user!;
  // Renamed on destructure -- req.body's userId is the intended ASSIGNEE,
  // never to be confused with req.user's own id.
  const { title, notes, dueAt, userId: assigneeUserId } = req.body ?? {};

  if (typeof title !== "string" || title.trim().length === 0) {
    return res.status(400).json({ error: "title is required" });
  }

  if (notes !== undefined && notes !== null && typeof notes !== "string") {
    return res.status(400).json({ error: "notes must be a string or null" });
  }

  let parsedDueAt: Date | null = null;
  if (dueAt !== undefined && dueAt !== null) {
    parsedDueAt = new Date(dueAt);
    if (Number.isNaN(parsedDueAt.getTime())) {
      return res.status(400).json({ error: "dueAt must be a valid date or null" });
    }
  }

  // Assigning to someone else is OWNER/FRONT_DESK only; everyone else can
  // only create a task for themselves (assigneeUserId omitted or equal to
  // their own id).
  let assigneeId = userId;
  if (typeof assigneeUserId === "string" && assigneeUserId !== userId) {
    if (role !== Role.OWNER && role !== Role.FRONT_DESK) {
      return res.status(403).json({ error: "Only OWNER/FRONT_DESK can assign a task to someone else" });
    }
    const assignee = await prisma.user.findUnique({ where: { id: assigneeUserId } });
    if (!assignee || assignee.studioId !== studioId || assignee.role === Role.CUSTOMER) {
      return res.status(400).json({ error: "userId must be a staff member in your studio" });
    }
    assigneeId = assigneeUserId;
  }

  const task = await prisma.personalTask.create({
    data: {
      studioId,
      userId: assigneeId,
      createdById: userId,
      title: title.trim(),
      notes: notes?.trim() || null,
      dueAt: parsedDueAt,
    },
  });

  await logAudit({
    studioId,
    actorUserId: userId,
    entityType: "PersonalTask",
    entityId: task.id,
    action: "create",
    changes: { title: task.title, ...(assigneeId !== userId ? { assignedTo: assigneeId } : {}) },
  });

  res.status(201).json(task);
});

router.patch("/personal/:id", async (req, res) => {
  const id = req.params.id as string;
  const { studioId, userId } = req.user!;
  const body = req.body ?? {};

  const task = await prisma.personalTask.findUnique({ where: { id } });
  if (!task || task.studioId !== studioId || task.userId !== userId) {
    return res.status(404).json({ error: "Personal task not found" });
  }

  const data: Record<string, string | null | Date> = {};

  if (body.title !== undefined) {
    if (typeof body.title !== "string" || body.title.trim().length === 0) {
      return res.status(400).json({ error: "title must be a non-empty string" });
    }
    data.title = body.title.trim();
  }

  if (body.notes !== undefined) {
    if (body.notes !== null && typeof body.notes !== "string") {
      return res.status(400).json({ error: "notes must be a string or null" });
    }
    data.notes = typeof body.notes === "string" ? body.notes.trim() || null : null;
  }

  if (body.dueAt !== undefined) {
    if (body.dueAt === null) {
      data.dueAt = null;
    } else {
      const parsed = new Date(body.dueAt);
      if (Number.isNaN(parsed.getTime())) {
        return res.status(400).json({ error: "dueAt must be a valid date or null" });
      }
      data.dueAt = parsed;
    }
  }

  // Completing/reopening is the one field-change worth auditing here --
  // plain title/notes/dueAt edits are noise, same philosophy as nav-counts'
  // seen-marking not being audited.
  const isCompletionChange = "completedAt" in body;
  if (isCompletionChange) {
    if (body.completedAt === null) {
      data.completedAt = null;
    } else {
      const parsed = new Date(body.completedAt);
      if (Number.isNaN(parsed.getTime())) {
        return res.status(400).json({ error: "completedAt must be a valid date or null" });
      }
      data.completedAt = parsed;
    }
  }

  const updated = await prisma.personalTask.update({ where: { id }, data });

  if (isCompletionChange) {
    await logAudit({
      studioId,
      actorUserId: userId,
      entityType: "PersonalTask",
      entityId: id,
      action: data.completedAt ? "complete" : "reopen",
      changes: diffObjects(task, data, ["completedAt"]),
    });
  }

  res.json(updated);
});

// Assignee-only completion (see PATCH above, unchanged); delete is looser
// -- the creator (who may have assigned this to someone else) or the
// assignee can both remove it.
router.delete("/personal/:id", async (req, res) => {
  const id = req.params.id as string;
  const { studioId, userId } = req.user!;

  const task = await prisma.personalTask.findUnique({ where: { id } });
  if (!task || task.studioId !== studioId || (task.userId !== userId && task.createdById !== userId)) {
    return res.status(404).json({ error: "Personal task not found" });
  }

  await prisma.personalTask.delete({ where: { id } });

  await logAudit({
    studioId,
    actorUserId: userId,
    entityType: "PersonalTask",
    entityId: id,
    action: "delete",
    changes: { title: task.title },
  });

  res.status(204).send();
});

export default router;
