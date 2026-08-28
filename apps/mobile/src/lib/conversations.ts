import type {
  ClientChannel,
  ConversationListItem,
  ConversationThreadResponse,
  IntegrationStatusResponse,
  Message,
  MessageDirection,
  SendMessageRequest,
  UpdateConversationViewerStateRequest,
  UpdateConversationViewerStateResponse,
} from '@ink-manager/shared-types';

import { apiFetch } from './api';

/**
 * The conversations surface, one function per route.
 *
 * Nothing here filters or re-sorts. `GET /conversations` is already
 * ordered by `lastMessageAt` descending and already scoped to what this
 * caller is allowed to see -- an ARTIST, for instance, sees client threads
 * only if their studio grants `conversations.viewClientThreads`, and their
 * staff-thread access is always narrowed to their own 1:1 plus groups they
 * belong to no matter how that permission is set. Re-deriving any of that
 * on the client would at best duplicate it and at worst contradict it.
 */

/**
 * `search` is passed through to the API rather than applied here, because
 * it matches message CONTENT as well as names -- content this client
 * never fetches. A local filter over thread titles would look like search
 * and silently miss every thread whose match is inside the messages.
 *
 * The route ignores a term under two characters, so callers should not
 * send one (see `isSearchable`).
 */
export function fetchConversations(
  token: string,
  params: { search?: string } = {},
  signal?: AbortSignal,
): Promise<ConversationListItem[]> {
  // No pagination parameters exist on this route -- it returns the whole
  // visible, non-archived list in one response.
  const query = new URLSearchParams();
  if (params.search) query.set('search', params.search);
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return apiFetch<ConversationListItem[]>(`/conversations${suffix}`, { token, signal });
}

export function fetchThread(
  token: string,
  conversationId: string,
  cursor?: string | null,
  signal?: AbortSignal,
): Promise<ConversationThreadResponse> {
  // Cursor pagination walks BACKWARDS: a page is the 30 messages
  // immediately older than `cursor`, returned oldest-first. Passing no
  // cursor gets the newest page.
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  // Path segments are encoded for the same reason the cursor is -- an id
  // is data. Real ids are cuids and survive either way; the encoding is
  // free and removes the class.
  return apiFetch<ConversationThreadResponse>(
    `/conversations/${encodeURIComponent(conversationId)}/messages${query}`,
    { token, signal },
  );
}

export function fetchIntegrationStatus(token: string, signal?: AbortSignal): Promise<IntegrationStatusResponse> {
  return apiFetch<IntegrationStatusResponse>('/integrations/status', { token, signal });
}

/**
 * Marking a thread read is a real mutation that fires just from opening
 * it, so failures are swallowed: it is never worth an error banner, and
 * the worst case is a badge that clears on the next open.
 */
/**
 * `POST /conversations` — find-or-create, wired for the first time on mobile.
 *
 * §8 rev G's empty-search CTA needs a real creation path or it does not
 * ship (the no-inert rule). This is it, and it is NOT new API surface:
 * `apps/api/src/routes/conversations.ts:417` has always been a
 * find-or-create, taking exactly one of `clientId` or `staffUserId`. It
 * returns 200 with the existing thread when there is one, 201 when it
 * makes one, and it deliberately UN-ARCHIVES an archived thread because
 * the route treats a POST as "an intentional start this conversation
 * click" (its own words).
 *
 * Mobile had never called it — which is why every "Message" affordance in
 * this app so far has either navigated to a thread that already existed or
 * said "starting one is done in the portal".
 *
 * ROLE LIMITS, straight from the route, and the reason the CTA hides
 * rather than fails:
 *
 *   ARTIST + clientId              → 404 "Conversation not found"
 *   ARTIST + staffUserId ≠ self    → 403 "You can only open your own conversation"
 *
 * So an ARTIST has no counterpart they can start a thread with from here,
 * and the caller must not offer them a button that 403s.
 */
export function startConversation(
  token: string,
  target: { clientId: string } | { staffUserId: string },
): Promise<{ id: string }> {
  return apiFetch<{ id: string }>('/conversations', {
    method: 'POST',
    token,
    body: JSON.stringify(target),
  });
}

export async function markConversationRead(token: string, conversationId: string): Promise<void> {
  try {
    await apiFetch<null>(`/conversations/${encodeURIComponent(conversationId)}/read`, { method: 'POST', token });
  } catch {
    // Intentionally silent.
  }
}

