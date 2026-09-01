import { apiFetch } from '@/lib/api';
import { zonedTimeToUtc } from '@/lib/studioTime';

/**
 * Booking, from the inquiry screen.
 *
 * ─── THERE ARE TWO PATHS, AND ONLY ONE IS MONEY-FREE ────────────────
 *
 * This is the finding that shaped the session, and it is not obvious
 * from the outside: web's inquiry page does NOT book a session through
 * `POST /appointments`. It has two distinct routes.
 *
 *   1. SESSION  — `POST /inquiries/:id/schedule`
 *        { startTime, endTime, giftCardIds }  ->  { bufferWarning }
 *
 *      Requires a NON-EMPTY `giftCardIds`, the inquiry in SCHEDULING,
 *      and an assigned artist. In one transaction it creates a CONFIRMED
 *      appointment AND attaches those gift cards to it
 *      (`tx.giftCard.update({ data: { appointmentId } })`), then moves
 *      the inquiry to CONFIRMED. So booking a session CONSUMES a
 *      client's paid deposit — it is not a calendar action.
 *
 *      NOT BUILT HERE. See the session report: the brief lists booking
 *      as live and gift-card moves as gated, and this route is both at
 *      once, which is an owner call rather than mine.
 *
 *   2. CONSULTATION — `POST /appointments` with
 *        appointmentType: 'CONSULTATION'
 *
 *      The route's own comment: "A CONSULTATION skips the gift-card
 *      requirement entirely -- it's an informal, no-commitment step, not
 *      a booked session." Web's own copy agrees: "no deposit needed, and
 *      this can happen at any point regardless of where the project is
 *      in its pipeline."
 *
 *      That is genuinely money-free, so it is what this session ships.
 */

export type AppointmentType = 'TATTOO_SESSION' | 'CONSULTATION';

export interface CreateAppointmentInput {
  artistId: string;
  clientId: string;
  inquiryId: string;
  /** ISO instants. The route rejects start >= end. */
  startTime: string;
  endTime: string;
  notes?: string;
  appointmentType: AppointmentType;
}

export interface CreatedAppointment {
  id: string;
  startTime: string;
  endTime: string;
  status: string;
  appointmentType?: AppointmentType;
  /**
   * Present when the studio's scheduling buffer is breached.
   *
   * FLAGGED, NEVER BLOCKING — the route's own comment says it surfaces
   * "via bufferWarning so staff can decide", and the appointment is
   * created either way. Mobile must show it after the fact rather than
   * refusing the booking, or it would be enforcing a rule the server
   * deliberately does not.
   */
  bufferWarning?: string | null;
}

/**
 * Book a CONSULTATION.
 *
 * `appointmentType` is sent explicitly. The route defaults an absent
 * field to TATTOO_SESSION — deliberately, so older clients keep
 * working — which means omitting it would silently ask for a session
 * booking and be rejected for want of gift cards. It is never inferred
 * here.
 *
 * Required by the route: artistId, clientId, startTime, endTime,
 * inquiryId. Permission is checked server-side; the caller gates the
 * control on `appointments.create`.
 */
export function createConsultation(
  token: string,
  input: Omit<CreateAppointmentInput, 'appointmentType'>,
): Promise<CreatedAppointment> {
  return apiFetch<CreatedAppointment>('/appointments', {
    token,
    method: 'POST',
    body: JSON.stringify({ ...input, appointmentType: 'CONSULTATION' }),
  });
}

