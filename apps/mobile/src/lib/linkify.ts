/**
 * Finding the links in a message body.
 *
 * ─── WHY A HAND-ROLLED SPLIT AND NOT A LIBRARY ──────────────────────
 *
 * The whole job is "split a string into text and URL runs". A linkify
 * dependency brings TLD tables and email/phone/hashtag detection this app
 * has no use for, and every one of those is a new way for a client's
 * message to render as something it is not.
 *
 * ─── WHAT COUNTS AS A LINK ──────────────────────────────────────────
 *
 * Deliberately narrow: an explicit `http://` or `https://` scheme, or a
 * bare `www.` host. That is what clients actually paste, and it will not
 * turn "see you at 5.30" or a price like "$40.00" into a link, which a
 * greedy domain matcher does.
 *
 * TRAILING PUNCTUATION IS NOT PART OF THE URL. "look at https://x.com/a."
 * ends in a full stop belonging to the sentence, and a closing bracket is
 * only part of the link when an opening one was too — the Wikipedia-URL
 * case. Getting this wrong sends people to a 404 with a stray character.
 */

export type LinkPart =
  | { kind: 'text'; value: string }
  | { kind: 'link'; value: string; href: string };

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi;

/** Punctuation that ends a sentence rather than a URL. */
const TRAILING = /[.,;:!?]+$/;

function trimTrailing(raw: string): string {
  let url = raw.replace(TRAILING, '');
  // A closing bracket belongs to the URL only if it opened inside it.
  for (const [open, close] of [
    ['(', ')'],
    ['[', ']'],
    ['{', '}'],
  ] as const) {
    while (url.endsWith(close)) {
      const opens = url.split(open).length - 1;
      const closes = url.split(close).length - 1;
      if (closes <= opens) break;
      url = url.slice(0, -1);
    }
  }
  return url.replace(TRAILING, '');
}

export function linkify(body: string): LinkPart[] {
  if (!body) return [];
  const parts: LinkPart[] = [];
  let cursor = 0;

  for (const match of body.matchAll(URL_RE)) {
    const start = match.index ?? 0;
    const url = trimTrailing(match[0]);
    if (!url) continue;

    if (start > cursor) parts.push({ kind: 'text', value: body.slice(cursor, start) });
    parts.push({
      kind: 'link',
      value: url,
      // A bare `www.` host is not a valid href on its own.
      href: /^https?:\/\//i.test(url) ? url : `https://${url}`,
    });
    cursor = start + url.length;
  }

  if (cursor < body.length) parts.push({ kind: 'text', value: body.slice(cursor) });
  return parts;
}

/** True when the body has at least one link — lets a caller skip the work. */
export function hasLink(body: string): boolean {
  URL_RE.lastIndex = 0;
  return URL_RE.test(body);
}

/**
 * Shortens a long URL from the MIDDLE, keeping both ends.
 *
 * The two ends are the parts that carry meaning — the host says where you
 * are going and the tail is often the only thing distinguishing two
 * links. An end-ellipsis keeps the host and throws away the difference;
 * this keeps both and drops the tracking-parameter middle nobody reads.
 */
export function truncateMiddle(url: string, max = 42): string {
  if (url.length <= max) return url;
  // Bias toward the front: the host matters more than the tail.
  const head = Math.ceil((max - 1) * 0.62);
  const tail = max - 1 - head;
  return `${url.slice(0, head)}…${url.slice(url.length - tail)}`;
}
