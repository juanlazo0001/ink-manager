/**
 * What a chat search box was probably holding when it matched nobody.
 *
 * §8 rev H: all-digits → phone, @-shaped → email, otherwise a name. Its
 * own module because two screens need the same answer — the empty state
 * builds the CREATE row's label and params from it, and `client-new`
 * reads the params back — and because a wrong guess here silently
 * mis-files a client record.
 *
 * Deliberately not clever. It never invents a last name, never
 * title-cases, and never reformats the number: the operator is about to
 * see the form, and a field they must correct is worse than a field they
 * must fill.
 */
export interface SearchPrefill {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

/**
 * A phone is judged on DIGITS, not on characters, so "(305) 555-0142"
 * and "305-555-0142" both land in the phone field — `client-new`'s own
 * validator counts digits the same way and wants exactly ten.
 */
export function parseSearchPrefill(query: string): SearchPrefill {
  const raw = query.trim();
  const empty = { firstName: '', lastName: '', email: '', phone: '' };
  if (!raw) return empty;

  const digits = raw.replace(/\D/g, '');
  /* "All digits" means nothing in it but digits and phone punctuation —
     a name is not made of `+()-. ` and numerals. */
  if (digits.length > 0 && /^[\d\s()+.-]+$/.test(raw)) {
    return { ...empty, phone: raw };
  }

  /* The same shape `client-new` validates against, so a prefilled email
     can never arrive already failing the form it is prefilling. */
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(raw)) {
    return { ...empty, email: raw };
  }

  /* A name. First word first, everything else last — "Mary Anne Smith"
     keeps "Anne Smith" together rather than dropping it. */
  const words = raw.split(/\s+/).filter(Boolean);
  return { ...empty, firstName: words[0] ?? '', lastName: words.slice(1).join(' ') };
}
