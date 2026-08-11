import crypto from "node:crypto";
import { prisma } from "./prisma";
import { InquiryStatus } from "../../generated/prisma/enums";
import { diffObjects, logAudit } from "./audit";
import { getOrCreateClientConversation } from "./conversations";
import { sendClientSms } from "./clientSms";
import { shortenUrl } from "./shortLinks";
import { PUBLIC_APP_URL } from "./publicUrl";
import { emitInvalidation } from "./realtime/registry";

const ESTIMATE_TOKEN_TTL_DAYS = 7;

// Mirrors inquiries.ts's own NON_TERMINAL_STATUSES/PROJECT_STATUSES/
// ESTIMATE_REVISION_ONLY_STATUSES exactly, duplicated as literals here for
// the same "a lib importing from a route file would invert this codebase's
// usual dependency direction" reason lib/deposits.ts's own
// DEPOSIT_FORM_ALLOWED_STATUSES comment gives.
const NON_TERMINAL_STATUSES: InquiryStatus[] = (Object.values(InquiryStatus) as InquiryStatus[]).filter(
  (s) => s !== InquiryStatus.CLOSED_LOST && s !== InquiryStatus.COLD_LEAD,
);
const PROJECT_STATUSES: InquiryStatus[] = [InquiryStatus.SCHEDULING, InquiryStatus.WAITLISTED, InquiryStatus.CONFIRMED];
const ESTIMATE_REVISION_ONLY_STATUSES: InquiryStatus[] = [InquiryStatus.DEPOSIT_PENDING, ...PROJECT_STATUSES];

export interface EstimateSessionInput {
  estimatedHoursMin: number;
  estimatedHoursMax: number;
  estimatedPriceLow: number;
  estimatedPriceHigh: number;
  showDurationToClient?: boolean;
}

type ReconcilableSession = EstimateSessionInput & { showDurationToClient: boolean };

export interface EstimateFieldsOptions {
  priceEstimateLow?: unknown;
  priceEstimateHigh?: unknown;
  timeEstimateHoursMin?: unknown;
  timeEstimateHoursMax?: unknown;
  sessions?: unknown;
}

type PlannedSessionForReconcile = {
  id: string;
  sessionNumber: number;
  appointmentId: string | null;
  depositFormId: string | null;
  depositForm: { paidAt: Date | null } | null;
};

interface EffectiveEstimate {
  priceEstimateLow: number;
  priceEstimateHigh: number;
  timeEstimateHoursMin: number | null;
  timeEstimateHoursMax: number | null;
}

type ValidatedEstimateInputs =
  | {
      ok: true;
      plannedSessionInputs: ReconcilableSession[] | null;
      hasPlan: boolean;
      effective: EffectiveEstimate;
    }
  | { ok: false; status: number; error: string };

