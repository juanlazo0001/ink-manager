import { Router } from "express";
import multer from "multer";
import { parse } from "csv-parse/sync";
import type { Prisma } from "../../generated/prisma/client";
import { prisma } from "../lib/prisma";
import { requireAuth, requireRole } from "../middleware/auth";
import { requirePermission } from "../lib/permissions";
import { Role, Channel, ImportBatchStatus, ImportRowDecision, ImportRowDepositDecision } from "../../generated/prisma/enums";
import { logAudit } from "../lib/audit";
import { findMatchingClientForImportRow } from "../lib/duplicateDetection";
import { createClientFromFields } from "../lib/clientContacts";
import { performMerge, validateMergePair } from "../lib/clientMerge";
import { generateUniqueReferralCode } from "../lib/referrals";
import { computeGiftCardExpiration, generateUniqueGiftCardCode } from "../lib/giftCards";
import { resolveDepositTiers } from "../lib/depositTiers";
import {
  IMPORT_TARGET_FIELDS,
  IMPORT_TARGET_FIELD_LABELS,
  type ImportTargetField,
  suggestColumnMapping,
  validateColumnMapping,
  getMappedRawValue,
  getNoteHeaders,
  isMalformedRow,
  parseDepositAmountCents,
  isDepositOutlier,
  composeAddress,
} from "../lib/importColumnMapping";
import { matchArtistForImportRow } from "../lib/importArtistMatching";
import { emitInvalidation } from "../lib/realtime/registry";

const router = Router();

router.use(requireAuth);
// Upload/columns/mapping/review/decide/summary all share the dedicated
// clients.import permission (successor to the retired clients.manage,
// which used to gate this whole router too -- see clients.ts's own
// comment on the split). Execute (real, permanent writes) gets an
// additional OWNER-only check on top of this, below.
router.use(requirePermission("clients.import"));

// CSV lives entirely in memory -- these are client-list exports, not
// multi-megabyte media, and every other upload path in this app already
// hands raw bytes to a third party (Cloudinary) rather than buffering
// server-side, so there's no existing disk-storage convention to match.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

router.post("/import", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "A CSV file is required (form field name: file)" });
  }

  let records: Record<string, string>[];
  try {
    records = parse(req.file.buffer, {
      // Original headers, trimmed only -- NOT aliased/normalized to a
      // field name here anymore. Which column means what is a staff
      // decision made explicitly in the mapping step below, not guessed
      // at parse time.
      columns: (headerRow: string[]) => headerRow.map((h) => h.trim()),
      skip_empty_lines: true,
      trim: true,
      bom: true,
    });
  } catch (err) {
    return res.status(400).json({ error: `Could not parse this file as CSV: ${err instanceof Error ? err.message : "invalid file"}` });
  }

  if (records.length === 0) {
    return res.status(400).json({ error: "The CSV file has no data rows" });
  }

  const studioId = req.user!.studioId;

  const batch = await prisma.importBatch.create({
    data: { studioId, uploadedById: req.user!.userId },
  });

  // rawData preserved verbatim, keyed by the CSV's own original headers --
  // nothing is duplicate-checked or field-parsed yet, since which column
  // IS the phone number (etc.) isn't known until staff confirms a mapping
  // (PATCH .../mapping) below.
  await prisma.importRow.createMany({
    data: records.map((row) => ({ importBatchId: batch.id, rawData: row })),
  });

  await logAudit({
    studioId,
    actorUserId: req.user!.userId,
    entityType: "ImportBatch",
    entityId: batch.id,
    action: "uploaded",
    changes: { rowCount: records.length, filename: req.file.originalname },
  });

  res.status(201).json({ id: batch.id, status: batch.status, createdAt: batch.createdAt, rowCount: records.length });
});

