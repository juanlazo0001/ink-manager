// Real, persistent unit tests for the shared studio-timezone primitives --
// run with `npx tsx --test src/lib/studioTime.test.ts` (or `npm test`,
// which now runs every *.test.ts under src/lib). No new dependency: Node's
// built-in test runner + assert, matching this codebase's existing
// "no test framework installed" state without adding one just for this.
//
// These specifically guard against the reported bug: a stored "09:00"
// Artist.preferredSchedule entry was being read as 9am in the API server
// PROCESS's own OS timezone, not the STUDIO's configured timezone
// (StudioSettings.timezone) -- on a UTC-OS-timezone server that's 9am UTC,
// i.e. 5am Eastern, a silent 4-hour shift.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  civilDateKey,
  isSameCalendarDay,
  localDayOfWeek,
  localMinutesSinceMidnight,
  zonedTimeToUtc,
} from "./studioTime";

test("zonedTimeToUtc: 09:00 America/New_York in July (EDT, UTC-4) is 13:00 UTC, NOT 09:00 UTC", () => {
  const instant = zonedTimeToUtc("2026-07-22", "09:00", "America/New_York");
  assert.equal(instant.toISOString(), "2026-07-22T13:00:00.000Z");
  // The exact bug this whole session fixes: stored "09:00" must never be
  // read as-is as 09:00 UTC.
  assert.notEqual(instant.getUTCHours(), 9);
});

test("zonedTimeToUtc: 09:00 America/New_York in January (EST, UTC-5) -- DST correctness", () => {
  const instant = zonedTimeToUtc("2026-01-22", "09:00", "America/New_York");
  assert.equal(instant.toISOString(), "2026-01-22T14:00:00.000Z");
});

test("zonedTimeToUtc: 17:00 (5pm) America/New_York in July matches the reported artist's end-of-day", () => {
  const instant = zonedTimeToUtc("2026-07-22", "17:00", "America/New_York");
  assert.equal(instant.toISOString(), "2026-07-22T21:00:00.000Z");
});

test("localMinutesSinceMidnight: round-trips zonedTimeToUtc's output back to the original wall-clock minutes", () => {
  const instant = zonedTimeToUtc("2026-07-22", "09:00", "America/New_York");
  assert.equal(localMinutesSinceMidnight(instant, "America/New_York"), 9 * 60);
});

test("civilDateKey: 10pm Eastern is still the PREVIOUS UTC calendar day", () => {
  // 2026-07-23T02:00:00Z is 2026-07-22T22:00 Eastern (EDT, UTC-4).
  const instant = new Date("2026-07-23T02:00:00.000Z");
  assert.equal(civilDateKey(instant, "America/New_York"), "2026-07-22");
  assert.equal(civilDateKey(instant, "UTC"), "2026-07-23");
});

test("localDayOfWeek: 2026-07-22 (a Wednesday) is 3 in America/New_York", () => {
  const instant = zonedTimeToUtc("2026-07-22", "12:00", "America/New_York");
  assert.equal(localDayOfWeek(instant, "America/New_York"), 3);
});

test("isSameCalendarDay: same UTC day but different Eastern day is correctly NOT the same day in that timezone", () => {
  const lateNightEastern = new Date("2026-07-23T02:00:00.000Z"); // 2026-07-22, 10pm Eastern
  const earlyMorningEastern = new Date("2026-07-23T10:00:00.000Z"); // 2026-07-23, 6am Eastern
  assert.equal(isSameCalendarDay(lateNightEastern, earlyMorningEastern, "UTC"), true);
  assert.equal(isSameCalendarDay(lateNightEastern, earlyMorningEastern, "America/New_York"), false);
});

test("isSameCalendarDay: same Eastern day even though it crosses UTC midnight", () => {
  // 9pm and 11:30pm Eastern on 2026-07-22 -- both after UTC midnight
  // rollover (2026-07-23 UTC), but still the same Eastern calendar day.
  const nineEastern = new Date("2026-07-23T01:00:00.000Z");
  const elevenThirtyEastern = new Date("2026-07-23T03:30:00.000Z");
  assert.equal(isSameCalendarDay(nineEastern, elevenThirtyEastern, "America/New_York"), true);
});

test("round trip: zonedTimeToUtc -> civilDateKey/localMinutesSinceMidnight recovers the original date+time for several timezones", () => {
  const cases: { dateKey: string; time: string; timeZone: string }[] = [
    { dateKey: "2026-07-22", time: "09:00", timeZone: "America/New_York" },
    { dateKey: "2026-01-05", time: "23:45", timeZone: "America/Los_Angeles" },
    { dateKey: "2026-03-08", time: "01:30", timeZone: "America/Chicago" }, // US DST spring-forward day
    { dateKey: "2026-11-01", time: "01:30", timeZone: "America/Chicago" }, // US DST fall-back day
  ];

  for (const { dateKey, time, timeZone } of cases) {
    const instant = zonedTimeToUtc(dateKey, time, timeZone);
    assert.equal(civilDateKey(instant, timeZone), dateKey, `civilDateKey mismatch for ${timeZone} ${dateKey} ${time}`);
    const [h, m] = time.split(":").map(Number);
    assert.equal(
      localMinutesSinceMidnight(instant, timeZone),
      h * 60 + m,
      `localMinutesSinceMidnight mismatch for ${timeZone} ${dateKey} ${time}`,
    );
  }
});
