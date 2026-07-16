import { Router } from "express";
import crypto from "node:crypto";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { requirePermission } from "../lib/permissions";

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

router.get("/", async (req, res) => {
  const clients = await prisma.client.findMany({
    where: { studioId: req.user!.studioId },
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
        select: { id: true, description: true, status: true, channel: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!client || client.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Client not found" });
  }

  res.json(client);
});

// Folds a duplicate client record into this one: every appointment, consent
// form, and inquiry the duplicate had gets reassigned here, then the
// duplicate is deleted. firstName/lastName/email/phone come from the
// request because staff pick the correct value per field when the two
// records disagree -- this isn't a simple "keep the newer one" merge.
router.post("/:id/merge", async (req, res) => {
  const id = req.params.id as string;
  const body = req.body ?? {};
  const { duplicateId, firstName, lastName, email, phone } = body;

  if (!duplicateId) {
    return res.status(400).json({ error: "duplicateId is required" });
  }

  if (duplicateId === id) {
    return res.status(400).json({ error: "A client cannot be merged with itself" });
  }

  if (!firstName || !lastName) {
    return res.status(400).json({ error: "firstName and lastName are required" });
  }

  const [survivor, duplicate] = await Promise.all([
    prisma.client.findUnique({ where: { id } }),
    prisma.client.findUnique({ where: { id: duplicateId } }),
  ]);

  if (!survivor || survivor.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Client not found" });
  }

  if (!duplicate || duplicate.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Duplicate client not found" });
  }

  if (survivor.userId && duplicate.userId) {
    return res
      .status(400)
      .json({ error: "Both clients have a linked portal account -- resolve that manually before merging" });
  }

  const [, merged] = await prisma.$transaction([
    // Frees up the unique userId slot before the survivor can claim it --
    // both updates touching the same userId in one statement would violate
    // the unique constraint even within this transaction.
    prisma.client.update({ where: { id: duplicateId }, data: { userId: null } }),
    prisma.client.update({
      where: { id },
      data: {
        firstName,
        lastName,
        email: email || null,
        phone: phone || null,
        userId: survivor.userId ?? duplicate.userId ?? null,
      },
    }),
    prisma.appointment.updateMany({ where: { clientId: duplicateId }, data: { clientId: id } }),
    prisma.consentForm.updateMany({ where: { clientId: duplicateId }, data: { clientId: id } }),
    prisma.inquiry.updateMany({ where: { clientId: duplicateId }, data: { clientId: id } }),
    prisma.client.delete({ where: { id: duplicateId } }),
  ]);

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