router.get("/import/:batchId/columns", async (req, res) => {
  const batch = await prisma.importBatch.findUnique({
    where: { id: req.params.batchId as string },
    include: { rows: { take: 1 } },
  });
  if (!batch || batch.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Import batch not found" });
  }

  const sample = batch.rows.length > 0 ? (batch.rows[0].rawData as Record<string, unknown>) : {};
  const headers = Object.keys(sample);

  res.json({
    headers,
    // First row's raw values, purely so the mapping UI can show a
    // real example alongside each header -- e.g. a column literally
    // named "Notes" that turns out to contain deposit text is much
    // easier to catch with a sample value visible than from the header
    // name alone.
    sample,
    suggestedMapping: suggestColumnMapping(headers),
    savedMapping: batch.columnMapping ?? null,
    targetFields: IMPORT_TARGET_FIELDS.map((key) => ({ key, label: IMPORT_TARGET_FIELD_LABELS[key] })),
  });
});

router.patch("/import/:batchId/mapping", async (req, res) => {
  const batchId = req.params.batchId as string;
  const studioId = req.user!.studioId;

  const batch = await prisma.importBatch.findUnique({ where: { id: batchId }, include: { rows: true } });
  if (!batch || batch.studioId !== studioId) {
    return res.status(404).json({ error: "Import batch not found" });
  }

  if (batch.status !== ImportBatchStatus.MAPPING) {
    return res.status(400).json({ error: "This batch's column mapping has already been confirmed" });
  }

  const knownHeaders = batch.rows.length > 0 ? Object.keys(batch.rows[0].rawData as Record<string, unknown>) : [];
  const mappingError = validateColumnMapping(req.body?.mapping, knownHeaders);
  if (mappingError) {
    return res.status(400).json({ error: mappingError });
  }

  const mapping = req.body.mapping as Record<string, ImportTargetField>;

  const settings = await prisma.studioSettings.findUnique({ where: { studioId }, select: { depositTiers: true } });
  const tiers = resolveDepositTiers(settings?.depositTiers);

  await prisma.importBatch.update({
    where: { id: batchId },
    data: { columnMapping: mapping, status: ImportBatchStatus.PENDING_REVIEW },
  });

  // Sequential, not Promise.all -- findMatchingClientForImportRow and
  // matchArtistForImportRow both re-read studio-wide lists per row, and a
  // large import doing that concurrently for hundreds of rows at once
  // would hammer the DB for no real benefit (nothing here is
  // latency-sensitive; this only runs once per confirmed mapping).
  for (const row of batch.rows) {
    const raw = row.rawData as Record<string, unknown>;
    const phone = getMappedRawValue(raw, mapping, "phone");
    const email = getMappedRawValue(raw, mapping, "email");
    const match = await findMatchingClientForImportRow(studioId, phone, email);

    const depositRaw = getMappedRawValue(raw, mapping, "depositAmount");
    const parsedDepositCents = parseDepositAmountCents(depositRaw);
    const depositFlaggedAsOutlier = parsedDepositCents != null && isDepositOutlier(parsedDepositCents, tiers);

    const artistRaw = getMappedRawValue(raw, mapping, "inquiry.assignedArtist");
    const artistMatch = await matchArtistForImportRow(studioId, artistRaw);

    await prisma.importRow.update({
      where: { id: row.id },
      data: {
        matchedClientId: match?.id ?? null,
        parsedDepositCents,
        depositFlaggedAsOutlier,
        matchedArtistId: artistMatch.matchedArtistId,
        artistFlaggedForReview: artistMatch.artistFlaggedForReview,
      },
    });
  }

  await logAudit({
    studioId,
    actorUserId: req.user!.userId,
    entityType: "ImportBatch",
    entityId: batchId,
    action: "mapping-confirmed",
    changes: { columnMapping: mapping },
  });

  const full = await getBatchForReview(batchId, studioId);
  res.json(full);
});

async function getBatchForReview(batchId: string, studioId: string) {
  const batch = await prisma.importBatch.findUnique({
    where: { id: batchId },
    include: {
      rows: {
        include: {
          matchedClient: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
          matchedArtist: { select: { id: true, user: { select: { name: true } } } },
        },
        orderBy: { id: "asc" },
      },
    },
  });

  if (!batch || batch.studioId !== studioId) return null;

  const mapping = batch.columnMapping as Record<string, ImportTargetField> | null;

  // The review table's artist-picker needs every studio artist regardless
  // of whether this batch flagged any row -- fetched alongside the batch
  // so the frontend needs only this one call to render the whole review
  // screen, same as columnsData bundles targetFields for the mapping step.
  const studioArtists = await prisma.artist.findMany({
    where: { user: { studioId } },
    select: { id: true, user: { select: { name: true } } },
    orderBy: { user: { name: "asc" } },
  });

  return {
    ...batch,
    studioArtists: studioArtists.map((a) => ({ id: a.id, name: a.user.name ?? "(unnamed)" })),
    rows: batch.rows.map((row) => ({
      ...row,
      isMalformed: isMalformedRow(row.rawData as Record<string, unknown>, mapping),
    })),
  };
}

