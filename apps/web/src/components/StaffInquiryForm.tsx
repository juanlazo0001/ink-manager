import { useEffect, useState } from 'react'
import { apiFetch, ApiError } from '../lib/api'
import { isValidPhoneDigits } from '../lib/format'
import Modal from './Modal'
import PhoneInput from './PhoneInput'
import ImageUploadSection, { type ImageUploadState } from './ImageUploadSection'
import ArtistSelect from './ArtistSelect'

const INPUT_CLASS =
  'mt-1 w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent'
const LABEL_CLASS = 'block text-sm font-medium text-fg-secondary'

interface StaffArtist {
  id: string
  user: { name: string | null; email: string; avatarUrl: string | null }
}

interface CreatedInquiry {
  id: string
}

interface StaffInquiryFormProps {
  onClose: () => void
  onCreated: (inquiryId: string) => void
}

// Staff-side counterpart to the public IntakeForm -- front desk fills this
// out on a walk-in or phone-call customer's behalf. Same required fields
// and validation as the public form, submitted to the same POST /inquiries
// (optionalAuth on that route attributes the create to this staff member
// and skips the studioSlug requirement since the JWT already carries it).
export default function StaffInquiryForm({ onClose, onCreated }: StaffInquiryFormProps) {
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [channel, setChannel] = useState('PHONE')
  const [description, setDescription] = useState('')
  const [colorOrBlackGrey, setColorOrBlackGrey] = useState('')
  const [placement, setPlacement] = useState('')
  const [estimatedSize, setEstimatedSize] = useState('')
  const [hasBeenTattooedBefore, setHasBeenTattooedBefore] = useState('')
  const [budget, setBudget] = useState('')
  const [desiredTiming, setDesiredTiming] = useState('')
  const [preferredArtistId, setPreferredArtistId] = useState('')

  const [artists, setArtists] = useState<StaffArtist[]>([])
  const [referenceImages, setReferenceImages] = useState<ImageUploadState>({ urls: [], uploading: false })
  const [placementImages, setPlacementImages] = useState<ImageUploadState>({ urls: [], uploading: false })

  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    let ignore = false

    apiFetch<StaffArtist[]>('/artists')
      .then((data) => {
        if (!ignore) setArtists(data)
      })
      .catch(() => {
        // Preferred-artist dropdown is a nice-to-have; leave it empty on failure.
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

    if (!isValidPhoneDigits(phone)) {
      setSubmitError('Enter a complete 10-digit phone number, or leave it blank.')
      return
    }

    if (imagesUploading) {
      setSubmitError('Please wait for photos to finish uploading.')
      return
    }

    if (referenceImages.urls.length === 0) {
      setSubmitError('Please add at least one reference image.')
      return
    }

    if (placementImages.urls.length === 0) {
      setSubmitError('Please add at least one placement photo.')
      return
    }

    setSubmitting(true)

    try {
      const inquiry = await apiFetch<CreatedInquiry>('/inquiries', {
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

      onCreated(inquiry.id)
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal title="New Inquiry" onClose={onClose}>
      <form onSubmit={handleSubmit} className="max-h-[70vh] space-y-5 overflow-y-auto pr-1">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={LABEL_CLASS}>First name *</label>
            <input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} required className={INPUT_CLASS} />
          </div>
          <div>
            <label className={LABEL_CLASS}>Last name *</label>
            <input type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} required className={INPUT_CLASS} />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={LABEL_CLASS}>Email *</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className={INPUT_CLASS} />
          </div>
          <div>
            <label className={LABEL_CLASS}>Phone</label>
            <PhoneInput value={phone} onChange={setPhone} className={INPUT_CLASS} />
          </div>
        </div>

        <div>
          <label className={LABEL_CLASS}>How was this inquiry received? *</label>
          <select value={channel} onChange={(e) => setChannel(e.target.value)} required className={INPUT_CLASS}>
            <option value="PHONE">Phone / Walk-in</option>
            <option value="EMAIL">Email</option>
            <option value="INSTAGRAM">Instagram</option>
            <option value="FACEBOOK">Facebook</option>
          </select>
        </div>

        <div>
          <label className={LABEL_CLASS}>Describe the tattoo *</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} required rows={3} className={INPUT_CLASS} />
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
          <span className={LABEL_CLASS}>Been tattooed before? *</span>
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
          <ArtistSelect
            id="staffInquiryPreferredArtist"
            className="mt-1"
            artists={artists}
            value={preferredArtistId || null}
            onChange={(artistId) => setPreferredArtistId(artistId ?? '')}
            clearLabel="No preference"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={LABEL_CLASS}>Budget</label>
            <input type="text" placeholder="e.g. $300-500" value={budget} onChange={(e) => setBudget(e.target.value)} className={INPUT_CLASS} />
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

        <ImageUploadSection label="Reference images *" hint="Photos or designs showing the style." onChange={setReferenceImages} />
        <ImageUploadSection label="Placement photos *" hint="A photo of the area for the tattoo." onChange={setPlacementImages} />

        {submitError && (
          <div className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{submitError}</div>
        )}

        <button
          type="submit"
          disabled={submitting || imagesUploading}
          className="w-full rounded-full bg-accent px-4 py-2 text-sm font-medium text-bg transition hover:bg-accent-hover disabled:opacity-60"
        >
          {submitting ? 'Creating…' : 'Create inquiry'}
        </button>
      </form>
    </Modal>
  )
}
