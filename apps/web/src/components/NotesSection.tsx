import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import RichTextEditor from './RichTextEditor'
import { AttachmentIcon, CloseIcon, DocumentIcon, PencilIcon } from './icons'
import { sanitizeHtml } from '../lib/sanitizeHtml'
import { apiFetch } from '../lib/api'
import { formatDateTime } from '../lib/format'
import { useEffectiveUser } from '../context/useEffectiveUser'
import { uploadNoteAttachment, type NoteAttachment } from '../lib/cloudinary'

interface NoteAuthor {
  id: string
  name: string | null
  email: string
}

interface Note {
  id: string
  bodyHtml: string
  createdAt: string
  updatedAt: string
  // Null once the staff member who wrote it has been deleted from the
  // studio -- the note content itself survives, only the author link goes.
  author: NoteAuthor | null
  attachments: NoteAttachment[] | null
}

interface NotesSectionProps {
  // e.g. `/inquiries/${id}/notes` or `/appointments/${id}/notes` -- the
  // full REST path this note list lives at (GET/POST here, PATCH/DELETE
  // at `${notesPath}/${noteId}`). Both InquiryNote and AppointmentNote are
  // the exact same shape/rules server-side (see api/src/lib/notes.ts), so
  // one component covers both call sites; only the path differs.
  notesPath: string
  // Distinct react-query cache entry per call site -- pass the parent
  // entity's own id (inquiryId/appointmentId) so switching between two
  // different inquiries/appointments doesn't show stale notes from
  // whichever was open previously.
  queryKeyId: string
  // OWNER/FRONT_DESK page-level gate (same boolean the page's other
  // staff-only actions already use) -- an ARTIST can't load the Inquiry
  // detail page at all server-side, and the Appointment detail page's
  // notes routes are hardcoded OWNER/FRONT_DESK too, so this is a
  // defensive no-op in practice, not the real enforcement.
  canManage: boolean
  readOnly: boolean
  // True when wrapped in the page's own <Widget> (this section's
  // visibility already matches canManage exactly, which the parent
  // already knows synchronously). Skips this component's own card/title
  // so there's exactly one of each.
  bare?: boolean
}

// RichTextEditor's own empty state is "<p></p>", not "" -- same
// tag-stripping check the API route uses (isBlankHtml in lib/notes.ts) to
// decide whether the composer/edit Save button should be enabled.
function isBlank(html: string): boolean {
  return html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim().length === 0
}

// A note's createdAt/updatedAt land within a few ms of each other at
// creation time (two separate `now()` defaults resolved in the same
// insert) -- a strict !== would flag every fresh note as "edited". Real
// edits happen at least seconds (usually much longer) after creation.
const EDITED_THRESHOLD_MS = 5000

function isEdited(note: Note): boolean {
  return new Date(note.updatedAt).getTime() - new Date(note.createdAt).getTime() > EDITED_THRESHOLD_MS
}

// One already-uploaded attachment, shown either as a removable pending
// chip (composer/edit mode) or a plain link (posted note, no onRemove).
// Images get a small thumbnail; anything else gets a generic file icon --
// unlike Message.attachments (always images), a note attachment can be a
// PDF or any other file type, so there's no guarantee it's renderable as
// an <img>.
export function AttachmentChip({ attachment, onRemove }: { attachment: NoteAttachment; onRemove?: () => void }) {
  const isImage = attachment.mimeType.startsWith('image/')

  return (
    <span className="group relative inline-flex max-w-[10rem] items-center gap-1.5 rounded-lg border border-border bg-surface-inset py-1 pl-1.5 pr-2 text-xs">
      {isImage ? (
        <img src={attachment.url} alt="" className="h-5 w-5 shrink-0 rounded object-cover" />
      ) : (
        <DocumentIcon className="h-4 w-4 shrink-0 text-fg-muted" />
      )}
      <a
        href={attachment.url}
        target="_blank"
        rel="noreferrer"
        className="truncate text-fg-secondary hover:text-fg hover:underline"
        title={attachment.filename}
      >
        {attachment.filename}
      </a>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${attachment.filename}`}
          className="ml-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-surface text-fg-muted hover:text-danger"
        >
          <CloseIcon className="h-2 w-2" />
        </button>
      )}
    </span>
  )
}

// Hidden file input behind a paperclip button, shared by the composer and
// each note's own edit mode -- uploads immediately on pick (same pattern
// as ConversationsPanel.tsx's message composer) rather than waiting for
// an explicit "upload" step, appending each result to the caller's
// pending-attachments list as it resolves.
function AttachButton({
  onUploaded,
  uploading,
  setUploading,
  setError,
  disabled,
}: {
  onUploaded: (attachment: NoteAttachment) => void
  uploading: boolean
  setUploading: (value: boolean) => void
  setError: (value: string | null) => void
  disabled?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (files.length === 0) return

    setUploading(true)
    setError(null)
    try {
      for (const file of files) {
        onUploaded(await uploadNoteAttachment(file))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'File upload failed')
    } finally {
      setUploading(false)
    }
  }

  return (
    <label
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-fg-muted transition hover:bg-surface-inset hover:text-fg ${
        disabled || uploading ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
      }`}
      title="Attach a file"
    >
      <AttachmentIcon className="h-4 w-4" />
      <input
        ref={inputRef}
        type="file"
        multiple
        onChange={handleChange}
        className="hidden"
        disabled={disabled || uploading}
      />
    </label>
  )
}