// Same validation staff's Generate & Send Estimate has always run, now the
// ONE place it happens -- shared by generateAndSendEstimate below and
// saveEstimateDraft (the "studio turned artistSendEstimate off" path), so
// an artist saving-not-sending can't submit anything staff's own send path
// would have rejected. The status gate applies identically to both: once a
// deposit form already exists (ESTIMATE_REVISION_ONLY_STATUSES), Revise
// Estimate is the ONE sanctioned way to change the top-level price/time
// fields (staff-typed reason, client re-notified) -- saveEstimateDraft
// skipping the client-contact step doesn't make it safe to let an artist
// silently rewrite those fields around that control.
function validateEstimateInputs(
  inquiry: {
    status: InquiryStatus;
    assignedArtistId: string | null;
    priceEstimateLow: number | null;
    priceEstimateHigh: number | null;
    timeEstimateHoursMin: number | null;
    timeEstimateHoursMax: number | null;
    plannedSessions: { sessionNumber: number }[];
  },
  opts: EstimateFieldsOptions,
): ValidatedEstimateInputs {
  const { priceEstimateLow, priceEstimateHigh, timeEstimateHoursMin, timeEstimateHoursMax, sessions } = opts;

  if (!NON_TERMINAL_STATUSES.includes(inquiry.status)) {
    return { ok: false, status: 400, error: "An estimate can't be sent on a closed or cold-lead inquiry" };
  }
  if (ESTIMATE_REVISION_ONLY_STATUSES.includes(inquiry.status)) {
    return {
      ok: false,
      status: 400,
      error: "A deposit has already been requested for this inquiry -- use Revise Estimate instead of Generate & Send Estimate.",
    };
  }

  if (!inquiry.assignedArtistId) {
    return { ok: false, status: 400, error: "Assign an artist before entering an estimate" };
  }

  for (const [field, value] of Object.entries({
    priceEstimateLow,
    priceEstimateHigh,
    timeEstimateHoursMin,
    timeEstimateHoursMax,
  })) {
    if (value !== undefined && typeof value !== "number") {
      return { ok: false, status: 400, error: `${field} must be a number` };
    }
  }

  let plannedSessionInputs: ReconcilableSession[] | null = null;
  if (sessions !== undefined) {
    if (!Array.isArray(sessions)) {
      return { ok: false, status: 400, error: "sessions must be an array" };
    }
    for (const [index, session] of sessions.entries()) {
      if (
        typeof session !== "object" ||
        session === null ||
        typeof (session as Record<string, unknown>).estimatedHoursMin !== "number" ||
        typeof (session as Record<string, unknown>).estimatedHoursMax !== "number" ||
        typeof (session as Record<string, unknown>).estimatedPriceLow !== "number" ||
        typeof (session as Record<string, unknown>).estimatedPriceHigh !== "number"
      ) {
        return { ok: false, status: 400, error: `Session ${index + 1} needs a numeric hour range and price range` };
      }
      const s = session as EstimateSessionInput;
      if (s.estimatedHoursMin <= 0 || s.estimatedHoursMax <= 0) {
        return { ok: false, status: 400, error: `Session ${index + 1}'s hour range must be positive` };
      }
      if (s.estimatedHoursMin > s.estimatedHoursMax) {
        return { ok: false, status: 400, error: `Session ${index + 1}'s minimum hours must be less than or equal to its maximum` };
      }
      if (s.estimatedPriceLow <= 0 || s.estimatedPriceHigh <= 0) {
        return { ok: false, status: 400, error: `Session ${index + 1}'s price range must be positive` };
      }
      if (s.estimatedPriceLow > s.estimatedPriceHigh) {
        return { ok: false, status: 400, error: `Session ${index + 1}'s minimum price must be less than or equal to its maximum` };
      }
      if (s.showDurationToClient !== undefined && typeof s.showDurationToClient !== "boolean") {
        return { ok: false, status: 400, error: `Session ${index + 1}'s showDurationToClient must be a boolean` };
      }
    }
    plannedSessionInputs = (sessions as EstimateSessionInput[]).map((session) => ({
      ...session,
      showDurationToClient: session.showDurationToClient ?? true,
    }));
  }

  const finalSessionCount = plannedSessionInputs ? plannedSessionInputs.length : inquiry.plannedSessions.length;
  const hasPlan = finalSessionCount > 1;

  const sessionPriceTotals = hasPlan
    ? {
        priceEstimateLow: plannedSessionInputs!.reduce((sum, s) => sum + s.estimatedPriceLow, 0),
        priceEstimateHigh: plannedSessionInputs!.reduce((sum, s) => sum + s.estimatedPriceHigh, 0),
      }
    : null;

  const effective: {
    priceEstimateLow: number | null;
    priceEstimateHigh: number | null;
    timeEstimateHoursMin: number | null;
    timeEstimateHoursMax: number | null;
  } = {
    priceEstimateLow: sessionPriceTotals
      ? sessionPriceTotals.priceEstimateLow
      : ((priceEstimateLow as number | undefined) ?? inquiry.priceEstimateLow),
    priceEstimateHigh: sessionPriceTotals
      ? sessionPriceTotals.priceEstimateHigh
      : ((priceEstimateHigh as number | undefined) ?? inquiry.priceEstimateHigh),
    timeEstimateHoursMin: hasPlan
      ? null
      : ((timeEstimateHoursMin as number | undefined) ?? inquiry.timeEstimateHoursMin),
    timeEstimateHoursMax: hasPlan
      ? null
      : ((timeEstimateHoursMax as number | undefined) ?? inquiry.timeEstimateHoursMax),
  };

  const requiredFields = hasPlan
    ? { priceEstimateLow: effective.priceEstimateLow, priceEstimateHigh: effective.priceEstimateHigh }
    : effective;
  for (const [field, value] of Object.entries(requiredFields)) {
    if (value == null) {
      return { ok: false, status: 400, error: `${field} is required before an estimate can be sent` };
    }
    if (value <= 0) {
      return { ok: false, status: 400, error: `${field} must be a positive number` };
    }
  }

  if (effective.priceEstimateLow! > effective.priceEstimateHigh!) {
    return { ok: false, status: 400, error: "priceEstimateLow must be less than or equal to priceEstimateHigh" };
  }

  if (!hasPlan && effective.timeEstimateHoursMin! > effective.timeEstimateHoursMax!) {
    return { ok: false, status: 400, error: "timeEstimateHoursMin must be less than or equal to timeEstimateHoursMax" };
  }

  return {
    ok: true,
    plannedSessionInputs,
    hasPlan,
    effective: effective as EffectiveEstimate,
  };
}