/**
 * How long "Mute" mutes for.
 *
 * The schema stores an INSTANT, not a flag — there is no representation of
 * "muted forever", and inventing one by writing the year 9999 would be a
 * lie dressed as data. A year is past any horizon this product plans on,
 * so it behaves as indefinite in practice, and it is self-healing: a mute
 * someone set once and forgot expires rather than silencing a client
 * thread for the life of the studio. A duration picker is the natural
 * follow-up and needs no schema change when it arrives.
 */
const MUTE_MS = 365 * 24 * 60 * 60 * 1000;

/** `mutedUntil` is compared against now at read time — a past value is not a mute. */
export function isMuted(viewerState: { mutedUntil: string | null }, now = Date.now()): boolean {
  const until = viewerState.mutedUntil;
  return until !== null && new Date(until).getTime() > now;
}

/**
 * Pin/unpin and mute/unmute — the ONE writer for this viewer's own
 * per-thread preferences.
 *
 * Per-user by construction: the API keys on the caller's own token, so
 * there is no way to write anyone else's. Distinct from archive below,
 * which is deliberately studio-wide.
 *
 * `409 PIN_LIMIT` (four pins) arrives as an `ApiError` with `code` set;
 * match on the code, never the message.
 */
export function setConversationViewerState(
  token: string,
  conversationId: string,
  patch: UpdateConversationViewerStateRequest,
): Promise<UpdateConversationViewerStateResponse> {
  return apiFetch<UpdateConversationViewerStateResponse>(
    `/conversations/${encodeURIComponent(conversationId)}/viewer-state`,
    { method: 'PATCH', token, body: JSON.stringify(patch) },
  );
}

/** Mute for MUTE_MS from now, or clear an existing mute. */
export function setConversationMuted(
  token: string,
  conversationId: string,
  muted: boolean,
): Promise<UpdateConversationViewerStateResponse> {
  return setConversationViewerState(token, conversationId, {
    mutedUntil: muted ? new Date(Date.now() + MUTE_MS).toISOString() : null,
  });
}

/**
 * Archive — and this one is STUDIO-WIDE. `archivedAt` hides the thread for
 * everyone, by explicit existing design, which is why §8 forbids a
 * full-swipe from committing it: the swipe reveals the button and a tap
 * commits. Reversible, and the thread, its messages and its history are
 * untouched — it only changes what `GET /conversations` returns by
 * default.
 */
export async function archiveConversation(token: string, conversationId: string): Promise<void> {
  await apiFetch<null>(`/conversations/${encodeURIComponent(conversationId)}/archive`, {
    method: 'POST',
    token,
  });
}

export interface SendOptions {
  body: string;
  /** CLIENT threads only -- required there, rejected on STAFF/GROUP. */
  channel?: ClientChannel;
  /** CLIENT threads only. */
  direction?: MessageDirection;
  /**
   * Quote another message from this same thread. A stale or foreign id is
   * ignored by the API rather than rejected -- the message still sends,
   * just without the quote.
   */
  replyToId?: string;
  /**
   * Cloudinary URLs, already uploaded. The API takes `attachments` on
   * send (`SendMessageRequest`) and requires either a body or a non-empty
   * attachments array -- so an image with no caption is a valid send.
   */
  attachments?: string[];
}

/**
 * Posts a message and returns the created one (the API responds 201 with
 * the full `Message`, including its real id and `createdAt`, which is what
 * replaces the optimistic placeholder).
 *
 * Worth being deliberate here: on a CLIENT thread an OUTBOUND `SMS` or
 * `EMAIL` is a REAL send to a real person when the studio has that
 * integration connected and the caller holds `conversations.sendLive`.
 * Every other combination is written to the thread and goes nowhere.
 */
/**
 * The thread's client context — read for ONE thing here: which artist is
 * assigned to the featured inquiry, so the portfolio picker can default
 * to them. Web reads the same endpoint for the same purpose
 * (`ConversationsPanel.tsx:2106`).
 *
 * `requireRole(OWNER, FRONT_DESK)` (`routes/conversations.ts:1522`), so
 * an ARTIST gets a 404 here. Callers must treat that as "no default",
 * never as an error worth surfacing.
 */
export interface ConversationContextInquiry {
  id: string;
  status: string;
  description: string | null;
  assignedArtist: { id: string; user: { name: string | null; email: string; avatarUrl: string | null } } | null;
}

export interface ConversationContextResponse {
  inquiries: ConversationContextInquiry[];
}

