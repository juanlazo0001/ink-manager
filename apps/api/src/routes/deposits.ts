import { Router } from "express";
import { prisma } from "../lib/prisma";
import { AppointmentStatus, InquiryStatus, Role } from "../../generated/prisma/enums";
import { requireAuth, requireRole } from "../middleware/auth";
import { diffObjects, logAudit } from "../lib/audit";

// Exact SOP wording, in the order the client must agree to each one.
const TERMS = [
  {
    key: "agreedNonRefundable",
    label:
      "A deposit is required to set an appointment. Deposits are non-refundable and are applied to the final price of the tattoo.",
  },
  {
    key: "agreedLatePolicy",
    label: "Artists reserve the right to reschedule the appointment if the client is more than 15 minutes late without notification.",
  },
  {
    key: "agreedNoShowForfeit",
    label: "A no-call/no-show forfeits the deposit. A 48-hour notice is required to change a scheduled appointment.",
  },
  {
    key: "agreedNewDepositAfterNoShow",
    label: "After a no-call/no-show, a new deposit is required to set up another appointment.",
  },
  {
    key: "agreedRescheduleLimit",
    label: "Appointments may be rescheduled up to 3 times; the deposit is forfeited on the 3rd reschedule.",
  },
  {
    key: "agreedExpiration",
    label: "Deposits expire one year after the date they were created.",
  },
  {
    key: "agreedIdAndVoucher",
    label: "Client must bring a government-issued ID and the Deposit Voucher (issued after payment) on the day of the appointment.",
  },
  {
    key: "agreedAge18",
    label: "Client reconfirms they are at least 18 years of age.",
  },
] as const;

const TERM_KEYS = TERMS.map((t) => t.key);

function isExpiredOrInvalid(depositForm: { signedAt: Date | null; tokenExpiresAt: Date } | null) {
  if (!depositForm) {
    return { code: "invalid", error: "This link is invalid." } as const;
  }

  if (depositForm.signedAt) {
    return { code: "already_signed", error: "This deposit form has already been signed." } as const;
  }

  if (depositForm.tokenExpiresAt < new Date()) {
    return { code: "expired", error: "This link has expired." } as const;
  }

  return null;
}

// Public: same pattern as consent form / estimate links.
const publicRouter = Router();

publicRouter.get("/verify/:token", async (req, res) => {
  const token = req.params.token as string;

  const depositForm = await prisma.depositForm.findUnique({
    where: { token },
    include: {
      inquiry: {
        include: {
          client: true,
          studio: true,
          assignedArtist: { include: { user: true } },
          appointment: true,
        },
      },
    },
  });

  const invalidity = isExpiredOrInvalid(depositForm);
  if (invalidity) {
    const status = invalidity.code === "invalid" ? 404 : 410;
    return res.status(status).json(invalidity);
  }

  const { inquiry } = depositForm!;

  res.json({
    clientFirstName: inquiry.client.firstName,
    studioName: inquiry.studio.name,
    artistName: inquiry.assignedArtist?.user.name ?? null,
    appointmentStart: inquiry.appointment?.startTime ?? null,
    appointmentEnd: inquiry.appointment?.endTime ?? null,
    depositAmount: depositForm!.depositAmount,
    feeAmount: depositForm!.feeAmount,
    totalCharged: depositForm!.totalCharged,
    terms: TERMS,
  });
});

publicRouter.patch("/sign/:token", async (req, res) => {
  const token = req.params.token as string;
  const body = req.body ?? {};
  const { signatureName } = body;

  const depositForm = await prisma.depositForm.findUnique({ where: { token } });

  const invalidity = isExpiredOrInvalid(depositForm);
  if (invalidity) {
    const status = invalidity.code === "invalid" ? 404 : 410;
    return res.status(status).json(invalidity);
  }

  const allAgreed = TERM_KEYS.every((key) => body[key] === true);
  if (!allAgreed) {
    return res.status(400).json({ error: "All terms must be agreed to." });
  }

  if (typeof signatureName !== "string" || signatureName.trim().length === 0) {
    return res.status(400).json({ error: "signatureName is required" });
  }

  await prisma.depositForm.update({
    where: { id: depositForm!.id },
    data: {
      agreedNonRefundable: true,
      agreedLatePolicy: true,
      agreedNoShowForfeit: true,
      agreedNewDepositAfterNoShow: true,
      agreedRescheduleLimit: true,
      agreedExpiration: true,
      agreedIdAndVoucher: true,
      agreedAge18: true,
      signatureName: signatureName.trim(),
      signedAt: new Date(),
    },
  });

  res.json({ success: true });
});

// Staff-facing: marking a deposit paid is a separate, authenticated step
// from the client signing -- money hasn't necessarily moved yet at sign
// time, this is what confirms it actually has.
const staffRouter = Router();

staffRouter.patch("/:id/mark-paid", requireAuth, requireRole(Role.OWNER, Role.FRONT_DESK), async (req, res) => {
  const id = req.params.id as string;

  const depositForm = await prisma.depositForm.findUnique({ where: { id }, include: { inquiry: true } });
  if (!depositForm || depositForm.inquiry.studioId !== req.user!.studioId) {
    return res.status(404).json({ error: "Deposit form not found" });
  }

  if (!depositForm.signedAt) {
    return res.status(400).json({ error: "This deposit form has not been signed yet" });
  }

  if (depositForm.paidManually) {
    return res.status(400).json({ error: "This deposit has already been marked as paid" });
  }

  const paidAt = new Date();

  const [updatedDepositForm] = await prisma.$transaction([
    prisma.depositForm.update({ where: { id }, data: { paidManually: true, paidAt } }),
    prisma.inquiry.update({ where: { id: depositForm.inquiryId }, data: { status: InquiryStatus.CONFIRMED } }),
    ...(depositForm.inquiry.appointmentId
      ? [
          prisma.appointment.update({
            where: { id: depositForm.inquiry.appointmentId },
            data: { status: AppointmentStatus.CONFIRMED },
          }),
        ]
      : []),
  ]);

  await logAudit({
    studioId: req.user!.studioId,
    actorUserId: req.user!.userId,
    entityType: "Inquiry",
    entityId: depositForm.inquiryId,
    action: "status_change",
    changes: diffObjects(depositForm.inquiry, { status: InquiryStatus.CONFIRMED }, ["status"]),
  });

  res.json(updatedDepositForm);
});

export { publicRouter, staffRouter };
