import type { NotificationType } from './enums';

// The notification system's HTTP surface: the bell feed both clients read,
// and device registration for Expo push.
//
// The bell is a feed over persisted rows, NOT over socket frames. That
// distinction is the whole point of the system: the WebSocket layer
// already broadcast every one of these three events, but only to whoever
// happened to be connected at that instant, and only for as long as the
// frame took to arrive. A Notification row survives being offline,
// survives a reload, and can be marked read.

/**
 * The deep link, as two plain fields rather than something to parse out of
 * `payload`. Both clients route on exactly this pair.
 *
 * **`Inquiry` does not map to one screen.** There are two inquiry detail
 * pages and the correct one depends on the VIEWER, not the record:
 * `GET /inquiries/:id` is `requireRole(OWNER, FRONT_DESK)` server-side, so
 * routing an artist there is a guaranteed 403. An ARTIST goes to the
 * `assigned-to-me` detail instead. apps/web's NotificationBell does this
 * branch; a mobile client must do the same one.
 *
 * `PersonalTask` has no detail screen at all in either client -- the
 * Tasks list IS the view of one.
 */
export type NotificationEntityType = 'Conversation' | 'Inquiry' | 'PersonalTask';

export interface NotificationActor {
  id: string;
  name: string | null;
  email: string;
  avatarUrl: string | null;
}

export interface NotificationItem {
  id: string;
  type: NotificationType;
  /**
   * Composed SERVER-side and rendered as written.
   *
   * Deliberately not assembled by each client from the payload: that is
   * how web and mobile ended up phrasing the same event differently in
   * the conversation-preview "You:" bug. One sentence, one place.
   */
  title: string;
  body: string;
  entityType: NotificationEntityType;
  entityId: string;
  /**
   * Type-specific extras, never required to RENDER the row -- title and
   * body are always sufficient on their own.
   *
   * `MESSAGE_CREATED` carries `{ conversationId, messageId }`.
   * `TASK_ASSIGNED` carries `{ dueAt }` when the task has one — an ISO
   * string for a calendar DATE written as LOCAL midnight, so read it back
   * with a matching local helper, never by forcing `timeZone: 'UTC'`.
   * See CLAUDE.md's timezone section: the two conventions are not
   * interchangeable and mixing them is the recurring bug.
   */
  payload: Record<string, unknown> | null;
  /** Null until read. Not a boolean, so "when" is available for free. */
  readAt: string | null;
  createdAt: string;
  /** Who caused it. Null for anything system-generated, e.g. an inbound client text. */
  actor: NotificationActor | null;
}

/**
 * `GET /notifications`.
 *
 * Query params: `limit` (1–100, default 30), `cursor` (an item id, from a
 * previous response's `nextCursor`), `unreadOnly=true`.
 *
 * Cursor-paginated, not offset-paginated: this list grows at the top
 * constantly, and an offset-based page 2 would skip or repeat rows
 * whenever something arrived between requests.
 *
 * No permission key gates this. A notification is addressed to ONE person
 * by construction and the emitter already decided they were entitled to
 * know -- re-gating the read would allow a row to exist that its own
 * recipient cannot see. Scoped by `userId`, never `studioId`, so a guest
 * artist's notifications from a host studio still reach them.
 */
export interface NotificationFeedResponse {
  items: NotificationItem[];
  /** Always the caller's TOTAL unread count, unaffected by `unreadOnly` or `limit`. */
  unreadCount: number;
  /** Pass as `cursor` for the next page. Null when there are no more. */
  nextCursor: string | null;
}

/**
 * `GET /notifications/unread-count`.
 *
 * Separate from the feed on purpose: the badge renders on every screen and
 * must not have to load a page of rows to draw a number.
 */
export interface NotificationUnreadCountResponse {
  unreadCount: number;
}

/**
 * `POST /notifications/mark-read` — body `{ id }` or `{ ids: [...] }`.
 * `POST /notifications/mark-all-read` — no body.
 *
 * Both are idempotent. Already-read rows are skipped rather than
 * re-stamped, so `readAt` keeps meaning "when you FIRST read it".
 */
export interface NotificationMarkReadResponse {
  updated: number;
  unreadCount: number;
}

/**
 * `POST /push-tokens` — register or refresh this device for Expo push.
 *
 * Called at login and again on every launch: Expo rotates these, so
 * re-registration is the normal case, not an error path.
 *
 * Upserts on the TOKEN, so a device handed to a different person MOVES to
 * them rather than existing twice -- otherwise the previous holder keeps
 * receiving pushes on hardware they no longer have.
 */
export interface RegisterPushTokenRequest {
  /** Must match `ExponentPushToken[...]` / `ExpoPushToken[...]`; rejected 400 otherwise. */
  token: string;
  platform: 'ios' | 'android';
  deviceName?: string | null;
}

export interface RegisterPushTokenResponse {
  id: string;
  token: string;
  platform: string;
  lastSeenAt: string;
}

/**
 * `PATCH /push-tokens/preferences` — the per-user switch.
 *
 * **Governs PUSH only.** The in-app feed is never suppressed by it: a
 * notification you can go and look at is not an interruption, and hiding a
 * record someone still holds is how people end up not knowing something
 * happened. Defaults true.
 *
 * `DELETE /push-tokens/:token` unregisters one device (logout), scoped to
 * the caller's own tokens.
 */
export interface PushPreferencesResponse {
  pushEnabled: boolean;
}
