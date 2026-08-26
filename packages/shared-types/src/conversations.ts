import type {
  ClientChannel,
  ConversationType,
  InquiryStatus,
  MessageChannel,
  MessageDirection,
  Role,
} from './enums';

/**
 * Who the thread is *with*, from the viewer's own point of view — the API
 * resolves this per-request rather than exposing the raw relations,
 * because the answer depends on who is asking:
 *
 * - `CLIENT` thread → the client.
 * - `STAFF` thread → the other staff member; but when the artist who owns
 *   the thread is the viewer, the *studio* is named instead (they would
 *   otherwise appear to be messaging themselves).
 * - `GROUP` thread → every participant except the viewer, comma-joined,
 *   or `"Just you"`.
 */
export interface ConversationCounterpart {
  id: string;
  name: string;
  avatarUrl: string | null;
  /**
   * Present on GROUP threads ONLY — everyone but the viewer, for a
   * stacked-avatar cluster. Absent (not empty) on CLIENT/STAFF, so
   * branching on its presence is equivalent to branching on `type`.
   */
  participants?: { id: string; name: string; avatarUrl: string | null }[];
}

/** The one inquiry a CLIENT thread features: most recent still-open, else most recent. */
export interface ConversationPrimaryInquiry {
  id: string;
  status: InquiryStatus;
  description: string | null;
  placement: string | null;
  closedReason: string | null;
}

export interface ConversationLastMessage {
  body: string;
  channel: MessageChannel;
  direction: MessageDirection;
  createdAt: string;
  /**
   * Who wrote it. Null on an inbound client message — there is no
   * logged-in author — and on rows predating authorship.
   *
   * Needed because `direction` does NOT identify the viewer: it separates
   * the studio from the client, and on STAFF/GROUP threads the API forces
   * every message to OUTBOUND, so it carries no information about who
   * spoke. Compare `authorUserId` against the viewer's own id.
   */
  authorUserId: string | null;
  author: MessageAuthor | null;
  /** Cloudinary URLs. Null when there are none. */
  attachments: string[] | null;
}

/**
 * One row of `GET /conversations`.
 *
 * The route returns a plain array — **no pagination at all**, and already
 * sorted `lastMessageAt` descending. Archived threads are excluded unless
 * `?archived=true`, which switches to showing *only* archived ones rather
 * than adding them.
 *
 * Which rows appear is entirely server-side and role-dependent; a client
 * must not re-filter. See the note on `ConversationListQuery`.
 */
export interface ConversationListItem {
  id: string;
  type: ConversationType;
  clientId: string | null;
  staffUserId: string | null;
  /** Null only for a thread with no messages yet. Sort key for the list. */
  lastMessageAt: string | null;
  archivedAt: string | null;
  counterpart: ConversationCounterpart | null;
  /** Always null for STAFF/GROUP threads. */
  primaryInquiry: ConversationPrimaryInquiry | null;
  lastMessage: ConversationLastMessage | null;
  /** This viewer's own unread count. Never anyone else's — unread-ness is per-user. */
  unreadCount: number;
  /** This viewer's own pin/mute state. See `ConversationViewerState`. */
  viewerState: ConversationViewerState;
}

/**
 * The REQUESTER's own per-thread preferences — never anyone else's. The
 * field is named `viewerState` rather than `state` for exactly that
 * reason.
 *
 * Distinct from `archivedAt`, which is deliberately **studio-wide**: one
 * shared record, not a personal mailbox. Archiving hides a thread from
 * everyone; pinning reorders it for one person. Both are correct, and they
 * answer different questions.
 *
 * **Always present, never null.** A viewer with no stored row and a viewer
 * who has explicitly unpinned are in the same state, and the API returns
 * the same object for both, so there is no "not set yet" case to handle.
 */
export interface ConversationViewerState {
  isPinned: boolean;
  /**
   * When this viewer pinned it. Refreshed on every pin, so re-pinning
   * moves a thread back to the top of the pinned group. Null when
   * unpinned.
   */
  pinnedAt: string | null;
  /**
   * A real INSTANT (not a calendar date), or null.
   *
   * Compared against `now` at read time — there is no cleanup job — so a
   * value in the past means exactly the same thing as null. Do not treat a
   * non-null `mutedUntil` as "muted" without comparing it to the current
   * time.
   *
   * While in the future, the API suppresses this viewer's MESSAGE_CREATED
   * notification for this thread entirely: no bell entry, no unread badge,
   * no push. It does NOT suppress `unreadCount` above — the thread still
   * shows it has something new, you are just not interrupted about it.
   */
  mutedUntil: string | null;
}

/**
 * `PATCH /conversations/:id/viewer-state` — the only writer for the above.
 *
 * Send either field or both; omitting one leaves it untouched. Upserts on
 * (viewer, conversation), so there is no "create state first" step.
 *
 * `mutedUntil: null` CLEARS a mute — it is a meaningful value, not an
 * omission.
 *
 * Responds `{ viewerState }`. **`409 { code: "PIN_LIMIT" }`** when pinning
 * would exceed three pinned threads; the cap is enforced server-side
 * inside the write transaction, so clients cannot drift from it. Match on
 * `code`, never on the message. A non-member or cross-studio request gets
 * `404`, never `403` — the same convention every other single-thread route
 * uses, so a non-member cannot tell "exists but not yours" from "does not
 * exist".
 */
export interface UpdateConversationViewerStateRequest {
  isPinned?: boolean;
  /** ISO instant, or null to clear. */
  mutedUntil?: string | null;
}

