import { prisma } from "./prisma";
import { resolveSchedulingBufferMs } from "./schedulingConflict";
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
  // true means this slot is within the studio's configured scheduling
  // buffer of another of this artist's appointments the same day.
  // Buffer-clean candidates always rank first; a flagged one is only
  // returned if nothing clean was found anywhere in the search window.
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

// Shared artist-side context every function below needs -- resolved once
// per call (not per day) since none of it varies by date. Extracted so the
// client self-scheduling date/time picker (getAvailableDates/
// getSlotsForDate below) can reuse the exact same artist-availability
// rules getSuggestedTimes already enforces, rather than a second,
// potentially-drifting copy of "how do we read this artist's schedule."
interface AvailabilityContext {
  artistId: string;
  timeZone: string;
  bufferMs: number;
  schedule: ScheduleBlock[] | null;
  isGuest: boolean;
  guestStartDate: Date | null;
  guestEndDate: Date | null;
}

async function resolveAvailabilityContext(artistId: string): Promise<AvailabilityContext | null> {
  const artist = await prisma.artist.findUnique({ where: { id: artistId }, include: { user: true } });
  if (!artist) return null;

  const studioSettings = await prisma.studioSettings.findUnique({
    where: { studioId: artist.user.studioId },
    select: { timezone: true, schedulingBufferMinutes: true },
  });

  return {
    artistId,
    timeZone: studioSettings?.timezone ?? DEFAULT_TIMEZONE,
    bufferMs: resolveSchedulingBufferMs(artist.schedulingBufferMinutes, studioSettings?.schedulingBufferMinutes),
    schedule: (artist.preferredSchedule as unknown as ScheduleBlock[] | null) ?? null,
    isGuest: artist.isGuest,
    guestStartDate: artist.guestStartDate,
    guestEndDate: artist.guestEndDate,
  };
}

// This day's working window ("HH:MM"-"HH:MM"), or null if the artist is
// unavailable all day (outside their guest window, or preferredSchedule
// has no entry for this weekday -- same "no entry = fully unavailable"
// convention Calendar.tsx's isArtistUnavailable already uses). Duration
// itself is checked by the caller, since "the window exists but is
// shorter than the requested session" is a per-duration question, not a
// per-day one.
function dayWindow(context: AvailabilityContext, dateKey: string, dayOfWeek: number): { start: string; end: string } | null {
  if (context.isGuest) {
    if (context.guestStartDate && dateKey < civilDateKey(context.guestStartDate, "UTC")) return null;
    if (context.guestEndDate && dateKey > civilDateKey(context.guestEndDate, "UTC")) return null;
  }

  if (context.schedule && context.schedule.length > 0) {
    const match = context.schedule.find((b) => b.dayOfWeek === dayOfWeek);
    return match ? { start: match.startTime, end: match.endTime } : null;
  }

  return { start: DEFAULT_WINDOW_START, end: DEFAULT_WINDOW_END };
}

// Every slot-step candidate for one civil day, split clean vs buffer-
// flagged -- the one place the actual step-through-the-window loop lives,
// shared by getSuggestedTimes' multi-day search and getSlotsForDate's
// single-day one. `dayAppointments` is this artist's appointments already
// filtered to this exact dateKey (by civilDateKey, in the studio's own
// timezone) -- callers fetch the underlying appointments once for
// whatever window they need and filter per day, rather than this function
// querying per day itself.
function computeDaySlots(
  context: AvailabilityContext,
  dateKey: string,
  dayOfWeek: number,
  durationMinutes: number,
  dayAppointments: { startTime: Date; endTime: Date }[],
  now: Date,
): { clean: SuggestedTimeCandidate[]; flagged: SuggestedTimeCandidate[] } {
  const window = dayWindow(context, dateKey, dayOfWeek);
  if (!window) return { clean: [], flagged: [] };

  const windowStartMin = timeToMinutes(window.start);
  const windowEndMin = timeToMinutes(window.end);
  if (windowEndMin - windowStartMin < durationMinutes) return { clean: [], flagged: [] };

  const clean: SuggestedTimeCandidate[] = [];
  const flagged: SuggestedTimeCandidate[] = [];

  for (
    let slotStartMin = windowStartMin;
    slotStartMin + durationMinutes <= windowEndMin;
    slotStartMin += SLOT_STEP_MINUTES
  ) {
    // The real UTC instant "this wall-clock time, in the studio's own
    // timezone, on this date" corresponds to -- not a server-OS-local
    // Date.setHours/setMinutes call.
    const slotStart = zonedTimeToUtc(dateKey, minutesToTime(slotStartMin), context.timeZone);
    if (slotStart < now) continue;

    const slotEnd = new Date(slotStart.getTime() + durationMinutes * 60_000);

    // Identical predicate to findBufferConflict's own overlap check --
    // pure absolute-instant math, already timezone-agnostic.
    const conflict = dayAppointments.find(
      (appt) =>
        slotStart.getTime() < appt.endTime.getTime() + context.bufferMs &&
        appt.startTime.getTime() < slotEnd.getTime() + context.bufferMs,
    );

    const candidate: SuggestedTimeCandidate = { startTime: slotStart, endTime: slotEnd, hasBufferConflict: !!conflict };
    (conflict ? flagged : clean).push(candidate);
  }

  return { clean, flagged };
}

