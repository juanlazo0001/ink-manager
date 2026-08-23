/**
 * `GET /nav-counts` — the badge numbers behind the app's navigation.
 *
 * One request for all of them, deliberately: web polls this every 60s for
 * the sidebar, the top bar's task bubble and the chat FAB's unread count,
 * and splitting it would mean three polls for one screen's worth of
 * chrome.
 */
export interface NavCounts {
  inquiries: number;
  appointments: number;
  /** Always 0 for an ARTIST — the route skips the query for that role. */
  clients: number;
  /**
   * Threads with at least one message from someone ELSE since this
   * viewer's own `lastReadAt` for that thread. A count of THREADS, not of
   * messages, and it is cleared by opening a thread
   * (`POST /conversations/:id/read`) — not by any "mark section seen"
   * call, which this section explicitly rejects.
   */
  conversations: number;
  /**
   * An OWNER-controlled Settings toggle, default off, governing whether
   * the sidebar renders its bubbles at all. It rides along here because
   * ARTIST cannot call `GET /studio-settings`.
   *
   * Note web applies it to the SIDEBAR only — the top bar's task bubble
   * and the chat FAB's unread badge both ignore it.
   */
  showSidebarBadges: boolean;
}

/** `>99` becomes `99+`, exactly as web's `formatBubbleCount` does. */
export function formatBubbleCount(count: number): string {
  return count > 99 ? '99+' : String(count);
}
