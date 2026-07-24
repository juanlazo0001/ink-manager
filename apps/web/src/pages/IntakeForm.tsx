import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { apiFetch, ApiError } from '../lib/api'
import PhoneInput from '../components/PhoneInput'
import CurrencyInput from '../components/CurrencyInput'
import ImageUploadSection, { type ImageUploadState } from '../components/ImageUploadSection'
import PublicPageFooter from '../components/PublicPageFooter'
import { isValidPhoneDigits } from '../lib/format'
import { formatCurrencyInput } from '../lib/money'
import { applyThemePreset } from '../lib/themePresets'

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

type StudioCheck = 'loading' | 'valid' | 'invalid'

export default function IntakeForm() {
  const { studioSlug } = useParams<{ studioSlug: string }>()
  const [searchParams] = useSearchParams()
  const draftToken = searchParams.get('draft')

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
  const [smsConsent, setSmsConsent] = useState(false)
  const [smsConsentError, setSmsConsentError] = useState(false)

  const [studioCheck, setStudioCheck] = useState<StudioCheck>('loading')
  const [studioName, setStudioName] = useState('')
  const [artists, setArtists] = useState<PublicArtist[]>([])
  const [fields, setFields] = useState<IntakeFormFieldPublic[]>([])
  const [customAnswers, setCustomAnswers] = useState<Record<string, CustomAnswerValue>>({})
  const [customImageUploading, setCustomImageUploading] = useState<Record<string, boolean>>({})
  const [referenceImages, setReferenceImages] = useState<ImageUploadState>({ urls: [], uploading: false })
  const [placementImages, setPlacementImages] = useState<ImageUploadState>({ urls: [], uploading: false })

  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)

  // Package C2: public, unauthenticated pages apply the studio's theme
  // preset independently from the authenticated app shell (ThemeApplier)
  // -- a small dedicated GET /theme?studioSlug= rather than piggybacking
  // on this page's own /artists/public response, so a failure/hiccup in
  // one doesn't affect the other.
  useEffect(() => {
    if (!studioSlug) return
    apiFetch<{ themePreset: string }>(`/theme?studioSlug=${encodeURIComponent(studioSlug)}`)
      .then((data) => applyThemePreset(data.themePreset))
      .catch(() => {
        /* Falls back to index.css's own onyx-lime default -- not critical. */
      })
  }, [studioSlug])

  useEffect(() => {
    if (!studioSlug) return

    let ignore = false

    apiFetch<PublicArtist[]>(`/artists/public?studioSlug=${encodeURIComponent(studioSlug)}`)
      .then((data) => {
        if (ignore) return
        setArtists(data)
        setStudioCheck('valid')
      })
      .catch((err) => {
        if (ignore) return

        if (err instanceof ApiError && err.status === 404) {
          setStudioCheck('invalid')
          return
        }

        // Preferred-artist dropdown is a nice-to-have; a non-404 hiccup
        // shouldn't block the form, just leave it with "No preference" only.
        setStudioCheck('valid')
      })

    return () => {
      ignore = true
    }
  }, [studioSlug])

  // Studio display name (for the consent checkbox label) and the studio's
  // own configured field list -- same public endpoint the /privacy and
  // /terms pages read from.
  useEffect(() => {
    if (!studioSlug) return

    let ignore = false

    apiFetch<{ studioName: string; intakeFormFields: IntakeFormFieldPublic[] }>(
      `/studio-settings/public?studioSlug=${encodeURIComponent(studioSlug)}`,
    )
      .then((data) => {
        if (ignore) return
        setStudioName(data.studioName)
        setFields((data.intakeFormFields ?? []).slice().sort((a, b) => a.order - b.order))
      })
      .catch(() => {
        // Non-essential -- the checkbox label falls back to generic wording,
        // and an empty field list just renders nothing above the consent
        // checkbox rather than blocking the page.
      })

    return () => {
      ignore = true
    }
  }, [studioSlug])

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
    setSmsConsentError(false)

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
      setSubmitError('Please fill out all required fields.')
      return
    }

    if (!isValidPhoneDigits(phone)) {
      setSubmitError('Enter a complete 10-digit phone number, or leave it blank.')
      return
    }

    if (imagesUploading) {
      setSubmitError('Please wait for your photos to finish uploading.')
      return
    }

    if (isRequired('referenceImages') && referenceImages.urls.length === 0) {
      setSubmitError('Please add at least one reference image.')
      return
    }

    if (isRequired('placementImages') && placementImages.urls.length === 0) {
      setSubmitError('Please add at least one placement photo.')
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
      setSubmitError(`Please answer: ${missingCustomField.label}`)
      return
    }

    if (!smsConsent) {
      setSmsConsentError(true)
      return
    }

    setSubmitting(true)

    try {
      await apiFetch('/inquiries', {
        method: 'POST',
        body: JSON.stringify({
          studioSlug,
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
          referenceImages: referenceImages.urls,
          placementImages: placementImages.urls,
          draftToken: draftToken || undefined,
          smsConsent,
          customFieldAnswers: Object.keys(customAnswers).length > 0 ? customAnswers : undefined,
        }),
      })

      setSubmitted(true)
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
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
              <label className={LABEL_CLASS}>First name{asterisk}</label>
              <input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required={field.required}
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label className={LABEL_CLASS}>Last name{asterisk}</label>
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
            <p className="mt-1 text-[11px] leading-snug text-fg-muted">
              {field.helpText ||
                'By providing your phone number, you consent to receive SMS messages about your inquiry and appointment. Message and data rates may apply. Reply STOP to opt out.'}
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
                Select one
              </option>
              <option value="EMAIL">Email</option>
              <option value="INSTAGRAM">Instagram</option>
              <option value="FACEBOOK">Facebook</option>
              <option value="REFERRAL">A friend referred me</option>
            </select>
            {channel === 'REFERRAL' && (
              <div className="mt-2">
                <label className={LABEL_CLASS}>Friend's referral code *</label>
                <input
                  type="text"
                  value={referralCode}
                  onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
                  required
                  placeholder="e.g. AB23CDE"
                  className={INPUT_CLASS}
                />
              </div>
            )}
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
              {['Color', 'Black & Grey'].map((option) => (
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
              placeholder="e.g. forearm, left side"
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
              placeholder="e.g. palm-sized"
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
                { value: 'yes', label: 'Yes' },
                { value: 'no', label: 'No' },
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
              <option value="">No preference</option>
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
              placeholder="e.g. within a month"
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
            hint={field.helpText || "Photos or designs that show the style you're going for."}
            onChange={setReferenceImages}
          />
        )
      case 'placementImages':
        return (
          <ImageUploadSection
            label={`${field.label}${asterisk}`}
            hint={field.helpText || 'A photo of the area where you want the tattoo.'}
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
                {option === 'YES' ? 'Yes' : 'No'}
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
              Select one
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
      <div className="flex min-h-screen items-center justify-center bg-bg px-4 py-10 text-fg">
        <div className="w-full max-w-lg rounded-2xl border border-border bg-surface p-8 text-center">
          <h1 className="text-xl font-semibold text-fg">We couldn't find this studio</h1>
          <p className="mt-2 text-sm text-fg-secondary">
            Please double-check the link you were given, or contact the studio directly.
          </p>
        </div>
      </div>
    )
  }

  if (studioCheck === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg px-4 py-10 text-fg">
        <p className="text-sm text-fg-secondary">Loading…</p>
      </div>
    )
  }

  if (submitted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg px-4 py-10 text-fg">
        <div className="w-full max-w-lg rounded-2xl border border-border bg-surface p-8 text-center">
          <h1 className="text-xl font-semibold text-fg">Thanks — your inquiry is in!</h1>
          <p className="mt-2 text-sm text-fg-secondary">
            We've received your submission and someone from the studio will reach out soon.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4 py-10 text-fg">
      <div className="w-full max-w-2xl rounded-2xl border border-border bg-surface p-8">
        <h1 className="text-2xl font-bold text-fg">Tattoo Inquiry</h1>
        <p className="mt-1 text-sm text-fg-secondary">Tell us about the tattoo you have in mind.</p>

        <div className="mt-4 rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
          You must be 18 years or older to receive a tattoo. Submitting this form does not confirm an appointment —
          it starts a conversation with the studio.
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
                onChange={(e) => {
                  setSmsConsent(e.target.checked)
                  if (e.target.checked) setSmsConsentError(false)
                }}
                className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
              />
              <span>
                I agree to receive text messages from {studioName || 'the studio'} regarding my appointment,
                including reminders and updates. Message and data rates may apply. Reply STOP to opt out. View our{' '}
                <Link
                  to={`/privacy/${studioSlug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-fg"
                >
                  Privacy Policy
                </Link>{' '}
                and{' '}
                <Link
                  to={`/terms/${studioSlug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-fg"
                >
                  Terms
                </Link>
                .
              </span>
            </label>
            {smsConsentError && (
              <p className="mt-1 text-xs text-danger">Please agree to receive text messages to submit this form.</p>
            )}
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
            {submitting ? 'Submitting…' : 'Submit inquiry'}
          </button>
        </form>

        <PublicPageFooter studioSlug={studioSlug} />
      </div>
    </div>
  )
}
