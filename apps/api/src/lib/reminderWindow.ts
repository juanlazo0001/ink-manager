// Phase 7B-2: studio-local send-time math for the reminder ticker.
// civilDateKey/localMinutesSinceMidnight now live in studioTime.ts (the
// shared home for every studio-timezone-aware time comparison after the
// Package D scheduling timezone bug) -- civilDateKey is re-exported here
// so this module's own existing external consumers (reminderTicker.ts)
// don't need to change their import path.
export { civilDateKey } from "./studioTime";
import { localMinutesSinceMidnight } from "./studioTime";

// Whole-day difference between two YYYY-MM-DD keys (to - from). Both are
// parsed as UTC midnight purely as a arithmetic anchor -- neither key
// carries any real timezone meaning anymore once it's a plain date string,
// so this is safe regardless of what timezone produced them.
export function daysBetweenCivilDates(fromKey: string, toKey: string): number {
  const from = Date.parse(`${fromKey}T00:00:00Z`);
  const to = Date.parse(`${toKey}T00:00:00Z`);
  return Math.round((to - from) / 86_400_000);
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
