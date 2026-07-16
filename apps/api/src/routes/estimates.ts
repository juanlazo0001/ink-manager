import { Router } from "express";
import { prisma } from "../lib/prisma";
import { InquiryStatus } from "../../generated/prisma/enums";

const router = Router();

// Matches the SOP's collaborative-design-policy wording shown alongside
// every estimate — adjust here if the studio's actual policy text changes.
const COLLABORATIVE_DESIGN_POLICY =
  "No design is drawn in advance — it is created together with the client on the day of the appointment.";

function isExpiredOrInvalid(inquiry: { estimateTokenExpiresAt: Date | null } | null) {
  if (!inquiry) {
    return { code: "invalid", error: "This link is invalid." } as const;
  }

  if (!inquiry.estimateTokenExpiresAt || inquiry.estimateTokenExpiresAt < new Date()) {
    return { code: "expired", error: "This link has expired." } as const;
  }

  return null;
}

// Public: the estimate response link is unauthenticated, same pattern as
// consent form signing links.
router.get("/verify/:token", async (req, res) => {
  const token = req.params.token as string;

  const inquiry = await prisma.inquiry.findUnique({
    where: { estimateToken: token },
    include: { client: true, studio: true, assignedArtist: { include: { user: true } } },
  });

  const invalidity = isExpiredOrInvalid(inquiry);
  if (invalidity) {
    const status = invalidity.code === "invalid" ? 404 : 410;
    return res.status(status).json(invalidity);
  }

  res.json({
    clientFirstName: inquiry!.client.firstName,
    studioName: inquiry!.studio.name,
    artistName: inquiry!.assignedArtist?.user.name ?? null,
    priceEstimateLow: inquiry!.priceEstimateLow,
    priceEstimateHigh: inquiry!.priceEstimateHigh,
    timeEstimateHours: inquiry!.timeEstimateHours,
    collaborativeDesignPolicy: COLLABORATIVE_DESIGN_POLICY,
  });
});

const DECISIONS = ["PROCEED", "BUDGET_TOO_HIGH", "DECLINE"] as const;

router.patch("/respond/:token", async (req, res) => {
  const token = req.params.token as string;
  const { decision, statedBudget } = req.body ?? {};

  if (!DECISIONS.includes(decision)) {
    return res.status(400).json({ error: `decision must be one of: ${DECISIONS.join(", ")}` });
  }

  if (decision === "BUDGET_TOO_HIGH" && (typeof statedBudget !== "string" || statedBudget.trim().length === 0)) {
    return res.status(400).json({ error: "statedBudget is required when the budget is too high" });
  }

  const inquiry = await prisma.inquiry.findUnique({ where: { estimateToken: token } });

  const invalidity = isExpiredOrInvalid(inquiry);
  if (invalidity) {
    const status = invalidity.code === "invalid" ? 404 : 410;
    return res.status(status).json(invalidity);
  }

  const clearToken = { estimateToken: null, estimateTokenExpiresAt: null };

  if (decision === "PROCEED") {
    await prisma.inquiry.update({
      where: { id: inquiry!.id },
      data: { ...clearToken, status: InquiryStatus.SCHEDULING },
    });
  } else if (decision === "BUDGET_TOO_HIGH") {
    await prisma.inquiry.update({
      where: { id: inquiry!.id },
      data: { ...clearToken, status: InquiryStatus.BUDGET_NEGOTIATION, clientStatedBudget: statedBudget.trim() },
    });
  } else {
    await prisma.inquiry.update({
      where: { id: inquiry!.id },
      data: { ...clearToken, status: InquiryStatus.CLOSED_LOST, closedReason: "Client declined the estimate." },
    });
  }

  res.json({ success: true });
});

export default router;
