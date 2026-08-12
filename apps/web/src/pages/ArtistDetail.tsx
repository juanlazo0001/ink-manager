import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import SpecialtiesInput from '../components/SpecialtiesInput'
import { apiFetch, ApiError } from '../lib/api'
import { uploadPortfolioImage } from '../lib/cloudinary'
import { formatPhoneInput } from '../lib/format'
import { useUserProfile } from '../context/useUserProfile'
import { useEffectiveUser } from '../context/useEffectiveUser'
import { ArrowLeftIcon, ArrowUpRightIcon, CloseIcon, CopyIcon, InstagramIcon, FacebookIcon, EmailIcon } from '../components/icons'
import DatePickerField from '../components/DatePickerField'
import ScheduleEditor, {
  defaultScheduleDays,
  scheduleBlocksToDays,
  scheduleDaysToBlocks,
  type ScheduleBlock,
} from '../components/ScheduleEditor'
import Widget from '../components/Widget'
import ReorderableWidgetList from '../components/ReorderableWidgetList'

interface Artist {
  id: string
  bio: string | null
  specialties: string[]
  portfolioImages: string[]
  instagramHandle: string | null
  facebookProfileUrl: string | null
  publicContactEmail: string | null
  preferredSchedule: ScheduleBlock[] | null
  isGuest: boolean
  guestStartDate: string | null
  guestEndDate: string | null
  hourlyRateCents: number | null
  flatRateCents: number | null
  // Settings "Defaults" tab audit follow-up: per-artist override of the
  // studio's StudioSettings.schedulingBufferMinutes default -- null means
  // "use the studio's own default".
  schedulingBufferMinutes: number | null
  // Client self-scheduling exploration: off by default -- see the schema
  // field's own comment on Artist for what turning it on does.
  allowsClientSelfScheduling: boolean
  flashReviewMode: 'ARTIST' | 'STUDIO' | 'NONE'
  publicSlug: string | null
  publishedAt: string | null
  artistServices: { serviceId: string }[]
  user: {
    id: string
    email: string
    name: string | null
    phone: string | null
    avatarUrl: string | null
    studioId: string
    studio: { slug: string }
  }
  // Solo artist architecture, Phase 4, extended in artist mobility Part 2:
  // the ACTIVE membership connecting this artist to the VIEWING studio --
  // HOME if this is their home studio, GUEST if the viewer is hosting them
  // as a guest. An array (same shape the backend's Prisma include
  // returns), even though exactly one such row can ever be active here.
  memberships: { allowsStudioProfileEdits: boolean; type: 'HOME' | 'GUEST' }[]
}

interface ServiceOption {
  id: string
  name: string
  isActive: boolean
}

const FLASH_REVIEW_MODE_OPTIONS: { value: 'ARTIST' | 'STUDIO' | 'NONE'; label: string; description: string }[] = [
  {
    value: 'ARTIST',
    label: 'You review each request',
    description:
      "When someone requests one of your flash pieces, you review the placement photo and approve or decline it yourself before they can pay. This is yours alone to decide.",
  },
  {
    value: 'STUDIO',
    label: 'Front desk reviews each request',
    description:
      "Requests go to front desk's task queue instead of yours -- they review the placement and approve or decline before the client can pay.",
  },
  {
    value: 'NONE',
    label: 'No review -- instant booking',
    description: 'No review step at all -- the payment link goes out right away.',
  },
]

interface UploadItem {
  id: string
  previewUrl: string
  status: 'uploading' | 'error'
  error?: string
}

// Built-in fallback order for a user who's never customized this page's
// layout -- same reorder/collapse system already used on the Inquiry,
// Appointment, and Client detail pages.
const ARTIST_WIDGET_ORDER = [
  'guest-artist',
  'bio',
  'rates',
  'scheduling-buffer',
  'social-links',
  'public-presence',
  'specialties',
  'services',
  'preferred-schedule',
  'portfolio',
]

