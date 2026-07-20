import { useEffect, useMemo, useState, type ComponentType } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
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
import Sidebar from '../components/Sidebar'
import Modal from '../components/Modal'
import AppointmentForm from '../components/AppointmentForm'
import StatusPill from '../components/StatusPill'
import { apiFetch, ApiError } from '../lib/api'
import { formatDateTime } from '../lib/format'
import { useAuth } from '../context/useAuth'
import { useEffectiveUser } from '../context/useEffectiveUser'
import { appointmentsQueryKey, appointmentsRangeQueryKey } from '../lib/queryKeys'
import { useMarkSectionSeen } from '../lib/useMarkSectionSeen'
import { colorForArtistId } from '../lib/artistColors'

const localizer = dayjsLocalizer(dayjs)

interface ScheduleBlock {
  dayOfWeek: number
  startTime: string
  endTime: string
}

interface ArtistOption {
  id: string
  user: { name: string | null; email: string }
  isGuest: boolean
  guestStartDate: string | null
  guestEndDate: string | null
  preferredSchedule: ScheduleBlock[] | null
}

function isEndedGuest(artist: ArtistOption): boolean {
  return artist.isGuest && !!artist.guestEndDate && new Date(artist.guestEndDate) < new Date()
}

interface BusinessHoursDay {
  dayOfWeek: number
  isOpen: boolean
  openTime?: string
  closeTime?: string
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

function minutesOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes()
}

// Studio-closed shading source. No businessHours configured at all yet
// (undefined -- distinct from an empty/all-closed array) never greys
// anything, matching every other "advisory, not yet set up" field in this
// app (e.g. Artist.preferredSchedule) -- a studio that's never touched
// this setting shouldn't suddenly see its whole calendar greyed out.
function isStudioClosed(date: Date, businessHours: BusinessHoursDay[] | undefined): boolean {
  if (!businessHours || businessHours.length === 0) return false
  const day = businessHours.find((d) => d.dayOfWeek === date.getDay())
  if (!day || !day.isOpen || !day.openTime || !day.closeTime) return true
  const minutes = minutesOfDay(date)
  return minutes < timeToMinutes(day.openTime) || minutes >= timeToMinutes(day.closeTime)
}

