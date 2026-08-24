import { apiFetch } from './api';

/**
 * `GET /scan/resolve/:code` — what a scanned QR or a typed code points at.
 *
 * The route param doubles as the raw input: a QR decode returns the whole
 * page URL a client's phone was showing
 * (`https://…/gift-card/abc123`), while manual entry is the bare code
 * printed under it. The server decides which it got, so BOTH are sent
 * through unchanged — verified against dev: the bare code and the full
 * URL resolve to the same `giftCardId`.
 *
 * Authenticated, despite reading like a public lookup: it 401s without a
 * bearer token. apps/web's `apiFetch` attaches one implicitly, which is
 * why web's call site looks tokenless.
 */
export interface ScanResolveResult {
  recordType: string;
  giftCardId?: string;
  /** False when the code is real but the scanner has no screen for it. */
  supported?: boolean;
}

export function resolveScanCode(
  token: string,
  rawCode: string,
  signal?: AbortSignal,
): Promise<ScanResolveResult> {
  return apiFetch<ScanResolveResult>(`/scan/resolve/${encodeURIComponent(rawCode.trim())}`, {
    token,
    signal,
  });
}

/**
 * apps/web's own labels for the record types the scanner recognises but
 * cannot open, copied verbatim so both clients decline in the same words.
 */
export const RECORD_TYPE_LABELS: Record<string, string> = {
  deposit: 'a deposit link',
  waiver: 'a waiver',
  estimate: 'an estimate',
  estimateRevision: 'an estimate revision',
  flashPayment: 'a flash prepayment link',
  selfSchedule: 'a self-schedule link',
  flashGallery: 'a flash gallery',
  intake: 'an intake form',
  policy: 'a studio policy page',
};

/** Web's message, verbatim, for a code the scanner does not handle. */
export function unsupportedMessage(recordType: string): string {
  return `That code belongs to ${RECORD_TYPE_LABELS[recordType] ?? 'a record type'} the scanner doesn't handle yet.`;
}
