import { Router } from "express";
import crypto from "node:crypto";
import { prisma } from "../lib/prisma";
import type { Prisma } from "../../generated/prisma/client";
import { requireAuth } from "../middleware/auth";
import { requirePermission } from "../lib/permissions";
import { diffObjects, logAudit } from "../lib/audit";

const router = Router();

const CONSENT_FORM_TOKEN_TTL_HOURS = 48;
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

router.use(requireAuth);
router.use(requirePermission("clients.manage"));

router.post("/", async (req, res) => {
  const body = req.body ?? {};

  const missing = ["firstName", "lastName"].filter((field) => !body[field]);
  if (missing.length > 0) {
    return res.status(400).json({ error: `Missing required field(s): ${missing.join(", ")}` });
  }

  const { firstName, lastName, email, phone } = body;

  const client = await prisma.client.create({
    data: { firstName, lastName, email, phone, studioId: req.user!.studioId },
  });

  res.status(201).json(client);
});

// Merged clients are folded into their survivor and excluded from every
// list -- they still exist (soft-merge), but shouldn't show up as if they
// were a separate active client.
const NOT_MERGED = { mergedIntoId: null } as const;

router.get("/", async (req, res) => {
  const clients = await prisma.client.findMany({
    where: { studioId: req.user!.studioId, ...NOT_MERGED },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  res.json(clients);
});

router.get("/:id", async (req, res) => {
  const id = req.params.id as string;
  const client = await prisma.client.findUnique({
    where: { id },
    include: {
      consentForms: { select: { id: true, signedAt: true, createdAt: true }, orderBy: { createdAt: "desc" } },
      inquiries: {
        select: {
          id: true,
          description: true,
          status: true,
          channel: true,
          createdAt: true,
          depositForm: {
            select: {
              id: true,
              depositAmount: true,
              feeAmount: true,
              totalCharged: true,
              signedAt: true,
              paidManually: true,
              paidAt: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      },
      giftCards: {
        select: {
          id: true,
          code: true,
          amountCents: true,
          status: true,
          expiresAt: true,
          appointmentId: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      },
      // Non-PII summary only -- the health data and ID image live behind
      // GET /waivers/:id, which is OWNER/FRONT_DESK only.
      liabilityWaivers: {
        select: { id: true, status: true, signedAt: true, verifiedAt: true, appointmentId: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      },
      mergedInto: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  if (!client || client.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Client not found" });
  }

  // A direct fetch of a merged client still succeeds (rather than 404) --
  // a stale bookmark, an old audit-log link, or a duplicate-detection result
  // should be able to show what it was merged into rather than dead-end.
  res.json(client);
});

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

// Other non-merged clients in this studio sharing an email or phone.
// Exact-match only (after normalizing phone formatting) -- no fuzzy name
// matching, keeping false positives at zero.
router.get("/:id/potential-duplicates", async (req, res) => {
  const id = req.params.id as string;

  const client = await prisma.client.findUnique({ where: { id } });
  if (!client || client.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Client not found" });
  }

  const candidates = await prisma.client.findMany({
    where: { studioId: req.user!.studioId, id: { not: id }, ...NOT_MERGED },
  });

  const normalizedPhone = client.phone ? normalizePhone(client.phone) : null;

  const duplicates = candidates.filter((candidate) => {
    if (client.email && candidate.email && candidate.email.toLowerCase() === client.email.toLowerCase()) {
      return true;
    }
    if (normalizedPhone && candidate.phone && normalizePhone(candidate.phone) === normalizedPhone) {
      return true;
    }
    return false;
  });

  res.json(duplicates);
});

const EDITABLE_CLIENT_FIELDS = ["firstName", "lastName", "email", "phone"] as const;

router.patch("/:id", async (req, res) => {
  const id = req.params.id as string;
  const body = req.body ?? {};

  const client = await prisma.client.findUnique({ where: { id } });
  if (!client || client.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Client not found" });
  }

  if (client.mergedIntoId) {
    return res.status(400).json({ error: "This client has been merged and can no longer be edited directly" });
  }

  const data: Record<string, string | null> = {};

  for (const field of EDITABLE_CLIENT_FIELDS) {
    if (body[field] === undefined) continue;

    if (field === "firstName" || field === "lastName") {
      if (typeof body[field] !== "string" || body[field].trim().length === 0) {
        return res.status(400).json({ error: `${field} must be a non-empty string` });
      }
      data[field] = body[field].trim();
    } else {
      if (body[field] !== null && typeof body[field] !== "string") {
        return res.status(400).json({ error: `${field} must be a string or null` });
      }
      data[field] = typeof body[field] === "string" ? body[field].trim() || null : null;
    }
  }

  const updated = await prisma.client.update({ where: { id }, data });

  await logAudit({
    studioId: req.user!.studioId,
    actorUserId: req.user!.userId,
    entityType: "Client",
    entityId: id,
    action: "update",
    changes: diffObjects(client, data, EDITABLE_CLIENT_FIELDS as unknown as (keyof typeof client)[]),
  });

  res.json(updated);
});

// Every model with a direct clientId FK -- re-enumerate this on future
// schema changes rather than assuming the list below stays complete.
// (DepositForm relates via Inquiry, not Client directly, so it moves for
// free when Inquiry does and doesn't need its own re-point here.)
async function repointClientRelations(tx: Prisma.TransactionClient, sourceId: string, survivorId: string) {
  const [appointments, consentForms, inquiries, giftCards] = await Promise.all([
    tx.appointment.updateMany({ where: { clientId: sourceId }, data: { clientId: survivorId } }),
    tx.consentForm.updateMany({ where: { clientId: sourceId }, data: { clientId: survivorId } }),
    tx.inquiry.updateMany({ where: { clientId: sourceId }, data: { clientId: survivorId } }),
    tx.giftCard.updateMany({ where: { clientId: sourceId }, data: { clientId: survivorId } }),
  ]);

  return {
    Appointment: appointments.count,
    ConsentForm: consentForms.count,
    Inquiry: inquiries.count,
    GiftCard: giftCards.count,
  };
}

// Soft-merge: the source client survives (marked via mergedIntoId) rather
// than being deleted, so its history stays inspectable. Every FK the
// source held moves to the survivor; nothing about the survivor's own
// fields changes -- edit those separately via PATCH /clients/:id if needed.
router.post("/:id/merge", async (req, res) => {
  const id = req.params.id as string;
  const body = req.body ?? {};
  const { sourceClientId } = body;

  if (!sourceClientId) {
    return res.status(400).json({ error: "sourceClientId is required" });
  }

  if (sourceClientId === id) {
    return res.status(400).json({ error: "A client cannot be merged with itself" });
  }

  const [survivor, source] = await Promise.all([
    prisma.client.findUnique({ where: { id } }),
    prisma.client.findUnique({ where: { id: sourceClientId } }),
  ]);

  if (!survivor || survivor.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Client not found" });
  }

  if (!source || source.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Source client not found" });
  }

  if (survivor.mergedIntoId) {
    return res.status(400).json({ error: "The survivor client has itself already been merged into another client" });
  }

  if (source.mergedIntoId) {
    return res.status(400).json({ error: "The source client has already been merged" });
  }

  const counts = await prisma.$transaction(async (tx) => {
    const repointCounts = await repointClientRelations(tx, sourceClientId, id);
    await tx.client.update({ where: { id: sourceClientId }, data: { mergedIntoId: id } });
    return repointCounts;
  });

  await logAudit({
    studioId: req.user!.studioId,
    actorUserId: req.user!.userId,
    entityType: "Client",
    entityId: id,
    action: "merge",
    changes: { sourceClientId, survivorId: id, repointed: counts },
  });

  const merged = await prisma.client.findUnique({ where: { id } });
  res.json(merged);
});

router.post("/:clientId/consent-forms", async (req, res) => {
  const clientId = req.params.clientId as string;

  const client = await prisma.client.findUnique({ where: { id: clientId } });

  if (!client || client.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Client not found" });
  }

  const signingToken = crypto.randomBytes(32).toString("hex");
  const tokenExpiresAt = new Date(Date.now() + CONSENT_FORM_TOKEN_TTL_HOURS * 60 * 60 * 1000);

  const consentForm = await prisma.consentForm.create({
    data: { clientId, signingToken, tokenExpiresAt },
  });

  res.status(201).json({ ...consentForm, signingUrl: `${FRONTEND_URL}/sign/${signingToken}` });
});

export default router;
