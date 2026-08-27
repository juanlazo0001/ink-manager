import type { ConversationListItem } from '@ink-manager/shared-types';
import { useSyncExternalStore } from 'react';

import { isMuted } from '@/lib/conversations';

/**
 * The unread-conversation count the CHAT fab wears — §8 rev F.
 *
 * ─── WHY THIS EXISTS RATHER THAN `/nav-counts` ──────────────────────
 *
 * The fab already had a count, from `GET /nav-counts`. Rev F requires it
 * to EXCLUDE MUTED THREADS, and that endpoint cannot: its
 * `getUnreadConversationCount` reads conversations, reads and messages,
 * and never touches `UserConversationState` at all — muted threads are in
 * its number by construction. Verified against the running dev API:
 * `/nav-counts` returned `conversations: 3` while one of those three was
 * muted.
 *
 * Teaching the endpoint about mute is the right long-term fix and it is
 * an `apps/api` change, which this session is scoped out of. So the count
 * is computed where the data already lives.
 *
 * ─── ONE SOURCE, THREE CONSUMERS ────────────────────────────────────
 *
 * §8 rev F: the badge reads "the same Q9 source as the dot and filter".
 * That source is the list's own `GET /conversations` payload — the row
 * dot is `unreadCount > 0`, the UNREAD filter is the same predicate, and
 * now so is this. `countUnreadConversations` is that predicate, written
 * once, so the three cannot drift.
 *
 * ─── WHY A MODULE STORE ─────────────────────────────────────────────
 *
 * The list screen has the data; the tab bar draws the badge; neither owns
 * the other and they are in different trees. Same shape as
 * `chatDevToggles` — the smallest thing that keeps them in sync without
 * threading a provider through the whole app.
 *
 * ─── THE NULL STATE IS DELIBERATE ───────────────────────────────────
 *
 * `null` means "the list has not spoken yet", which is different from
 * "zero unread". The tab button falls back to the server count until the
 * list loads, so a cold start on another tab shows the old (mute-blind)
 * number rather than a confident, wrong `0`. The app opens on CHAT, so
 * that window is one request wide in practice.
 */
let count: number | null = null;
const listeners = new Set<() => void>();

/**
 * §8: an unread CONVERSATION is one with anything unread — the badge
 * counts threads, not messages. Muted threads are excluded here and only
 * here: their row dots keep accruing, which is the interruption/indicator
 * rule the spec makes visible.
 */
export function countUnreadConversations(items: ConversationListItem[]): number {
  return items.filter((item) => item.unreadCount > 0 && !isMuted(item.viewerState)).length;
}

/** Called by the list whenever it has fresh items — its existing refresh path. */
export function publishChatUnread(items: ConversationListItem[]) {
  const next = countUnreadConversations(items);
  if (next === count) return;
  count = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): number | null {
  return count;
}

/** `null` until the list has loaded once — see the header. */
export function useChatUnread(): number | null {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