export function fetchConversationContext(
  token: string,
  conversationId: string,
  signal?: AbortSignal,
): Promise<ConversationContextResponse> {
  return apiFetch<ConversationContextResponse>(
    `/conversations/${encodeURIComponent(conversationId)}/context`,
    { token, signal },
  );
}

/**
 * The studio's premade messages, for the composer's Insert template.
 *
 * They live on `StudioSettings.messageTemplates` — an open-ended
 * `{ id, name, body }[]` whose own API comment calls it "an open-ended
 * array the composer's 'insert template' menu lists"
 * (`routes/studioSettings.ts:272`), validated at `:321`. Web reads it the
 * same way, off the same route (`ConversationsPanel.tsx:1881`).
 *
 * `GET /studio-settings` is `requireRole(OWNER, FRONT_DESK, ARTIST)`
 * (`routes/studioSettings.ts:144`) — every role that can open a thread
 * can also list templates, so this needs no gating of its own.
 */
export interface MessageTemplate {
  id: string;
  name: string;
  body: string;
}

export function fetchMessageTemplates(
  token: string,
  signal?: AbortSignal,
): Promise<MessageTemplate[]> {
  return apiFetch<{ messageTemplates: MessageTemplate[] | null }>('/studio-settings', {
    token,
    signal,
  }).then((res) => res.messageTemplates ?? []);
}

export function sendMessage(token: string, conversationId: string, options: SendOptions): Promise<Message> {
  const payload: SendMessageRequest = {
    body: options.body,
    ...(options.channel ? { channel: options.channel } : {}),
    ...(options.direction ? { direction: options.direction } : {}),
    ...(options.attachments && options.attachments.length > 0
      ? { attachments: options.attachments }
      : {}),
    ...(options.replyToId ? { replyToId: options.replyToId } : {}),
  };

  return apiFetch<Message>(`/conversations/${encodeURIComponent(conversationId)}/messages`, {
    method: 'POST',
    token,
    body: JSON.stringify(payload),
  });
}

/**
 * The reaction set, which is defined and validated by the API
 * (`REACTION_EMOJIS` in apps/api/src/routes/conversations.ts) — anything
 * outside it is a 400. apps/web keeps its own copy with the same note;
 * this mirrors that list rather than inventing a different one.
 */
export const REACTION_EMOJIS = ['❤️', '👍', '👎', '😂', '‼️', '❓'] as const;

export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];

/**
 * Sets this viewer's reaction.
 *
 * Upsert, not append: one reaction per (message, user), so choosing a
 * different emoji REPLACES the previous one rather than stacking. The API
 * enforces that, and the UI must not imply otherwise.
 *
 * Allowed on every thread type including CLIENT, because a reaction is
 * additive metadata rather than a rewrite of what was actually sent. It is
 * never delivered over SMS/Email — purely an internal annotation.
 */
export function setReaction(
  token: string,
  conversationId: string,
  messageId: string,
  emoji: ReactionEmoji,
): Promise<Message> {
  return apiFetch<Message>(
    `/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/reaction`,
    { method: 'PUT', token, body: JSON.stringify({ emoji }) },
  );
}

/** Clears this viewer's reaction — tapping the same emoji again toggles off. */
export function clearReaction(token: string, conversationId: string, messageId: string): Promise<Message> {
  return apiFetch<Message>(
    `/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/reaction`,
    { method: 'DELETE', token },
  );
}

/**
 * Edits a message in place.
 *
 * STAFF/GROUP only and author-only; the API rejects both otherwise. A
 * CLIENT thread is an immutable record of what actually went over
 * SMS/Email, and a colleague's message is not yours to rewrite even as an
 * OWNER (deliberately NOT an OWNER override, unlike InquiryNote's edit).
 */
export function editMessage(
  token: string,
  conversationId: string,
  messageId: string,
  body: string,
): Promise<Message> {
  return apiFetch<Message>(
    `/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}`,
    { method: 'PATCH', token, body: JSON.stringify({ body }) },
  );
}

/**
 * Was this message edited after it was sent?
 *
 * `updatedAt` and `createdAt` differ by a few milliseconds even on an
 * untouched row, so this is a threshold comparison rather than equality —
 * the same idiom the API's own doc comment prescribes and that
 * `isMessageEdited` uses on web.
 */
export function isMessageEdited(message: { createdAt: string; updatedAt: string }): boolean {
  return new Date(message.updatedAt).getTime() - new Date(message.createdAt).getTime() > 1000;
}
