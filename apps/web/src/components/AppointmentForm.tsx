import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import { useAuth } from '../context/useAuth'
import { clientsQueryKey, artistsQueryKey } from '../lib/queryKeys'
import { artistLabel } from './ArtistAvatar'
import ArtistSelect from './ArtistSelect'
import MiniScheduleSnippet from './MiniScheduleSnippet'
import GiftCardStackPicker, { isCardAvailable, type GiftCardOption } from './GiftCardStackPicker'
import { resolveRequiredDepositCents, resolveDepositTiers, type DepositTier } from '../lib/depositTiers'
import DateAndTimeRangeFields, {
  combineDateAndTime,
  isCompleteTimeRange,
  isValidTimeRange,
  parseDateString,
  type DateAndTimeRangeValue,
} from './DateAndTimeRangeFields'

interface ClientOption {
  id: string
  firstName: string
  lastName: string
}

interface ScheduleBlock {
  dayOfWeek: number
  startTime: string
  endTime: string
}

interface ArtistOption {
  id: string
  user: { email: string; name: string | null; avatarUrl: string | null }
  isGuest: boolean
  guestStartDate: string | null
  guestEndDate: string | null
  preferredSchedule: ScheduleBlock[] | null
  artistServices: { serviceId: string }[]
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

// Package I: preferredSchedule stays advisory (matches Calendar.tsx's own
// isArtistUnavailable shading and ArtistDetail.tsx's editor copy) -- this
// only decides whether to show a warning, never blocks submission outright.
// An artist with no configured schedule at all implies no restriction.
function isOutsidePreferredHours(schedule: ScheduleBlock[] | null | undefined, value: DateAndTimeRangeValue): boolean {
  if (!schedule || schedule.length === 0) return false
  if (!isCompleteTimeRange(value)) return false
  const date = parseDateString(value.date)
  if (!date) return false
  const day = schedule.find((d) => d.dayOfWeek === date.getDay())
  if (!day) return true
  const startMinutes = timeToMinutes(value.startTime)
  const endMinutes = timeToMinutes(value.endTime)
  return startMinutes < timeToMinutes(day.startTime) || endMinutes > timeToMinutes(day.endTime)
}

// Package D: candidates from the shared getSuggestedTimes service
// (apps/api/src/lib/schedulingAssistant.ts), the one algorithm behind both
// this panel and the deposit-form's "Suggest a time" action.
interface SuggestedTimeCandidate {
  startTime: string
  endTime: string
  hasBufferConflict: boolean
}

// New assignments never default-offer a guest artist whose window has
// ended -- they still fully exist and their past appointments are
// untouched, they just don't show up here to be picked for something new.
function isEndedGuest(artist: ArtistOption): boolean {
  return artist.isGuest && !!artist.guestEndDate && new Date(artist.guestEndDate) < new Date()
}

interface PlannedSessionOption {
  id: string
  sessionNumber: number
  estimatedHoursMin: number
  estimatedHoursMax: number
  appointmentId: string | null
  depositForm: { paidAt: string | null } | null
}

interface InquiryOption {
  id: string
  description: string
  status: string
  timeEstimateHoursMin: number | null
  timeEstimateHoursMax: number | null
  assignedArtistId: string | null
  priceEstimateLow: number | null
  priceEstimateHigh: number | null
  service: { id: string; depositModel: 'TIER_BASED' | 'FLAT'; flatDepositCents: number | null }
  plannedSessions: PlannedSessionOption[]
}

interface ClientWithProjects {
  inquiries: InquiryOption[]
  giftCards: GiftCardOption[]
}

type AppointmentType = 'TATTOO_SESSION' | 'CONSULTATION'

// Two common presets offered for a consultation's duration -- still fully
// overridable via the manual date/time fields below, this just saves the
// common case a round trip through typing an end time by hand.
const CONSULTATION_DURATION_PRESETS = [
  { minutes: 30, label: '30 min' },
  { minutes: 60, label: '1 hour' },
]

interface AppointmentFormProps {
  // When provided (the project-detail "add a session" flow), the client
  // and project are already known -- their selects are hidden rather than
  // asking staff to re-pick something already established by context.
  fixedClientId?: string
  fixedInquiryId?: string
  // Prefill only, still editable -- the calendar's click-to-create
  // interaction (Phase UI-5) opens this same form seeded with the clicked
  // slot's date/time/artist.
  initialArtistId?: string
  initialDate?: string
  initialStartTime?: string
  initialEndTime?: string
  // Pre-selects the type toggle below (e.g. InquiryDetail's dedicated
  // "Schedule Consultation" action) -- still freely switchable afterward,
  // never locked.
  initialAppointmentType?: AppointmentType
  // Multi-session planning: pre-selects the planned-session picker below
  // (InquiryDetail's own "Book Appointment" action on a specific planned
  // session's row) -- still freely changeable/clearable afterward.
  initialPlannedSessionId?: string
  onCreated: () => void
  onCancel: () => void
}

const INPUT_CLASS =
  'w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent'

// Phase UI-4/UI-5: the one shared, importable appointment-creation form --
// used by Calendar.tsx's "New Appointment" (including the checkout "Book
// follow-up" deep-link, which just prefills fixedClientId/fixedInquiryId
// through Calendar's own URL params before reaching here), InquiryDetail's
// project-nested "add a session" flow, and Phase UI-5's calendar
// click-empty-slot-to-create. Previously duplicated near-identically
// between Calendar.tsx and InquiryDetail.tsx; consolidated here so there's
// exactly one place that builds a POST /appointments payload.
export default function AppointmentForm({
  fixedClientId,
  fixedInquiryId,
  initialArtistId,
  initialDate,
  initialStartTime,
  initialEndTime,
  initialAppointmentType,
  initialPlannedSessionId,
  onCreated,
  onCancel,
}: AppointmentFormProps) {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  const [appointmentType, setAppointmentType] = useState<AppointmentType>(initialAppointmentType ?? 'TATTOO_SESSION')
  const isConsultation = appointmentType === 'CONSULTATION'
  const [consultationDurationMinutes, setConsultationDurationMinutes] = useState(30)

  const [clientId, setClientId] = useState(fixedClientId ?? '')
  const [inquiryId, setInquiryId] = useState(fixedInquiryId ?? '')
  const [plannedSessionId, setPlannedSessionId] = useState(initialPlannedSessionId ?? '')
  const [giftCardIds, setGiftCardIds] = useState<string[]>([])
  const [artistId, setArtistId] = useState(initialArtistId ?? '')
  const [timeRange, setTimeRange] = useState<DateAndTimeRangeValue>({
    date: initialDate ?? '',
    startTime: initialStartTime ?? '',
    endTime: initialEndTime ?? '',
  })
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmedOutsideHours, setConfirmedOutsideHours] = useState(false)
  const [confirmedDifferentArtist, setConfirmedDifferentArtist] = useState(false)

