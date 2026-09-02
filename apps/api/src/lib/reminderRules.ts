import { civilDateKey, daysBetweenCivilDates } from "./reminderWindow";
import { LiabilityWaiverStatus, ReminderAudience, ReminderCondition } from "../../generated/prisma/enums";

// Package BJ: the pure decision rules behind a studio-configured reminder --
// which placeholders an audience may use, whether a waiver still needs
// chasing, and whether an appointment is due today in the studio's own
// timezone.
//
// Deliberately its OWN module rather than living in the ticker beside the
// send path: the ticker imports prisma, twilio and the realtime layer at
// module load, so anything co-located with it can only be tested against a
// live database. These are the rules worth testing exhaustively, so they sit
// where a unit test can reach them.

// The placeholders a studio may use in a reminder body. Exported so the
// route's validator and the web editor's chip list are driven by this one
// list rather than three hand-kept copies that drift.
export const CLIENT_PLACEHOLDERS = [
  "clientFirstName",
  "appointmentDate",
  "appointmentTime",
  "artistName",
  "waiverLink",
  "studioName",
] as const;

export const ARTIST_PLACEHOLDERS = [
  "artistName",
  "clientName",
  "appointmentDate",
  "appointmentTime",
  "studioName",
] as const;

export function placeholdersFor(audience: ReminderAudience): readonly string[] {
  return audience === ReminderAudience.ARTIST ? ARTIST_PLACEHOLDERS : CLIENT_PLACEHOLDERS;
}

// Is this appointment due for a reminder with this offset, right now, in
// this studio's timezone? Compares CIVIL DATES (what day is it there, what
// day is the appointment there) rather than subtracting instants -- an
// instant subtraction gets a different answer for the same appointment
// depending on where the studio is, and gets DST-adjacent days wrong.
// Exported so the two-timezone test can drive it without a database.
export function appointmentIsDue(startTime: Date, now: Date, timezone: string, offsetDays: number): boolean {
  const todayKey = civilDateKey(now, timezone);
  const startKey = civilDateKey(startTime, timezone);
  return daysBetweenCivilDates(todayKey, startKey) === offsetDays;
}

type WaiverForCheck = { status: LiabilityWaiverStatus } | null;

// A waiver counts as outstanding when there is no waiver record at all, or
// one that nobody has signed yet. SIGNED and VERIFIED are both "done" as far
// as chasing the client goes -- VERIFIED is a later staff step, and a client
// who already signed should never be texted again about signing.
export function waiverIsOutstanding(waiver: WaiverForCheck): boolean {
  if (!waiver) return true;
  return waiver.status === LiabilityWaiverStatus.PENDING;
}

export function conditionHolds(condition: ReminderCondition, waiver: WaiverForCheck): boolean {
  if (condition === ReminderCondition.WAIVER_UNSIGNED) return waiverIsOutstanding(waiver);
  return true;
}