router.get("/import/:batchId", async (req, res) => {
  const batch = await getBatchForReview(req.params.batchId as string, req.user!.studioId);
  if (!batch) return res.status(404).json({ error: "Import batch not found" });
  res.json(batch);
});

const DECISIONS = Object.values(ImportRowDecision);
const DEPOSIT_DECISIONS = Object.values(ImportRowDepositDecision);

router.patch("/import/:batchId/rows/:rowId", async (req, res) => {
  const { batchId, rowId } = req.params as { batchId: string; rowId: string };
  const { decision, depositDecision, correctedDepositCents, matchedArtistId } = req.body ?? {};

  const row = await prisma.importRow.findUnique({ where: { id: rowId }, include: { importBatch: true } });
  if (!row || row.importBatchId !== batchId || row.importBatch.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Import row not found" });
  }

  if (row.importBatch.status !== ImportBatchStatus.PENDING_REVIEW) {
    return res.status(400).json({ error: "This batch is not currently pending review" });
  }

  const mapping = row.importBatch.columnMapping as Record<string, ImportTargetField> | null;
  const data: Prisma.ImportRowUpdateInput = {};

  if (decision !== undefined) {
    if (!DECISIONS.includes(decision)) {
      return res.status(400).json({ error: `decision must be one of: ${DECISIONS.join(", ")}` });
    }

    if (decision === ImportRowDecision.ADD && isMalformedRow(row.rawData as Record<string, unknown>, mapping)) {
      return res
        .status(400)
        .json({ error: "This row is missing a mapped first and/or last name and cannot be added as a new client" });
    }

    if (decision === ImportRowDecision.MERGE && !row.matchedClientId) {
      return res.status(400).json({ error: "This row has no detected match to merge into" });
    }

    data.decision = decision;
  }

  if (depositDecision !== undefined) {
    if (!row.depositFlaggedAsOutlier) {
      return res
        .status(400)
        .json({ error: "This row's deposit amount was not flagged as an outlier -- no deposit decision is needed" });
    }

    if (!DEPOSIT_DECISIONS.includes(depositDecision)) {
      return res.status(400).json({ error: `depositDecision must be one of: ${DEPOSIT_DECISIONS.join(", ")}` });
    }

    if (depositDecision === ImportRowDepositDecision.EDIT) {
      if (typeof correctedDepositCents !== "number" || !Number.isFinite(correctedDepositCents) || correctedDepositCents <= 0) {
        return res
          .status(400)
          .json({ error: "correctedDepositCents (a positive number) is required when depositDecision is EDIT" });
      }
      // No separate "corrected" column -- the staff-supplied figure
      // becomes the new parsedDepositCents outright, which is what
      // execute (and the summary endpoint) always read as the final
      // amount. depositFlaggedAsOutlier itself is left alone -- it
      // records the historical fact that the original parse looked
      // unusual, not today's resolved value.
      data.parsedDepositCents = Math.round(correctedDepositCents);
    }

    data.depositDecision = depositDecision;
  }

  // Not restricted to artistFlaggedForReview rows -- unlike a deposit
  // outlier's depositDecision, staff can correct ANY row's artist match,
  // not just a flagged one. artistFlaggedForReview itself is left alone
  // either way (see the schema's own comment): it records whether the
  // ORIGINAL match was exact, not whether it's been reviewed since.
  if (matchedArtistId !== undefined) {
    if (matchedArtistId !== null) {
      if (typeof matchedArtistId !== "string") {
        return res.status(400).json({ error: "matchedArtistId must be a string or null" });
      }
      const artist = await prisma.artist.findUnique({
        where: { id: matchedArtistId },
        select: { user: { select: { studioId: true } } },
      });
      if (!artist || artist.user.studioId !== req.user!.studioId) {
        return res.status(400).json({ error: "matchedArtistId must belong to an artist in your studio" });
      }
    }
    data.matchedArtist = matchedArtistId === null ? { disconnect: true } : { connect: { id: matchedArtistId } };
  }

  if (Object.keys(data).length === 0) {
    return res.status(400).json({ error: "Provide decision, depositDecision, and/or matchedArtistId to update" });
  }

  const updated = await prisma.importRow.update({
    where: { id: rowId },
    data,
    include: { matchedArtist: { select: { id: true, user: { select: { name: true } } } } },
  });
  res.json({ ...updated, isMalformed: isMalformedRow(updated.rawData as Record<string, unknown>, mapping) });
});

