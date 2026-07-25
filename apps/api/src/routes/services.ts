import { Router } from "express";
import { prisma } from "../lib/prisma";
import { Role, ServicePricingModel, ServiceDepositModel } from "../../generated/prisma/enums";
import { requireAuth, requireRole } from "../middleware/auth";
import { diffObjects, logAudit } from "../lib/audit";
import { generateUniqueServiceSlug } from "../lib/services";

const router = Router();
router.use(requireAuth);

// Any staff role can read the list -- needed by the Artist profile's
// service-offering checkboxes (any role viewing that page) and, later, by
// wherever a practitioner picker filters by ArtistService. Only OWNER can
// write (create/edit/deactivate/delete), per this feature's explicit
// "Services management area (OWNER only)" requirement.
router.get("/", requireRole(Role.OWNER, Role.FRONT_DESK, Role.ARTIST), async (req, res) => {
  const services = await prisma.service.findMany({
    where: { studioId: req.user!.studioId },
    orderBy: [{ isActive: "desc" }, { createdAt: "asc" }],
  });
  res.json(services);
});

router.use(requireRole(Role.OWNER));

function isValidMoneyCentsOrNull(value: unknown): value is number | null {
  return value === null || value === undefined || (typeof value === "number" && Number.isInteger(value) && value >= 0);
}

router.post("/", async (req, res) => {
  const studioId = req.user!.studioId;
  const body = req.body ?? {};
  const {
    name,
    pricingModel,
    depositModel,
    flatPriceCents,
    flatDepositCents,
    depositBreakdownNote,
    requiresCandidacyReview,
    intakeFormId,
  } = body;

  if (typeof name !== "string" || name.trim().length === 0) {
    return res.status(400).json({ error: "name is required" });
  }

  if (!Object.values(ServicePricingModel).includes(pricingModel)) {
    return res.status(400).json({ error: `pricingModel must be one of: ${Object.values(ServicePricingModel).join(", ")}` });
  }

  if (!Object.values(ServiceDepositModel).includes(depositModel)) {
    return res.status(400).json({ error: `depositModel must be one of: ${Object.values(ServiceDepositModel).join(", ")}` });
  }

  if (pricingModel === ServicePricingModel.FLAT && (typeof flatPriceCents !== "number" || flatPriceCents <= 0)) {
    return res.status(400).json({ error: "flatPriceCents is required (a positive integer) when pricingModel is FLAT" });
  }

  if (depositModel === ServiceDepositModel.FLAT && (typeof flatDepositCents !== "number" || flatDepositCents <= 0)) {
    return res.status(400).json({ error: "flatDepositCents is required (a positive integer) when depositModel is FLAT" });
  }

  if (!isValidMoneyCentsOrNull(flatPriceCents) || !isValidMoneyCentsOrNull(flatDepositCents)) {
    return res.status(400).json({ error: "flatPriceCents/flatDepositCents must be non-negative integers or null" });
  }

  if (depositBreakdownNote !== undefined && depositBreakdownNote !== null && typeof depositBreakdownNote !== "string") {
    return res.status(400).json({ error: "depositBreakdownNote must be a string or null" });
  }

  if (typeof intakeFormId !== "string" || intakeFormId.length === 0) {
    return res.status(400).json({ error: "intakeFormId is required" });
  }

  const form = await prisma.intakeForm.findUnique({ where: { id: intakeFormId } });
  if (!form || form.studioId !== studioId) {
    return res.status(400).json({ error: "intakeFormId must reference an existing intake form in your studio" });
  }

  const slug = await generateUniqueServiceSlug(studioId, name.trim());

  const service = await prisma.service.create({
    data: {
      studioId,
      name: name.trim(),
      slug,
      pricingModel,
      depositModel,
      flatPriceCents: pricingModel === ServicePricingModel.FLAT ? flatPriceCents : null,
      flatDepositCents: depositModel === ServiceDepositModel.FLAT ? flatDepositCents : null,
      depositBreakdownNote: depositBreakdownNote?.trim() || null,
      requiresCandidacyReview: requiresCandidacyReview === true,
      intakeFormId,
    },
  });

  await logAudit({
    studioId,
    actorUserId: req.user!.userId,
    entityType: "Service",
    entityId: service.id,
    action: "create",
    changes: { name: service.name, slug: service.slug, pricingModel, depositModel },
  });

  res.status(201).json(service);
});

