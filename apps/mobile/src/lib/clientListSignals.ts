import type { AppointmentListItem } from '@ink-manager/shared-types';

import type { ChipTone } from '@/components/StatusChip';

/**
 * What a client row can truthfully say beyond a name — and what it cannot.
 *
 * Both halves of session X's items 4 and 5 were investigated against the
 * API rather than assumed, and the answers differ.
 *
 * ─── ITEM 4, PREFERRED CHANNEL: NOT SUPPORTED ────────────────────────
 *
 * There is no channel to show, because nothing can tell us one:
 *
 *   Client model      has `email`, `phone`, `instagramHandle`,
 *                     `facebookProfileUrl` — and NO preferred/most-used
 *                     channel column of any kind.
 *   GET /clients      `findMany` with no select: every scalar, no
 *                     relations. Nothing channel-related to derive from.
 *   GET /inquiries    DOES carry `channel` — but `INQUIRY_LIST_SELECT`
 *                     selects `client: { firstName, lastName }` with no
 *                     `id` and no `clientId`. There is no key to join on.
 *                     Matching by name is not an option in an app that
 *                     ships a duplicate-client detector.
 *   GET /conversations carries `clientId` but no channel on the summary.
 *
 * So the subtitle stays the best identity available and carries NO
 * channel glyph. Rendering one would mean guessing which channel a person
 * prefers, and a wrong glyph is worse than none. The handle IS stored
 * (`instagramHandle`) — it is the channel that is unknowable, not the
 * identity. See the report for what the backend would need to expose.
 *
 * ─── ITEM 5, STATUS CHIP: PARTIALLY SUPPORTED ────────────────────────
 *
 * Of the owner's three, exactly one is reachable without N+1:
 *
 *   upcoming appointment  YES. `GET /appointments` accepts a date range
 *                         and returns `clientId` per row, so ONE bounded
 *                         request covers every client on screen.
 *   pending deposit       NO. No list endpoint exposes deposit-form state
 *                         per client.
 *   active inquiry        NO. Same missing join key as item 4.
 *
 * The chip therefore shows the top-priority signal only, which happens to
 * be the one the owner ranked first.
 */

/** How far ahead to look. Web's own filter says "upcoming", unbounded. */
const HORIZON_DAYS = 120;

export function upcomingWindow(now: Date): { start: Date; end: Date } {
  const end = new Date(now);
  end.setDate(end.getDate() + HORIZON_DAYS);
  return { start: now, end };
}

/**
 * `clientId -> their soonest upcoming appointment`.
 *
 * Web's own "upcoming appointment" activity filter is
 * `startTime >= now AND status = CONFIRMED`; the same definition is used
 * here so the chip agrees with the filter that produced it.
 */
export function buildUpcomingByClient(
  appointments: AppointmentListItem[],
  now: Date,
): Record<string, AppointmentListItem> {
  const out: Record<string, AppointmentListItem> = {};
  for (const appointment of appointments) {
    if (!appointment.clientId) continue;
    if (appointment.status !== 'CONFIRMED') continue;
    if (new Date(appointment.startTime) < now) continue;
    const held = out[appointment.clientId];
    if (!held || new Date(appointment.startTime) < new Date(held.startTime)) {
      out[appointment.clientId] = appointment;
    }
  }
  return out;
}

/** The row's one chip, or nothing. */
export function clientStatusChip(
  upcoming: AppointmentListItem | undefined,
): { label: string; tone: ChipTone } | null {
  if (!upcoming) return null;
  // `info` rather than a status tone: this is not a state the client is
  // in, it is a fact about their calendar.
  return { label: 'Booked', tone: 'info' };
}

/**
 * The best identity available, with no claim about channel.
 *
 * Email first because it is the one field that both identifies a person
 * and is unique in practice; then a formatted number; then the Instagram
 * handle, which is real stored data for the clients who came in that way.
 */
export function clientIdentity(
  client: {
    email?: string | null;
    phone?: string | null;
    instagramHandle?: string | null;
  },
  formatPhone: (v: string | null | undefined) => string,
): string | null {
  if (client.email) return client.email;
  if (client.phone) return formatPhone(client.phone);
  if (client.instagramHandle) {
    const handle = client.instagramHandle.trim();
    return handle.startsWith('@') ? handle : `@${handle}`;
  }
  return null;
}
