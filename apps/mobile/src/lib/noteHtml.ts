/**
 * The note body's HTML subset — parsed in, serialised out.
 *
 * ─── THE CONTRACT IS WEB'S SANITISER, NOT A GUESS ───────────────────
 *
 * `InquiryNote.bodyHtml` is HTML, and the authoritative definition of
 * WHICH html is `apps/web/src/lib/sanitizeHtml.ts`:
 *
 *   ALLOWED_TAGS = ['p','br','strong','em','u','ul','ol','li','a','h2','h3']
 *   ALLOWED_ATTR = ['href','target','rel']
 *
 * Every note either client writes must land inside that set, or the
 * other client's DOMPurify pass silently deletes the parts that do not —
 * which is why this module exists rather than mobile emitting whatever
 * markup was convenient.
 *
 * ─── WHY A BLOCK MODEL RATHER THAN A STRING ─────────────────────────
 *
 * Web composes this with TipTap (ProseMirror). That is not portable to
 * React Native and would need a root dependency this session is not
 * allowed to add, so the brief's own escape applies: "implement the same
 * formatting set with a lighter native approach and state the
 * deviation". The deviation is the EDITOR; the stored format is
 * identical.
 *
 * A block model is what makes that promise checkable. Editing an HTML
 * string in place is how clients drift apart — one appends `<b>` where
 * the other expects `<strong>`, and nobody notices until a note renders
 * wrong on the other device. Parsing to blocks and re-serialising means
 * mobile can only ever emit tags this file knows how to write, and
 * `roundTrip` below is a property the tests can assert.
 *
 * ─── WHAT IS DELIBERATELY LOSSY ─────────────────────────────────────
 *
 * Nested lists. Web's TipTap can produce a `<ul>` inside an `<li>`;
 * this flattens it to sibling items at the outer level. Flattening is
 * chosen over dropping, because the words survive and the shape does
 * not — and a note is read for its words. Recorded rather than hidden,
 * and it only affects notes AUTHORED ON WEB with nesting: mobile's
 * editor cannot create one.
 */

export type Inline = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  /** Present makes this span a link. */
  href?: string;
};

export type BlockKind = 'p' | 'h2' | 'h3' | 'li-bullet' | 'li-number';

export interface Block {
  kind: BlockKind;
  spans: Inline[];
}

/* ─── entities ──────────────────────────────────────────────────────
 *
 * Only the five XML predefined entities plus &nbsp;, which is the set
 * DOMPurify leaves behind and TipTap emits. A numeric-entity decoder is
 * deliberately NOT included: nothing in this pipeline produces them, and
 * a half-correct one invites the mojibake it is meant to prevent.
 */
const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (m) => ENTITIES[m] ?? m);
}

/** Escapes for TEXT positions. Attribute values additionally escape `"`. */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

/* ─── parse ─────────────────────────────────────────────────────────── */


/**
 * Parse the allowed subset into blocks.
 *
 * Written as a small tag scanner rather than a regex-per-tag sweep,
 * because inline marks nest (`<strong><em>x</em></strong>`) and a sweep
 * cannot track that. It is not a general HTML parser and does not try to
 * be: anything outside the allowed set is skipped, and text outside any
 * block becomes a paragraph so a bare string still survives.
 */
export function parseNoteHtml(html: string): Block[] {
  if (!html) return [];

  /*
   * `script` and `style` are dropped WITH their contents, before
   * anything else runs.
   *
   * Everything else outside the allowed set loses its tag and keeps its
   * text, which is DOMPurify's behaviour and therefore web's. These two
   * are the documented exception on that side as well: their content is
   * code, not prose, so keeping it would put `alert(1)` on screen as
   * visible text.
   *
   * Nothing in this pipeline should ever deliver one — the API stores
   * web-sanitised HTML and mobile's own serialiser cannot emit them — so
   * this is defence in depth rather than a live path. It costs one regex
   * and removes the need to reason about it again.
   */
  html = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '');

  const blocks: Block[] = [];
  let listKind: 'li-bullet' | 'li-number' = 'li-bullet';

  // Walk block-level containers in order.
  const tokens = html.split(/(<\/?(?:p|h2|h3|ul|ol|li|br)\b[^>]*>)/i);
  let current: Block | null = null;

  const flush = () => {
    if (current && current.spans.some((s) => s.text.length > 0)) blocks.push(current);
    current = null;
  };

  for (const token of tokens) {
    if (!token) continue;
    /*
     * ANCHORED AT BOTH ENDS, and the anchor is the whole point.
     *
     * This was `/^<\/?([a-z0-9]+)/`, which matches any token that merely
     * BEGINS with a tag — so `<strong>b</strong>`, which the block split
     * hands over whole as one content token, was mistaken for a tag,
     * matched no block name, and was skipped. Every block whose content
     * started with a mark lost all of its text: `<p><strong>b</strong></p>`
     * parsed to nothing, while `<p>x <strong>b</strong></p>` was fine
     * because it happened to start with bare text.
     *
     * Caught by the round-trip check, not by reading — the two cases look
     * identical until one of them is empty.
     */
    const tag = /^<\/?([a-z0-9]+)\b[^>]*>$/i.exec(token);
    if (tag) {
      const name = tag[1].toLowerCase();
      const closing = token.startsWith('</');
      if (name === 'ul' && !closing) listKind = 'li-bullet';
      else if (name === 'ol' && !closing) listKind = 'li-number';
      else if (name === 'br' && current) current.spans.push({ text: '\n' });
      else if (!closing && (name === 'p' || name === 'h2' || name === 'h3')) {
        flush();
        current = { kind: name as BlockKind, spans: [] };
      } else if (!closing && name === 'li') {
        flush();
        current = { kind: listKind, spans: [] };
      } else if (closing && (name === 'p' || name === 'h2' || name === 'h3' || name === 'li')) {
        flush();
      }
      continue;
    }
    // Inline content of the current block.
    const spans = parseInline(token);
    if (spans.length === 0) continue;
    if (!current) current = { kind: 'p', spans: [] };
    current.spans.push(...spans);
  }
  flush();

  return blocks;
}