  // Applies the chosen preset to whatever start time is already picked;
  // if none is picked yet, this just records the preference (used the
  // moment a start time IS picked, via the effect below) rather than
  // silently doing nothing.
  function applyConsultationDuration(minutes: number) {
    setConsultationDurationMinutes(minutes)
    if (!timeRange.date || !timeRange.startTime) return
    const start = combineDateAndTime(timeRange.date, timeRange.startTime)
    if (!start) return
    const end = new Date(start.getTime() + minutes * 60_000)
    const pad = (n: number) => String(n).padStart(2, '0')
    setTimeRange({ ...timeRange, endTime: `${pad(end.getHours())}:${pad(end.getMinutes())}` })
  }

  function handleArtistChange(nextArtistId: string | null) {
    setArtistId(nextArtistId ?? '')
    setConfirmedOutsideHours(false)
    setConfirmedDifferentArtist(false)
  }

  function handleTimeRangeChange(next: DateAndTimeRangeValue) {
    setTimeRange(next)
    setConfirmedOutsideHours(false)
  }

  const { data: clientOptions } = useQuery({
    queryKey: clientsQueryKey(user!.studioId),
    queryFn: () => apiFetch<ClientOption[]>('/clients'),
    enabled: !fixedClientId,
  })

  const { data: allArtistOptions } = useQuery({
    queryKey: artistsQueryKey(user!.studioId),
    queryFn: () => apiFetch<ArtistOption[]>('/artists'),
  })

  const effectiveClientId = fixedClientId ?? clientId

  const { data: clientDetail } = useQuery({
    queryKey: ['client-projects-for-appointment', effectiveClientId],
    queryFn: () => apiFetch<ClientWithProjects>(`/clients/${effectiveClientId}`),
    enabled: !!effectiveClientId,
  })

