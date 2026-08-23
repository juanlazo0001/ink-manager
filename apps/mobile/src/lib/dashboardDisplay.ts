import type { DashboardResponse } from '@ink-manager/shared-types';

/**
 * How the dashboard's numbers read. Pure, so every rounding and every
 * "we don't have enough data to say" decision is checkable without
 * rendering anything.
 */

/**
 * `null` means the API had nothing to compute from, and that is NOT the
 * same as zero. A funnel with no inquiries has a `null` conversion rate;
 * rendering it as "0%" would claim a real failure where there is simply
 * no data. Every formatter here keeps that distinction.
 */
export function formatPercent(value: number | null): string | null {
  return value === null ? null : `${value}%`;
}

/**
 * `4h` / `1.5h` / `2d 3h`. Averages come back as fractional hours.
 *
 * Anything under a day stays in hours because that is how a response time
 * is discussed; past that, days are the only readable unit. Sub-hour
 * averages round to one decimal rather than to "0h", which would read as
 * instantaneous.
 */
export function formatHours(hours: number | null): string | null {
  if (hours === null) return null;
  if (hours < 1) return `${Math.round(hours * 10) / 10}h`;
  if (hours < 24) return `${Math.round(hours * 10) / 10}h`;
  const days = Math.floor(hours / 24);
  const rest = Math.round(hours % 24);
  return rest === 0 ? `${days}d` : `${days}d ${rest}h`;
}

/**
 * The sentence under an average that says how much to trust it.
 *
 * An average of one is not an average, and a dashboard that shows "2.3h"
 * from a single inquiry invites a conclusion the data cannot support.
 */
export function sampleNote(size: number): string {
  if (size === 0) return 'Nothing to average yet.';
  if (size === 1) return 'From a single project.';
  return `From ${size} projects.`;
}

/**
 * The funnel, ready to draw: each stage plus its share of the widest bar.
 *
 * Bars are scaled to the LARGEST stage rather than to `received`, so a
 * funnel whose first stage is zero (a real case — an artist assigned work
 * created before the window) still draws something instead of collapsing
 * to a row of empty bars.
 */
export interface FunnelRow {
  stage: string;
  label: string;
  count: number;
  conversion: string | null;
  /** 0–1. Zero only when every stage is zero. */
  fill: number;
}

export function funnelRows(data: DashboardResponse): FunnelRow[] {
  const stages = data.funnel.stages;
  const max = stages.reduce((m, s) => Math.max(m, s.count), 0);
  return stages.map((s) => ({
    stage: s.stage,
    label: s.label,
    count: s.count,
    conversion: formatPercent(s.conversionFromReceived),
    fill: max === 0 ? 0 : s.count / max,
  }));
}

/** True when the whole window is empty — worth saying once, not six times. */
export function funnelIsEmpty(data: DashboardResponse): boolean {
  return data.funnel.stages.every((s) => s.count === 0);
}

/**
 * Whether the financial sections came back at all.
 *
 * Keyed on the field's PRESENCE, because that is the signal the API
 * chose: it omits both objects entirely rather than zeroing them, so a
 * client can tell "you may not see this" from "no money moved". An
 * artist's default permissions exclude `reports.viewFinancial`, so for
 * most callers of this app it is simply absent.
 */
export function hasFinancials(data: DashboardResponse): boolean {
  return data.depositConversion !== undefined || data.giftCardLiability !== undefined;
}

/** `Welcome, Marta` — the first name only, as web does it. */
export function firstName(name: string | null, email: string): string {
  const trimmed = name?.trim();
  if (trimmed) return trimmed.split(/\s+/)[0];
  return email.split('@')[0];
}
