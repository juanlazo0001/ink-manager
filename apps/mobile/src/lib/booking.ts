import { apiFetch } from '@/lib/api';

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
 * A booking is a REAL INSTANT judged against a studio's wall clock, not
 * a calendar date — CLAUDE.md's two conventions, and this is squarely
 * the second one. The date and time are collected separately (as web
 * does, via `combineDateAndTime`) and combined in the DEVICE's local
 * zone, which is the zone the person tapping is standing in.
 *
 * `new Date(y, m-1, d, hh, mm)` is local-midnight-style construction —
 * the LOCAL convention — and `.toISOString()` then expresses that exact
 * instant in UTC. That is correct here precisely because this is an
 * instant and not a calendar date: the same moment, written in the
 * transport's zone.
 */

/** `YYYY-MM-DD` + `HH:MM` -> an ISO instant, or null if either is malformed. */
export function combineDateAndTime(date: string, time: string): string | null {
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

  const dt = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (Number.isNaN(dt.getTime())) return null;
  // Catches a rolled-over date -- new Date(2026, 1, 31) is 3 March.
  if (dt.getMonth() !== month - 1 || dt.getDate() !== day) return null;
  return dt.toISOString();
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
export function validateBooking(draft: BookingDraft): string | null {
  if (!draft.artistId) return 'Choose an artist.';
  const start = combineDateAndTime(draft.date, draft.startTime);
  const end = combineDateAndTime(draft.date, draft.endTime);
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
): Omit<CreateAppointmentInput, 'appointmentType'> & { appointmentType: 'CONSULTATION' } {
  return {
    artistId: draft.artistId!,
    clientId: ids.clientId,
    inquiryId: ids.inquiryId,
    startTime: combineDateAndTime(draft.date, draft.startTime)!,
    endTime: combineDateAndTime(draft.date, draft.endTime)!,
    ...(draft.notes.trim() ? { notes: draft.notes.trim() } : {}),
    appointmentType: 'CONSULTATION',
  };
}
