import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import RichTextEditor from './RichTextEditor'
import { DocumentIcon, PencilIcon } from './icons'
import { sanitizeHtml } from '../lib/sanitizeHtml'
import { apiFetch } from '../lib/api'
import { formatDateTime } from '../lib/format'
import { useEffectiveUser } from '../context/useEffectiveUser'

interface NoteAuthor {
  id: string
  name: string | null
  email: string
}

interface InquiryNote {
  id: string
  bodyHtml: string
  createdAt: string
  updatedAt: string
  author: NoteAuthor
}

interface InquiryNotesSectionProps {
  inquiryId: string
  // OWNER/FRONT_DESK page-level gate (same boolean InquiryDetail.tsx's
  // other staff-only actions already use) -- an ARTIST can't load this
  // page at all (GET /inquiries/:id is OWNER/FRONT_DESK only server-side),
  // so this is a defensive no-op in practice, not the real enforcement.
  canManage: boolean
  readOnly: boolean
}

// RichTextEditor's own empty state is "<p></p>", not "" -- same
// tag-stripping check the API route uses (isBlankHtml in inquiries.ts) to
// decide whether the composer/edit Save button should be enabled.
function isBlank(html: string): boolean {
  return html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim().length === 0
}

// A note's createdAt/updatedAt land within a few ms of each other at
// creation time (two separate `now()` defaults resolved in the same
// insert) -- a strict !== would flag every fresh note as "edited". Real
// edits happen at least seconds (usually much longer) after creation.
const EDITED_THRESHOLD_MS = 5000

function isEdited(note: InquiryNote): boolean {
  return new Date(note.updatedAt).getTime() - new Date(note.createdAt).getTime() > EDITED_THRESHOLD_MS
}

// Distinct from AuditTrail.tsx's "Activity History" card (system-generated,
// terse field-diffs, one line per change) -- this is a manually-written
// commentary feed: full rich-text bodies, an author name up top, its own
// composer. Never merged into that display.
export default function InquiryNotesSection({ inquiryId, canManage, readOnly }: InquiryNotesSectionProps) {
  const user = useEffectiveUser()
  const queryClient = useQueryClient()
  const queryKey = ['inquiry-notes', inquiryId] as const

  const {
    data: notes,
    isLoading,
    error,
  } = useQuery({
    queryKey,
    queryFn: () => apiFetch<InquiryNote[]>(`/inquiries/${inquiryId}/notes`),
    enabled: canManage,
  })

  const [composerValue, setComposerValue] = useState('')
  const [posting, setPosting] = useState(false)
  const [postError, setPostError] = useState<string | null>(null)

  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
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
      await apiFetch(`/inquiries/${inquiryId}/notes`, {
        method: 'POST',
        body: JSON.stringify({ bodyHtml: composerValue }),
      })
      setComposerValue('')
      queryClient.invalidateQueries({ queryKey })
    } catch (err) {
      setPostError(err instanceof Error ? err.message : 'Failed to post note')
    } finally {
      setPosting(false)
    }
  }

  function startEdit(note: InquiryNote) {
    setEditingNoteId(note.id)
    setEditValue(note.bodyHtml)
    setEditError(null)
  }

  async function handleSaveEdit(noteId: string) {
    if (isBlank(editValue)) return
    setSavingEditId(noteId)
    setEditError(null)
    try {
      await apiFetch(`/inquiries/${inquiryId}/notes/${noteId}`, {
        method: 'PATCH',
        body: JSON.stringify({ bodyHtml: editValue }),
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
      await apiFetch(`/inquiries/${inquiryId}/notes/${noteId}`, { method: 'DELETE' })
      setConfirmingDeleteId(null)
      queryClient.invalidateQueries({ queryKey })
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete note')
    } finally {
      setDeletingId(null)
    }
  }

  if (!canManage) return null

  return (
    <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
      <h2 className="text-base font-semibold text-fg">Notes</h2>
      <p className="mt-1 text-xs text-fg-muted">Internal only -- never shown to the client or shared with an artist.</p>

      <div className="mt-4">
        <RichTextEditor value={composerValue} onChange={setComposerValue} />
        {postError && <p className="mt-2 text-sm text-danger">{postError}</p>}
        <button
          type="button"
          onClick={handlePost}
          disabled={posting || readOnly || isBlank(composerValue)}
          aria-label="Add Note"
          title="Add Note"
          className="mt-3 flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border text-fg transition hover:bg-surface disabled:cursor-not-allowed disabled:opacity-60 md:h-auto md:w-auto md:gap-2 md:px-4 md:py-2"
        >
          <DocumentIcon className="h-4 w-4" />
          <span className="hidden text-sm font-semibold md:inline">{posting ? 'Posting…' : 'Add Note'}</span>
        </button>
      </div>

      <div className="mt-6 border-t border-border pt-4">
        {isLoading && <p className="text-sm text-fg-secondary">Loading…</p>}
        {error && <p className="text-sm text-danger">{error instanceof Error ? error.message : 'Failed to load notes'}</p>}
        {!isLoading && !error && (notes?.length ?? 0) === 0 && <p className="text-sm text-fg-muted">No notes yet.</p>}

        <ul className="space-y-4">
          {(notes ?? []).map((note) => {
            const canModify = note.author.id === user?.userId || user?.role === 'OWNER'
            const isEditingThis = editingNoteId === note.id
            const isConfirmingDelete = confirmingDeleteId === note.id

            return (
              <li key={note.id} className="rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="font-medium text-fg">{note.author.name || note.author.email}</span>
                  <span className="text-xs text-fg-muted">
                    {formatDateTime(note.createdAt)}
                    {isEdited(note) && <span className="ml-1 italic">(edited)</span>}
                  </span>
                </div>

                {isEditingThis ? (
                  <div className="mt-3">
                    <RichTextEditor value={editValue} onChange={setEditValue} />
                    {editError && <p className="mt-2 text-sm text-danger">{editError}</p>}
                    <div className="mt-3 flex flex-wrap gap-3">
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
    </div>
  )
}
