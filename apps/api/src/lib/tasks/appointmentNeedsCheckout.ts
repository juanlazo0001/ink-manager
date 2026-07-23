import { prisma } from "../prisma";
import { AppointmentStatus } from "../../../generated/prisma/enums";
import { civilDateKey } from "../studioTime";
import { type SystemTask, type TaskSource } from "./types";

// Studio-local time is only needed for display (the "ended {time}" part of
// the title, and the dismissalKey below) -- deciding whether the
// appointment is actionable at all is a plain instant comparison
// (endTime < now), no timezone math required, same reasoning as
// estimateFollowup.ts's "elapsed time since a real event" check.
function formatTimeInTz(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit", hourCycle: "h12" }).format(
    date,
  );
}

async function fetch(studioId: string, _userId: string): Promise<SystemTask[]> {
  const settings = await prisma.studioSettings.findUnique({ where: { studioId }, select: { timezone: true } });
  const timezone = settings?.timezone ?? "America/New_York";
  const now = new Date();

  const appointments = await prisma.appointment.findMany({
    where: {
      studioId,
      archivedAt: null,
      checkedOutAt: null,
      endTime: { lt: now },
      // CANCELLED/NO_SHOW are terminal -- no client ever showed up (or the
      // session never happened), so there's nothing to check out. Every
      // other status (REQUESTED, CONFIRMED) is fair game once its endTime
      // has passed; COMPLETED implies checkedOutAt is already set (see the
      // schema's own comment on that field) so it never reaches here anyway.
      status: { notIn: [AppointmentStatus.CANCELLED, AppointmentStatus.NO_SHOW] },
    },
    select: { id: true, endTime: true, client: { select: { firstName: true, lastName: true } } },
    orderBy: { endTime: "asc" },
  });

  return appointments.map((appointment) => ({
    type: "APPOINTMENT_NEEDS_CHECKOUT",
    title: `Check out ${appointment.client.firstName} ${appointment.client.lastName} — appointment ended ${formatTimeInTz(appointment.endTime, timezone)}`,
    entityType: "Appointment",
    entityId: appointment.id,
    // Folds in today's studio-local calendar day (not just the appointment
    // id) -- dismissing this only silences it for the rest of today. Unlike
    // most other dismissable types, this one is tied to a live, still-true
    // condition rather than a one-time event, so a stable dismissalKey
    // would silence it forever even though checkout still hasn't happened.
    // This way it reliably reappears the next day (studio-local) for as
    // long as the appointment stays un-checked-out, exactly as required --
    // real resolution only ever comes from checkedOutAt actually being set.
    dismissalKey: `${appointment.id}:${civilDateKey(now, timezone)}`,
    deepLink: `/appointments/${appointment.id}`,
    actionableAt: appointment.endTime,
  }));
}

export const appointmentNeedsCheckoutSource: TaskSource = {
  type: "APPOINTMENT_NEEDS_CHECKOUT",
  label: "Appointments needing checkout",
  fetch,
};
