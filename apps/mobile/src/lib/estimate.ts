import { apiFetch } from '@/lib/api';
import type { StaffInquiryDetail } from '@/lib/staffInquiry';

/**
 * The estimate: its draft shape, its validation, and the send.
 *
 * ─── THE SHAPE IS NOT "LINE ITEMS" ──────────────────────────────────
 *
 * Worth stating because it is the natural guess and it is wrong. Web's
 * `EstimateDraft` (`components/EstimateFieldsEditor.tsx`) is:
 *
 *   isFlat               flat price, or a low–high range
 *   showDurationToClient whether the client sees the hours at all
 *   sessionCount         how many sittings
 *   hoursMin/Max         the whole job's duration range
 *   priceLow/High        the whole job's price range
 *   sessionRows[]        the same four numbers PER SITTING, each with
 *                        its own isFlat and showDurationToClient
 *
 * There are no line items anywhere in it.
 *
 * ─── THE TOTALS ARE SERVER-DERIVED WHEN THERE IS A PLAN ─────────────
 *
 * `lib/estimates.ts` computes `hasPlan = finalSessionCount > 1`, and
 * when that holds it OVERRIDES the top-level price with the sum of the
 * session rows:
 *
 *   priceEstimateLow  = sessions.reduce((sum, s) => sum + s.estimatedPriceLow, 0)
 *   priceEstimateHigh = sessions.reduce((sum, s) => sum + s.estimatedPriceHigh, 0)
 *
 * So a multi-session estimate's headline price is not something a client
 * gets to state — whatever it sends is replaced. This module therefore
 * DISPLAYS the derived total (so the number on screen is the number that
 * will be stored) but never treats its own arithmetic as authoritative.
 * With a single session the top-level fields are used as sent.
 */

export interface SessionRow {
  /** Text, because these are typed. Parsed and validated on the way out. */
  hoursMin: string;
  hoursMax: string;
  priceLow: string;
  priceHigh: string;
  isFlat: boolean;
  showDurationToClient: boolean;
}

export interface EstimateDraft {
  isFlat: boolean;
  showDurationToClient: boolean;
  hoursMin: string;
  hoursMax: string;
  priceLow: string;
  priceHigh: string;
  sessions: SessionRow[];
}

export function emptySessionRow(isFlat: boolean): SessionRow {
  return { hoursMin: '', hoursMax: '', priceLow: '', priceHigh: '', isFlat, showDurationToClient: true };
}

/**
 * Seed from whatever the inquiry already carries.
 *
 * `defaultFlat` mirrors the Service's own `pricingModel`, which web
 * describes as "a starting point staff/artist can freely override".
 */
export function draftFromInquiry(inquiry: StaffInquiryDetail, defaultFlat: boolean): EstimateDraft {
  const num = (v: number | null | undefined) => (v == null ? '' : String(v));
  return {
    isFlat: defaultFlat,
    showDurationToClient: true,
    hoursMin: num(inquiry.timeEstimateHoursMin),
    hoursMax: num(inquiry.timeEstimateHoursMax),
    priceLow: num(inquiry.priceEstimateLow),
    priceHigh: num(inquiry.priceEstimateHigh),
    sessions: [emptySessionRow(defaultFlat)],
  };
}

/* ─── validation ────────────────────────────────────────────────────
 *
 * Mirrors `lib/estimates.ts`'s own checks, rule for rule, so the form
 * can refuse before a doomed request rather than bouncing off a 400.
 * The server stays the authority; this exists so the person typing gets
 * told in place.
 *
 * A FLAT row is one price, not a range — the low field carries it and
 * the high is set equal on the way out, because the route requires both
 * and requires low <= high. Web does the same thing; `SessionHoursRow`'s
 * own comment says isFlat "only governs whether its price is a single
 * number or a range" and that min/max still describe duration either
 * way, because the calendar needs them regardless.
 */

export interface FieldError {
  /** -1 for the top-level fields, otherwise the session row's index. */
  row: number;
  field: 'hours' | 'price';
  message: string;
}

