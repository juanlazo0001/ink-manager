import { Router } from "express";
import { prisma } from "../lib/prisma";
import type { Prisma } from "../../generated/prisma/client";
import { LiabilityWaiverStatus, Role } from "../../generated/prisma/enums";
import { requireAuth, requireRole } from "../middleware/auth";
import { requirePermission } from "../lib/permissions";
import { logAudit } from "../lib/audit";
import { isAtLeast18, validateClauseInitials, validateHealthAnswers } from "../lib/waivers";
import { normalizePhone } from "../lib/phone";
import { DEFAULT_THEME_PRESET, THEME_PRESET_ACCENT_COLORS, isValidThemePreset } from "../lib/themePresets";
import { shortenUrl } from "../lib/shortLinks";
import { PUBLIC_APP_URL } from "../lib/publicUrl";
import { generateWaiverPdf } from "../lib/pdf";
import { emitInvalidation } from "../lib/realtime/registry";
import { effectiveRoleAt, hasPermissionAt } from "../lib/artistAccess";
import { resolveRequestLocale } from "../lib/contentTranslation";

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
      client: { select: { preferredLocale: true } },
      studio: {
        select: {
          name: true,
          slug: true,
          logoUrl: true,
          settings: {
            select: {
              themePreset: true,
              defaultLocale: true,
              // Multi-language public forms: fetched only to compare
              // against this waiver's OWN snapshot below -- never
              // rendered directly. See the comment further down for why.
              waiverHealthQuestions: true,
              waiverClauses: true,
              waiverAcknowledgment: true,
              waiverPhotoRelease: true,
              translations: true,
            },
          },
        },
      },
      appointment: { select: { startTime: true, endTime: true } },
    },
  });

  const invalidity = isExpiredOrInvalid(waiver);
  if (invalidity) {
    const status = invalidity.code === "invalid" ? 404 : 410;
    return res.status(status).json(invalidity);
  }

  const locale = resolveRequestLocale(req.query.locale, waiver!.client.preferredLocale, waiver!.studio.settings?.defaultLocale);

  // Multi-language public forms: healthQuestionsSnapshot/clausesSnapshot/
  // etc. are frozen at WAIVER-LINK-CREATION time (lib/waivers.ts's own
  // getOrCreateWaiverForAppointment), not at signing -- staff generates
  // this link well before the client ever opens it, specifically so a
  // later edit to the studio's live template never retroactively changes
  // what this exact waiver shows. Applying a live StudioSettingsTranslation
  // to it unconditionally would undermine that guarantee the moment a
  // studio edits their English template after this link was already sent
  // -- so each field only gets translated if the studio's CURRENT live
  // English is still byte-identical to what was actually snapshotted
  // (the same seed-equality principle IntakeFormField's SYSTEM defaults
  // use, applied to "this waiver's own frozen content" as the seed
  // instead of a platform-wide one). The moment they diverge, this
  // waiver's own frozen English renders as-is -- correct, never stale-
  // looking, just not translatable until a studio explicitly re-issues
  // a fresh link after editing.
  const settings = waiver!.studio.settings;
  const translation = settings?.translations.find((t) => t.locale === locale);
  const snapshotMatchesLiveEnglish = (snapshot: unknown, live: unknown) => JSON.stringify(snapshot) === JSON.stringify(live);

  const healthQuestions =
    translation?.waiverHealthQuestions && snapshotMatchesLiveEnglish(waiver!.healthQuestionsSnapshot, settings?.waiverHealthQuestions)
      ? translation.waiverHealthQuestions
      : waiver!.healthQuestionsSnapshot;
  const clauses =
    translation?.waiverClauses && snapshotMatchesLiveEnglish(waiver!.clausesSnapshot, settings?.waiverClauses)
      ? translation.waiverClauses
      : waiver!.clausesSnapshot;
  const acknowledgment =
    translation?.waiverAcknowledgment && waiver!.acknowledgmentSnapshot === settings?.waiverAcknowledgment
      ? translation.waiverAcknowledgment
      : waiver!.acknowledgmentSnapshot;
  const photoRelease =
    translation?.waiverPhotoRelease && waiver!.photoReleaseSnapshot === settings?.waiverPhotoRelease
      ? translation.waiverPhotoRelease
      : waiver!.photoReleaseSnapshot;

  // Minimal safe info only -- no client name, DOB, or any other PII is
  // echoed back on this public pre-signing view.
  res.json({
    resolvedLocale: locale,
    studioName: waiver!.studio.name,
    studioSlug: waiver!.studio.slug,
    studioLogoUrl: waiver!.studio.logoUrl,
    themePreset: waiver!.studio.settings?.themePreset ?? DEFAULT_THEME_PRESET,
    appointmentStart: waiver!.appointment.startTime,
    appointmentEnd: waiver!.appointment.endTime,
    healthQuestions,
    clauses,
    acknowledgment,
    photoRelease,
  });
});

