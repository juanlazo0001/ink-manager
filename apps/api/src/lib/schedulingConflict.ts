import { prisma } from "./prisma";

// "Flagged, not blocked" -- an artist double-booked within the buffer of
// another same-day appointment is worth a heads-up, not a hard stop.
// Originally lived inline in inquiries.ts's /schedule route; extracted here
// so the calendar's click-create and drag-reschedule (Phase UI-5) can warn
// the same way without a second implementation.
//
// Settings "Defaults" tab: was a flat, non-configurable 1.5h
// (SCHEDULING_BUFFER_MS) -- now StudioSettings.schedulingBufferMinutes,
// see REPORT.md's Part 1 proposal. This constant is now only the fallback
// for the rare case a studio's settings row is somehow missing (every
// studio gets one via getOrCreateSettings in routes/studioSettings.ts) --
// it matches the prior hardcoded value exactly, so a missing-row fallback
// never silently changes behavior.
export const DEFAULT_SCHEDULING_BUFFER_MS = 1.5 * 60 * 60 * 1000;

// Per-artist override, then the studio's own default, then the hardcoded
// fallback -- candidates are checked in the order passed, first non-null
// wins. Every call site passes (artist.schedulingBufferMinutes,
// studioSettings.schedulingBufferMinutes) in that order, so an artist's own
// override (Artist.schedulingBufferMinutes) always takes precedence over
// the studio-wide default when both are set.
export function resolveSchedulingBufferMs(...minutesCandidates: (number | null | undefined)[]): number {
  for (const minutes of minutesCandidates) {
    if (minutes != null) return minutes * 60_000;
  }
  return DEFAULT_SCHEDULING_BUFFER_MS;
}

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
  bufferMs: number = DEFAULT_SCHEDULING_BUFFER_MS,
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
  const windowStart = new Date(start.getTime() - bufferMs);
  const windowEnd = new Date(end.getTime() + bufferMs);

  // Deliberately no appointmentType (or status) filter -- a CONSULTATION
  // blocks time on this artist's calendar exactly like a TATTOO_SESSION
  // does, so it must count as a real conflict here too. Verified: a
  // tattoo session can't be booked over an existing consultation's slot.
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
      (appt) => start.getTime() < appt.endTime.getTime() + bufferMs && appt.startTime.getTime() < end.getTime() + bufferMs,
    ) ?? null
  );
}

function formatBufferHours(bufferMs: number): string {
  const hours = bufferMs / (60 * 60 * 1000);
  const rounded = Math.round(hours * 100) / 100;
  return `${rounded} hour${rounded === 1 ? "" : "s"}`;
}

export function formatBufferWarning(
  conflict: ConflictingAppointment | null,
  bufferMs: number = DEFAULT_SCHEDULING_BUFFER_MS,
): string | null {
  return conflict
    ? `Less than ${formatBufferHours(bufferMs)} from another appointment for this artist the same day (${conflict.startTime.toISOString()} – ${conflict.endTime.toISOString()}).`
    : null;
}
