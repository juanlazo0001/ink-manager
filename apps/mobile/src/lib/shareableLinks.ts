import { apiFetch } from './api';

/**
 * `GET /clients/:id/shareable-links` — the links apps/web's composer can
 * drop into a message.
 *
 * Only the fields web's own insert menu reads are typed here; the route
 * returns more (policy URLs, deposit form options, gift card links) that
 * the menu does not list.
 */
export interface ShareableLink {
  label: string;
  /**
   * NULLABLE, and that nullability is the whole story of one crash.
   * apps/web renders these rows with `disabled={!link.url}`, which is
   * proof the API returns entries whose url is not there yet. Typing
   * this `string` and trusting it is what let a null reach the draft.
   */
  url: string | null;
  /** A short right-aligned qualifier web shows beside some links. */
  hint?: string | null;
}

export interface ShareableLinks {
  intakeFormUrl: string | null;
  estimateLinks: ShareableLink[];
  depositLinks: ShareableLink[];
  waiverLinks: ShareableLink[];
  flashGalleryLinks: ShareableLink[];
}

export function fetchShareableLinks(
  token: string,
  clientId: string,
  signal?: AbortSignal,
): Promise<ShareableLinks> {
  return apiFetch<ShareableLinks>(`/clients/${encodeURIComponent(clientId)}/shareable-links`, {
    token,
    signal,
  });
}

/**
 * The insert menu's contents, in apps/web's own order:
 * intake form, estimates, deposits, waivers, then flash galleries
 * (whose hint web explicitly nulls).
 *
 * Web's first item, "Prefilled intake link", is deliberately NOT here:
 * it mints a PrefillDraft token, which is a write, and the composer
 * renders it disabled instead.
 *
 * Rows with NO url are kept rather than filtered, because web keeps them
 * — it just disables them. Hiding them would silently shorten a menu the
 * two clients are supposed to agree on.
 */
export function insertableLinks(links: ShareableLinks | null): ShareableLink[] {
  if (!links) return [];
  return [
    ...(links.intakeFormUrl ? [{ label: 'Intake form', url: links.intakeFormUrl, hint: null }] : []),
    ...(links.estimateLinks ?? []),
    ...(links.depositLinks ?? []),
    ...(links.waiverLinks ?? []),
    ...(links.flashGalleryLinks ?? []).map((l) => ({ ...l, hint: null })),
  ];
}

/**
 * Web's insertion rule, verbatim: append on a new line when there is
 * already a draft, otherwise the URL becomes the draft.
 */
export function appendLink(body: string, url: string): string {
  return body ? `${body}\n${url}` : url;
}
