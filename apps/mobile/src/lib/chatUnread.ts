import type { ConversationListItem } from '@ink-manager/shared-types';
import { useSyncExternalStore } from 'react';

import { isMuted } from '@/lib/conversations';

/**
 * The unread-conversation count the CHAT fab wears — §8 rev F.
 *
 * ─── WHY THIS EXISTS RATHER THAN `/nav-counts` ──────────────────────
 *
 * CORRECTED (backend `d6f50b7`, now on main). This block used to say the
 * endpoint "cannot" exclude muted threads. **That is no longer true and
 * must not be repeated:** `getUnreadConversationCount` is MUTE-AWARE on
 * the server now, with `navCountsMute.test.ts` covering it. The original
 * observation was accurate when written — `/nav-counts` really did return
 * `conversations: 3` with one of the three muted — and it got fixed.
 *
 * So the mute argument for this module is spent. What keeps it is the
 * other one, which was always the stronger: ONE SOURCE, THREE CONSUMERS,
 * immediately below. The badge, the row dot and the UNREAD filter must
 * agree, and the only way to guarantee that is to compute all three from
 * one predicate over one payload. Two independent correct implementations
 * still drift the first time either changes.
 *
 * What DID change: the server fallback is no longer mute-blind. The tab
 * button falls back to `/nav-counts` until the list speaks, and that
 * fallback now excludes muted threads too — so the cold-start window
 * shows a number that may merely be stale, rather than one that is
 * categorically wrong.
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
 * list loads, so a cold start on another tab shows a possibly-stale
 * number rather than a confident, wrong `0`. Since `d6f50b7` that
 * fallback is mute-aware too, so the worst it can now be is out of date
 * — it is no longer counting threads the viewer muted. The app opens on
 * CHAT, so the window is one request wide in practice.
 */
/*
 * ─── SESSION 07 TASK F — RESOLVED, kept for the reasoning ───────────
 *
 * FIXED on the server and merged to main (`unreadNullAuthor.test.ts`
 * covers it). This was a live blocker when written and is not one now —
 * a future session should not go hunting for it. The diagnosis stays
 * because the FAILURE MODE is worth knowing, and because it is the
 * standing example behind CLAUDE.md's falsifiable-tests rule.
 *
 * What it was: none of this fired for a LIVE arrival, and not because of
 * anything here.
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
 * The fix was one predicate in `apps/api` (and the identical one at :181,
 * which feeds `/nav-counts`). It landed as a backend addendum and nothing
 * on this side had to move — which is exactly what the original note
 * predicted. The one piece still outstanding is an operator check that
 * the dot appears on a live arrival, once main is deployed.
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
