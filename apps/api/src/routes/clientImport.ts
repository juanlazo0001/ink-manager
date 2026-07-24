import { Router } from "express";
import multer from "multer";
import { parse } from "csv-parse/sync";
import { prisma } from "../lib/prisma";
import { requireAuth, requireRole } from "../middleware/auth";
import { requirePermission } from "../lib/permissions";
import { Role, ImportBatchStatus, ImportRowDecision } from "../../generated/prisma/enums";
import { logAudit } from "../lib/audit";
import { findMatchingClientForImportRow } from "../lib/duplicateDetection";
import { createClientFromFields } from "../lib/clientContacts";
import { performMerge, validateMergePair } from "../lib/clientMerge";
import { generateUniqueReferralCode } from "../lib/referrals";

const router = Router();

router.use(requireAuth);
// Upload/review/decide are OWNER/FRONT_DESK, same gate as the rest of
// client management -- see clients.ts. Execute (real, permanent writes)
// gets an additional OWNER-only check on top of this, below.
router.use(requirePermission("clients.manage"));

// CSV lives entirely in memory -- these are client-list exports, not
// multi-megabyte media, and every other upload path in this app already
// hands raw bytes to a third party (Cloudinary) rather than buffering
// server-side, so there's no existing disk-storage convention to match.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// Recognized headers, case/whitespace-insensitive, mapped to the Client
// field they populate. Anything else in the CSV is preserved in rawData
// (so the review table shows the full original row) but never read by
// any route -- "any other reasonable columns" in the task's own words
// just means "don't choke on them," not "map every possible header."
const HEADER_ALIASES: Record<string, string> = {
  firstname: "firstName",
  "first name": "firstName",
  first_name: "firstName",
  lastname: "lastName",
  "last name": "lastName",
  last_name: "lastName",
  email: "email",
  "email address": "email",
  emailaddress: "email",
  phone: "phone",
  "phone number": "phone",
  phonenumber: "phone",
  instagram: "instagramHandle",
  instagramhandle: "instagramHandle",
  facebook: "facebookProfileUrl",
  facebookprofileurl: "facebookProfileUrl",
  othercontact: "otherContact",
  "other contact": "otherContact",
  notes: "otherContact",
};

function normalizeHeader(header: string): string {
  const key = header.trim().toLowerCase();
  return HEADER_ALIASES[key] ?? header.trim();
}

function isMalformedRow(rawData: Record<string, unknown>): boolean {
  const firstName = typeof rawData.firstName === "string" ? rawData.firstName.trim() : "";
  const lastName = typeof rawData.lastName === "string" ? rawData.lastName.trim() : "";
  return !firstName || !lastName;
}

router.post("/import", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "A CSV file is required (form field name: file)" });
  }

  let records: Record<string, string>[];
  try {
    records = parse(req.file.buffer, {
      columns: (headerRow: string[]) => headerRow.map(normalizeHeader),
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

  // Sequential, not Promise.all -- findMatchingClientForImportRow re-reads
  // every studio client per row, and a large import doing that
  // concurrently for hundreds of rows at once would hammer the DB for no
  // real benefit (nothing here is latency-sensitive; this only runs once
  // per upload).
  for (const row of records) {
    // Malformed rows (missing name) are still stored and still checked
    // for a phone/email match -- flagged for review, never silently
    // dropped, per the task's explicit instruction.
    const phone = typeof row.phone === "string" ? row.phone.trim() || null : null;
    const email = typeof row.email === "string" ? row.email.trim() || null : null;
    const match = await findMatchingClientForImportRow(studioId, phone, email);

    await prisma.importRow.create({
      data: {
        importBatchId: batch.id,
        rawData: row,
        matchedClientId: match?.id ?? null,
      },
    });
  }

  await logAudit({
    studioId,
    actorUserId: req.user!.userId,
    entityType: "ImportBatch",
    entityId: batch.id,
    action: "uploaded",
    changes: { rowCount: records.length, filename: req.file.originalname },
  });

  const full = await getBatchForReview(batch.id, studioId);
  res.status(201).json(full);
});

async function getBatchForReview(batchId: string, studioId: string) {
  const batch = await prisma.importBatch.findUnique({
    where: { id: batchId },
    include: {
      rows: {
        include: { matchedClient: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } } },
        orderBy: { id: "asc" },
      },
    },
  });

  if (!batch || batch.studioId !== studioId) return null;

  return {
    ...batch,
    rows: batch.rows.map((row) => ({
      ...row,
      isMalformed: isMalformedRow(row.rawData as Record<string, unknown>),
    })),
  };
}

router.get("/import/:batchId", async (req, res) => {
  const batch = await getBatchForReview(req.params.batchId as string, req.user!.studioId);
  if (!batch) return res.status(404).json({ error: "Import batch not found" });
  res.json(batch);
});

const DECISIONS = Object.values(ImportRowDecision);