// Reconciles PlannedSession rows to match plannedSessionInputs -- create/
// update to match, delete anything beyond the new length, skipping any
// session number already locked by a paid deposit or a booked appointment.
// Shared verbatim between the send path and the save-only path so a
// prepared-but-not-yet-sent multi-session plan is exactly what front desk
// sees and can send later.
//
// Linkage bug fix: a plan declared/revised on an inquiry that ALREADY has
// an un-planned DepositForm (e.g. a single-session project that collected
// its deposit before staff realized -- or the client asked -- to split it
// into a real multi-session plan) previously created a brand-new
// PlannedSession row with depositFormId left null, even though a real,
// possibly-already-signed-or-paid DepositForm with the exact same
// sessionNumber already existed on the same inquiry. The Session Plan
// widget (InquiryDetail.tsx) derives its "Deposit paid/pending/not yet
// generated" badge purely from ps.depositForm (the FK relation), so that
// session silently read as "not yet generated" and stayed fully
// actionable (Send Deposit Form) despite already being paid -- a real
// double-charge risk. Fixed at the source here (both toCreate AND
// toUpdate) rather than in the widget, so the FK itself is correct and
// every other consumer of PlannedSession.depositForm (PDF/reminder/
// checkout code, none of which re-derive it independently) is correct too.
async function reconcilePlannedSessions(
  inquiryId: string,
  existingPlannedSessions: PlannedSessionForReconcile[],
  plannedSessionInputs: ReconcilableSession[],
) {
  const lockedSessions = existingPlannedSessions.filter(
    (ps) => ps.depositForm?.paidAt != null || ps.appointmentId != null,
  );
  const lockedSessionNumbers = new Set(lockedSessions.map((s) => s.sessionNumber));
  const existingByNumber = new Map(existingPlannedSessions.map((ps) => [ps.sessionNumber, ps]));

  // sessionNumber is unique per inquiry across DepositForm (create only
  // ever mints a new one for a genuinely new session; a resend/rotate is
  // always an update to the existing row -- see generateAndSendDepositForm's
  // own isNewSession branch) -- orderBy is defensive, not load-bearing.
  const existingDepositForms = await prisma.depositForm.findMany({
    where: { inquiryId },
    select: { id: true, sessionNumber: true },
    orderBy: { createdAt: "asc" },
  });
  const depositFormIdBySessionNumber = new Map(existingDepositForms.map((df) => [df.sessionNumber, df.id]));

  const toUpdate: (ReconcilableSession & { id: string; depositFormId?: string })[] = [];
  const toCreate: (ReconcilableSession & { sessionNumber: number; depositFormId?: string })[] = [];

  plannedSessionInputs.forEach((session, index) => {
    const sessionNumber = index + 1;
    if (lockedSessionNumbers.has(sessionNumber)) return;
    const existing = existingByNumber.get(sessionNumber);
    const matchingDepositFormId = depositFormIdBySessionNumber.get(sessionNumber);
    if (existing) {
      toUpdate.push({
        id: existing.id,
        ...session,
        // Only ever fills a currently-null link -- never overwrites an
        // already-linked row (that link was set by the real send-deposit-
        // form flow, which is always the more specific/authoritative
        // source for it).
        ...(existing.depositFormId == null && matchingDepositFormId ? { depositFormId: matchingDepositFormId } : {}),
      });
    } else {
      toCreate.push({ sessionNumber, ...session, ...(matchingDepositFormId ? { depositFormId: matchingDepositFormId } : {}) });
    }
  });

  const toDeleteIds = existingPlannedSessions
    .filter((ps) => ps.sessionNumber > plannedSessionInputs.length && !lockedSessionNumbers.has(ps.sessionNumber))
    .map((ps) => ps.id);

  await prisma.$transaction([
    ...toUpdate.map((s) =>
      prisma.plannedSession.update({
        where: { id: s.id },
        data: {
          estimatedHoursMin: s.estimatedHoursMin,
          estimatedHoursMax: s.estimatedHoursMax,
          estimatedPriceLow: s.estimatedPriceLow,
          estimatedPriceHigh: s.estimatedPriceHigh,
          showDurationToClient: s.showDurationToClient,
          ...(s.depositFormId ? { depositFormId: s.depositFormId } : {}),
        },
      }),
    ),
    ...(toCreate.length > 0
      ? [prisma.plannedSession.createMany({ data: toCreate.map((s) => ({ inquiryId, ...s })) })]
      : []),
    ...(toDeleteIds.length > 0 ? [prisma.plannedSession.deleteMany({ where: { id: { in: toDeleteIds } } })] : []),
  ]);
}

