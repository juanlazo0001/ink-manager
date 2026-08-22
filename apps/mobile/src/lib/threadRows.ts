import type { Message } from '@ink-manager/shared-types';

import { dayKey, dayLabel, sameMinute } from './time';

/** Local-only send states. The API never returns these. */
export type MessageStatus = 'sent' | 'pending' | 'failed';

export interface DisplayMessage extends Message {
  status: MessageStatus;
}

export type Row =
  | { kind: 'message'; message: DisplayMessage; showMeta: boolean; showAuthor: boolean; own: boolean }
  | { kind: 'day'; label: string; key: string };

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

    rows.push({
      kind: 'message',
      message,
      own,
      showMeta: !sameBurstAsLater,
      showAuthor: isGroupThread && !own && (earlier === undefined || earlier.authorUserId !== message.authorUserId),
    });

    if (startsNewDay) {
      rows.push({ kind: 'day', label: dayLabel(message.createdAt), key: `day:${dayKey(message.createdAt)}` });
    }
  }

  return rows;
}
