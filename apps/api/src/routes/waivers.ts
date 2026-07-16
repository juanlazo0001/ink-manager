import { Router } from "express";
import { prisma } from "../lib/prisma";
import type { Prisma } from "../../generated/prisma/client";
import { LiabilityWaiverStatus, Role } from "../../generated/prisma/enums";
import { requireAuth, requireRole } from "../middleware/auth";
import { logAudit } from "../lib/audit";
import { isAtLeast18, validateClauseInitials, validateHealthAnswers } from "../lib/waivers";

function isExpiredOrInvalid(waiver: { signedAt: Date | null; tokenExpiresAt: Date | null } | null) {
  if (!waiver) {
    return { code: "invalid", error: "This link is invalid." } as const;
  }

  if (waiver.signedAt) {
    return { code: "already_signed", error: "This waiver has already been signed." } as const;
  }

  if (!waiver.tokenExpiresAt || waiver.tokenExpiresAt < new Date()) {
    return { code: "expired", error: "This link has expired." } as const;
  }

  return null;
}

// Public: unauthenticated, same bearer-token pattern as consent forms and
// deposit forms -- unlike GiftCard.code, this token IS single-use and gets
// cleared on signing.
const publicRouter = Router();

publicRouter.get("/verify/:token", async (req, res) => {
  const token = req.params.token as string;

  const waiver = await prisma.liabilityWaiver.findUnique({
    where: { token },
    include: {
      studio: { select: { name: true } },
      appointment: { select: { startTime: true, endTime: true } },
    },
  });

  const invalidity = isExpiredOrInvalid(waiver);
  if (invalidity) {
    const status = invalidity.code === "invalid" ? 404 : 410;
    return res.status(status).json(invalidity);
  }

  // Minimal safe info only -- no client name, DOB, or any other PII is
  // echoed back on this public pre-signing view.
  res.json({
    studioName: waiver!.studio.name,
    appointmentStart: waiver!.appointment.startTime,
    appointmentEnd: waiver!.appointment.endTime,
    healthQuestions: waiver!.healthQuestionsSnapshot,
    clauses: waiver!.clausesSnapshot,
    acknowledgment: waiver!.acknowledgmentSnapshot,
    photoRelease: waiver!.photoReleaseSnapshot,
  });
});