function n(value: string): number | null {
  const t = value.trim();
  if (!t) return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

export function validateRow(row: SessionRow, index: number, label: string): FieldError[] {
  const out: FieldError[] = [];
  const hMin = n(row.hoursMin);
  const hMax = n(row.hoursMax);
  const pLow = n(row.priceLow);
  const pHigh = row.isFlat ? pLow : n(row.priceHigh);

  if (hMin == null || hMax == null) {
    out.push({ row: index, field: 'hours', message: `${label} needs a numeric hour range.` });
  } else if (hMin <= 0 || hMax <= 0) {
    out.push({ row: index, field: 'hours', message: `${label}'s hour range must be positive.` });
  } else if (hMin > hMax) {
    out.push({ row: index, field: 'hours', message: `${label}'s minimum hours must be at or below its maximum.` });
  }

  if (pLow == null || pHigh == null) {
    out.push({ row: index, field: 'price', message: `${label} needs a ${row.isFlat ? 'price' : 'numeric price range'}.` });
  } else if (pLow <= 0 || pHigh <= 0) {
    out.push({ row: index, field: 'price', message: `${label}'s price must be positive.` });
  } else if (pLow > pHigh) {
    out.push({ row: index, field: 'price', message: `${label}'s minimum price must be at or below its maximum.` });
  }

  return out;
}

export function validateDraft(draft: EstimateDraft): FieldError[] {
  if (draft.sessions.length > 1) {
    return draft.sessions.flatMap((row, i) => validateRow(row, i, `Session ${i + 1}`));
  }
  // Single session: the top-level fields are what get sent, so they are
  // what gets checked.
  return validateRow(
    {
      hoursMin: draft.hoursMin,
      hoursMax: draft.hoursMax,
      priceLow: draft.priceLow,
      priceHigh: draft.priceHigh,
      isFlat: draft.isFlat,
      showDurationToClient: draft.showDurationToClient,
    },
    -1,
    'The estimate',
  );
}

/** The derived total shown on screen when there is a plan. See the header. */
export function derivedTotal(draft: EstimateDraft): { low: number; high: number } | null {
  if (draft.sessions.length <= 1) return null;
  let low = 0;
  let high = 0;
  for (const row of draft.sessions) {
    const l = n(row.priceLow);
    const h = row.isFlat ? l : n(row.priceHigh);
    if (l == null || h == null) return null;
    low += l;
    high += h;
  }
  return { low, high };
}

/* ─── the request ───────────────────────────────────────────────────── */

export type EstimateChannel = 'SMS' | 'EMAIL';

export interface SendEstimateBody {
  priceEstimateLow?: number;
  priceEstimateHigh?: number;
  timeEstimateHoursMin?: number;
  timeEstimateHoursMax?: number;
  sessions?: {
    estimatedHoursMin: number;
    estimatedHoursMax: number;
    estimatedPriceLow: number;
    estimatedPriceHigh: number;
    showDurationToClient?: boolean;
  }[];
  channel?: EstimateChannel;
}

/**
 * The exact body the route will receive. Pure, so it can be asserted
 * without sending anything.
 */
export function buildSendBody(draft: EstimateDraft, channel: EstimateChannel): SendEstimateBody {
  const num = (v: string) => Number(v.trim());

  if (draft.sessions.length > 1) {
    return {
      channel,
      sessions: draft.sessions.map((row) => ({
        estimatedHoursMin: num(row.hoursMin),
        estimatedHoursMax: num(row.hoursMax),
        estimatedPriceLow: num(row.priceLow),
        // A flat row is one price; the route requires both and requires
        // low <= high, so the single number is sent as each end.
        estimatedPriceHigh: row.isFlat ? num(row.priceLow) : num(row.priceHigh),
        showDurationToClient: row.showDurationToClient,
      })),
    };
  }

  return {
    channel,
    timeEstimateHoursMin: num(draft.hoursMin),
    timeEstimateHoursMax: num(draft.hoursMax),
    priceEstimateLow: num(draft.priceLow),
    priceEstimateHigh: draft.isFlat ? num(draft.priceLow) : num(draft.priceHigh),
  };
}

export interface SendEstimateResult extends StaffInquiryDetail {
  estimateUrl: string;
  estimateSendResult: unknown;
}

/**
 * SEND — and this DISPATCHES A REAL MESSAGE TO THE CLIENT.
 *
 * `POST /inquiries/:id/send-estimate` runs `generateAndSendEstimate`,
 * which mints an estimate token, moves the inquiry to
 * AWAITING_CLIENT_RESPONSE, shortens the client-facing URL, and then
 * calls `sendClientSms` (default) or `sendClientEmail` with
 * `logAttemptEvenOnFailure: true`. There is no dry-run path and no
 * preview mode: calling this texts or emails a person.
 *
 * That is why the caller puts a confirmation in front of it — see
 * `EstimateSheet`'s note.
 *
 * Permission: `inquiries.sendEstimate`, evaluated with `hasPermissionAt`
 * at the INQUIRY's own studio. FRONT_DESK holds it by default; ARTIST
 * does NOT (they have `inquiries.artistSendEstimate`, which is a
 * different key for their own scoped flow).
 */
export function sendEstimate(
  token: string,
  inquiryId: string,
  body: SendEstimateBody,
): Promise<SendEstimateResult> {
  return apiFetch<SendEstimateResult>(
    `/inquiries/${encodeURIComponent(inquiryId)}/send-estimate`,
    { token, method: 'POST', body: JSON.stringify(body) },
  );
}
