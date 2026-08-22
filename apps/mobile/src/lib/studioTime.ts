/**
 * Studio-timezone primitives for the Schedule screens.
 *
 * ---------------------------------------------------------------------
 * Why this file exists rather than reusing `src/lib/time.ts`
 * ---------------------------------------------------------------------
 * `time.ts` formats a chat timestamp in the VIEWER's own zone, which is
 * correct there — "when was this, from where I am sitting". Scheduling is
 * the opposite question. "What is on today", where a day begins and ends,
 * and what wall-clock time a session reads at are all questions about the
 * STUDIO's clock. Those two answers diverge constantly in practice: an
 * artist working a guest residency two zones over, or simply a phone that
 * has not caught up after a flight.
 *
 * This is the bug class the repo's standing rules single out as having
 * recurred independently several times, so nothing here is allowed to
 * touch a local `Date` getter (`getHours`, `getDate`, `toDateString`, …).
 * Every function takes an explicit IANA `timeZone` and goes through
 * `Intl.DateTimeFormat`, mirroring `apps/api/src/lib/studioTime.ts` — the
 * same technique, ported rather than reinvented, so both sides agree.
 *
 * Deliberately no date library: `Intl` does all of this, it is in Hermes,
 * and nothing else in this app pulls one in.
 *
 * NOTE on Hermes: full ICU is bundled on iOS and on Android from RN 0.73
 * onward, so `Intl.DateTimeFormat` with an arbitrary `timeZone` works on
 * device. `resolveStudioTimeZone` below still guards against a runtime
 * that rejects the zone, because falling back to the device zone is far
 * better than throwing on the Schedule tab.
 */

/** `"YYYY-MM-DD"` — the civil date this instant falls on, in `timeZone`. */
export function civilDateKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** Minutes since local midnight, in `timeZone`. `h23` sidesteps the ICU "24:00" quirk. */
export function localMinutesSinceMidnight(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0') % 24;
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return hour * 60 + minute;
}

/** 0 (Sunday) – 6 (Saturday), derived from the civil date rather than any local getter. */
export function localDayOfWeek(date: Date, timeZone: string): number {
  const [y, m, d] = civilDateKey(date, timeZone).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** The studio zone's UTC offset in minutes at this instant (e.g. -240 for EDT). */
function offsetMinutesAt(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);

  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0');
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return (asUtc - instant.getTime()) / 60_000;
}

/**
 * `("2026-08-22", "09:00", "America/Los_Angeles")` → the real UTC instant.
 *
 * Two-pass offset correction, the standard Intl-only technique: guess by
 * treating the wall clock as UTC, correct by that guess's offset, then
 * re-check in case the correction stepped across a DST boundary. Same
 * implementation as the API's own `zonedTimeToUtc`.
 */
export function zonedTimeToUtc(dateKey: string, time: string, timeZone: string): Date {
  const [year, month, day] = dateKey.split('-').map(Number);
  const [hours, minutes] = time.split(':').map(Number);

  const guess = new Date(Date.UTC(year, month - 1, day, hours, minutes, 0));
  const offset1 = offsetMinutesAt(guess, timeZone);
  const corrected = new Date(guess.getTime() - offset1 * 60_000);
  const offset2 = offsetMinutesAt(corrected, timeZone);
  if (offset2 === offset1) return corrected;
  return new Date(guess.getTime() - offset2 * 60_000);
}

/**
 * The half-open instant range covering one civil day in `timeZone`:
 * `[00:00 that day, 00:00 the next day)`.
 *
 * This is exactly what `GET /appointments?start=&end=` wants. Note the
 * API filters by OVERLAP (`startTime < end AND endTime > start`), so a
 * session that begins the previous evening and runs past midnight is
 * correctly included in the day it spills into.
 *
 * Computed by adding 24h to the day's start and re-deriving the next
 * civil date, rather than by arithmetic on the date parts — that keeps it
 * correct across DST, where a civil day is 23 or 25 hours long.
 */
export function studioDayRange(dateKey: string, timeZone: string): { start: Date; end: Date } {
  const start = zonedTimeToUtc(dateKey, '00:00', timeZone);
  const nextDayKey = civilDateKey(new Date(start.getTime() + 26 * 60 * 60 * 1000), timeZone);
  const end = zonedTimeToUtc(nextDayKey, '00:00', timeZone);
  return { start, end };
}

/** `"YYYY-MM-DD"` `offset` days from `dateKey`, staying on civil dates throughout. */
export function shiftDateKey(dateKey: string, offset: number): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + offset));
  return [
    shifted.getUTCFullYear(),
    String(shifted.getUTCMonth() + 1).padStart(2, '0'),
    String(shifted.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

/** The studio's own "today". */
export function todayKey(timeZone: string, now: Date = new Date()): string {
  return civilDateKey(now, timeZone);
}

/** `"14:30"` — the studio's wall clock at this instant, 24h, zero-padded. */
export function studioTimeOfDay(iso: string, timeZone: string): string {
  const minutes = localMinutesSinceMidnight(new Date(iso), timeZone);
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** `"Sat 22 Aug"` for a civil date key, without ever constructing a local Date. */
export function formatDateKey(
  dateKey: string,
  options: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' },
): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  // Formatted as UTC from a UTC-constructed date, so the calendar parts
  // survive untouched whatever zone the device is in.
  return new Intl.DateTimeFormat(undefined, { ...options, timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** `Today` / `Tomorrow` / `Yesterday`, else a formatted date. Relative to the STUDIO's today. */
export function relativeDayLabel(dateKey: string, timeZone: string, now: Date = new Date()): string {
  const today = todayKey(timeZone, now);
  if (dateKey === today) return 'Today';
  if (dateKey === shiftDateKey(today, 1)) return 'Tomorrow';
  if (dateKey === shiftDateKey(today, -1)) return 'Yesterday';
  return formatDateKey(dateKey, { weekday: 'long', day: 'numeric', month: 'long' });
}

/** Minutes between two instants, for a duration label. */
export function durationMinutes(startIso: string, endIso: string): number {
  return Math.max(0, Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60_000));
}

/** `2h 30m` / `45m`. */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** The device's own zone, used only to decide whether to SHOW the studio's zone. */
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * `America/Los_Angeles` → `Los Angeles`. Shown next to times only when the
 * studio's zone differs from the phone's, so a travelling artist is never
 * quietly reading someone else's clock.
 */
export function shortZoneLabel(timeZone: string): string {
  const last = timeZone.split('/').pop() ?? timeZone;
  return last.replace(/_/g, ' ');
}

/**
 * Guards against a runtime that rejects the studio's IANA zone. Falling
 * back to the device zone is a visible, explainable degradation; throwing
 * inside a formatter would take the whole screen down.
 */
export function resolveStudioTimeZone(timeZone: string | null | undefined): string {
  if (!timeZone) return deviceTimeZone();
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());
    return timeZone;
  } catch {
    return deviceTimeZone();
  }
}
