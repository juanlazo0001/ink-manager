import { useEffect, useState } from 'react'
import { apiFetch, ApiError } from '../lib/api'
import { isValidPhoneDigits, formatPhoneInput } from '../lib/format'
import Modal from './Modal'
import PhoneInput from './PhoneInput'
import ImageUploadSection, { type ImageUploadState } from './ImageUploadSection'
import ArtistSelect from './ArtistSelect'

interface ClientSearchResult {
  id: string
  firstName: string
  lastName: string
  email: string | null
  phone: string | null
  // Whoever this client last had an appointment with, if any -- preloads
  // the Preferred artist dropdown below on selection, a much stronger
  // default than "no preference" for a returning client.
  lastArtistId: string | null
}

const INPUT_CLASS =
  'mt-1 w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:cursor-not-allowed disabled:opacity-60'
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
  // Set when opened from an existing client's own page (e.g. ClientDetail's
  // "New Inquiry" button) -- pre-fills identity fields and locks whichever
  // of them already have a value, so this inquiry can only ever attach to
  // THIS client (POST /inquiries matches an existing client by email, then
  // phone -- an edited email here could silently attach to a different
  // client, or spawn a duplicate). A field with no value on file (e.g. no
  // phone on record) stays editable rather than blocking submission.
  lockedClient?: { firstName: string; lastName: string; email: string; phone: string }
  // Paired with lockedClient -- ClientDetail passes this client's own id so
  // the created inquiry attaches to THEM explicitly (POST /inquiries'
  // existingClientId), rather than relying on the fallback email/phone
  // match below to happen to land on the right row (which it normally
  // will, since lockedClient's email is that exact client's own, but an
  // explicit id is a stronger guarantee -- e.g. covers a client with no
  // email on file at all).
  existingClientId?: string
  // Most recent inquiry's stated preference, if any (ClientDetail passes
  // client.inquiries[0]?.preferredArtistId -- inquiries is already ordered
  // createdAt desc). Pre-fills the dropdown but stays fully editable,
  // unlike lockedClient's fields above -- there's no "wrong client"
  // failure mode from changing who this new project's preference is.
  initialPreferredArtistId?: string
}

