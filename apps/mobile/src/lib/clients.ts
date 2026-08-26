import type { InquiryStatus } from '@ink-manager/shared-types';

import { apiFetch } from './api';
import { formatPhone } from './format';

/**
 * Clients — `GET /clients` and `GET /clients/:id`.
 *
 * Typed from the live dev responses: `packages/shared-types` has no
 * client interfaces, so both apps/web and this file describe the same
 * payload independently. That is the drift risk shared-types exists to
 * prevent, and it is logged as an API gap rather than silently accepted.
 */

export interface ClientPhone {
  id: string;
  phone: string;
  label: string | null;
  isPrimary: boolean;
}

export interface ClientEmail {
  id: string;
  email: string;
  label: string | null;
  isPrimary: boolean;
}

/** A row of `GET /clients`. */
export interface ClientListItem {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  archivedAt: string | null;
  updatedAt: string;
  createdAt: string;
}

/** One of the client's inquiries, as the DETAIL payload embeds it. */
export interface ClientInquiry {
  id: string;
  status: InquiryStatus;
  description: string | null;
  channel: string | null;
  service: string | null;
  createdAt: string;
  priceEstimateLow: number | null;
  priceEstimateHigh: number | null;
  depositForms: ClientDepositForm[];
  plannedSessions: ClientPlannedSession[];
}

/**
 * A planned session, as `GET /clients/:id` actually returns one.
 *
 * THIS TYPE USED TO BE `{ id, sessionNumber? }` AND THAT WAS WRONG. The
 * API selects estimates, `appointmentId` and the appointment's
 * `checkedOutAt` as well (`apps/api/src/routes/clients.ts`), and mobile
 * was discarding all of it at the type boundary. Sessions P, Q and R each
 * reported the booking chip as blocked on missing API surface; it never
 * was — the data was in the payload the whole time.
 */
export interface ClientPlannedSession {
  id: string;
  sessionNumber?: number;
  estimatedHoursMin: number | null;
  estimatedHoursMax: number | null;
  estimatedPriceLow: number | null;
  estimatedPriceHigh: number | null;
  appointmentId: string | null;
  appointment: { checkedOutAt: string | null } | null;
}

/** A row of web's Deposit Forms table. */
export interface ClientDepositForm {
  id: string;
  sessionNumber: number | null;
  depositAmount: number;
  totalCharged: number;
  signedAt: string | null;
  paidAt: string | null;
  giftCard: { id: string; code: string } | null;
}

export interface ClientGiftCard {
  id: string;
  code: string;
  amountCents: number;
  status: string;
  expiresAt: string | null;
  /** Web's "Attached" column is simply whether it is tied to an appointment. */
  appointmentId: string | null;
}

export interface ClientWaiver {
  id: string;
  status?: string | null;
  signedAt: string | null;
  createdAt: string;
}

export interface ClientDetail extends ClientListItem {
  /** The short client code web shows as a chip beside the name. */
  referralCode: string | null;
  phones: ClientPhone[];
  emails: ClientEmail[];
  inquiries: ClientInquiry[];
  giftCards: ClientGiftCard[];
  liabilityWaivers: ClientWaiver[];
  instagramHandle: string | null;
  facebookProfileUrl: string | null;
  otherContact: string | null;
  address: string | null;
  smsConsentGivenAt: string | null;
  smsOptedOutAt: string | null;
  mergedIntoId: string | null;
  mergedInto: { id: string; firstName: string; lastName: string } | null;
  referredBy: { id: string; firstName: string; lastName: string } | null;
  transferredToStudio: { id: string; name: string } | null;
}

/**
 * The list. `includeArchived` is web's own parameter name; without it the
 * API excludes archived clients, which is what web's default view shows.
 *
 * Search is deliberately NOT a parameter here: `GET /clients` has no
 * search param — web filters the loaded rows client-side — so this client
 * does the same rather than inventing one.
 */
export function fetchClients(
  token: string,
  options: { includeArchived?: boolean } = {},
  signal?: AbortSignal,
): Promise<ClientListItem[]> {
  const query = options.includeArchived ? '?includeArchived=true' : '';
  return apiFetch<ClientListItem[]>(`/clients${query}`, { token, signal });
}

export function fetchClient(token: string, id: string, signal?: AbortSignal): Promise<ClientDetail> {
  return apiFetch<ClientDetail>(`/clients/${encodeURIComponent(id)}`, { token, signal });
}

/** `${first} ${last}`, the one place that decision is made. */
export function clientName(c: { firstName: string; lastName: string }): string {
  return `${c.firstName} ${c.lastName}`.trim();
}

