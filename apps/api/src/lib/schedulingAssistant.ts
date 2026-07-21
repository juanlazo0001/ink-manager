import { prisma } from "./prisma";
import { SCHEDULING_BUFFER_MS } from "./schedulingConflict";

// Same shape family as Calendar.tsx's ScheduleBlock / AppointmentForm.tsx's
// client-side equivalent (both now superseded by this one server-side
// service -- see suggestAppointmentSlots.ts's removal in this same
// commit). Array<{ dayOfWeek: 0-6 (0=Sunday), startTime: "HH:MM", endTime: "HH:MM" }>.
export interface ScheduleBlock {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

export interface SuggestedTimeCandidate {
  startTime: Date;
  endTime: Date;
  // "Flag, don't block" (matches findBufferConflict's own philosophy) --
  // true means this slot is within SCHEDULING_BUFFER_MS of another of this
  // artist's appointments the same day. Buffer-clean candidates always
  // rank first; a flagged one is only returned if nothing clean was found
  // anywhere in the search window.
  hasBufferConflict: boolean;
}

export interface GetSuggestedTimesOptions {
  now?: Date;
  searchDays?: number;
  maxSuggestions?: number;
  // Excludes one appointment from conflict consideration -- e.g. when
  // suggesting a new time to replace/reschedule an appointment that
  // already exists, so it doesn't collide with itself.
  excludeAppointmentId?: string;
}

// Fallback window used only when the artist has no preferredSchedule
// configured at all -- same values AppointmentForm's prior client-side
// algorithm used. Deliberately does NOT fall back to Location.hours: there
// is no Artist.locationId (only User.locationId, not currently selected by
// any artist-listing route), so there's no clean way to resolve which
// location an artist belongs to -- same gap the code this replaces already
// called out. An artist's own preferredSchedule is the more directly
// relevant signal anyway.
const DEFAULT_WINDOW_START = "10:00";
const DEFAULT_WINDOW_END = "18:00";
const SLOT_STEP_MINUTES = 30;
// "2-4 weeks" per spec -- picked the midpoint.
const DEFAULT_SEARCH_DAYS = 21;
const DEFAULT_MAX_SUGGESTIONS = 5;

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// The one shared suggestion service behind both Package D consumers: the
// deposit-form "Suggest a time" action (pre-payment, purely informational)
// and AppointmentForm.tsx's post-payment "Suggested times" panel. Reads
// Artist.preferredSchedule + guest window (both advisory-only, same as
// everywhere else they're read) and this artist's own appointments in the
// search window, then flags rather than omits a buffer conflict --
// mirrors findBufferConflict's exact SCHEDULING_BUFFER_MS predicate
// against appointments already fetched here, rather than re-querying per
// candidate (findBufferConflict itself remains the actual enforcement
// point at scheduling time; this only ranks suggestions).
export async function getSuggestedTimes(
  artistId: string,
  durationMinutes: number,
  options: GetSuggestedTimesOptions = {},
): Promise<SuggestedTimeCandidate[]> {
  const {
    now = new Date(),
    searchDays = DEFAULT_SEARCH_DAYS,
    maxSuggestions = DEFAULT_MAX_SUGGESTIONS,
    excludeAppointmentId,
  } = options;

  const artist = await prisma.artist.findUnique({ where: { id: artistId } });
  if (!artist) return [];

  const schedule = (artist.preferredSchedule as unknown as ScheduleBlock[] | null) ?? null;

  const searchStart = new Date(now);
  const searchEnd = new Date(now);
  searchEnd.setDate(searchEnd.getDate() + searchDays);

  const existingAppointments = await prisma.appointment.findMany({
    where: {
      artistId,
      startTime: { lt: searchEnd },
      endTime: { gt: searchStart },
      ...(excludeAppointmentId ? { id: { not: excludeAppointmentId } } : {}),
    },
    select: { startTime: true, endTime: true },
  });

  const cleanCandidates: SuggestedTimeCandidate[] = [];
  const flaggedCandidates: SuggestedTimeCandidate[] = [];

  for (let dayOffset = 0; dayOffset < searchDays; dayOffset++) {
    if (cleanCandidates.length >= maxSuggestions) break;

    const day = new Date(now);
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() + dayOffset);
    const dateKey = localDateKey(day);

    if (artist.isGuest) {
      if (artist.guestStartDate && dateKey < localDateKey(artist.guestStartDate)) continue;
      if (artist.guestEndDate && dateKey > localDateKey(artist.guestEndDate)) continue;
    }

    let windowStart: string;
    let windowEnd: string;
    if (schedule && schedule.length > 0) {
      // No entry for this weekday = fully unavailable that day, same
      // convention as Calendar.tsx's isArtistUnavailable.
      const match = schedule.find((b) => b.dayOfWeek === day.getDay());
      if (!match) continue;
      windowStart = match.startTime;
      windowEnd = match.endTime;
    } else {
      windowStart = DEFAULT_WINDOW_START;
      windowEnd = DEFAULT_WINDOW_END;
    }

    const windowStartMin = timeToMinutes(windowStart);
    const windowEndMin = timeToMinutes(windowEnd);
    if (windowEndMin - windowStartMin < durationMinutes) continue;

    const dayAppointments = existingAppointments.filter((appt) => localDateKey(appt.startTime) === dateKey);

    for (
      let slotStartMin = windowStartMin;
      slotStartMin + durationMinutes <= windowEndMin;
      slotStartMin += SLOT_STEP_MINUTES
    ) {
      if (cleanCandidates.length >= maxSuggestions) break;

      const slotStart = new Date(day);
      slotStart.setMinutes(slotStartMin);
      if (slotStart < now) continue;

      const slotEnd = new Date(slotStart.getTime() + durationMinutes * 60_000);

      // Identical predicate to findBufferConflict's own same-day check.
      const conflict = dayAppointments.find(
        (appt) =>
          slotStart.getTime() < appt.endTime.getTime() + SCHEDULING_BUFFER_MS &&
          appt.startTime.getTime() < slotEnd.getTime() + SCHEDULING_BUFFER_MS,
      );

      const candidate: SuggestedTimeCandidate = { startTime: slotStart, endTime: slotEnd, hasBufferConflict: !!conflict };
      if (conflict) {
        flaggedCandidates.push(candidate);
      } else {
        cleanCandidates.push(candidate);
      }
    }
  }

  if (cleanCandidates.length >= maxSuggestions) return cleanCandidates.slice(0, maxSuggestions);
  return [...cleanCandidates, ...flaggedCandidates].slice(0, maxSuggestions);
}
