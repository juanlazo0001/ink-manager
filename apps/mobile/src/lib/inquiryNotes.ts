import { apiFetch } from '@/lib/api';

/**
 * Inquiry notes — read and write.
 *
 * Every request mirrors `routes/inquiries.ts`'s own note routes. The
 * body shape is identical for create and update:
 *
 *   GET    /inquiries/:id/notes
 *   POST   /inquiries/:id/notes            { bodyHtml, attachments?, visibleToArtist? }
 *   PATCH  /inquiries/:id/notes/:noteId    same shape
 *   DELETE /inquiries/:id/notes/:noteId
 *
 * ─── WHO MAY DO WHAT ────────────────────────────────────────────────
 *
 * All four gate on `inquiries.notes.manage`, evaluated with
 * `hasPermissionAt` at the INQUIRY's own studio rather than the caller's
 * home studio.
 *
 * Edit and delete additionally require `canModifyNote` — the note's own
 * author, or any OWNER. `lib/notes.ts` states the rule and its reason:
 * that is the same "OWNER can always act" precedent every other
 * author-scoped permission in this app follows, and FRONT_DESK can only
 * touch their own notes. The client mirrors it so the controls are not
 * offered where the server would refuse, but the server remains the
 * authority.
 */

export interface NoteAttachment {
  url: string;
  filename: string;
  mimeType: string;
}

export interface InquiryNote {
  id: string;
  bodyHtml: string;
  createdAt: string;
  updatedAt: string;
  visibleToArtist: boolean;
  attachments: NoteAttachment[] | null;
  author: { id: string; name: string | null; email: string } | null;
}

export interface NoteInput {
  bodyHtml: string;
  visibleToArtist: boolean;
  attachments?: NoteAttachment[];
}

export function fetchInquiryNotes(
  token: string,
  inquiryId: string,
  signal?: AbortSignal,
): Promise<InquiryNote[]> {
  return apiFetch<InquiryNote[]>(`/inquiries/${encodeURIComponent(inquiryId)}/notes`, { token, signal });
}

export function createInquiryNote(
  token: string,
  inquiryId: string,
  input: NoteInput,
): Promise<InquiryNote> {
  return apiFetch<InquiryNote>(`/inquiries/${encodeURIComponent(inquiryId)}/notes`, {
    token,
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateInquiryNote(
  token: string,
  inquiryId: string,
  noteId: string,
  input: NoteInput,
): Promise<InquiryNote> {
  return apiFetch<InquiryNote>(
    `/inquiries/${encodeURIComponent(inquiryId)}/notes/${encodeURIComponent(noteId)}`,
    { token, method: 'PATCH', body: JSON.stringify(input) },
  );
}

export function deleteInquiryNote(token: string, inquiryId: string, noteId: string): Promise<void> {
  return apiFetch<void>(
    `/inquiries/${encodeURIComponent(inquiryId)}/notes/${encodeURIComponent(noteId)}`,
    { token, method: 'DELETE' },
  );
}

/**
 * The server's own blank test, mirrored so the editor can disable its
 * save button instead of letting a doomed request fail.
 *
 * `lib/notes.ts`'s `isBlankHtml`, character for character: strip tags,
 * turn `&nbsp;` into a space, collapse whitespace, and see whether
 * anything survives. It matters because an empty editor legitimately
 * serialises to `<p></p>` — markup with no words — which the route
 * rejects with "bodyHtml is required" and which no amount of
 * `.trim()` on the raw string would catch.
 */
export function isBlankNoteHtml(html: string): boolean {
  return (
    html
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim().length === 0
  );
}

/**
 * Whether this caller may edit or delete a given note.
 *
 * Mirrors `canModifyNote`: the author, or any OWNER. Kept here rather
 * than inline at the call site so the two places that need it (the edit
 * control and the delete control) cannot disagree.
 */
export function canModifyNote(
  note: InquiryNote,
  viewer: { id: string; role: string } | null | undefined,
): boolean {
  if (!viewer) return false;
  if (viewer.role === 'OWNER') return true;
  return !!note.author && note.author.id === viewer.id;
}
