import { apiFetch } from '@/lib/api';

/**
 * The notification feed — `GET /notifications` and friends.
 *
 * ─── WHY THIS DID NOT EXIST ─────────────────────────────────────────
 *
 * The notifications screen was a hardcoded "No mentions yet" sentence,
 * and its comment explained why: web's bell was one static line, and
 * there was "no endpoint anywhere in `apps/api` that would back one".
 *
 * That was true when it was written and is not true now. `apps/api` has
 * `routes/notifications.ts` mounted at `/notifications` with four routes,
 * a `Notification` model behind them, and `apps/web`'s `NotificationBell`
 * consuming all of it. The mobile screen was describing a version of web
 * that no longer exists, so it showed nothing while real rows sat on the
 * server.
 *
 * Recorded because the stale comment is what made the emptiness look
 * intentional — it read as a finding rather than a gap.
 */

export type NotificationType = 'MESSAGE_CREATED' | 'INQUIRY_ASSIGNED' | 'TASK_ASSIGNED';

export interface NotificationItem {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  /** Two plain columns, so routing is a lookup rather than a parse. */
  entityType: string;
  entityId: string;
  payload: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
  actor: { id: string; name: string | null; email: string; avatarUrl: string | null } | null;
}

export interface NotificationFeed {
  items: NotificationItem[];
  unreadCount: number;
  /** Cursor pagination — the list grows at the top, so offsets would skip rows. */
  nextCursor: string | null;
}

export function fetchNotifications(
  token: string,
  params: { limit?: number; unreadOnly?: boolean; cursor?: string } = {},
  signal?: AbortSignal,
): Promise<NotificationFeed> {
  const query = new URLSearchParams();
  query.set('limit', String(params.limit ?? 20));
  if (params.unreadOnly) query.set('unreadOnly', 'true');
  if (params.cursor) query.set('cursor', params.cursor);
  return apiFetch<NotificationFeed>(`/notifications?${query.toString()}`, { token, signal });
}

/**
 * The badge's own query, separate from the feed on purpose — web's own
 * reasoning: a count rendered everywhere must not have to load a page of
 * rows to draw a number.
 */
export function fetchUnreadCount(token: string, signal?: AbortSignal): Promise<{ unreadCount: number }> {
  return apiFetch<{ unreadCount: number }>('/notifications/unread-count', { token, signal });
}

export function markNotificationRead(token: string, id: string): Promise<unknown> {
  return apiFetch('/notifications/mark-read', {
    token,
    method: 'POST',
    body: JSON.stringify({ id }),
  });
}

export function markAllNotificationsRead(token: string): Promise<unknown> {
  return apiFetch('/notifications/mark-all-read', { token, method: 'POST' });
}

/**
 * Where a notification opens to, mirroring web's `linkFor` — including
 * the one case where the destination depends on WHO is looking.
 *
 * An Inquiry has two detail screens and the right one is a property of
 * the viewer, not the record: the staff screen is backed by a route that
 * is OWNER/FRONT_DESK server-side, so sending an artist there is a
 * guaranteed 403. Their equivalent is the artist inquiry screen.
 *
 * `PersonalTask` has no detail screen on either client — the Tasks list
 * IS the view of one — so it routes to the list rather than to a screen
 * that does not exist. Web makes the same call, and for the reason it
 * records: returning nothing would leave the row un-tappable, which reads
 * as broken rather than as deliberate.
 */
export function notificationRoute(
  item: NotificationItem,
  role: string | undefined,
): { pathname: string; params?: Record<string, string> } {
  switch (item.entityType) {
    case 'Conversation':
      return { pathname: '/conversation/[id]', params: { id: item.entityId } };
    case 'Inquiry':
      return role === 'ARTIST'
        ? { pathname: '/inquiry/[id]', params: { id: item.entityId } }
        : { pathname: '/staff-inquiry/[id]', params: { id: item.entityId } };
    case 'PersonalTask':
      return { pathname: '/tasks' };
    default:
      return { pathname: '/' };
  }
}
