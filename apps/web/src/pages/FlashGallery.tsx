import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { apiFetch, ApiError } from '../lib/api'
import { uploadFlashPieceImage } from '../lib/cloudinary'
import { useEffectiveUser } from '../context/useEffectiveUser'
import { useUserProfile } from '../context/useUserProfile'
import { useThemePreset } from '../lib/useThemePreset'
import Eyebrow from '../components/Eyebrow'
import ArtistSelect, { type ArtistOption } from '../components/ArtistSelect'
import { artistLabel } from '../components/ArtistAvatar'
import MultiSelectFilter from '../components/MultiSelectFilter'
import Modal from '../components/Modal'
import ImageLightbox from '../components/ImageLightbox'
import { PlusIcon, SparkleIcon, CopyIcon, ViewIcon } from '../components/icons'
import { formatDurationHours } from '../lib/format'

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

const STATUS_FILTER_OPTIONS = (Object.keys(STATUS_LABEL) as FlashPiece['status'][]).map((status) => ({
  value: status,
  label: STATUS_LABEL[status],
}))

const EMPTY_FORM = {
  artistId: '',
  imageUrl: '',
  title: '',
  description: '',
  priceDollars: '',
  estimatedDurationHours: '',
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
  const [studioSlug, setStudioSlug] = useState<string | null>(null)

  const [statusFilter, setStatusFilter] = useState<string[]>([])
  const [artistFilter, setArtistFilter] = useState<string[]>([])
  const [copiedLink, setCopiedLink] = useState(false)
  const [lightbox, setLightbox] = useState<{ images: string[]; index: number } | null>(null)

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

  // Only needed to build the shareable public gallery link below -- the
  // studio object itself (useStudio()) doesn't carry the slug, so this is
  // its own small fetch rather than widening that shared context for one
  // page's need.
  useEffect(() => {
    if (!user) return
    apiFetch<{ slug: string }>(`/studios/${user.studioId}`)
      .then((studio) => setStudioSlug(studio.slug))
      .catch(() => {
        // Non-critical -- the copy-link affordance just stays hidden.
      })
  }, [user])

  const filteredPieces = useMemo(() => {
    if (!pieces) return null
    return pieces.filter(
      (piece) =>
        (statusFilter.length === 0 || statusFilter.includes(piece.status)) &&
        (!canManageOthers || artistFilter.length === 0 || artistFilter.includes(piece.artist.id)),
    )
  }, [pieces, statusFilter, artistFilter, canManageOthers])

  // Whose public gallery link to offer copying, right now: an ARTIST always
  // has exactly one (their own); a solo OWNER+Artist is equally unambiguous
  // (profile.artist is populated for them too -- see GET /me's own
  // role-agnostic `artist: user.artist ?? undefined`) even though their
  // role isn't literally ARTIST, so the link shouldn't hinge on selecting a
  // filter that no longer exists for them (see canShowArtistFilter below).
  // Any other staff only has an unambiguous one to offer once they've
  // filtered down to a single artist -- the link is inherently per-artist
  // (see FlashPublicGallery.tsx's own /flash/:studioSlug/:artistId route),
  // so "every artist's pieces" has no single link to give.
  const linkArtistId =
    user?.role === 'ARTIST' || profile?.isSoloStudio
      ? (profile?.artist?.id ?? null)
      : artistFilter.length === 1
        ? artistFilter[0]
        : null
  const publicGalleryUrl = studioSlug && linkArtistId ? `${window.location.origin}/flash/${studioSlug}/${linkArtistId}` : null

  async function handleCopyLink() {
    if (!publicGalleryUrl) return
    try {
      await navigator.clipboard.writeText(publicGalleryUrl)
      setCopiedLink(true)
      setTimeout(() => setCopiedLink(false), 2000)
    } catch {
      // Non-critical -- the URL can still be shared by other means.
    }
  }

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
      estimatedDurationHours: (Math.round((piece.estimatedDurationMinutes / 60) * 100) / 100).toString(),
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

    if (!form.imageUrl || !form.title || !form.priceDollars || !form.estimatedDurationHours) {
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
        estimatedDurationMinutes: Math.round(Number(form.estimatedDurationHours) * 60),
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
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          {isEditorial && <Eyebrow>The Showcase</Eyebrow>}
          <h1
            className={
              isEditorial
                ? 'mt-1 font-display text-[clamp(28px,3.4vw,38px)] font-normal tracking-[-0.015em] text-fg'
                : 'text-2xl font-bold text-fg sm:text-3xl'
            }
          >
            Flash Gallery
          </h1>
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

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <MultiSelectFilter
          placeholder="All statuses"
          options={STATUS_FILTER_OPTIONS}
          selected={statusFilter}
          onChange={setStatusFilter}
        />

        {/* Meaningless with exactly one artist in the studio -- filtering
            never narrows anything, and it's what was making the public
            gallery link (below) unreachable by default for a solo
            OWNER+Artist, since it used to require picking down to "one"
            from a list of one. */}
        {canManageOthers && !profile?.isSoloStudio && (
          <MultiSelectFilter
            placeholder="All artists"
            options={artists.map((artist) => ({ value: artist.id, label: artistLabel(artist) }))}
            selected={artistFilter}
            onChange={setArtistFilter}
          />
        )}

        {publicGalleryUrl ? (
          <button
            type="button"
            onClick={handleCopyLink}
            className="ml-auto flex items-center gap-2 rounded-full border border-border px-3 py-2 text-xs font-medium text-fg transition hover:bg-surface"
          >
            <CopyIcon className="h-3.5 w-3.5" />
            {copiedLink ? 'Link copied!' : 'Copy public gallery link'}
          </button>
        ) : (
          canManageOthers && (
            <p className="ml-auto text-xs text-fg-muted">Filter to one artist to get their public gallery link.</p>
          )
        )}
      </div>

      <div className="mt-6 card-surface rounded-2xl border border-border bg-surface p-5">
        {pieces === null && !error && <p className="text-sm text-fg-secondary">Loading…</p>}

        {pieces !== null && pieces.length === 0 && (
          <p className="text-sm text-fg-secondary">No flash pieces yet -- create the first one.</p>
        )}

        {pieces !== null && pieces.length > 0 && filteredPieces !== null && filteredPieces.length === 0 && (
          <p className="text-sm text-fg-secondary">No flash pieces match these filters.</p>
        )}

        {filteredPieces !== null && filteredPieces.length > 0 && (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {filteredPieces.map((piece, pieceIndex) => (
              <div key={piece.id} className="overflow-hidden rounded-xl border border-border bg-surface">
                <button
                  type="button"
                  onClick={() =>
                    setLightbox({ images: filteredPieces.map((p) => p.imageUrl), index: pieceIndex })
                  }
                  aria-label={`View ${piece.title} full size`}
                  className="group relative aspect-square w-full overflow-hidden bg-surface-inset"
                >
                  <img src={piece.imageUrl} alt={piece.title} className="h-full w-full object-cover" />
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition group-hover:bg-black/30 group-hover:opacity-100">
                    <ViewIcon className="h-6 w-6 text-white" />
                  </div>
                  {piece.isOneOfOne && (
                    <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-fg/85 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-bg backdrop-blur-sm">
                      <SparkleIcon className="h-3 w-3" />
                      One of one
                    </span>
                  )}
                </button>
                <div className="p-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 truncate text-sm font-medium text-fg">{piece.title}</p>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${STATUS_TONE[piece.status]}`}>
                      {STATUS_LABEL[piece.status]}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-fg-secondary">
                    ${(piece.priceCents / 100).toFixed(2)} &middot; {formatDurationHours(piece.estimatedDurationMinutes)}
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
      </div>

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
                <label className="mb-1 block text-sm font-medium text-fg-secondary">Duration (hours) *</label>
                <input
                  type="number"
                  min="0.25"
                  step="0.25"
                  value={form.estimatedDurationHours}
                  onChange={(e) => setForm({ ...form, estimatedDurationHours: e.target.value })}
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

      <AnimatePresence>
        {lightbox && (
          <ImageLightbox
            images={lightbox.images}
            index={lightbox.index}
            onIndexChange={(index) => setLightbox({ images: lightbox.images, index })}
            onClose={() => setLightbox(null)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