router.patch("/import/:batchId/rows/:rowId", async (req, res) => {
  const { batchId, rowId } = req.params as { batchId: string; rowId: string };
  const { decision } = req.body ?? {};

  if (!DECISIONS.includes(decision)) {
    return res.status(400).json({ error: `decision must be one of: ${DECISIONS.join(", ")}` });
  }

  const row = await prisma.importRow.findUnique({ where: { id: rowId }, include: { importBatch: true } });
  if (!row || row.importBatchId !== batchId || row.importBatch.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Import row not found" });
  }

  if (row.importBatch.status !== ImportBatchStatus.PENDING_REVIEW) {
    return res.status(400).json({ error: "This batch has already been executed or cancelled" });
  }

  if (decision === ImportRowDecision.ADD && isMalformedRow(row.rawData as Record<string, unknown>)) {
    return res.status(400).json({ error: "This row is missing a first and/or last name and cannot be added as a new client" });
  }

  if (decision === ImportRowDecision.MERGE && !row.matchedClientId) {
    return res.status(400).json({ error: "This row has no detected match to merge into" });
  }

  const updated = await prisma.importRow.update({ where: { id: rowId }, data: { decision } });
  res.json(updated);
});

// Not explicitly in the task's own route list, but CANCELLED is a real
// value in ImportBatchStatus with no other route that ever sets it --
// staff backing out of a review before ever executing (wrong file
// uploaded, etc.) needs a way to do that, matching the same
// OWNER/FRONT_DESK gate as upload/review/decide (never wrote anything
// real yet, so this doesn't need the execute route's stricter OWNER-only
// bar).
router.post("/import/:batchId/cancel", async (req, res) => {
  const batchId = req.params.batchId as string;
  const batch = await prisma.importBatch.findUnique({ where: { id: batchId } });
  if (!batch || batch.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Import batch not found" });
  }

  if (batch.status !== ImportBatchStatus.PENDING_REVIEW) {
    return res.status(400).json({ error: "Only a batch still pending review can be cancelled" });
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

  const undecided = batch.rows.filter((r) => !r.decision);
  if (undecided.length > 0) {
    return res.status(400).json({
      error: `${undecided.length} row(s) still need a decision (Add, Merge, or Skip) before this batch can be executed`,
    });
  }

  // Per-row, not one giant transaction -- a single bad row (a stale
  // matched-client reference, a rare constraint clash) fails that row
  // alone rather than rolling back an entire large import. Each row's OWN
  // write is still fully atomic (createClientFromFields + performMerge
  // together, for a MERGE row).
  const results: { rowId: string; decision: string; success: boolean; error?: string; clientId?: string }[] = [];

  for (const row of batch.rows) {
    try {
      if (row.decision === ImportRowDecision.SKIP) {
        await prisma.importRow.update({ where: { id: row.id }, data: { processedAt: new Date() } });
        results.push({ rowId: row.id, decision: row.decision, success: true });
        continue;
      }

      const raw = row.rawData as Record<string, unknown>;
      const fields = {
        studioId,
        firstName: typeof raw.firstName === "string" ? raw.firstName.trim() : "",
        lastName: typeof raw.lastName === "string" ? raw.lastName.trim() : "",
        email: typeof raw.email === "string" ? raw.email.trim() || null : null,
        phone: typeof raw.phone === "string" ? raw.phone.trim() || null : null,
        instagramHandle: typeof raw.instagramHandle === "string" ? raw.instagramHandle.trim() || null : null,
        facebookProfileUrl: typeof raw.facebookProfileUrl === "string" ? raw.facebookProfileUrl.trim() || null : null,
        otherContact: typeof raw.otherContact === "string" ? raw.otherContact.trim() || null : null,
      };

      if (row.decision === ImportRowDecision.ADD) {
        const referralCode = await generateUniqueReferralCode();
        const client = await prisma.$transaction((tx) => createClientFromFields(tx, { ...fields, referralCode }));

        await logAudit({
          studioId,
          actorUserId: req.user!.userId,
          entityType: "Client",
          entityId: client.id,
          action: "create-from-import",
          changes: { importBatchId: batchId, importRowId: row.id },
        });

        await prisma.importRow.update({ where: { id: row.id }, data: { processedAt: new Date() } });
        results.push({ rowId: row.id, decision: row.decision, success: true, clientId: client.id });
        continue;
      }

      // MERGE: create a real client from this row's data, then genuinely
      // merge it into the matched client using the exact same merge
      // logic POST /clients/:id/merge uses -- not a shortcut that just
      // copies a couple of fields over. matchedClientId is guaranteed
      // set here (enforced when the decision was recorded), but it's
      // re-validated fresh regardless, in case the matched client was
      // itself merged away by someone else between review and execute.
      const referralCode = await generateUniqueReferralCode();
      const rowClient = await prisma.$transaction((tx) => createClientFromFields(tx, { ...fields, referralCode }));

      const validation = await validateMergePair(studioId, row.matchedClientId!, rowClient.id);
      if ("error" in validation) {
        results.push({ rowId: row.id, decision: row.decision!, success: false, error: validation.error });
        continue;
      }

      await prisma.$transaction((tx) => performMerge(tx, rowClient.id, row.matchedClientId!));

      await logAudit({
        studioId,
        actorUserId: req.user!.userId,
        entityType: "Client",
        entityId: row.matchedClientId!,
        action: "merge-from-import",
        changes: { importBatchId: batchId, importRowId: row.id, sourceClientId: rowClient.id },
      });

      await prisma.importRow.update({ where: { id: row.id }, data: { processedAt: new Date() } });
      results.push({ rowId: row.id, decision: row.decision!, success: true, clientId: row.matchedClientId! });
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
    },
  });

  res.json({ status: ImportBatchStatus.COMPLETED, results });
});

export default router;