// Studio-local "today" (or `now`), as a plain YYYY-MM-DD -- then walked
// forward purely as calendar-date arithmetic (a UTC-midnight anchor used
// only for adding days and reading the resulting y/m/d back out, same
// "arithmetic anchor" convention reminderWindow.ts's own
// daysBetweenCivilDates already uses; the anchor itself is never treated
// as a real instant).
function civilCursorAnchor(now: Date, timeZone: string): number {
  const [y, m, d] = civilDateKey(now, timeZone).split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function dateKeyForOffset(anchor: number, dayOffset: number): { dateKey: string; dayOfWeek: number } {
  const cursor = new Date(anchor + dayOffset * 86_400_000);
  return {
    dateKey: `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}-${String(cursor.getUTCDate()).padStart(2, "0")}`,
    dayOfWeek: cursor.getUTCDay(),
  };
}

// The one shared suggestion service behind both Package D consumers: the
// deposit-form "Suggest a time" action (pre-payment, purely informational)
// and AppointmentForm.tsx's post-payment "Suggested times" panel. Reads
// Artist.preferredSchedule + guest window (both advisory-only, same as
// everywhere else they're read) and this artist's own appointments in the
// search window, then flags rather than omits a buffer conflict --
// mirrors findBufferConflict's exact buffer-window predicate against
// appointments already fetched here, rather than re-querying per
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

  const context = await resolveAvailabilityContext(artistId);
  if (!context) return [];

  const searchStart = now;
  const searchEnd = new Date(now.getTime() + searchDays * 86_400_000);

  // Same "no appointmentType filter" property as findBufferConflict's own
  // query -- an existing CONSULTATION occupies this artist's time exactly
  // like a TATTOO_SESSION does, so it's never suggested over as if the
  // slot were open. Verified explicitly, not assumed.
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
  const anchor = civilCursorAnchor(now, context.timeZone);

  for (let dayOffset = 0; dayOffset < searchDays; dayOffset++) {
    if (cleanCandidates.length >= maxSuggestions) break;

    const { dateKey, dayOfWeek } = dateKeyForOffset(anchor, dayOffset);
    const dayAppointments = existingAppointments.filter(
      (appt) => civilDateKey(appt.startTime, context.timeZone) === dateKey,
    );

    const { clean, flagged } = computeDaySlots(context, dateKey, dayOfWeek, durationMinutes, dayAppointments, now);
    for (const candidate of clean) {
      if (cleanCandidates.length >= maxSuggestions) break;
      cleanCandidates.push(candidate);
    }
    flaggedCandidates.push(...flagged);
  }

  if (cleanCandidates.length >= maxSuggestions) return cleanCandidates.slice(0, maxSuggestions);
  return [...cleanCandidates, ...flaggedCandidates].slice(0, maxSuggestions);
}

export interface GetAvailableDatesOptions {
  now?: Date;
  searchDays?: number;
  excludeAppointmentId?: string;
}

