import type { InquiryStatus } from '@ink-manager/shared-types';

import { apiFetch } from './api';

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
  depositForms: { id: string; paidAt: string | null; depositAmount: number; totalCharged: number }[];
  plannedSessions: { id: string }[];
}

export interface ClientGiftCard {
  id: string;
  code: string;
  amountCents: number;
  status: string;
  expiresAt: string | null;
}

export interface ClientWaiver {
  id: string;
  status?: string | null;
  signedAt: string | null;
  createdAt: string;
}

export interface ClientDetail extends ClientListItem {
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
