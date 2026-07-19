import { prisma } from "./prisma";

// "Flagged, not blocked" -- an artist double-booked within 1.5 hours of
// another same-day appointment is worth a heads-up, not a hard stop.
// Originally lived inline in inquiries.ts's /schedule route; extracted here
// so the calendar's click-create and drag-reschedule (Phase UI-5) can warn
// the same way without a second implementation.
export const SCHEDULING_BUFFER_MS = 1.5 * 60 * 60 * 1000;

export interface ConflictingAppointment {
  id: string;
  startTime: Date;
  endTime: Date;
}

export async function findBufferConflict(
  artistId: string,
  start: Date,
  end: Date,
  excludeAppointmentId?: string,
): Promise<ConflictingAppointment | null> {
  const dayStart = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const sameDayAppointments = await prisma.appointment.findMany({
    where: {
      artistId,
      startTime: { gte: dayStart, lt: dayEnd },
      ...(excludeAppointmentId ? { id: { not: excludeAppointmentId } } : {}),
    },
    select: { id: true, startTime: true, endTime: true },
  });

  return (
    sameDayAppointments.find(
      (appt) =>
        start.getTime() < appt.endTime.getTime() + SCHEDULING_BUFFER_MS &&
        appt.startTime.getTime() < end.getTime() + SCHEDULING_BUFFER_MS,
    ) ?? null
  );
}

export function formatBufferWarning(conflict: ConflictingAppointment | null): string | null {
  return conflict
    ? `Less than 1.5 hours from another appointment for this artist the same day (${conflict.startTime.toISOString()} – ${conflict.endTime.toISOString()}).`
    : null;
}
