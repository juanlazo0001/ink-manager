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

/**
 * `PATCH /gift-cards/:id/attachment` — which appointment this card is
 * aimed at. Gated `giftCards.issue`, evaluated at the CARD's own studio.
 *
 * ─── THIS IS AN ASSOCIATION, NOT A PAYMENT ──────────────────────────
 *
 * Worth stating plainly, because the name invites the opposite reading.
 * The route sets `appointmentId` and writes a `rollover` audit row. It
 * moves no money, redeems nothing, and touches no balance — apps/web's
 * own call site says as much: "This just sets which appointment the card
 * is aimed at; no new balance/redemption math lives here."
 *
 * The money check people expect to find here — summing card values
 * against a required deposit and refusing a shortfall — is
 * `validateGiftCardsForAttachment`, and it lives on a DIFFERENT path:
 * creating an appointment (`POST /appointments`) and scheduling from an
 * inquiry. Neither is reachable from this screen.
 *
 * Two server rules the UI has to respect:
 *
 *   - only an ACTIVE or EXEMPT card can be moved (400 naming the status
 *     otherwise);
 *   - the appointment must belong to THIS card's client, in this studio
 *     (400 otherwise).
 */
export function attachGiftCardToAppointment(
  token: string,
  id: string,
  appointmentId: string | null,
): Promise<GiftCard> {
  return apiFetch<GiftCard>(`/gift-cards/${encodeURIComponent(id)}/attachment`, {
    method: 'PATCH',
    token,
    body: JSON.stringify({ appointmentId }),
  });
}