function isStudioClosedAllDay(dayOfWeek: number, businessHours: BusinessHoursDay[] | undefined): boolean {
  if (!businessHours || businessHours.length === 0) return false
  const day = businessHours.find((d) => d.dayOfWeek === dayOfWeek)
  return !day || !day.isOpen
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
  client: { id: string; firstName: string; lastName: string } | null
  artist: { id: string; name: string }
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

function CalendarToolbar({ label, view, views, onNavigate, onView }: ToolbarProps<CalEvent, ArtistResource>) {
  const viewList = viewsAsArray(views)

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onNavigate('TODAY')}
          className="rounded-full border border-border px-3 py-1.5 text-sm font-medium text-fg transition hover:bg-surface"
        >
          Today
        </button>
        <button
          type="button"
          onClick={() => onNavigate('PREV')}
          className="rounded-full border border-border px-3 py-1.5 text-sm font-medium text-fg transition hover:bg-surface"
        >
          Back
        </button>
        <button
          type="button"
          onClick={() => onNavigate('NEXT')}
          className="rounded-full border border-border px-3 py-1.5 text-sm font-medium text-fg transition hover:bg-surface"
        >
          Next
        </button>
        <span className="ml-2 text-sm font-semibold text-fg">{label}</span>
      </div>

      {viewList.length > 1 && (
        <div className="flex gap-1 rounded-full border border-border p-1">
          {viewList.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => onView(v)}
              className={`rounded-full px-3 py-1 text-xs font-medium capitalize transition ${
                v === view ? 'bg-accent text-bg' : 'text-fg-secondary hover:bg-surface'
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function Calendar() {
  const { user } = useAuth()
  const effectiveUser = useEffectiveUser()
  const isArtist = effectiveUser?.role === 'ARTIST'
  const canManageCalendar = !isArtist
  const queryClient = useQueryClient()
  const isMobile = useIsMobile()
  useMarkSectionSeen('appointments')

  const [view, setView] = useState<View>(Views.WEEK)
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
  } | null>(null)
  const [dragError, setDragError] = useState<string | null>(null)
  const [bufferNotice, setBufferNotice] = useState<string | null>(null)
  const [includePastGuests, setIncludePastGuests] = useState(false)

  // Resource columns don't fit at phone widths -- fall back to a single
  // day view regardless of the desktop view state (which is preserved so
  // resizing back to desktop restores it).
  const effectiveView = isMobile ? Views.DAY : view
  const availableViews = useMemo<View[]>(() => (isMobile ? [Views.DAY] : [Views.MONTH, Views.WEEK, Views.DAY]), [isMobile])

  const { start: rangeStart, end: rangeEnd } = useMemo(() => rangeForView(date, effectiveView), [date, effectiveView])

  const { data: artistOptions } = useQuery({
    queryKey: ['artists-for-calendar', user!.studioId],
    queryFn: () => apiFetch<ArtistOption[]>('/artists'),
    enabled: !isArtist,
  })

  // Studio-closed shading applies everywhere, including the ARTIST-effective
  // single-agenda view, so this is fetched regardless of role (the route
  // itself is readable by OWNER/FRONT_DESK/ARTIST as of this feature).
  const { data: studioSettings } = useQuery({
    queryKey: ['studio-settings-for-calendar', user!.studioId],
    queryFn: () => apiFetch<{ businessHours: BusinessHoursDay[] | null }>('/studio-settings'),
  })
  const businessHours = studioSettings?.businessHours ?? undefined

  // Ended guests are excluded from every column/filter/switcher below by
  // default -- "Include past guests" brings them back without ever hiding
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
    error,
  } = useQuery({
    queryKey: rangeKey,
    queryFn: () =>
      apiFetch<AppointmentApi[]>(
        `/appointments?start=${encodeURIComponent(rangeStart.toISOString())}&end=${encodeURIComponent(rangeEnd.toISOString())}`,
      ),
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
        title: appt.client ? `${appt.client.firstName} ${appt.client.lastName}` : 'Unknown client',
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

  const displayEvents = useMemo(() => {
    if (isArtist) return events
    if (isMobile) return mobileArtistId ? events.filter((e) => e.resourceId === mobileArtistId) : events
    if (effectiveView === Views.MONTH) return events
    return events.filter((e) => activeArtistIds.includes(e.resourceId))
  }, [events, isArtist, isMobile, mobileArtistId, effectiveView, activeArtistIds])

  const resources = useMemo(() => {
    if (!showResourceColumns || !visibleArtistOptions) return undefined
    return visibleArtistOptions
      .filter((a) => activeArtistIds.includes(a.id))
      .map((a) => ({ id: a.id, title: artistDisplayName(a) }))
  }, [showResourceColumns, visibleArtistOptions, activeArtistIds])

  function toggleArtistFilter(id: string) {
    setSelectedArtistIds((current) => {
      const base = current ?? visibleArtistOptions?.map((a) => a.id) ?? []
      return base.includes(id) ? base.filter((x) => x !== id) : [...base, id]
    })
  }

  function invalidateAppointments() {
    queryClient.invalidateQueries({ queryKey: appointmentsQueryKey(user!.studioId) })
  }

  function handleAppointmentCreated() {
    setCreateSlot(null)
    invalidateAppointments()
  }

  function handleSelectSlot(slotInfo: SlotInfo) {
    if (!canManageCalendar) return
    const start = slotInfo.start as Date
    const end = slotInfo.end as Date
    setCreateSlot({
      date: dayjs(start).format('YYYY-MM-DD'),
      startTime: dayjs(start).format('HH:mm'),
      endTime: dayjs(end > start ? end : dayjs(start).add(1, 'hour').toDate()).format('HH:mm'),
      artistId: typeof slotInfo.resourceId === 'string' ? slotInfo.resourceId : undefined,
    })
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

  // Same muted token react-big-calendar's own "off-range day" background
  // already uses (index.css's .rbc-off-range-bg) -- reused here rather
  // than introducing a second grey, for all three shading sources.
  const GREY_STYLE = { style: { backgroundColor: 'var(--color-surface-inset)' } }

  function slotPropGetter(date: Date, resourceId?: number | string) {
    if (isStudioClosed(date, businessHours)) return GREY_STYLE

    if (typeof resourceId === 'string') {
      const artist = visibleArtistOptions?.find((a) => a.id === resourceId)
      if (artist && (isArtistUnavailable(date, artist.preferredSchedule) || isOutsideGuestWindow(date, artist))) {
        return GREY_STYLE
      }
    }

    return {}
  }

  // Month view only -- no resource columns there, so this is studio-closed
  // only (a partially-open day has no meaningful "grey half the cell" in a
  // view with no time-of-day granularity; only a fully closed day greys).
  function dayPropGetter(date: Date) {
    return isStudioClosedAllDay(date.getDay(), businessHours) ? GREY_STYLE : {}
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
    onNavigate: (next: Date) => setDate(next),
    onView: (next: View) => setView(next),
    onSelectEvent: (event: CalEvent) => setPreviewAppointment(event.appointment),
    eventPropGetter: (event: CalEvent) => ({
      style: { backgroundColor: colorForArtistId(event.appointment.artist.id), borderColor: 'transparent' },
    }),
    slotPropGetter,
    dayPropGetter,
    components: { toolbar: CalendarToolbar },
    style: { height: isMobile ? 560 : 680 },
  }

  return (
    <div className="flex min-h-screen bg-bg text-fg">
      <Sidebar />

      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl px-6 py-6 sm:px-10 sm:py-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-fg sm:text-3xl">Calendar</h1>
              <p className="mt-1 text-sm text-fg-secondary">
                {canManageCalendar
                  ? 'Every booking across your studio. Click a slot to book, drag to reschedule.'
                  : 'Your upcoming and past appointments.'}
              </p>
            </div>
          </div>

          {canManageCalendar && !isMobile && visibleArtistOptions && visibleArtistOptions.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium uppercase tracking-wide text-fg-muted">Artists</span>
              {visibleArtistOptions.map((artist) => {
                const active = activeArtistIds.includes(artist.id)
                return (
                  <button
                    key={artist.id}
                    type="button"
                    onClick={() => toggleArtistFilter(artist.id)}
                    className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                      active
                        ? 'border-accent bg-accent/10 text-accent'
                        : 'border-border text-fg-muted hover:bg-surface'
                    }`}
                  >
                    {artistDisplayName(artist)}
                  </button>
                )
              })}
              {hasEndedGuests && (
                <label className="ml-2 flex items-center gap-1.5 text-xs text-fg-muted">
                  <input
                    type="checkbox"
                    checked={includePastGuests}
                    onChange={(e) => setIncludePastGuests(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-border bg-surface-inset accent-accent"
                  />
                  Include past guests
                </label>
              )}
            </div>
          )}

          {isMobile && !isArtist && visibleArtistOptions && visibleArtistOptions.length > 0 && (
            <div className="mt-4">
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-fg-muted">Artist</label>
              <select
                value={mobileArtistId ?? ''}
                onChange={(event) => setMobileArtistId(event.target.value)}
                className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              >
                {visibleArtistOptions.map((artist) => (
                  <option key={artist.id} value={artist.id}>
                    {artistDisplayName(artist)}
                  </option>
                ))}
              </select>
              {hasEndedGuests && (
                <label className="mt-2 flex items-center gap-1.5 text-xs text-fg-muted">
                  <input
                    type="checkbox"
                    checked={includePastGuests}
                    onChange={(e) => setIncludePastGuests(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-border bg-surface-inset accent-accent"
                  />
                  Include past guests
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

          <div className="mt-4 rounded-2xl border border-border bg-surface p-4 sm:p-5">
            {isLoading ? (
              <p className="text-sm text-fg-secondary">Loading…</p>
            ) : canManageCalendar ? (
              <DnDCalendar
                {...commonCalendarProps}
                selectable
                resizable={false}
                onSelectSlot={handleSelectSlot}
                onEventDrop={handleEventDrop}
              />
            ) : (
              // ARTIST (effective, via useEffectiveUser -- View As included):
              // the plain, non-drag-and-drop Calendar component, with no
              // onSelectSlot handler at all. This isn't the DnD-wrapped
              // component with props merely omitted -- it's a different
              // component that never attaches drag listeners in the first
              // place, so there's nothing to disable.
              <BigCalendar {...commonCalendarProps} />
            )}
          </div>
        </div>
      </div>

      {createSlot && (
        <Modal title="New Appointment" onClose={() => setCreateSlot(null)}>
          <AppointmentForm
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
              <p className="text-fg">{previewAppointment.artist.name}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-fg-muted">Status</p>
              <StatusPill status={previewAppointment.status} />
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
    </div>
  )
}
