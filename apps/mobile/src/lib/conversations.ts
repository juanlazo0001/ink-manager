import type {
  ClientChannel,
  ConversationListItem,
  ConversationThreadResponse,
  IntegrationStatusResponse,
  Message,
  MessageDirection,
  SendMessageRequest,
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
export async function markConversationRead(token: string, conversationId: string): Promise<void> {
  try {
    await apiFetch<null>(`/conversations/${encodeURIComponent(conversationId)}/read`, { method: 'POST', token });
  } catch {
    // Intentionally silent.
  }
}

export interface SendOptions {
  body: string;
  /** CLIENT threads only -- required there, rejected on STAFF/GROUP. */
  channel?: ClientChannel;
  /** CLIENT threads only. */
  direction?: MessageDirection;
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
export function sendMessage(token: string, conversationId: string, options: SendOptions): Promise<Message> {
  const payload: SendMessageRequest = {
    body: options.body,
    ...(options.channel ? { channel: options.channel } : {}),
    ...(options.direction ? { direction: options.direction } : {}),
  };

  return apiFetch<Message>(`/conversations/${encodeURIComponent(conversationId)}/messages`, {
    method: 'POST',
    token,
    body: JSON.stringify(payload),
  });
}