  const { data: depositTiers } = useQuery({
    queryKey: ['studio-deposit-tiers', user!.studioId],
    queryFn: () => apiFetch<{ depositTiers: DepositTier[] }>('/studio-settings'),
    select: (data) => resolveDepositTiers(data.depositTiers),
  })

  const availableInquiries = clientDetail?.inquiries ?? []
  const availableGiftCards = (clientDetail?.giftCards ?? []).filter(isCardAvailable)

  // Suggestions need a real duration to search for -- borrowed from the
  // chosen project's own time estimate (an artist's honest guess at how
  // long this specific tattoo takes) rather than a generic guess, so the
  // whole feature stays hidden until both an artist AND a project with a
  // time estimate are picked (see the JSX gating below).
  const effectiveInquiryId = fixedInquiryId ?? inquiryId
  const selectedInquiry = availableInquiries.find((i) => i.id === effectiveInquiryId)

  // Multi-session planning: offered for any session with no appointment
  // yet, regardless of whether THAT session's own deposit form is what's
  // covering it -- gift cards and deposit exemptions stack across the
  // whole client (Phase 3), not per session, so a rolled-forward card
  // from an earlier session (or an exemption) can perfectly well satisfy
  // this one. The GiftCardStackPicker below still independently enforces
  // that enough is actually selected before Create Appointment is
  // enabled. Empty for every project with no declared plan, so this whole
  // picker (and the duration override below) stays invisible for the
  // ordinary single-session case.
  const availablePlannedSessions = (selectedInquiry?.plannedSessions ?? []).filter((ps) => !ps.appointmentId)
  const selectedPlannedSession = availablePlannedSessions.find((ps) => ps.id === plannedSessionId)

  // Service lines: once a project is known, the artist picker narrows to
  // only artists tagged (via ArtistService) as offering THAT project's
  // service -- same filtering InquiryDetail.tsx's own assignment picker
  // applies. No project picked yet (e.g. Calendar's blank "New Appointment"
  // before a client/project is chosen) shows every artist, same as before.
  const artistOptions = allArtistOptions?.filter(
    (a) => !isEndedGuest(a) && (!selectedInquiry || a.artistServices.some((s) => s.serviceId === selectedInquiry.service.id)),
  )
  const selectedArtist = artistOptions?.find((a) => a.id === artistId)

  const requiredDepositCents = resolveRequiredDepositCents(
    selectedInquiry?.service,
    selectedInquiry?.priceEstimateLow,
    selectedInquiry?.priceEstimateHigh,
    depositTiers,
  )
  const selectedGiftCardTotalCents = availableGiftCards
    .filter((c) => giftCardIds.includes(c.id))
    .reduce((sum, c) => sum + c.amountCents, 0)
  const hasSufficientGiftCards = selectedGiftCardTotalCents >= requiredDepositCents && giftCardIds.length > 0
  // A consultation skips the gift-card requirement entirely -- this is the
  // one gate that actually differs between the two appointment types.
  const financialRequirementSatisfied = isConsultation || hasSufficientGiftCards

  // Package I: default the artist picker to the inquiry's already-assigned
  // artist when opened from a project context -- the calendar's own
  // click-to-create prefill (initialArtistId) takes precedence if present,
  // and a user's own pick is never overwritten once artistId is non-empty.
  const assignedArtistId = fixedInquiryId ? (selectedInquiry?.assignedArtistId ?? null) : null
  useEffect(() => {
    if (initialArtistId || artistId || !assignedArtistId) return
    setArtistId(assignedArtistId)
  }, [initialArtistId, artistId, assignedArtistId])

  const isDifferentFromAssigned = !!assignedArtistId && !!artistId && artistId !== assignedArtistId
  const outsideHours = isOutsidePreferredHours(selectedArtist?.preferredSchedule, timeRange)

  // Days with no preferredSchedule entry at all for this artist -- greyed
  // in the calendar grid below (still fully selectable, advisory only).
  const unavailableDaysOfWeek = useMemo(() => {
    const schedule = selectedArtist?.preferredSchedule
    if (!schedule || schedule.length === 0) return undefined
    const scheduledDays = new Set(schedule.map((d) => d.dayOfWeek))
    return [0, 1, 2, 3, 4, 5, 6].filter((d) => !scheduledDays.has(d))
  }, [selectedArtist])

