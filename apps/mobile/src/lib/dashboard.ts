import type { DashboardResponse } from '@ink-manager/shared-types';

import { apiFetch } from './api';
import { shiftDateKey, todayKey } from './studioTime';

/**
 * The dashboard's one request, and the range arithmetic behind it.
 *
 * The range is the whole reason this module is not two lines. `GET
 * /reports/dashboard` takes bare `"YYYY-MM-DD"` keys and resolves them
 * against the STUDIO's timezone — so the keys must be computed in that
 * zone as well. Using the phone's own clock would ask for a different 30
 * days than the studio's, and the answer would be quietly wrong rather
 * than visibly broken. (The API's own range parser had this exact bug
 * against the server's OS clock before it was fixed; the fix is only
 * worth anything if callers hold up their end.)
 */

/** Web's own presets, same three windows and same labels. */
export const RANGE_PRESETS = [
  { days: 7, label: 'Last 7 days' },
  { days: 30, label: 'Last 30 days' },
  { days: 90, label: 'Last 90 days' },
] as const;

export type RangeDays = (typeof RANGE_PRESETS)[number]['days'];

export interface DateRange {
  start: string;
  end: string;
}

/**
 * The last `days` days ending today, in the studio's zone.
 *
 * Inclusive of today, so 7 days means today plus the six before it —
 * `shiftDateKey` does pure key arithmetic and never round-trips through a
 * local `Date`, which is what keeps this correct across a DST boundary.
 */
export function presetRange(days: RangeDays, timeZone: string, now: Date = new Date()): DateRange {
  const end = todayKey(timeZone, now);
  return { start: shiftDateKey(end, -(days - 1)), end };
}

export function fetchDashboard(
  token: string,
  range: DateRange,
  signal?: AbortSignal,
): Promise<DashboardResponse> {
  const query = new URLSearchParams({ start: range.start, end: range.end });
  return apiFetch<DashboardResponse>(`/reports/dashboard?${query.toString()}`, { token, signal });
}
