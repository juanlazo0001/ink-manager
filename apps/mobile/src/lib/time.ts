/**
 * Timestamp formatting for the conversation views.
 *
 * Everything here reads the **viewer's own device clock**, deliberately.
 * This repo has a recurring bug class around timezones, so it is worth
 * being explicit about which side of that line this falls on: a message's
 * `createdAt` is a real instant, and the question a chat UI asks of it is
 * "when was this, from where I am sitting right now" — not "what calendar
 * day was this for the studio". The web app answers it the same way
 * (`toDateString()` / `toLocaleDateString()` with no timezone forced in
 * ConversationsPanel.tsx), so the two clients agree.
 *
 * This is NOT the case that needs `StudioSettings.timezone`. Anything
 * judged against a studio's business hours, its "today", or its wall clock
 * — scheduling, reminders, dashboard ranges — does, and none of that lives
 * here. If a screen in this app ever needs one of those, it must resolve
 * the studio's zone rather than reuse these helpers.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** `14:32` in the viewer's locale and clock convention. */
export function timeOfDay(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** Stable per-calendar-day key, for grouping messages under a separator. */
export function dayKey(iso: string): string {
  return new Date(iso).toDateString();
}

/** `Today` / `Yesterday` / `3 April 2026` — same three cases as the web app. */
export function dayLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}

/**
 * Compact relative stamp for a list row, where a full date would crowd the
 * name: `now`, `12m`, `5h`, `Tue`, `3 Apr`.
 */
export function relativeStamp(iso: string | null): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  const elapsed = Date.now() - then;

  if (elapsed < MINUTE) return 'now';
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h`;
  if (elapsed < 7 * DAY) return new Date(then).toLocaleDateString(undefined, { weekday: 'short' });
  return new Date(then).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/**
 * Consecutive same-side messages inside one minute are drawn as a single
 * burst under one meta row, rather than each bubble repeating its own
 * timestamp. Same rule and same granularity as the web app.
 */
export function sameMinute(a: string, b: string): boolean {
  return Math.floor(new Date(a).getTime() / MINUTE) === Math.floor(new Date(b).getTime() / MINUTE);
}

/**
 * The thread separator's label (chat spec §2.2).
 *
 * A day word plus a time, in the four shapes the spec names:
 *
 *   Today 2:14 PM        · today
 *   Yesterday 2:14 PM    · yesterday
 *   Tue 2:14 PM          · within the last 7 days
 *   Aug 12, 2:14 PM      · older
 *
 * `dayLabel` above is deliberately NOT reused: it answers "which day is
 * this" for a date-only context and returns a long "August 12, 2026" that
 * reads as a heading. A separator is a timestamp, so it wants the short
 * form and always carries the clock.
 */
export function separatorLabel(iso: string): { day: string; time: string } {
  const date = new Date(iso);
  const time = timeOfDay(iso);

  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return { day: 'Today', time };
  if (date.toDateString() === yesterday.toDateString()) return { day: 'Yesterday', time };

  // Seven days back, measured in whole days so a message from 6 days and
  // 23 hours ago does not flip format mid-scroll.
  const days = Math.floor((today.getTime() - date.getTime()) / 86_400_000);
  if (days <= 7) return { day: date.toLocaleDateString(undefined, { weekday: 'short' }), time };

  return { day: `${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })},`, time };
}