// Shared by both the summary endpoint and execute -- one real definition
// of "will this row actually get a gift card, and for how much" so the
// pre-commit confirmation total can never drift from what execute does.
function rowGiftCardCents(row: { parsedDepositCents: number | null; depositFlaggedAsOutlier: boolean; depositDecision: ImportRowDepositDecision | null }): number | null {
  if (row.parsedDepositCents == null) return null;
  if (row.depositFlaggedAsOutlier && row.depositDecision === ImportRowDepositDecision.SKIP) return null;
  return row.parsedDepositCents;
}

router.get("/import/:batchId/summary", async (req, res) => {
  const batch = await prisma.importBatch.findUnique({
    where: { id: req.params.batchId as string },
    include: { rows: true },
  });
  if (!batch || batch.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Import batch not found" });
  }

  const undecidedCount = batch.rows.filter((r) => !r.decision).length;
  const outlierUnresolvedCount = batch.rows.filter((r) => r.depositFlaggedAsOutlier && !r.depositDecision).length;

  // SKIP rows never get a client, so they never get a gift card either,
  // regardless of what their (now-moot) deposit amount parsed to.
  const giftCardRows = batch.rows.filter((r) => r.decision !== ImportRowDecision.SKIP && (rowGiftCardCents(r) ?? 0) > 0);
  const giftCardTotalCents = giftCardRows.reduce((sum, r) => sum + (rowGiftCardCents(r) ?? 0), 0);

  res.json({
    addCount: batch.rows.filter((r) => r.decision === ImportRowDecision.ADD).length,
    mergeCount: batch.rows.filter((r) => r.decision === ImportRowDecision.MERGE).length,
    skipCount: batch.rows.filter((r) => r.decision === ImportRowDecision.SKIP).length,
    undecidedCount,
    outlierUnresolvedCount,
    giftCards: { count: giftCardRows.length, totalCents: giftCardTotalCents },
    readyToExecute: batch.status === ImportBatchStatus.PENDING_REVIEW && undecidedCount === 0 && outlierUnresolvedCount === 0,
  });
});

// Not explicitly in the task's own route list, but CANCELLED is a real
// value in ImportBatchStatus with no other route that ever sets it --
// staff backing out of a review (or even mid-mapping) before ever
// executing needs a way to do that, matching the same OWNER/FRONT_DESK
// gate as upload/review/decide (never wrote anything real yet, so this
// doesn't need the execute route's stricter OWNER-only bar).
router.post("/import/:batchId/cancel", async (req, res) => {
  const batchId = req.params.batchId as string;
  const batch = await prisma.importBatch.findUnique({ where: { id: batchId } });
  if (!batch || batch.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Import batch not found" });
  }

  if (batch.status !== ImportBatchStatus.MAPPING && batch.status !== ImportBatchStatus.PENDING_REVIEW) {
    return res.status(400).json({ error: "Only a batch still being mapped or pending review can be cancelled" });
  }

  const updated = await prisma.importBatch.update({ where: { id: batchId }, data: { status: ImportBatchStatus.CANCELLED } });

  await logAudit({
    studioId: req.user!.studioId,
    actorUserId: req.user!.userId,
    entityType: "ImportBatch",
    entityId: batchId,
    action: "cancelled",
  });

  res.json(updated);
});