router.patch("/:id", async (req, res) => {
  const studioId = req.user!.studioId;
  const id = req.params.id as string;
  const body = req.body ?? {};

  const existing = await prisma.service.findUnique({ where: { id } });
  if (!existing || existing.studioId !== studioId) {
    return res.status(404).json({ error: "Service not found" });
  }

  const {
    name,
    pricingModel,
    depositModel,
    flatPriceCents,
    flatDepositCents,
    depositBreakdownNote,
    requiresCandidacyReview,
    intakeFormId,
    isActive,
  } = body;

  const data: Record<string, unknown> = {};

  if (name !== undefined) {
    if (typeof name !== "string" || name.trim().length === 0) {
      return res.status(400).json({ error: "name must be a non-empty string" });
    }
    data.name = name.trim();
  }

  if (pricingModel !== undefined) {
    if (!Object.values(ServicePricingModel).includes(pricingModel)) {
      return res.status(400).json({ error: `pricingModel must be one of: ${Object.values(ServicePricingModel).join(", ")}` });
    }
    data.pricingModel = pricingModel;
  }

  if (depositModel !== undefined) {
    if (!Object.values(ServiceDepositModel).includes(depositModel)) {
      return res.status(400).json({ error: `depositModel must be one of: ${Object.values(ServiceDepositModel).join(", ")}` });
    }
    data.depositModel = depositModel;
  }

  const effectivePricingModel = (data.pricingModel as ServicePricingModel | undefined) ?? existing.pricingModel;
  const effectiveDepositModel = (data.depositModel as ServiceDepositModel | undefined) ?? existing.depositModel;

  if (flatPriceCents !== undefined) {
    if (!isValidMoneyCentsOrNull(flatPriceCents)) {
      return res.status(400).json({ error: "flatPriceCents must be a non-negative integer or null" });
    }
    data.flatPriceCents = flatPriceCents;
  }

  if (flatDepositCents !== undefined) {
    if (!isValidMoneyCentsOrNull(flatDepositCents)) {
      return res.status(400).json({ error: "flatDepositCents must be a non-negative integer or null" });
    }
    data.flatDepositCents = flatDepositCents;
  }

  const effectiveFlatPriceCents = data.flatPriceCents !== undefined ? data.flatPriceCents : existing.flatPriceCents;
  const effectiveFlatDepositCents = data.flatDepositCents !== undefined ? data.flatDepositCents : existing.flatDepositCents;

  if (effectivePricingModel === ServicePricingModel.FLAT && !(typeof effectiveFlatPriceCents === "number" && effectiveFlatPriceCents > 0)) {
    return res.status(400).json({ error: "flatPriceCents is required (a positive integer) when pricingModel is FLAT" });
  }

  if (effectiveDepositModel === ServiceDepositModel.FLAT && !(typeof effectiveFlatDepositCents === "number" && effectiveFlatDepositCents > 0)) {
    return res.status(400).json({ error: "flatDepositCents is required (a positive integer) when depositModel is FLAT" });
  }

  if (depositBreakdownNote !== undefined) {
    if (depositBreakdownNote !== null && typeof depositBreakdownNote !== "string") {
      return res.status(400).json({ error: "depositBreakdownNote must be a string or null" });
    }
    data.depositBreakdownNote = depositBreakdownNote?.trim() || null;
  }

  if (requiresCandidacyReview !== undefined) {
    if (typeof requiresCandidacyReview !== "boolean") {
      return res.status(400).json({ error: "requiresCandidacyReview must be a boolean" });
    }
    data.requiresCandidacyReview = requiresCandidacyReview;
  }

  if (intakeFormId !== undefined) {
    if (typeof intakeFormId !== "string" || intakeFormId.length === 0) {
      return res.status(400).json({ error: "intakeFormId must be a non-empty string" });
    }
    const form = await prisma.intakeForm.findUnique({ where: { id: intakeFormId } });
    if (!form || form.studioId !== studioId) {
      return res.status(400).json({ error: "intakeFormId must reference an existing intake form in your studio" });
    }
    data.intakeFormId = intakeFormId;
  }

  if (isActive !== undefined) {
    if (typeof isActive !== "boolean") {
      return res.status(400).json({ error: "isActive must be a boolean" });
    }
    data.isActive = isActive;
  }

  const updated = await prisma.service.update({ where: { id }, data });

  await logAudit({
    studioId,
    actorUserId: req.user!.userId,
    entityType: "Service",
    entityId: id,
    action: "update",
    changes: diffObjects(existing, data, [
      "name",
      "pricingModel",
      "depositModel",
      "flatPriceCents",
      "flatDepositCents",
      "depositBreakdownNote",
      "requiresCandidacyReview",
      "intakeFormId",
      "isActive",
    ]),
  });

  res.json(updated);
});

// A service with any real inquiries ever attached (past or present -- this
// is a permanent historical record check, not just "not currently in use")
// can never be hard-deleted, only deactivated via PATCH { isActive: false }
// above. This is the one place that invariant is enforced.
router.delete("/:id", async (req, res) => {
  const studioId = req.user!.studioId;
  const id = req.params.id as string;

  const existing = await prisma.service.findUnique({ where: { id } });
  if (!existing || existing.studioId !== studioId) {
    return res.status(404).json({ error: "Service not found" });
  }

  const inquiryCount = await prisma.inquiry.count({ where: { serviceId: id } });
  if (inquiryCount > 0) {
    return res.status(400).json({
      error: `This service has ${inquiryCount} inquir${inquiryCount === 1 ? "y" : "ies"} attached and can't be deleted -- deactivate it instead.`,
    });
  }

  await prisma.$transaction([
    prisma.artistService.deleteMany({ where: { serviceId: id } }),
    prisma.service.delete({ where: { id } }),
  ]);

  await logAudit({
    studioId,
    actorUserId: req.user!.userId,
    entityType: "Service",
    entityId: id,
    action: "delete",
    changes: { name: existing.name, slug: existing.slug },
  });

  res.json({ success: true });
});

export default router;
