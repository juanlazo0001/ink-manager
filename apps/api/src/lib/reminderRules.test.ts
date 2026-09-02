import test from "node:test";
import assert from "node:assert/strict";
import { LiabilityWaiverStatus, ReminderAudience, ReminderCondition } from "../../generated/prisma/enums";
import {
  ARTIST_PLACEHOLDERS,
  CLIENT_PLACEHOLDERS,
  appointmentIsDue,
  conditionHolds,
  placeholdersFor,
  waiverIsOutstanding,
} from "./reminderRules";

// ---------------------------------------------------------------------------
// The waiver condition. This is the whole point of the WAIVER_UNSIGNED
// reminder: the built-in cadence already texts everyone, so a reminder that
// fired regardless of waiver state would be a duplicate of what shipped
// before this package.
// ---------------------------------------------------------------------------

test("a missing waiver record counts as outstanding", () => {
  assert.equal(waiverIsOutstanding(null), true);
});

test("a PENDING waiver is outstanding", () => {
  assert.equal(waiverIsOutstanding({ status: LiabilityWaiverStatus.PENDING }), true);
});

// The plausible-wrong implementation is "a waiver row exists, so they signed".
// These two are what fails under it.
test("a SIGNED waiver is NOT outstanding", () => {
  assert.equal(waiverIsOutstanding({ status: LiabilityWaiverStatus.SIGNED }), false);
});

test("a VERIFIED waiver is NOT outstanding -- verification is a later staff step", () => {
  assert.equal(waiverIsOutstanding({ status: LiabilityWaiverStatus.VERIFIED }), false);
});

test("WAIVER_UNSIGNED suppresses the send once the client has signed", () => {
  assert.equal(
    conditionHolds(ReminderCondition.WAIVER_UNSIGNED, { status: LiabilityWaiverStatus.SIGNED }),
    false,
  );
});

// Strict positive sibling for the suppression above: the same signed waiver,
// on an unconditional reminder, must still send. Without this, an
// implementation that simply returned false for everything would pass the
// suppression test.
test("NONE sends even when the waiver is already signed", () => {
  assert.equal(conditionHolds(ReminderCondition.NONE, { status: LiabilityWaiverStatus.SIGNED }), true);
});

test("WAIVER_UNSIGNED still sends while the waiver is outstanding", () => {
  assert.equal(
    conditionHolds(ReminderCondition.WAIVER_UNSIGNED, { status: LiabilityWaiverStatus.PENDING }),
    true,
  );
});

// ---------------------------------------------------------------------------
// Two-timezone proof (CLAUDE.md: any date/time work must show the result
// tracks the STUDIO's zone, not the machine running the check).
//
// One fixed instant for the appointment and one for "now". Read in New York
// they are the same civil day; read in Tokyo they are one day apart. A
// correct implementation therefore gives OPPOSITE answers for the same two
// instants, which is what pins it to the studio's zone.
//
//   appointment 2026-09-03T02:00Z -> Sep 2, 22:00 in New York
//                                 -> Sep 3, 11:00 in Tokyo
//   now         2026-09-02T14:00Z -> Sep 2, 10:00 in New York
//                                 -> Sep 2, 23:00 in Tokyo
// ---------------------------------------------------------------------------

const APPOINTMENT = new Date("2026-09-03T02:00:00.000Z");
const NOW = new Date("2026-09-02T14:00:00.000Z");

test("New York reads that appointment as TODAY (offset 0)", () => {
  assert.equal(appointmentIsDue(APPOINTMENT, NOW, "America/New_York", 0), true);
  assert.equal(appointmentIsDue(APPOINTMENT, NOW, "America/New_York", 1), false);
});

test("Tokyo reads the SAME instants as TOMORROW (offset 1)", () => {
  assert.equal(appointmentIsDue(APPOINTMENT, NOW, "Asia/Tokyo", 1), true);
  assert.equal(appointmentIsDue(APPOINTMENT, NOW, "Asia/Tokyo", 0), false);
});

// The specific wrong implementation this guards against: subtracting the two
// instants and dividing by 24h. That gives 12 hours -> "0 days" for BOTH
// zones, so it agrees with New York by luck and is wrong for Tokyo.
test("the day-before reminder is not an instant subtraction", () => {
  const hoursApart = (APPOINTMENT.getTime() - NOW.getTime()) / 3_600_000;
  assert.equal(hoursApart, 12, "fixture sanity: the two instants are 12 hours apart");
  assert.equal(
    appointmentIsDue(APPOINTMENT, NOW, "Asia/Tokyo", 1),
    true,
    "12 hours apart, yet correctly the day before in Tokyo",
  );
});

// DST: America/New_York springs forward 2026-03-08. The civil day before
// 2026-03-09 is 2026-03-08 even though that day is only 23 hours long, which
// an hours-based offset gets wrong.
test("a 23-hour DST day is still one civil day", () => {
  const apptAfterDst = new Date("2026-03-09T14:00:00.000Z"); // Mar 9, 10:00 EDT
  const nowBeforeDst = new Date("2026-03-08T17:00:00.000Z"); // Mar 8, 13:00 EDT
  assert.equal(appointmentIsDue(apptAfterDst, nowBeforeDst, "America/New_York", 1), true);
});

// ---------------------------------------------------------------------------
// Placeholders.
// ---------------------------------------------------------------------------

test("an artist reminder cannot use the waiver link", () => {
  // The waiver is the client's to sign; the artist body never gets a
  // waiverLink value rendered, so allowing the token would send the literal
  // "{{waiverLink}}" to a real phone.
  assert.equal(ARTIST_PLACEHOLDERS.includes("waiverLink" as never), false);
  assert.equal(CLIENT_PLACEHOLDERS.includes("waiverLink" as never), true);
});

test("placeholdersFor picks the list matching the audience", () => {
  assert.deepEqual([...placeholdersFor(ReminderAudience.CLIENT)], [...CLIENT_PLACEHOLDERS]);
  assert.deepEqual([...placeholdersFor(ReminderAudience.ARTIST)], [...ARTIST_PLACEHOLDERS]);
});
