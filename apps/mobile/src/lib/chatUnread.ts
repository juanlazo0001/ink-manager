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
/*
 * ─── KNOWN BLOCKER, SESSION 07 TASK F (server-side) ─────────────────
 *
 * None of this fires for a LIVE arrival, and the cause is not here.
 *
 * `apps/api/src/lib/conversations.ts:152` counts unread with
 * `authorUserId: { not: userId }`. On a NULLABLE column that predicate
 * EXCLUDES NULL rows -- and a real inbound SMS has no author, because
 * nobody was logged in to write it. So an arriving text is never counted,
 * `unreadCount` stays 0, and the row dot, the UNREAD filter and this
 * badge all faithfully render the zero they are given.
 *
 * Measured on the dev database: with `lastReadAt` fresh, inserting one
 * INBOUND message with `authorUserId: null` left the count at 0, while
 * the same query with a NULL-safe predicate returned 1.
 *
 * The fix is one predicate in `apps/api` (and the identical one at :181,
 * which feeds `/nav-counts`). Session 07 is mobile-scoped, so it is
 * reported as a backend addendum rather than changed here. Nothing on
 * this side needs to move when it lands.
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
