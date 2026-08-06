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

// Token-lifecycle bug fix: the three states an ALREADY-RESPONDED, self-
// scheduling-eligible estimate can be in -- shared between GET /verify and
// PATCH /respond (see estimateToken's own schema comment for why this
// branch is reachable at all now) so a client revisiting their one
// durable link always lands somewhere sane. `null` means self-scheduling
// was never applicable to this response (shouldn't be reachable in
// practice -- every other decision/ineligible outcome clears estimateToken
// immediately, so this branch is only ever entered when it WAS issued --
// handled defensively anyway rather than assumed).
type SelfSchedulePhaseStatus =
  | { kind: "pending"; selfScheduleToken: string }
  | { kind: "booked" }
  | { kind: "expired" };

function selfSchedulePhaseStatus(inquiry: {
  selfScheduleToken: string | null;
  selfScheduleTokenExpiresAt: Date | null;
  selfScheduleBookedAt: Date | null;
}): SelfSchedulePhaseStatus | null {
  if (inquiry.selfScheduleBookedAt) return { kind: "booked" };
  if (!inquiry.selfScheduleToken) return null;
  if (!inquiry.selfScheduleTokenExpiresAt || inquiry.selfScheduleTokenExpiresAt < new Date()) {
    return { kind: "expired" };
  }
  return { kind: "pending", selfScheduleToken: inquiry.selfScheduleToken };
}

// Token-lifecycle bug fix: a resend (POST /:id/send-estimate) regenerates
// estimateToken, which used to leave the OLD link a bare "invalid" 404
// forever. previousEstimateToken (set by that route on resend) lets a
// client on that stale link get a clear, actionable message instead of a
// generic error -- checked by both GET /verify and PATCH /respond below.
async function supersededResponse(token: string) {
  const superseded = await prisma.inquiry.findUnique({ where: { previousEstimateToken: token } });
  return superseded
    ? ({ status: 409, error: "A newer link was sent for this estimate -- please use the most recent one." } as const)
    : ({ status: 404, error: "This link is invalid." } as const);
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

  if (!inquiry) {
    const { status, error } = await supersededResponse(token);
    return res.status(status).json({ error });
  }

  // Token-lifecycle bug fix: already responded is now reachable (see
  // estimateToken's own schema comment) -- redirect back into self-
  // scheduling, an already-booked message, or a self-scheduling-phase
  // expiry, never the original decision form again. This inquiry's own
  // estimateTokenExpiresAt is irrelevant once responded; the self-schedule
  // phase's own expiry (inside selfSchedulePhaseStatus) governs instead.
  if (inquiry.estimateRespondedAt) {
    const phase = selfSchedulePhaseStatus(inquiry);
    if (phase?.kind === "booked") {
      return res.json({
        alreadyBooked: true,
        clientFirstName: inquiry.client.firstName,
        studioName: inquiry.studio.name,
        studioSlug: inquiry.studio.slug,
        themePreset: inquiry.studio.settings?.themePreset ?? DEFAULT_THEME_PRESET,
      });
    }
    if (phase?.kind === "pending") {
      return res.json({ alreadyResponded: true, selfScheduleToken: phase.selfScheduleToken });
    }
    return res.status(410).json({ error: "This link has expired." });
  }

  if (!inquiry.estimateTokenExpiresAt || inquiry.estimateTokenExpiresAt < new Date()) {
    return res.status(410).json({ error: "This link has expired." });
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

  if (!inquiry) {
    const { status, error } = await supersededResponse(token);
    return res.status(status).json({ error });
  }

  // Token-lifecycle bug fix: idempotency guard. estimateToken now stays
  // alive through a pending self-scheduling window (see its own schema
  // comment), so a second PATCH against the same token is reachable in a
  // way it never was before (a stale duplicate tab, a double-click before
  // the redirect fires). The ORIGINAL decision already took effect and is
  // never re-run or overwritten by a second, possibly different decision
  // -- same-shaped success response either way, so a harmless duplicate
  // submit is invisible to the client rather than an error, while a
  // second, DIFFERENT decision can't retroactively change the first one.
  if (inquiry.estimateRespondedAt) {
    const phase = selfSchedulePhaseStatus(inquiry);
    if (phase?.kind === "pending") {
      return res.json({ success: true, selfScheduleToken: phase.selfScheduleToken });
    }
    if (phase?.kind === "booked") {
      return res.status(409).json({ error: "You've already booked this appointment." });
    }
    return res.status(410).json({ error: "This link has expired." });
  }

  if (!inquiry.estimateTokenExpiresAt || inquiry.estimateTokenExpiresAt < new Date()) {
    return res.status(410).json({ error: "This link has expired." });
  }

  const clearToken = { estimateToken: null, estimateTokenExpiresAt: null };

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
        estimateRespondedAt: new Date(),
        // Token-lifecycle bug fix: estimateToken/ExpiresAt deliberately
        // NOT cleared here when self-scheduling is issued -- see that
        // field's own schema comment. Cleared normally otherwise.
        ...(selfScheduleToken ? {} : clearToken),
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
      data: {
        ...clearToken,
        estimateRespondedAt: new Date(),
        status: InquiryStatus.BUDGET_NEGOTIATION,
        clientStatedBudget: statedBudget.trim(),
      },
    });
  } else {
    await prisma.inquiry.update({
      where: { id: inquiry!.id },
      data: {
        ...clearToken,
        estimateRespondedAt: new Date(),
        status: InquiryStatus.CLOSED_LOST,
        closedReason: "Client declined the estimate.",
      },
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

  // Token-lifecycle bug fix (Bug B): mirrors the pre-conversion PROCEED
  // branch's own selfScheduleToken response -- POST /inquiries/:id/revise-
  // estimate's self-scheduling-aware branch may have minted a fresh one
  // for this inquiry (see that route's own comment). Only surfaced on
  // APPROVE, matching PROCEED's own "only ever present on the accepting
  // decision" contract; FLAG never touches or returns it.
  const phase = decision === "APPROVE" ? selfSchedulePhaseStatus(inquiry!) : null;

  res.json({ success: true, selfScheduleToken: phase?.kind === "pending" ? phase.selfScheduleToken : null });
});

export default router;
