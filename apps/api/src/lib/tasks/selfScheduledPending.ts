import { prisma } from "../prisma";
import { AppointmentStatus } from "../../../generated/prisma/enums";
import { truncate, type SystemTask, type TaskSource } from "./types";

// Client self-scheduling exploration: every Appointment a client picked for
// themselves is created with status REQUESTED, never CONFIRMED (see
// selfSchedule.ts's respond route) -- staff must actively confirm or adjust
// it. REQUESTED is otherwise unused by any other appointment-creation path
// in the app today, so this derivation can't pick up anything else. No
// auto-expiry: an unconfirmed request stays surfaced here indefinitely,
// same as every other undismissed system task, until staff acts on it or
// dismisses it.
async function fetch(studioId: string, _userId: string): Promise<SystemTask[]> {
  const pending = await prisma.appointment.findMany({
    where: { studioId, status: AppointmentStatus.REQUESTED, archivedAt: null },
    select: { id: true, createdAt: true, client: { select: { firstName: true, lastName: true } } },
    orderBy: { createdAt: "asc" },
  });

  return pending.map((appt) => ({
    type: "SELF_SCHEDULED_PENDING",
    title: `Review requested appointment — ${truncate(`${appt.client.firstName} ${appt.client.lastName}`)}`,
    entityType: "Appointment",
    entityId: appt.id,
    dismissalKey: appt.id,
    deepLink: `/appointments/${appt.id}`,
    actionableAt: appt.createdAt,
  }));
}

export const selfScheduledPendingSource: TaskSource = {
  type: "SELF_SCHEDULED_PENDING",
  label: "Client self-scheduled — needs confirmation",
  fetch,
};