// Shared by both the ADD and MERGE branches of execute below: creates the
// real Client (+ address, if mapped) and its one Inquiry (with whatever
// tattoo-detail fields were mapped -- required-but-unmapped Inquiry
// columns get neutral defaults, since a legacy CRM export never captures
// them), plus one InquiryNote concatenating every "Historical Note"-mapped
// column, if any. For a MERGE row this creates the throwaway client that
// gets folded into the matched client immediately afterward by the
// caller -- repointClientRelations (inside performMerge) re-parents this
// same Inquiry onto the survivor, so it's never lost.
async function createImportedClientWithInquiry(
  tx: Prisma.TransactionClient,
  params: {
    studioId: string;
    actorUserId: string;
    referralCode: string;
    fields: { firstName: string; lastName: string; email: string | null; phone: string | null; address: string | null };
    inquiryFields: { description: string; placement: string; estimatedSize: string; budget: string | null; desiredTiming: string | null };
    assignedArtistId: string | null;
    noteBodyHtml: string | null;
    serviceId: string;
  },
) {
  const client = await createClientFromFields(tx, {
    studioId: params.studioId,
    firstName: params.fields.firstName,
    lastName: params.fields.lastName,
    email: params.fields.email,
    phone: params.fields.phone,
    address: params.fields.address,
    referralCode: params.referralCode,
  });

  const inquiry = await tx.inquiry.create({
    data: {
      studioId: params.studioId,
      clientId: client.id,
      serviceId: params.serviceId,
      // No mapped column tells us the original inquiry channel -- EMAIL
      // is this app's own existing fallback for "unspecified" (see
      // routes/inquiries.ts's identical default), not a guess specific to
      // imports.
      channel: Channel.EMAIL,
      description: params.inquiryFields.description,
      // Neither is captured by any mappable column -- neutral defaults
      // rather than blocking the import on data a legacy CRM export never
      // provided. The Historical Note (if any) is where genuinely
      // unstructured context from the export actually lives.
      colorOrBlackGrey: "",
      hasBeenTattooedBefore: false,
      placement: params.inquiryFields.placement,
      estimatedSize: params.inquiryFields.estimatedSize,
      budget: params.inquiryFields.budget,
      desiredTiming: params.inquiryFields.desiredTiming,
      // Null means the row's artist column was unmapped, empty, or never
      // resolved to a real Artist (no match, or staff never picked one
      // during review) -- the inquiry still imports successfully,
      // unassigned, same as any other inquiry created without a preferred
      // artist.
      assignedArtistId: params.assignedArtistId,
    },
  });

  if (params.noteBodyHtml) {
    await tx.inquiryNote.create({
      data: {
        studioId: params.studioId,
        inquiryId: inquiry.id,
        authorId: params.actorUserId,
        bodyHtml: params.noteBodyHtml,
      },
    });
  }

  return { clientId: client.id, inquiryId: inquiry.id };
}

