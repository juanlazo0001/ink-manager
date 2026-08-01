import { Router } from "express";
import { prisma } from "../lib/prisma";
import { DEFAULT_THEME_PRESET } from "../lib/themePresets";
import { createFlashPaymentCheckoutSession } from "../lib/flashPayments";
import { getChargeableConnectedAccountId } from "../lib/stripeConnect";

// Public, unauthenticated: same crypto-token + verify/checkout pattern as
// deposits.ts's own publicRouter, minus the signing step -- a flash
// booking has already been approved by front desk (POST /inquiries/:id/
// flash/approve, which generates this token), so there's nothing left to
// agree to here, only payment.
function isExpiredOrInvalid(
  inquiry: { flashPaymentTokenExpiresAt: Date | null; flashPaidAt: Date | null } | null,
) {
  if (!inquiry) {
    return { code: "invalid", error: "This link is invalid." } as const;
  }

  // A paid booking is never "expired" -- GET /verify below always returns
  // the full success shape for a paid inquiry (including the self-schedule
  // token), same as DepositResponse's own already-paid handling.
  if (inquiry.flashPaidAt) {
    return null;
  }

  if (!inquiry.flashPaymentTokenExpiresAt || inquiry.flashPaymentTokenExpiresAt < new Date()) {
    return { code: "expired", error: "This payment link has expired -- please contact the studio." } as const;
  }

  return null;
}

const router = Router();

router.get("/verify/:token", async (req, res) => {
  const token = req.params.token as string;

  const inquiry = await prisma.inquiry.findUnique({
    where: { flashPaymentToken: token },
    include: {
      client: true,
      studio: { include: { settings: { select: { themePreset: true } } } },
      assignedArtist: { include: { user: true } },
      flashPiece: true,
    },
  });

  const invalidity = isExpiredOrInvalid(inquiry);
  if (invalidity) {
    const status = invalidity.code === "invalid" ? 404 : 410;
    return res.status(status).json(invalidity);
  }

  const stripeAccountId = await getChargeableConnectedAccountId(inquiry!.studioId);

  res.json({
    clientFirstName: inquiry!.client.firstName,
    studioName: inquiry!.studio.name,
    studioSlug: inquiry!.studio.slug,
    studioLogoUrl: inquiry!.studio.logoUrl,
    themePreset: inquiry!.studio.settings?.themePreset ?? DEFAULT_THEME_PRESET,
    artistName: inquiry!.assignedArtist?.user.name ?? null,
    artistAvatarUrl: inquiry!.assignedArtist?.user.avatarUrl ?? null,
    pieceTitle: inquiry!.flashPiece?.title ?? null,
    pieceImageUrl: inquiry!.flashPiece?.imageUrl ?? null,
    priceCents: inquiry!.flashPiece?.priceCents ?? null,
    stripeConnected: stripeAccountId !== null,
    // Set only once the checkout.session.completed webhook has actually
    // confirmed payment -- the frontend's own success state and its
    // redirect into the existing self-scheduling flow are both driven off
    // this, not off Stripe's own success_url redirect alone (which can
    // arrive before the webhook does).
    paidAt: inquiry!.flashPaidAt,
    selfScheduleToken: inquiry!.flashPaidAt ? inquiry!.selfScheduleToken : null,
  });
});

router.post("/checkout/:token", async (req, res) => {
  const token = req.params.token as string;

  const inquiry = await prisma.inquiry.findUnique({ where: { flashPaymentToken: token }, select: { id: true } });
  if (!inquiry) {
    return res.status(404).json({ error: "This link is invalid." });
  }

  const result = await createFlashPaymentCheckoutSession(inquiry.id);
  if (!result.ok) {
    return res.status(result.status).json({ error: result.error });
  }

  res.json({ url: result.url });
});

export default router;
