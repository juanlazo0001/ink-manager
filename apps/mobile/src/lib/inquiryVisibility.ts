import type { ArtistInquiryDetail } from '@ink-manager/shared-types';

/**
 * What an artist may see and do on their own project detail.
 *
 * Unlike the appointment screen — where the API hands back everything and
 * every decision is the client's — the inquiry routes already project
 * per-role server-side. So this module is smaller and different in kind:
 * it is mostly about reading what the server ALREADY decided, not about
 * withholding things.
 *
 * Two distinctions it exists to keep straight:
 *
 *   absent  the studio's visibility toggle removed the key entirely
 *           ("your studio doesn't show you this")
 *   null    the field is there and simply has no value yet
 *
 * Rendering an absent field as "—" would quietly claim the studio had no
 * estimate, which is a different and wrong statement.
 */
export interface InquiryVisibility {
  /**
   * `pricingDetail` is on for this studio. Derived from the response
   * itself — the API deletes the keys rather than sending a flag, so
   * their presence IS the signal.
   */
  canSeePricing: boolean;
  /** `internalNotes` is on for this studio. Same derivation. */
  canSeeNotes: boolean;
  /**
   * May respond to this project at all (approve or decline). Needs
   * `inquiries.enterEstimate` AND the project sitting in ARTIST_ASSIGNED —
   * responding to anything else is not a state the API accepts.
   */
  canRespond: boolean;
  /**
   * Whether approving would really send the estimate to the client, or
   * save it for front desk. Not a right to act — a consequence of acting,
   * and worth saying out loud before someone taps.
   */
  approveSendsToClient: boolean;
}

export function inquiryVisibility(params: {
  permissions: string[];
  inquiry: ArtistInquiryDetail | null;
}): InquiryVisibility {
  const { permissions, inquiry } = params;
  const has = (key: string) => permissions.includes(key);

  return {
    // `'budget' in inquiry` rather than a truthiness check: the field is
    // legitimately null on plenty of real inquiries, and null still means
    // the studio shows pricing.
    canSeePricing: !!inquiry && 'priceEstimateLow' in inquiry,
    canSeeNotes: !!inquiry && 'notes' in inquiry,
    canRespond: !!inquiry && inquiry.status === 'ARTIST_ASSIGNED' && has('inquiries.enterEstimate'),
    approveSendsToClient: has('inquiries.artistSendEstimate'),
  };
}

/**
 * Every image on the project, in the order the detail screen shows them.
 *
 * Reference and placement photos are two separate arrays on the wire but
 * one gallery to a person, so they are flattened with their origin kept
 * for the caption.
 */
export interface InquiryImage {
  url: string;
  kind: 'reference' | 'placement';
}

export function inquiryImages(inquiry: Pick<ArtistInquiryDetail, 'referenceImages' | 'placementImages'>): InquiryImage[] {
  return [
    ...(inquiry.referenceImages ?? []).map((url): InquiryImage => ({ url, kind: 'reference' })),
    ...(inquiry.placementImages ?? []).map((url): InquiryImage => ({ url, kind: 'placement' })),
  ];
}

/** `4–6 hours`, `4 hours`, or null. */
export function formatHourRange(min: number | null | undefined, max: number | null | undefined): string | null {
  if (min == null && max == null) return null;
  if (min != null && max != null && min !== max) return `${min}–${max} hours`;
  const single = min ?? max;
  return `${single} hour${single === 1 ? '' : 's'}`;
}