publicRouter.patch("/sign/:token", async (req, res) => {
  const token = req.params.token as string;
  const body = req.body ?? {};

  const waiver = await prisma.liabilityWaiver.findUnique({ where: { token } });

  const invalidity = isExpiredOrInvalid(waiver);
  if (invalidity) {
    const status = invalidity.code === "invalid" ? 404 : 410;
    return res.status(status).json(invalidity);
  }

  const {
    legalName,
    dateOfBirth,
    emergencyContactName,
    emergencyContactPhone,
    healthAnswers,
    idImageUrl,
    clauseInitials,
    signatureName,
    photoReleaseAccepted,
    photoReleaseSignatureName,
  } = body;

  if (typeof legalName !== "string" || legalName.trim().length === 0) {
    return res.status(400).json({ error: "Legal name is required", field: "legalName" });
  }

  if (typeof emergencyContactName !== "string" || emergencyContactName.trim().length === 0) {
    return res.status(400).json({ error: "Emergency contact name is required", field: "emergencyContactName" });
  }

  if (typeof emergencyContactPhone !== "string" || emergencyContactPhone.trim().length === 0) {
    return res.status(400).json({ error: "Emergency contact phone is required", field: "emergencyContactPhone" });
  }

  const dob = new Date(dateOfBirth);
  if (!dateOfBirth || Number.isNaN(dob.getTime())) {
    return res.status(400).json({ error: "Date of birth is required", field: "dateOfBirth" });
  }

  if (!isAtLeast18(dob)) {
    return res
      .status(400)
      .json({ error: "You must be 18 or older to be tattooed in North Carolina", field: "dateOfBirth" });
  }

  const healthResult = validateHealthAnswers(
    waiver!.healthQuestionsSnapshot as unknown as { question: string; type: "yes_no" | "yes_no_explain" }[],
    healthAnswers,
  );
  if ("error" in healthResult) {
    return res.status(400).json(healthResult);
  }

  if (typeof idImageUrl !== "string" || idImageUrl.trim().length === 0) {
    return res.status(400).json({ error: "A photo of your government ID is required", field: "idImageUrl" });
  }

  const clauseResult = validateClauseInitials(waiver!.clausesSnapshot as unknown as string[], clauseInitials);
  if ("error" in clauseResult) {
    return res.status(400).json(clauseResult);
  }

  if (typeof signatureName !== "string" || signatureName.trim().length === 0) {
    return res.status(400).json({ error: "Signature is required", field: "signatureName" });
  }

  let releaseAccepted = false;
  let releaseSignature: string | null = null;

  if (photoReleaseAccepted === true) {
    if (typeof photoReleaseSignatureName !== "string" || photoReleaseSignatureName.trim().length === 0) {
      return res.status(400).json({
        error: "A signature is required to accept the photo/video release",
        field: "photoReleaseSignatureName",
      });
    }
    releaseAccepted = true;
    releaseSignature = photoReleaseSignatureName.trim();
  }

  await prisma.liabilityWaiver.update({
    where: { id: waiver!.id },
    data: {
      legalName: legalName.trim(),
      dateOfBirth: dob,
      emergencyContactName: emergencyContactName.trim(),
      emergencyContactPhone: emergencyContactPhone.trim(),
      healthAnswers: healthResult.value as unknown as Prisma.InputJsonValue,
      idImageUrl: idImageUrl.trim(),
      clauseInitials: clauseResult.value as unknown as Prisma.InputJsonValue,
      signatureName: signatureName.trim(),
      photoReleaseAccepted: releaseAccepted,
      photoReleaseSignatureName: releaseSignature,
      signedAt: new Date(),
      status: LiabilityWaiverStatus.SIGNED,
      token: null,
      tokenExpiresAt: null,
    },
  });

  await logAudit({
    studioId: waiver!.studioId,
    actorUserId: null,
    entityType: "LiabilityWaiver",
    entityId: waiver!.id,
    action: "waiver_signed",
    changes: { photoReleaseAccepted: releaseAccepted },
  });

  res.json({ success: true });
});

// Staff-facing: contains health data and a government ID image, so only
// OWNER/FRONT_DESK may ever reach these -- ARTIST gets a flat 403 from the
// role check below before any waiver record (or its PII) is touched.
const staffRouter = Router();
staffRouter.use(requireAuth);
staffRouter.use(requireRole(Role.OWNER, Role.FRONT_DESK));

staffRouter.get("/:id", async (req, res) => {
  const id = req.params.id as string;

  const waiver = await prisma.liabilityWaiver.findUnique({
    where: { id },
    include: {
      client: { select: { id: true, firstName: true, lastName: true } },
      appointment: { select: { id: true, startTime: true, endTime: true } },
      verifiedBy: { select: { id: true, name: true, email: true } },
    },
  });

  if (!waiver || waiver.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Waiver not found" });
  }

  res.json(waiver);
});

staffRouter.post("/:id/verify", async (req, res) => {
  const id = req.params.id as string;

  const waiver = await prisma.liabilityWaiver.findUnique({ where: { id } });
  if (!waiver || waiver.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Waiver not found" });
  }

  if (waiver.status !== LiabilityWaiverStatus.SIGNED) {
    return res.status(400).json({ error: `Only a signed waiver can be verified (this one is ${waiver.status})` });
  }

  const updated = await prisma.liabilityWaiver.update({
    where: { id },
    data: { status: LiabilityWaiverStatus.VERIFIED, verifiedAt: new Date(), verifiedById: req.user!.userId },
  });

  await logAudit({
    studioId: req.user!.studioId,
    actorUserId: req.user!.userId,
    entityType: "LiabilityWaiver",
    entityId: id,
    action: "verify",
    changes: { status: { from: waiver.status, to: LiabilityWaiverStatus.VERIFIED } },
  });

  res.json(updated);
});

export { publicRouter, staffRouter };
