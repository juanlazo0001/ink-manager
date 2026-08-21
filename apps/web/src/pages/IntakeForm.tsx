import { useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { apiFetch, ApiError, fetchPublicWithRetry, isTransientApiFailure } from '../lib/api'
import PhoneInput from '../components/PhoneInput'
import CurrencyInput from '../components/CurrencyInput'
import ImageUploadSection, { type ImageUploadState } from '../components/ImageUploadSection'
import PublicPageFooter from '../components/PublicPageFooter'
import { isValidPhoneDigits } from '../lib/format'
import { formatCurrencyInput } from '../lib/money'
import { LocaleProvider, useLocale, useTranslations } from '../i18n'
import LanguagePicker from '../i18n/LanguagePicker'
import { crossfadeVariants, uiSpringTransition } from '../lib/motion'

interface PrefillPayload {
  firstName?: string
  lastName?: string
  email?: string
  phone?: string
  description?: string
  placement?: string
  estimatedSize?: string
  budget?: string
  desiredTiming?: string
  preferredArtistId?: string
}

const INPUT_CLASS =
  'mt-1 w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent'
const LABEL_CLASS = 'block text-sm font-medium text-fg-secondary'

interface PublicArtist {
  id: string
  name: string
}

// Package Q (revised): the studio's own configured intake form -- system
// fields (backed by a fixed Inquiry/Client column, rendered through the
// SAME specialized components the form always used) and custom questions
// (backed by IntakeFormField.customQuestionType) freely mixed, in exactly
// this order. This replaces the old "fixed core fields, then supplementary
// questions after" two-section layout entirely.
interface IntakeFormFieldPublic {
  id: string
  fieldKind: 'SYSTEM' | 'CUSTOM'
  systemFieldKey: string | null
  customQuestionType:
    | 'TEXT'
    | 'PARAGRAPH'
    | 'NUMBER'
    | 'DATE'
    | 'YES_NO'
    | 'SELECT'
    | 'MULTI_SELECT'
    | 'PHOTO_UPLOAD'
    | null
  label: string
  helpText: string | null
  required: boolean
  options: string[] | null
  order: number
}

type CustomAnswerValue = string | string[]

// 'invalid'     -- the API answered: this studio/form genuinely does not exist.
// 'unavailable' -- we could not reach the API at all. A DIFFERENT state on
//                  purpose: these were conflated until 2026-08-21, and every
//                  API redeploy briefly told visitors the studio was not real.
type StudioCheck = 'loading' | 'valid' | 'invalid' | 'unavailable'

export default function IntakeForm() {
  return (
    <LocaleProvider>
      <IntakeFormContent />
    </LocaleProvider>
  )
}

function IntakeFormContent() {
  const { t } = useTranslations()
  const { locale, setLocale } = useLocale()
  const { studioSlug, formSlug } = useParams<{ studioSlug: string; formSlug?: string }>()
  const [searchParams] = useSearchParams()
  const draftToken = searchParams.get('draft')
  // 6a Epic Part 4: set only when arriving from an artist's own public
  // page BOOK flow -- see ArtistPublicPage.tsx. Distinct from the
  // configurable preferredArtistId form field below (a soft, studio-
  // enabled-or-not customer preference that never auto-assigns): this
  // always assigns the artist directly, server-side, regardless of that
  // studio's own intake-form configuration -- reused, not reinvented, from
  // the exact same "the artist chose this deep link, not the studio" logic
  // the backend's own POST /inquiries applies.
  const bookingArtistId = searchParams.get('bookingArtistId')

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [channel, setChannel] = useState('')
  const [referralCode, setReferralCode] = useState('')
  const [description, setDescription] = useState('')
  const [colorOrBlackGrey, setColorOrBlackGrey] = useState('')
  const [placement, setPlacement] = useState('')
  const [estimatedSize, setEstimatedSize] = useState('')
  const [hasBeenTattooedBefore, setHasBeenTattooedBefore] = useState('')
  const [budget, setBudget] = useState('')
  const [desiredTiming, setDesiredTiming] = useState('')
  const [preferredArtistId, setPreferredArtistId] = useState('')
  // Unchecked by default, deliberately -- a pre-checked box is not valid
  // A2P 10DLC opt-in consent. Deliberately kept OUTSIDE the configurable
  // field list -- always rendered, fixed position right before submit,
  // never reorderable/disableable (a legal requirement, not a business
  // preference a studio can turn off).
  //
  // A2P compliance fix (Twilio review): this box is GENUINELY optional --
  // it is never a submit gate, not even when a phone number is entered.
  // Forced consent is exactly what a carrier reviewer rejects. Leaving it
  // unchecked submits normally and simply records no consent on the
  // client (Client.smsConsentGivenAt stays null), which the send path and
  // the send-channel picker both treat as "SMS unavailable" -- see
  // lib/clientSms.ts and components/SendChannelButton.tsx.
  const [smsConsent, setSmsConsent] = useState(false)

  const [studioCheck, setStudioCheck] = useState<StudioCheck>('loading')
  // Bumped by the Retry button on the 'unavailable' state to re-run the
  // studio-resolution effect below.
  const [retryNonce, setRetryNonce] = useState(0)
  const [studioName, setStudioName] = useState('')
  const [studioLogoUrl, setStudioLogoUrl] = useState<string | null>(null)
  const [artists, setArtists] = useState<PublicArtist[]>([])
  const [fields, setFields] = useState<IntakeFormFieldPublic[]>([])
  // Default true -- matches every studio's always-on behavior before this
  // flag existed, so a slow/failed fetch never wrongly hides the option.
  const [referralProgramEnabled, setReferralProgramEnabled] = useState(true)
  const [customAnswers, setCustomAnswers] = useState<Record<string, CustomAnswerValue>>({})
  const [customImageUploading, setCustomImageUploading] = useState<Record<string, boolean>>({})
  const [referenceImages, setReferenceImages] = useState<ImageUploadState>({ urls: [], uploading: false })
  const [placementImages, setPlacementImages] = useState<ImageUploadState>({ urls: [], uploading: false })

  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)

  useEffect(() => {
    if (!studioSlug) return

    let ignore = false

    // OUTAGE FIX (2026-08-21): this fetch used to decide whether the studio
    // exists -- a 404 here set studioCheck to 'invalid' and rendered the
    // full-page "We couldn't find this studio". Two things were wrong with
    // that. It made the artist-dropdown endpoint the authority on studio
    // existence, which is not its job (/studio-settings/public is the real
    // resolver, and it is fetched right below). And it could not tell this
    // API's own 404 from Railway's edge-fallback 404, so any moment the API
    // service was unreachable -- every redeploy included -- the public
    // intake page told visitors the studio did not exist.
    //
    // It is now purely what its own comment always said it was: a
    // nice-to-have dropdown. NO failure here affects studioCheck.
    apiFetch<PublicArtist[]>(`/artists/public?studioSlug=${encodeURIComponent(studioSlug)}`)
      .then((data) => {
        if (ignore) return
        setArtists(data)
      })
      .catch(() => {
        // Leave the picker with "No preference" only.
      })

    return () => {
      ignore = true
    }
  }, [studioSlug])

  // Studio display name (for the consent checkbox label) and the studio's
  // own configured field list -- same public endpoint the /privacy and
  // /terms pages read from. formSlug absent -> whichever form is currently
  // the default, so /inquiry/{studio-slug} (no form-slug segment) keeps
  // resolving exactly like it always has.
  // Fix pass: the FIRST fetch must NOT send ?locale= explicitly -- an
  // explicit query param always wins in resolveRequestLocale's own
  // precedence, so it would override the visitor's own Accept-Language
  // detection (no Client exists yet here to protect, but the picker
  // still deserves to pre-select from the browser's own signal on a
  // fresh, never-toggled load, per "Language becomes customer-specific").
  // Only a genuine later change (the picker) sends it.
  //
  // A plain ref flipped synchronously at the top of the effect isn't
  // enough of a guard by itself: React 18 StrictMode's dev-only
  // mount -> cleanup -> remount dance re-invokes this effect a SECOND
  // time in the very same synchronous tick, before the first
  // invocation's fetch has had any chance to resolve -- flipping the
  // ref there just means the second invocation reads it as
  // already-false and sends a stray explicit ?locale=en (the
  // still-default state) that then races the correct no-param fetch
  // for whichever renders last (see WaiverSign.tsx, where this exact
  // race was caught live). Gating on a ref that's only set INSIDE the
  // fetch's own .then() sidesteps that: both synchronous StrictMode
  // invocations see it as unset (nothing has resolved yet either way)
  // and both send the safe no-param request; only a genuine LATER
  // change (the picker's onChange, well after that promise settled)
  // sees it set and sends the real explicit locale.
  const hasLoadedRef = useRef(false)
  useEffect(() => {
    if (!studioSlug) return

    let ignore = false
    const query = new URLSearchParams({ studioSlug, ...(hasLoadedRef.current ? { locale } : {}) })
    if (formSlug) query.set("formSlug", formSlug)

    fetchPublicWithRetry<{
      studioName: string
      studioLogoUrl: string | null
      intakeFormFields: IntakeFormFieldPublic[]
      referralProgramEnabled: boolean
      resolvedLocale?: string
    }>(`/studio-settings/public?${query}`)
      .then((data) => {
        if (ignore) return
        hasLoadedRef.current = true
        setStudioName(data.studioName)
        setStudioLogoUrl(data.studioLogoUrl)
        setFields((data.intakeFormFields ?? []).slice().sort((a, b) => a.order - b.order))
        setReferralProgramEnabled(data.referralProgramEnabled)
        if (data.resolvedLocale && data.resolvedLocale !== locale) setLocale(data.resolvedLocale as typeof locale)
        setStudioCheck('valid')
      })
      .catch((err) => {
        if (ignore) return

        // OUTAGE FIX (2026-08-21): three outcomes now, not two. A transient
        // failure (edge 404 while the API redeploys, 5xx, offline) is
        // explicitly NOT "this studio doesn't exist" -- it gets its own
        // retryable state. fetchPublicWithRetry has already retried a few
        // times by the time we land here, so this is a persistent problem,
        // but it is still the visitor's link that is fine and our service
        // that is not, and the copy must say so.
        if (isTransientApiFailure(err)) {
          setStudioCheck('unavailable')
          return
        }

        // A real 404 FROM THE API: either an unknown studio slug, or a
        // named formSlug that doesn't resolve to a real form (a broken or
        // stale link). Both are genuinely dead links, shown as such.
        if (err instanceof ApiError && err.status === 404) {
          setStudioCheck('invalid')
          return
        }

        // Anything else the API deliberately returned (a 4xx that isn't a
        // 404) leaves the form usable rather than blocking on it: the
        // checkbox label falls back to generic wording and an empty field
        // list renders nothing above the consent checkbox.
        setStudioCheck('valid')
      })

    return () => {
      ignore = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studioSlug, formSlug, locale, retryNonce])

  // Prefill data never rides in the URL as field values -- just this
  // opaque, single-use token. An invalid/expired token quietly falls back
  // to an empty form, no error banner drama.
  useEffect(() => {
    if (!draftToken) return

    let ignore = false

    apiFetch<{ payload: PrefillPayload }>(`/inquiries/prefill/${encodeURIComponent(draftToken)}`)
      .then(({ payload }) => {
        if (ignore) return
        if (payload.firstName) setFirstName(payload.firstName)
        if (payload.lastName) setLastName(payload.lastName)
        if (payload.email) setEmail(payload.email)
        if (payload.phone) setPhone(payload.phone.replace(/\D/g, '').slice(0, 10))
        if (payload.description) setDescription(payload.description)
        if (payload.placement) setPlacement(payload.placement)
        if (payload.estimatedSize) setEstimatedSize(payload.estimatedSize)
        if (payload.budget) setBudget(payload.budget.replace(/\D/g, ''))
        if (payload.desiredTiming) setDesiredTiming(payload.desiredTiming)
        if (payload.preferredArtistId) setPreferredArtistId(payload.preferredArtistId)
      })
      .catch(() => {
        // Invalid/expired/used token -- form just loads empty.
      })

    return () => {
      ignore = true
    }
  }, [draftToken])

  const systemFieldByKey = new Map(
    fields.filter((f) => f.fieldKind === 'SYSTEM' && f.systemFieldKey).map((f) => [f.systemFieldKey as string, f]),
  )
  const isRequired = (key: string) => systemFieldByKey.get(key)?.required ?? false

  const imagesUploading =
    referenceImages.uploading || placementImages.uploading || Object.values(customImageUploading).some(Boolean)

  function setCustomAnswer(fieldId: string, value: CustomAnswerValue) {
    setCustomAnswers((current) => ({ ...current, [fieldId]: value }))
  }

  function handleCustomPhotoUploadChange(fieldId: string, state: ImageUploadState) {
    setCustomAnswer(fieldId, state.urls)
    setCustomImageUploading((current) => ({ ...current, [fieldId]: state.uploading }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitError(null)

    const missingSystem: string[] = []
    if (isRequired('name') && (!firstName || !lastName)) missingSystem.push('name')
    if (isRequired('email') && !email) missingSystem.push('email')
    if (isRequired('phone') && !phone) missingSystem.push('phone')
    if (isRequired('referralSource') && !channel) missingSystem.push('referral source')
    if (isRequired('description') && !description) missingSystem.push('description')
    if (isRequired('colorOrBlackGrey') && !colorOrBlackGrey) missingSystem.push('color')
    if (isRequired('placement') && !placement) missingSystem.push('placement')
    if (isRequired('size') && !estimatedSize) missingSystem.push('size')
    if (isRequired('hasBeenTattooedBefore') && !hasBeenTattooedBefore) missingSystem.push('tattoo history')
    if (isRequired('budget') && !budget) missingSystem.push('budget')
    if (isRequired('desiredTiming') && !desiredTiming) missingSystem.push('desired timing')
    if (isRequired('preferredArtist') && !preferredArtistId) missingSystem.push('preferred artist')
    if (channel === 'REFERRAL' && !referralCode) missingSystem.push('referral code')

    if (missingSystem.length > 0) {
      setSubmitError(t('intake.pleaseFillRequiredFields'))
      return
    }

    if (!isValidPhoneDigits(phone)) {
      setSubmitError(t('intake.enterCompletePhoneOrBlank'))
      return
    }

    if (imagesUploading) {
      setSubmitError(t('intake.pleaseWaitForPhotos'))
      return
    }

    if (isRequired('referenceImages') && referenceImages.urls.length === 0) {
      setSubmitError(t('intake.pleaseAddReferenceImage'))
      return
    }

    if (isRequired('placementImages') && placementImages.urls.length === 0) {
      setSubmitError(t('intake.pleaseAddPlacementPhoto'))
      return
    }

    const missingCustomField = fields.find((f) => {
      if (f.fieldKind !== 'CUSTOM' || !f.required) return false
      const value = customAnswers[f.id]
      if (f.customQuestionType === 'MULTI_SELECT' || f.customQuestionType === 'PHOTO_UPLOAD') {
        return !Array.isArray(value) || value.length === 0
      }
      return !(typeof value === 'string' && value.trim())
    })
    if (missingCustomField) {
      setSubmitError(t('intake.pleaseAnswer', { fieldLabel: missingCustomField.label }))
      return
    }

    setSubmitting(true)

    try {
      await apiFetch('/inquiries', {
        method: 'POST',
        body: JSON.stringify({
          studioSlug,
          formSlug: formSlug || undefined,
          firstName,
          lastName,
          email,
          phone: phone || undefined,
          channel: channel || undefined,
          referralCode: channel === 'REFERRAL' ? referralCode : undefined,
          description,
          colorOrBlackGrey,
          placement,
          estimatedSize,
          hasBeenTattooedBefore: hasBeenTattooedBefore === 'yes',
          budget: budget ? formatCurrencyInput(budget) : undefined,
          desiredTiming: desiredTiming || undefined,
          preferredArtistId: preferredArtistId || undefined,
          bookingArtistId: bookingArtistId || undefined,
          referenceImages: referenceImages.urls,
          placementImages: placementImages.urls,
          draftToken: draftToken || undefined,
          smsConsent,
          // Multi-language public forms, fix pass: no Client exists yet at
          // picker-toggle time on this page (see LanguagePicker's own
          // comment) -- so unlike every other flow's PATCH .../locale,
          // this is the one moment intake CAN persist the client's choice,
          // right as their Client record is actually created.
          preferredLocale: locale,
          customFieldAnswers: Object.keys(customAnswers).length > 0 ? customAnswers : undefined,
        }),
      })

      setSubmitted(true)
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : t('common.somethingWentWrong'))
    } finally {
      setSubmitting(false)
    }
  }

  function renderSystemField(field: IntakeFormFieldPublic) {
    const asterisk = field.required ? ' *' : ''

    switch (field.systemFieldKey) {
      case 'name':
        return (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={LABEL_CLASS}>{t('intake.firstName')}{asterisk}</label>
              <input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required={field.required}
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label className={LABEL_CLASS}>{t('intake.lastName')}{asterisk}</label>
              <input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                required={field.required}
                className={INPUT_CLASS}
              />
            </div>
          </div>
        )
      case 'email':
        return (
          <div>
            <label className={LABEL_CLASS}>
              {field.label}
              {asterisk}
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required={field.required}
              className={INPUT_CLASS}
            />
            {field.helpText && <p className="mt-1 text-[11px] leading-snug text-fg-muted">{field.helpText}</p>}
          </div>
        )
      case 'phone':
        return (
          <div>
            <label className={LABEL_CLASS}>
              {field.label}
              {asterisk}
            </label>
            <PhoneInput value={phone} onChange={setPhone} className={INPUT_CLASS} />
            {/* Links to Ink Manager's own platform Privacy Policy/Terms
                (moved to the marketing site), not the per-Studio
                /privacy/:studioSlug page -- that's a different,
                separately-authored document this helper copy
                deliberately doesn't link to. Points at the bare
                inkmanager.app domain, not www.inkmanager.app: as of this
                writing www isn't yet attached as a custom domain on the
                marketing Railway service (still 404s -- see REPORT.md),
                so the apex domain is the only one actually confirmed
                live. Both will serve identical content once www is
                attached; switch this back to www at that point for the
                canonical hostname. */}
            <p className="mt-1 text-[11px] leading-snug text-fg-muted">
              {field.helpText ||
                (field.required ? t('intake.phoneHelpDefaultRequired') : t('intake.phoneHelpDefault'))}{' '}
              {t('intake.seeOurPrivacyAndTerms')}{' '}
              <a
                href="https://inkmanager.app/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-fg-secondary"
              >
                {t('common.privacyPolicy')}
              </a>{' '}
              {t('common.and')}{' '}
              <a
                href="https://inkmanager.app/terms"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-fg-secondary"
              >
                {t('common.terms')}
              </a>
              .
            </p>
          </div>
        )
      case 'referralSource':
        return (
          <div>
            <label className={LABEL_CLASS}>
              {field.label}
              {asterisk}
            </label>
            <select value={channel} onChange={(e) => setChannel(e.target.value)} required={field.required} className={INPUT_CLASS}>
              <option value="" disabled>
                {t('intake.selectOne')}
              </option>
              <option value="EMAIL">{t('intake.referralSourceEmail')}</option>
              <option value="INSTAGRAM">{t('intake.referralSourceInstagram')}</option>
              <option value="FACEBOOK">{t('intake.referralSourceFacebook')}</option>
              {referralProgramEnabled && <option value="REFERRAL">{t('intake.referralSourceFriend')}</option>}
            </select>
            <AnimatePresence initial={false}>
              {channel === 'REFERRAL' && referralProgramEnabled && (
                <motion.div
                  key="referral-code"
                  variants={crossfadeVariants}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  transition={uiSpringTransition}
                  className="mt-2 rounded-lg border border-accent/30 bg-accent/5 p-3"
                >
                  <label className={LABEL_CLASS}>{t('intake.friendReferralCode')}</label>
                  <input
                    type="text"
                    value={referralCode}
                    onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
                    required
                    placeholder={t('intake.friendReferralCodePlaceholder')}
                    className={INPUT_CLASS}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )
      case 'description':
        return (
          <div>
            <label className={LABEL_CLASS}>
              {field.label}
              {asterisk}
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required={field.required}
              rows={4}
              className={INPUT_CLASS}
            />
          </div>
        )
      case 'colorOrBlackGrey':
        return (
          <div>
            <span className={LABEL_CLASS}>
              {field.label}
              {asterisk}
            </span>
            <div className="mt-2 flex gap-4">
              {[t('intake.colorOption'), t('intake.blackAndGreyOption')].map((option) => (
                <label key={option} className="flex items-center gap-2 text-sm text-fg-secondary">
                  <input
                    type="radio"
                    name="colorOrBlackGrey"
                    value={option}
                    checked={colorOrBlackGrey === option}
                    onChange={(e) => setColorOrBlackGrey(e.target.value)}
                    required={field.required}
                    className="accent-accent"
                  />
                  {option}
                </label>
              ))}
            </div>
          </div>
        )
      case 'placement':
        return (
          <div>
            <label className={LABEL_CLASS}>
              {field.label}
              {asterisk}
            </label>
            <input
              type="text"
              placeholder={t('intake.placementPlaceholder')}
              value={placement}
              onChange={(e) => setPlacement(e.target.value)}
              required={field.required}
              className={INPUT_CLASS}
            />
          </div>
        )
      case 'size':
        return (
          <div>
            <label className={LABEL_CLASS}>
              {field.label}
              {asterisk}
            </label>
            <input
              type="text"
              placeholder={t('intake.sizePlaceholder')}
              value={estimatedSize}
              onChange={(e) => setEstimatedSize(e.target.value)}
              required={field.required}
              className={INPUT_CLASS}
            />
          </div>
        )
      case 'hasBeenTattooedBefore':
        return (
          <div>
            <span className={LABEL_CLASS}>
              {field.label}
              {asterisk}
            </span>
            <div className="mt-2 flex gap-4">
              {[
                { value: 'yes', label: t('intake.yesOption') },
                { value: 'no', label: t('intake.noOption') },
              ].map((option) => (
                <label key={option.value} className="flex items-center gap-2 text-sm text-fg-secondary">
                  <input
                    type="radio"
                    name="hasBeenTattooedBefore"
                    value={option.value}
                    checked={hasBeenTattooedBefore === option.value}
                    onChange={(e) => setHasBeenTattooedBefore(e.target.value)}
                    required={field.required}
                    className="accent-accent"
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </div>
        )
      case 'preferredArtist':
        return (
          <div>
            <label className={LABEL_CLASS}>{field.label}</label>
            <select value={preferredArtistId} onChange={(e) => setPreferredArtistId(e.target.value)} className={INPUT_CLASS}>
              <option value="">{t('intake.noPreference')}</option>
              {artists.map((artist) => (
                <option key={artist.id} value={artist.id}>
                  {artist.name}
                </option>
              ))}
            </select>
          </div>
        )
      case 'budget':
        return (
          <div>
            <label className={LABEL_CLASS}>{field.label}</label>
            <CurrencyInput value={budget} onChange={setBudget} placeholder="$0" className={INPUT_CLASS} />
          </div>
        )
      case 'desiredTiming':
        return (
          <div>
            <label className={LABEL_CLASS}>{field.label}</label>
            <input
              type="text"
              placeholder={t('intake.timingPlaceholder')}
              value={desiredTiming}
              onChange={(e) => setDesiredTiming(e.target.value)}
              className={INPUT_CLASS}
            />
          </div>
        )
      case 'referenceImages':
        return (
          <ImageUploadSection
            label={`${field.label}${asterisk}`}
            hint={field.helpText || t('intake.referenceImagesHint')}
            onChange={setReferenceImages}
          />
        )
      case 'placementImages':
        return (
          <ImageUploadSection
            label={`${field.label}${asterisk}`}
            hint={field.helpText || t('intake.placementPhotoHint')}
            onChange={setPlacementImages}
          />
        )
      default:
        return null
    }
  }

  function renderCustomField(field: IntakeFormFieldPublic) {
    const asterisk = field.required ? ' *' : ''
    const value = customAnswers[field.id]

    if (field.customQuestionType === 'PHOTO_UPLOAD') {
      return (
        <ImageUploadSection
          label={`${field.label}${asterisk}`}
          hint={field.helpText || ''}
          onChange={(state) => handleCustomPhotoUploadChange(field.id, state)}
        />
      )
    }

    return (
      <div>
        <label className={LABEL_CLASS}>
          {field.label}
          {asterisk}
        </label>
        {field.helpText && <p className="mt-0.5 text-xs text-fg-muted">{field.helpText}</p>}

        {field.customQuestionType === 'TEXT' && (
          <input
            type="text"
            value={(value as string) ?? ''}
            onChange={(e) => setCustomAnswer(field.id, e.target.value)}
            required={field.required}
            className={INPUT_CLASS}
          />
        )}

        {field.customQuestionType === 'PARAGRAPH' && (
          <textarea
            value={(value as string) ?? ''}
            onChange={(e) => setCustomAnswer(field.id, e.target.value)}
            required={field.required}
            rows={3}
            className={INPUT_CLASS}
          />
        )}

        {field.customQuestionType === 'NUMBER' && (
          <input
            type="number"
            value={(value as string) ?? ''}
            onChange={(e) => setCustomAnswer(field.id, e.target.value)}
            required={field.required}
            className={INPUT_CLASS}
          />
        )}

        {field.customQuestionType === 'DATE' && (
          <input
            type="date"
            value={(value as string) ?? ''}
            onChange={(e) => setCustomAnswer(field.id, e.target.value)}
            required={field.required}
            className={INPUT_CLASS}
          />
        )}

        {field.customQuestionType === 'YES_NO' && (
          <div className="mt-2 flex gap-4">
            {(['YES', 'NO'] as const).map((option) => (
              <label key={option} className="flex items-center gap-2 text-sm text-fg-secondary">
                <input
                  type="radio"
                  name={`custom-${field.id}`}
                  checked={value === option}
                  onChange={() => setCustomAnswer(field.id, option)}
                  required={field.required}
                  className="accent-accent"
                />
                {option === 'YES' ? t('intake.yesOption') : t('intake.noOption')}
              </label>
            ))}
          </div>
        )}

        {field.customQuestionType === 'SELECT' && (
          <select
            value={(value as string) ?? ''}
            onChange={(e) => setCustomAnswer(field.id, e.target.value)}
            required={field.required}
            className={INPUT_CLASS}
          >
            <option value="" disabled>
              {t('intake.selectOne')}
            </option>
            {(field.options ?? []).map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        )}

        {field.customQuestionType === 'MULTI_SELECT' && (
          <div className="mt-2 space-y-1">
            {(field.options ?? []).map((option) => {
              const selected = Array.isArray(value) ? value : []
              return (
                <label key={option} className="flex items-center gap-2 text-sm text-fg-secondary">
                  <input
                    type="checkbox"
                    checked={selected.includes(option)}
                    onChange={(e) => {
                      const next = e.target.checked ? [...selected, option] : selected.filter((o) => o !== option)
                      setCustomAnswer(field.id, next)
                    }}
                    className="accent-accent"
                  />
                  {option}
                </label>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  if (!studioSlug || studioCheck === 'invalid') {
    return (
      <div className="login-shell flex min-h-screen items-center justify-center px-4 py-10 text-fg">
        <div className="login-panel-surface w-full max-w-lg px-4 py-8 text-center sm:p-8">
          <div className="mb-4 flex justify-end">
            <LanguagePicker />
          </div>
          <AnimatePresence mode="wait">
            <motion.div key="invalid" variants={crossfadeVariants} initial="initial" animate="animate" exit="exit" transition={uiSpringTransition}>
              <h1 className="login-jura text-xl font-semibold text-fg">{t('intake.studioNotFoundHeading')}</h1>
              <p className="mt-2 text-sm text-fg-secondary">{t('intake.studioNotFoundBody')}</p>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    )
  }

  // Deliberately NOT the "we couldn't find this studio" screen above. The
  // link is fine; we are the problem. Says so, and offers a retry -- the
  // failure this replaces is usually over in seconds.
  if (studioCheck === 'unavailable') {
    return (
      <div className="login-shell flex min-h-screen items-center justify-center px-4 py-10 text-fg">
        <div className="login-panel-surface w-full max-w-lg px-4 py-8 text-center sm:p-8">
          <div className="mb-4 flex justify-end">
            <LanguagePicker />
          </div>
          <AnimatePresence mode="wait">
            <motion.div key="unavailable" variants={crossfadeVariants} initial="initial" animate="animate" exit="exit" transition={uiSpringTransition}>
              <h1 className="login-jura text-xl font-semibold text-fg">{t('common.temporarilyUnavailableHeading')}</h1>
              <p className="mt-2 text-sm text-fg-secondary">{t('common.temporarilyUnavailableBody')}</p>
              <button
                type="button"
                onClick={() => {
                  setStudioCheck('loading')
                  setRetryNonce((n) => n + 1)
                }}
                className="mt-5 rounded-full bg-accent px-5 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover"
              >
                {t('common.tryAgain')}
              </button>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    )
  }

  if (studioCheck === 'loading') {
    return (
      <div className="login-shell flex min-h-screen items-center justify-center px-4 py-10 text-fg">
        <p className="text-sm text-fg-secondary">{t('common.loading')}</p>
      </div>
    )
  }

  if (submitted) {
    return (
      <div className="login-shell flex min-h-screen items-center justify-center px-4 py-10 text-fg">
        <div className="login-panel-surface w-full max-w-lg px-4 py-8 text-center sm:p-8">
          <AnimatePresence mode="wait">
            <motion.div key="submitted" variants={crossfadeVariants} initial="initial" animate="animate" exit="exit" transition={uiSpringTransition}>
              <h1 className="login-jura text-xl font-semibold text-fg">{t('intake.submittedHeading')}</h1>
              <p className="mt-2 text-sm text-fg-secondary">{t('intake.submittedBody')}</p>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    )
  }

  return (
    <div className="login-shell flex min-h-screen items-center justify-center px-4 py-10 text-fg">
      <div className="login-panel-surface w-full max-w-2xl px-4 py-8 sm:p-8">
        <div className="mb-4 flex justify-end">
          <LanguagePicker />
        </div>

        <AnimatePresence mode="wait">
          <motion.div key="form" variants={crossfadeVariants} initial="initial" animate="animate" exit="exit" transition={uiSpringTransition}>
            {studioLogoUrl && (
              <img src={studioLogoUrl} alt={studioName} className="mb-4 h-10 w-auto object-contain" />
            )}
            <h1 className="login-jura text-xl font-semibold text-fg">{t('intake.pageHeading')}</h1>
            <p className="mt-1 text-sm text-fg-secondary">{t('intake.intro')}</p>

            <div className="mt-4 rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
              {t('intake.ageDisclosure')}
            </div>

            <form onSubmit={handleSubmit} className="mt-6 space-y-5">
              {/* Package Q (revised): exact studio-configured order, system and
                  custom fields freely mixed -- no fixed section boundaries, so a
                  studio that drags "email" below a custom question sees that
                  order on the live form, not just in the builder. */}
              {fields.map((field) => (
                <div key={field.id}>{field.fieldKind === 'SYSTEM' ? renderSystemField(field) : renderCustomField(field)}</div>
              ))}

              <div>
                <label className="flex items-start gap-2 text-sm text-fg-secondary">
                  <input
                    type="checkbox"
                    checked={smsConsent}
                    onChange={(e) => setSmsConsent(e.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
                  />
                  <span>
                    {t('intake.smsOptInBody', { studioName: studioName || t('intake.smsOptInDefaultStudioName') })}{' '}
                    {t('intake.viewOurPrivacyAndTerms')}{' '}
                    <a
                      href="https://inkmanager.app/privacy"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-fg"
                    >
                      {t('common.privacyPolicy')}
                    </a>{' '}
                    {t('common.and')}{' '}
                    <a
                      href="https://inkmanager.app/terms"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-fg"
                    >
                      {t('common.terms')}
                    </a>
                    .
                  </span>
                </label>
              </div>

              {submitError && (
                <div className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                  {submitError}
                </div>
              )}

              <button
                type="submit"
                disabled={submitting || imagesUploading}
                className="w-full rounded-full bg-accent px-4 py-2 text-sm font-medium text-bg transition hover:bg-accent-hover disabled:opacity-60"
              >
                {submitting ? t('intake.submitting') : t('intake.submitInquiry')}
              </button>
            </form>
          </motion.div>
        </AnimatePresence>

        <PublicPageFooter studioSlug={studioSlug} />
      </div>
    </div>
  )
}