// Distinct from AuditTrail.tsx's "Activity History" card (system-generated,
// terse field-diffs, one line per change) -- this is a manually-written
// commentary feed: full rich-text bodies, an author name up top, its own
// composer. Never merged into that display. Shared by InquiryDetail.tsx
// (Inquiry-level notes) and AppointmentDetail.tsx (per-session notes) --
// same UX, same backend note shape, only the REST path differs.
export default function NotesSection({ notesPath, queryKeyId, canManage, readOnly, bare = false }: NotesSectionProps) {
  const user = useEffectiveUser()
  const queryClient = useQueryClient()
  const queryKey = ['notes', notesPath, queryKeyId] as const

  const {
    data: notes,
    isLoading,
    error,
  } = useQuery({
    queryKey,
    queryFn: () => apiFetch<Note[]>(notesPath),
    enabled: canManage,
  })

  const [composerValue, setComposerValue] = useState('')
  const [composerAttachments, setComposerAttachments] = useState<NoteAttachment[]>([])
  const [attachingComposer, setAttachingComposer] = useState(false)
  const [attachComposerError, setAttachComposerError] = useState<string | null>(null)
  const [posting, setPosting] = useState(false)
  const [postError, setPostError] = useState<string | null>(null)

  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [editAttachments, setEditAttachments] = useState<NoteAttachment[]>([])
  const [attachingEdit, setAttachingEdit] = useState(false)
  const [attachEditError, setAttachEditError] = useState<string | null>(null)
  const [savingEditId, setSavingEditId] = useState<string | null>(null)
  const [editError, setEditError] = useState<string | null>(null)

  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  async function handlePost() {
    if (isBlank(composerValue)) return
    setPosting(true)
    setPostError(null)
    try {
      await apiFetch(notesPath, {
        method: 'POST',
        body: JSON.stringify({
          bodyHtml: composerValue,
          attachments: composerAttachments.length > 0 ? composerAttachments : undefined,
        }),
      })
      setComposerValue('')
      setComposerAttachments([])
      queryClient.invalidateQueries({ queryKey })
    } catch (err) {
      setPostError(err instanceof Error ? err.message : 'Failed to post note')
    } finally {
      setPosting(false)
    }
  }

  function startEdit(note: Note) {
    setEditingNoteId(note.id)
    setEditValue(note.bodyHtml)
    setEditAttachments(note.attachments ?? [])
    setAttachEditError(null)
    setEditError(null)
  }

  async function handleSaveEdit(noteId: string) {
    if (isBlank(editValue)) return
    setSavingEditId(noteId)
    setEditError(null)
    try {
      // Always sent explicitly (even []) -- the edit form owns the full,
      // current attachment list, so an empty array here means "the user
      // removed every attachment," not "leave attachments untouched."
      await apiFetch(`${notesPath}/${noteId}`, {
        method: 'PATCH',
        body: JSON.stringify({ bodyHtml: editValue, attachments: editAttachments }),
      })
      setEditingNoteId(null)
      queryClient.invalidateQueries({ queryKey })
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Failed to save note')
    } finally {
      setSavingEditId(null)
    }
  }

  async function handleDelete(noteId: string) {
    setDeletingId(noteId)
    setDeleteError(null)
    try {
      await apiFetch(`${notesPath}/${noteId}`, { method: 'DELETE' })
      setConfirmingDeleteId(null)
      queryClient.invalidateQueries({ queryKey })
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete note')
    } finally {
      setDeletingId(null)
    }
  }

  if (!canManage) return null

  const content = (
    <>
      <p className="mt-1 text-xs text-fg-muted">Internal only -- never shown to the client or shared with an artist.</p>

      <div className="mt-4">
        <RichTextEditor value={composerValue} onChange={setComposerValue} />

        {composerAttachments.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {composerAttachments.map((attachment) => (
              <AttachmentChip
                key={attachment.url}
                attachment={attachment}
                onRemove={() => setComposerAttachments((current) => current.filter((a) => a.url !== attachment.url))}
              />
            ))}
          </div>
        )}
        {attachComposerError && <p className="mt-2 text-sm text-danger">{attachComposerError}</p>}
        {postError && <p className="mt-2 text-sm text-danger">{postError}</p>}

        <div className="mt-3 flex items-center gap-2">
          <AttachButton
            onUploaded={(attachment) => setComposerAttachments((current) => [...current, attachment])}
            uploading={attachingComposer}
            setUploading={setAttachingComposer}
            setError={setAttachComposerError}
            disabled={readOnly}
          />
          <button
            type="button"
            onClick={handlePost}
            disabled={posting || readOnly || isBlank(composerValue)}
            aria-label="Add Note"
            title="Add Note"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border text-fg transition hover:bg-surface disabled:cursor-not-allowed disabled:opacity-60 md:h-auto md:w-auto md:gap-2 md:px-4 md:py-2"
          >
            <DocumentIcon className="h-4 w-4" />
            <span className="hidden text-sm font-semibold md:inline">{posting ? 'Posting…' : 'Add Note'}</span>
          </button>
        </div>
      </div>

      <div className="mt-6 border-t border-border pt-4">
        {isLoading && <p className="text-sm text-fg-secondary">Loading…</p>}
        {error && <p className="text-sm text-danger">{error instanceof Error ? error.message : 'Failed to load notes'}</p>}
        {!isLoading && !error && (notes?.length ?? 0) === 0 && <p className="text-sm text-fg-muted">No notes yet.</p>}

        <ul className="space-y-4">
          {(notes ?? []).map((note) => {
            const canModify = note.author?.id === user?.userId || user?.role === 'OWNER'
            const isEditingThis = editingNoteId === note.id
            const isConfirmingDelete = confirmingDeleteId === note.id

            return (
              <li key={note.id} className="rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="font-medium text-fg">
                    {note.author ? note.author.name || note.author.email : 'Deleted user'}
                  </span>
                  <span className="text-xs text-fg-muted">
                    {formatDateTime(note.createdAt)}
                    {isEdited(note) && <span className="ml-1 italic">(edited)</span>}
                  </span>
                </div>

                {isEditingThis ? (
                  <div className="mt-3">
                    <RichTextEditor value={editValue} onChange={setEditValue} />

                    {editAttachments.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {editAttachments.map((attachment) => (
                          <AttachmentChip
                            key={attachment.url}
                            attachment={attachment}
                            onRemove={() => setEditAttachments((current) => current.filter((a) => a.url !== attachment.url))}
                          />
                        ))}
                      </div>
                    )}
                    {attachEditError && <p className="mt-2 text-sm text-danger">{attachEditError}</p>}
                    {editError && <p className="mt-2 text-sm text-danger">{editError}</p>}

                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      <AttachButton
                        onUploaded={(attachment) => setEditAttachments((current) => [...current, attachment])}
                        uploading={attachingEdit}
                        setUploading={setAttachingEdit}
                        setError={setAttachEditError}
                        disabled={readOnly}
                      />
                      <button
                        type="button"
                        onClick={() => handleSaveEdit(note.id)}
                        disabled={savingEditId === note.id || readOnly || isBlank(editValue)}
                        className="rounded-full bg-accent px-4 py-2 text-xs font-semibold text-bg transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {savingEditId === note.id ? 'Saving…' : 'Save'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingNoteId(null)}
                        className="rounded-full border border-border px-4 py-2 text-xs font-semibold text-fg transition hover:bg-surface"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div
                      className="tiptap-content mt-2 text-sm text-fg"
                      dangerouslySetInnerHTML={{ __html: sanitizeHtml(note.bodyHtml) }}
                    />
                    {note.attachments && note.attachments.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {note.attachments.map((attachment) => (
                          <AttachmentChip key={attachment.url} attachment={attachment} />
                        ))}
                      </div>
                    )}
                    {canModify && (
                      <div className="mt-3 flex flex-wrap items-center gap-3">
                        <button
                          type="button"
                          onClick={() => startEdit(note)}
                          disabled={readOnly}
                          className="flex items-center gap-1 text-xs font-medium text-fg-secondary transition hover:text-fg disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <PencilIcon className="h-3 w-3" />
                          Edit
                        </button>

                        {isConfirmingDelete ? (
                          <>
                            <span className="text-xs text-fg-muted">Delete this note?</span>
                            <button
                              type="button"
                              onClick={() => handleDelete(note.id)}
                              disabled={deletingId === note.id}
                              className="text-xs font-medium text-danger transition hover:underline disabled:opacity-60"
                            >
                              {deletingId === note.id ? 'Deleting…' : 'Confirm delete'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmingDeleteId(null)}
                              className="text-xs font-medium text-fg-secondary hover:underline"
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmingDeleteId(note.id)}
                            disabled={readOnly}
                            className="text-xs font-medium text-fg-secondary transition hover:text-danger disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    )}
                    {deleteError && isConfirmingDelete && <p className="mt-2 text-xs text-danger">{deleteError}</p>}
                  </>
                )}
              </li>
            )
          })}
        </ul>
      </div>
    </>
  )

  if (bare) return content

  return (
    <div className="mt-6 rounded-2xl card-surface border border-border bg-surface p-5">
      <h2 className="text-base font-semibold text-fg">Notes</h2>
      {content}
    </div>
  )
}
