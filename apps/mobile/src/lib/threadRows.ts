import type { Message } from '@ink-manager/shared-types';

import { separatorLabel } from './time';

/** Local-only send states. The API never returns these. */
export type MessageStatus = 'sent' | 'pending' | 'failed';

export interface DisplayMessage extends Message {
  status: MessageStatus;
  /**
   * The list key for this row, fixed for its whole life.
   *
   * A sent message's `id` CHANGES at acknowledgement — optimistic rows
   * carry a `local:` id and the server replaces it with its own. Keying
   * the list off `id` therefore unmounted and remounted the bubble the
   * instant it was acked. `rowKey` is assigned once at optimistic-insert
   * and carried through the swap, so the row React sees is the same row.
   *
   * Absent on server-loaded messages, which never re-key — the extractor
   * falls back to `id` for those.
   */
  rowKey?: string;
}

export type Row =
  | {
      kind: 'message';
      message: DisplayMessage;
      showMeta: boolean;
      showAuthor: boolean;
      own: boolean;
      /**
       * A bubble sits tight under the one above it (spec §2.1: intra-group
       * gap 2) rather than opening the inter-group gap of 10.
       */
      grouped: boolean;
      /**
       * Spec §2.1: the tail is drawn on the LAST bubble of a group only.
       * In an inverted list that is the bubble with no same-group message
       * after it in time — visually the bottom one of the run.
       */
      lastInGroup: boolean;
      /**
       * Spec §2.1 sender attribution, above a group's first bubble.
       * `SENT BY {NAME}` for an outgoing group someone else sent, the bare
       * `{NAME}` for a sender change inside an IN-APP group thread, and
       * null for your own sends — which say nothing, ever.
       */
      attribution: string | null;
    }
  | { kind: 'separator'; day: string; time: string; key: string };

/**
 * Which side a message sits on.
 *
 * On a CLIENT thread the axis is `direction` — OUTBOUND is the studio
 * talking. On a STAFF/GROUP thread every message is OUTBOUND (the API
 * forces it and rejects anything else), so the axis is authorship instead:
 * mine on the right, a colleague's on the left. Using `direction` there
 * would render an internal thread as a monologue.
 */
export function isOwnSide(message: Message, viewerUserId: string, isClientThread: boolean): boolean {
  return isClientThread ? message.direction === 'OUTBOUND' : message.authorUserId === viewerUserId;
}

/** Spec §2.1: bubbles group only within a minute of each other. */
const GROUP_GAP_MS = 60 * 1000;

/** Spec §2.2: a gap this long earns a centred separator. */
const SEPARATOR_GAP_MS = 60 * 60 * 1000;

/**
 * FAILED breaks a group (spec §2.1).
 *
 * Not cosmetic: a failed send carries a badge and a status line of its
 * own, and burying it mid-run under a shared tail would hide the one
 * message that needs attention. `pending` and `sent` share a class because
 * a queued bubble becomes a sent one in place, and the run must not
 * re-flow underneath the person the instant an ack lands.
 */
function statusClass(status: MessageStatus): 'failed' | 'ok' {
  return status === 'failed' ? 'failed' : 'ok';
}

/** Spec §2.1's four conditions, in one place so grouping and tails agree. */
function sameGroup(
  a: DisplayMessage | undefined,
  b: DisplayMessage | undefined,
  viewerUserId: string,
  isClientThread: boolean,
): boolean {
  if (!a || !b) return false;
  if (isOwnSide(a, viewerUserId, isClientThread) !== isOwnSide(b, viewerUserId, isClientThread)) return false;
  if (a.direction !== b.direction) return false;
  if (a.authorUserId !== b.authorUserId) return false;
  if (statusClass(a.status) !== statusClass(b.status)) return false;
  return Math.abs(new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()) <= GROUP_GAP_MS;
}

function displayName(message: DisplayMessage): string | null {
  return message.author?.name ?? message.author?.email ?? null;
}

/**
 * Turns an oldest-first message array into the rows an **inverted**
 * FlatList renders.
 *
 * Inverted means the array is newest-first and drawn bottom-up, which has
 * two consequences worth stating because both are easy to get backwards:
 *
 *  - A separator is emitted AFTER the message that opens a new time block,
 *    so it lands visually above it.
 *  - "Bursts" (consecutive same-side messages inside one minute, sharing a
 *    single meta row) are detected by looking at the message that comes
 *    LATER in time, since that is the one drawn below.
 *
 * Kept as a pure function, out of the screen component, so this is
 * verifiable without rendering anything.
 */
export function buildThreadRows(params: {
  /** Oldest-first, exactly as the API returns a page. */
  messages: DisplayMessage[];
  viewerUserId: string;
  isClientThread: boolean;
  isGroupThread: boolean;
}): Row[] {
  const { messages, viewerUserId, isClientThread, isGroupThread } = params;
  const rows: Row[] = [];

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    const own = isOwnSide(message, viewerUserId, isClientThread);

    const later = messages[i + 1];
    const earlier = messages[i - 1];

    /*
     * A separator sits between this message and the one before it when
     * more than an hour passed, or when nothing came before at all —
     * every thread opens with one.
     */
    const startsBlock =
      earlier === undefined ||
      new Date(message.createdAt).getTime() - new Date(earlier.createdAt).getTime() > SEPARATOR_GAP_MS;

    /*
     * A separator always breaks a run, whatever the clock says: a group
     * cannot span the line that was drawn to divide it.
     */
    const grouped = !startsBlock && sameGroup(earlier, message, viewerUserId, isClientThread);

    const laterStartsBlock =
      later !== undefined &&
      new Date(later.createdAt).getTime() - new Date(message.createdAt).getTime() > SEPARATOR_GAP_MS;
    const lastInGroup = laterStartsBlock || !sameGroup(message, later, viewerUserId, isClientThread);

    /*
     * Attribution rides the group's FIRST bubble, so it renders once per
     * run rather than once per message.
     */
    let attribution: string | null = null;
    if (!grouped) {
      const name = displayName(message);
      if (isGroupThread && !own && name) {
        // Every sender change in an IN-APP group thread, per §2.1.
        attribution = name;
      } else if (own && message.authorUserId && message.authorUserId !== viewerUserId && name) {
        // A shared inbox: this went out under the studio's name, but a
        // colleague wrote it. Your own sends stay silent.
        attribution = `SENT BY ${name}`;
      }
    }

    rows.push({
      kind: 'message',
      message,
      own,
      showMeta: !sameGroup(message, later, viewerUserId, isClientThread),
      showAuthor: isGroupThread && !own && (earlier === undefined || earlier.authorUserId !== message.authorUserId),
      grouped,
      lastInGroup,
      attribution,
    });

    if (startsBlock) {
      const label = separatorLabel(message.createdAt);
      rows.push({ kind: 'separator', day: label.day, time: label.time, key: `sep:${message.id}` });
    }
  }

  return rows;
}
