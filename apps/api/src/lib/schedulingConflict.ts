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
  // Previously bucketed by UTC calendar day (Date.UTC(start...)) -- the
  // same class of timezone bug reported and fixed elsewhere in this
  // session: an appointment near local midnight for a studio timezone far
  // enough from UTC could fall in a different UTC day than a genuinely
  // conflicting appointment 20 minutes away on the studio's own clock,
  // and never even get fetched for the overlap check below. A window
  // padded by the buffer on both sides is provably sufficient instead --
  // anything outside it cannot possibly satisfy the overlap predicate,
  // regardless of what calendar day it falls on in any timezone -- so
  // there's no need to reason about "which day" at all here.
  const windowStart = new Date(start.getTime() - SCHEDULING_BUFFER_MS);
  const windowEnd = new Date(end.getTime() + SCHEDULING_BUFFER_MS);

  const nearbyAppointments = await prisma.appointment.findMany({
    where: {
      artistId,
      startTime: { lt: windowEnd },
      endTime: { gt: windowStart },
      ...(excludeAppointmentId ? { id: { not: excludeAppointmentId } } : {}),
    },
    select: { id: true, startTime: true, endTime: true },
  });

  return (
    nearbyAppointments.find(
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