export interface UpdateConversationViewerStateResponse {
  viewerState: ConversationViewerState;
}

/**
 * Query parameters for `GET /conversations`. All optional, all ANDed.
 *
 * Deliberately no client-side equivalent of any of these: visibility is
 * decided by the API from the caller's role and the studio's
 * `conversations.viewClientThreads` / `conversations.viewStaffThreads`
 * permissions, and an ARTIST's staff-thread access is additionally scoped
 * to their own 1:1 thread plus groups they belong to — regardless of how
 * those permissions are set. A client that filters again on top is at best
 * duplicating that logic and at worst contradicting it.
 */
export interface ConversationListQuery {
  /** Passing `STAFF` also returns GROUP threads — groups grow out of 1:1s. */
  type?: ConversationType;
  entityType?: string;
  artistId?: string;
  /** Ignored by the API below 2 characters. */
  search?: string;
  /** `true` shows ONLY archived threads. Omit for the normal inbox. */
  archived?: boolean;
}

export interface MessageAuthor {
  id: string;
  name: string | null;
  email: string;
}

export interface MessageReaction {
  id: string;
  emoji: string;
  userId: string;
  user: { id: string; name: string | null };
}

/** One level deep only — the API does not nest reply chains. */
export interface MessageReplyTo {
  id: string;
  body: string;
  authorUserId: string | null;
  author: MessageAuthor | null;
}

export interface Message {
  id: string;
  channel: MessageChannel;
  direction: MessageDirection;
  body: string;
  /** Cloudinary URLs. Null when there are none. */
  attachments: string[] | null;
  /** Set at creation only; e.g. `{ kind: "shared_inquiry", inquiryId }`, or an email `subject`. */
  metadata: Record<string, unknown> | null;
  createdAt: string;
  /**
   * Differs from `createdAt` by a few milliseconds even on an untouched
   * row, so "was this edited" needs a threshold comparison, not equality.
   * Only STAFF/GROUP messages are editable at all.
   */
  updatedAt: string;
  studioId: string;
  conversationId: string;
  /** The staff member who wrote or logged it. Null is reserved for future auto-ingested inbound. */
  authorUserId: string | null;
  author: MessageAuthor | null;
  replyToId: string | null;
  replyTo: MessageReplyTo | null;
  reactions: MessageReaction[];
}

/** Per-user read receipts. Empty for CLIENT threads — there is no logged-in counterpart to read anything. */
export interface ConversationRead {
  userId: string;
  lastReadAt: string;
}

export interface ConversationThreadTag {
  id: string;
  entityType: string;
  entityId: string;
  [resolvedLabel: string]: unknown;
}

export interface ConversationThreadHeader {
  id: string;
  type: ConversationType;
  clientId: string | null;
  staffUserId: string | null;
  archivedAt: string | null;
  counterpart: ConversationCounterpart | null;
  primaryInquiry: ConversationPrimaryInquiry | null;
  tags: ConversationThreadTag[];
  /**
   * The caller's effective permissions at **this thread's** studio, which
   * is not necessarily their own (a guest artist's permissions at a host
   * studio can differ). `conversations.sendLive` is the one that decides
   * whether an outbound SMS/email actually leaves the building or is only
   * written to the thread.
   */
  callerPermissions: string[];
}

/**
 * `GET /conversations/:id/messages` — one page of history.
 *
 * Cursor pagination, 30 messages per page, walking **backwards** in time:
 * a page is the 30 messages immediately older than `cursor`, returned
 * oldest-first. To load more history, pass the previous response's
 * `nextCursor` and *prepend* the result. `nextCursor === null` means the
 * top of the thread has been reached.
 */
export interface ConversationThreadResponse {
  conversation: ConversationThreadHeader;
  messages: Message[];
  reads: ConversationRead[];
  nextCursor: string | null;
}

export const MESSAGES_PAGE_SIZE = 30;

/**
 * `POST /conversations/:id/messages` — body. Returns the created
 * `Message` with 201.
 *
 * `channel`/`direction` are **required on CLIENT threads and rejected on
 * STAFF/GROUP ones** (which are always IN_APP/OUTBOUND, with the author
 * distinguishing the sides). Either `body` or a non-empty `attachments`
 * must be present.
 *
 * Be deliberate about `channel` on a CLIENT thread: `SMS` and `EMAIL`
 * OUTBOUND are real sends to a real person when the studio has that
 * integration connected and the caller holds `conversations.sendLive`.
 * Everything else is a log entry.
 */
export interface SendMessageRequest {
  body: string;
  attachments?: string[];
  /** CLIENT threads only. */
  channel?: ClientChannel;
  /** CLIENT threads only. */
  direction?: MessageDirection;
  /** EMAIL channel only. */
  subject?: string;
  /** STAFF/GROUP only — mentioning someone new upgrades a 1:1 into a GROUP. */
  mentionedUserIds?: string[];
  /** Must belong to this same conversation; an unknown id is silently ignored, never an error. */
  replyToId?: string;
}

/**
 * `GET /integrations/status` — which channels have a live provider
 * connected. `PHONE` and `OTHER` are not integrations and are always
 * selectable.
 */
export interface IntegrationStatusResponse {
  sms: boolean;
  email: boolean;
  instagram: boolean;
  facebook: boolean;
}

/** Roles allowed on `/conversations/*` at all — the router rejects CUSTOMER outright. */
export const CONVERSATION_ROLES: Role[] = ['OWNER', 'FRONT_DESK', 'ARTIST'];
