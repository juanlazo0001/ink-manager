import { apiFetch } from './api';

/**
 * The prefilled intake link — the one row in the Attach link menu that
 * MINTS something rather than reading a token that already exists.
 *
 * Everything else in that menu comes from `GET /clients/:id/shareable-links`,
 * which only selects tokens already on the record. This one creates a
 * `PrefillDraft` seeded with the client's contact details so the form
 * arrives already filled in, which is why it is a POST and why it is
 * gated more tightly than the rest of the menu.
 */

export interface IntakeFormOption {
  id: string;
  slug: string;
  name: string;
}

/**
 * `GET /intake-forms`. Web fetches this only to decide whether it must
 * ASK which form (`intakeForms.length > 1` opens its picker), and mobile
 * does the same — with one form there is nothing to choose, so no pane
 * is shown.
 */
export function fetchIntakeForms(token: string, signal?: AbortSignal): Promise<IntakeFormOption[]> {
  return apiFetch<IntakeFormOption[]>('/intake-forms', { token, signal });
}

/**
 * `POST /prefill-drafts` — `requireRole(OWNER, FRONT_DESK)`, the same
 * gate `/conversations/:id/context` carries, which is where the contact
 * details below come from. An ARTIST can reach neither, so the row is
 * not offered to them at all.
 *
 * The payload is web's, field for field
 * (`ConversationsPanel.tsx`'s `insertPrefillLink`): the four prefillable
 * contact fields, the conversation it was minted from, and the form slug
 * when the studio has more than one form to choose between.
 *
 * **This creates a live credential.** The returned URL is a token link in
 * this codebase's established public-flow pattern, so it is minted once
 * per intent to send rather than speculatively.
 */
export function createPrefillDraft(
  token: string,
  params: {
    conversationId: string;
    payload: { firstName?: string; lastName?: string; email?: string; phone?: string };
    formSlug?: string;
  },
): Promise<{ prefillUrl: string }> {
  return apiFetch<{ prefillUrl: string }>('/prefill-drafts', {
    method: 'POST',
    token,
    body: JSON.stringify({
      payload: params.payload,
      conversationId: params.conversationId,
      ...(params.formSlug ? { formSlug: params.formSlug } : {}),
    }),
  });
}

/**
 * The client page's **Send inquiry link** — web's `handleCopyPrefillLink`.
 *
 * Same endpoint as `createPrefillDraft` above, and the difference is not
 * cosmetic: passing `clientId` makes the route resolve that client's
 * conversation and AUTO-SEND the shortened link on `channel`
 * (`routes/prefillDrafts.ts:110-152`). The composer's version passes
 * `conversationId` instead and only mints, because the operator is about
 * to send it themselves.
 *
 * `prefillSendResult` is the send's own outcome and can report a refusal
 * (`no_consent`, `opted_out`, `no_phone`, `not_connected`, `send_failed`)
 * while the draft was created fine — a 200 here does not mean delivered,
 * and callers must read it rather than assume.
 */
export interface ClientSendResult {
  sent: boolean;
  reason?: string;
  error?: string;
}

export function sendPrefillInquiryLink(
  token: string,
  params: {
    clientId: string;
    channel: 'SMS' | 'EMAIL';
    payload: { firstName?: string; lastName?: string; email?: string; phone?: string };
    formSlug?: string;
  },
): Promise<{ prefillUrl: string; prefillSendResult: ClientSendResult | null }> {
  return apiFetch<{ prefillUrl: string; prefillSendResult: ClientSendResult | null }>(
    '/prefill-drafts',
    {
      method: 'POST',
      token,
      body: JSON.stringify({
        payload: params.payload,
        clientId: params.clientId,
        channel: params.channel,
        ...(params.formSlug ? { formSlug: params.formSlug } : {}),
      }),
    },
  );
}
