import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import Sidebar from '../components/Sidebar'
import PhoneInput from '../components/PhoneInput'
import SpecialtiesInput from '../components/SpecialtiesInput'
import DatePickerField from '../components/DatePickerField'
import ScheduleEditor, { defaultScheduleDays, scheduleDaysToBlocks, type ScheduleBlock } from '../components/ScheduleEditor'
import { apiFetch } from '../lib/api'
import { uploadPortfolioImage } from '../lib/cloudinary'
import { isValidPhoneDigits, readFileAsDataUrl, MAX_IMAGE_FILE_BYTES } from '../lib/format'
import { ArrowLeftIcon, CloseIcon, InstagramIcon, FacebookIcon } from '../components/icons'
import { useEffectiveUser } from '../context/useEffectiveUser'
import { artistsQueryKey } from '../lib/queryKeys'

interface LocationOption {
  id: string
  name: string
}

interface UploadItem {
  id: string
  previewUrl: string
  status: 'uploading' | 'error'
  error?: string
}

const EMPTY_FORM = {
  name: '',
  phone: '',
  email: '',
  password: '',
  bio: '',
  instagramHandle: '',
  facebookProfileUrl: '',
  locationId: '',
}

// Comprehensive artist creation: every field a new artist profile needs,
// collected in one place and submitted in one atomic request (see
// POST /studios/:studioId/users in studios.ts) -- rather than the bare
// name/email/password the old "+ Add Artist" modal collected, leaving
// bio/specialties/schedule/social links/guest window/location to a series
// of separate follow-up edits. A full page rather than a modal, since the
// schedule editor especially makes this a much richer form than a modal
// comfortably holds -- consistent with how other rich flows in this app
// (checkout, waiver signing) are full pages, not modals.
export default function ArtistCreate() {
  const navigate = useNavigate()
  const user = useEffectiveUser()
  const queryClient = useQueryClient()

  const [form, setForm] = useState(EMPTY_FORM)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [specialties, setSpecialties] = useState<string[]>([])
  const [scheduleDays, setScheduleDays] = useState(defaultScheduleDays())
  const [portfolioImages, setPortfolioImages] = useState<string[]>([])
  const [uploadingItems, setUploadingItems] = useState<UploadItem[]>([])
  const [isGuest, setIsGuest] = useState(false)
  const [guestStartDate, setGuestStartDate] = useState('')
  const [guestEndDate, setGuestEndDate] = useState('')
  const [locations, setLocations] = useState<LocationOption[] | null>(null)

  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!user?.studioId) return
    let ignore = false

    apiFetch<LocationOption[]>(`/studios/${user.studioId}/locations`)
      .then((data) => {
        if (!ignore) setLocations(data)
      })
      .catch(() => {
        // The location dropdown just stays empty if this fails.
      })

    return () => {
      ignore = true
    }
  }, [user?.studioId])

  async function handleAvatarFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setFormError(null)

    if (!file.type.startsWith('image/')) {
      setFormError('Please choose an image file.')
      return
    }

    if (file.size > MAX_IMAGE_FILE_BYTES) {
      setFormError('Profile picture must be under 5MB.')
      return
    }

    try {
      setAvatarUrl(await readFileAsDataUrl(file))
    } catch {
      setFormError('Could not read that image. Please try a different file.')
    }
  }

  function handlePortfolioFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return

    const files = Array.from(fileList)
    const items = files.map((file) => ({
      id: crypto.randomUUID(),
      file,
      previewUrl: URL.createObjectURL(file),
    }))

    setUploadingItems((prev) => [...prev, ...items.map(({ id, previewUrl }) => ({ id, previewUrl, status: 'uploading' as const }))])

    items.forEach(async ({ id: itemId, file }) => {
      try {
        const url = await uploadPortfolioImage(file)
        setPortfolioImages((prev) => [...prev, url])
        setUploadingItems((prev) => prev.filter((i) => i.id !== itemId))
      } catch (err) {
        setUploadingItems((prev) =>
          prev.map((i) =>
            i.id === itemId ? { ...i, status: 'error', error: err instanceof Error ? err.message : 'Upload failed' } : i,
          ),
        )
      }
    })
  }

  function removeUploadingItem(itemId: string) {
    setUploadingItems((prev) => {
      const item = prev.find((i) => i.id === itemId)
      if (item) URL.revokeObjectURL(item.previewUrl)
      return prev.filter((i) => i.id !== itemId)
    })
  }

  function removePortfolioImage(url: string) {
    setPortfolioImages((prev) => prev.filter((u) => u !== url))
  }

  const isUploading = uploadingItems.some((i) => i.status === 'uploading')

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!user?.studioId) return

    if (!isValidPhoneDigits(form.phone)) {
      setFormError('Enter a complete 10-digit phone number.')
      return
    }

    setFormError(null)
    setSubmitting(true)

    const blocks: ScheduleBlock[] = scheduleDaysToBlocks(scheduleDays)

    try {
      const created = await apiFetch<{ artist: { id: string } | null }>(`/studios/${user.studioId}/users`, {
        method: 'POST',
        body: JSON.stringify({
          name: form.name,
          phone: form.phone,
          email: form.email,
          password: form.password,
          role: 'ARTIST',
          avatarUrl,
          bio: form.bio || null,
          specialties,
          portfolioImages,
          instagramHandle: form.instagramHandle || null,
          facebookProfileUrl: form.facebookProfileUrl || null,
          preferredSchedule: blocks.length > 0 ? blocks : null,
          isGuest,
          guestStartDate: guestStartDate || null,
          guestEndDate: guestEndDate || null,
          locationId: form.locationId || null,
        }),
      })

      queryClient.invalidateQueries({ queryKey: artistsQueryKey(user.studioId) })
      navigate(created.artist ? `/artists/${created.artist.id}` : '/team?tab=artists')
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to create artist')
    } finally {
      setSubmitting(false)
    }
  }

  // Same restriction the creation endpoint itself enforces (requireRole
  // OWNER) -- redirected here rather than left on a form that would only
  // ever 403 on submit. Placed after every hook above so hook call order
  // never depends on role.
  if (user && user.role !== 'OWNER') {
    return <Navigate to="/team?tab=artists" replace />
  }

  return (
    <div className="flex min-h-screen bg-bg text-fg">
      <Sidebar />

      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl px-6 py-6 sm:px-10 sm:py-8">
          <button
            type="button"
            onClick={() => navigate('/team?tab=artists')}
            className="inline-flex items-center gap-2 text-sm text-fg-secondary hover:text-fg"
          >
            <ArrowLeftIcon className="h-4 w-4" />
            Back to Artists
          </button>

          <h1 className="mt-6 text-2xl font-bold text-fg">Add Artist</h1>
          <p className="mt-1 text-sm text-fg-secondary">
            Everything needed for a fully set-up profile, in one step.
          </p>

          <form onSubmit={handleSubmit}>
            {formError && (
              <div className="mt-6 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                {formError}
              </div>
            )}

            <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
              <h2 className="text-base font-semibold text-fg">Account</h2>

              <div className="mt-4 flex items-center gap-3">
                {avatarUrl ? (
                  <img src={avatarUrl} alt="Profile picture preview" className="h-16 w-16 rounded-full object-cover" />
                ) : (
                  <div className="flex h-16 w-16 items-center justify-center rounded-full border border-border text-xs text-fg-muted">
                    No photo
                  </div>
                )}
                <label className="cursor-pointer rounded-full border border-border px-3 py-1.5 text-xs font-medium text-fg transition hover:bg-surface">
                  {avatarUrl ? 'Change photo' : 'Upload photo'}
                  <input type="file" accept="image/*" onChange={handleAvatarFileChange} className="hidden" />
                </label>
                {avatarUrl && (
                  <button
                    type="button"
                    onClick={() => setAvatarUrl(null)}
                    className="text-xs font-medium text-fg-secondary transition hover:text-fg"
                  >
                    Remove
                  </button>
                )}
              </div>

              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="name" className="mb-1 block text-sm font-medium text-fg-secondary">
                    Name
                  </label>
                  <input
                    id="name"
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>
                <div>
                  <label htmlFor="phone" className="mb-1 block text-sm font-medium text-fg-secondary">
                    Phone
                  </label>
                  <PhoneInput
                    id="phone"
                    value={form.phone}
                    onChange={(digits) => setForm({ ...form, phone: digits })}
                    className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>
                <div>
                  <label htmlFor="email" className="mb-1 block text-sm font-medium text-fg-secondary">
                    Email
                  </label>
                  <input
                    id="email"
                    type="email"
                    required
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>
                <div>
                  <label htmlFor="password" className="mb-1 block text-sm font-medium text-fg-secondary">
                    Temporary Password
                  </label>
                  <input
                    id="password"
                    type="password"
                    required
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>
              </div>

              <div className="mt-3">
                <label htmlFor="location" className="mb-1 block text-sm font-medium text-fg-secondary">
                  Location
                </label>
                <select
                  id="location"
                  value={form.locationId}
                  onChange={(e) => setForm({ ...form, locationId: e.target.value })}
                  className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                >
                  <option value="">No location assigned</option>
                  {locations?.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
              <h2 className="text-base font-semibold text-fg">Guest Artist</h2>
              <p className="mt-1 text-xs text-fg-muted">
                A guest artist working a limited window. Once their end date passes, they drop out of Calendar's
                default resource columns and default assignment pickers (but stay fully visible on the Artists tab,
                and their past appointments are never hidden).
              </p>

              <label className="mt-3 flex items-center gap-2 text-sm font-medium text-fg-secondary">
                <input
                  type="checkbox"
                  checked={isGuest}
                  onChange={(e) => setIsGuest(e.target.checked)}
                  className="h-4 w-4 rounded border-border bg-surface-inset accent-accent"
                />
                Guest artist
              </label>

              {isGuest && (
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-fg-secondary">Start date</label>
                    <DatePickerField value={guestStartDate} onChange={setGuestStartDate} />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-fg-secondary">End date</label>
                    <DatePickerField value={guestEndDate} onChange={setGuestEndDate} />
                  </div>
                </div>
              )}
            </div>

            <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
              <h2 className="text-base font-semibold text-fg">Bio</h2>
              <textarea
                rows={4}
                value={form.bio}
                onChange={(e) => setForm({ ...form, bio: e.target.value })}
                placeholder="A short bio about this artist…"
                className="mt-3 w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>

            <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
              <h2 className="text-base font-semibold text-fg">Social Links</h2>
              <div className="mt-3 space-y-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-fg-secondary">Instagram handle</label>
                  <div className="flex items-center gap-2">
                    <InstagramIcon className="h-4 w-4 shrink-0 text-fg-muted" />
                    <input
                      type="text"
                      value={form.instagramHandle}
                      onChange={(e) => setForm({ ...form, instagramHandle: e.target.value })}
                      placeholder="studioname"
                      className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-fg-secondary">Facebook profile URL</label>
                  <div className="flex items-center gap-2">
                    <FacebookIcon className="h-4 w-4 shrink-0 text-fg-muted" />
                    <input
                      type="text"
                      value={form.facebookProfileUrl}
                      onChange={(e) => setForm({ ...form, facebookProfileUrl: e.target.value })}
                      placeholder="https://facebook.com/studioname"
                      className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
              <h2 className="text-base font-semibold text-fg">Specialties</h2>
              <div className="mt-3">
                <SpecialtiesInput value={specialties} onChange={setSpecialties} />
              </div>
            </div>

            <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
              <h2 className="text-base font-semibold text-fg">Preferred Schedule</h2>
              <p className="mt-1 text-xs text-fg-muted">
                Advisory availability only — doesn't block scheduling, just informs staff.
              </p>
              <div className="mt-4">
                <ScheduleEditor days={scheduleDays} onChange={setScheduleDays} editable />
              </div>
            </div>

            <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
              <h2 className="text-base font-semibold text-fg">Portfolio</h2>

              <input
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => {
                  handlePortfolioFiles(e.target.files)
                  e.target.value = ''
                }}
                className="mt-3 block w-full text-sm text-fg-secondary file:mr-3 file:rounded-full file:border file:border-border file:bg-surface file:px-4 file:py-2 file:text-sm file:font-medium file:text-fg hover:file:bg-surface-raised"
              />

              {portfolioImages.length === 0 && uploadingItems.length === 0 && (
                <p className="mt-3 text-sm text-fg-secondary">No portfolio images yet.</p>
              )}

              {(portfolioImages.length > 0 || uploadingItems.length > 0) && (
                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {portfolioImages.map((url) => (
                    <div key={url} className="group relative aspect-square overflow-hidden rounded-lg border border-border">
                      <img src={url} alt="" className="h-full w-full object-cover" />
                      <button
                        type="button"
                        onClick={() => removePortfolioImage(url)}
                        aria-label="Remove image"
                        className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-fg opacity-0 transition group-hover:opacity-100 hover:bg-black/80"
                      >
                        <CloseIcon className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                  {uploadingItems.map((item) => (
                    <div key={item.id} className="relative aspect-square overflow-hidden rounded-lg border border-border">
                      <img src={item.previewUrl} alt="" className="h-full w-full object-cover" />
                      {item.status === 'uploading' && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-xs text-fg">
                          Uploading…
                        </div>
                      )}
                      {item.status === 'error' && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-danger/80 p-1 text-center text-[10px] text-fg">
                          {item.error ?? 'Upload failed'}
                          <button
                            type="button"
                            onClick={() => removeUploadingItem(item.id)}
                            className="rounded-full border border-danger/40 px-2 py-0.5 text-[10px] text-danger hover:bg-danger/10"
                          >
                            Remove
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-6 flex items-center gap-3">
              <button
                type="submit"
                disabled={submitting || isUploading}
                className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-60"
              >
                {submitting ? 'Creating…' : 'Create Artist'}
              </button>
              <button
                type="button"
                onClick={() => navigate('/team?tab=artists')}
                className="rounded-full border border-border px-4 py-2 text-sm font-medium text-fg transition hover:bg-surface"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
