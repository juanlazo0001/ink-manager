import { prisma } from "../prisma";
import { truncate, type SystemTask, type TaskSource } from "./types";

// A deposit that got paid, but whose tentative time was no longer
// available by the time payment confirmed (see lib/deposits.ts's auto-book
// step) -- distinct from READY_TO_SCHEDULE (an ordinary "hasn't been
// scheduled yet" project, no attempt ever made): this one specifically
// needs a NEW time picked, not a first one. Derived purely from existing
// columns, same as every other source here -- a paid, proposed-time-
// bearing deposit form with no linked appointment is exactly what
// lib/deposits.ts leaves behind when auto-booking finds a conflict.
//
// Judgment call: gated to deposits paid on/after the day this feature
// shipped. Verified live against the real dev database that, without this
// cutoff, this derivation also matches a lot of PRE-EXISTING data -- every
// already-paid deposit that staff simply hadn't gotten around to booking by
// hand yet, from before auto-booking existed to ever produce a real
// conflict. Those are ordinary, unremarkable "needs scheduling" projects,
// not conflicts, and flooding the task feed with them on rollout would be
// actively misleading. A real conflict can only ever be produced by this
// feature's own code, so nothing genuine is excluded by requiring paidAt
// to be after its ship date.
const AUTO_BOOK_SHIPPED_AT = new Date("2026-08-01T00:00:00.000Z");

async function fetch(studioId: string, _userId: string): Promise<SystemTask[]> {
  const plannedConflicts = await prisma.plannedSession.findMany({
    where: {
      appointmentId: null,
      inquiry: { studioId },
      depositForm: { paidAt: { gte: AUTO_BOOK_SHIPPED_AT }, proposedStartAt: { not: null } },
    },
    select: {
      id: true,
      sessionNumber: true,
      depositForm: { select: { paidAt: true } },
      inquiry: { select: { id: true, description: true } },
    },
  });

  // Un-planned path (pre-dates Package M's session plans) -- no
  // PlannedSession row to key off, so this targets the inquiry's own
  // singular appointmentId and latest deposit form instead. Mirrors
  // readyToSchedule.ts's own un-planned appointmentId check.
  const unplannedInquiries = await prisma.inquiry.findMany({
    where: {
      studioId,
      appointmentId: null,
      plannedSessions: { none: {} },
    },
    select: {
      id: true,
      description: true,
      depositForms: {
        where: { paidAt: { gte: AUTO_BOOK_SHIPPED_AT }, proposedStartAt: { not: null } },
        orderBy: { sessionNumber: "desc" },
        take: 1,
        select: { paidAt: true },
      },
    },
  });

  const plannedTasks: SystemTask[] = plannedConflicts.map((ps) => ({
    type: "SCHEDULING_CONFLICT",
    title: `Scheduling conflict: Session ${ps.sessionNumber} of ${truncate(ps.inquiry.description)}`,
    entityType: "Inquiry",
    entityId: ps.inquiry.id,
    dismissalKey: ps.id,
    deepLink: `/inquiries/${ps.inquiry.id}`,
    actionableAt: ps.depositForm!.paidAt as Date,
  }));

  const unplannedTasks: SystemTask[] = unplannedInquiries
    .filter((inquiry) => inquiry.depositForms.length > 0)
    .map((inquiry) => ({
      type: "SCHEDULING_CONFLICT",
      title: `Scheduling conflict: ${truncate(inquiry.description)}`,
      entityType: "Inquiry",
      entityId: inquiry.id,
      dismissalKey: inquiry.id,
      deepLink: `/inquiries/${inquiry.id}`,
      actionableAt: inquiry.depositForms[0].paidAt as Date,
    }));

  return [...plannedTasks, ...unplannedTasks];
}

export const schedulingConflictSource: TaskSource = { type: "SCHEDULING_CONFLICT", label: "Scheduling conflict", fetch };