export default function ArtistDetail() {
  const { id } = useParams<{ id: string }>()
  const user = useEffectiveUser()
  const { profile } = useUserProfile()
  const canManageStaff = profile?.permissions.includes('artists.manage') ?? false

  const [artist, setArtist] = useState<Artist | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshIndex, setRefreshIndex] = useState(0)

  const [bio, setBio] = useState('')
  const [specialties, setSpecialties] = useState<string[]>([])
  const [serviceOptions, setServiceOptions] = useState<ServiceOption[]>([])
  const [serviceIds, setServiceIds] = useState<string[]>([])
  const [portfolioImages, setPortfolioImages] = useState<string[]>([])
  const [instagramHandle, setInstagramHandle] = useState('')
  const [facebookProfileUrl, setFacebookProfileUrl] = useState('')
  const [publicContactEmail, setPublicContactEmail] = useState('')
  const [isGuest, setIsGuest] = useState(false)
  const [guestStartDate, setGuestStartDate] = useState('')
  const [guestEndDate, setGuestEndDate] = useState('')
  const [hourlyRate, setHourlyRate] = useState('')
  const [flatRate, setFlatRate] = useState('')
  const [schedulingBufferMinutes, setSchedulingBufferMinutes] = useState('')
  const [allowsClientSelfScheduling, setAllowsClientSelfScheduling] = useState(false)
  const [flashReviewMode, setFlashReviewMode] = useState<'ARTIST' | 'STUDIO' | 'NONE'>('ARTIST')
  const [uploadingItems, setUploadingItems] = useState<UploadItem[]>([])
  const [copiedLinkKey, setCopiedLinkKey] = useState<'public' | 'flash' | null>(null)

  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)

  const [scheduleDays, setScheduleDays] = useState<(ScheduleBlock | null)[]>(defaultScheduleDays())
  const [scheduleSaving, setScheduleSaving] = useState(false)
  const [scheduleError, setScheduleError] = useState<string | null>(null)
  const [scheduleSuccess, setScheduleSuccess] = useState(false)

  useEffect(() => {
    if (!id) return

    let ignore = false

    async function load() {
      setArtist(null)
      setError(null)

      try {
        const data = await apiFetch<Artist>(`/artists/${id}`)
        if (!ignore) setArtist(data)
      } catch (err) {
        if (ignore) return

        if (err instanceof ApiError && err.status === 404) {
          setError('Artist not found.')
        } else if (err instanceof ApiError && err.status === 403) {
          setError("You don't have permission to view this artist.")
        } else {
          setError(err instanceof Error ? err.message : 'Failed to load artist')
        }
      }
    }

    load()

    return () => {
      ignore = true
    }
  }, [id, refreshIndex])

  useEffect(() => {
    let ignore = false
    apiFetch<ServiceOption[]>('/services')
      .then((data) => {
        if (!ignore) setServiceOptions(data)
      })
      .catch(() => {
        /* Checkbox list / read-only badges just stay empty if this fails -- not critical page content. */
      })
    return () => {
      ignore = true
    }
  }, [])

  // Seeds the editable fields once per artist id (not on every refetch), so
  // an in-progress edit doesn't get clobbered. Adjusted during render per
  // React's guidance for resetting state when a prop changes.
  const [seededForId, setSeededForId] = useState<string | null>(null)
  if (artist && artist.id !== seededForId) {
    setSeededForId(artist.id)
    setBio(artist.bio ?? '')
    setSpecialties(artist.specialties)
    setServiceIds(artist.artistServices.map((s) => s.serviceId))
    setPortfolioImages(artist.portfolioImages)
    setInstagramHandle(artist.instagramHandle ?? '')
    setFacebookProfileUrl(artist.facebookProfileUrl ?? '')
    setPublicContactEmail(artist.publicContactEmail ?? '')
    setIsGuest(artist.isGuest)
    // guestStartDate/guestEndDate come back as UTC-midnight ISO strings
    // (e.g. "2026-07-01T00:00:00.000Z") for what's really just a plain
    // calendar date with no time-of-day meaning. Slicing the date portion
    // directly avoids round-tripping through `new Date(...)` + local
    // getters, which would shift the displayed day backward by one in any
    // timezone behind UTC (a real bug caught in verification, not
    // hypothetical -- e.g. New_York showed "Jun 30" for a saved "Jul 1").
    setGuestStartDate(artist.guestStartDate ? artist.guestStartDate.slice(0, 10) : '')
    setGuestEndDate(artist.guestEndDate ? artist.guestEndDate.slice(0, 10) : '')
    setHourlyRate(artist.hourlyRateCents != null ? (artist.hourlyRateCents / 100).toString() : '')
    setFlatRate(artist.flatRateCents != null ? (artist.flatRateCents / 100).toString() : '')
    setSchedulingBufferMinutes(
      artist.schedulingBufferMinutes != null ? artist.schedulingBufferMinutes.toString() : '',
    )
    setAllowsClientSelfScheduling(artist.allowsClientSelfScheduling)
    setFlashReviewMode(artist.flashReviewMode)
    setScheduleDays(scheduleBlocksToDays(artist.preferredSchedule))
  }

  // Matches PATCH /:id/preferred-schedule's own gate: requirePermission
  // artistSchedules.manage first (a studio can revoke this from ARTIST
  // entirely, even for their own schedule), then -- only for an ARTIST --
  // narrowed to their own profile. OWNER/FRONT_DESK have no such narrowing.
  const canEditSchedule =
    !!artist &&
    (profile?.permissions.includes('artistSchedules.manage') ?? false) &&
    (user?.role !== 'ARTIST' || artist.user.id === user?.userId)

  const isSelf = !!artist && artist.user.id === user?.userId

  // An artist manages their own profile regardless of whether their studio
  // granted them artists.manage -- that permission is about managing OTHER
  // artists (matches the backend's own requirePermissionOrSelfArtist, PATCH
  // /artists/:id). isSelf alone is always enough; staff additionally needs
  // real delegation (allowsStudioProfileEdits). Covers EVERYTHING now --
  // bio/specialties/portfolio/social links AND rates/scheduling buffer/
  // services offered (previously that second group had no delegation
  // concept at all, staff-editable by any artists.manage holder the
  // moment an invite was accepted, before the artist had any chance to
  // decide whether to allow it -- reported directly as wrong and folded
  // into this same single gate). isGuest/guestStartDate/guestEndDate (the
  // studio's own classification) and allowsClientSelfScheduling (a
  // booking-policy switch, not the artist's personal data) deliberately
  // stay outside this gate -- both already excluded server-side
  // regardless of what this page sends.
  const canEditProfileFields = isSelf || (canManageStaff && (artist?.memberships[0]?.allowsStudioProfileEdits ?? false))
  // Whether this page is interactive for the viewer at all, regardless of
  // which specific fields they can touch -- drives the Save button.
  const canEdit = canEditProfileFields

  async function handleCopyLink(key: 'public' | 'flash', url: string) {
    try {
      await navigator.clipboard.writeText(url)
      setCopiedLinkKey(key)
      setTimeout(() => setCopiedLinkKey((k) => (k === key ? null : k)), 2000)
    } catch {
      // Non-critical -- the URL is still shown and can be selected by hand.
    }
  }

  async function handleSaveSchedule() {
    if (!id) return

    setScheduleSaving(true)
    setScheduleError(null)
    setScheduleSuccess(false)

    const blocks = scheduleDaysToBlocks(scheduleDays)

    try {
      await apiFetch(`/artists/${id}/preferred-schedule`, {
        method: 'PATCH',
        body: JSON.stringify({ preferredSchedule: blocks.length > 0 ? blocks : null }),
      })

      setScheduleSuccess(true)
      setRefreshIndex((i) => i + 1)
    } catch (err) {
      setScheduleError(err instanceof Error ? err.message : 'Failed to save schedule')
    } finally {
      setScheduleSaving(false)
    }
  }

  function handleFiles(fileList: FileList | null) {
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

  function toggleService(serviceId: string) {
    setServiceIds((prev) => (prev.includes(serviceId) ? prev.filter((id) => id !== serviceId) : [...prev, serviceId]))
  }

  async function handleSave() {
    if (!id) return

    setSaving(true)
    setSaveError(null)
    setSaveSuccess(false)

    try {
      await apiFetch(`/artists/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          bio: bio || null,
          specialties,
          serviceIds,
          portfolioImages,
          instagramHandle: instagramHandle || null,
          facebookProfileUrl: facebookProfileUrl || null,
          publicContactEmail: publicContactEmail || null,
          isGuest,
          guestStartDate: guestStartDate || null,
          guestEndDate: guestEndDate || null,
          hourlyRateCents: hourlyRate ? Math.round(Number(hourlyRate) * 100) : null,
          flatRateCents: flatRate ? Math.round(Number(flatRate) * 100) : null,
          schedulingBufferMinutes: schedulingBufferMinutes ? Math.round(Number(schedulingBufferMinutes)) : null,
          allowsClientSelfScheduling,
          // Self-only on the backend (403s for anyone else) -- omitted
          // entirely for a staff caller rather than sent and rejected.
          ...(isSelf ? { flashReviewMode } : {}),
        }),
      })

      setSaveSuccess(true)
      setRefreshIndex((i) => i + 1)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save changes')
    } finally {
      setSaving(false)
    }
  }

  const isUploading = uploadingItems.some((i) => i.status === 'uploading')

  return (
    <div className="mx-auto max-w-4xl px-6 py-6 sm:px-10 sm:py-8">
          <Link
            to={isSelf || profile?.isSoloStudio ? '/profile' : '/team?tab=artists'}
            className="inline-flex items-center gap-2 text-sm text-fg-secondary hover:text-fg"
          >
            <ArrowLeftIcon className="h-4 w-4" />
            {isSelf || profile?.isSoloStudio ? 'Back to Profile' : 'Back to Artists'}
          </Link>

          {error && (
            <div className="mt-6 rounded-2xl card-surface border border-border bg-surface p-5">
              <p className="text-sm text-danger">{error}</p>
            </div>
          )}

          {!error && !artist && <p className="mt-6 text-sm text-fg-secondary">Loading artist…</p>}

          {!error && artist && (
            <>
              <div className="mt-6 rounded-2xl card-surface border border-border bg-surface p-5">
                <div className="flex items-center gap-4">
                  {artist.user.avatarUrl ? (
                    <img
                      src={artist.user.avatarUrl}
                      alt={artist.user.name ?? artist.user.email}
                      className="h-16 w-16 shrink-0 rounded-full object-cover"
                    />
                  ) : (
                    <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-surface text-xl font-semibold text-fg">
                      {(artist.user.name ?? artist.user.email).slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <div>
                    <h1 className="flex flex-wrap items-center gap-2 text-xl font-bold text-fg">
                      {artist.user.name || artist.user.email}
                      {/* This badge is now the ONLY source of "is this person
                          a guest here" -- derived exclusively from the real
                          StudioMembership.type (artist-mobility work), never
                          from the legacy isGuest/guestStartDate/guestEndDate
                          fields below (see the "Limited Availability Window"
                          widget's own comment for why those are a separate,
                          unrelated concept and must never drive this badge).
                          The two used to be shown side by side here, which is
                          exactly how two real artists ended up with a
                          "Guest (ended)" badge while their actual, current
                          membership was HOME -- a stale scheduling-window flag
                          from before the real membership system existed,
                          rendered as if it were live status. */}
                      {artist.memberships[0]?.type === 'GUEST' && (
                        <span className="rounded-full bg-accent/10 px-2.5 py-0.5 text-xs font-medium text-accent">
                          Guest artist
                        </span>
                      )}
                    </h1>
                    <p className="mt-1 text-sm text-fg-secondary">{artist.user.email}</p>
                    {artist.user.phone && (
                      <p className="text-sm text-fg-secondary">{formatPhoneInput(artist.user.phone)}</p>
                    )}
                  </div>
                </div>
                {canEdit && (
                  <p className="mt-3 text-xs text-fg-muted">
                    Profile picture is managed from{' '}
                    <Link to={isSelf || profile?.isSoloStudio ? '/profile' : '/team'} className="underline hover:text-fg-secondary">
                      {isSelf || profile?.isSoloStudio ? 'your profile' : 'Team'}
                    </Link>
                    .
                  </p>
                )}
                {artist.memberships[0]?.type === 'GUEST' && (
                  <p className="mt-3 text-xs text-fg-muted">
                    This artist's home studio is elsewhere. Rates, scheduling buffer, availability window,
                    self-scheduling, and services stay under their home studio's control from here -- only changes
                    to fields they've delegated to you (if any) will be saved.
                  </p>
                )}
              </div>

              <ReorderableWidgetList pageKey="artist-detail" defaultOrder={ARTIST_WIDGET_ORDER}>
              {/* Renamed from "Guest Artist" -- this is Artist.isGuest/
                  guestStartDate/guestEndDate, a scheduling-only availability
                  window (Calendar shading, drops out of default assignment
                  pickers once past) that predates the real multi-studio
                  StudioMembership.type system and has NO connection to it.
                  Two real artists ended up with a stale, misleading
                  "Guest (ended)" badge from this exact field while their
                  actual current membership was HOME -- the old naming made
                  it look like studio-membership status, so someone checked
                  it thinking it meant something it doesn't. The mechanism
                  is real and still useful (an artist working a genuinely
                  limited date range at this studio) and stays exactly as
                  it was; only the name changed, so it can never again be
                  mistaken for the real "Guest artist" badge above (which
                  comes exclusively from memberships[0]?.type). Still
                  staff-only, still hidden for a solo studio (no one else's
                  availability to restrict) -- unchanged from before. */}
              {canManageStaff && !profile?.isSoloStudio && (
                <Widget key="guest-artist" id="guest-artist" title="Limited Availability Window">
                  <p className="mt-1 text-xs text-fg-muted">
                    Restricts this artist to a specific date range at your studio -- useful for someone working a
                    genuinely limited engagement. Once the end date passes, they drop out of Calendar's default
                    resource columns and default assignment pickers (but stay fully visible here, and their past
                    appointments are never hidden). Unrelated to the "Guest artist" badge above, which reflects
                    their real studio membership.
                  </p>

                  <label className="mt-3 flex items-center gap-2 text-sm font-medium text-fg-secondary">
                    <input
                      type="checkbox"
                      checked={isGuest}
                      onChange={(e) => setIsGuest(e.target.checked)}
                      className="h-4 w-4 rounded border-border bg-surface-inset accent-accent"
                    />
                    Limited availability window
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
                </Widget>
              )}

              <Widget key="bio" id="bio" title="Bio">
                {canManageStaff && !canEditProfileFields && (
                  <p className="mt-1 text-xs text-fg-muted">
                    This artist hasn't given studio staff permission to edit their profile.
                  </p>
                )}
                {canEditProfileFields ? (
                  <textarea
                    rows={4}
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                    placeholder="A short bio about this artist…"
                    className="mt-3 w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                ) : (
                  <p className="mt-3 whitespace-pre-wrap text-sm text-fg-secondary">{artist.bio || 'No bio yet.'}</p>
                )}
              </Widget>

              <Widget key="rates" id="rates" title="Rates">
                <p className="mt-1 text-xs text-fg-muted">
                  Reference rate(s) for this artist. Purely informational -- when assigned to an estimate, these
                  suggest a starting price per session (hourly rate × that session's hour estimate, or the flat rate
                  as-is) that staff can freely override.
                </p>
                {canManageStaff && !canEditProfileFields && (
                  <p className="mt-1 text-xs text-fg-muted">
                    This artist hasn't given studio staff permission to edit their profile.
                  </p>
                )}
                {canEditProfileFields ? (
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-sm font-medium text-fg-secondary">Hourly rate</label>
                      <div className="relative">
                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-fg-muted">
                          $
                        </span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={hourlyRate}
                          onChange={(e) => setHourlyRate(e.target.value)}
                          placeholder="0.00"
                          className="w-full rounded-lg border border-border bg-surface-inset py-2 pl-7 pr-3 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                        />
                        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-fg-muted">
                          /hr
                        </span>
                      </div>
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-fg-secondary">Flat rate</label>
                      <div className="relative">
                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-fg-muted">
                          $
                        </span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={flatRate}
                          onChange={(e) => setFlatRate(e.target.value)}
                          placeholder="0.00"
                          className="w-full rounded-lg border border-border bg-surface-inset py-2 pl-7 pr-3 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                        />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 flex flex-wrap gap-4 text-sm text-fg-secondary">
                    {artist.hourlyRateCents != null && <p>${(artist.hourlyRateCents / 100).toFixed(2)}/hr</p>}
                    {artist.flatRateCents != null && <p>${(artist.flatRateCents / 100).toFixed(2)} flat</p>}
                    {artist.hourlyRateCents == null && artist.flatRateCents == null && <p>No rates set.</p>}
                  </div>
                )}
              </Widget>

              <Widget key="scheduling-buffer" id="scheduling-buffer" title="Scheduling Buffer">
                <p className="mt-1 text-xs text-fg-muted">
                  Minimum gap flagged as a possible conflict when booking this artist. Overrides the studio's own
                  default (Settings → Defaults) for this artist only -- leave blank to just use that default.
                </p>
                {canManageStaff && !canEditProfileFields && (
                  <p className="mt-1 text-xs text-fg-muted">
                    This artist hasn't given studio staff permission to edit their profile.
                  </p>
                )}
                {canEditProfileFields ? (
                  <div className="mt-3 max-w-[12rem]">
                    <label className="mb-1 block text-sm font-medium text-fg-secondary">Buffer (minutes)</label>
                    <input
                      type="number"
                      min="0"
                      value={schedulingBufferMinutes}
                      onChange={(e) => setSchedulingBufferMinutes(e.target.value)}
                      placeholder="Studio default"
                      className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-fg-secondary">
                    {artist.schedulingBufferMinutes != null
                      ? `${artist.schedulingBufferMinutes} minutes`
                      : "Using the studio's default."}
                  </p>
                )}

                {/* Client self-scheduling exploration: lives in this same
                    widget (rather than a new one) so it doesn't need its
                    own entry in ARTIST_WIDGET_ORDER -- see that array's own
                    comment on what happens to a widget id left out of it. */}
                <div className="mt-4 border-t border-border pt-4">
                  <p className="text-xs text-fg-muted">
                    When a client accepts this artist's estimate, let them pick from the artist's real suggested
                    availability instead of waiting for staff to schedule them. Their pick only creates a pending
                    request -- staff still confirms it before it's a real appointment.
                  </p>
                  {/* Deliberately stays staff-only (any artists.manage
                      holder) regardless of delegation, unlike everything
                      else on this page -- a booking-policy switch the
                      studio manages for its own clients' experience, not
                      the artist's personal profile/business data, and it
                      has its own dedicated, more narrowly-scoped self-
                      route (PATCH /:id/self-scheduling, solo-gated) that
                      this general save shouldn't quietly duplicate; the
                      backend already strips this field for a self-bypass
                      request. */}
                  {canManageStaff ? (
                    <label className="mt-3 flex items-center gap-2 text-sm text-fg">
                      <input
                        type="checkbox"
                        checked={allowsClientSelfScheduling}
                        onChange={(e) => setAllowsClientSelfScheduling(e.target.checked)}
                        className="h-4 w-4 rounded border-border text-accent focus:ring-accent"
                      />
                      Allow clients to self-schedule with this artist
                    </label>
                  ) : (
                    <p className="mt-3 text-sm text-fg-secondary">
                      Client self-scheduling is {artist.allowsClientSelfScheduling ? 'on' : 'off'} for this artist.
                    </p>
                  )}
                </div>

                {/* Flash review mode expansion: self-only, no staff branch
                    at all -- unlike self-scheduling just above, this isn't
                    a studio booking policy, it's the artist's own call on
                    their own art (same "no staff bypass exists" shape as
                    publishing their public page), including the choice to
                    let the studio review it instead. Staff viewing someone
                    else's profile simply never sees this block. "Yours
                    alone" language stays scoped to the ARTIST option only
                    -- never true once STUDIO is picked. */}
                {isSelf && (
                  <div className="mt-4 border-t border-border pt-4">
                    <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">Flash Booking Review</p>
                    <div className="mt-3 space-y-2">
                      {FLASH_REVIEW_MODE_OPTIONS.map((option) => (
                        <label
                          key={option.value}
                          className={[
                            'flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition',
                            flashReviewMode === option.value ? 'border-accent bg-accent/5' : 'border-border hover:bg-surface',
                          ].join(' ')}
                        >
                          <input
                            type="radio"
                            name="flashReviewMode"
                            checked={flashReviewMode === option.value}
                            onChange={() => setFlashReviewMode(option.value)}
                            className="mt-0.5 h-4 w-4 border-border text-accent focus:ring-accent"
                          />
                          <span>
                            <span className="block text-sm font-medium text-fg">{option.label}</span>
                            <span className="block text-xs text-fg-muted">{option.description}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </Widget>

              <Widget key="social-links" id="social-links" title="Social Links">
                {canManageStaff && !canEditProfileFields && (
                  <p className="mt-1 text-xs text-fg-muted">
                    This artist hasn't given studio staff permission to edit their profile.
                  </p>
                )}
                {canEditProfileFields ? (
                  <div className="mt-3 space-y-3">
                    <div>
                      <label className="mb-1 block text-sm font-medium text-fg-secondary">Instagram handle</label>
                      <div className="flex items-center gap-2">
                        <InstagramIcon className="h-4 w-4 shrink-0 text-fg-muted" />
                        <input
                          type="text"
                          value={instagramHandle}
                          onChange={(e) => setInstagramHandle(e.target.value)}
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
                          value={facebookProfileUrl}
                          onChange={(e) => setFacebookProfileUrl(e.target.value)}
                          placeholder="https://facebook.com/studioname"
                          className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-fg-secondary">Public contact email</label>
                      <p className="mb-1 text-xs text-fg-muted">
                        Optional -- shown to clients on the public artist page. Separate from the account login
                        email, which is never shown publicly.
                      </p>
                      <div className="flex items-center gap-2">
                        <EmailIcon className="h-4 w-4 shrink-0 text-fg-muted" />
                        <input
                          type="email"
                          value={publicContactEmail}
                          onChange={(e) => setPublicContactEmail(e.target.value)}
                          placeholder="artist@example.com"
                          className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                        />
                      </div>
                    </div>
                  </div>
                ) : artist.instagramHandle || artist.facebookProfileUrl || artist.publicContactEmail ? (
                  <div className="mt-3 flex items-center gap-3">
                    {artist.instagramHandle && (
                      <a
                        href={`https://instagram.com/${artist.instagramHandle}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="Instagram"
                        title="Instagram"
                        className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-fg-secondary transition hover:bg-surface-raised hover:text-fg"
                      >
                        <InstagramIcon className="h-4 w-4" />
                      </a>
                    )}
                    {artist.facebookProfileUrl && (
                      <a
                        href={artist.facebookProfileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="Facebook"
                        title="Facebook"
                        className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-fg-secondary transition hover:bg-surface-raised hover:text-fg"
                      >
                        <FacebookIcon className="h-4 w-4" />
                      </a>
                    )}
                    {artist.publicContactEmail && (
                      <a
                        href={`mailto:${artist.publicContactEmail}`}
                        aria-label="Email"
                        title="Email"
                        className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-fg-secondary transition hover:bg-surface-raised hover:text-fg"
                      >
                        <EmailIcon className="h-4 w-4" />
                      </a>
                    )}
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-fg-secondary">No social links yet.</p>
                )}
              </Widget>

              <Widget key="public-presence" id="public-presence" title="Public presence">
                {artist.publishedAt && artist.publicSlug ? (
                  <PublicLinkRow
                    label="Public page"
                    url={`${window.location.origin}/artist/${artist.publicSlug}`}
                    copied={copiedLinkKey === 'public'}
                    onCopy={() => handleCopyLink('public', `${window.location.origin}/artist/${artist.publicSlug}`)}
                  />
                ) : (
                  <p className="mt-3 text-sm text-fg-secondary">
                    Public page not published. Only the artist can publish it, from their own Profile page.
                  </p>
                )}
                <div className="mt-3">
                  <PublicLinkRow
                    label="Flash gallery"
                    url={`${window.location.origin}/flash/${artist.user.studio.slug}/${artist.id}`}
                    copied={copiedLinkKey === 'flash'}
                    onCopy={() =>
                      handleCopyLink('flash', `${window.location.origin}/flash/${artist.user.studio.slug}/${artist.id}`)
                    }
                  />
                </div>
              </Widget>

              <Widget key="specialties" id="specialties" title="Specialties">
                {canManageStaff && !canEditProfileFields && (
                  <p className="mt-1 text-xs text-fg-muted">
                    This artist hasn't given studio staff permission to edit their profile.
                  </p>
                )}
                <div className="mt-3">
                  {canEditProfileFields ? (
                    <SpecialtiesInput value={specialties} onChange={setSpecialties} />
                  ) : specialties.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {specialties.map((specialty) => (
                        <span
                          key={specialty}
                          className="inline-flex items-center rounded-full border border-border px-2.5 py-1 text-xs font-medium text-fg-secondary"
                        >
                          {specialty}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-fg-secondary">No specialties listed.</p>
                  )}
                </div>
              </Widget>

              <Widget key="services" id="services" title="Services Offered">
                <p className="mt-1 text-xs text-fg-muted">
                  Which of the studio's services this artist practices -- only artists tagged here appear as
                  practitioner options for an inquiry in that service.
                </p>
                {canManageStaff && !canEditProfileFields && (
                  <p className="mt-1 text-xs text-fg-muted">
                    This artist hasn't given studio staff permission to edit their profile.
                  </p>
                )}
                <div className="mt-3">
                  {canEditProfileFields ? (
                    serviceOptions.length > 0 ? (
                      <div className="flex flex-wrap gap-x-4 gap-y-2">
                        {serviceOptions
                          .filter((s) => s.isActive || serviceIds.includes(s.id))
                          .map((s) => (
                            <label key={s.id} className="flex items-center gap-2 text-sm text-fg-secondary">
                              <input
                                type="checkbox"
                                checked={serviceIds.includes(s.id)}
                                onChange={() => toggleService(s.id)}
                                className="h-4 w-4 rounded border-border bg-surface-inset accent-accent"
                              />
                              {s.name}
                              {!s.isActive && <span className="text-xs text-fg-muted">(inactive)</span>}
                            </label>
                          ))}
                      </div>
                    ) : (
                      <p className="text-sm text-fg-secondary">No services configured yet.</p>
                    )
                  ) : serviceIds.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {serviceOptions
                        .filter((s) => serviceIds.includes(s.id))
                        .map((s) => (
                          <span
                            key={s.id}
                            className="inline-flex items-center rounded-full border border-border px-2.5 py-1 text-xs font-medium text-fg-secondary"
                          >
                            {s.name}
                          </span>
                        ))}
                    </div>
                  ) : (
                    <p className="text-sm text-fg-secondary">No services tagged yet.</p>
                  )}
                </div>
              </Widget>

              <Widget key="preferred-schedule" id="preferred-schedule" title="Preferred Schedule">
                <p className="mt-1 text-xs text-fg-muted">
                  Advisory availability only — doesn't block scheduling, just informs staff.
                </p>

                <div className="mt-4">
                  <ScheduleEditor days={scheduleDays} onChange={setScheduleDays} editable={canEditSchedule} />
                </div>

                {canEditSchedule && (
                  <div className="mt-4 flex items-center gap-3">
                    <button
                      type="button"
                      onClick={handleSaveSchedule}
                      disabled={scheduleSaving}
                      className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-60"
                    >
                      {scheduleSaving ? 'Saving…' : 'Save schedule'}
                    </button>
                    {scheduleError && <p className="text-sm text-danger">{scheduleError}</p>}
                    {scheduleSuccess && !scheduleError && <p className="text-sm text-success">Saved.</p>}
                  </div>
                )}
              </Widget>

              <Widget key="portfolio" id="portfolio" title="Portfolio">
                {canManageStaff && !canEditProfileFields && (
                  <p className="mt-1 text-xs text-fg-muted">
                    This artist hasn't given studio staff permission to edit their profile.
                  </p>
                )}
                {canEditProfileFields && (
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={(e) => {
                      handleFiles(e.target.files)
                      e.target.value = ''
                    }}
                    className="mt-3 block w-full text-sm text-fg-secondary file:mr-3 file:rounded-full file:border file:border-border file:bg-surface file:px-4 file:py-2 file:text-sm file:font-medium file:text-fg hover:file:bg-surface-raised"
                  />
                )}

                {portfolioImages.length === 0 && uploadingItems.length === 0 && (
                  <p className="mt-3 text-sm text-fg-secondary">No portfolio images yet.</p>
                )}

                {(portfolioImages.length > 0 || uploadingItems.length > 0) && (
                  <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {portfolioImages.map((url) => (
                      <div key={url} className="group relative aspect-square overflow-hidden rounded-lg border border-border">
                        <img src={url} alt="" className="h-full w-full object-cover" />
                        {canEditProfileFields && (
                          <button
                            type="button"
                            onClick={() => removePortfolioImage(url)}
                            aria-label="Remove image"
                            className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-fg opacity-0 transition group-hover:opacity-100 hover:bg-black/80"
                          >
                            <CloseIcon className="h-3.5 w-3.5" />
                          </button>
                        )}
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
              </Widget>
              </ReorderableWidgetList>

              {canEdit && (
                <div className="mt-6 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving || isUploading}
                    className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-60"
                  >
                    {saving ? 'Saving…' : 'Save changes'}
                  </button>
                  {saveError && <p className="text-sm text-danger">{saveError}</p>}
                  {saveSuccess && !saveError && <p className="text-sm text-success">Saved.</p>}
                </div>
              )}
            </>
          )}
    </div>
  )
}

function PublicLinkRow({
  label,
  url,
  copied,
  onCopy,
}: {
  label: string
  url: string
  copied: boolean
  onCopy: () => void
}) {
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface-inset px-4 py-3">
      <div className="min-w-0">
        <p className="text-xs text-fg-muted">{label}</p>
        <p className="truncate text-sm font-medium text-fg">{url}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={onCopy}
          className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-fg transition hover:bg-surface"
        >
          <CopyIcon className="h-3.5 w-3.5" />
          {copied ? 'Copied!' : 'Copy'}
        </button>
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-fg transition hover:bg-surface"
        >
          <ArrowUpRightIcon className="h-3.5 w-3.5" />
          Open
        </a>
      </div>
    </div>
  )
}
