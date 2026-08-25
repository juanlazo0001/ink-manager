/**
 * Display formatting shared across screens — mobile's counterpart to
 * apps/web's `lib/format.ts`, and the one place a phone number is turned
 * into something a person reads.
 */

/**
 * A phone number, as apps/web writes one: `(305) 299-7957`.
 *
 * WEB'S RULE, MIRRORED: strip every non-digit; treat a leading `1` on an
 * eleven-digit run as the country code rather than part of the area code
 * — the same convention `apps/api/src/lib/phone.ts`'s `normalizePhone`
 * uses server-side — then lay the remaining ten digits out as
 * `(AAA) NNN-NNNN`.
 *
 * ONE DELIBERATE DIFFERENCE, and it is a fix rather than a divergence.
 *
 * Web has no display formatter. It reuses `formatPhoneInput`, which is an
 * AS-YOU-TYPE formatter, so it force-fits whatever it is given into NANP:
 * it renders partial input as `(305) 299` and, worse, `.slice(0, 10)`s
 * anything longer. Hand it a UK number, `+44 20 7946 0958`, and it
 * returns `(442) 079-4609` — a plausible-looking number that is not the
 * client's, with no hint that anything was dropped.
 *
 * So anything that is not NANP-shaped is returned EXACTLY AS STORED.
 * Formatting is a presentation nicety; showing someone a different number
 * from the one on file is a defect, and a studio that books one
 * international client would hit it immediately.
 *
 *   "3052997957"          -> "(305) 299-7957"
 *   "+1 305 299 7957"     -> "(305) 299-7957"     (11 digits, leading 1)
 *   "(305) 299-7957"      -> "(305) 299-7957"     (already formatted)
 *   "+44 20 7946 0958"    -> "+44 20 7946 0958"   (not NANP — untouched)
 *   "12345"               -> "12345"              (too short — untouched)
 *   "305-299-7957 ext 12" -> "305-299-7957 ext 12" (extension — untouched)
 */
export function formatPhone(value: string | null | undefined): string {
  if (!value) return '';
  const raw = value.trim();

  const allDigits = raw.replace(/\D/g, '');
  const digits =
    allDigits.length === 11 && allDigits.startsWith('1') ? allDigits.slice(1) : allDigits;

  // Not ten digits once a US country code is discounted — some other
  // country's number, an extension, or an incomplete entry. Leave it be.
  if (digits.length !== 10) return raw;

  // Ten digits behind an explicit international prefix that is not +1:
  // the length is a coincidence, not a NANP number. `+33 6 12 34 56 78`
  // would otherwise come out as `(331) 234-5678`.
  if (raw.startsWith('+') && !allDigits.startsWith('1')) return raw;

  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

/**
 * A real instant, as web writes one in these tables: `Aug 14, 2026, 2:20 PM`.
 *
 * Lived as a private copy inside the client detail screen until the gift
 * card screen needed the same thing; one implementation rather than two
 * that can drift.
 */
export function stamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * A pure calendar date — gift card `expiresAt`, waiver `dateOfBirth` —
 * stored as UTC midnight and therefore READ BACK WITH UTC FORCED.
 *
 * This is CLAUDE.md's timezone rule, and the reason it exists: a bare
 * `toLocaleDateString()` re-interprets that midnight in the viewer's own
 * zone and shows the previous day to anyone west of UTC. Web's own
 * counterpart is `formatCalendarDateOnly`.
 */
export function calendarDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** A day heading for grouped feeds — web's `formatDateOnly`. */
export function dayHeading(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
