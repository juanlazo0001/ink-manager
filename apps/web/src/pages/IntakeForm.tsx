import { useEffect, useRef, useState } from 'react'
import { apiFetch, ApiError } from '../lib/api'
import { uploadImageToCloudinary } from '../lib/cloudinary'

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
      <label className="block text-sm font-medium text-gray-700">{label}</label>
      <p className="mt-0.5 text-xs text-gray-500">{hint}</p>

      <input
        type="file"
        accept="image/*"
        multiple
        onChange={(e) => {
          handleFiles(e.target.files)
          e.target.value = ''
        }}
        className="mt-2 block w-full text-sm text-gray-700 file:mr-3 file:rounded-full file:border-0 file:bg-gray-900 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-gray-800"
      />

      {items.length > 0 && (
        <div className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-4">
          {items.map((item) => (
            <div key={item.id} className="relative aspect-square overflow-hidden rounded-lg border border-gray-200">
              <img src={item.previewUrl} alt="" className="h-full w-full object-cover" />
              {item.status === 'uploading' && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-xs text-white">
                  Uploading…
                </div>
              )}
              {item.status === 'error' && (
                <div className="absolute inset-0 flex items-center justify-center bg-red-900/70 p-1 text-center text-[10px] text-white">
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

export default function IntakeForm() {
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

  const [artists, setArtists] = useState<PublicArtist[]>([])
  const [referenceImages, setReferenceImages] = useState<ImageUploadState>({ urls: [], uploading: false })
  const [placementImages, setPlacementImages] = useState<ImageUploadState>({ urls: [], uploading: false })

  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)

  useEffect(() => {
    let ignore = false

    apiFetch<PublicArtist[]>('/artists/public')
      .then((data) => {
        if (!ignore) setArtists(data)
      })
      .catch(() => {
        // Preferred-artist dropdown is a nice-to-have; if it fails to load,
        // the form still works with "No preference" as the only option.
      })

    return () => {
      ignore = true
    }
  }, [])

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

  if (submitted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-10">
        <div className="w-full max-w-lg rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
          <h1 className="text-xl font-semibold text-gray-900">Thanks — your inquiry is in!</h1>
          <p className="mt-2 text-sm text-gray-500">
            We've received your submission and someone from the studio will reach out soon.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-10">
      <div className="w-full max-w-2xl rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-gray-900">Tattoo Inquiry</h1>
        <p className="mt-1 text-sm text-gray-500">Tell us about the tattoo you have in mind.</p>

        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          You must be 18 years or older to receive a tattoo. Submitting this form does not confirm an appointment —
          it starts a conversation with the studio.
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-gray-700">First name *</label>
              <input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Last name *</label>
              <input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                required
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-gray-700">Email *</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Phone</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
              />
              <p className="mt-1 text-[11px] leading-snug text-gray-500">
                By providing your phone number, you consent to receive SMS messages about your inquiry and
                appointment. Message and data rates may apply. Reply STOP to opt out.
              </p>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">How did you hear about us? *</label>
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
              required
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
            >
              <option value="" disabled>
                Select one
              </option>
              <option value="EMAIL">Email</option>
              <option value="INSTAGRAM">Instagram</option>
              <option value="FACEBOOK">Facebook</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Describe the tattoo you want *</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
              rows={4}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
            />
          </div>

          <div>
            <span className="block text-sm font-medium text-gray-700">Color or Black &amp; Grey? *</span>
            <div className="mt-2 flex gap-4">
              {['Color', 'Black & Grey'].map((option) => (
                <label key={option} className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="radio"
                    name="colorOrBlackGrey"
                    value={option}
                    checked={colorOrBlackGrey === option}
                    onChange={(e) => setColorOrBlackGrey(e.target.value)}
                    required
                  />
                  {option}
                </label>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-gray-700">Placement *</label>
              <input
                type="text"
                placeholder="e.g. forearm, left side"
                value={placement}
                onChange={(e) => setPlacement(e.target.value)}
                required
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Estimated size *</label>
              <input
                type="text"
                placeholder="e.g. palm-sized"
                value={estimatedSize}
                onChange={(e) => setEstimatedSize(e.target.value)}
                required
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
              />
            </div>
          </div>

          <div>
            <span className="block text-sm font-medium text-gray-700">Have you been tattooed before? *</span>
            <div className="mt-2 flex gap-4">
              {[
                { value: 'yes', label: 'Yes' },
                { value: 'no', label: 'No' },
              ].map((option) => (
                <label key={option.value} className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="radio"
                    name="hasBeenTattooedBefore"
                    value={option.value}
                    checked={hasBeenTattooedBefore === option.value}
                    onChange={(e) => setHasBeenTattooedBefore(e.target.value)}
                    required
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Preferred artist</label>
            <select
              value={preferredArtistId}
              onChange={(e) => setPreferredArtistId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
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
              <label className="block text-sm font-medium text-gray-700">Budget</label>
              <input
                type="text"
                placeholder="e.g. $300-500"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Desired timing</label>
              <input
                type="text"
                placeholder="e.g. within a month"
                value={desiredTiming}
                onChange={(e) => setDesiredTiming(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
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

          {submitError && <p className="text-sm text-red-600">{submitError}</p>}

          <button
            type="submit"
            disabled={submitting || imagesUploading}
            className="w-full rounded-full bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-800 disabled:opacity-60"
          >
            {submitting ? 'Submitting…' : 'Submit inquiry'}
          </button>
        </form>
      </div>
    </div>
  )
}
