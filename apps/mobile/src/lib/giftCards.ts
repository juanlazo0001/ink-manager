import { apiFetch } from './api';

/**
 * `GET /gift-cards/:id`.
 *
 * Typed from the live dev response rather than from shared-types, which
 * has no gift-card interface yet — an API gap worth closing, logged in
 * the session report rather than papered over by re-deriving the shape by
 * eye in two places.
 */
export interface GiftCard {
  id: string;
  code: string;
  amountCents: number;
  status: string;
  createdAt: string;
  expiresAt: string | null;
  paidAt: string | null;
  redeemedAt: string | null;
  paymentMethod: string | null;
  exemptionReason: string | null;
  publicUrl: string | null;
  clientId: string | null;
  client: { id: string; firstName: string; lastName: string } | null;
  appointmentId: string | null;
  appointment: { id: string; startAt: string } | null;
  issuedById: string | null;
  issuedBy: { id: string; name: string | null; email: string } | null;
  derivedFromGiftCardId: string | null;
  derivedFromGiftCard: { id: string; code: string } | null;
}

export function fetchGiftCard(token: string, id: string, signal?: AbortSignal): Promise<GiftCard> {
  return apiFetch<GiftCard>(`/gift-cards/${encodeURIComponent(id)}`, { token, signal });
}

/** Cents to `$120.00`, the way every money figure in this app reads. */
export function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