// OWNER only -- a genuine bulk data-write action, not a review step.
router.post("/import/:batchId/execute", requireRole(Role.OWNER), async (req, res) => {
  const batchId = req.params.batchId as string;
  const studioId = req.user!.studioId;

  const batch = await prisma.importBatch.findUnique({ where: { id: batchId }, include: { rows: true } });
  if (!batch || batch.studioId !== studioId) {
    return res.status(404).json({ error: "Import batch not found" });
  }

  if (batch.status === ImportBatchStatus.CANCELLED) {
    return res.status(400).json({ error: "This batch has been cancelled" });
  }

  if (batch.status === ImportBatchStatus.COMPLETED) {
    return res.status(400).json({ error: "This batch has already been executed" });
  }

  if (batch.status === ImportBatchStatus.MAPPING) {
    return res.status(400).json({ error: "Confirm this batch's column mapping before executing it" });
  }

  const undecided = batch.rows.filter((r) => !r.decision);
  if (undecided.length > 0) {
    return res.status(400).json({
      error: `${undecided.length} row(s) still need a decision (Add, Merge, or Skip) before this batch can be executed`,
    });
  }

  const unresolvedOutliers = batch.rows.filter((r) => r.depositFlaggedAsOutlier && !r.depositDecision);
  if (unresolvedOutliers.length > 0) {
    return res.status(400).json({
      error: `${unresolvedOutliers.length} row(s) have a deposit amount flagged as unusual and need a deposit decision (Import, Skip, or Edit) before this batch can be executed`,
    });
  }

  const mapping = batch.columnMapping as Record<string, ImportTargetField>;
  const settings = await prisma.studioSettings.findUnique({ where: { studioId }, select: { giftCardDefaultExpirationDays: true } });
  const giftCardExpiresAt = computeGiftCardExpiration(settings?.giftCardDefaultExpirationDays ?? null);

  // A legacy CRM export has no concept of service lines -- every imported
  // row is tagged as the studio's own "Tattoo" service, same as every other
  // pre-existing Inquiry (see 20260725153000_backfill_inquiry_service).
  const tattooService = await prisma.service.findFirst({ where: { studioId, slug: "tattoo" }, select: { id: true } });
  if (!tattooService) {
    return res.status(500).json({ error: "This studio has no Tattoo service configured -- contact support" });
  }

  // Per-row, not one giant transaction -- a single bad row (a stale
  // matched-client reference, a rare constraint clash) fails that row
  // alone rather than rolling back an entire large import. Each row's OWN
  // identity-defining writes (client + inquiry + note) are still fully
  // atomic; gift-card issuance happens right after, same as every other
  // gift-card-issuing route in this app (never wrapped in the same
  // transaction as the client/inquiry writes that precede it).
  const results: { rowId: string; decision: string; success: boolean; error?: string; clientId?: string; giftCardId?: string }[] = [];

  for (const row of batch.rows) {
    try {
      if (row.decision === ImportRowDecision.SKIP) {
        await prisma.importRow.update({ where: { id: row.id }, data: { processedAt: new Date() } });
        results.push({ rowId: row.id, decision: row.decision, success: true });
        continue;
      }

      const raw = row.rawData as Record<string, unknown>;
      const compositeAddress = composeAddress({
        street: getMappedRawValue(raw, mapping, "address.street"),
        city: getMappedRawValue(raw, mapping, "address.city"),
        state: getMappedRawValue(raw, mapping, "address.state"),
        postalCode: getMappedRawValue(raw, mapping, "address.postalCode"),
      });
      const fields = {
        firstName: getMappedRawValue(raw, mapping, "firstName") ?? "",
        lastName: getMappedRawValue(raw, mapping, "lastName") ?? "",
        email: getMappedRawValue(raw, mapping, "email"),
        phone: getMappedRawValue(raw, mapping, "phone"),
        // Mutually exclusive by construction (validateColumnMapping
        // rejects a mapping with both), so at most one of these is ever
        // actually non-null in practice.
        address: getMappedRawValue(raw, mapping, "address") ?? compositeAddress,
      };

      const inquiryFields = {
        description: getMappedRawValue(raw, mapping, "inquiry.description") ?? "",
        placement: getMappedRawValue(raw, mapping, "inquiry.placement") ?? "",
        estimatedSize: getMappedRawValue(raw, mapping, "inquiry.size") ?? "",
        budget: getMappedRawValue(raw, mapping, "inquiry.budget"),
        desiredTiming: getMappedRawValue(raw, mapping, "inquiry.desiredTiming"),
      };

      const noteLines = getNoteHeaders(mapping)
        .map((header) => {
          const value = typeof raw[header] === "string" ? (raw[header] as string).trim() : "";
          return value ? `<strong>${escapeHtml(header)}:</strong> ${escapeHtml(value)}` : null;
        })
        .filter((line): line is string => line !== null);

      // Nothing silently lost: an assigned-artist column that never
      // resolved to a real Artist (no match found, or staff never picked
      // one during review) still has its original raw text preserved here
      // as a fallback line, even if staff didn't separately map that same
      // column to Historical Note.
      const rawArtistName = getMappedRawValue(raw, mapping, "inquiry.assignedArtist");
      if (rawArtistName && !row.matchedArtistId) {
        noteLines.push(`<strong>Artist (from import, unmatched):</strong> ${escapeHtml(rawArtistName)}`);
      }

      const noteBodyHtml = noteLines.length > 0 ? `<p><em>Imported from legacy CRM</em></p><p>${noteLines.join("<br/>")}</p>` : null;

      const referralCode = await generateUniqueReferralCode();
      const created = await prisma.$transaction((tx) =>
        createImportedClientWithInquiry(tx, {
          studioId,
          actorUserId: req.user!.userId,
          referralCode,
          fields,
          inquiryFields,
          assignedArtistId: row.matchedArtistId,
          noteBodyHtml,
          serviceId: tattooService.id,
        }),
      );

      let finalClientId: string;

      if (row.decision === ImportRowDecision.ADD) {
        finalClientId = created.clientId;

        await logAudit({
          studioId,
          actorUserId: req.user!.userId,
          entityType: "Client",
          entityId: finalClientId,
          action: "create-from-import",
          changes: { importBatchId: batchId, importRowId: row.id },
        });
      } else {
        // MERGE: matchedClientId is guaranteed set here (enforced when
        // the decision was recorded), but it's re-validated fresh
        // regardless, in case the matched client was itself merged away
        // by someone else between review and execute.
        const validation = await validateMergePair(studioId, row.matchedClientId!, created.clientId);
        if ("error" in validation) {
          results.push({ rowId: row.id, decision: row.decision!, success: false, error: validation.error });
          continue;
        }

        await prisma.$transaction((tx) => performMerge(tx, created.clientId, row.matchedClientId!));
        finalClientId = row.matchedClientId!;

        await logAudit({
          studioId,
          actorUserId: req.user!.userId,
          entityType: "Client",
          entityId: finalClientId,
          action: "merge-from-import",
          changes: { importBatchId: batchId, importRowId: row.id, sourceClientId: created.clientId },
        });
      }

      const giftCardCents = rowGiftCardCents(row);
      let giftCardId: string | undefined;

      if (giftCardCents != null && giftCardCents > 0) {
        const code = await generateUniqueGiftCardCode();
        const card = await prisma.giftCard.create({
          data: {
            studioId,
            clientId: finalClientId,
            code,
            amountCents: giftCardCents,
            expiresAt: giftCardExpiresAt,
            issuedById: req.user!.userId,
            // Reuses the same free-text reason field EXEMPT cards use for
            // their own "why does this card exist" note -- the batch id
            // is enough to trace this specific card back to its source
            // CSV row via this batch's own ImportRow rows (rawData is
            // preserved verbatim on every one of them), matching the
            // AuditLog-based traceability already used for imported
            // Client rows above.
            exemptionReason: `Imported from legacy CRM (Import Batch ${batchId})`,
          },
        });
        giftCardId = card.id;

        await logAudit({
          studioId,
          actorUserId: req.user!.userId,
          entityType: "GiftCard",
          entityId: card.id,
          action: "create-from-import",
          changes: { importBatchId: batchId, importRowId: row.id, amountCents: giftCardCents },
        });
      }

      await prisma.importRow.update({ where: { id: row.id }, data: { processedAt: new Date() } });
      results.push({ rowId: row.id, decision: row.decision!, success: true, clientId: finalClientId, giftCardId });
    } catch (err) {
      results.push({
        rowId: row.id,
        decision: row.decision ?? "unknown",
        success: false,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  await prisma.importBatch.update({ where: { id: batchId }, data: { status: ImportBatchStatus.COMPLETED } });

  await logAudit({
    studioId,
    actorUserId: req.user!.userId,
    entityType: "ImportBatch",
    entityId: batchId,
    action: "executed",
    changes: {
      added: results.filter((r) => r.decision === ImportRowDecision.ADD && r.success).length,
      merged: results.filter((r) => r.decision === ImportRowDecision.MERGE && r.success).length,
      skipped: results.filter((r) => r.decision === ImportRowDecision.SKIP && r.success).length,
      failed: results.filter((r) => !r.success).length,
      giftCardsIssued: results.filter((r) => r.giftCardId).length,
    },
  });

  // Real-time audit (Part 2): a large OWNER-run import creates real,
  // permanent Client/Inquiry/GiftCard rows, but previously never told any
  // other connected staff -- the Clients list and Inquiries board have
  // real, already-live-consumed query keys (["clients"], ["inquiries"])
  // that this simply never fired into.
  emitInvalidation({ type: "client.imported", studioId });
  emitInvalidation({ type: "inquiry.created", studioId });

  res.json({ status: ImportBatchStatus.COMPLETED, results });
});

export default router;
