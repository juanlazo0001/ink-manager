import { Router } from "express";
import { prisma } from "../lib/prisma";

const router = Router();

function isExpiredOrInvalid(consentForm: { signedAt: Date | null; tokenExpiresAt: Date | null } | null) {
  if (!consentForm) {
    return { code: "invalid", error: "This link is invalid." } as const;
  }

  if (consentForm.signedAt) {
    return { code: "already_signed", error: "This consent form has already been signed." } as const;
  }

  if (!consentForm.tokenExpiresAt || consentForm.tokenExpiresAt < new Date()) {
    return { code: "expired", error: "This link has expired." } as const;
  }

  return null;
}

router.get("/verify/:token", async (req, res) => {
  const token = req.params.token as string;

  const consentForm = await prisma.consentForm.findUnique({
    where: { signingToken: token },
    include: { client: { include: { studio: true } } },
  });

  const invalidity = isExpiredOrInvalid(consentForm);
  if (invalidity) {
    const status = invalidity.code === "invalid" ? 404 : 410;
    return res.status(status).json(invalidity);
  }

  res.json({
    clientFirstName: consentForm!.client.firstName,
    studioName: consentForm!.client.studio.name,
  });
});

router.patch("/sign/:token", async (req, res) => {
  const token = req.params.token as string;
  const { signatureData } = req.body ?? {};

  if (!signatureData || typeof signatureData !== "string") {
    return res.status(400).json({ error: "signatureData is required" });
  }

  const consentForm = await prisma.consentForm.findUnique({ where: { signingToken: token } });

  const invalidity = isExpiredOrInvalid(consentForm);
  if (invalidity) {
    const status = invalidity.code === "invalid" ? 404 : 410;
    return res.status(status).json(invalidity);
  }

  await prisma.consentForm.update({
    where: { id: consentForm!.id },
    data: { signedAt: new Date(), signatureData, signingToken: null, tokenExpiresAt: null },
  });

  res.json({ success: true });
});

export default router;
