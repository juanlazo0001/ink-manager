/**
 * The NANP phone mask, shared by every client-phone field.
 *
 * ─── THE CANONICAL VALUE IS DIGITS ──────────────────────────────────
 *
 * A masked field has two representations and only one of them is true.
 * The digits are the value; the mask is a rendering of it. Everything
 * here converts in one direction or the other and nothing stores the
 * formatted string — which is also what the server does
 * (`apps/api/src/lib/phone.ts` normalizes on every write path, so the
 * column holds bare digits), so the two ends agree by construction
 * rather than by discipline.
 *
 * ─── WHY BACKSPACE NEEDS ITS OWN RULE ───────────────────────────────
 *
 * A masked `TextInput` is not told what the user pressed, only what the
 * text became. Deleting the last character of `(305) ` hands back
 * `(305)` — one character shorter, but with the SAME six digits, because
 * the character removed was punctuation the mask had inserted. Re-masking
 * that gives `(305) ` straight back and the caret never moves: backspace
 * appears to be broken, stuck on the `)` forever.
 *
 * So a shorter string with unchanged digits is read as exactly what it
 * is — an attempt to delete a mask character — and the trailing DIGIT is
 * dropped instead. That is the one inference this file makes, and it is
 * made from the two facts the platform does give us.
 */

/** Ten digits is the whole NANP subscriber number; more is not a number. */
export const PHONE_DIGIT_CAP = 10;

/**
 * Reduce any human phone spelling to the digits the API stores.
 *
 * Mirrors `apps/api/src/lib/phone.ts` deliberately, including the
 * leading-1 strip: `1 (305) 299-7957` and `(305) 299-7957` are the same
 * number, and the server would store them identically. Divergence here
 * would mean a client could hold a value the server would never produce.
 */
export function phoneDigits(value: string): string {
  const digits = value.replace(/\D/g, '');
  const national = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  return national.slice(0, PHONE_DIGIT_CAP);
}

/**
 * Digits → the progressive mask, at every intermediate length.
 *
 *     ''          -> ''
 *     '3'         -> '(3'
 *     '305'       -> '(305'
 *     '3052'      -> '(305) 2'
 *     '3052997'   -> '(305) 299-7'
 *     '3052997957'-> '(305) 299-7957'
 *
 * The opening bracket arrives with the first digit rather than sitting
 * in an empty field: an empty field shows its placeholder, and a lone
 * `(` would suppress it while saying nothing.
 */
export function maskPhone(digits: string): string {
  const d = digits.slice(0, PHONE_DIGIT_CAP);
  if (d.length === 0) return '';
  if (d.length <= 3) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

/**
 * One keystroke, resolved.
 *
 * `previous` is what the field showed before; `next` is what the input
 * reports now. Returns the new canonical digits — the caller re-masks
 * them, so display and value can never drift apart.
 */
export function nextPhoneDigits(previous: string, next: string): string {
  const before = phoneDigits(previous);
  const after = phoneDigits(next);

  /*
   * Shorter text, same digits: the character that went was one the mask
   * put there. Honour the intent (delete something) rather than the
   * literal edit (delete nothing) — see the header.
   */
  if (next.length < previous.length && after === before) {
    return before.slice(0, -1);
  }

  return after;
}