/* ─── time handling ─────────────────────────────────────────────────
 *
 * ─── CORRECTED IN SESSION BD. THE PREVIOUS NOTE HERE WAS WRONG. ─────
 *
 * It argued that combining the date and time in the DEVICE's zone was
 * right "because this is an instant and not a calendar date". The first
 * half is true and the conclusion does not follow. A booking IS a real
 * instant — and CLAUDE.md's rule for exactly that case is that it must
 * be resolved against `StudioSettings.timezone`, never the device's own
 * clock.
 *
 * WHAT THE OLD CODE ACTUALLY DID. Staff pick "9:00" meaning nine in the
 * morning AT THE STUDIO. `new Date(y, m-1, d, 9, 0)` builds nine in the
 * morning WHERE THE PHONE IS. Those are the same instant only while the
 * phone happens to sit in the studio's zone, which is the case that
 * never fails in testing and the only case anybody tested.
 *
 * AND THE SERVER ALREADY DISAGREED WITH IT. `POST /appointments` checks
 * `isSameCalendarDay(start, end, studioSettings.timezone)` — the API has
 * always judged these instants on the STUDIO's calendar. So a booking
 * made from a device one zone away could be rejected for spanning two
 * days when it spans none, or accepted onto the wrong day entirely. The
 * two halves were using different clocks.
 *
 * THE FIX is `zonedTimeToUtc`, which this app already had: it resolves a
 * civil date and wall time in a named IANA zone to the correct instant,
 * DST included, by measuring the zone's offset AT that instant rather
 * than assuming a fixed one.
 *
 * The timezone is now a required argument rather than an optional one
 * with a device fallback. A fallback here is precisely the silent-wrong
 * -day behaviour the repo's rule exists to prevent, and callers already
 * hold the value — `useStudioTimeZone` fetches it once per app run and
 * reports whether it is real or standing in.
 *
 * NOTE FOR A FUTURE SESSION: apps/web has the SAME defect and is out of
 * this session's scope. `DateAndTimeRangeFields.tsx`'s own
 * `combineDateAndTime` does `new Date(\`${date}T${time}:00\`)` — a
 * datetime string with no offset, which JS parses in the browser's local
 * zone. Same bug, same fix.
 */

/**
 * `YYYY-MM-DD` + `HH:MM` in the STUDIO's zone -> an ISO instant.
 * Null if either part is malformed.
 */
export function combineDateAndTime(date: string, time: string, timeZone: string): string | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  const t = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!d || !t) return null;

  const year = Number(d[1]);
  const month = Number(d[2]);
  const day = Number(d[3]);
  const hour = Number(t[1]);
  const minute = Number(t[2]);

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59) return null;

  /*
   * Rolled-over dates (31 February) are caught here, before the zone
   * conversion, using a UTC probe rather than a local one. `Date.UTC`
   * normalises the same way the local constructor does, and doing the
   * check in UTC keeps this validation independent of both the device
   * zone and the studio's — a malformed date is malformed everywhere.
   */
  const probe = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));
  if (Number.isNaN(probe.getTime())) return null;
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;

  const padded = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  const instant = zonedTimeToUtc(`${d[1]}-${d[2]}-${d[3]}`, padded, timeZone);
  return Number.isNaN(instant.getTime()) ? null : instant.toISOString();
}

export interface BookingDraft {
  /** `YYYY-MM-DD` */
  date: string;
  /** `HH:MM`, 24h */
  startTime: string;
  endTime: string;
  artistId: string | null;
  notes: string;
}

/**
 * Validation, mirroring what the route enforces so the form can refuse
 * in place: valid dates, and start strictly before end.
 */
export function validateBooking(draft: BookingDraft, timeZone: string): string | null {
  if (!draft.artistId) return 'Choose an artist.';
  const start = combineDateAndTime(draft.date, draft.startTime, timeZone);
  const end = combineDateAndTime(draft.date, draft.endTime, timeZone);
  if (!start) return 'Enter a date and start time (YYYY-MM-DD and HH:MM).';
  if (!end) return 'Enter an end time (HH:MM).';
  if (new Date(start).getTime() >= new Date(end).getTime()) {
    return 'The end time must be after the start time.';
  }
  return null;
}

/** The exact body the route will receive. Pure, so it can be asserted. */
export function buildBookingBody(
  draft: BookingDraft,
  ids: { clientId: string; inquiryId: string },
  timeZone: string,
): Omit<CreateAppointmentInput, 'appointmentType'> & { appointmentType: 'CONSULTATION' } {
  return {
    artistId: draft.artistId!,
    clientId: ids.clientId,
    inquiryId: ids.inquiryId,
    startTime: combineDateAndTime(draft.date, draft.startTime, timeZone)!,
    endTime: combineDateAndTime(draft.date, draft.endTime, timeZone)!,
    ...(draft.notes.trim() ? { notes: draft.notes.trim() } : {}),
    appointmentType: 'CONSULTATION',
  };
}
