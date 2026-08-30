import { apiFetch } from '@/lib/api';
import type { StaffInquiryDetail } from '@/lib/staffInquiry';

/**
 * The inquiry header's actions: share-to-artist, archive, delete.
 *
 * Every request mirrors `routes/inquiries.ts` exactly. Three things about
 * these routes are worth knowing before reading the UI that calls them,
 * because each one shaped it.
 *
 * ─── 1. "SHARE" IS AN INTERNAL MESSAGE, NOT A LINK ──────────────────
 *
 * The brief allowed for either. It is neither a shareable URL nor a
 * visibility flag: `POST /:id/share-to-artist` opens (or reuses) a STAFF
 * conversation with the chosen artist and posts a message into it, at
 * `MessageChannel.IN_APP`, with `metadata.kind = "shared_inquiry"` so the
 * thread can render it as a card. Nothing leaves the app — no SMS, no
 * email, no push in the route itself. The native share sheet would be the
 * wrong tool entirely.
 *
 * `GET /:id/share-to-artist/preview` returns the body the server would
 * send by default plus its attachments, so the composer can be seeded
 * with the real text and the person edits from there rather than typing
 * into a blank box.
 *
 * ─── 2. DELETE IS HARD, AND THE SERVER DEMANDS THE TYPED WORD ───────
 *
 * `DELETE /:id` is `requireRole(Role.OWNER)` and rejects anything whose
 * body is not exactly `{ confirm: "DELETE" }`. The typed confirmation in
 * the UI is therefore the ROUTE'S contract, not a flourish added on top.
 *
 * It is a real row delete inside a transaction — `tx.inquiry.delete()` —
 * and it takes the appointments, waivers, deposit forms, planned sessions
 * and conversation tags with it. Gift cards attached to those
 * appointments are DETACHED (`appointmentId -> null`), never destroyed;
 * the route's own comment gives the reason, which is that it is the
 * client's money and independent of this one project.
 *
 * ─── 3. ARCHIVE IS A TIMESTAMP AND IS IDEMPOTENT ────────────────────
 *
 * `POST /:id/archive` sets `archivedAt` and returns the updated inquiry.
 * Called on an already-archived inquiry it returns it unchanged rather
 * than erroring, so a double-tap is harmless. Both directions gate on
 * `inquiries.edit`, evaluated at the INQUIRY's own studio.
 */

export interface SharePreview {
  body: string;
  attachments: string[];
}

export interface ShareResult {
  conversationId: string;
  messageId: string;
}

/**
 * What the delete would take with it.
 *
 * NOTE what is absent: NOTES. The summary does not count them and the
 * delete transaction does not remove them, while `InquiryNote.inquiryId`
 * is ON DELETE RESTRICT in the database. See `deleteInquiry` below.
 */
export interface DeletePreview {
  appointments: number;
  waivers: number;
  depositForms: number;
  giftCardsToDetach: { id: string; code: string; amountCents: number; status: string }[];
  conversationTags: number;
  plannedSessions: number;
}

export interface DeleteResult {
  success: boolean;
  detachedGiftCards: DeletePreview['giftCardsToDetach'];
}

export function fetchSharePreview(
  token: string,
  inquiryId: string,
  signal?: AbortSignal,
): Promise<SharePreview> {
  return apiFetch<SharePreview>(
    `/inquiries/${encodeURIComponent(inquiryId)}/share-to-artist/preview`,
    { token, signal },
  );
}

export function shareToArtist(
  token: string,
  inquiryId: string,
  input: { artistUserId: string; body: string },
): Promise<ShareResult> {
  return apiFetch<ShareResult>(`/inquiries/${encodeURIComponent(inquiryId)}/share-to-artist`, {
    token,
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function archiveInquiry(token: string, inquiryId: string): Promise<StaffInquiryDetail> {
  return apiFetch<StaffInquiryDetail>(`/inquiries/${encodeURIComponent(inquiryId)}/archive`, {
    token,
    method: 'POST',
  });
}

export function unarchiveInquiry(token: string, inquiryId: string): Promise<StaffInquiryDetail> {
  return apiFetch<StaffInquiryDetail>(`/inquiries/${encodeURIComponent(inquiryId)}/unarchive`, {
    token,
    method: 'POST',
  });
}

export function fetchDeletePreview(
  token: string,
  inquiryId: string,
  signal?: AbortSignal,
): Promise<DeletePreview> {
  return apiFetch<DeletePreview>(`/inquiries/${encodeURIComponent(inquiryId)}/delete-preview`, {
    token,
    signal,
  });
}

/**
 * Mark lost / put on hold. Both take an OPTIONAL free-text reason and
 * both are `POST`, matching web exactly — an empty reason is omitted
 * rather than sent as an empty string, which is what web does and what
 * keeps the stored value null instead of "".
 */
export function markInquiryLost(
  token: string,
  inquiryId: string,
  reason: string,
): Promise<StaffInquiryDetail> {
  return apiFetch<StaffInquiryDetail>(`/inquiries/${encodeURIComponent(inquiryId)}/mark-lost`, {
    token,
    method: 'POST',
    body: JSON.stringify({ reason: reason.trim() || undefined }),
  });
}

export function holdInquiry(
  token: string,
  inquiryId: string,
  reason: string,
): Promise<StaffInquiryDetail> {
  return apiFetch<StaffInquiryDetail>(`/inquiries/${encodeURIComponent(inquiryId)}/hold`, {
    token,
    method: 'POST',
    body: JSON.stringify({ reason: reason.trim() || undefined }),
  });
}

/** The exact string the route tests for. Not a UI convention. */
export const DELETE_CONFIRM_WORD = 'DELETE';

/**
 * Permanently delete. OWNER only, and the route rejects any body whose
 * `confirm` is not exactly "DELETE".
 */
export function deleteInquiry(token: string, inquiryId: string): Promise<DeleteResult> {
  return apiFetch<DeleteResult>(`/inquiries/${encodeURIComponent(inquiryId)}`, {
    token,
    method: 'DELETE',
    body: JSON.stringify({ confirm: DELETE_CONFIRM_WORD }),
  });
}

/**
 * A plain-language list of what this delete destroys, for the confirm.
 *
 * Only non-zero counts, so the list is what is actually at stake rather
 * than a table of mostly noughts. Gift cards are stated SEPARATELY and in
 * the opposite direction — they survive — because "3 gift cards" in a
 * list of things being destroyed would read as the client losing money,
 * which is the one thing this route is careful not to do.
 */
export function describeDeletion(preview: DeletePreview): {
  destroyed: string[];
  detached: string | null;
} {
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const destroyed: string[] = [];
  if (preview.appointments) destroyed.push(plural(preview.appointments, 'appointment', 'appointments'));
  if (preview.plannedSessions) destroyed.push(plural(preview.plannedSessions, 'planned session', 'planned sessions'));
  if (preview.depositForms) destroyed.push(plural(preview.depositForms, 'deposit form', 'deposit forms'));
  if (preview.waivers) destroyed.push(plural(preview.waivers, 'signed waiver', 'signed waivers'));
  if (preview.conversationTags) destroyed.push(plural(preview.conversationTags, 'conversation tag', 'conversation tags'));

  const cards = preview.giftCardsToDetach.length;
  const detached = cards
    ? `${plural(cards, 'gift card', 'gift cards')} will be detached and kept — the client's money is not affected.`
    : null;

  return { destroyed, detached };
}