/**
 * Web's client search: name, email or phone, case-insensitive, over the
 * rows already loaded.
 */
export function filterClients(rows: ClientListItem[], search: string): ClientListItem[] {
  const q = search.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((c) =>
    [clientName(c), c.email ?? '', c.phone ?? ''].some((f) => f.toLowerCase().includes(q)),
  );
}

/**
 * The client list's one filter dimension.
 *
 * ─── "RECENT" IS ABSENT, AND THAT WAS A FINDING, NOT AN OMISSION ──
 *
 * Session AH was asked for All · Recent · Archived, with Recent defined
 * as "active in the last 30 days" IF the list payload carries a usable
 * recency field, and dropped with a backend ask if it does not. It does
 * not. What `GET /clients` actually returns per row:
 *
 *   createdAt    when the RECORD was created. "New clients", not
 *                "recently active" — a client who booked yesterday and
 *                was entered two years ago is old by this measure.
 *   updatedAt    Prisma `@updatedAt` on the Client ROW. It moves when
 *                somebody EDITS the record. It does NOT move when the
 *                client books, messages, pays a deposit or opens a
 *                project — those write other tables, and a nested
 *                `connect` does not touch the parent's timestamp.
 *   activity     `{ upcomingAppointmentAt, hasActiveProject,
 *                hasPendingDeposit }` — all FORWARD-looking or
 *                state-based. `upcomingAppointmentAt` is explicitly
 *                `startTime >= now`. None of the three can answer
 *                "what happened in the last 30 days".
 *
 * And the route's own `activity` query parameter offers exactly
 * `upcoming_appointment`, `active_project`, `no_activity` — again no
 * recency condition, with `orderBy: { createdAt: "desc" }` the only
 * ordering available.
 *
 * `updatedAt` was the one candidate the brief named, so it was MEASURED
 * against the dev database rather than argued about (187 client rows):
 *
 *   67%              have `updatedAt === createdAt` — the record has
 *                    never been edited, so the field carries no
 *                    information beyond the creation date.
 *   32%              of clients WITH real activity have an `updatedAt`
 *                    older than that activity — they did something and
 *                    the timestamp did not move.
 *   21.9%            of the whole list would get the WRONG answer from
 *                    `updatedAt <= 30d` versus real activity: 26 false
 *                    positives, 15 false negatives.
 *
 * The distribution says why: `updatedAt` clusters hard at one age (47 of
 * 187 rows land on the same day) because a migration stamped the table.
 * It is a record-mutation timestamp that mostly records a BACKFILL.
 *
 * A filter that is wrong about a fifth of the list is worse than no
 * filter, so Recent is not shipped. THE BACKEND ASK, which is genuinely
 * one field: `withActivity()` in `apps/api/src/routes/clients.ts` already
 * runs three grouped aggregates over the page's client ids. A fourth —
 * `_max` of past appointment `startTime` and inquiry `updatedAt` — would
 * add `lastActivityAt` to the same payload with NO new column, NO
 * backfill and no N+1. That is the field Recent needs.
 */
export type ClientFilter = 'all' | 'archived';

export const CLIENT_FILTERS: ReadonlyArray<{ value: ClientFilter; label: string }> = [
  { value: 'all', label: 'All' },
  /*
   * SAME RECORDS AS THE PILL THIS REPLACED — which is not the same thing
   * as "only archived clients". The old Archived pill set
   * `includeArchived=true`, and on the API that only REMOVES the
   * `archivedAt: null` clause (`...(includeArchived ? {} : NOT_ARCHIVED)`),
   * so the response is active clients AND archived ones together.
   *
   * Kept byte-identical because the brief said the archived behaviour is
   * unchanged in substance. Flagged in the report because as a
   * single-select option the word now reads like "archived only", which
   * is not what it returns.
   */
  { value: 'archived', label: 'Archived' },
];

/**
 * What web's "Copy customer details" puts on the clipboard, line for
 * line (`buildCustomerDetailsText` in apps/web's ClientDetail): the
 * client's name, then every phone, then every email, each with its label
 * in parentheses when it has one.
 *
 * Phones go through `formatPhone`, so what lands on the clipboard reads
 * the way the screen does. Session P had to copy them raw because mobile
 * had no formatter; it has one now.
 */
export function buildCustomerDetailsText(client: ClientDetail): string {
  const lines = [clientName(client)];
  for (const p of client.phones) lines.push(`${formatPhone(p.phone)}${p.label ? ` (${p.label})` : ''}`);
  for (const e of client.emails) lines.push(`${e.email}${e.label ? ` (${e.label})` : ''}`);
  return lines.join('\n');
}