export interface GenerateAndSendEstimateOptions extends EstimateFieldsOptions {
  studioId: string;
  actorUserId: string;
}

export type GenerateAndSendEstimateResult =
  | { ok: true; estimateUrl: string; estimateSendResult: Awaited<ReturnType<typeof sendClientSms>> }
  | { ok: false; status: number; error: string };

// Extracted from POST /inquiries/:id/send-estimate so a second caller --
// PATCH /inquiries/:id/respond's APPROVE branch, when a studio has left
// inquiries.artistSendEstimate on -- sends the client-facing estimate
// through the EXACT same path (same token minting, same PlannedSession
// reconciliation, same real-SMS auto-send, same Conversations logging) an
// artist's own submission is now able to trigger directly, not a second,
// drifting copy of it. Auth/permission checks stay at each route's own
// layer -- this function trusts studioId/actorUserId as already-
// authenticated (same precedent as lib/deposits.ts's
// generateAndSendDepositForm). studioId is always the PROJECT's studio
// (inquiry.studioId), never the caller's own possibly-different home
// studio -- the same guest-artist scoping this codebase has already had to
// fix more than once elsewhere.
export async function generateAndSendEstimate(
  inquiryId: string,
  opts: GenerateAndSendEstimateOptions,
): Promise<GenerateAndSendEstimateResult> {
  const { studioId, actorUserId, ...fields } = opts;

  const inquiry = await prisma.inquiry.findUnique({
    where: { id: inquiryId },
    include: {
      client: { select: { firstName: true } },
      plannedSessions: { include: { depositForm: { select: { paidAt: true } } } },
    },
  });
  if (!inquiry || inquiry.studioId !== studioId) {
    return { ok: false, status: 404, error: "Inquiry not found" };
  }

  const validated = validateEstimateInputs(inquiry, fields);
  if (!validated.ok) return validated;
  const { plannedSessionInputs, hasPlan, effective } = validated;

  const isResend = inquiry.estimateSentAt != null;
  const estimateToken = crypto.randomBytes(32).toString("hex");
  const estimateTokenExpiresAt = new Date(Date.now() + ESTIMATE_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

  const studioSettings = await prisma.studioSettings.findUnique({ where: { studioId } });

  const sendEstimateData = {
    estimateToken,
    estimateTokenExpiresAt,
    estimateSentAt: new Date(),
    estimateTermsSnapshot: studioSettings?.estimateTerms ?? null,
    status: InquiryStatus.AWAITING_CLIENT_RESPONSE,
    priceEstimateLow: effective.priceEstimateLow,
    priceEstimateHigh: effective.priceEstimateHigh,
    timeEstimateHoursMin: hasPlan ? null : effective.timeEstimateHoursMin,
    timeEstimateHoursMax: hasPlan ? null : effective.timeEstimateHoursMax,
    ...(isResend ? { estimateOpenedAt: null, estimateRespondedAt: null, estimateFollowUpSentAt: null } : {}),
    ...(isResend && inquiry.estimateToken ? { previousEstimateToken: inquiry.estimateToken } : {}),
  };

  if (plannedSessionInputs) {
    await reconcilePlannedSessions(inquiryId, inquiry.plannedSessions, plannedSessionInputs);
  }

  const updated = await prisma.inquiry.update({ where: { id: inquiryId }, data: sendEstimateData });

  await logAudit({
    studioId,
    actorUserId,
    entityType: "Inquiry",
    entityId: inquiryId,
    action: isResend ? "estimate_resent" : "estimate_sent",
    changes: diffObjects(inquiry, sendEstimateData, [
      "status",
      "estimateSentAt",
      "estimateOpenedAt",
      "estimateRespondedAt",
      "estimateFollowUpSentAt",
      "priceEstimateLow",
      "priceEstimateHigh",
      "timeEstimateHoursMin",
      "timeEstimateHoursMax",
    ]),
  });

  const estimateUrl = await shortenUrl(`${PUBLIC_APP_URL}/estimate/${estimateToken}`);

  const studio = await prisma.studio.findUnique({ where: { id: studioId }, select: { name: true } });
  const estimateSendResult = await sendClientSms({
    studioId,
    clientId: updated.clientId,
    conversationId: (await getOrCreateClientConversation(studioId, updated.clientId, actorUserId)).conversation.id,
    body: `Hi ${inquiry.client.firstName}, here's your tattoo estimate from ${studio?.name ?? "our studio"}: ${estimateUrl}`,
    actorUserId,
  });

  emitInvalidation({ type: "inquiry.updated", studioId, inquiryId });

  return { ok: true, estimateUrl, estimateSendResult };
}

export interface SaveEstimateDraftOptions extends EstimateFieldsOptions {
  studioId: string;
  actorUserId: string;
}

export type SaveEstimateDraftResult = { ok: true } | { ok: false; status: number; error: string };

// The "studio turned inquiries.artistSendEstimate off" path: an artist can
// still fully prepare an estimate (same fields, same validation, same
// PlannedSession reconciliation as generateAndSendEstimate above) and save
// it for front desk to review, but nothing here ever contacts the client --
// no token, no status change, no SMS. Status deliberately stays wherever it
// already was (ARTIST_ASSIGNED for the only case this is reachable from
// today) rather than moving to AWAITING_CLIENT_RESPONSE, since nothing has
// actually been sent to the client to respond to yet; front desk's own
// Estimate section on the Inquiry page already shows/edits/sends whatever
// numbers and session rows are saved here with no new UI needed.
export async function saveEstimateDraft(
  inquiryId: string,
  opts: SaveEstimateDraftOptions,
): Promise<SaveEstimateDraftResult> {
  const { studioId, actorUserId, ...fields } = opts;

  const inquiry = await prisma.inquiry.findUnique({
    where: { id: inquiryId },
    include: { plannedSessions: { include: { depositForm: { select: { paidAt: true } } } } },
  });
  if (!inquiry || inquiry.studioId !== studioId) {
    return { ok: false, status: 404, error: "Inquiry not found" };
  }

  const validated = validateEstimateInputs(inquiry, fields);
  if (!validated.ok) return validated;
  const { plannedSessionInputs, hasPlan, effective } = validated;

  if (plannedSessionInputs) {
    await reconcilePlannedSessions(inquiryId, inquiry.plannedSessions, plannedSessionInputs);
  }

  const saveData = {
    priceEstimateLow: effective.priceEstimateLow,
    priceEstimateHigh: effective.priceEstimateHigh,
    timeEstimateHoursMin: hasPlan ? null : effective.timeEstimateHoursMin,
    timeEstimateHoursMax: hasPlan ? null : effective.timeEstimateHoursMax,
  };

  await prisma.inquiry.update({ where: { id: inquiryId }, data: saveData });

  await logAudit({
    studioId,
    actorUserId,
    entityType: "Inquiry",
    entityId: inquiryId,
    action: "estimate_saved_for_review",
    changes: diffObjects(inquiry, saveData, [
      "priceEstimateLow",
      "priceEstimateHigh",
      "timeEstimateHoursMin",
      "timeEstimateHoursMax",
    ]),
  });

  emitInvalidation({ type: "inquiry.updated", studioId, inquiryId });

  return { ok: true };
}
