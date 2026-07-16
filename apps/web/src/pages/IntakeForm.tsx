import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { apiFetch, ApiError } from '../lib/api'
import { uploadImageToCloudinary } from '../lib/cloudinary'

const INPUT_CLASS =
  'mt-1 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600'
const LABEL_CLASS = 'block text-sm font-medium text-neutral-300'

interface PublicArtist {
  id: string
  name: string
}

interface ImageUploadState {
  urls: string[]
  uploading: boolean
}

interface UploadItem {
  id: string
  file: File
  previewUrl: string
  status: 'uploading' | 'done' | 'error'
  url?: string
  error?: string
}

function ImageUploadSection({
  label,
  hint,
  onChange,
}: {
  label: string
  hint: string
  onChange: (state: ImageUploadState) => void
}) {
  const [items, setItems] = useState<UploadItem[]>([])
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    onChangeRef.current({
      urls: items.filter((item) => item.status === 'done').map((item) => item.url as string),
      uploading: items.some((item) => item.status === 'uploading'),
    })
  }, [items])

  async function uploadOne(item: UploadItem) {
    try {
      const url = await uploadImageToCloudinary(item.file)
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: 'done', url } : i)))
    } catch (err) {
      setItems((prev) =>
        prev.map((i) =>
          i.id === item.id
            ? { ...i, status: 'error', error: err instanceof Error ? err.message : 'Upload failed' }
            : i,
        ),
      )
    }
  }

  function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return

    const newItems: UploadItem[] = Array.from(fileList).map((file) => ({
      id: crypto.randomUUID(),
      file,
      previewUrl: URL.createObjectURL(file),
      status: 'uploading',
    }))

    setItems((prev) => [...prev, ...newItems])
    newItems.forEach(uploadOne)
  }

  function handleRemove(id: string) {
    setItems((prev) => {
      const item = prev.find((i) => i.id === id)
      if (item) URL.revokeObjectURL(item.previewUrl)
      return prev.filter((i) => i.id !== id)
    })
  }

  return (
    <div>
      <label className={LABEL_CLASS}>{label}</label>
      <p className="mt-0.5 text-xs text-neutral-500">{hint}</p>

      <input
        type="file"
        accept="image/*"
        multiple
        onChange={(e) => {
          handleFiles(e.target.files)
          e.target.value = ''
        }}
        className="mt-2 block w-full text-sm text-neutral-400 file:mr-3 file:rounded-full file:border file:border-neutral-700 file:bg-neutral-700 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-neutral-600"
      />

      {items.length > 0 && (
        <div className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-4">
          {items.map((item) => (
            <div key={item.id} className="relative aspect-square overflow-hidden rounded-lg border border-neutral-800">
              <img src={item.previewUrl} alt="" className="h-full w-full object-cover" />
              {item.status === 'uploading' && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-xs text-white">
                  Uploading…
                </div>
              )}
              {item.status === 'error' && (
                <div className="absolute inset-0 flex items-center justify-center bg-red-950/80 p-1 text-center text-[10px] text-red-300">
                  {item.error ?? 'Upload failed'}
                </div>
              )}
              <button
                type="button"
                onClick={() => handleRemove(item.id)}
                className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-xs text-white hover:bg-black/80"
                aria-label="Remove image"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

type StudioCheck = 'loading' | 'valid' | 'invalid'

export default function IntakeForm() {
  const { studioSlug } = useParams<{ studioSlug: string }>()

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

  const [studioCheck, setStudioCheck] = useState<StudioCheck>('loading')
  const [artists, setArtists] = useState<PublicArtist[]>([])
  const [referenceImages, setReferenceImages] = useState<ImageUploadState>({ urls: [], uploading: false })
  const [placementImages, setPlacementImages] = useState<ImageUploadState>({ urls: [], uploading: false })

  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)

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

  const imagesUploading = referenceImages.uploading || placementImages.uploading

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitError(null)

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

    if (imagesUploading) {
      setSubmitError('Please wait for your photos to finish uploading.')
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
      <div className="flex min-h-screen items-center justify-center bg-neutral-900 px-4 py-10 text-white">
        <div className="w-full max-w-lg rounded-2xl border border-neutral-800 bg-neutral-900 p-8 text-center">
          <h1 className="text-xl font-semibold text-white">We couldn't find this studio</h1>
          <p className="mt-2 text-sm text-neutral-400">
            Please double-check the link you were given, or contact the studio directly.
          </p>
        </div>
      </div>
    )
  }

  if (studioCheck === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-900 px-4 py-10 text-white">
        <p className="text-sm text-neutral-400">Loading…</p>
      </div>
    )
  }

  if (submitted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-900 px-4 py-10 text-white">
        <div className="w-full max-w-lg rounded-2xl border border-neutral-800 bg-neutral-900 p-8 text-center">
          <h1 className="text-xl font-semibold text-white">Thanks — your inquiry is in!</h1>
          <p className="mt-2 text-sm text-neutral-400">
            We've received your submission and someone from the studio will reach out soon.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-900 px-4 py-10 text-white">
      <div className="w-full max-w-2xl rounded-2xl border border-neutral-800 bg-neutral-900 p-8">
        <h1 className="text-2xl font-bold text-white">Tattoo Inquiry</h1>
        <p className="mt-1 text-sm text-neutral-400">Tell us about the tattoo you have in mind.</p>

        <div className="mt-4 rounded-lg border border-amber-900/50 bg-amber-950/30 p-3 text-xs text-amber-300">
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
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={INPUT_CLASS} />
              <p className="mt-1 text-[11px] leading-snug text-neutral-500">
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
                <label key={option} className="flex items-center gap-2 text-sm text-neutral-300">
                  <input
                    type="radio"
                    name="colorOrBlackGrey"
                    value={option}
                    checked={colorOrBlackGrey === option}
                    onChange={(e) => setColorOrBlackGrey(e.target.value)}
                    required
                    className="accent-neutral-400"
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
                <label key={option.value} className="flex items-center gap-2 text-sm text-neutral-300">
                  <input
                    type="radio"
                    name="hasBeenTattooedBefore"
                    value={option.value}
                    checked={hasBeenTattooedBefore === option.value}
                    onChange={(e) => setHasBeenTattooedBefore(e.target.value)}
                    required
                    className="accent-neutral-400"
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

          {submitError && (
            <div className="rounded-lg border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-400">
              {submitError}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || imagesUploading}
            className="w-full rounded-full border border-neutral-700 bg-neutral-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-600 disabled:opacity-60"
          >
            {submitting ? 'Submitting…' : 'Submit inquiry'}
          </button>
        </form>
      </div>
    </div>
  )
}
