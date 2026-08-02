import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import { apiFetch, ApiError } from '../lib/api'
import { uploadImageToCloudinary } from '../lib/cloudinary'
import { applyThemePreset } from '../lib/themePresets'
import { FlatArtistAvatar } from '../components/ArtistAvatar'
import PublicPageFooter from '../components/PublicPageFooter'
import PhoneInput from '../components/PhoneInput'
import ImageUploadSection, { type ImageUploadState } from '../components/ImageUploadSection'
import ImageLightbox from '../components/ImageLightbox'
import { ViewIcon, SparkleIcon } from '../components/icons'
import { isValidPhoneDigits, formatDurationHours } from '../lib/format'

type PageState = 'loading' | 'invalid' | 'gallery' | 'request' | 'success'

interface FlashPieceSummary {
  id: string
  imageUrl: string
  title: string
  description: string | null
  priceCents: number
  estimatedDurationMinutes: number
  isOneOfOne: boolean
}

interface GalleryResponse {
  studioName: string
  studioSlug: string
  studioLogoUrl: string | null
  themePreset: string
  artistName: string
  artistAvatarUrl: string | null
  pieces: FlashPieceSummary[]
}

interface LookupResponse {
  found: boolean
  firstName?: string
  lastName?: string
  email?: string | null
  phone?: string | null
}

const INPUT_CLASS =
  'mt-1 w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent'

