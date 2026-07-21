// Shared, timezone-aware primitives for anything comparing a stored local
// wall-clock time (Artist.preferredSchedule, guest-window dates, business
// hours) against real UTC Date instants -- always in the STUDIO's own
// configured timezone (StudioSettings.timezone), never the API server
// process's own OS timezone. Conflating the two is exactly the bug this
// file was created to fix: apps/api/src/lib/schedulingAssistant.ts read a
// stored "09:00" preferredSchedule entry as the server's local 9am, which
// on a UTC-OS-timezone production server is actually 5am Eastern -- a
// silent, near-exact 4-hour shift that only shows up once the server's OS
// timezone differs from the studio's configured one.
//
// Follows this codebase's established convention (see dateRange.ts's
// prior isSameCalendarDay and reminderWindow.ts's prior civilDateKey/
// localMinutesSinceMidnight, both now consolidated here) of plain
// Intl.DateTimeFormat with an explicit timeZone, rather than adding a
// date/timezone library -- nothing else in the repo depends on one, and
// Intl already does everything needed here.

// YYYY-MM-DD in the given IANA timezone.
export function civilDateKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    date,
  );
}

// HH:MM the studio's wall clock reads at this exact UTC instant, as
// minutes since local midnight. Guards against a real ICU quirk: some
// Intl implementations format midnight as "24:00" rather than "00:00"
// with hourCycle left at its locale default -- explicit h23 sidesteps it,
// but the modulo below is a second, cheap belt-and-suspenders guard.
export function localMinutesSinceMidnight(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

// 0 (Sunday) - 6 (Saturday) this instant falls on, in the given IANA
// timezone. Derived from civilDateKey rather than any local Date getter,
// so it's immune to the server's own OS timezone entirely.
export function localDayOfWeek(date: Date, timeZone: string): number {
  const [y, m, d] = civilDateKey(date, timeZone).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

// Do `start` and `end` fall on the same calendar day IN THE GIVEN
// TIMEZONE? A naive UTC-date (or server-OS-date) comparison would
// false-positive reject plenty of legitimate same-local-day appointments
// (e.g. 3pm-5pm Pacific is one local day but crosses UTC midnight).
export function isSameCalendarDay(start: Date, end: Date, timeZone: string): boolean {
  return civilDateKey(start, timeZone) === civilDateKey(end, timeZone);
}

// The studio timezone's UTC offset (in minutes, e.g. -240 for EDT) at the
// given instant.
function offsetMinutesAt(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return (asUtc - instant.getTime()) / 60_000;
}

// Converts a civil (wall-clock) date + "HH:MM" in the given IANA timezone
// into the actual UTC instant it represents -- the missing direction
// neither dateRange.ts nor reminderWindow.ts needed before (they only
// ever go instant -> local, never local -> instant). This is exactly what
// generating a candidate appointment slot from a stored "09:00"
// preferredSchedule entry requires: constructing the real UTC instant
// that "9am in the studio's own timezone, on this date" corresponds to,
// regardless of what timezone the server process itself happens to be
// running in.
//
// Two-pass offset correction handles DST transitions correctly (the
// standard technique for Intl-only timezone conversion): guess the
// instant by treating the wall-clock time as UTC, find that guess's real
// offset in the target zone, correct by it, then re-check the corrected
// instant's offset in case the correction crossed a DST boundary.
export function zonedTimeToUtc(dateKey: string, time: string, timeZone: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  const [hours, minutes] = time.split(":").map(Number);

  const guess = new Date(Date.UTC(year, month - 1, day, hours, minutes, 0));
  const offset1 = offsetMinutesAt(guess, timeZone);
  const corrected = new Date(guess.getTime() - offset1 * 60_000);
  const offset2 = offsetMinutesAt(corrected, timeZone);
  if (offset2 === offset1) return corrected;
  return new Date(guess.getTime() - offset2 * 60_000);
}
