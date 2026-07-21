import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import { useAuth } from '../context/useAuth'
import { clientsQueryKey, artistsQueryKey } from '../lib/queryKeys'
import { artistLabel } from './ArtistAvatar'
import ArtistSelect from './ArtistSelect'
import MiniScheduleSnippet from './MiniScheduleSnippet'
import DateAndTimeRangeFields, {
  combineDateAndTime,
  isCompleteTimeRange,
  isValidTimeRange,
  type DateAndTimeRangeValue,
} from './DateAndTimeRangeFields'

interface ClientOption {
  id: string
  firstName: string
  lastName: string
}

interface ArtistOption {
  id: string
  user: { email: string; name: string | null; avatarUrl: string | null }
  isGuest: boolean
  guestStartDate: string | null
  guestEndDate: string | null
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

interface InquiryOption {
  id: string
  description: string
  status: string
  timeEstimateHoursMin: number | null
  timeEstimateHoursMax: number | null
}

interface GiftCardOption {
  id: string
  code: string
  amountCents: number
  status: string
  expiresAt: string | null
  appointmentId: string | null
}

interface ClientWithProjects {
  inquiries: InquiryOption[]
  giftCards: GiftCardOption[]
}

function isCardAvailable(card: GiftCardOption): boolean {
  if (card.status !== 'ACTIVE' || card.appointmentId) return false
  return !card.expiresAt || new Date(card.expiresAt) > new Date()
}

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
  onCreated,
  onCancel,
}: AppointmentFormProps) {
  const { user } = useAuth()

  const [clientId, setClientId] = useState(fixedClientId ?? '')
  const [inquiryId, setInquiryId] = useState(fixedInquiryId ?? '')
  const [giftCardId, setGiftCardId] = useState('')
  const [artistId, setArtistId] = useState(initialArtistId ?? '')
  const [timeRange, setTimeRange] = useState<DateAndTimeRangeValue>({
    date: initialDate ?? '',
    startTime: initialStartTime ?? '',
    endTime: initialEndTime ?? '',
  })
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data: clientOptions } = useQuery({
    queryKey: clientsQueryKey(user!.studioId),
    queryFn: () => apiFetch<ClientOption[]>('/clients'),
    enabled: !fixedClientId,
  })

  const { data: allArtistOptions } = useQuery({
    queryKey: artistsQueryKey(user!.studioId),
    queryFn: () => apiFetch<ArtistOption[]>('/artists'),
  })
  const artistOptions = allArtistOptions?.filter((a) => !isEndedGuest(a))
  const selectedArtist = artistOptions?.find((a) => a.id === artistId)

  const effectiveClientId = fixedClientId ?? clientId

  const { data: clientDetail } = useQuery({
    queryKey: ['client-projects-for-appointment', effectiveClientId],
    queryFn: () => apiFetch<ClientWithProjects>(`/clients/${effectiveClientId}`),
    enabled: !!effectiveClientId,
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
  const hasTimeEstimate =
    selectedInquiry?.timeEstimateHoursMin != null && selectedInquiry?.timeEstimateHoursMax != null
  const suggestionDurationMinutes = hasTimeEstimate
    ? Math.round(((selectedInquiry!.timeEstimateHoursMin! + selectedInquiry!.timeEstimateHoursMax!) / 2) * 60)
    : undefined

  // Per the task spec, suggestions only show once a gift card is actually
  // available or already attached -- a project that can't be scheduled at
  // all yet (no card) shouldn't be shown times to book, that would imply a
  // commitment the client hasn't secured.
  const hasGiftCardAvailable = giftCardId !== '' || availableGiftCards.length > 0

  // The one shared service behind both Package D consumers -- see
  // apps/api/src/lib/schedulingAssistant.ts. Replaces the prior client-side
  // suggestAppointmentSlots.ts algorithm entirely (deleted in this same
  // commit) so there's exactly one implementation, not two that happen to
  // agree.
  const { data: suggestedTimes } = useQuery({
    queryKey: ['suggested-times', artistId, suggestionDurationMinutes],
    queryFn: () =>
      apiFetch<SuggestedTimeCandidate[]>(
        `/scheduling/suggested-times?artistId=${artistId}&durationMinutes=${suggestionDurationMinutes}`,
      ),
    enabled: !!artistId && hasTimeEstimate && hasGiftCardAvailable,
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
    enabled: !!artistId && hasTimeEstimate && hasGiftCardAvailable,
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
    setGiftCardId('')
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)

    if (!effectiveClientId || !(fixedInquiryId || inquiryId) || !giftCardId || !artistId) return

    if (!isCompleteTimeRange(timeRange)) {
      setError('Select a date, start time, and end time.')
      return
    }
    if (!isValidTimeRange(timeRange)) {
      setError('End time must be after start time.')
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
          giftCardId,
          artistId,
          startTime: start.toISOString(),
          endTime: end.toISOString(),
          notes: notes || undefined,
        }),
      })
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
              onChange={(event) => setInquiryId(event.target.value)}
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

      {effectiveClientId && (
        <div className="mb-3">
          <label htmlFor="apptGiftCardId" className="mb-1 block text-sm font-medium text-fg-secondary">
            Gift card (deposit)
          </label>
          {availableGiftCards.length === 0 ? (
            <p className="text-sm text-fg-secondary">
              This client has no available gift card — collect a deposit or{' '}
              <Link to={`/clients/${effectiveClientId}`} className="underline hover:text-fg">
                issue one from their profile
              </Link>{' '}
              first.
            </p>
          ) : (
            <select
              id="apptGiftCardId"
              required
              value={giftCardId}
              onChange={(event) => setGiftCardId(event.target.value)}
              className={INPUT_CLASS}
            >
              <option value="" disabled>
                Select a gift card to attach
              </option>
              {availableGiftCards.map((card) => (
                <option key={card.id} value={card.id}>
                  ${(card.amountCents / 100).toFixed(2)} — {card.code.slice(0, 8)}…
                  {card.expiresAt ? ` (expires ${new Date(card.expiresAt).toLocaleDateString()})` : ''}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      <div className="mb-3">
        <label className="mb-1 block text-sm font-medium text-fg-secondary">Artist</label>
        <ArtistSelect
          id="apptArtistId"
          artists={artistOptions}
          value={artistId || null}
          onChange={(id) => setArtistId(id ?? '')}
        />
      </div>

      {artistId && !effectiveInquiryId && (
        <p className="mb-3 text-xs text-fg-muted">Select a project to see suggested times.</p>
      )}

      {artistId && effectiveInquiryId && !hasTimeEstimate && (
        <p className="mb-3 text-xs text-fg-muted">
          This project has no estimated time yet — add one on the inquiry page to see suggested times.
        </p>
      )}

      {artistId && hasTimeEstimate && !hasGiftCardAvailable && (
        <p className="mb-3 text-xs text-fg-muted">
          This client has no available gift card yet — suggested times appear once one is available or attached.
        </p>
      )}

      {artistId && hasTimeEstimate && hasGiftCardAvailable && (
        <div className="mb-3">
          <p className="mb-1.5 block text-sm font-medium text-fg-secondary">Suggested times</p>
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
        <DateAndTimeRangeFields value={timeRange} onChange={setTimeRange} />
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
            availableGiftCards.length === 0
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
