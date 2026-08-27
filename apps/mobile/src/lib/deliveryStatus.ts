import type { DisplayMessage } from './threadRows';

/**
 * What the status line under a bubble is allowed to say (spec §2.4).
 *
 * `READ` is deliberately absent from this union rather than present and
 * unused: rev D.1 keeps it dormant because no live channel reports it,
 * and a value nothing can produce is an invitation to render it anyway.
 */
export type DeliveryState = 'QUEUED' | 'SENT' | 'DELIVERED' | 'FAILED';

/**
 * The provider's own status, out of `Message.metadata`.
 *
 * ─── WHAT IS ACTUALLY IN THERE ──────────────────────────────────────
 *
 * Read off `apps/api` rather than assumed, because the shape is broader
 * than the ruling described:
 *
 *   SMS   `{ providerSid?: string; deliveryStatus: string; error?: string }`
 *   EMAIL `{ deliveryStatus: string; via: "gmail" | "platform"; error?: string }`
 *
 * So `providerSid` is OPTIONAL (absent on a send that never reached the
 * provider) and email carries no `providerSid` at all. This guard reads
 * ONLY `deliveryStatus`, and only when it is a string — which is why the
 * extra and missing fields cost it nothing.
 *
 * Values seen from Twilio: `accepted` · `scheduled` · `queued` · `sending`
 * · `sent` · `delivered` · `undelivered` · `failed` · `canceled` · `read`.
 * Email writes only `sent` and `failed`.
 *
 * ─── WHAT IS DELIBERATELY NOT MAPPED ────────────────────────────────
 *
 * `read` is a real Twilio value, but only WhatsApp/RCS ever emit it and
 * this app sends neither — so it falls through to the local status rather
 * than un-dormanting READ behind the ruling's back. `canceled` falls
 * through too: there is no designed treatment for it, and inventing one
 * would be inventing UI. Everything in flight (`queued`, `sending`,
 * `accepted`…) also falls through, because the local status already says
 * the true thing.
 *
 * The staging dry-run writes `deliveryStatus: "queued"` for a message
 * deliberately never handed to a carrier; it falls through to SENT, which
 * is the pre-existing behaviour and not this session's to change.
 */
function providerStatus(message: DisplayMessage): string | null {
  const metadata = message.metadata;
  // `Record<string, unknown> | null` on the wire — anything could be in
  // it, including a JSON value that is not an object at all.
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const raw = (metadata as Record<string, unknown>).deliveryStatus;
  return typeof raw === 'string' ? raw : null;
}

/**
 * The state a message's status line should render (spec §2.4, rev D.1).
 *
 * ─── PRECEDENCE ─────────────────────────────────────────────────────
 *
 * 1. LOCAL `pending` wins outright. An optimistic row has not reached the
 *    server, so any metadata on it is stale by definition — and in
 *    practice there is none, since the optimistic row is built with
 *    `metadata: null`.
 * 2. LOCAL `failed` wins next: the request itself never completed, which
 *    the provider cannot know about.
 * 3. Otherwise the PROVIDER wins over a bare `SENT`, because "the carrier
 *    delivered it" is a stronger truth than "the API stored it".
 * 4. Fallback is the local status, i.e. `SENT`.
 *
 * Channel-agnostic by construction: an IN-APP message has no metadata, so
 * it takes the fallback and renders exactly as it did before rev D.1.
 */
export function deliveryState(message: DisplayMessage): DeliveryState {
  if (message.status === 'pending') return 'QUEUED';
  if (message.status === 'failed') return 'FAILED';

  switch (providerStatus(message)) {
    case 'delivered':
      return 'DELIVERED';
    case 'undelivered':
    case 'failed':
      return 'FAILED';
    default:
      return 'SENT';
  }
}

/**
 * True when the FAILED came from the provider rather than from a local
 * send that never completed.
 *
 * This is the difference between "we never managed to send it" and "we
 * sent it and the carrier rejected it", and it changes what the retry
 * sheet may honestly offer — see MessageActions' `failure` prop.
 */
export function isProviderFailure(message: DisplayMessage): boolean {
  if (message.status !== 'sent') return false;
  const status = providerStatus(message);
  return status === 'undelivered' || status === 'failed';
}

/** The Jura caps label for a state. */
/**
 * The failed row's own line. Reason-keyed, because "NOT DELIVERED · TAP
 * TO RETRY" is actively misleading for a consent block: retrying changes
 * nothing until the client consents, and the operator needs to know that
 * the number is fine and the paperwork is not.
 *
 * The A2P gate itself is not softened anywhere — this only changes what
 * the refusal SAYS.
 */
export function failedLineFor(message: DisplayMessage): string {
  if (message.failureCode === 'no_sms_consent') return 'NO SMS CONSENT ON FILE';
  return 'NOT DELIVERED · TAP TO RETRY';
}

export function deliveryLabel(state: DeliveryState): string {
  switch (state) {
    case 'QUEUED':
      return 'SENDING…';
    case 'DELIVERED':
      return 'DELIVERED';
    case 'FAILED':
      return 'NOT DELIVERED · TAP TO RETRY';
    default:
      return 'SENT';
  }
}
