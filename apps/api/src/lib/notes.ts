import type { Request } from "express";
import { Role } from "../../generated/prisma/enums";

// Shared between InquiryNote (routes/inquiries.ts) and AppointmentNote
// (routes/appointments.ts) -- same rich-text-note shape and edit/delete
// rules, just scoped to a different parent entity.
export const NOTE_AUTHOR_SELECT = { select: { id: true, name: true, email: true } } as const;

// RichTextEditor's own empty state is "<p></p>", not "" -- a plain
// .trim().length check alone would accept that as valid content and save
// a visibly-blank note. Same tag-stripping approach as Settings.tsx's own
// stripHtmlPreview (client-side preview text), just used here to test for
// blankness rather than to render a preview.
export function isBlankHtml(html: string): boolean {
  return html.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim().length === 0;
}

// Edit or delete: the note's own author, or any OWNER (not just an OWNER
// who happens to be assigned to this inquiry/appointment -- same "OWNER
// can always act" precedent as every other author-scoped permission in
// this app). FRONT_DESK can only touch their own notes. authorId is
// nullable (the author's account may have since been deleted from the
// studio) -- a null-author note simply never matches the
// req.user!.userId comparison, so it naturally falls through to
// OWNER-only, same as any other note whose author isn't the caller.
export function canModifyNote(note: { authorId: string | null }, req: Request): boolean {
  return note.authorId === req.user!.userId || req.user!.role === Role.OWNER;
}
