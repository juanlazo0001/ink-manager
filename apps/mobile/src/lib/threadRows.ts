import type { Message } from '@ink-manager/shared-types';

import { dayKey, dayLabel, sameMinute } from './time';

/** Local-only send states. The API never returns these. */
export type MessageStatus = 'sent' | 'pending' | 'failed';

export interface DisplayMessage extends Message {
  status: MessageStatus;
}

export type Row =
  | {
      kind: 'message';
      message: DisplayMessage;
      showMeta: boolean;
      showAuthor: boolean;
      own: boolean;
      /**
       * This bubble continues a run from the same side, so it sits tight
       * under the one above it. False starts a new run and takes the
       * larger gap. iOS Messages' rhythm, and the thing that makes a
       * thread read as a conversation rather than a list.
       */
      grouped: boolean;
    }
  | { kind: 'day'; label: string; key: string };

/**
 * How long a pause breaks a visual run, even from the same person.
 *
 * Five minutes: long enough that two texts fired off together stay
 * together, short enough that "…and one more thing" an hour later reads
 * as a new thought. Messages uses a comparable window.
 *
 * NOTE this is a different question from `showMeta`'s "same burst", which
 * is same-MINUTE and governs the timestamp. A run can span several
 * minutes; a burst cannot.
 */
const GROUP_GAP_MS = 5 * 60 * 1000;

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

/**
 * Turns an oldest-first message array into the rows an **inverted**
 * FlatList renders.
 *
 * Inverted means the array is newest-first and drawn bottom-up, which has
 * two consequences worth stating because both are easy to get backwards:
 *
 *  - A day separator is emitted AFTER the day's oldest message, so it
 *    lands visually above it.
 *  - "Bursts" (consecutive same-side messages inside one minute, sharing a
 *    single meta row, same rule as the web app) are detected by looking at
 *    the message that comes LATER in time, since that is the one drawn
 *    below — the meta row belongs to the last message of a burst.
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
    const sameBurstAsLater =
      later !== undefined &&
      isOwnSide(later, viewerUserId, isClientThread) === own &&
      sameMinute(later.createdAt, message.createdAt);

    const earlier = messages[i - 1];
    const startsNewDay = earlier === undefined || dayKey(earlier.createdAt) !== dayKey(message.createdAt);

    /*
     * Grouped with the bubble ABOVE — which, in an inverted list, is the
     * message EARLIER in time. Same side, same author, same day, and
     * within the gap.
     *
     * The author check matters only on GROUP threads, where two
     * colleagues are both "not the viewer" and would otherwise merge into
     * one run.
     */
    const grouped =
      earlier !== undefined &&
      !startsNewDay &&
      isOwnSide(earlier, viewerUserId, isClientThread) === own &&
      earlier.authorUserId === message.authorUserId &&
      new Date(message.createdAt).getTime() - new Date(earlier.createdAt).getTime() < GROUP_GAP_MS;

    rows.push({
      kind: 'message',
      message,
      own,
      showMeta: !sameBurstAsLater,
      showAuthor: isGroupThread && !own && (earlier === undefined || earlier.authorUserId !== message.authorUserId),
      grouped,
    });

    if (startsNewDay) {
      rows.push({ kind: 'day', label: dayLabel(message.createdAt), key: `day:${dayKey(message.createdAt)}` });
    }
  }

  return rows;
}
