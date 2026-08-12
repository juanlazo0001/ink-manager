import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { apiFetch, ApiError } from '../lib/api'
import { uploadImageToCloudinary } from '../lib/cloudinary'
import { buildMapsUrl } from '../lib/maps'
import PublicPageFooter from '../components/PublicPageFooter'
import PhoneInput from '../components/PhoneInput'
import ImageUploadSection, { type ImageUploadState } from '../components/ImageUploadSection'
import ImageLightbox from '../components/ImageLightbox'
import { ViewIcon, SparkleIcon, CalendarIcon, MapPinIcon } from '../components/icons'
import { isValidPhoneDigits, formatDurationHours } from '../lib/format'
import { LocaleProvider, useLocale, useTranslations } from '../i18n'
import LanguagePicker from '../i18n/LanguagePicker'
import { crossfadeVariants, uiSpringTransition } from '../lib/motion'

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
  studioAddress: string | null
  themePreset: string
  artistId: string | null
  artistName: string | null
  artistAvatarUrl: string | null
  pieces: FlashPieceSummary[]
  resolvedLocale?: string
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

// An artwork whose own aspect ratio falls well outside the common
// square/portrait tattoo-flash shape (a panoramic forearm-strip design, a
// tall single needle-and-thread piece, etc.) gets letterboxed via
// object-fit: contain against the card's own dark surface instead of
// being cropped illegibly by the default object-fit: cover treatment --
// see this file's own "graceful containment" verification screenshot.
const EXTREME_ASPECT_MIN = 0.42
const EXTREME_ASPECT_MAX = 2.3

export default function FlashPublicGallery() {
  return (
    <LocaleProvider>
      <FlashPublicGalleryContent />
    </LocaleProvider>
  )
}