  const artistSelectOptions = useMemo(() => {
    if (!artistOptions || !assignedArtistId) return artistOptions
    return artistOptions.map((a) =>
      a.id === assignedArtistId
        ? { ...a, user: { ...a.user, name: `${a.user.name ?? a.user.email} (assigned)` } }
        : a,
    )
  }, [artistOptions, assignedArtistId])

  // Multi-session planning: a selected planned session's OWN hour range
  // always wins over the project's top-level fields (which are null for
  // any project that declared a real plan anyway -- see the backend's
  // send-estimate route) -- this is the "pull the right session's hour
  // target" the task asks for, feeding the exact same scheduling-assistant
  // call below with no changes to that service itself.
  const hasTimeEstimate = selectedPlannedSession
    ? true
    : selectedInquiry?.timeEstimateHoursMin != null && selectedInquiry?.timeEstimateHoursMax != null
  const tattooSuggestionDurationMinutes = selectedPlannedSession
    ? Math.round(((selectedPlannedSession.estimatedHoursMin + selectedPlannedSession.estimatedHoursMax) / 2) * 60)
    : hasTimeEstimate
      ? Math.round(((selectedInquiry!.timeEstimateHoursMin! + selectedInquiry!.timeEstimateHoursMax!) / 2) * 60)
      : undefined

  // A consultation uses its own duration preset instead of the project's
  // time estimate (most projects haven't been estimated yet at
  // consultation stage) and needs no duration "estimate" gate at all --
  // there's always a preset value. Still goes through the exact same
  // getSuggestedTimes service and buffer-conflict logic as a real session.
  const hasDuration = isConsultation ? true : hasTimeEstimate
  const suggestionDurationMinutes = isConsultation ? consultationDurationMinutes : tattooSuggestionDurationMinutes

  // Per the task spec, a TATTOO_SESSION only shows suggestions once a gift
  // card is actually available or already attached -- a project that can't
  // be scheduled at all yet (no card) shouldn't be shown times to book,
  // that would imply a commitment the client hasn't secured. A
  // CONSULTATION has no such requirement -- it never needs a card at all.
  const hasGiftCardAvailable = isConsultation || giftCardIds.length > 0 || availableGiftCards.length > 0

  // The one shared service behind both Package D consumers -- see
  // apps/api/src/lib/schedulingAssistant.ts. Replaces the prior client-side
  // suggestAppointmentSlots.ts algorithm entirely (deleted in this same
  // commit) so there's exactly one implementation, not two that happen to
  // agree. Reused as-is for consultations too -- same availability-greying,
  // same buffer-conflict awareness, just a different source for the
  // duration it searches with.
  const { data: suggestedTimes } = useQuery({
    queryKey: ['suggested-times', artistId, suggestionDurationMinutes],
    queryFn: () =>
      apiFetch<SuggestedTimeCandidate[]>(
        `/scheduling/suggested-times?artistId=${artistId}&durationMinutes=${suggestionDurationMinutes}`,
      ),
    enabled: !!artistId && hasDuration && hasGiftCardAvailable,
  })

  // Reads this artist's own upcoming bookings for the mini schedule
  // snippet's own data -- conflict-checking itself already happened
  // server-side inside getSuggestedTimes above, this is purely for the
  // small visual preview.
  const snippetRangeStart = useMemo(() => new Date(), [])
  const snippetRangeEnd = useMemo(() => {
    const end = new Date(snippetRangeStart)
    end.setDate(end.getDate() + 21)
    return end
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snippetRangeStart])

  const { data: artistAppointmentsForSnippet } = useQuery({
    queryKey: ['appointments-for-schedule-snippet', artistId, snippetRangeStart.toDateString()],
    queryFn: () =>
      apiFetch<{ startTime: string; endTime: string }[]>(
        `/appointments?artistId=${artistId}&start=${encodeURIComponent(snippetRangeStart.toISOString())}&end=${encodeURIComponent(snippetRangeEnd.toISOString())}`,
      ),
    enabled: !!artistId && hasDuration && hasGiftCardAvailable,
  })

