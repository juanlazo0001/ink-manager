import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { apiFetch, ApiError } from '../lib/api'
import { uploadImageToCloudinary } from '../lib/cloudinary'
import { FlatArtistAvatar } from '../components/ArtistAvatar'
import PublicPageFooter from '../components/PublicPageFooter'
import PhoneInput from '../components/PhoneInput'
import ImageUploadSection, { type ImageUploadState } from '../components/ImageUploadSection'
import ImageLightbox from '../components/ImageLightbox'
import { ViewIcon, SparkleIcon } from '../components/icons'
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
  themePreset: string
  artistName: string
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
  const { studioSlug, artistId } = useParams<{ studioSlug: string; artistId: string }>()
  const [state, setState] = useState<PageState>('loading')
  const [invalidMessage, setInvalidMessage] = useState(t('flashGallery.unavailableDefault'))
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

  // Fix pass: see IntakeForm.tsx's identical comment -- the FIRST fetch
  // must not send ?locale= explicitly, or it overrides the studio's own
  // configured defaultLocale on a fresh, never-toggled load (no Client
  // exists yet on this pre-request browse page to protect either way).
  //
  // Also see WaiverSign.tsx's comment: a plain ref flipped synchronously
  // at the top of the effect isn't enough of a guard on its own under
  // React 18 StrictMode's dev-only double-invoke (the second invocation
  // would see the ref already-false and send a stray explicit
  // ?locale=en that races the correct fetch). Gating on a ref that's
  // only set INSIDE the fetch's own .then() sidesteps that.
  const hasLoadedRef = useRef(false)
  useEffect(() => {
    if (!studioSlug || !artistId) return

    let ignore = false
    const localeParam = hasLoadedRef.current ? `&locale=${locale}` : ''
    apiFetch<GalleryResponse>(
      `/flash-pieces/public?studioSlug=${encodeURIComponent(studioSlug)}&artistId=${encodeURIComponent(artistId)}${localeParam}`,
    )
      .then((data) => {
        if (ignore) return
        hasLoadedRef.current = true
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
  }, [studioSlug, artistId, locale])

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
      await apiFetch(`/flash-pieces/${selectedPiece.id}/request`, {
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
      setState('success')
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : t('common.somethingWentWrong'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="login-shell flex min-h-screen items-center justify-center px-4 py-10 text-fg">
      <div className="login-panel-surface w-full max-w-2xl px-4 py-8 sm:p-8">
        <div className="mb-4 flex justify-end">
          <LanguagePicker />
        </div>

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
                {t('flashGallery.requestSentBody', { studioName: gallery?.studioName ?? '' })}
              </p>
            </motion.div>
          )}

          {state === 'gallery' && gallery && (
            <motion.div key="gallery" variants={crossfadeVariants} initial="initial" animate="animate" exit="exit" transition={uiSpringTransition}>
              {gallery.studioLogoUrl && (
                <img src={gallery.studioLogoUrl} alt={gallery.studioName} className="mb-4 h-10 w-auto object-contain" />
              )}
              <h1 className="login-jura text-xl font-semibold text-fg">{t('flashGallery.pageHeading')}</h1>
              <div className="mt-2 flex items-center gap-2.5">
                <FlatArtistAvatar name={gallery.artistName} avatarUrl={gallery.artistAvatarUrl} className="h-8 w-8" />
                <p className="text-base text-accent">
                  {t('flashGallery.intro', { artistName: gallery.artistName, studioName: gallery.studioName })}
                </p>
              </div>

              {gallery.pieces.length === 0 ? (
                <p className="mt-6 text-sm text-fg-secondary">{t('flashGallery.noPiecesAvailable')}</p>
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
                        aria-label={t('flashGallery.viewFullSize', { title: piece.title })}
                        className="group relative block aspect-square w-full overflow-hidden bg-surface"
                      >
                        <img src={piece.imageUrl} alt={piece.title} className="h-full w-full object-cover" />
                        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition group-hover:bg-black/30 group-hover:opacity-100">
                          <ViewIcon className="h-6 w-6 text-white" />
                        </div>
                        {piece.isOneOfOne && (
                          <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-fg/85 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-bg backdrop-blur-sm">
                            <SparkleIcon className="h-3 w-3" />
                            {t('flashGallery.oneOfOne')}
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
            </motion.div>
          )}

          {state === 'request' && selectedPiece && (
            <motion.div key="request" variants={crossfadeVariants} initial="initial" animate="animate" exit="exit" transition={uiSpringTransition}>
              <button type="button" onClick={() => setState('gallery')} className="text-xs font-medium text-fg-muted hover:text-fg">
                {t('flashGallery.backToGallery')}
              </button>
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