/** Inline marks within one block's content. */
function parseInline(fragment: string): Inline[] {
  const out: Inline[] = [];
  const stack: { bold?: boolean; italic?: boolean; underline?: boolean; href?: string }[] = [{}];

  const parts = fragment.split(/(<\/?(?:strong|b|em|i|u|a)\b[^>]*>)/i);
  for (const part of parts) {
    if (!part) continue;
    const tag = /^<(\/?)([a-z0-9]+)([^>]*)>$/i.exec(part);
    if (tag) {
      const closing = tag[1] === '/';
      const name = tag[2].toLowerCase();
      if (closing) {
        if (stack.length > 1) stack.pop();
        continue;
      }
      const top = stack[stack.length - 1];
      const next = { ...top };
      // `b`/`i` are accepted on the way IN and normalised to strong/em on
      // the way out -- a legacy note or a paste could carry either, and
      // dropping the mark would be worse than normalising it.
      if (name === 'strong' || name === 'b') next.bold = true;
      else if (name === 'em' || name === 'i') next.italic = true;
      else if (name === 'u') next.underline = true;
      else if (name === 'a') {
        const href = /href\s*=\s*"([^"]*)"/i.exec(tag[3]) ?? /href\s*=\s*'([^']*)'/i.exec(tag[3]);
        if (href) next.href = decodeEntities(href[1]);
      }
      stack.push(next);
      continue;
    }
    const text = decodeEntities(part);
    if (!text) continue;
    out.push({ text, ...stack[stack.length - 1] });
  }
  return out;
}

/* ─── serialise ─────────────────────────────────────────────────────── */

/**
 * Blocks back to the allowed subset.
 *
 * Consecutive list items of one kind are wrapped in a single `<ul>`/
 * `<ol>`, which is what TipTap produces and therefore what web's reader
 * expects. Marks nest in a fixed order (strong > em > u > a) so two
 * identical documents always serialise byte-identically -- without that,
 * a round trip could "change" a note that nobody edited.
 */
export function serialiseNoteHtml(blocks: Block[]): string {
  const out: string[] = [];
  let openList: 'ul' | 'ol' | null = null;

  const closeList = () => {
    if (openList) out.push(`</${openList}>`);
    openList = null;
  };

  for (const block of blocks) {
    const inner = block.spans.map(serialiseSpan).join('');
    if (block.kind === 'li-bullet' || block.kind === 'li-number') {
      const want = block.kind === 'li-bullet' ? 'ul' : 'ol';
      if (openList !== want) {
        closeList();
        out.push(`<${want}>`);
        openList = want;
      }
      out.push(`<li>${inner}</li>`);
      continue;
    }
    closeList();
    out.push(`<${block.kind}>${inner}</${block.kind}>`);
  }
  closeList();
  return out.join('');
}

function serialiseSpan(span: Inline): string {
  let html = escapeHtml(span.text).replace(/\n/g, '<br>');
  if (span.href) {
    // target/rel are in ALLOWED_ATTR and are what web emits; keeping them
    // means a round trip through mobile does not strip them.
    html = `<a href="${escapeAttr(span.href)}" target="_blank" rel="noopener noreferrer">${html}</a>`;
  }
  if (span.underline) html = `<u>${html}</u>`;
  if (span.italic) html = `<em>${html}</em>`;
  if (span.bold) html = `<strong>${html}</strong>`;
  return html;
}

/** Parse then serialise — the property the tests assert on. */
export function roundTrip(html: string): string {
  return serialiseNoteHtml(parseNoteHtml(html));
}

/** Plain text, for previews and accessibility labels. */
export function noteHtmlToText(html: string): string {
  return parseNoteHtml(html)
    .map((b) => b.spans.map((s) => s.text).join(''))
    .join('\n')
    .trim();
}