  function isoToTimeRangeParts(startIso: string, endIso: string): DateAndTimeRangeValue {
    const start = new Date(startIso)
    const end = new Date(endIso)
    const pad = (n: number) => String(n).padStart(2, '0')
    return {
      date: `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`,
      startTime: `${pad(start.getHours())}:${pad(start.getMinutes())}`,
      endTime: `${pad(end.getHours())}:${pad(end.getMinutes())}`,
    }
  }

  function formatSlotLabel(candidate: SuggestedTimeCandidate): string {
    const start = new Date(candidate.startTime)
    const end = new Date(candidate.endTime)
    const today = new Date()
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)
    const dayLabel =
      start.toDateString() === today.toDateString()
        ? 'Today'
        : start.toDateString() === tomorrow.toDateString()
          ? 'Tomorrow'
          : start.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
    const timeLabel = (d: Date) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    return `${dayLabel}, ${timeLabel(start)}–${timeLabel(end)}`
  }

  const activeSuggestion =
    suggestedTimes?.find((candidate) => {
      const parts = isoToTimeRangeParts(candidate.startTime, candidate.endTime)
      return parts.date === timeRange.date && parts.startTime === timeRange.startTime
    }) ?? suggestedTimes?.[0]

  function handleClientChange(nextClientId: string) {
    setClientId(nextClientId)
    setInquiryId('')
    setGiftCardIds([])
    setPlannedSessionId('')
  }

  function handleInquiryChange(nextInquiryId: string) {
    setInquiryId(nextInquiryId)
    setPlannedSessionId('')
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)

    if (!effectiveClientId || !(fixedInquiryId || inquiryId) || !financialRequirementSatisfied || !artistId) return

    if (!isCompleteTimeRange(timeRange)) {
      setError('Select a date, start time, and end time.')
      return
    }
    if (!isValidTimeRange(timeRange)) {
      setError('End time must be after start time.')
      return
    }

    if (outsideHours && !confirmedOutsideHours) {
      setError("Confirm you understand this is outside the artist's usual hours.")
      return
    }

    if (isDifferentFromAssigned && !confirmedDifferentArtist) {
      setError('Confirm you understand this is a different artist than the one assigned to this project.')
      return
    }

    const start = combineDateAndTime(timeRange.date, timeRange.startTime)!
    const end = combineDateAndTime(timeRange.date, timeRange.endTime)!

    setSubmitting(true)
    try {
      await apiFetch('/appointments', {
        method: 'POST',
        body: JSON.stringify({
          clientId: effectiveClientId,
          inquiryId: fixedInquiryId ?? inquiryId,
          appointmentType,
          giftCardIds: isConsultation ? [] : giftCardIds,
          plannedSessionId: selectedPlannedSession ? plannedSessionId : undefined,
          artistId,
          startTime: start.toISOString(),
          endTime: end.toISOString(),
          notes: notes || undefined,
        }),
      })
      // A just-attached gift card must not still look available if this
      // same modal (or another one, on a different page -- Calendar.tsx/
      // Inquiries.tsx both open this form too) gets reopened for the same
      // client within this query's 30s default staleTime: without this,
      // staff could pick a card that's already spoken for and only find
      // out once the (correctly rejecting) submission itself failed.
      queryClient.invalidateQueries({ queryKey: ['client-projects-for-appointment', effectiveClientId] })
      onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create appointment')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {error && (
        <div className="mb-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      )}

      <div className="mb-4">
        <label className="mb-1 block text-sm font-medium text-fg-secondary">Type</label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setAppointmentType('TATTOO_SESSION')}
            className={[
              'flex-1 rounded-full border px-3 py-2 text-sm font-medium transition',
              !isConsultation ? 'border-accent bg-accent/15 text-accent' : 'border-border text-fg-secondary hover:bg-surface',
            ].join(' ')}
          >
            Tattoo Session
          </button>
          <button
            type="button"
            onClick={() => setAppointmentType('CONSULTATION')}
            className={[
              'flex-1 rounded-full border px-3 py-2 text-sm font-medium transition',
              isConsultation ? 'border-accent bg-accent/15 text-accent' : 'border-border text-fg-secondary hover:bg-surface',
            ].join(' ')}
          >
            Consultation
          </button>
        </div>
        {isConsultation && (
          <p className="mt-1.5 text-xs text-fg-muted">
            No deposit or gift card needed — this is an informal step, not a booked session.
          </p>
        )}
      </div>

      {!fixedClientId && clientOptions && clientOptions.length === 0 && (
        <p className="mb-3 text-sm text-fg-secondary">No clients yet — add one from the Clients page first.</p>
      )}

      {artistOptions && artistOptions.length === 0 && (
        <p className="mb-3 text-sm text-fg-secondary">No artists yet — add one first.</p>
      )}

      {!fixedClientId && (
        <div className="mb-3">
          <label htmlFor="apptClientId" className="mb-1 block text-sm font-medium text-fg-secondary">
            Client
          </label>
          <select
            id="apptClientId"
            required
            value={clientId}
            onChange={(event) => handleClientChange(event.target.value)}
            className={INPUT_CLASS}
          >
            <option value="" disabled>
              {clientOptions === undefined ? 'Loading…' : 'Select a client'}
            </option>
            {clientOptions?.map((client) => (
              <option key={client.id} value={client.id}>
                {client.firstName} {client.lastName}
              </option>
            ))}
          </select>
        </div>
      )}

      {effectiveClientId && !fixedInquiryId && (
        <div className="mb-3">
          <label htmlFor="apptInquiryId" className="mb-1 block text-sm font-medium text-fg-secondary">
            Project (inquiry)
          </label>
          {availableInquiries.length === 0 ? (
            <p className="text-sm text-fg-secondary">This client has no inquiries yet.</p>
          ) : (
            <select
              id="apptInquiryId"
              required
              value={inquiryId}
              onChange={(event) => handleInquiryChange(event.target.value)}
              className={INPUT_CLASS}
            >
              <option value="" disabled>
                Select the project this session is for
              </option>
              {availableInquiries.map((inquiry) => (
                <option key={inquiry.id} value={inquiry.id}>
                  {inquiry.description.length > 50 ? `${inquiry.description.slice(0, 50).trimEnd()}…` : inquiry.description}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {effectiveClientId && !isConsultation && (
        <div className="mb-3">
          <label className="mb-1 block text-sm font-medium text-fg-secondary">Gift card(s) (deposit)</label>
          {availableGiftCards.length === 0 ? (
            <p className="text-sm text-fg-secondary">
              This client has no available gift card — collect a deposit or{' '}
              <Link to={`/clients/${effectiveClientId}`} className="underline hover:text-fg">
                issue one from their profile
              </Link>{' '}
              first.
            </p>
          ) : (
            <GiftCardStackPicker
              cards={availableGiftCards}
              selectedIds={giftCardIds}
              onChange={setGiftCardIds}
              requiredCents={requiredDepositCents}
            />
          )}
        </div>
      )}

      {!isConsultation && availablePlannedSessions.length > 0 && (
        <div className="mb-3">
          <label className="mb-1 block text-sm font-medium text-fg-secondary">Which planned session?</label>
          <select
            value={plannedSessionId}
            onChange={(event) => setPlannedSessionId(event.target.value)}
            className={INPUT_CLASS}
          >
            <option value="">Not tied to a specific planned session</option>
            {availablePlannedSessions.map((ps) => (
              <option key={ps.id} value={ps.id}>
                Session {ps.sessionNumber} — estimated {ps.estimatedHoursMin}-{ps.estimatedHoursMax} hrs
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="mb-3">
        <label className="mb-1 block text-sm font-medium text-fg-secondary">Artist</label>
        <ArtistSelect
          id="apptArtistId"
          artists={artistSelectOptions}
          value={artistId || null}
          onChange={handleArtistChange}
        />
        {isDifferentFromAssigned && (
          <div className="mt-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
            <p>This project is assigned to a different artist.</p>
            <label className="mt-2 flex items-center gap-2 text-xs font-medium">
              <input
                type="checkbox"
                checked={confirmedDifferentArtist}
                onChange={(event) => setConfirmedDifferentArtist(event.target.checked)}
                className="accent-warning"
              />
              I understand, proceed anyway
            </label>
          </div>
        )}
      </div>

      {isConsultation && (
        <div className="mb-3">
          <label className="mb-1 block text-sm font-medium text-fg-secondary">Duration</label>
          <div className="flex gap-2">
            {CONSULTATION_DURATION_PRESETS.map((preset) => (
              <button
                key={preset.minutes}
                type="button"
                onClick={() => applyConsultationDuration(preset.minutes)}
                className={[
                  'rounded-full border px-3 py-1.5 text-xs font-medium transition',
                  consultationDurationMinutes === preset.minutes
                    ? 'border-accent bg-accent/15 text-accent'
                    : 'border-border text-fg-secondary hover:bg-surface',
                ].join(' ')}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {artistId && !effectiveInquiryId && (
        <p className="mb-3 text-xs text-fg-muted">Select a project to see suggested times.</p>
      )}

      {artistId && effectiveInquiryId && !hasDuration && (
        <p className="mb-3 text-xs text-fg-muted">
          This project has no estimated time yet — add one on the inquiry page to see suggested times.
        </p>
      )}

      {artistId && hasDuration && !hasGiftCardAvailable && (
        <p className="mb-3 text-xs text-fg-muted">
          This client has no available gift card yet — suggested times appear once one is available or attached.
        </p>
      )}

      {artistId && hasDuration && hasGiftCardAvailable && (
        <div className="mb-4 rounded-xl border border-accent/30 bg-accent/5 p-3">
          <p className="mb-1.5 block text-sm font-semibold text-fg">Suggested times</p>
          {!suggestedTimes ? (
            <p className="text-xs text-fg-muted">
              Checking {selectedArtist ? artistLabel(selectedArtist) : 'artist'}'s availability…
            </p>
          ) : suggestedTimes.length === 0 ? (
            <p className="text-xs text-fg-muted">
              No open slots found in the next few weeks — pick a time manually below.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {suggestedTimes.map((candidate) => {
                const parts = isoToTimeRangeParts(candidate.startTime, candidate.endTime)
                const isSelected =
                  timeRange.date === parts.date &&
                  timeRange.startTime === parts.startTime &&
                  timeRange.endTime === parts.endTime
                return (
                  <button
                    key={candidate.startTime}
                    type="button"
                    onClick={() => setTimeRange(parts)}
                    className={[
                      'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition',
                      isSelected
                        ? 'border-accent bg-accent/15 text-accent'
                        : 'border-border text-fg-secondary hover:bg-surface',
                    ].join(' ')}
                  >
                    {formatSlotLabel(candidate)}
                    {candidate.hasBufferConflict && (
                      <span
                        title="Less than 1.5 hours from another appointment for this artist"
                        className="rounded-full bg-warning/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-warning"
                      >
                        Close
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          )}

          {activeSuggestion && artistAppointmentsForSnippet && (
            <MiniScheduleSnippet
              date={isoToTimeRangeParts(activeSuggestion.startTime, activeSuggestion.endTime).date}
              appointments={artistAppointmentsForSnippet}
              highlightStart={activeSuggestion.startTime}
              highlightEnd={activeSuggestion.endTime}
            />
          )}
        </div>
      )}

      <div className="mb-3">
        <DateAndTimeRangeFields
          value={timeRange}
          onChange={handleTimeRangeChange}
          unavailableDaysOfWeek={unavailableDaysOfWeek}
        />
        {outsideHours && (
          <div className="mt-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
            <p>This is outside {selectedArtist ? artistLabel(selectedArtist) : 'this artist'}'s usual hours.</p>
            <label className="mt-2 flex items-center gap-2 text-xs font-medium">
              <input
                type="checkbox"
                checked={confirmedOutsideHours}
                onChange={(event) => setConfirmedOutsideHours(event.target.checked)}
                className="accent-warning"
              />
              I understand, proceed anyway
            </label>
          </div>
        )}
      </div>

      <div className="mb-3">
        <label htmlFor="apptNotes" className="mb-1 block text-sm font-medium text-fg-secondary">
          Notes
        </label>
        <textarea
          id="apptNotes"
          rows={3}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          className={INPUT_CLASS}
        />
      </div>

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={
            submitting ||
            !effectiveClientId ||
            (!fixedInquiryId && availableInquiries.length === 0) ||
            !financialRequirementSatisfied ||
            (outsideHours && !confirmedOutsideHours) ||
            (isDifferentFromAssigned && !confirmedDifferentArtist)
          }
          className="flex-1 rounded-full bg-accent px-4 py-2 text-sm font-medium text-bg transition hover:bg-accent-hover disabled:opacity-60"
        >
          {submitting ? 'Scheduling…' : 'Create Appointment'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="rounded-full border border-border px-4 py-2 text-sm font-medium text-fg transition hover:bg-surface disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