function FlashPublicGalleryContent() {
  const { t } = useTranslations()
  const { locale, setLocale } = useLocale()
  const { studioSlug, artistId } = useParams<{ studioSlug: string; artistId?: string }>()
  const [state, setState] = useState<PageState>('loading')
  const [invalidMessage, setInvalidMessage] = useState(t('flashGallery.unavailableDefault'))
  const [gallery, setGallery] = useState<GalleryResponse | null>(null)
  const [selectedPiece, setSelectedPiece] = useState<FlashPieceSummary | null>(null)
  const [lightbox, setLightbox] = useState<{ images: string[]; index: number } | null>(null)
  const [containPieceIds, setContainPieceIds] = useState<Set<string>>(new Set())

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
  // Artist review toggle: whether this piece's artist has review off, so
  // the confirmation screen says something honest instead of always
  // claiming a human will look at it.
  const [instantlyApproved, setInstantlyApproved] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // Language becomes customer-specific, amended: anonymous pages (this
  // one included) get a STATELESS toggle -- LanguagePicker itself already
  // persists nothing (see its own comment), so mounting it during
  // anonymous browsing too (not just once the request form appears) is
  // exactly the amendment's ask. Still pre-selected from the server's own
  // Accept-Language detection below; toggling it only ever re-renders.
  useEffect(() => {
    if (!studioSlug) return

    let ignore = false
    const query = new URLSearchParams({ studioSlug })
    if (artistId) query.set('artistId', artistId)
    apiFetch<GalleryResponse>(`/flash-pieces/public?${query.toString()}`)
      .then((data) => {
        if (ignore) return
        setGallery(data)
        setState('gallery')
        if (data.resolvedLocale && data.resolvedLocale !== locale) setLocale(data.resolvedLocale as typeof locale)
      })
      .catch((err) => {
        if (ignore) return
        setInvalidMessage(err instanceof Error ? err.message : t('flashGallery.unavailableDefault'))
        setState('invalid')
      })

    return () => {
      ignore = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  function handleArtLoad(pieceId: string, e: React.SyntheticEvent<HTMLImageElement>) {
    const { naturalWidth, naturalHeight } = e.currentTarget
    if (!naturalWidth || !naturalHeight) return
    const ratio = naturalWidth / naturalHeight
    if (ratio < EXTREME_ASPECT_MIN || ratio > EXTREME_ASPECT_MAX) {
      setContainPieceIds((prev) => {
        if (prev.has(pieceId)) return prev
        const next = new Set(prev)
        next.add(pieceId)
        return next
      })
    }
  }

  async function handleLookup() {
    if (!studioSlug || phone.length !== 10 || !isValidPhoneDigits(phone)) {
      setLookupError(t('flashGallery.enterCompletePhoneNumber'))
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
      setLookupError(err instanceof Error ? err.message : t('common.somethingWentWrong'))
      setLookupState('idle')
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedPiece) return
    setSubmitError(null)

    if (!placementDescription.trim()) {
      setSubmitError(t('flashGallery.pleaseDescribePlacement'))
      return
    }
    if (placementPhoto.urls.length === 0) {
      setSubmitError(t('flashGallery.pleaseAddPlacementPhoto'))
      return
    }
    if (lookupState === 'not-found' && (!firstName.trim() || !lastName.trim() || !email.trim())) {
      setSubmitError(t('flashGallery.pleaseFillNameAndEmail'))
      return
    }

    setSubmitting(true)
    try {
      const result = await apiFetch<{ success: true; instantlyApproved: boolean }>(`/flash-pieces/${selectedPiece.id}/request`, {
        method: 'POST',
        body: JSON.stringify({
          placementDescription: placementDescription.trim(),
          placementPhotoUrl: placementPhoto.urls[0],
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim() || undefined,
          phone,
          // Multi-language public forms, fix pass: no Client is guaranteed
          // to exist until this request creates/finds one (see
          // LanguagePicker's own comment on why intake/flash-gallery are
          // the two flows that persist locale at submission time instead
          // of via PATCH .../locale).
          preferredLocale: locale,
        }),
      })
      setInstantlyApproved(result.instantlyApproved)
      setState('success')
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : t('common.somethingWentWrong'))
    } finally {
      setSubmitting(false)
    }
  }

  if (state === 'gallery' && gallery) {
    // Artist-filtered only ("Currently at {studio}") -- describes which
    // studio THIS gallery/URL is for, not a live residency check. If this
    // artist has an active CONFIRMED residency at a DIFFERENT studio right
    // now, this line can read stale for a visitor who lands on an old/
    // bookmarked link -- flagged, not solved, see REPORT.md.
    const isArtistFiltered = Boolean(gallery.artistName)

    return (
      <div className="login-shell flash-gallery-page relative z-10 min-h-screen px-4 py-10 text-fg">
        {createPortal(<span className="flash-gallery-ambient" aria-hidden="true" />, document.body)}

        <div className="flash-gallery-shell">
          <header className="flash-gallery-header">
            <div className="flash-gallery-logo">
              {isArtistFiltered ? (
                <span className="flash-gallery-avatar">
                  {gallery.artistAvatarUrl ? (
                    <img src={gallery.artistAvatarUrl} alt={gallery.artistName!} />
                  ) : (
                    <span className="flash-gallery-avatar-fallback">{gallery.artistName!.slice(0, 1).toUpperCase()}</span>
                  )}
                </span>
              ) : gallery.studioLogoUrl ? (
                <img src={gallery.studioLogoUrl} alt={gallery.studioName} />
              ) : (
                <span className="flash-gallery-logo-fallback">{gallery.studioName.slice(0, 1).toUpperCase()}</span>
              )}
            </div>
            <LanguagePicker />
          </header>

          <div className="flash-gallery-titleblock">
            <h1 className="flash-gallery-h1">
              {t('flashGallery.titleFirst')} <em>{t('flashGallery.titleSecond')}</em>
            </h1>
            <span className="flash-gallery-rule" aria-hidden="true" />
            <div className="flash-gallery-context">
              {isArtistFiltered ? (
                <>
                  <p className="flash-gallery-currently-at">
                    {t('flashGallery.currentlyAt', { studioName: gallery.studioName })}
                  </p>
                  {gallery.studioAddress && (
                    <a
                      href={buildMapsUrl(gallery.studioAddress)}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={t('flashGallery.openInMaps')}
                      className="flash-gallery-address"
                    >
                      <MapPinIcon className="h-3.5 w-3.5 shrink-0" />
                      {gallery.studioAddress}
                    </a>
                  )}
                </>
              ) : (
                <p>{t('flashGallery.introStudioWide', { studioName: gallery.studioName })}</p>
              )}
            </div>
          </div>

          {gallery.pieces.length === 0 ? (
            <p className="flash-gallery-empty">{t('flashGallery.noPiecesAvailable')}</p>
          ) : (
            <div className="flash-gallery-list">
              {gallery.pieces.map((piece, pieceIndex) => (
                <article key={piece.id} className="flash-piece-card">
                  <button
                    type="button"
                    onClick={() => setLightbox({ images: gallery.pieces.map((p) => p.imageUrl), index: pieceIndex })}
                    aria-label={t('flashGallery.viewFullSize', { title: piece.title })}
                    className={`flash-piece-art${containPieceIds.has(piece.id) ? ' contain' : ''}`}
                  >
                    <img src={piece.imageUrl} alt={piece.title} onLoad={(e) => handleArtLoad(piece.id, e)} />
                    <span className="flash-piece-view">
                      <ViewIcon className="h-6 w-6" />
                    </span>
                    {piece.isOneOfOne && (
                      <span className="flash-piece-badge">
                        <SparkleIcon className="h-3 w-3" />
                        {t('flashGallery.oneOfOne')}
                      </span>
                    )}
                  </button>
                  <div className="flash-piece-details">
                    <h2>{piece.title}</h2>
                    <span className="flash-piece-rule" aria-hidden="true" />
                    {piece.description && <p className="flash-piece-desc">{piece.description}</p>}
                    <p className="flash-piece-price">${(piece.priceCents / 100).toFixed(2)}</p>
                    <p className="flash-piece-meta">
                      {t('flashGallery.durationApprox', { duration: formatDurationHours(piece.estimatedDurationMinutes) })}
                      {piece.isOneOfOne && ` ${t('flashGallery.oneOfOneFirstRequestWins')}`}
                    </p>
                    <button type="button" onClick={() => selectPiece(piece)} className="flash-piece-book btn-gold-gradient">
                      <CalendarIcon className="h-4 w-4" />
                      {t('flashGallery.bookThisDesign')}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}

          <PublicPageFooter studioSlug={gallery.studioSlug} variant="icons" />
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

  return (
    <div className="login-shell flex min-h-screen items-center justify-center px-4 py-10 text-fg">
      <div className="login-panel-surface w-full max-w-2xl px-4 py-8 sm:p-8">
        <AnimatePresence mode="wait">
          {state === 'loading' && (
            <motion.p key="loading" variants={crossfadeVariants} initial="initial" animate="animate" exit="exit" transition={uiSpringTransition} className="text-center text-sm text-fg-secondary">
              {t('common.loading')}
            </motion.p>
          )}

          {state === 'invalid' && (
            <motion.div key="invalid" variants={crossfadeVariants} initial="initial" animate="animate" exit="exit" transition={uiSpringTransition} className="text-center">
              <h1 className="login-jura text-xl font-semibold text-fg">{t('flashGallery.unavailableHeading')}</h1>
              <p className="mt-2 text-sm text-fg-secondary">{invalidMessage}</p>
            </motion.div>
          )}

          {state === 'success' && (
            <motion.div key="success" variants={crossfadeVariants} initial="initial" animate="animate" exit="exit" transition={uiSpringTransition} className="text-center">
              <h1 className="login-jura text-xl font-semibold text-fg">{t('flashGallery.requestSentHeading')}</h1>
              <p className="mt-2 text-sm text-fg-secondary">
                {instantlyApproved
                  ? t('flashGallery.requestSentBodyInstant')
                  : t('flashGallery.requestSentBody', { studioName: gallery?.studioName ?? '' })}
              </p>
            </motion.div>
          )}

          {state === 'request' && selectedPiece && (
            <motion.div key="request" variants={crossfadeVariants} initial="initial" animate="animate" exit="exit" transition={uiSpringTransition}>
              <div className="flex items-start justify-between gap-4">
                <button type="button" onClick={() => setState('gallery')} className="text-xs font-medium text-fg-muted hover:text-fg">
                  {t('flashGallery.backToGallery')}
                </button>
                {/* Language becomes customer-specific: this is the moment an
                    anonymous browser crosses into an identified flow (about
                    to create/match a Client record on submit) -- the picker
                    appears here too, same stateless component as the
                    gallery header above. */}
                <LanguagePicker />
              </div>
              <h1 className="login-jura mt-2 text-xl font-semibold text-fg">{t('flashGallery.requestTitle', { title: selectedPiece.title })}</h1>
              <p className="mt-1 text-sm text-fg-secondary">
                ${(selectedPiece.priceCents / 100).toFixed(2)} &middot; {t('flashGallery.durationApprox', { duration: formatDurationHours(selectedPiece.estimatedDurationMinutes) })}
                {selectedPiece.isOneOfOne && ` ${t('flashGallery.oneOfOneFirstRequestWins')}`}
              </p>

              <form onSubmit={handleSubmit} className="mt-6 space-y-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-fg-secondary">{t('flashGallery.phoneNumber')}</label>
                  <div className="flex gap-2">
                    <PhoneInput value={phone} onChange={setPhone} disabled={lookupState !== 'idle'} className={INPUT_CLASS} />
                    {lookupState === 'idle' && (
                      <button
                        type="button"
                        onClick={handleLookup}
                        className="mt-1 shrink-0 rounded-lg border border-border px-3 py-2 text-sm font-medium text-fg transition hover:bg-surface-inset"
                      >
                        {t('flashGallery.continueButton')}
                      </button>
                    )}
                  </div>
                  {lookupState === 'checking' && <p className="mt-1 text-xs text-fg-muted">{t('flashGallery.checking')}</p>}
                  {lookupError && <p className="mt-1 text-xs text-danger">{lookupError}</p>}
                  {lookupState === 'found' && (
                    <p className="mt-1 text-xs text-success">{t('flashGallery.welcomeBack', { firstName })}</p>
                  )}
                </div>

                <AnimatePresence initial={false}>
                  {lookupState === 'not-found' && (
                    <motion.div
                      key="lookup-fields"
                      variants={crossfadeVariants}
                      initial="initial"
                      animate="animate"
                      exit="exit"
                      transition={uiSpringTransition}
                      className="grid grid-cols-1 gap-4 sm:grid-cols-2"
                    >
                      <div>
                        <label className="mb-1 block text-sm font-medium text-fg-secondary">{t('flashGallery.firstName')}</label>
                        <input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} className={INPUT_CLASS} />
                      </div>
                      <div>
                        <label className="mb-1 block text-sm font-medium text-fg-secondary">{t('flashGallery.lastName')}</label>
                        <input type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} className={INPUT_CLASS} />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="mb-1 block text-sm font-medium text-fg-secondary">{t('flashGallery.email')}</label>
                        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={INPUT_CLASS} />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <AnimatePresence initial={false}>
                  {(lookupState === 'found' || lookupState === 'not-found') && (
                    <motion.div
                      key="lookup-continuation"
                      variants={crossfadeVariants}
                      initial="initial"
                      animate="animate"
                      exit="exit"
                      transition={uiSpringTransition}
                      className="space-y-4"
                    >
                      <div>
                        <label className="mb-1 block text-sm font-medium text-fg-secondary">{t('flashGallery.placementPrompt')}</label>
                        <textarea
                          rows={2}
                          placeholder={t('flashGallery.placementPlaceholder')}
                          value={placementDescription}
                          onChange={(e) => setPlacementDescription(e.target.value)}
                          className={INPUT_CLASS}
                        />
                      </div>

                      <ImageUploadSection
                        label={t('flashGallery.placementPhotoLabel')}
                        hint={t('flashGallery.placementPhotoHint')}
                        onChange={setPlacementPhoto}
                        uploadFn={uploadImageToCloudinary}
                      />

                      {submitError && <p className="text-sm text-danger">{submitError}</p>}

                      <button
                        type="submit"
                        disabled={submitting || placementPhoto.uploading}
                        className="w-full rounded-full bg-accent px-4 py-2 text-sm font-medium text-bg transition hover:bg-accent-hover disabled:opacity-60"
                      >
                        {submitting ? t('flashGallery.sending') : t('flashGallery.sendRequest')}
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </form>
            </motion.div>
          )}
        </AnimatePresence>

        <PublicPageFooter studioSlug={gallery?.studioSlug} />
      </div>
    </div>
  )
}