export default function FlashPublicGallery() {
  const { studioSlug, artistId } = useParams<{ studioSlug: string; artistId: string }>()
  const [state, setState] = useState<PageState>('loading')
  const [invalidMessage, setInvalidMessage] = useState('This gallery is unavailable.')
  const [gallery, setGallery] = useState<GalleryResponse | null>(null)
  const [selectedPiece, setSelectedPiece] = useState<FlashPieceSummary | null>(null)
  const [lightbox, setLightbox] = useState<{ images: string[]; index: number } | null>(null)

  // Contact lookup step -- phone is asked first (this app is SMS-centric),
  // then only the fields NOT already on file get shown, per the task's own
  // "only ask for contact fields not already known" instruction.
  const [phone, setPhone] = useState('')
  const [lookupState, setLookupState] = useState<'idle' | 'checking' | 'found' | 'not-found'>('idle')
  const [lookupError, setLookupError] = useState<string | null>(null)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')

  const [placementDescription, setPlacementDescription] = useState('')
  const [placementPhoto, setPlacementPhoto] = useState<ImageUploadState>({ urls: [], uploading: false })

  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    if (!studioSlug || !artistId) return

    let ignore = false
    apiFetch<GalleryResponse>(`/flash-pieces/public?studioSlug=${encodeURIComponent(studioSlug)}&artistId=${encodeURIComponent(artistId)}`)
      .then((data) => {
        if (ignore) return
        setGallery(data)
        applyThemePreset(data.themePreset)
        setState('gallery')
      })
      .catch((err) => {
        if (ignore) return
        setInvalidMessage(err instanceof Error ? err.message : 'This gallery is unavailable.')
        setState('invalid')
      })

    return () => {
      ignore = true
    }
  }, [studioSlug, artistId])

  function selectPiece(piece: FlashPieceSummary) {
    setSelectedPiece(piece)
    setPhone('')
    setLookupState('idle')
    setLookupError(null)
    setFirstName('')
    setLastName('')
    setEmail('')
    setPlacementDescription('')
    setPlacementPhoto({ urls: [], uploading: false })
    setSubmitError(null)
    setState('request')
  }

  async function handleLookup() {
    if (!studioSlug || phone.length !== 10 || !isValidPhoneDigits(phone)) {
      setLookupError('Enter a complete 10-digit phone number.')
      return
    }
    setLookupError(null)
    setLookupState('checking')
    try {
      const result = await apiFetch<LookupResponse>(
        `/flash-pieces/lookup-public?studioSlug=${encodeURIComponent(studioSlug)}&phone=${encodeURIComponent(phone)}`,
      )
      if (result.found) {
        setFirstName(result.firstName ?? '')
        setLastName(result.lastName ?? '')
        setEmail(result.email ?? '')
        setLookupState('found')
      } else {
        setLookupState('not-found')
      }
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
      setLookupState('idle')
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedPiece) return
    setSubmitError(null)

    if (!placementDescription.trim()) {
      setSubmitError('Please describe where you’d like this placed.')
      return
    }
    if (placementPhoto.urls.length === 0) {
      setSubmitError('Please add a photo of the placement area.')
      return
    }
    if (lookupState === 'not-found' && (!firstName.trim() || !lastName.trim() || !email.trim())) {
      setSubmitError('Please fill in your name and email.')
      return
    }

    setSubmitting(true)
    try {
      await apiFetch(`/flash-pieces/${selectedPiece.id}/request`, {
        method: 'POST',
        body: JSON.stringify({
          placementDescription: placementDescription.trim(),
          placementPhotoUrl: placementPhoto.urls[0],
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim() || undefined,
          phone,
        }),
      })
      setState('success')
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4 py-10 text-fg">
      <div className="w-full max-w-2xl rounded-2xl card-surface border border-border bg-surface p-8">
        {state === 'loading' && <p className="text-center text-sm text-fg-secondary">Loading…</p>}

        {state === 'invalid' && (
          <div className="text-center">
            <h1 className="text-xl font-semibold text-fg">This gallery isn't available</h1>
            <p className="mt-2 text-sm text-fg-secondary">{invalidMessage}</p>
          </div>
        )}

        {state === 'success' && (
          <div className="text-center">
            <h1 className="text-xl font-semibold text-fg">Request sent!</h1>
            <p className="mt-2 text-sm text-fg-secondary">
              {gallery?.studioName} will review your placement and get back to you shortly to confirm and collect
              payment -- this isn't booked yet.
            </p>
          </div>
        )}

        {state === 'gallery' && gallery && (
          <div>
            {gallery.studioLogoUrl && (
              <img src={gallery.studioLogoUrl} alt={gallery.studioName} className="mb-4 h-10 w-auto object-contain" />
            )}
            <h1 className="text-xl font-semibold text-fg">Flash Gallery</h1>
            <div className="mt-2 flex items-center gap-2.5">
              <FlatArtistAvatar name={gallery.artistName} avatarUrl={gallery.artistAvatarUrl} className="h-8 w-8" />
              <p className="text-sm text-fg-secondary">
                {gallery.artistName}'s ready-to-book designs at {gallery.studioName}.
              </p>
            </div>

            {gallery.pieces.length === 0 ? (
              <p className="mt-6 text-sm text-fg-secondary">No flash pieces are available right now.</p>
            ) : (
              <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
                {gallery.pieces.map((piece, pieceIndex) => (
                  <div
                    key={piece.id}
                    className="overflow-hidden rounded-xl border border-border bg-surface-inset transition hover:border-accent"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setLightbox({ images: gallery.pieces.map((p) => p.imageUrl), index: pieceIndex })
                      }
                      aria-label={`View ${piece.title} full size`}
                      className="group relative block aspect-square w-full overflow-hidden bg-surface"
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
                    <button type="button" onClick={() => selectPiece(piece)} className="block w-full p-2.5 text-left">
                      <p className="truncate text-sm font-medium text-fg">{piece.title}</p>
                      <p className="mt-0.5 text-xs text-fg-secondary">${(piece.priceCents / 100).toFixed(2)}</p>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {state === 'request' && selectedPiece && (
          <div>
            <button type="button" onClick={() => setState('gallery')} className="text-xs font-medium text-fg-muted hover:text-fg">
              &larr; Back to gallery
            </button>
            <h1 className="mt-2 text-xl font-semibold text-fg">Request "{selectedPiece.title}"</h1>
            <p className="mt-1 text-sm text-fg-secondary">
              ${(selectedPiece.priceCents / 100).toFixed(2)} &middot; ~{formatDurationHours(selectedPiece.estimatedDurationMinutes)}
              {selectedPiece.isOneOfOne && ' · One of one -- first request wins'}
            </p>

            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-fg-secondary">Your phone number *</label>
                <div className="flex gap-2">
                  <PhoneInput value={phone} onChange={setPhone} disabled={lookupState !== 'idle'} className={INPUT_CLASS} />
                  {lookupState === 'idle' && (
                    <button
                      type="button"
                      onClick={handleLookup}
                      className="mt-1 shrink-0 rounded-lg border border-border px-3 py-2 text-sm font-medium text-fg transition hover:bg-surface-inset"
                    >
                      Continue
                    </button>
                  )}
                </div>
                {lookupState === 'checking' && <p className="mt-1 text-xs text-fg-muted">Checking…</p>}
                {lookupError && <p className="mt-1 text-xs text-danger">{lookupError}</p>}
                {lookupState === 'found' && (
                  <p className="mt-1 text-xs text-success">Welcome back, {firstName}!</p>
                )}
              </div>

              {lookupState === 'not-found' && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-fg-secondary">First name *</label>
                    <input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} className={INPUT_CLASS} />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-fg-secondary">Last name *</label>
                    <input type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} className={INPUT_CLASS} />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="mb-1 block text-sm font-medium text-fg-secondary">Email *</label>
                    <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={INPUT_CLASS} />
                  </div>
                </div>
              )}

              {(lookupState === 'found' || lookupState === 'not-found') && (
                <>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-fg-secondary">Where would you like this placed? *</label>
                    <textarea
                      rows={2}
                      placeholder="e.g. outer left forearm"
                      value={placementDescription}
                      onChange={(e) => setPlacementDescription(e.target.value)}
                      className={INPUT_CLASS}
                    />
                  </div>

                  <ImageUploadSection
                    label="Photo of the placement area *"
                    hint="A photo of the area so the artist can plan sizing/placement."
                    onChange={setPlacementPhoto}
                    uploadFn={uploadImageToCloudinary}
                  />

                  {submitError && <p className="text-sm text-danger">{submitError}</p>}

                  <button
                    type="submit"
                    disabled={submitting || placementPhoto.uploading}
                    className="w-full rounded-full bg-accent px-4 py-2 text-sm font-medium text-bg transition hover:bg-accent-hover disabled:opacity-60"
                  >
                    {submitting ? 'Sending…' : 'Send request'}
                  </button>
                </>
              )}
            </form>
          </div>
        )}

        <PublicPageFooter studioSlug={gallery?.studioSlug} />
      </div>

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
