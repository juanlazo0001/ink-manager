// Phase UI-4: "never spans more than one calendar day" needs to mean the
// STUDIO's calendar day, not the API server's own OS timezone or a naive
// UTC-date comparison -- a UTC-date check would false-positive reject
// plenty of legitimate same-local-day appointments in US timezones west of
// Eastern (e.g. 3pm-5pm Pacific is one local day but crosses UTC midnight).
export function isSameCalendarDay(start: Date, end: Date, timeZone: string): boolean {
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  return fmt.format(start) === fmt.format(end);
}
