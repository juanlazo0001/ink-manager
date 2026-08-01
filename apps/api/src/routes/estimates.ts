import { Router } from "express";
import crypto from "node:crypto";
import { prisma } from "../lib/prisma";
import { InquiryStatus } from "../../generated/prisma/enums";
import { logAudit } from "../lib/audit";
import { DEFAULT_THEME_PRESET } from "../lib/themePresets";
import { redactedSessionHours } from "../lib/plannedSessions";
import { emitInvalidation } from "../lib/realtime/registry";

const router = Router();

// Matches the SOP's collaborative-design-policy wording shown alongside
// every estimate — adjust here if the studio's actual policy text changes.
const COLLABORATIVE_DESIGN_POLICY =
  "No design is drawn in advance — it is created together with the client on the day of the appointment.";

// Client self-scheduling exploration: same 7-day convention as
// ESTIMATE_TOKEN_TTL_DAYS/REVISION_TOKEN_TTL_DAYS in inquiries.ts.
const SELF_SCHEDULE_TOKEN_TTL_DAYS = 7;

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
    include: {
      client: true,
      studio: { include: { settings: { select: { themePreset: true } } } },
      assignedArtist: { include: { user: true } },
      // Multi-session planning: empty for every estimate that never
      // declared more than one session -- the client-facing page falls
      // back to timeEstimateHoursMin/Max below in that case, unchanged.
      plannedSessions: {
        select: {
          sessionNumber: true,
          estimatedHoursMin: true,
          estimatedHoursMax: true,
          estimatedPriceLow: true,
          estimatedPriceHigh: true,
          showDurationToClient: true,
        },
        orderBy: { sessionNumber: "asc" },
      },
    },
  });

  const invalidity = isExpiredOrInvalid(inquiry);
  if (invalidity) {
    const status = invalidity.code === "invalid" ? 404 : 410;
    return res.status(status).json(invalidity);
  }

  // First open only -- the conditional filter makes this atomic, so two
  // near-simultaneous opens can't both think they were "first."
  const openResult = await prisma.inquiry.updateMany({
    where: { id: inquiry!.id, estimateOpenedAt: null },
    data: { estimateOpenedAt: new Date() },
  });

  if (openResult.count > 0) {
    await logAudit({
      studioId: inquiry!.studioId,
      actorUserId: null,
      entityType: "Inquiry",
      entityId: inquiry!.id,
      action: "estimate_opened",
    });
    emitInvalidation({ type: "inquiry.updated", studioId: inquiry!.studioId, inquiryId: inquiry!.id });
  }

  res.json({
    clientFirstName: inquiry!.client.firstName,
    studioName: inquiry!.studio.name,
    studioSlug: inquiry!.studio.slug,
    studioLogoUrl: inquiry!.studio.logoUrl,
    themePreset: inquiry!.studio.settings?.themePreset ?? DEFAULT_THEME_PRESET,
    artistName: inquiry!.assignedArtist?.user.name ?? null,
    artistAvatarUrl: inquiry!.assignedArtist?.user.avatarUrl ?? null,
    priceEstimateLow: inquiry!.priceEstimateLow,
    priceEstimateHigh: inquiry!.priceEstimateHigh,
    timeEstimateHoursMin: inquiry!.timeEstimateHoursMin,
    timeEstimateHoursMax: inquiry!.timeEstimateHoursMax,
    plannedSessions: inquiry!.plannedSessions.map((ps) => ({
      sessionNumber: ps.sessionNumber,
      ...redactedSessionHours(ps),
      estimatedPriceLow: ps.estimatedPriceLow,
      estimatedPriceHigh: ps.estimatedPriceHigh,
    })),
    estimateTermsSnapshot: inquiry!.estimateTermsSnapshot,
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

  const inquiry = await prisma.inquiry.findUnique({
    where: { estimateToken: token },
    include: { assignedArtist: { select: { allowsClientSelfScheduling: true } } },
  });

  const invalidity = isExpiredOrInvalid(inquiry);
  if (invalidity) {
    const status = invalidity.code === "invalid" ? 404 : 410;
    return res.status(status).json(invalidity);
  }

  const clearToken = { estimateToken: null, estimateTokenExpiresAt: null, estimateRespondedAt: new Date() };

  let selfScheduleToken: string | null = null;

  if (decision === "PROCEED") {
    // Client self-scheduling exploration: opt-in, per artist (see
    // Artist.allowsClientSelfScheduling's own comment) -- an artist who
    // hasn't opted in falls through to exactly today's behavior below,
    // no change at all. Eligibility also requires a usable single-session
    // time estimate: timeEstimateHoursMin/Max are explicitly nulled by
    // POST /inquiries/:id/send-estimate whenever a multi-session plan
    // was declared (see that route's `hasPlan` branch), so their
    // presence here doubles as "this inquiry has one implicit session,"
    // exactly the scope this exploration covers -- multi-session
    // self-scheduling is a deliberate follow-up, not built here.
    const selfScheduleEligible =
      inquiry!.assignedArtist?.allowsClientSelfScheduling === true &&
      inquiry!.timeEstimateHoursMin != null &&
      inquiry!.timeEstimateHoursMax != null;

    if (selfScheduleEligible) {
      selfScheduleToken = crypto.randomBytes(32).toString("hex");
    }

    // Deposit collection now happens before scheduling (Phase 3: an
    // appointment can't be created without an attached gift card, and a
    // gift card only exists once a deposit's been paid) -- so PROCEED
    // lands here instead of directly in SCHEDULING. The self-schedule
    // token (when issued) rides alongside this unchanged transition --
    // it doesn't replace or delay the deposit step, just lets the client
    // also pick a pending time up front, independent of it (see
    // REPORT.md for this flow's write-up).
    await prisma.inquiry.update({
      where: { id: inquiry!.id },
      data: {
        ...clearToken,
        status: InquiryStatus.DEPOSIT_PENDING,
        ...(selfScheduleToken
          ? {
              selfScheduleToken,
              selfScheduleTokenExpiresAt: new Date(Date.now() + SELF_SCHEDULE_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000),
            }
          : {}),
      },
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

  emitInvalidation({ type: "inquiry.updated", studioId: inquiry!.studioId, inquiryId: inquiry!.id });

  res.json({ success: true, selfScheduleToken });
});

// Distinct token/fields (estimateRevisionToken/estimateRevisionTokenExpiresAt)
// from the pre-conversion flow above -- a revision only ever happens on an
// already-converted Project (see POST /inquiries/:id/revise-estimate),
// and its response must never touch `status` the way PROCEED/DECLINE
// above do, since the Project is already scheduled/deposited.
function isRevisionExpiredOrInvalid(inquiry: { estimateRevisionTokenExpiresAt: Date | null } | null) {
  if (!inquiry) {
    return { code: "invalid", error: "This link is invalid." } as const;
  }

  if (!inquiry.estimateRevisionTokenExpiresAt || inquiry.estimateRevisionTokenExpiresAt < new Date()) {
    return { code: "expired", error: "This link has expired." } as const;
  }

  return null;
}

router.get("/revision/verify/:token", async (req, res) => {
  const token = req.params.token as string;

  const inquiry = await prisma.inquiry.findUnique({
    where: { estimateRevisionToken: token },
    include: {
      client: true,
      studio: { include: { settings: { select: { themePreset: true } } } },
      assignedArtist: { include: { user: true } },
      // Multi-session planning: empty for every Project that never
      // declared more than one session -- the client-facing page falls
      // back to timeEstimateHoursMin/Max below in that case, unchanged.
      plannedSessions: {
        select: {
          sessionNumber: true,
          estimatedHoursMin: true,
          estimatedHoursMax: true,
          estimatedPriceLow: true,
          estimatedPriceHigh: true,
          showDurationToClient: true,
        },
        orderBy: { sessionNumber: "asc" },
      },
    },
  });

  const invalidity = isRevisionExpiredOrInvalid(inquiry);
  if (invalidity) {
    const status = invalidity.code === "invalid" ? 404 : 410;
    return res.status(status).json(invalidity);
  }

  res.json({
    clientFirstName: inquiry!.client.firstName,
    studioName: inquiry!.studio.name,
    studioSlug: inquiry!.studio.slug,
    studioLogoUrl: inquiry!.studio.logoUrl,
    themePreset: inquiry!.studio.settings?.themePreset ?? DEFAULT_THEME_PRESET,
    artistName: inquiry!.assignedArtist?.user.name ?? null,
    artistAvatarUrl: inquiry!.assignedArtist?.user.avatarUrl ?? null,
    priceEstimateLow: inquiry!.priceEstimateLow,
    priceEstimateHigh: inquiry!.priceEstimateHigh,
    timeEstimateHoursMin: inquiry!.timeEstimateHoursMin,
    timeEstimateHoursMax: inquiry!.timeEstimateHoursMax,
    plannedSessions: inquiry!.plannedSessions.map((ps) => ({
      sessionNumber: ps.sessionNumber,
      ...redactedSessionHours(ps),
      estimatedPriceLow: ps.estimatedPriceLow,
      estimatedPriceHigh: ps.estimatedPriceHigh,
    })),
    reason: inquiry!.estimateRevisionReason,
  });
});

const REVISION_DECISIONS = ["APPROVE", "FLAG"] as const;

router.patch("/revision/respond/:token", async (req, res) => {
  const token = req.params.token as string;
  const { decision } = req.body ?? {};

  if (!REVISION_DECISIONS.includes(decision)) {
    return res.status(400).json({ error: `decision must be one of: ${REVISION_DECISIONS.join(", ")}` });
  }

  const inquiry = await prisma.inquiry.findUnique({ where: { estimateRevisionToken: token } });

  const invalidity = isRevisionExpiredOrInvalid(inquiry);
  if (invalidity) {
    const status = invalidity.code === "invalid" ? 404 : 410;
    return res.status(status).json(invalidity);
  }

  // Status is deliberately never touched here -- this Project is already
  // scheduled/deposited; a revision response only records how the client
  // reacted to the *change*, never the Project's own lifecycle status
  // (contrast with PROCEED/BUDGET_TOO_HIGH/DECLINE above, which do move
  // status, because those happen on a still-pre-conversion inquiry).
  // FLAG intentionally does nothing beyond recording the response --
  // unwinding a paid deposit or scheduled appointment automatically would
  // be unsafe; staff sees the flag (Inquiry detail page + audit trail)
  // and follows up manually.
  await prisma.inquiry.update({
    where: { id: inquiry!.id },
    data: {
      estimateRevisionToken: null,
      estimateRevisionTokenExpiresAt: null,
      estimateRevisionRespondedAt: new Date(),
      estimateRevisionApproved: decision === "APPROVE",
    },
  });

  await logAudit({
    studioId: inquiry!.studioId,
    actorUserId: null,
    entityType: "Inquiry",
    entityId: inquiry!.id,
    action: decision === "APPROVE" ? "estimate_revision_approved" : "estimate_revision_flagged",
  });

  emitInvalidation({ type: "inquiry.updated", studioId: inquiry!.studioId, inquiryId: inquiry!.id });

  res.json({ success: true });
});

export default router;
