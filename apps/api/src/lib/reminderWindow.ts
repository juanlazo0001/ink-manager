// Phase 7B-2: studio-local send-time math for the reminder ticker. Follows
// this codebase's established convention (lib/dateRange.ts's
// isSameCalendarDay) of native Intl.DateTimeFormat with an explicit
// timeZone, rather than adding date-fns-tz/luxon -- nothing else in the
// repo depends on either, and Intl already does everything needed here.

// YYYY-MM-DD in the given IANA timezone -- en-CA's locale format happens
// to already BE that shape, so no manual part-reassembly is needed.
export function civilDateKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    date,
  );
}

// Whole-day difference between two YYYY-MM-DD keys (to - from). Both are
// parsed as UTC midnight purely as a arithmetic anchor -- neither key
// carries any real timezone meaning anymore once it's a plain date string,
// so this is safe regardless of what timezone produced them.
export function daysBetweenCivilDates(fromKey: string, toKey: string): number {
  const from = Date.parse(`${fromKey}T00:00:00Z`);
  const to = Date.parse(`${toKey}T00:00:00Z`);
  return Math.round((to - from) / 86_400_000);
}

// HH:MM the studio's wall clock reads at this exact UTC instant, as
// minutes since local midnight. Guards against a real ICU quirk: some
// Intl implementations format midnight as "24:00" rather than "00:00"
// with hourCycle left at its locale default -- explicit h23 sidesteps it,
// but the modulo below is a second, cheap belt-and-suspenders guard.
function localMinutesSinceMidnight(date: Date, timeZone: string): number {
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

// The pure predicate the ticker (and its unit tests) both call: is RIGHT
// NOW, in this studio's own timezone, within [targetTime, targetTime +
// windowMinutes)? windowMinutes defaults to 15 to match the ticker's own
// cadence -- a target of "09:00" is considered hit by any tick landing in
// [09:00, 09:15), so a 15-minute cron firing every 15 minutes on the dot
// never misses a target time and never double-fires within the same
// window (paired with each reminder type's own *SentAt dedup field).
export function isWithinSendWindow(
  studioTimezone: string,
  targetTime: string,
  currentUtcInstant: Date,
  windowMinutes = 15,
): boolean {
  const [targetHourStr, targetMinuteStr] = targetTime.split(":");
  const targetMinutes = Number(targetHourStr) * 60 + Number(targetMinuteStr);
  const nowMinutes = localMinutesSinceMidnight(currentUtcInstant, studioTimezone);

  const diff = nowMinutes - targetMinutes;
  return diff >= 0 && diff < windowMinutes;
}
