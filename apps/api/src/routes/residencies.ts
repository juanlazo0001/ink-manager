import { Router } from "express";
import { prisma } from "../lib/prisma";
import { ResidencyStatus, StudioMembershipType } from "../../generated/prisma/enums";
import { requireAuth } from "../middleware/auth";
import { hasPermissionAt } from "../lib/artistAccess";
import { findResidencyOverlapConflict, residencyOverlapErrorMessage, isResidencyExclusionViolation } from "../lib/residencies";
import { logAudit } from "../lib/audit";
import { emitInvalidation, emitUserInvalidation } from "../lib/realtime/registry";

const router = Router();
router.use(requireAuth);

function parseDateOrNull(value: unknown): Date | null {
  if (typeof value !== "string" && !(value instanceof Date)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// The artist's own view -- every stint across every studio, any status.
// No permission gate: an artist always sees all of their own residencies,
// same "inalienable" framing as accept/decline below.
router.get("/mine", async (req, res) => {
  const artist = await prisma.artist.findUnique({ where: { userId: req.user!.userId } });
  if (!artist) return res.json([]);

  const residencies = await prisma.residency.findMany({
    where: { artistId: artist.id },
    include: { membership: { select: { type: true, studio: { select: { id: true, name: true } } } } },
    orderBy: { startDate: "desc" },
  });

  res.json(
    residencies.map((r) => ({
      id: r.id,
      startDate: r.startDate,
      endDate: r.endDate,
      status: r.status,
      membershipType: r.membership.type,
      studio: r.membership.studio,
      createdAt: r.createdAt,
    })),
  );
});

// Host staff's view of one guest membership's own stint history --
// view-only bar is just "belongs to this studio" (same as the rest of the
// Team page's own guest info); CREATE/EDIT/CANCEL below require the real
// residencies.manage permission.
router.get("/", async (req, res) => {
  const membershipId = typeof req.query.membershipId === "string" ? req.query.membershipId : undefined;
  if (!membershipId) {
    return res.status(400).json({ error: "membershipId is required" });
  }

  const membership = await prisma.studioMembership.findUnique({ where: { id: membershipId } });
  if (!membership) {
    return res.status(404).json({ error: "Membership not found" });
  }
  if (!(await hasPermissionAt(req.user!, membership.studioId, "artists.view"))) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const residencies = await prisma.residency.findMany({
    where: { membershipId },
    orderBy: { startDate: "desc" },
  });
  res.json(residencies);
});

// Host staff create a new stint for an EXISTING guest membership at their
// studio. Always lands PENDING -- the artist's own accept/decline is what
// moves it to CONFIRMED/DECLINED, never this route directly (the one
// exception, the artist's own FIRST stint landing CONFIRMED at invite-
// accept, is handled entirely in artistInvites.ts, not here, since no
// StudioMembership -- and therefore no place to hang a PENDING Residency
// off of -- exists until that same request creates one).
router.post("/", async (req, res) => {
  const { membershipId, startDate: startDateRaw, endDate: endDateRaw } = req.body ?? {};

  if (typeof membershipId !== "string" || !membershipId) {
    return res.status(400).json({ error: "membershipId is required" });
  }
  const startDate = parseDateOrNull(startDateRaw);
  const endDate = parseDateOrNull(endDateRaw);
  if (!startDate || !endDate || startDate > endDate) {
    return res.status(400).json({ error: "startDate and endDate must be valid dates, with startDate on or before endDate" });
  }

  const membership = await prisma.studioMembership.findUnique({ where: { id: membershipId } });
  if (!membership || membership.endedAt) {
    return res.status(404).json({ error: "Membership not found" });
  }
  if (membership.type !== StudioMembershipType.GUEST) {
    return res.status(400).json({ error: "Residencies can only be scheduled for a GUEST membership" });
  }

  if (!(await hasPermissionAt(req.user!, membership.studioId, "residencies.manage"))) {
    return res.status(403).json({ error: "Forbidden" });
  }

  // Overlap validation on create: blocked outright rather than created-
  // then-doomed-to-fail-at-accept, so staff get the conflict message at
  // the moment they'd actually act on it.
  const conflict = await findResidencyOverlapConflict(membership.artistId, startDate, endDate);
  if (conflict) {
    return res.status(409).json({ error: residencyOverlapErrorMessage(conflict) });
  }

  let residency;
  try {
    residency = await prisma.residency.create({
      data: { membershipId, artistId: membership.artistId, startDate, endDate, status: ResidencyStatus.PENDING },
    });
  } catch (err) {
    if (isResidencyExclusionViolation(err)) {
      return res.status(409).json({ error: "These dates overlap an existing confirmed residency." });
    }
    throw err;
  }

  await logAudit({
    studioId: membership.studioId,
    actorUserId: req.user!.userId,
    entityType: "Residency",
    entityId: residency.id,
    action: "create",
    changes: { membershipId, startDate, endDate },
  });

  emitInvalidation({ type: "residency.changed", studioId: membership.studioId, artistId: membership.artistId });
  const artistUser = await prisma.artist.findUnique({ where: { id: membership.artistId }, select: { userId: true } });
  if (artistUser) emitUserInvalidation(artistUser.userId, [["residencies", "mine"], ["tasks", artistUser.userId]]);

  res.status(201).json(residency);
});

// Host staff edit dates or cancel a stint. Accept/decline are the ARTIST's
// own separate, ungated actions below -- this route never transitions
// PENDING -> CONFIRMED or PENDING -> DECLINED.
router.patch("/:id", async (req, res) => {
  const id = req.params.id as string;

  const residency = await prisma.residency.findUnique({ where: { id }, include: { membership: true } });
  if (!residency) {
    return res.status(404).json({ error: "Residency not found" });
  }
  if (!(await hasPermissionAt(req.user!, residency.membership.studioId, "residencies.manage"))) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const { startDate: startDateRaw, endDate: endDateRaw, cancel } = req.body ?? {};

  if (cancel === true) {
    if (residency.status === ResidencyStatus.CANCELLED || residency.status === ResidencyStatus.DECLINED) {
      return res.status(400).json({ error: "This residency is already resolved" });
    }
    const updated = await prisma.residency.update({ where: { id }, data: { status: ResidencyStatus.CANCELLED } });
    await logAudit({
      studioId: residency.membership.studioId,
      actorUserId: req.user!.userId,
      entityType: "Residency",
      entityId: id,
      action: "cancel",
      changes: { fromStatus: residency.status },
    });
    emitInvalidation({ type: "residency.changed", studioId: residency.membership.studioId, artistId: residency.artistId });
    const artistUser = await prisma.artist.findUnique({ where: { id: residency.artistId }, select: { userId: true } });
    if (artistUser) emitUserInvalidation(artistUser.userId, [["residencies", "mine"]]);
    return res.json(updated);
  }

  if (startDateRaw === undefined && endDateRaw === undefined) {
    return res.status(400).json({ error: "Provide startDate/endDate to edit, or cancel: true to cancel" });
  }
  if (residency.status === ResidencyStatus.CANCELLED || residency.status === ResidencyStatus.DECLINED) {
    return res.status(400).json({ error: "Can't edit a cancelled or declined residency" });
  }

  const startDate = startDateRaw !== undefined ? parseDateOrNull(startDateRaw) : residency.startDate;
  const endDate = endDateRaw !== undefined ? parseDateOrNull(endDateRaw) : residency.endDate;
  if (!startDate || !endDate || startDate > endDate) {
    return res.status(400).json({ error: "startDate and endDate must be valid dates, with startDate on or before endDate" });
  }

  // Judgment call (flagged in REPORT.md, built per the task's own
  // recommendation): editing a CONFIRMED stint's dates resets it to
  // PENDING -- the artist consented to the ORIGINAL dates specifically,
  // not to "whatever this stint's dates happen to be later." No overlap
  // re-check is needed here as a result: the only way this update could
  // threaten the CONFIRMED-only overlap invariant is by staying CONFIRMED
  // with new dates, which this rule makes unreachable through this route.
  const datesChanged =
    startDate.getTime() !== residency.startDate.getTime() || endDate.getTime() !== residency.endDate.getTime();
  const nextStatus =
    datesChanged && residency.status === ResidencyStatus.CONFIRMED ? ResidencyStatus.PENDING : residency.status;

  const updated = await prisma.residency.update({ where: { id }, data: { startDate, endDate, status: nextStatus } });

  await logAudit({
    studioId: residency.membership.studioId,
    actorUserId: req.user!.userId,
    entityType: "Residency",
    entityId: id,
    action: "edit",
    changes: { startDate, endDate, resetToPending: nextStatus === ResidencyStatus.PENDING && residency.status !== nextStatus },
  });

  emitInvalidation({ type: "residency.changed", studioId: residency.membership.studioId, artistId: residency.artistId });
  const artistUser = await prisma.artist.findUnique({ where: { id: residency.artistId }, select: { userId: true } });
  if (artistUser) emitUserInvalidation(artistUser.userId, [["residencies", "mine"], ["tasks", artistUser.userId]]);

  res.json(updated);
});

// Artist-only, inalienable: no permission key gates this, same family as
// leave-a-studio/delete-account. The caller must BE the residency's own
// artist -- not merely staff at its studio, regardless of any permission
// grant.
router.post("/:id/accept", async (req, res) => {
  const id = req.params.id as string;
  const artist = await prisma.artist.findUnique({ where: { userId: req.user!.userId } });
  if (!artist) {
    return res.status(404).json({ error: "Residency not found" });
  }

  const residency = await prisma.residency.findUnique({ where: { id }, include: { membership: true } });
  if (!residency || residency.artistId !== artist.id) {
    return res.status(404).json({ error: "Residency not found" });
  }
  if (residency.status !== ResidencyStatus.PENDING) {
    return res.status(400).json({ error: "Only a pending residency can be accepted" });
  }

  // Overlap validation on accept -- re-checked fresh even though it was
  // already checked at create time, since the world may have changed in
  // between (another residency confirmed elsewhere).
  const conflict = await findResidencyOverlapConflict(artist.id, residency.startDate, residency.endDate, residency.id);
  if (conflict) {
    return res.status(409).json({ error: residencyOverlapErrorMessage(conflict) });
  }

  let updated;
  try {
    updated = await prisma.residency.update({ where: { id }, data: { status: ResidencyStatus.CONFIRMED } });
  } catch (err) {
    if (isResidencyExclusionViolation(err)) {
      return res.status(409).json({ error: "These dates overlap an existing confirmed residency." });
    }
    throw err;
  }

  await logAudit({
    studioId: residency.membership.studioId,
    actorUserId: req.user!.userId,
    entityType: "Residency",
    entityId: id,
    action: "accept",
  });

  emitInvalidation({ type: "residency.changed", studioId: residency.membership.studioId, artistId: artist.id });
  emitUserInvalidation(req.user!.userId, [["residencies", "mine"], ["tasks", req.user!.userId]]);

  res.json(updated);
});

router.post("/:id/decline", async (req, res) => {
  const id = req.params.id as string;
  const artist = await prisma.artist.findUnique({ where: { userId: req.user!.userId } });
  if (!artist) {
    return res.status(404).json({ error: "Residency not found" });
  }

  const residency = await prisma.residency.findUnique({ where: { id }, include: { membership: true } });
  if (!residency || residency.artistId !== artist.id) {
    return res.status(404).json({ error: "Residency not found" });
  }
  if (residency.status !== ResidencyStatus.PENDING) {
    return res.status(400).json({ error: "Only a pending residency can be declined" });
  }

  const updated = await prisma.residency.update({ where: { id }, data: { status: ResidencyStatus.DECLINED } });

  await logAudit({
    studioId: residency.membership.studioId,
    actorUserId: req.user!.userId,
    entityType: "Residency",
    entityId: id,
    action: "decline",
  });

  emitInvalidation({ type: "residency.changed", studioId: residency.membership.studioId, artistId: artist.id });
  emitUserInvalidation(req.user!.userId, [["residencies", "mine"], ["tasks", req.user!.userId]]);

  res.json(updated);
});

export default router;
