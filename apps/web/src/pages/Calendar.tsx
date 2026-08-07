import { useEffect, useMemo, useState, type ComponentType } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import {
  Calendar as BigCalendar,
  dayjsLocalizer,
  Views,
  type View,
  type SlotInfo,
  type CalendarProps,
  type ToolbarProps,
  type ViewsProps,
} from 'react-big-calendar'
// Vite's CJS dep pre-bundling double-wraps this addon's nested default
// export (its own index.js re-exports withDragAndDrop.js's default), so a
// plain `import withDragAndDrop from '...'` resolves to the wrapper module
// object instead of the function -- unwrap it defensively either way.
import dragAndDropModule, { type EventInteractionArgs } from 'react-big-calendar/lib/addons/dragAndDrop'
import dayjs from 'dayjs'
import 'react-big-calendar/lib/css/react-big-calendar.css'
import 'react-big-calendar/lib/addons/dragAndDrop/styles.css'
import Modal from '../components/Modal'
import AppointmentForm from '../components/AppointmentForm'
import StatusPill from '../components/StatusPill'
import { ArtistAvatar, FlatArtistAvatar } from '../components/ArtistAvatar'
import ArtistSelect from '../components/ArtistSelect'
import DatePickerField from '../components/DatePickerField'
import { toDateString, parseDateString } from '../components/DateAndTimeRangeFields'
import { apiFetch, ApiError } from '../lib/api'
import { describeAppointmentStatus, formatDateTime } from '../lib/format'
import { useAuth } from '../context/useAuth'
import { useEffectiveUser } from '../context/useEffectiveUser'
import { useUserProfile } from '../context/useUserProfile'
import { appointmentsQueryKey, appointmentsRangeQueryKey } from '../lib/queryKeys'
import { useMarkSectionSeen } from '../lib/useMarkSectionSeen'
import { colorForArtistId } from '../lib/artistColors'
import { useCalendarPreferences, type CalendarPreferences } from '../lib/useCalendarPreferences'
import { useThemePreset } from '../lib/useThemePreset'
import Eyebrow from '../components/Eyebrow'

const localizer = dayjsLocalizer(dayjs)

interface ScheduleBlock {
  dayOfWeek: number
  startTime: string
  endTime: string
}

interface ArtistOption {
  id: string
  user: { name: string | null; email: string; avatarUrl: string | null }
  isGuest: boolean
  guestStartDate: string | null
  guestEndDate: string | null
  preferredSchedule: ScheduleBlock[] | null
}

// isGuest/guestStartDate/guestEndDate are the "Limited Availability Window"
// feature (renamed from "Guest Artist" -- see ArtistDetail.tsx's own widget)
// -- a scheduling-only date range, unrelated to real studio membership
// (StudioMembership.type). Internal names here kept as-is (isEndedGuest,
// isOutsideGuestWindow below, includePastGuests state) since they're not
// user-facing; only the visible "Include past availability windows" label
// changed.
function isEndedGuest(artist: ArtistOption): boolean {
  return artist.isGuest && !!artist.guestEndDate && new Date(artist.guestEndDate) < new Date()
}

// Matches Settings.tsx's per-location hours editor shape exactly (Location.
// hours Json field) -- business hours moved from one studio-wide setting to
// each Location's own hours, so this reads whichever location is currently
// selected in the picker below rather than a single global value.
interface LocationHoursDay {
  day: number
  closed: boolean
  open: string | null
  close: string | null
}

interface LocationOption {
  id: string
  name: string
  hours: LocationHoursDay[] | null
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

function minutesOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes()
}

// Location-closed shading source. No hours configured at all yet
// (undefined/null -- distinct from an empty/all-closed array) never greys
// anything, matching every other "advisory, not yet set up" field in this
// app (e.g. Artist.preferredSchedule) -- a location that's never touched
// this setting shouldn't suddenly see its whole calendar greyed out.
function isStudioClosed(date: Date, hours: LocationHoursDay[] | undefined): boolean {
  if (!hours || hours.length === 0) return false
  const day = hours.find((d) => d.day === date.getDay())
  if (!day || day.closed || !day.open || !day.close) return true
  const minutes = minutesOfDay(date)
  return minutes < timeToMinutes(day.open) || minutes >= timeToMinutes(day.close)
}

function isStudioClosedAllDay(dayOfWeek: number, hours: LocationHoursDay[] | undefined): boolean {
  if (!hours || hours.length === 0) return false
  const day = hours.find((d) => d.day === dayOfWeek)
  return !day || day.closed
}

// Artist-unavailable shading source -- only within that artist's own
// resource column. A never-configured schedule (null/empty, the default
// for every artist) implies no restriction at all, same "advisory only"
// convention as ArtistDetail.tsx's own editor for this same field.
function isArtistUnavailable(date: Date, schedule: ScheduleBlock[] | null): boolean {
  if (!schedule || schedule.length === 0) return false
  const day = schedule.find((d) => d.dayOfWeek === date.getDay())
  if (!day) return true
  const minutes = minutesOfDay(date)
  return minutes < timeToMinutes(day.startTime) || minutes >= timeToMinutes(day.endTime)
}

// Month-view analog of isArtistUnavailable, same "closed ALL day" rule
// isStudioClosedAllDay already uses -- Month view has no time-of-day
// granularity, so a day the artist works only part of still counts as a
// working day here; only a day with no schedule entry at all for that
// weekday reads as not-working.
function isArtistUnavailableAllDay(dayOfWeek: number, schedule: ScheduleBlock[] | null): boolean {
  if (!schedule || schedule.length === 0) return false
  return !schedule.some((d) => d.dayOfWeek === dayOfWeek)
}

function dateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// Guest-window shading source. Compares plain yyyy-mm-dd strings (never a
// Date-object round-trip) -- the same off-by-one-day timezone trap fixed
// in ArtistDetail.tsx applies here too: guestStartDate/guestEndDate are
// UTC-midnight ISO strings for what's really just a calendar date, and
// local getters on `new Date(isoString)` can shift it a day in either
// direction depending on the browser's timezone.
function isOutsideGuestWindow(date: Date, artist: ArtistOption): boolean {
  if (!artist.isGuest) return false
  const key = dateKey(date)
  if (artist.guestStartDate && key < artist.guestStartDate.slice(0, 10)) return true
  if (artist.guestEndDate && key > artist.guestEndDate.slice(0, 10)) return true
  return false
}

interface AppointmentApi {
  id: string
  startTime: string
  endTime: string
  status: string
  appointmentType: 'TATTOO_SESSION' | 'CONSULTATION'
  checkedOutAt: string | null
  liabilityWaiver: { status: string } | null
  client: { id: string; firstName: string; lastName: string } | null
  artist: { id: string; name: string; avatarUrl: string | null }
  inquiry: { id: string; label: string } | null
  bufferWarning?: string | null
}

interface CalEvent {
  id: string
  title: string
  start: Date
  end: Date
  resourceId: string
  appointment: AppointmentApi
}

// The shape passed as `resources` (resourceIdAccessor: 'id', resourceTitleAccessor: 'title').
interface ArtistResource {
  id: string
  title: string
}

const withDragAndDropUnwrapped = (
  typeof dragAndDropModule === 'function' ? dragAndDropModule : (dragAndDropModule as { default: typeof dragAndDropModule }).default
) as typeof dragAndDropModule
// Without explicit generics here, the wrapped component's event/resource
// types default to a bare `object`, which is what made onEventDrop/
// onEventResize's handler signatures mismatch CalEvent downstream (TS2769).
// BigCalendar is a generic class component; referencing it bare gives it
// the library's own defaults, so it's cast to the concrete shape this app
// actually uses before being threaded through the wrapper's generics.
const DnDCalendar = withDragAndDropUnwrapped<CalEvent, ArtistResource>(
  BigCalendar as unknown as ComponentType<CalendarProps<CalEvent, ArtistResource>>,
)
const MOBILE_BREAKPOINT = 768

function artistDisplayName(artist: ArtistOption): string {
  return artist.user.name ?? artist.user.email
}

function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < MOBILE_BREAKPOINT)
  useEffect(() => {
    function onResize() {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return isMobile
}

// The current-time-indicator line's Y position (Day/Week view) is computed
// by react-big-calendar internally off plain local getters (getHours()/
// getMinutes()), which always read the BROWSER's timezone -- there's no
// timezone parameter to hand it. To make the line land at the studio's own
// wall-clock time instead, this reads the real instant's wall-clock parts
// AS OBSERVED in the studio's timezone (same Intl.DateTimeFormat technique
// format.ts's civilDateParts already uses for "today" comparisons) and
// rebuilds a new Date from those parts using the browser's own local
// constructor -- so its local getters return the studio's time instead of
// the browser's, exactly what RBC's own positioning math needs.
function studioNow(timeZone: string): Date {
  const now = new Date()
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(now)
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0)
  // Some engines render midnight as "24" under hour12: false.
  const hour = get('hour') % 24
  return new Date(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'))
}

function rangeForView(date: Date, view: View): { start: Date; end: Date } {
  if (view === Views.MONTH) {
    return { start: dayjs(date).startOf('month').startOf('week').toDate(), end: dayjs(date).endOf('month').endOf('week').toDate() }
  }
  if (view === Views.DAY) {
    return { start: dayjs(date).startOf('day').toDate(), end: dayjs(date).endOf('day').toDate() }
  }
  return { start: dayjs(date).startOf('week').toDate(), end: dayjs(date).endOf('week').toDate() }
}

// A same-local-day pre-check using the browser's own timezone -- a fast
// client-side guard, not the authority. The API re-validates in the
// studio's configured timezone (Phase UI-4's isSameCalendarDay) regardless,
// so a rare mismatch between browser and studio timezone can only ever
// make this pre-check slightly too strict or too lax, never unsafe.
function isSameLocalDay(a: Date, b: Date): boolean {
  return a.toDateString() === b.toDateString()
}

// RBC's real `views` prop type is a union: either a plain View[] (what this
// app always actually passes) or an object of per-view booleans/components
// (`{ month?: boolean, week?: boolean, ... }`) -- the toolbar's declared
// prop type has to accept the full union to satisfy Components.toolbar's
// type, so this normalizes either shape back down to a plain array.
function viewsAsArray(views: ViewsProps<CalEvent, ArtistResource>): View[] {
  if (Array.isArray(views)) return views
  return (Object.keys(views) as View[]).filter((key) => Boolean(views[key]))
}

function CalendarToolbar({ date, label, view, views, onNavigate, onView }: ToolbarProps<CalEvent, ArtistResource>) {
  const viewList = viewsAsArray(views)
  // Self-gating like Eyebrow/StatusPill -- this is its own function
  // component (a react-big-calendar Components.toolbar override), so it
  // reads the theme directly rather than needing it threaded down as a prop.
  const { shape } = useThemePreset()
  const isEditorial = shape === 'editorial'

  const navBtnClass = isEditorial
    ? 'editorial-btn-secondary rounded-full border px-3 py-1.5 transition'
    : 'rounded-full border border-border px-3 py-1.5 text-sm font-medium text-fg transition hover:bg-surface'

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => onNavigate('TODAY')} className={navBtnClass}>
          Today
        </button>
        <button type="button" onClick={() => onNavigate('PREV')} className={navBtnClass}>
          Back
        </button>
        <button type="button" onClick={() => onNavigate('NEXT')} className={navBtnClass}>
          Next
        </button>
        <span className={isEditorial ? 'ml-2 font-display text-base font-normal text-fg' : 'ml-2 text-sm font-semibold text-fg'}>
          {label}
        </span>
      </div>

      <div className="flex items-center gap-3">
        {/* Jump-to-date -- the same DatePickerField every other single-date
            field in this app already uses (ArtistDetail.tsx's guest window,
            DateAndTimeRangeFields' own date field), not a second date-picker
            pattern. Its value never has to persist as "the selected date"
            the way a form field's would -- picking a date immediately
            navigates there (any view) and the popover closes itself, so it
            always resets back to reflecting whatever's currently showing. */}
        <div className="w-40">
          <DatePickerField
            id="calendar-jump-to-date"
            value={toDateString(date)}
            onChange={(next) => {
              const parsed = parseDateString(next)
              if (parsed) onNavigate('DATE', parsed)
            }}
            placeholder="Jump to date"
          />
        </div>

        {viewList.length > 1 && (
        <div className={isEditorial ? 'flex gap-0.5 rounded-full bg-surface p-[3px]' : 'flex gap-1 rounded-full border border-border p-1'}>
          {viewList.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => onView(v)}
              className={
                isEditorial
                  ? [
                      'editorial-btn-secondary rounded-full border px-3 py-1 capitalize transition',
                      v === view ? 'is-active' : 'border-transparent text-fg-muted hover:border-border-strong',
                    ].join(' ')
                  : `rounded-full px-3 py-1 text-xs font-medium capitalize transition ${
                      v === view ? 'bg-accent text-bg' : 'text-fg-secondary hover:bg-surface'
                    }`
              }
            >
              {v}
            </button>
          ))}
        </div>
        )}
      </div>
    </div>
  )
}

