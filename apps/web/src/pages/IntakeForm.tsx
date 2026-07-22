import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { apiFetch, ApiError } from '../lib/api'
import PhoneInput from '../components/PhoneInput'
import ImageUploadSection, { type ImageUploadState } from '../components/ImageUploadSection'
import PublicPageFooter from '../components/PublicPageFooter'
import { isValidPhoneDigits } from '../lib/format'
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
  const [description, setDescription] = useState('')
  const [colorOrBlackGrey, setColorOrBlackGrey] = useState('')
  const [placement, setPlacement] = useState('')
  const [estimatedSize, setEstimatedSize] = useState('')
  const [hasBeenTattooedBefore, setHasBeenTattooedBefore] = useState('')
  const [budget, setBudget] = useState('')
  const [desiredTiming, setDesiredTiming] = useState('')
  const [preferredArtistId, setPreferredArtistId] = useState('')
  // Unchecked by default, deliberately -- a pre-checked box is not valid
  // A2P 10DLC opt-in consent.
  const [smsConsent, setSmsConsent] = useState(false)
  const [smsConsentError, setSmsConsentError] = useState(false)

  const [studioCheck, setStudioCheck] = useState<StudioCheck>('loading')
  const [studioName, setStudioName] = useState('')
  const [artists, setArtists] = useState<PublicArtist[]>([])
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

  // Studio display name for the consent checkbox label -- same public
  // endpoint the /privacy and /terms pages read from, just the name field.
  useEffect(() => {
    if (!studioSlug) return

    let ignore = false

    apiFetch<{ studioName: string }>(`/studio-settings/public?studioSlug=${encodeURIComponent(studioSlug)}`)
      .then((data) => {
        if (!ignore) setStudioName(data.studioName)
      })
      .catch(() => {
        // Non-essential -- the checkbox label falls back to generic wording.
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
        if (payload.budget) setBudget(payload.budget)
        if (payload.desiredTiming) setDesiredTiming(payload.desiredTiming)
      })
      .catch(() => {
        // Invalid/expired/used token -- form just loads empty.
      })

    return () => {
      ignore = true
    }
  }, [draftToken])

  const imagesUploading = referenceImages.uploading || placementImages.uploading

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitError(null)
    setSmsConsentError(false)

    if (
      !firstName ||
      !lastName ||
      !email ||
      !channel ||
      !description ||
      !colorOrBlackGrey ||
      !placement ||
      !estimatedSize ||
      !hasBeenTattooedBefore
    ) {
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
          channel,
          description,
          colorOrBlackGrey,
          placement,
          estimatedSize,
          hasBeenTattooedBefore: hasBeenTattooedBefore === 'yes',
          budget: budget || undefined,
          desiredTiming: desiredTiming || undefined,
          preferredArtistId: preferredArtistId || undefined,
          referenceImages: referenceImages.urls,
          placementImages: placementImages.urls,
          draftToken: draftToken || undefined,
          smsConsent,
        }),
      })

      setSubmitted(true)
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
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
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={LABEL_CLASS}>First name *</label>
              <input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label className={LABEL_CLASS}>Last name *</label>
              <input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                required
                className={INPUT_CLASS}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={LABEL_CLASS}>Email *</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label className={LABEL_CLASS}>Phone</label>
              <PhoneInput value={phone} onChange={setPhone} className={INPUT_CLASS} />
              <p className="mt-1 text-[11px] leading-snug text-fg-muted">
                By providing your phone number, you consent to receive SMS messages about your inquiry and
                appointment. Message and data rates may apply. Reply STOP to opt out.
              </p>
            </div>
          </div>

          <div>
            <label className={LABEL_CLASS}>How did you hear about us? *</label>
            <select value={channel} onChange={(e) => setChannel(e.target.value)} required className={INPUT_CLASS}>
              <option value="" disabled>
                Select one
              </option>
              <option value="EMAIL">Email</option>
              <option value="INSTAGRAM">Instagram</option>
              <option value="FACEBOOK">Facebook</option>
            </select>
          </div>

          <div>
            <label className={LABEL_CLASS}>Describe the tattoo you want *</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
              rows={4}
              className={INPUT_CLASS}
            />
          </div>

          <div>
            <span className={LABEL_CLASS}>Color or Black &amp; Grey? *</span>
            <div className="mt-2 flex gap-4">
              {['Color', 'Black & Grey'].map((option) => (
                <label key={option} className="flex items-center gap-2 text-sm text-fg-secondary">
                  <input
                    type="radio"
                    name="colorOrBlackGrey"
                    value={option}
                    checked={colorOrBlackGrey === option}
                    onChange={(e) => setColorOrBlackGrey(e.target.value)}
                    required
                    className="accent-accent"
                  />
                  {option}
                </label>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={LABEL_CLASS}>Placement *</label>
              <input
                type="text"
                placeholder="e.g. forearm, left side"
                value={placement}
                onChange={(e) => setPlacement(e.target.value)}
                required
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label className={LABEL_CLASS}>Estimated size *</label>
              <input
                type="text"
                placeholder="e.g. palm-sized"
                value={estimatedSize}
                onChange={(e) => setEstimatedSize(e.target.value)}
                required
                className={INPUT_CLASS}
              />
            </div>
          </div>

          <div>
            <span className={LABEL_CLASS}>Have you been tattooed before? *</span>
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
                    required
                    className="accent-accent"
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className={LABEL_CLASS}>Preferred artist</label>
            <select
              value={preferredArtistId}
              onChange={(e) => setPreferredArtistId(e.target.value)}
              className={INPUT_CLASS}
            >
              <option value="">No preference</option>
              {artists.map((artist) => (
                <option key={artist.id} value={artist.id}>
                  {artist.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={LABEL_CLASS}>Budget</label>
              <input
                type="text"
                placeholder="e.g. $300-500"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label className={LABEL_CLASS}>Desired timing</label>
              <input
                type="text"
                placeholder="e.g. within a month"
                value={desiredTiming}
                onChange={(e) => setDesiredTiming(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
          </div>

          <ImageUploadSection
            label="Reference images"
            hint="Photos or designs that show the style you're going for."
            onChange={setReferenceImages}
          />

          <ImageUploadSection
            label="Placement photos"
            hint="A photo of the area where you want the tattoo."
            onChange={setPlacementImages}
          />

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