// Client self-scheduling date/time picker: which calendar dates (within
// the search window) have at least one genuinely available -- buffer-
// clean, not just flagged -- slot for this artist/duration. Drives which
// days are selectable in the picker's calendar grid; every other date is
// disabled outright, not just visually greyed (unlike the advisory-only
// unavailableDaysOfWeek styling DateAndTimeRangeFields uses for staff),
// since a client's picker must never even offer a date that turns out to
// have nothing on it.
export async function getAvailableDates(
  artistId: string,
  durationMinutes: number,
  options: GetAvailableDatesOptions = {},
): Promise<string[]> {
  const { now = new Date(), searchDays = DEFAULT_SEARCH_DAYS, excludeAppointmentId } = options;

  const context = await resolveAvailabilityContext(artistId);
  if (!context) return [];

  const searchEnd = new Date(now.getTime() + searchDays * 86_400_000);
  // Padded a day behind `now`, not started exactly at it -- an appointment
  // that already ended minutes ago can still have a buffer window
  // reaching forward past `now` (e.g. ended 19:30, 90-min buffer reaches
  // 21:00), and a query starting exactly at `now` would silently drop it,
  // undercounting the very first day's conflicts. Same "pad, don't compute
  // exact boundaries" reasoning getSlotsForDate/findBufferConflict already
  // use for their own windows.
  const searchStart = new Date(now.getTime() - 86_400_000);

  const existingAppointments = await prisma.appointment.findMany({
    where: {
      artistId,
      startTime: { lt: searchEnd },
      endTime: { gt: searchStart },
      ...(excludeAppointmentId ? { id: { not: excludeAppointmentId } } : {}),
    },
    select: { startTime: true, endTime: true },
  });

  const anchor = civilCursorAnchor(now, context.timeZone);
  const availableDates: string[] = [];

  for (let dayOffset = 0; dayOffset < searchDays; dayOffset++) {
    const { dateKey, dayOfWeek } = dateKeyForOffset(anchor, dayOffset);
    const dayAppointments = existingAppointments.filter(
      (appt) => civilDateKey(appt.startTime, context.timeZone) === dateKey,
    );

    const { clean } = computeDaySlots(context, dateKey, dayOfWeek, durationMinutes, dayAppointments, now);
    if (clean.length > 0) availableDates.push(dateKey);
  }

  return availableDates;
}

export interface GetSlotsForDateOptions {
  now?: Date;
  excludeAppointmentId?: string;
}

// The time-of-day options for one specific date already confirmed
// available (via getAvailableDates) -- buffer-clean only, same reasoning
// as getAvailableDates above: this picker offers exactly what's available,
// not a "close, with a warning" fallback the way the older suggested-
// times panel does for staff.
export async function getSlotsForDate(
  artistId: string,
  durationMinutes: number,
  dateKey: string,
  options: GetSlotsForDateOptions = {},
): Promise<SuggestedTimeCandidate[]> {
  const { now = new Date(), excludeAppointmentId } = options;

  const context = await resolveAvailabilityContext(artistId);
  if (!context) return [];

  const [year, month, day] = dateKey.split("-").map(Number);
  if (!year || !month || !day) return [];
  const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();

  // A day-wide window in the studio's own timezone, padded a day on each
  // side -- simplest way to be provably wide enough to catch every
  // appointment that could overlap this civil day in any timezone,
  // without reasoning about exactly where the day's own UTC boundaries
  // fall (same "pad, don't compute exact boundaries" approach
  // findBufferConflict's own window uses).
  const dayStart = zonedTimeToUtc(dateKey, "00:00", context.timeZone);
  const searchStart = new Date(dayStart.getTime() - 86_400_000);
  const searchEnd = new Date(dayStart.getTime() + 2 * 86_400_000);

  const existingAppointments = await prisma.appointment.findMany({
    where: {
      artistId,
      startTime: { lt: searchEnd },
      endTime: { gt: searchStart },
      ...(excludeAppointmentId ? { id: { not: excludeAppointmentId } } : {}),
    },
    select: { startTime: true, endTime: true },
  });

  const dayAppointments = existingAppointments.filter((appt) => civilDateKey(appt.startTime, context.timeZone) === dateKey);

  const { clean } = computeDaySlots(context, dateKey, dayOfWeek, durationMinutes, dayAppointments, now);
  return clean;
}