publicRouter.patch("/sign/:token", async (req, res) => {
  const token = req.params.token as string;
  const body = req.body ?? {};

  const waiver = await prisma.liabilityWaiver.findUnique({
    where: { token },
    include: { appointment: { select: { inquiryId: true } } },
  });

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
    signatureData,
    photoReleaseAccepted,
    photoReleaseSignatureName,
    photoReleaseSignatureData,
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
  const normalizedEmergencyPhone = normalizePhone(emergencyContactPhone);
  if (normalizedEmergencyPhone.length !== 10) {
    return res
      .status(400)
      .json({ error: "Emergency contact phone must be a complete 10-digit US number", field: "emergencyContactPhone" });
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

  if (typeof signatureData !== "string" || signatureData.trim().length === 0) {
    return res.status(400).json({ error: "Please sign before submitting", field: "signatureData" });
  }

  let releaseAccepted = false;
  let releaseSignature: string | null = null;
  let releaseSignatureData: string | null = null;

  if (photoReleaseAccepted === true) {
    if (typeof photoReleaseSignatureName !== "string" || photoReleaseSignatureName.trim().length === 0) {
      return res.status(400).json({
        error: "A signature is required to accept the photo/video release",
        field: "photoReleaseSignatureName",
      });
    }
    if (typeof photoReleaseSignatureData !== "string" || photoReleaseSignatureData.trim().length === 0) {
      return res.status(400).json({
        error: "Please sign before accepting the photo/video release",
        field: "photoReleaseSignatureData",
      });
    }
    releaseAccepted = true;
    releaseSignature = photoReleaseSignatureName.trim();
    releaseSignatureData = photoReleaseSignatureData;
  }

  await prisma.liabilityWaiver.update({
    where: { id: waiver!.id },
    data: {
      legalName: legalName.trim(),
      dateOfBirth: dob,
      emergencyContactName: emergencyContactName.trim(),
      emergencyContactPhone: normalizedEmergencyPhone,
      healthAnswers: healthResult.value as unknown as Prisma.InputJsonValue,
      idImageUrl: idImageUrl.trim(),
      clauseInitials: clauseResult.value as unknown as Prisma.InputJsonValue,
      signatureName: signatureName.trim(),
      signatureData,
      photoReleaseAccepted: releaseAccepted,
      photoReleaseSignatureName: releaseSignature,
      photoReleaseSignatureData: releaseSignatureData,
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

  // Real-time audit (Part 2): client signing is out-of-band from any staff
  // action -- the project pipeline's "Waiver Verified" stage (embedded in
  // the Inquiry fetch) and the appointment's own liabilityWaiver.status
  // both never updated live for anyone watching without this. Same
  // dual-emit pattern already used by the schedule route right below for
  // exactly the same reason (one action visibly affects both surfaces).
  emitInvalidation({ type: "appointment.changed", studioId: waiver!.studioId });
  emitInvalidation({ type: "inquiry.updated", studioId: waiver!.studioId, inquiryId: waiver!.appointment.inquiryId });

  res.json({ success: true });
});

// Staff-facing: contains health data and a government ID image, so only
// OWNER/FRONT_DESK may ever reach these -- ARTIST gets a flat 403 from the
// role check below before any waiver record (or its PII) is touched.
const staffRouter = Router();
staffRouter.use(requireAuth);

// Narrow, artist-safe status view -- registered BEFORE the OWNER/FRONT_DESK
// -only gate below on purpose. Returns ONLY {id, status, signedAt,
// verifiedAt}, never healthAnswers/idImageUrl/signatureData/photoRelease*
// -- those stay behind the untouched floor-item gate on GET /:id further
// down, which this route deliberately does not reuse or relax. ARTIST
// access is scoped to waivers for their own appointments; OWNER/FRONT_DESK
// (who already have the full detail view) can reach any waiver in the
// studio through this endpoint too, same as the permission's FD/AR-own
// default implies.
staffRouter.get("/:id/status", async (req, res) => {
  const id = req.params.id as string;

  const waiver = await prisma.liabilityWaiver.findUnique({
    where: { id },
    select: {
      id: true,
      studioId: true,
      status: true,
      signedAt: true,
      verifiedAt: true,
      appointment: { select: { artistId: true } },
    },
  });

  if (!waiver) {
    return res.status(404).json({ error: "Waiver not found" });
  }

  // Artist mobility bug fix, solo-guest fix: authorize against the
  // WAIVER's own studio via the caller's EFFECTIVE role there
  // (effectiveRoleAt), not a plain equality against the caller's raw home
  // studioId or their raw global role -- the old check ran BEFORE the
  // artistId ownership check below and 404'd a legitimately guest-assigned
  // artist's own waiver before that check ever ran. Branching on raw
  // `role === ARTIST` had the same blind spot every other primitive this
  // fix touches did: a solo OWNER-with-Artist-profile guesting at this
  // waiver's studio has global role OWNER, so it took the plain-equality
  // staff branch and 404'd even though they're the waiver's actual
  // assigned artist. Same deposits.ts GET /:id/pdf fix, same shape.
  const roleAtStudio = await effectiveRoleAt(req.user!, waiver.studioId);
  if (!roleAtStudio) {
    return res.status(404).json({ error: "Waiver not found" });
  }
  if (roleAtStudio === Role.ARTIST) {
    const artist = await prisma.artist.findUnique({ where: { userId: req.user!.userId }, select: { id: true } });
    if (waiver.appointment.artistId !== artist?.id) {
      return res.status(404).json({ error: "Waiver not found" });
    }
  }

  // Permission-context fix: evaluated at the waiver's own studio, AFTER the
  // ownership check above -- a caller with no real relationship to this
  // waiver must still see 404, not 403 (same ordering reasoning as
  // deposits.ts's GET /:id/pdf).
  if (!(await hasPermissionAt(req.user!, waiver.studioId, "waivers.viewStatus"))) {
    return res.status(403).json({ error: "Forbidden" });
  }

  res.json({ id: waiver.id, status: waiver.status, signedAt: waiver.signedAt, verifiedAt: waiver.verifiedAt });
});

// Floor item, permanent: ARTIST can never access waiver health answers or
// ID images -- this router-level exclusion is NOT touched by this
// expansion. Every route registered below this line stays OWNER/FRONT_DESK
// -only regardless of any permission toggle; GET /:id/status above is the
// one deliberate, narrow exception, registered before this line specifically
// so it never inherits this restriction.
staffRouter.use(requireRole(Role.OWNER, Role.FRONT_DESK));

staffRouter.get("/:id", requirePermission("waivers.viewStatus"), async (req, res) => {
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

  // Same "active" gate and shortLinks.shortenUrl clients.ts's own
  // shareable-links composer already uses for this exact waiver -- returns
  // the same short code, not a fresh one. The appointment page previously
  // reconstructed a full-length URL client-side from the raw token instead.
  const active = waiver.status === "PENDING" && !!waiver.token && !!waiver.tokenExpiresAt && waiver.tokenExpiresAt > new Date();
  const signingUrl = active ? await shortenUrl(`${PUBLIC_APP_URL}/waiver/${waiver.token}`) : null;

  res.json({ ...waiver, signingUrl });
});

// PDF export for audit/documentation -- registered after the
// OWNER/FRONT_DESK-only gate above, same as GET /:id right above it, so
// ARTIST is blocked from ever reaching it (the health-data/ID-image floor
// this router already enforces, unchanged by this route's existence).
staffRouter.get("/:id/pdf", requirePermission("waivers.viewStatus"), async (req, res) => {
  const id = req.params.id as string;

  const waiver = await prisma.liabilityWaiver.findUnique({
    where: { id },
    include: {
      client: { select: { firstName: true, lastName: true } },
      appointment: { select: { startTime: true } },
      studio: { select: { name: true, logoUrl: true, settings: { select: { themePreset: true } } } },
      verifiedBy: { select: { name: true } },
    },
  });

  if (!waiver || waiver.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Waiver not found" });
  }

  if (!waiver.signedAt) {
    return res.status(400).json({ error: "This waiver has not been signed yet" });
  }

  const waiverThemePreset = waiver.studio.settings?.themePreset;
  const pdf = await generateWaiverPdf({
    studioName: waiver.studio.name,
    studioLogoUrl: waiver.studio.logoUrl,
    accentColor:
      THEME_PRESET_ACCENT_COLORS[isValidThemePreset(waiverThemePreset) ? waiverThemePreset : DEFAULT_THEME_PRESET],
    clientName: `${waiver.client.firstName} ${waiver.client.lastName}`,
    appointmentDate: waiver.appointment.startTime,
    legalName: waiver.legalName,
    dateOfBirth: waiver.dateOfBirth,
    emergencyContactName: waiver.emergencyContactName,
    emergencyContactPhone: waiver.emergencyContactPhone,
    healthQuestions: waiver.healthQuestionsSnapshot as unknown as { question: string; type: string }[],
    healthAnswers: (waiver.healthAnswers ?? []) as unknown as { questionIndex: number; answer: string; explanation?: string }[],
    clauses: waiver.clausesSnapshot as unknown as string[],
    clauseInitials: (waiver.clauseInitials ?? []) as unknown as { clauseIndex: number; initials: string }[],
    acknowledgment: waiver.acknowledgmentSnapshot,
    signatureName: waiver.signatureName,
    signatureData: waiver.signatureData,
    signedAt: waiver.signedAt,
    photoReleaseAccepted: waiver.photoReleaseAccepted,
    photoReleaseText: waiver.photoReleaseSnapshot,
    photoReleaseSignatureName: waiver.photoReleaseSignatureName,
    photoReleaseSignatureData: waiver.photoReleaseSignatureData,
    idImageOnFile: !!waiver.idImageUrl,
    verifiedAt: waiver.verifiedAt,
    verifiedByName: waiver.verifiedBy?.name ?? null,
  });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="waiver-${id}.pdf"`);
  res.send(pdf);
});

staffRouter.post("/:id/verify", requirePermission("waivers.verify"), async (req, res) => {
  const id = req.params.id as string;

  const waiver = await prisma.liabilityWaiver.findUnique({
    where: { id },
    include: { appointment: { select: { inquiryId: true } } },
  });
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

  emitInvalidation({ type: "appointment.changed", studioId: req.user!.studioId });
  emitInvalidation({ type: "inquiry.updated", studioId: req.user!.studioId, inquiryId: waiver.appointment.inquiryId });

  res.json(updated);
});

export { publicRouter, staffRouter };
