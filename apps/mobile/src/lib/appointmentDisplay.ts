import type { AppointmentListItem } from '@ink-manager/shared-types';

import { civilDateKey } from './studioTime';

/**
 * The badge an appointment carries in a list.
 *
 * Deliberately derived rather than taken straight from `status`: the raw
 * status alone hides the two states staff actually act on. A CONFIRMED
 * session whose waiver is still PENDING needs chasing; a COMPLETED one
 * that has not been checked out needs closing. The API returns
 * `liabilityWaiver.status` and `checkedOutAt` in the list payload
 * specifically so a client can tell those apart — the web's status pills
 * do the same.
 *
 * `tone` maps onto the palette's meaning, not its colour:
 *   accent  — needs a person to do something (gold)
 *   neutral — settled, nothing owed
 *   alert   — genuinely wrong or lost (the only red on this screen)
 */
export type AppointmentTone = 'accent' | 'neutral' | 'alert';

export interface AppointmentBadge {
  label: string;
  tone: AppointmentTone;
}

export function appointmentBadge(appointment: AppointmentListItem): AppointmentBadge {
  switch (appointment.status) {
    case 'CANCELLED':
      return { label: 'Cancelled', tone: 'alert' };
    case 'NO_SHOW':
      return { label: 'No show', tone: 'alert' };
    case 'REQUESTED':
      // Not yet agreed to — someone has to confirm it.
      return { label: 'Requested', tone: 'accent' };
    case 'COMPLETED':
      return appointment.checkedOutAt
        ? { label: 'Checked out', tone: 'neutral' }
        : { label: 'Needs checkout', tone: 'accent' };
    case 'CONFIRMED':
    default:
      if (appointment.liabilityWaiver && appointment.liabilityWaiver.status === 'PENDING') {
        return { label: 'Waiver pending', tone: 'accent' };
      }
      return { label: 'Confirmed', tone: 'neutral' };
  }
}

/** A cancelled or no-show session is history, not schedule — drawn muted. */
export function isDimmed(appointment: AppointmentListItem): boolean {
  return appointment.status === 'CANCELLED' || appointment.status === 'NO_SHOW';
}

export function clientName(appointment: AppointmentListItem): string {
  if (!appointment.client) return 'No client';
  return `${appointment.client.firstName} ${appointment.client.lastName}`.trim();
}

/**
 * Per-artist colour, hashed from the artist id.
 *
 * Identical algorithm and palette to `apps/web/src/lib/artistColors.ts`,
 * so the same artist is the same colour on both clients. Copied rather
 * than imported: `@ink-manager/shared-types` is types-only by design, and
 * this is the only piece of shared *behaviour* so far — not enough to
 * justify a second shared package, but worth flagging if a third appears.
 */
const ARTIST_PALETTE = [
  '#5b8def',
  '#e0a53f',
  '#7fbf7f',
  '#d97fd9',
  '#e07a7a',
  '#6bc7c7',
  '#b08fe0',
  '#e0975b',
];

export function colorForArtistId(artistId: string): string {
  let hash = 0;
  for (let i = 0; i < artistId.length; i += 1) {
    hash = (hash * 31 + artistId.charCodeAt(i)) | 0;
  }
  return ARTIST_PALETTE[Math.abs(hash) % ARTIST_PALETTE.length];
}

export interface AppointmentDayGroup {
  dateKey: string;
  appointments: AppointmentListItem[];
}

/**
 * Groups appointments into civil days **in the studio's timezone**.
 *
 * Grouped on each appointment's own `startTime`, never on the range that
 * was requested — the API's range filter is an overlap, so a response can
 * contain sessions that start outside it.
 *
 * Input is already `startTime` ascending from the API; this preserves
 * that order within and across groups rather than re-sorting.
 */
export function groupByStudioDay(
  appointments: AppointmentListItem[],
  timeZone: string,
): AppointmentDayGroup[] {
  const groups: AppointmentDayGroup[] = [];
  for (const appointment of appointments) {
    const dateKey = civilDateKey(new Date(appointment.startTime), timeZone);
    const last = groups[groups.length - 1];
    if (last && last.dateKey === dateKey) {
      last.appointments.push(appointment);
    } else {
      groups.push({ dateKey, appointments: [appointment] });
    }
  }
  return groups;
}

/**
 * The appointments that belong to one studio day.
 *
 * Membership is decided by the appointment's own start date in the
 * studio's zone — so a session running 22:00–02:00 belongs to the day it
 * started, and does not also appear on the next one. That is a choice,
 * and the alternative (showing it on both) was rejected: a schedule that
 * lists the same session twice reads as a double booking.
 */
export function appointmentsOnStudioDay(
  appointments: AppointmentListItem[],
  dateKey: string,
  timeZone: string,
): AppointmentListItem[] {
  return appointments.filter((a) => civilDateKey(new Date(a.startTime), timeZone) === dateKey);
}
