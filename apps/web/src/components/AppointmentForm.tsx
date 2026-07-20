import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import { useAuth } from '../context/useAuth'
import { clientsQueryKey, artistsQueryKey } from '../lib/queryKeys'
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
  user: { email: string }
  isGuest: boolean
  guestEndDate: string | null
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

  const effectiveClientId = fixedClientId ?? clientId

  const { data: clientDetail } = useQuery({
    queryKey: ['client-projects-for-appointment', effectiveClientId],
    queryFn: () => apiFetch<ClientWithProjects>(`/clients/${effectiveClientId}`),
    enabled: !!effectiveClientId,
  })

  const availableInquiries = clientDetail?.inquiries ?? []
  const availableGiftCards = (clientDetail?.giftCards ?? []).filter(isCardAvailable)

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
        <label htmlFor="apptArtistId" className="mb-1 block text-sm font-medium text-fg-secondary">
          Artist
        </label>
        <select
          id="apptArtistId"
          required
          value={artistId}
          onChange={(event) => setArtistId(event.target.value)}
          className={INPUT_CLASS}
        >
          <option value="" disabled>
            {artistOptions === undefined ? 'Loading…' : 'Select an artist'}
          </option>
          {artistOptions?.map((artist) => (
            <option key={artist.id} value={artist.id}>
              {artist.user.email}
            </option>
          ))}
        </select>
      </div>

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
