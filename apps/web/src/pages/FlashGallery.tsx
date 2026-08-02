import { useEffect, useState } from 'react'
import { apiFetch, ApiError } from '../lib/api'
import { uploadFlashPieceImage } from '../lib/cloudinary'
import { useEffectiveUser } from '../context/useEffectiveUser'
import { useUserProfile } from '../context/useUserProfile'
import { useThemePreset } from '../lib/useThemePreset'
import ArtistSelect, { type ArtistOption } from '../components/ArtistSelect'
import Modal from '../components/Modal'
import { PlusIcon } from '../components/icons'

interface FlashPiece {
  id: string
  imageUrl: string
  title: string
  description: string | null
  priceCents: number
  estimatedDurationMinutes: number
  isOneOfOne: boolean
  status: 'AVAILABLE' | 'PENDING_APPROVAL' | 'BOOKED' | 'RETIRED'
  artist: { id: string; user: { name: string | null; email: string; avatarUrl: string | null } }
}

const STATUS_LABEL: Record<FlashPiece['status'], string> = {
  AVAILABLE: 'Available',
  PENDING_APPROVAL: 'Pending approval',
  BOOKED: 'Booked',
  RETIRED: 'Retired',
}

const STATUS_TONE: Record<FlashPiece['status'], string> = {
  AVAILABLE: 'bg-success/10 text-success',
  PENDING_APPROVAL: 'bg-warning/10 text-warning',
  BOOKED: 'bg-accent/10 text-accent',
  RETIRED: 'bg-fg-muted/10 text-fg-muted',
}

const EMPTY_FORM = {
  artistId: '',
  imageUrl: '',
  title: '',
  description: '',
  priceDollars: '',
  estimatedDurationMinutes: '',
  isOneOfOne: false,
}

