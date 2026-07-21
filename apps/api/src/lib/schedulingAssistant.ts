import { prisma } from "./prisma";
import { SCHEDULING_BUFFER_MS } from "./schedulingConflict";
import { civilDateKey, zonedTimeToUtc } from "./studioTime";

// Same shape family as Calendar.tsx's ScheduleBlock / AppointmentForm.tsx's
// client-side equivalent (both now superseded by this one server-side
// service -- see suggestAppointmentSlots.ts's removal in an earlier
// commit). Array<{ dayOfWeek: 0-6 (0=Sunday), startTime: "HH:MM", endTime: "HH:MM" }>.
// startTime/endTime are wall-clock values in the STUDIO's own timezone
// (StudioSettings.timezone), never the API server process's own OS
// timezone -- see studioTime.ts's own header comment for the bug this
// distinction fixes.
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
// algorithm used, interpreted in the studio's own timezone same as every
// other window here. Deliberately does NOT fall back to Location.hours:
// there is no Artist.locationId (only User.locationId, not currently
// selected by any artist-listing route), so there's no clean way to
// resolve which location an artist belongs to -- same gap the code this
// replaces already called out. An artist's own preferredSchedule is the
// more directly relevant signal anyway.
const DEFAULT_WINDOW_START = "10:00";
const DEFAULT_WINDOW_END = "18:00";
const SLOT_STEP_MINUTES = 30;
// "2-4 weeks" per spec -- picked the midpoint.
const DEFAULT_SEARCH_DAYS = 21;
const DEFAULT_MAX_SUGGESTIONS = 5;
// Matches StudioSettings.timezone's own schema-level default.
const DEFAULT_TIMEZONE = "America/New_York";

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
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
//
// Every civil-day/wall-clock-time computation below goes through
// studioTime.ts's timezone-aware primitives against the STUDIO's own
// configured timezone -- never a plain `Date` getter/setter, which
// operates in the API server process's own OS timezone and was the exact
// root cause of a reported bug (a UTC-OS-timezone server read a stored
// "09:00" preferredSchedule entry as 9am UTC, i.e. 5am Eastern).
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

  const artist = await prisma.artist.findUnique({ where: { id: artistId }, include: { user: true } });
  if (!artist) return [];

  const studioSettings = await prisma.studioSettings.findUnique({
    where: { studioId: artist.user.studioId },
    select: { timezone: true },
  });
  const timeZone = studioSettings?.timezone ?? DEFAULT_TIMEZONE;

  const schedule = (artist.preferredSchedule as unknown as ScheduleBlock[] | null) ?? null;

  const searchStart = now;
  const searchEnd = new Date(now.getTime() + searchDays * 86_400_000);

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

  // Studio-local "today," as a plain YYYY-MM-DD -- then walked forward
  // purely as calendar-date arithmetic (a UTC-midnight anchor used only
  // for adding days and reading the resulting y/m/d back out, same
  // "arithmetic anchor" convention reminderWindow.ts's own
  // daysBetweenCivilDates already uses; the anchor itself is never treated
  // as a real instant).
  const [startYear, startMonth, startDay] = civilDateKey(now, timeZone).split("-").map(Number);
  const civilCursorAnchor = Date.UTC(startYear, startMonth - 1, startDay);

  for (let dayOffset = 0; dayOffset < searchDays; dayOffset++) {
    if (cleanCandidates.length >= maxSuggestions) break;

    const cursor = new Date(civilCursorAnchor + dayOffset * 86_400_000);
    const dateKey = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}-${String(cursor.getUTCDate()).padStart(2, "0")}`;
    const dayOfWeek = cursor.getUTCDay();

    if (artist.isGuest) {
      if (artist.guestStartDate && dateKey < civilDateKey(artist.guestStartDate, timeZone)) continue;
      if (artist.guestEndDate && dateKey > civilDateKey(artist.guestEndDate, timeZone)) continue;
    }

    let windowStart: string;
    let windowEnd: string;
    if (schedule && schedule.length > 0) {
      // No entry for this weekday = fully unavailable that day, same
      // convention as Calendar.tsx's isArtistUnavailable.
      const match = schedule.find((b) => b.dayOfWeek === dayOfWeek);
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

    const dayAppointments = existingAppointments.filter(
      (appt) => civilDateKey(appt.startTime, timeZone) === dateKey,
    );

    for (
      let slotStartMin = windowStartMin;
      slotStartMin + durationMinutes <= windowEndMin;
      slotStartMin += SLOT_STEP_MINUTES
    ) {
      if (cleanCandidates.length >= maxSuggestions) break;

      // The real UTC instant "this wall-clock time, in the studio's own
      // timezone, on this date" corresponds to -- not a server-OS-local
      // Date.setHours/setMinutes call.
      const slotStart = zonedTimeToUtc(dateKey, minutesToTime(slotStartMin), timeZone);
      if (slotStart < now) continue;

      const slotEnd = new Date(slotStart.getTime() + durationMinutes * 60_000);

      // Identical predicate to findBufferConflict's own overlap check --
      // pure absolute-instant math, already timezone-agnostic.
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
