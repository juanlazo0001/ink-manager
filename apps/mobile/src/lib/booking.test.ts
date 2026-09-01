// Booking resolves against the STUDIO's clock, not the device's.
//
// ─── THE TWO-TIMEZONE STANDARD ──────────────────────────────────────
//
// CLAUDE.md: "Before calling a date/timezone fix or feature verified,
// prove it with a two-timezone test: pin `now`, set the relevant studio's
// timezone to something deliberately different from the machine running
// the check, and confirm the result tracks the studio's zone."
//
// That is what this does, and it does it the only way that is honest on
// a machine whose own zone is fixed: the DEVICE zone is varied by running
// the same assertions under two different `TZ` values (see the npm script
// `test:booking`, which runs this file twice), and the STUDIO zone is
// varied as an argument. The invariant asserted is that the output does
// not move when the device zone does.
//
// ─── HOW IT FAILS ───────────────────────────────────────────────────
//
// Under the old implementation — `new Date(y, m-1, d, hh, mm)` — every
// assertion below that names a studio zone different from the device's
// produces a different instant, so the file goes red on the first one.
// The device-zone-invariance test is the direct inversion of the old
// behaviour: it passed trivially before only when the two zones matched.

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildBookingBody, combineDateAndTime, validateBooking } from "./booking";

const NY = "America/New_York";
const TOKYO = "Asia/Tokyo";
const KIRITIMATI = "Pacific/Kiritimati"; // UTC+14, the far edge

/** What the machine running this file is actually set to. */
const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

test("9am at the studio is the studio's 9am, whatever the device thinks", () => {
  // 2026-09-05 is EDT (UTC-4). 09:00 EDT === 13:00Z.
  assert.equal(
    combineDateAndTime("2026-09-05", "09:00", NY),
    "2026-09-05T13:00:00.000Z",
  );
  // 09:00 JST (UTC+9, no DST) === 00:00Z the same day.
  assert.equal(
    combineDateAndTime("2026-09-05", "09:00", TOKYO),
    "2026-09-05T00:00:00.000Z",
  );
  // 09:00 at UTC+14 === 19:00Z the PREVIOUS day. The day flips, which is
  // the case that makes a device-zone bug visible as a wrong DATE and not
  // merely a wrong hour.
  assert.equal(
    combineDateAndTime("2026-09-05", "09:00", KIRITIMATI),
    "2026-09-04T19:00:00.000Z",
  );
});

test("the device's own zone does not enter into it", () => {
  // The whole point. This value is a constant of the studio zone and the
  // wall time; the machine's TZ is reported only so a failure says which
  // device zone produced it.
  assert.equal(
    combineDateAndTime("2026-09-05", "14:30", NY),
    "2026-09-05T18:30:00.000Z",
    `device zone was ${deviceZone}`,
  );
});

test("DST is measured at the instant, not assumed", () => {
  // 2026-01-15 is EST (UTC-5): 09:00 -> 14:00Z.
  assert.equal(combineDateAndTime("2026-01-15", "09:00", NY), "2026-01-15T14:00:00.000Z");
  // 2026-07-15 is EDT (UTC-4): 09:00 -> 13:00Z. Same wall time, same
  // zone, one hour apart in UTC.
  assert.equal(combineDateAndTime("2026-07-15", "09:00", NY), "2026-07-15T13:00:00.000Z");
});

test("the studio's calendar day is what the server will check", () => {
  // The API runs isSameCalendarDay(start, end, studio.timezone). A 22:00
  // -> 23:00 booking in Tokyo is one Tokyo day and two UTC days; the
  // instants must still be the ones Tokyo means.
  const start = combineDateAndTime("2026-09-05", "22:00", TOKYO);
  const end = combineDateAndTime("2026-09-05", "23:00", TOKYO);
  assert.equal(start, "2026-09-05T13:00:00.000Z");
  assert.equal(end, "2026-09-05T14:00:00.000Z");
});

test("malformed input is refused the same way in every zone", () => {
  for (const zone of [NY, TOKYO, KIRITIMATI]) {
    assert.equal(combineDateAndTime("2026-02-31", "09:00", zone), null, zone);
    assert.equal(combineDateAndTime("2026-13-01", "09:00", zone), null, zone);
    assert.equal(combineDateAndTime("2026-09-05", "25:00", zone), null, zone);
    assert.equal(combineDateAndTime("not-a-date", "09:00", zone), null, zone);
  }
});

test("validation compares instants in studio time", () => {
  const draft = {
    date: "2026-09-05",
    startTime: "14:00",
    endTime: "13:00",
    artistId: "a1",
    notes: "",
  };
  assert.equal(validateBooking(draft, TOKYO), "The end time must be after the start time.");
  assert.equal(validateBooking({ ...draft, endTime: "15:00" }, TOKYO), null);
  // The positive sibling: a valid draft must actually pass, or the
  // negative above could be satisfied by a validator that rejects
  // everything.
  assert.equal(validateBooking({ ...draft, endTime: "15:00" }, NY), null);
});

test("the body sent to the API carries studio-resolved instants", () => {
  const body = buildBookingBody(
    { date: "2026-09-05", startTime: "09:00", endTime: "10:00", artistId: "a1", notes: "" },
    { clientId: "c1", inquiryId: "i1" },
    TOKYO,
  );
  assert.equal(body.startTime, "2026-09-05T00:00:00.000Z");
  assert.equal(body.endTime, "2026-09-05T01:00:00.000Z");
  assert.equal(body.appointmentType, "CONSULTATION");
});
