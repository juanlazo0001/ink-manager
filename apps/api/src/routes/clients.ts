import { Router } from "express";
import crypto from "node:crypto";
import { prisma } from "../lib/prisma";
import type { Prisma } from "../../generated/prisma/client";
import { requireAuth } from "../middleware/auth";
import { requirePermission } from "../lib/permissions";
import { diffObjects, logAudit } from "../lib/audit";
import { normalizePhone } from "../lib/phone";
import { PUBLIC_APP_URL } from "../lib/publicUrl";

const router = Router();

const CONSENT_FORM_TOKEN_TTL_HOURS = 48;

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
    data: { firstName, lastName, email, phone: phone ? normalizePhone(phone) : phone, studioId: req.user!.studioId },
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

// Backs the conversation composer's "+" form-link menu: every shareable
// public link this client already has, plus disabled placeholders (with a
// hint) for entities that exist but have no active link yet. Deliberately
// does NOT generate/rotate any token -- that stays on the inquiry/
// appointment pages, this is read-only.
router.get("/:id/shareable-links", async (req, res) => {
  const id = req.params.id as string;
  const now = new Date();

  const client = await prisma.client.findUnique({
    where: { id },
    include: {
      studio: { select: { slug: true } },
      inquiries: {
        select: {
          id: true,
          description: true,
          estimateToken: true,
          estimateTokenExpiresAt: true,
          depositForm: { select: { token: true, tokenExpiresAt: true, signedAt: true } },
        },
        orderBy: { createdAt: "desc" },
      },
      giftCards: { select: { id: true, code: true, amountCents: true }, orderBy: { createdAt: "desc" } },
      appointments: {
        select: {
          id: true,
          startTime: true,
          liabilityWaiver: { select: { token: true, tokenExpiresAt: true, status: true } },
        },
        orderBy: { startTime: "desc" },
      },
    },
  });

  if (!client || client.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Client not found" });
  }

  const estimateLinks = client.inquiries.map((inquiry) => {
    const active = inquiry.estimateToken && inquiry.estimateTokenExpiresAt && inquiry.estimateTokenExpiresAt > now;
    return {
      inquiryId: inquiry.id,
      label: `Estimate — ${inquiry.description.slice(0, 40)}`,
      url: active ? `${PUBLIC_APP_URL}/estimate/${inquiry.estimateToken}` : null,
      hint: active ? null : "Generate from the inquiry page",
    };
  });

  const depositLinks = client.inquiries
    .filter((inquiry) => inquiry.depositForm)
    .map((inquiry) => {
      const form = inquiry.depositForm!;
      const active = !form.signedAt && form.tokenExpiresAt > now;
      return {
        inquiryId: inquiry.id,
        label: `Deposit form — ${inquiry.description.slice(0, 40)}`,
        url: active ? `${PUBLIC_APP_URL}/deposit/${form.token}` : null,
        hint: active ? null : form.signedAt ? "Already signed" : "Generate from the inquiry page",
      };
    });

  const waiverLinks = client.appointments
    .filter((appointment) => appointment.liabilityWaiver)
    .map((appointment) => {
      const waiver = appointment.liabilityWaiver!;
      const active = waiver.status === "PENDING" && waiver.token && waiver.tokenExpiresAt && waiver.tokenExpiresAt > now;
      return {
        appointmentId: appointment.id,
        label: `Waiver — ${new Date(appointment.startTime).toLocaleDateString()}`,
        url: active ? `${PUBLIC_APP_URL}/waiver/${waiver.token}` : null,
        hint: active ? null : "Generate from the appointment page",
      };
    });

  // Gift card public pages never expire (the code is a permanent bearer
  // token -- Phase 3), so every gift card the client has is always active.
  const giftCardLinks = client.giftCards.map((card) => ({
    giftCardId: card.id,
    label: `Gift card — $${(card.amountCents / 100).toFixed(2)}`,
    url: `${PUBLIC_APP_URL}/gift-card/${card.code}`,
    hint: null,
  }));

  res.json({
    intakeFormUrl: `${PUBLIC_APP_URL}/inquiry/${client.studio.slug}`,
    estimateLinks,
    depositLinks,
    waiverLinks,
    giftCardLinks,
  });
});

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
    } else if (field === "phone") {
      if (body.phone !== null && typeof body.phone !== "string") {
        return res.status(400).json({ error: "phone must be a string or null" });
      }
      data.phone = typeof body.phone === "string" && body.phone.trim() ? normalizePhone(body.phone) : null;
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

// Conversation.clientId is unique (one thread per client, ever) so it
// can't be handled by the blind updateMany in repointClientRelations above
// -- if the survivor already has its own thread, re-pointing the source's
// thread onto the same clientId would violate that constraint and blow up
// the whole merge transaction. Handled as its own step instead:
//   - source has no thread: nothing to do.
//   - only source has a thread: simple re-point.
//   - both have one: fold the source thread's messages into the survivor's
//     thread (so nothing is lost), merge per-user read state (keep the
//     more recent lastReadAt), then delete the now-empty source thread.
async function mergeConversations(
  tx: Prisma.TransactionClient,
  sourceClientId: string,
  survivorClientId: string,
): Promise<{ merged: boolean; movedMessages: number }> {
  const [sourceConversation, survivorConversation] = await Promise.all([
    tx.conversation.findUnique({ where: { clientId: sourceClientId } }),
    tx.conversation.findUnique({ where: { clientId: survivorClientId } }),
  ]);

  if (!sourceConversation) {
    return { merged: false, movedMessages: 0 };
  }

  if (!survivorConversation) {
    await tx.conversation.update({ where: { id: sourceConversation.id }, data: { clientId: survivorClientId } });
    return { merged: false, movedMessages: 0 };
  }

  const movedMessages = await tx.message.updateMany({
    where: { conversationId: sourceConversation.id },
    data: { conversationId: survivorConversation.id },
  });

  const newestLastMessageAt =
    [sourceConversation.lastMessageAt, survivorConversation.lastMessageAt]
      .filter((d): d is Date => d !== null)
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

  await tx.conversation.update({
    where: { id: survivorConversation.id },
    data: { lastMessageAt: newestLastMessageAt },
  });

  const sourceReads = await tx.conversationRead.findMany({ where: { conversationId: sourceConversation.id } });

  for (const read of sourceReads) {
    const survivorRead = await tx.conversationRead.findUnique({
      where: { conversationId_userId: { conversationId: survivorConversation.id, userId: read.userId } },
    });

    if (survivorRead) {
      if (read.lastReadAt > survivorRead.lastReadAt) {
        await tx.conversationRead.update({ where: { id: survivorRead.id }, data: { lastReadAt: read.lastReadAt } });
      }
      await tx.conversationRead.delete({ where: { id: read.id } });
    } else {
      await tx.conversationRead.update({ where: { id: read.id }, data: { conversationId: survivorConversation.id } });
    }
  }

  await tx.conversation.delete({ where: { id: sourceConversation.id } });

  return { merged: true, movedMessages: movedMessages.count };
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

  const { repointCounts, conversationResult } = await prisma.$transaction(async (tx) => {
    const repointCounts = await repointClientRelations(tx, sourceClientId, id);
    const conversationResult = await mergeConversations(tx, sourceClientId, id);
    await tx.client.update({ where: { id: sourceClientId }, data: { mergedIntoId: id } });
    return { repointCounts, conversationResult };
  });

  await logAudit({
    studioId: req.user!.studioId,
    actorUserId: req.user!.userId,
    entityType: "Client",
    entityId: id,
    action: "merge",
    changes: { sourceClientId, survivorId: id, repointed: repointCounts, conversation: conversationResult },
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

  res.status(201).json({ ...consentForm, signingUrl: `${PUBLIC_APP_URL}/sign/${signingToken}` });
});

export default router;