export default function Calendar() {
  const { user } = useAuth()
  const { shape } = useThemePreset()
  const isEditorial = shape === 'editorial'
  const effectiveUser = useEffectiveUser()
  const { profile } = useUserProfile()
  const isArtist = effectiveUser?.role === 'ARTIST'
  // Solo artist architecture, Phase 3: a solo artist (no OWNER/FRONT_DESK
  // besides themselves) gets an additional, backend-granted allow-path for
  // these two keys that never shows up in profile.permissions (that list
  // stays a pure role-level computation -- see lib/permissions.ts's own
  // comment on requirePermissionOrSoloArtist) -- so the frontend gate has
  // to OR in profile.isSoloStudioArtist directly, or the button would
  // never render even though the backend would accept the request.
  const canCreateAppointment = (profile?.permissions.includes('appointments.create') ?? false) || (profile?.isSoloStudioArtist ?? false)
  const canRescheduleAppointment = (profile?.permissions.includes('appointments.reschedule') ?? false) || (profile?.isSoloStudioArtist ?? false)
  // Picks which calendar variant renders (full drag-and-drop vs read-only)
  // -- the interactive one is worth showing if either underlying action is
  // actually available; handleSelectSlot/applyAppointmentTimeChange below
  // each re-check their own specific permission too, since a studio could
  // grant just one of the two.
  const canManageCalendar = canCreateAppointment || canRescheduleAppointment
  const queryClient = useQueryClient()
  const isMobile = useIsMobile()
  useMarkSectionSeen('appointments')

  const [view, setView] = useState<View>(Views.MONTH)
  const [date, setDate] = useState(new Date())
  // null = "all artists" (the default); once staff toggle a chip, an
  // explicit array takes over.
  const [selectedArtistIds, setSelectedArtistIds] = useState<string[] | null>(null)
  const [mobileArtistId, setMobileArtistId] = useState<string | undefined>(undefined)
  const [previewAppointment, setPreviewAppointment] = useState<AppointmentApi | null>(null)
  const [createSlot, setCreateSlot] = useState<{
    date: string
    startTime: string
    endTime: string
    artistId?: string
    // Set only via the prefill-query-param path below (AppointmentDetail's
    // "Book follow-up" / "Book the tattoo session now" deep links) --
    // click-to-create never sets these, since the client/project aren't
    // known yet from an empty slot click.
    clientId?: string
    inquiryId?: string
  } | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const [dragError, setDragError] = useState<string | null>(null)
  const [bufferNotice, setBufferNotice] = useState<string | null>(null)
  const [includePastGuests, setIncludePastGuests] = useState(false)

  // AppointmentDetail's checkout "Book follow-up" (and the consultation
  // completion flow's "Book the tattoo session now" shortcut) both land
  // here via ?prefillClientId=&prefillInquiryId=&prefillArtistId= --
  // auto-opens the same create modal click-to-create uses, pre-filled,
  // rather than a bare calendar with the params silently ignored. Strips
  // the params from the URL right after reading them so a refresh or
  // back-navigation doesn't reopen the modal a second time.
  useEffect(() => {
    if (!canManageCalendar) return
    const clientId = searchParams.get('prefillClientId')
    const inquiryId = searchParams.get('prefillInquiryId')
    if (!clientId || !inquiryId) return

    const artistId = searchParams.get('prefillArtistId') ?? undefined
    const now = new Date()
    setCreateSlot({
      date: dayjs(now).format('YYYY-MM-DD'),
      startTime: dayjs(now).add(1, 'hour').startOf('hour').format('HH:mm'),
      endTime: dayjs(now).add(2, 'hour').startOf('hour').format('HH:mm'),
      artistId,
      clientId,
      inquiryId,
    })
    setSearchParams((params) => {
      params.delete('prefillClientId')
      params.delete('prefillInquiryId')
      params.delete('prefillArtistId')
      return params
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManageCalendar, searchParams])

  // Resource columns don't fit at phone widths -- fall back to a single
  // day view regardless of the desktop view state (which is preserved so
  // resizing back to desktop restores it).
  const effectiveView = isMobile ? Views.DAY : view
  const availableViews = useMemo<View[]>(() => (isMobile ? [Views.DAY] : [Views.MONTH, Views.WEEK, Views.DAY]), [isMobile])

  const { start: rangeStart, end: rangeEnd } = useMemo(() => rangeForView(date, effectiveView), [date, effectiveView])

  // Keyboard shortcuts -- arrow keys move by the current view's own
  // increment (matches RBC's own Day/Week/Month .navigate() static methods
  // exactly: a day, a week, a month respectively, confirmed by reading
  // them rather than guessed), "T" jumps to today, same effect as clicking
  // the Today button. Bails out entirely whenever focus is inside a text
  // input, textarea, select, or any other contenteditable -- unlike this
  // app's other global keydown listeners (Escape, Cmd/Ctrl+K), a bare
  // arrow key or letter is exactly the kind of thing normal typing already
  // uses, so this one needs its own explicit guard rather than being safe
  // by construction.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) {
        return
      }

      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        const unit = effectiveView === Views.MONTH ? 'month' : effectiveView === Views.WEEK ? 'week' : 'day'
        const direction = event.key === 'ArrowLeft' ? -1 : 1
        event.preventDefault()
        setDate((current) => dayjs(current).add(direction, unit).toDate())
      } else if (event.key === 't' || event.key === 'T') {
        event.preventDefault()
        setDate(new Date())
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [effectiveView])

  const { data: artistOptions } = useQuery({
    queryKey: ['artists-for-calendar', user!.studioId],
    queryFn: () => apiFetch<ArtistOption[]>('/artists'),
    enabled: !isArtist,
  })

  // Studio-closed shading applies everywhere, including the ARTIST-effective
  // single-agenda view, so this is fetched regardless of role (GET
  // /studios/:studioId/locations is readable by any authenticated studio
  // member, not gated behind locations.manage -- that permission only
  // covers creating/editing/deleting).
  const { data: locations } = useQuery({
    queryKey: ['locations-for-calendar', user!.studioId],
    queryFn: () => apiFetch<LocationOption[]>(`/studios/${user!.studioId}/locations`),
  })
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null)
  const activeLocation =
    locations?.find((l) => l.id === selectedLocationId) ?? locations?.[0] ?? null
  const businessHours = activeLocation?.hours ?? undefined

  // Per-user saved Calendar preference (view/filter/location/past-guests --
  // deliberately not the currently-viewed date, see the schema's own
  // comment on why). Seeded into the local state above exactly once, the
  // moment it loads -- adjusted during render rather than an effect, same
  // "reset local state from a query result" pattern this app already uses
  // elsewhere (e.g. InquiryDetail.tsx's estimate form). Every subsequent
  // user-initiated change to one of these four goes through
  // updateCalendarPreferences below, which both updates local state (for
  // the current session) and persists it (for the next visit).
  const { preferences: calendarPreferences, persist: persistCalendarPreferences } = useCalendarPreferences()
  const [seededCalendarPreferences, setSeededCalendarPreferences] = useState(false)
  if (calendarPreferences && !seededCalendarPreferences) {
    setSeededCalendarPreferences(true)
    setView(
      calendarPreferences.view === 'week' ? Views.WEEK : calendarPreferences.view === 'day' ? Views.DAY : Views.MONTH,
    )
    setSelectedArtistIds(calendarPreferences.selectedArtistIds)
    setSelectedLocationId(calendarPreferences.selectedLocationId)
    setIncludePastGuests(calendarPreferences.includePastGuests)
  }

  function updateCalendarPreferences(partial: Partial<CalendarPreferences>) {
    persistCalendarPreferences({
      view: view === Views.WEEK ? 'week' : view === Views.DAY ? 'day' : 'month',
      selectedArtistIds,
      selectedLocationId,
      includePastGuests,
      ...partial,
    })
  }

  // The live current-time indicator (Day/Week view) needs the studio's own
  // configured timezone, not the browser's -- same GET /studio-settings
  // Settings.tsx already reads for this exact reason (see its own
  // formatRelativeDateTime usage). Falls back to the same default the
  // backend's own same-day validation uses when a studio hasn't set one.
  const { data: studioSettings } = useQuery({
    queryKey: ['studio-settings-for-calendar', user!.studioId],
    queryFn: () => apiFetch<{ timezone: string }>('/studio-settings'),
  })
  const studioTimezone = studioSettings?.timezone ?? 'America/New_York'

  // Ended guests are excluded from every column/filter/switcher below by
  // default -- "Include past availability windows" brings them back without ever hiding
  // their actual past appointments (Month view already shows everyone
  // regardless, see displayEvents below).
  const visibleArtistOptions = useMemo(
    () => artistOptions?.filter((a) => includePastGuests || !isEndedGuest(a)),
    [artistOptions, includePastGuests],
  )
  const hasEndedGuests = artistOptions?.some(isEndedGuest) ?? false

  useEffect(() => {
    if (!mobileArtistId && visibleArtistOptions && visibleArtistOptions.length > 0) {
      setMobileArtistId(visibleArtistOptions[0].id)
    }
  }, [visibleArtistOptions, mobileArtistId])

  const rangeKey = appointmentsRangeQueryKey(user!.studioId, rangeStart.toISOString(), rangeEnd.toISOString())

  const {
    data: appointments,
    isLoading,
    isFetching,
    error,
  } = useQuery({
    queryKey: rangeKey,
    queryFn: () =>
      apiFetch<AppointmentApi[]>(
        `/appointments?start=${encodeURIComponent(rangeStart.toISOString())}&end=${encodeURIComponent(rangeEnd.toISOString())}`,
      ),
    // Every Back/Next/Today click or view switch is a brand new range, so a
    // brand new queryKey -- without this, `data` reset to undefined on
    // every single one of those, replacing the whole calendar with the
    // plain "Loading…" text below and blanking out whatever was already on
    // screen. This keeps last range's events visible (isLoading only ever
    // true on this page's very first load, with nothing to show yet) while
    // isFetching drives a small, non-blocking indicator instead.
    placeholderData: keepPreviousData,
  })

  const errorMessage = error
    ? error instanceof ApiError && error.status === 403
      ? "You don't have permission to view the calendar."
      : error.message
    : null

  const events = useMemo<CalEvent[]>(
    () =>
      (appointments ?? []).map((appt) => ({
        id: appt.id,
        title: `${appt.status === 'REQUESTED' ? 'Requested: ' : appt.appointmentType === 'CONSULTATION' ? 'Consult: ' : ''}${appt.client ? `${appt.client.firstName} ${appt.client.lastName}` : 'Unknown client'}`,
        start: new Date(appt.startTime),
        end: new Date(appt.endTime),
        resourceId: appt.artist.id,
        appointment: appt,
      })),
    [appointments],
  )

  const showResourceColumns = canManageCalendar && !isMobile && effectiveView !== Views.MONTH

  const activeArtistIds = useMemo(
    () => selectedArtistIds ?? visibleArtistOptions?.map((a) => a.id) ?? [],
    [selectedArtistIds, visibleArtistOptions],
  )

  // Month view's per-day "not working / working, open / working, booked"
  // read only makes unambiguous sense narrowed to ONE artist -- with two+
  // selected, "working" would have to mean "any of them," which stops
  // reading as an answer to "was THIS artist continuously booked." Filters
  // down to just their appointments either way (see displayEvents above);
  // this only gates the extra day-state coloring below.
  const filteredSingleArtist =
    selectedArtistIds && selectedArtistIds.length === 1
      ? visibleArtistOptions?.find((a) => a.id === selectedArtistIds[0])
      : undefined

  const displayEvents = useMemo(() => {
    if (isArtist) return events
    if (isMobile) return mobileArtistId ? events.filter((e) => e.resourceId === mobileArtistId) : events
    // Month view: unfiltered (selectedArtistIds still null, staff hasn't
    // touched a chip yet) keeps its original "show everyone regardless"
    // behavior -- including an ended guest's past appointments, which
    // aren't in activeArtistIds at all once "Include past availability windows" is off
    // (see the comment on that state above). Only once staff explicitly
    // picks a chip does Month view start narrowing down, same as Week/Day
    // already did.
    if (effectiveView === Views.MONTH) {
      return selectedArtistIds === null ? events : events.filter((e) => activeArtistIds.includes(e.resourceId))
    }
    return events.filter((e) => activeArtistIds.includes(e.resourceId))
  }, [events, isArtist, isMobile, mobileArtistId, effectiveView, activeArtistIds, selectedArtistIds])

  const resources = useMemo(() => {
    if (!showResourceColumns || !visibleArtistOptions) return undefined
    return visibleArtistOptions
      .filter((a) => activeArtistIds.includes(a.id))
      .map((a) => ({ id: a.id, title: artistDisplayName(a) }))
  }, [showResourceColumns, visibleArtistOptions, activeArtistIds])

  function toggleArtistFilter(id: string) {
    const base = selectedArtistIds ?? visibleArtistOptions?.map((a) => a.id) ?? []
    const next = base.includes(id) ? base.filter((x) => x !== id) : [...base, id]
    setSelectedArtistIds(next)
    updateCalendarPreferences({ selectedArtistIds: next })
  }

  function invalidateAppointments() {
    queryClient.invalidateQueries({ queryKey: appointmentsQueryKey(user!.studioId) })
  }

  function handleAppointmentCreated() {
    setCreateSlot(null)
    invalidateAppointments()
  }

  function handleSelectSlot(slotInfo: SlotInfo) {
    if (!canCreateAppointment) return
    const start = slotInfo.start as Date
    const end = slotInfo.end as Date
    setCreateSlot({
      date: dayjs(start).format('YYYY-MM-DD'),
      startTime: dayjs(start).format('HH:mm'),
      endTime: dayjs(end > start ? end : dayjs(start).add(1, 'hour').toDate()).format('HH:mm'),
      artistId: typeof slotInfo.resourceId === 'string' ? slotInfo.resourceId : undefined,
    })
  }

  // Shared by both drag-reschedule and edge-resize below -- both end up
  // wanting the same same-day check and the same PATCH /appointments/:id
  // call (never a bespoke resize-only endpoint), differing only in what
  // they validate about resourceId beforehand and what error copy makes
  // sense for what the user just did.
  async function applyAppointmentTimeChange(event: CalEvent, newStart: Date, newEnd: Date) {
    if (!canRescheduleAppointment) return
    if (!isSameLocalDay(newStart, newEnd)) {
      setDragError("Appointments can't span more than one day — try a shorter session or a different time.")
      return
    }

    try {
      const updated = await apiFetch<AppointmentApi>(`/appointments/${event.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ startTime: newStart.toISOString(), endTime: newEnd.toISOString() }),
      })
      invalidateAppointments()
      if (updated.bufferWarning) setBufferNotice(updated.bufferWarning)
    } catch (err) {
      setDragError(err instanceof Error ? err.message : 'Failed to reschedule appointment')
    }
  }

  async function handleEventDrop(args: EventInteractionArgs<CalEvent>) {
    setDragError(null)
    setBufferNotice(null)

    const { event, start, end, resourceId } = args
    const newStart = start instanceof Date ? start : new Date(start)
    const newEnd = end instanceof Date ? end : new Date(end)

    // Dragging only moves time/day within the SAME artist's column -- cross-
    // column drops are a reassignment, which this feature deliberately
    // doesn't do via drag. The update route also never accepts an artistId
    // change, so this is enforced twice (see appointments.ts PATCH route).
    if (showResourceColumns && typeof resourceId === 'string' && resourceId !== event.appointment.artist.id) {
      setDragError("Reassigning to a different artist isn't done by dragging — open the appointment to change the artist.")
      return
    }

    await applyAppointmentTimeChange(event, newStart, newEnd)
  }

  // Investigated first: resizing an existing appointment's edge to change
  // its duration (distinct from dragging the whole block to reschedule)
  // was NOT already present -- resizable={false} was set explicitly below,
  // and there was no onEventResize handler at all. Added rather than
  // assumed missing. Resizing only ever changes start/end, never the
  // resourceId (RBC's own resize handles are anchored to the same column
  // the event is already in), so unlike handleEventDrop above there's no
  // cross-column reassignment case to guard against here.
  async function handleEventResize(args: EventInteractionArgs<CalEvent>) {
    setDragError(null)
    setBufferNotice(null)

    const { event, start, end } = args
    const newStart = start instanceof Date ? start : new Date(start)
    const newEnd = end instanceof Date ? end : new Date(end)

    await applyAppointmentTimeChange(event, newStart, newEnd)
  }

  // Same muted token react-big-calendar's own "off-range day" background
  // already uses (index.css's .rbc-off-range-bg) -- reused here rather
  // than introducing a second grey, for all three shading sources.
  const GREY_STYLE = { style: { backgroundColor: 'var(--color-surface-inset)' } }
  // "Working, but nothing booked yet" -- a light success tint, same
  // color-mix-over-transparent pattern index.css already uses for other
  // translucent accents, so a run of these reads as an obviously open
  // stretch without being confused for either the grey closed state or an
  // actual booked event's solid artist color.
  const OPEN_STYLE = { style: { backgroundColor: 'color-mix(in srgb, var(--color-success) 14%, transparent)' } }
  // Weekend orientation tint -- a plain wayfinding convention (this is
  // Saturday/Sunday), NOT an availability signal, so it only ever applies
  // where nothing else has already spoken for that day/slot: never over
  // the studio-closed grey (redundant -- that grey already means "not a
  // working day," which is exactly what a studio that closes weekends is
  // already saying), and never in Month view's single-artist-filtered mode
  // (that view's own grey/open/booked states are the primary signal there;
  // layering a second one would just be noise). --color-surface-raised,
  // not a color-mix -- distinct at a glance from both the closed grey and
  // the artist-filtered open-green, and reuses an existing flat token
  // rather than introducing a fourth translucent recipe.
  const WEEKEND_STYLE = { style: { backgroundColor: 'var(--color-surface-raised)' } }

  function isWeekendDay(dayOfWeek: number): boolean {
    return dayOfWeek === 0 || dayOfWeek === 6
  }

  function slotPropGetter(date: Date, resourceId?: number | string) {
    if (isStudioClosed(date, businessHours)) return GREY_STYLE

    if (typeof resourceId === 'string') {
      const artist = visibleArtistOptions?.find((a) => a.id === resourceId)
      if (artist && (isArtistUnavailable(date, artist.preferredSchedule) || isOutsideGuestWindow(date, artist))) {
        return GREY_STYLE
      }
    }

    if (isWeekendDay(date.getDay())) return WEEKEND_STYLE

    return {}
  }

  // Month view only -- no resource columns there, so studio-closed is
  // date-of-week only (a partially-open day has no meaningful "grey half
  // the cell" in a view with no time-of-day granularity; only a fully
  // closed day greys). Narrowed to exactly one filtered artist (see
  // filteredSingleArtist above), this also layers in that artist's own
  // not-working days and then splits every remaining working day into
  // "open" vs "booked" using displayEvents -- already filtered to just
  // their appointments by the fix above, so a plain same-day match is
  // enough, no separate per-artist lookup needed.
  function dayPropGetter(date: Date) {
    if (isStudioClosedAllDay(date.getDay(), businessHours)) return GREY_STYLE

    if (filteredSingleArtist) {
      if (
        isArtistUnavailableAllDay(date.getDay(), filteredSingleArtist.preferredSchedule) ||
        isOutsideGuestWindow(date, filteredSingleArtist)
      ) {
        return GREY_STYLE
      }
      const hasBookingThisDay = displayEvents.some((e) => isSameLocalDay(e.start, date))
      if (!hasBookingThisDay) return OPEN_STYLE
      return {}
    }

    if (isWeekendDay(date.getDay())) return WEEKEND_STYLE

    return {}
  }

  const commonCalendarProps = {
    localizer,
    events: displayEvents,
    startAccessor: 'start' as const,
    endAccessor: 'end' as const,
    resourceIdAccessor: 'id' as const,
    resourceTitleAccessor: 'title' as const,
    resources,
    // Without this, RBC's Week/Day time grid only ever renders one
    // resource header spanning every day column. With it, each day column
    // is itself subdivided into one sub-column per active artist -- the
    // "resource columns" the spec calls for.
    resourceGroupingLayout: showResourceColumns,
    view: effectiveView,
    views: availableViews,
    date,
    // Studio-timezone-aware "now" for the Day/Week current-time-indicator
    // line -- RBC's own default (`() => new Date()`) already self-updates
    // this every 60s on its own internal timer, so no separate interval is
    // needed here, just a studio-local instant instead of the browser's.
    getNow: () => studioNow(studioTimezone),
    onNavigate: (next: Date) => setDate(next),
    onView: (next: View) => {
      setView(next)
      updateCalendarPreferences({ view: next === Views.WEEK ? 'week' : next === Views.DAY ? 'day' : 'month' })
    },
    onSelectEvent: (event: CalEvent) => setPreviewAppointment(event.appointment),
    // Color still encodes artist (unchanged); a consultation additionally
    // gets a dashed accent border so it reads as visually distinct from a
    // real tattoo session at a glance -- no separate legend needed, same
    // as this grid already relies on artist-chip colors being self-
    // explanatory rather than a legend.
    //
    // Front-desk approval, Part 1: a client-self-scheduled REQUESTED
    // appointment previously looked IDENTICAL to a real CONFIRMED one here
    // (same artist color, no border unless it happened to be a
    // consultation) -- nothing on the Calendar itself signaled "this still
    // needs a staff decision." Takes precedence over the consultation
    // border (self-scheduling only ever creates TATTOO_SESSION rows today,
    // so the two never actually collide) -- dotted rather than dashed, and
    // the theme's own --color-info (already used for REQUESTED's
    // StatusPill tone everywhere else) rather than the accent color, so
    // it's not mistaken for a consultation at a glance. No new fill color,
    // just a border -- Editorial Gold rule.
    eventPropGetter: (event: CalEvent) => ({
      style: {
        backgroundColor: colorForArtistId(event.appointment.artist.id),
        borderColor:
          event.appointment.status === 'REQUESTED'
            ? 'var(--color-info)'
            : event.appointment.appointmentType === 'CONSULTATION'
              ? 'var(--color-accent)'
              : 'transparent',
        borderWidth: event.appointment.status === 'REQUESTED' || event.appointment.appointmentType === 'CONSULTATION' ? '2px' : undefined,
        borderStyle: event.appointment.status === 'REQUESTED' ? 'dotted' : event.appointment.appointmentType === 'CONSULTATION' ? 'dashed' : undefined,
      },
    }),
    slotPropGetter,
    dayPropGetter,
    components: { toolbar: CalendarToolbar },
    style: { height: isMobile ? 560 : 680 },
  }

  return (
    <>
        <div className="mx-auto max-w-7xl px-6 py-6 sm:px-10 sm:py-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              {isEditorial && <Eyebrow>The studio's own schedule.</Eyebrow>}
              <h1
                className={
                  isEditorial
                    ? 'mt-1 font-display text-[clamp(28px,3.4vw,38px)] font-normal tracking-[-0.015em] text-fg'
                    : 'text-2xl font-bold text-fg sm:text-3xl'
                }
              >
                Calendar
              </h1>
              {!isEditorial && (
                <p className="mt-1 text-sm text-fg-secondary">
                  {canManageCalendar
                    ? 'Every booking across your studio. Click a slot to book, drag to reschedule.'
                    : 'Your upcoming and past appointments.'}
                </p>
              )}
            </div>
          </div>

          {canManageCalendar && !isMobile && visibleArtistOptions && visibleArtistOptions.length > 1 && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium uppercase tracking-wide text-fg-muted">Artists</span>
              {visibleArtistOptions.map((artist) => {
                const active = activeArtistIds.includes(artist.id)
                return (
                  <button
                    key={artist.id}
                    type="button"
                    onClick={() => toggleArtistFilter(artist.id)}
                    className={
                      isEditorial
                        ? [
                            'editorial-btn-secondary flex items-center gap-1.5 rounded-full border py-1 pl-1 pr-3 transition',
                            active ? 'is-active' : 'border-transparent text-fg-muted hover:border-border-strong',
                          ].join(' ')
                        : `flex items-center gap-1.5 rounded-full border py-1 pl-1 pr-3 text-xs font-medium transition ${
                            active
                              ? 'border-accent bg-accent/10 text-accent'
                              : 'border-border text-fg-muted hover:bg-surface'
                          }`
                    }
                  >
                    <ArtistAvatar artist={artist} className="h-5 w-5" />
                    {artistDisplayName(artist)}
                  </button>
                )
              })}
              {hasEndedGuests && (
                <label className="ml-2 flex items-center gap-1.5 text-xs text-fg-muted">
                  <input
                    type="checkbox"
                    checked={includePastGuests}
                    onChange={(e) => {
                      setIncludePastGuests(e.target.checked)
                      updateCalendarPreferences({ includePastGuests: e.target.checked })
                    }}
                    className="h-3.5 w-3.5 rounded border-border bg-surface-inset accent-accent"
                  />
                  Include past availability windows
                </label>
              )}
            </div>
          )}

          {locations && locations.length > 1 && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium uppercase tracking-wide text-fg-muted">Hours for</span>
              <select
                value={activeLocation?.id ?? ''}
                onChange={(event) => {
                  setSelectedLocationId(event.target.value)
                  updateCalendarPreferences({ selectedLocationId: event.target.value })
                }}
                className={
                  isEditorial
                    ? 'editorial-btn-secondary rounded-full border px-3 py-1 transition focus:border-accent focus:outline-none'
                    : 'rounded-full border border-border bg-surface-inset px-3 py-1 text-xs font-medium text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent'
                }
              >
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {isMobile && !isArtist && visibleArtistOptions && visibleArtistOptions.length > 1 && (
            <div className="mt-4">
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-fg-muted">Artist</label>
              <ArtistSelect
                id="mobileArtistId"
                artists={visibleArtistOptions}
                value={mobileArtistId ?? null}
                onChange={(artistId) => setMobileArtistId(artistId ?? visibleArtistOptions[0].id)}
              />
              {hasEndedGuests && (
                <label className="mt-2 flex items-center gap-1.5 text-xs text-fg-muted">
                  <input
                    type="checkbox"
                    checked={includePastGuests}
                    onChange={(e) => {
                      setIncludePastGuests(e.target.checked)
                      updateCalendarPreferences({ includePastGuests: e.target.checked })
                    }}
                    className="h-3.5 w-3.5 rounded border-border bg-surface-inset accent-accent"
                  />
                  Include past availability windows
                </label>
              )}
            </div>
          )}

          {dragError && (
            <div className="mt-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
              {dragError}
            </div>
          )}
          {bufferNotice && (
            <div className="mt-4 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
              {bufferNotice}
            </div>
          )}
          {errorMessage && (
            <div className="mt-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
              {errorMessage}
            </div>
          )}

          {/* Keyed on view+date so switching Month/Week/Day or navigating
              forward/back remounts this wrapper and replays the same
              entrance animation already established elsewhere in this app
              (ConversationsPanel's own popovers/new-message rows) --
              replacing RBC's own instant, jarring re-render with the same
              fade-slide-up every other "new content just appeared" moment
              in this app already uses, not a bespoke calendar-only motion. */}
          <div key={`${effectiveView}-${dayjs(date).format('YYYY-MM-DD')}`} className="animate-fade-slide-up">
            {/* No .card-surface here, deliberately -- the calendar grid is
                dense, information-critical content (same category as
                Conversations' thread list), not a glass-treatment
                candidate. It had .card-surface applied (likely from an
                earlier broad template pass, not a deliberate choice) --
                removed so it stays fully solid/opaque under Editorial
                Gold, matching the rule already applied to Conversations. */}
            <div className="mt-4 rounded-2xl border border-border bg-surface p-4 sm:p-5">
              {isLoading ? (
                <p className="text-sm text-fg-secondary">Loading…</p>
              ) : (
                <div
                  className={`transition-opacity duration-base ${isFetching ? 'opacity-60' : 'opacity-100'}`}
                >
                  {canManageCalendar ? (
                    <DnDCalendar
                      {...commonCalendarProps}
                      selectable
                      resizable
                      onSelectSlot={handleSelectSlot}
                      onEventDrop={handleEventDrop}
                      onEventResize={handleEventResize}
                    />
                  ) : (
                    // ARTIST (effective, via useEffectiveUser -- View As
                    // included): the plain, non-drag-and-drop Calendar
                    // component, with no onSelectSlot handler at all. This
                    // isn't the DnD-wrapped component with props merely
                    // omitted -- it's a different component that never
                    // attaches drag listeners in the first place, so
                    // there's nothing to disable.
                    <BigCalendar {...commonCalendarProps} />
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

      {createSlot && (
        <Modal title="New Appointment" onClose={() => setCreateSlot(null)}>
          <AppointmentForm
            fixedClientId={createSlot.clientId}
            fixedInquiryId={createSlot.inquiryId}
            initialArtistId={createSlot.artistId}
            initialDate={createSlot.date}
            initialStartTime={createSlot.startTime}
            initialEndTime={createSlot.endTime}
            onCreated={handleAppointmentCreated}
            onCancel={() => setCreateSlot(null)}
          />
        </Modal>
      )}

      {previewAppointment && (
        <Modal title="Appointment" onClose={() => setPreviewAppointment(null)}>
          <div className="space-y-3 text-sm">
            {previewAppointment.appointmentType === 'CONSULTATION' && (
              <span className="inline-block rounded-full border border-accent/30 bg-accent/10 px-2.5 py-0.5 text-xs font-medium text-accent">
                Consultation
              </span>
            )}
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-fg-muted">Client</p>
              <p className="text-fg">
                {previewAppointment.client
                  ? `${previewAppointment.client.firstName} ${previewAppointment.client.lastName}`
                  : 'Unknown client'}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-fg-muted">Time</p>
              <p className="text-fg">
                {formatDateTime(previewAppointment.startTime)} – {formatDateTime(previewAppointment.endTime)}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-fg-muted">Artist</p>
              <p className="flex items-center gap-1.5 text-fg">
                <FlatArtistAvatar
                  name={previewAppointment.artist.name}
                  avatarUrl={previewAppointment.artist.avatarUrl}
                  className="h-5 w-5"
                />
                {previewAppointment.artist.name}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-fg-muted">Status</p>
              <StatusPill status={describeAppointmentStatus(previewAppointment)} />
            </div>
            <Link
              to={`/appointments/${previewAppointment.id}`}
              className="inline-block text-sm font-medium text-accent hover:underline"
            >
              View details →
            </Link>
          </div>
        </Modal>
      )}
    </>
  )
}
