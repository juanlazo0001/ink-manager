import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Sidebar from '../components/Sidebar'
import Modal from '../components/Modal'
import { SkeletonTableRows } from '../components/Skeleton'
import { apiFetch, ApiError } from '../lib/api'
import { formatDateTime, formatStatus } from '../lib/format'
import { useUserProfile } from '../context/useUserProfile'
import { useAuth } from '../context/useAuth'
import { appointmentsQueryKey, clientsQueryKey, artistsQueryKey } from '../lib/queryKeys'
import { PlusIcon } from '../components/icons'

const APPOINTMENT_STATUSES = ['REQUESTED', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'] as const

interface Appointment {
  id: string
  startTime: string
  endTime: string
  status: string
  client: { id: string; firstName: string; lastName: string } | null
  artist: { id: string; user: { email: string } } | null
}

interface ClientOption {
  id: string
  firstName: string
  lastName: string
}

interface ArtistOption {
  id: string
  user: { email: string }
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

const EMPTY_FORM = {
  clientId: '',
  inquiryId: '',
  giftCardId: '',
  artistId: '',
  startTime: '',
  endTime: '',
  notes: '',
}

export default function Appointments() {
  const { user } = useAuth()
  const { profile } = useUserProfile()
  const canCreate = profile?.permissions.includes('appointments.create') ?? false
  const canManage = profile?.permissions.includes('appointments.manage') ?? false

  const [actionError, setActionError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [updatingId, setUpdatingId] = useState<string | null>(null)

  const [showAddModal, setShowAddModal] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [formError, setFormError] = useState<string | null>(null)

  const queryClient = useQueryClient()
  const appointmentsKey = appointmentsQueryKey(user!.studioId)

  const {
    data: appointments,
    isLoading,
    error,
  } = useQuery({
    queryKey: appointmentsKey,
    queryFn: () => apiFetch<Appointment[]>('/appointments'),
  })

  const errorMessage = error
    ? error instanceof ApiError && error.status === 403
      ? "You don't have permission to view appointments."
      : error.message
    : null

  // Shares its cache with the Clients/Artists pages -- if either was
  // visited recently, these selects populate instantly with no fetch.
  const { data: clientOptions } = useQuery({
    queryKey: clientsQueryKey(user!.studioId),
    queryFn: () => apiFetch<ClientOption[]>('/clients'),
    enabled: canCreate,
  })

  const { data: artistOptions } = useQuery({
    queryKey: artistsQueryKey(user!.studioId),
    queryFn: () => apiFetch<ArtistOption[]>('/artists'),
    enabled: canCreate,
  })

  // The selected client's own projects (inquiries) and available gift
  // cards -- an appointment needs one of each (Phase 3 enforcement), so
  // both selectors are scoped to whichever client is picked first.
  const { data: selectedClientDetail } = useQuery({
    queryKey: ['client-projects-for-appointment', form.clientId],
    queryFn: () => apiFetch<ClientWithProjects>(`/clients/${form.clientId}`),
    enabled: !!form.clientId,
  })

  const availableInquiries = selectedClientDetail?.inquiries ?? []
  const availableGiftCards = (selectedClientDetail?.giftCards ?? []).filter(isCardAvailable)

  const createAppointment = useMutation({
    mutationFn: (payload: typeof EMPTY_FORM) =>
      apiFetch('/appointments', {
        method: 'POST',
        body: JSON.stringify({
          clientId: payload.clientId,
          inquiryId: payload.inquiryId,
          giftCardId: payload.giftCardId,
          artistId: payload.artistId,
          startTime: new Date(payload.startTime).toISOString(),
          endTime: new Date(payload.endTime).toISOString(),
          notes: payload.notes || undefined,
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: appointmentsKey })
      setShowAddModal(false)
      setForm(EMPTY_FORM)
    },
    onError: (err) => {
      setFormError(err instanceof Error ? err.message : 'Failed to create appointment')
    },
  })

  function handleCreateAppointment(event: FormEvent) {
    event.preventDefault()
    setFormError(null)
    createAppointment.mutate(form)
  }

  function handleClientChange(clientId: string) {
    // A new client means the previously selected inquiry/card (from the old
    // client) are no longer valid choices.
    setForm({ ...form, clientId, inquiryId: '', giftCardId: '' })
  }

  async function handleStatusChange(appointmentId: string, newStatus: string) {
    setActionError(null)
    setUpdatingId(appointmentId)

    try {
      await apiFetch(`/appointments/${appointmentId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: newStatus }),
      })

      queryClient.invalidateQueries({ queryKey: appointmentsKey })
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to update status')
    } finally {
      setUpdatingId(null)
    }
  }

  const filteredAppointments = appointments?.filter((a) => statusFilter === 'ALL' || a.status === statusFilter)

  return (
    <div className="flex min-h-screen bg-neutral-900 text-white">
      <Sidebar />

      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl px-6 py-6 sm:px-10 sm:py-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-white sm:text-3xl">Appointments</h1>
              <p className="mt-1 text-sm text-neutral-400">
                {canManage || canCreate ? 'Every booking across your studio.' : 'Your upcoming and past appointments.'}
              </p>
            </div>

            {canCreate && (
              <button
                type="button"
                onClick={() => setShowAddModal(true)}
                className="flex items-center gap-2 rounded-full border border-neutral-700 bg-neutral-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-neutral-600"
              >
                <PlusIcon className="h-4 w-4" />
                New Appointment
              </button>
            )}
          </div>

          <div className="mt-6 flex items-center gap-2 sm:max-w-xs">
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600"
            >
              <option value="ALL">All statuses</option>
              {APPOINTMENT_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {formatStatus(status)}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
            {actionError && (
              <div className="mb-4 rounded-lg border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-400">
                {actionError}
              </div>
            )}

            {errorMessage && <p className="text-sm text-red-400">{errorMessage}</p>}

            {!errorMessage && !isLoading && filteredAppointments?.length === 0 && (
              <p className="text-sm text-neutral-400">
                {statusFilter !== 'ALL' ? 'No appointments match this filter.' : 'No appointments yet.'}
              </p>
            )}

            {!errorMessage && (isLoading || (filteredAppointments && filteredAppointments.length > 0)) && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="text-xs text-neutral-500">
                      <th className="pb-3 font-medium">Client Name</th>
                      <th className="pb-3 font-medium">Artist</th>
                      <th className="pb-3 font-medium">Start Time</th>
                      <th className="pb-3 font-medium">End Time</th>
                      <th className="pb-3 font-medium">Status</th>
                    </tr>
                  </thead>
                  {isLoading ? (
                    <SkeletonTableRows rows={6} columns={5} />
                  ) : (
                  <tbody className="divide-y divide-neutral-800">
                    {filteredAppointments!.map((appointment) => (
                      <tr key={appointment.id}>
                        <td className="py-3 text-white">
                          {appointment.client
                            ? `${appointment.client.firstName} ${appointment.client.lastName}`
                            : '—'}
                        </td>
                        <td className="py-3 text-neutral-400">{appointment.artist?.user.email ?? '—'}</td>
                        <td className="py-3 text-neutral-400">{formatDateTime(appointment.startTime)}</td>
                        <td className="py-3 text-neutral-400">{formatDateTime(appointment.endTime)}</td>
                        <td className="py-3">
                          {canManage ? (
                            <select
                              value={appointment.status}
                              disabled={updatingId === appointment.id}
                              onChange={(event) => handleStatusChange(appointment.id, event.target.value)}
                              className="rounded-full border border-neutral-700 bg-neutral-900 px-3 py-1 text-xs font-medium text-neutral-300 focus:outline-none focus:ring-1 focus:ring-neutral-600 disabled:opacity-50"
                            >
                              {APPOINTMENT_STATUSES.map((status) => (
                                <option key={status} value={status}>
                                  {formatStatus(status)}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className="inline-flex items-center rounded-full border border-neutral-700 px-3 py-1 text-xs font-medium text-neutral-300">
                              {formatStatus(appointment.status)}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  )}
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {showAddModal && (
        <Modal title="New Appointment" onClose={() => setShowAddModal(false)}>
          <form onSubmit={handleCreateAppointment}>
            {formError && (
              <div className="mb-4 rounded-lg border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-400">
                {formError}
              </div>
            )}

            {clientOptions && clientOptions.length === 0 && (
              <p className="mb-3 text-sm text-neutral-400">No clients yet — add one from the Clients page first.</p>
            )}

            {artistOptions && artistOptions.length === 0 && (
              <p className="mb-3 text-sm text-neutral-400">No artists yet — add one first.</p>
            )}

            <div className="mb-3">
              <label htmlFor="clientId" className="mb-1 block text-sm font-medium text-neutral-300">
                Client
              </label>
              <select
                id="clientId"
                required
                value={form.clientId}
                onChange={(event) => handleClientChange(event.target.value)}
                className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600"
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

            {form.clientId && (
              <>
                <div className="mb-3">
                  <label htmlFor="inquiryId" className="mb-1 block text-sm font-medium text-neutral-300">
                    Project (inquiry)
                  </label>
                  {availableInquiries.length === 0 ? (
                    <p className="text-sm text-neutral-400">This client has no inquiries yet.</p>
                  ) : (
                    <select
                      id="inquiryId"
                      required
                      value={form.inquiryId}
                      onChange={(event) => setForm({ ...form, inquiryId: event.target.value })}
                      className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600"
                    >
                      <option value="" disabled>
                        Select the project this session is for
                      </option>
                      {availableInquiries.map((inquiry) => (
                        <option key={inquiry.id} value={inquiry.id}>
                          {inquiry.description.length > 50
                            ? `${inquiry.description.slice(0, 50).trimEnd()}…`
                            : inquiry.description}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                <div className="mb-3">
                  <label htmlFor="giftCardId" className="mb-1 block text-sm font-medium text-neutral-300">
                    Gift card (deposit)
                  </label>
                  {availableGiftCards.length === 0 ? (
                    <p className="text-sm text-neutral-400">
                      This client has no available gift card — collect a deposit or{' '}
                      <Link to={`/clients/${form.clientId}`} className="underline hover:text-white">
                        issue one from their profile
                      </Link>{' '}
                      first.
                    </p>
                  ) : (
                    <select
                      id="giftCardId"
                      required
                      value={form.giftCardId}
                      onChange={(event) => setForm({ ...form, giftCardId: event.target.value })}
                      className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600"
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
              </>
            )}

            <div className="mb-3">
              <label htmlFor="artistId" className="mb-1 block text-sm font-medium text-neutral-300">
                Artist
              </label>
              <select
                id="artistId"
                required
                value={form.artistId}
                onChange={(event) => setForm({ ...form, artistId: event.target.value })}
                className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600"
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

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="startTime" className="mb-1 block text-sm font-medium text-neutral-300">
                  Start
                </label>
                <input
                  id="startTime"
                  type="datetime-local"
                  required
                  value={form.startTime}
                  onChange={(event) => setForm({ ...form, startTime: event.target.value })}
                  className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600"
                />
              </div>

              <div>
                <label htmlFor="endTime" className="mb-1 block text-sm font-medium text-neutral-300">
                  End
                </label>
                <input
                  id="endTime"
                  type="datetime-local"
                  required
                  value={form.endTime}
                  onChange={(event) => setForm({ ...form, endTime: event.target.value })}
                  className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600"
                />
              </div>
            </div>

            <div className="mt-3">
              <label htmlFor="notes" className="mb-1 block text-sm font-medium text-neutral-300">
                Notes
              </label>
              <textarea
                id="notes"
                rows={3}
                value={form.notes}
                onChange={(event) => setForm({ ...form, notes: event.target.value })}
                className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600"
              />
            </div>

            <button
              type="submit"
              disabled={
                createAppointment.isPending ||
                !form.clientId ||
                availableInquiries.length === 0 ||
                availableGiftCards.length === 0
              }
              className="mt-5 w-full rounded-full border border-neutral-700 bg-neutral-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-600 disabled:opacity-60"
            >
              {createAppointment.isPending ? 'Scheduling…' : 'Create Appointment'}
            </button>
          </form>
        </Modal>
      )}
    </div>
  )
}
