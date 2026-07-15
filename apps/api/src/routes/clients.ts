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
  const clients = await prisma.client.findMany({ where: { studioId: req.user!.studioId } });
  res.json(clients);
});

router.get("/:id", async (req, res) => {
  const id = req.params.id as string;
  const client = await prisma.client.findUnique({
    where: { id },
    include: {
      consentForms: { select: { id: true, signedAt: true, createdAt: true }, orderBy: { createdAt: "desc" } },
    },
  });

  if (!client || client.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Client not found" });
  }

  res.json(client);
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
