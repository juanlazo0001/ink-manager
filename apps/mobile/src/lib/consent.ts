import { apiFetch } from './api';

/**
 * Staff-side SMS consent — the two writes apps/web's `SmsConsentControls`
 * makes, called identically.
 *
 * These are compliance endpoints, not ordinary CRUD, and their semantics
 * are recorded here because a caller who does not know them can get the
 * paper trail wrong without any error being raised.
 */

/**
 * Web's three methods, values verbatim (`SmsConsentControls.tsx`'s
 * `STAFF_METHODS`). The API validates against exactly this set and maps
 * each onto the stored `smsConsentSource` — `staff_verbal_in_person`,
 * `staff_verbal_phone`, `staff_written_form` — so the line can always say
 * where consent actually came from.
 */
export type StaffConsentMethod = 'verbal_in_person' | 'verbal_phone' | 'written_form';

export interface ConsentPatch {
  smsConsentGivenAt: string | null;
  smsConsentSource: string | null;
  smsOptedOutAt?: string | null;
}

/**
 * `POST /clients/:id/sms-consent`.
 *
 * Two behaviours worth knowing before calling it:
 *
 * - **Already given is a 200 no-op**, deliberately: consent is only ever
 *   SET and never overwritten, so a double tap or a second staff member
 *   doing the same thing preserves the ORIGINAL timestamp rather than
 *   restamping it. A success here does not mean "this call is what
 *   granted it".
 * - **It clears any outstanding opt-in token**, so a link that was
 *   already sent out cannot later be replayed against a client who has
 *   since consented another way.
 *
 * Audited as `sms_opted_in`, which is why it is its own route rather than
 * a field on the client PATCH.
 */
export function recordSmsConsent(
  token: string,
  clientId: string,
  method: StaffConsentMethod,
): Promise<ConsentPatch> {
  return apiFetch<ConsentPatch>(`/clients/${encodeURIComponent(clientId)}/sms-consent`, {
    method: 'POST',
    token,
    body: JSON.stringify({ method }),
  });
}

/**
 * `POST /clients/:id/sms-consent/link` — mints the self-serve opt-in
 * link and returns it with its expiry.
 *
 * **Issuing REPLACES any previous token.** The route writes a fresh
 * random token onto the client, so a link handed out earlier stops
 * working the moment a new one is issued. Call it once per intent to
 * send, not speculatively.
 *
 * The link is the stronger record of the two paths — the client's own
 * action rather than the studio attesting on their behalf — which is why
 * both are offered side by side rather than one being "the" way.
 *
 * The response's URL is a live credential; it is deliberately absent from
 * the audit entry the route writes.
 */
export function issueConsentLink(
  token: string,
  clientId: string,
): Promise<{ url: string; expiresAt: string }> {
  return apiFetch<{ url: string; expiresAt: string }>(
    `/clients/${encodeURIComponent(clientId)}/sms-consent/link`,
    { method: 'POST', token },
  );
}
