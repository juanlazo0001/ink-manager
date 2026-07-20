import crypto from "node:crypto";
import { prisma } from "./prisma";
import { logAudit } from "./audit";
import { PUBLIC_APP_URL } from "./publicUrl";
import type { LiabilityWaiver } from "../../generated/prisma/client";

interface HealthQuestionSnapshot {
  question: string;
  type: "yes_no" | "yes_no_explain";
  explainPrompt?: string;
}

interface HealthAnswer {
  questionIndex: number;
  answer: "YES" | "NO";
  explanation?: string;
}

interface ClauseInitial {
  clauseIndex: number;
  initials: string;
}

// North Carolina requires 18+ to be tattooed -- checked against the
// signing date, not the appointment date.
export function isAtLeast18(dateOfBirth: Date): boolean {
  const eighteenYearsAgo = new Date();
  eighteenYearsAgo.setFullYear(eighteenYearsAgo.getFullYear() - 18);
  return dateOfBirth <= eighteenYearsAgo;
}

// Every question in the snapshot must be answered by index; a
// yes_no_explain question answered YES additionally requires a non-empty
// explanation. Returns a field-level error naming the offending question
// rather than a generic "invalid" message.
export function validateHealthAnswers(
  snapshot: HealthQuestionSnapshot[],
  answers: unknown,
): { error: string; field: string } | { value: HealthAnswer[] } {
  if (!Array.isArray(answers) || answers.length !== snapshot.length) {
    return { error: "Every health question must be answered", field: "healthAnswers" };
  }

  const normalized: HealthAnswer[] = [];

  for (let i = 0; i < snapshot.length; i++) {
    const entry = (answers as Record<string, unknown>[]).find((a) => a && a.questionIndex === i);
    const answer = entry?.answer;

    if (!entry || (answer !== "YES" && answer !== "NO")) {
      return { error: `Please answer: "${snapshot[i].question}"`, field: `healthAnswers.${i}` };
    }

    if (snapshot[i].type === "yes_no_explain" && answer === "YES") {
      const explanation = entry.explanation;
      if (typeof explanation !== "string" || explanation.trim().length === 0) {
        return {
          error: `Please provide an explanation for: "${snapshot[i].question}"`,
          field: `healthAnswers.${i}.explanation`,
        };
      }
    }

    normalized.push({
      questionIndex: i,
      answer,
      explanation: typeof entry.explanation === "string" ? entry.explanation.trim() || undefined : undefined,
    });
  }

  return { value: normalized };
}

// All clauses in the snapshot must be individually initialed by index --
// count must equal the snapshot length exactly (Phase 4 spec: "count must
// equal the snapshot length").
export function validateClauseInitials(
  snapshot: string[],
  initials: unknown,
): { error: string; field: string } | { value: ClauseInitial[] } {
  if (!Array.isArray(initials) || initials.length !== snapshot.length) {
    return { error: `All ${snapshot.length} clauses must be individually initialed`, field: "clauseInitials" };
  }

  const normalized: ClauseInitial[] = [];

  for (let i = 0; i < snapshot.length; i++) {
    const entry = (initials as Record<string, unknown>[]).find((c) => c && c.clauseIndex === i);
    const value = entry?.initials;

    if (!entry || typeof value !== "string" || value.trim().length === 0) {
      return { error: `Clause ${i + 1} is missing initials`, field: `clauseInitials.${i}` };
    }

    normalized.push({ clauseIndex: i, initials: value.trim() });
  }

  return { value: normalized };
}

// Day-of form -- signed in-shop, so a short window is intentional for the
// route this default was originally built for (POST /appointments/:id/
// waiver, a staff member creating it right before an in-person session).
const WAIVER_TOKEN_TTL_HOURS = 24;

export type EnsureWaiverResult =
  | { ok: true; waiver: LiabilityWaiver; signingUrl: string; created: boolean }
  | { ok: false; error: string };

// Phase 7B-2: shared by the manual route (appointments.ts) and the
// reminder cadence, which needs the exact same "auto-create on first
// need, reuse afterward" behavior -- a waiver already existing for this
// appointment is returned as-is (created: false), never recreated.
//
// minValidUntil is the one behavioral difference between the two
// callers: the manual route's staff-created waiver is genuinely day-of,
// so the existing 24-hour default is untouched there. But a reminder can
// create this waiver via the WEEK-before send, up to 7 days before the
// appointment -- a 24-hour token would be dead long before the client
// ever gets to the night-before/morning-of reminders that link to the
// same waiver. Passing the appointment's own endTime as minValidUntil
// extends the token (never shortens it) so the SAME link keeps resolving
// across every reminder that references it, all the way through the
// appointment itself.
export async function ensureLiabilityWaiver(
  appointmentId: string,
  studioId: string,
  actorUserId: string | null,
  options?: { minValidUntil?: Date },
): Promise<EnsureWaiverResult> {
  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: { liabilityWaiver: true },
  });

  if (!appointment || appointment.studioId !== studioId) {
    return { ok: false, error: "Appointment not found" };
  }

  if (appointment.liabilityWaiver) {
    // A waiver created for a different purpose (day-of, 24-hour TTL) can
    // already exist when a reminder first needs one -- e.g. the
    // appointment was rescheduled further out after that waiver was
    // created. Extend (never shorten) its expiry the same way a
    // brand-new one's is computed below, so the link this reminder is
    // about to send never points at an already-dead token.
    let waiver = appointment.liabilityWaiver;
    if (options?.minValidUntil && (!waiver.tokenExpiresAt || options.minValidUntil > waiver.tokenExpiresAt)) {
      waiver = await prisma.liabilityWaiver.update({
        where: { id: waiver.id },
        data: { tokenExpiresAt: options.minValidUntil },
      });
    }
    return {
      ok: true,
      waiver,
      signingUrl: `${PUBLIC_APP_URL}/waiver/${waiver.token}`,
      created: false,
    };
  }

  const settings = await prisma.studioSettings.findUnique({ where: { studioId } });
  if (!settings?.waiverHealthQuestions || !settings?.waiverClauses) {
    return { ok: false, error: "Configure the waiver template in Settings before creating waivers" };
  }

  const token = crypto.randomBytes(32).toString("hex");
  const defaultExpiresAt = new Date(Date.now() + WAIVER_TOKEN_TTL_HOURS * 60 * 60 * 1000);
  const tokenExpiresAt =
    options?.minValidUntil && options.minValidUntil > defaultExpiresAt ? options.minValidUntil : defaultExpiresAt;

  const waiver = await prisma.liabilityWaiver.create({
    data: {
      studioId,
      clientId: appointment.clientId,
      appointmentId: appointment.id,
      token,
      tokenExpiresAt,
      healthQuestionsSnapshot: settings.waiverHealthQuestions,
      clausesSnapshot: settings.waiverClauses,
      acknowledgmentSnapshot: settings.waiverAcknowledgment,
      photoReleaseSnapshot: settings.waiverPhotoRelease,
    },
  });

  await logAudit({
    studioId,
    actorUserId,
    entityType: "LiabilityWaiver",
    entityId: waiver.id,
    action: "create",
    changes: { appointmentId: appointment.id },
  });

  return { ok: true, waiver, signingUrl: `${PUBLIC_APP_URL}/waiver/${token}`, created: true };
}
