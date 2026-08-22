import type { AppointmentDetail, AppointmentListItem, StudioSettingsResponse } from '@ink-manager/shared-types';

import { apiFetch } from './api';

/**
 * `GET /appointments`.
 *
 * Nothing here filters or re-sorts. The route already returns
 * `startTime` ascending, already excludes archived appointments, and
 * already scopes by role: an ARTIST caller is forced to their own artist
 * id server-side, across every studio they currently belong to (home plus
 * active guest memberships), whatever `artistId` is sent. OWNER and
 * FRONT_DESK see the studio. Re-deriving any of that on a phone would at
 * best duplicate it.
 *
 * `start`/`end` are instants and the filter is an **overlap**
 * (`startTime < end AND endTime > start`), so a session that began the
 * previous evening and runs past midnight is correctly returned for the
 * day it spills into — and, conversely, a returned appointment is not
 * guaranteed to *start* inside the window. Callers that group by day must
 * group on the appointment's own start, not on the requested range.
 *
 * There is no pagination: the route caps at 500 results with a valid
 * range and 100 without.
 */
export function fetchAppointments(
  token: string,
  params: { start?: Date; end?: Date; artistId?: string } = {},
  signal?: AbortSignal,
): Promise<AppointmentListItem[]> {
  const query = new URLSearchParams();
  // Both or neither — the API ignores one without the other, silently
  // widening to the unranged 100-result cap.
  if (params.start && params.end) {
    query.set('start', params.start.toISOString());
    query.set('end', params.end.toISOString());
  }
  if (params.artistId) query.set('artistId', params.artistId);

  const suffix = query.toString() ? `?${query.toString()}` : '';
  return apiFetch<AppointmentListItem[]>(`/appointments${suffix}`, { token, signal });
}

/**
 * `GET /studio-settings` — read here for one field, `timezone`.
 *
 * Open to OWNER, FRONT_DESK and ARTIST alike, so every role that can
 * reach the Schedule tab can also learn which clock it is on. The
 * response is the whole settings row; only what `StudioSettingsResponse`
 * declares is relied on.
 */
export function fetchStudioSettings(token: string, signal?: AbortSignal): Promise<StudioSettingsResponse> {
  return apiFetch<StudioSettingsResponse>('/studio-settings', { token, signal });
}

/**
 * `GET /appointments/:id`.
 *
 * Permission is evaluated at the APPOINTMENT's own studio, not the
 * caller's home one -- a guest artist's view rights follow the record.
 * Two distinct failures come back and mean different things:
 *
 *   404 -- no such appointment, OR it belongs to a studio the caller has
 *          no membership at. Deliberately indistinguishable, so the route
 *          cannot be used to probe for records.
 *   403 -- the caller is a member of that studio but lacks
 *          `appointments.view` there.
 */
export function fetchAppointment(
  token: string,
  appointmentId: string,
  signal?: AbortSignal,
): Promise<AppointmentDetail> {
  // Encoded, not interpolated raw: an id is data, and data in a path
  // segment has to be escaped. Real ids are cuids and would survive
  // either way, which is exactly why this is easy to get wrong once and
  // never notice.
  return apiFetch<AppointmentDetail>(`/appointments/${encodeURIComponent(appointmentId)}`, { token, signal });
}