export default function FlashGallery() {
  const user = useEffectiveUser()
  const { profile } = useUserProfile()
  const { shape } = useThemePreset()
  const isEditorial = shape === 'editorial'
  const canManageOthers = profile?.permissions.includes('flashGallery.manage') && user?.role !== 'ARTIST'

  const [pieces, setPieces] = useState<FlashPiece[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [artists, setArtists] = useState<ArtistOption[]>([])

  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [retiringId, setRetiringId] = useState<string | null>(null)

  function load() {
    apiFetch<FlashPiece[]>('/flash-pieces')
      .then(setPieces)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load flash pieces'))
  }

  useEffect(load, [])

  useEffect(() => {
    if (!canManageOthers) return
    apiFetch<ArtistOption[]>('/artists')
      .then(setArtists)
      .catch(() => {
        // Artist picker is only needed for staff creating on someone else's
        // behalf; leave it empty on failure rather than blocking the page.
      })
  }, [canManageOthers])

  function openCreate() {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setUploadError(null)
    setSaveError(null)
    setShowForm(true)
  }

  function openEdit(piece: FlashPiece) {
    setEditingId(piece.id)
    setForm({
      artistId: piece.artist.id,
      imageUrl: piece.imageUrl,
      title: piece.title,
      description: piece.description ?? '',
      priceDollars: (piece.priceCents / 100).toString(),
      estimatedDurationMinutes: piece.estimatedDurationMinutes.toString(),
      isOneOfOne: piece.isOneOfOne,
    })
    setUploadError(null)
    setSaveError(null)
    setShowForm(true)
  }

  async function handleFileChange(file: File | null) {
    if (!file) return
    setUploadError(null)
    setUploading(true)
    try {
      const url = await uploadFlashPieceImage(file)
      setForm((f) => ({ ...f, imageUrl: url }))
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Image upload failed')
    } finally {
      setUploading(false)
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaveError(null)

    if (!form.imageUrl || !form.title || !form.priceDollars || !form.estimatedDurationMinutes) {
      setSaveError('Please fill out all required fields.')
      return
    }
    if (!editingId && canManageOthers && !form.artistId) {
      setSaveError('Please select which artist this piece belongs to.')
      return
    }

    setSaving(true)
    try {
      const body = {
        ...(canManageOthers && !editingId ? { artistId: form.artistId } : {}),
        imageUrl: form.imageUrl,
        title: form.title,
        description: form.description || null,
        priceCents: Math.round(Number(form.priceDollars) * 100),
        estimatedDurationMinutes: Math.round(Number(form.estimatedDurationMinutes)),
        isOneOfOne: form.isOneOfOne,
      }

      if (editingId) {
        await apiFetch(`/flash-pieces/${editingId}`, { method: 'PATCH', body: JSON.stringify(body) })
      } else {
        await apiFetch('/flash-pieces', { method: 'POST', body: JSON.stringify(body) })
      }

      setShowForm(false)
      load()
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  async function handleRetire(id: string) {
    setRetiringId(id)
    try {
      await apiFetch(`/flash-pieces/${id}/retire`, { method: 'POST' })
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to retire this piece')
    } finally {
      setRetiringId(null)
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-fg">Flash Gallery</h1>
          <p className="mt-1 text-sm text-fg-secondary">
            Pre-drawn, self-bookable art. {canManageOthers ? 'Every artist’s pieces.' : 'Your own pieces.'}
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className={
            isEditorial
              ? 'editorial-btn-primary flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-bg transition hover:bg-accent-hover'
              : 'flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover'
          }
        >
          <PlusIcon className="h-4 w-4" />
          New Flash
        </button>
      </div>

      {error && <p className="mt-4 text-sm text-danger">{error}</p>}

      {pieces === null && !error && <p className="mt-6 text-sm text-fg-secondary">Loading…</p>}

      {pieces !== null && pieces.length === 0 && (
        <p className="mt-6 text-sm text-fg-secondary">No flash pieces yet -- create the first one.</p>
      )}

      {pieces !== null && pieces.length > 0 && (
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {pieces.map((piece) => (
            <div key={piece.id} className="overflow-hidden rounded-xl border border-border bg-surface">
              <div className="aspect-square w-full overflow-hidden bg-surface-inset">
                <img src={piece.imageUrl} alt={piece.title} className="h-full w-full object-cover" />
              </div>
              <div className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 truncate text-sm font-medium text-fg">{piece.title}</p>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${STATUS_TONE[piece.status]}`}>
                    {STATUS_LABEL[piece.status]}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-fg-secondary">
                  ${(piece.priceCents / 100).toFixed(2)} &middot; {piece.estimatedDurationMinutes} min
                  {piece.isOneOfOne && <> &middot; One of one</>}
                </p>
                {canManageOthers && (
                  <p className="mt-0.5 truncate text-xs text-fg-muted">{piece.artist.user.name ?? piece.artist.user.email}</p>
                )}
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => openEdit(piece)}
                    className="flex-1 rounded-full border border-border px-2 py-1 text-xs font-medium text-fg transition hover:bg-surface-inset"
                  >
                    Edit
                  </button>
                  {piece.status === 'AVAILABLE' && (
                    <button
                      type="button"
                      onClick={() => handleRetire(piece.id)}
                      disabled={retiringId === piece.id}
                      className="flex-1 rounded-full border border-border px-2 py-1 text-xs font-medium text-fg-secondary transition hover:bg-surface-inset disabled:opacity-60"
                    >
                      {retiringId === piece.id ? 'Retiring…' : 'Retire'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <Modal title={editingId ? 'Edit Flash Piece' : 'New Flash Piece'} onClose={() => setShowForm(false)}>
          <form onSubmit={handleSave} className="space-y-4">
            {canManageOthers && !editingId && (
              <div>
                <label className="mb-1 block text-sm font-medium text-fg-secondary">Artist *</label>
                <ArtistSelect
                  id="flashPieceArtist"
                  artists={artists}
                  value={form.artistId || null}
                  onChange={(artistId) => setForm({ ...form, artistId: artistId ?? '' })}
                />
              </div>
            )}

            <div>
              <label className="mb-1 block text-sm font-medium text-fg-secondary">Image *</label>
              {form.imageUrl && (
                <img src={form.imageUrl} alt="" className="mb-2 h-32 w-32 rounded-lg object-cover" />
              )}
              <input
                type="file"
                accept="image/*"
                onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
                className="block w-full text-sm text-fg-secondary file:mr-3 file:rounded-full file:border file:border-border file:bg-surface file:px-4 file:py-2 file:text-sm file:font-medium file:text-fg hover:file:bg-surface-raised"
              />
              {uploading && <p className="mt-1 text-xs text-fg-muted">Uploading…</p>}
              {uploadError && <p className="mt-1 text-xs text-danger">{uploadError}</p>}
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-fg-secondary">Title *</label>
              <input
                type="text"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-fg-secondary">Description</label>
              <textarea
                rows={2}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-fg-secondary">Price ($) *</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.priceDollars}
                  onChange={(e) => setForm({ ...form, priceDollars: e.target.value })}
                  className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-fg-secondary">Duration (min) *</label>
                <input
                  type="number"
                  min="1"
                  value={form.estimatedDurationMinutes}
                  onChange={(e) => setForm({ ...form, estimatedDurationMinutes: e.target.value })}
                  className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>
            </div>

            <label className="flex items-start gap-2 text-sm text-fg">
              <input
                type="checkbox"
                checked={form.isOneOfOne}
                onChange={(e) => setForm({ ...form, isOneOfOne: e.target.checked })}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-border bg-surface-inset accent-accent"
              />
              <span>
                One of one
                <span className="block text-xs text-fg-muted">
                  Once someone books this exact piece, it's retired forever. Leave unchecked if this design can be
                  tattooed on more than one client.
                </span>
              </span>
            </label>

            {saveError && <p className="text-sm text-danger">{saveError}</p>}

            <button
              type="submit"
              disabled={saving || uploading}
              className="w-full rounded-full bg-accent px-4 py-2 text-sm font-medium text-bg transition hover:bg-accent-hover disabled:opacity-60"
            >
              {saving ? 'Saving…' : editingId ? 'Save changes' : 'Create flash piece'}
            </button>
          </form>
        </Modal>
      )}
    </div>
  )
}