// Staff-side counterpart to the public IntakeForm -- front desk fills this
// out on a walk-in or phone-call customer's behalf. Same required fields
// and validation as the public form, submitted to the same POST /inquiries
// (optionalAuth on that route attributes the create to this staff member
// and skips the studioSlug requirement since the JWT already carries it).
export default function StaffInquiryForm({
  onClose,
  onCreated,
  lockedClient,
  existingClientId,
  initialPreferredArtistId,
}: StaffInquiryFormProps) {
  const [firstName, setFirstName] = useState(lockedClient?.firstName ?? '')
  const [lastName, setLastName] = useState(lockedClient?.lastName ?? '')
  const [email, setEmail] = useState(lockedClient?.email ?? '')
  const [phone, setPhone] = useState(lockedClient?.phone ?? '')
  const [channel, setChannel] = useState('PHONE')

  // Client lookup (only offered when there's no lockedClient already --
  // i.e. the global "+ New Inquiry" flow, not ClientDetail's own "New
  // Inquiry" button, which already knows exactly who this is for). Finding
  // and picking an existing client here locks the identity fields the same
  // way lockedClient does, and the created inquiry attaches to them
  // explicitly via existingClientId -- this is the fix for the case that
  // matters most: a returning client typed in with a slightly different
  // email/phone than what's on file would otherwise silently become a
  // second, duplicate client record.
  const [matchedClient, setMatchedClient] = useState<ClientSearchResult | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<ClientSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [referralCode, setReferralCode] = useState('')
  const [description, setDescription] = useState('')
  const [colorOrBlackGrey, setColorOrBlackGrey] = useState('')
  const [placement, setPlacement] = useState('')
  const [estimatedSize, setEstimatedSize] = useState('')
  const [hasBeenTattooedBefore, setHasBeenTattooedBefore] = useState('')
  const [budget, setBudget] = useState('')
  const [desiredTiming, setDesiredTiming] = useState('')
  const [preferredArtistId, setPreferredArtistId] = useState(initialPreferredArtistId ?? '')

  const [artists, setArtists] = useState<StaffArtist[]>([])
  // Default true -- matches every studio's always-on behavior before this
  // flag existed, so a slow/failed fetch never wrongly hides the option.
  const [referralProgramEnabled, setReferralProgramEnabled] = useState(true)
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

    apiFetch<{ referralProgramEnabled: boolean }>('/studio-settings')
      .then((data) => {
        if (!ignore) setReferralProgramEnabled(data.referralProgramEnabled)
      })
      .catch(() => {
        // Leave the default (true) on failure -- same fail-open treatment
        // as the artists fetch above.
      })

    return () => {
      ignore = true
    }
  }, [])

  // Same debounced-search pattern as ClientDetail's own manual-merge
  // picker (GET /clients/merge-search) -- reused as-is rather than a
  // second endpoint, since "find a client by name/email/phone" is exactly
  // the same lookup either way. Only runs while a match hasn't already
  // been picked and there's no lockedClient (the search box itself is
  // hidden in that case, see the JSX below).
  useEffect(() => {
    if (lockedClient || matchedClient) return
    if (searchQuery.trim().length < 2) {
      setSearchResults([])
      setSearching(false)
      return
    }

    let ignore = false
    setSearching(true)
    const timeout = setTimeout(async () => {
      try {
        const results = await apiFetch<ClientSearchResult[]>(
          `/clients/merge-search?q=${encodeURIComponent(searchQuery.trim())}`,
        )
        if (!ignore) setSearchResults(results)
      } catch {
        if (!ignore) setSearchResults([])
      } finally {
        if (!ignore) setSearching(false)
      }
    }, 300)

    return () => {
      ignore = true
      clearTimeout(timeout)
    }
  }, [searchQuery, lockedClient, matchedClient])

  function artistName(artistId: string | null) {
    if (!artistId) return null
    const artist = artists.find((a) => a.id === artistId)
    return artist ? (artist.user.name ?? artist.user.email) : null
  }

  function selectMatchedClient(candidate: ClientSearchResult) {
    setMatchedClient(candidate)
    setFirstName(candidate.firstName)
    setLastName(candidate.lastName)
    setEmail(candidate.email ?? '')
    setPhone(candidate.phone ?? '')
    setPreferredArtistId(candidate.lastArtistId ?? '')
    setSearchQuery('')
    setSearchResults([])
  }

  function clearMatchedClient() {
    setMatchedClient(null)
    setFirstName('')
    setLastName('')
    setEmail('')
    setPhone('')
    setPreferredArtistId('')
  }

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
      !hasBeenTattooedBefore ||
      (channel === 'REFERRAL' && !referralCode)
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
          referralCode: channel === 'REFERRAL' ? referralCode : undefined,
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
          existingClientId: existingClientId ?? matchedClient?.id ?? undefined,
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
    <Modal
      title={lockedClient ? `New Inquiry — ${lockedClient.firstName} ${lockedClient.lastName}` : 'New Inquiry'}
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="max-h-[70vh] space-y-5 overflow-y-auto pr-1">
        {!lockedClient && !matchedClient && (
          <div>
            <label className={LABEL_CLASS}>Existing client?</label>
            <input
              type="text"
              autoFocus
              placeholder="Search by name, email, or phone…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={INPUT_CLASS}
            />
            {searching && <p className="mt-2 text-sm text-fg-secondary">Searching…</p>}
            {!searching && searchQuery.trim().length >= 2 && searchResults.length === 0 && (
              <p className="mt-2 text-sm text-fg-secondary">No matching clients -- fill out the form below to add a new one.</p>
            )}
            {searchResults.length > 0 && (
              <ul className="mt-2 max-h-40 space-y-2 overflow-y-auto">
                {searchResults.map((candidate) => (
                  <li key={candidate.id}>
                    <button
                      type="button"
                      onClick={() => selectMatchedClient(candidate)}
                      className="flex w-full items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-left text-sm text-fg transition hover:bg-surface"
                    >
                      <span>
                        <span className="block">
                          {candidate.firstName} {candidate.lastName}
                          {candidate.email ? ` — ${candidate.email}` : ''}
                          {candidate.phone ? ` — ${formatPhoneInput(candidate.phone)}` : ''}
                        </span>
                        {artistName(candidate.lastArtistId) && (
                          <span className="block text-xs text-fg-muted">Last worked with {artistName(candidate.lastArtistId)}</span>
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {matchedClient && (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-fg">
            <span>
              Attaching to existing client: <span className="font-medium">{matchedClient.firstName} {matchedClient.lastName}</span>
            </span>
            <button type="button" onClick={clearMatchedClient} className="text-xs font-medium text-accent hover:underline">
              Not them? Clear
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={LABEL_CLASS}>First name *</label>
            <input
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              required
              disabled={!!lockedClient?.firstName || !!matchedClient}
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
              disabled={!!lockedClient?.lastName || !!matchedClient}
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
              disabled={!!lockedClient?.email || !!matchedClient?.email}
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label className={LABEL_CLASS}>Phone</label>
            <PhoneInput
              value={phone}
              onChange={setPhone}
              disabled={!!lockedClient?.phone || !!matchedClient?.phone}
              className={INPUT_CLASS}
            />
          </div>
        </div>

        <div>
          <label className={LABEL_CLASS}>How was this inquiry received? *</label>
          <select value={channel} onChange={(e) => setChannel(e.target.value)} required className={INPUT_CLASS}>
            <option value="PHONE">Phone / Walk-in</option>
            <option value="EMAIL">Email</option>
            <option value="INSTAGRAM">Instagram</option>
            <option value="FACEBOOK">Facebook</option>
            {referralProgramEnabled && <option value="REFERRAL">A friend referred them</option>}
          </select>
          {channel === 'REFERRAL' && referralProgramEnabled && (
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
