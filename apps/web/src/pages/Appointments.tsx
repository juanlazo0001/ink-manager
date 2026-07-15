import { useEffect, useState, type FormEvent } from 'react'
import Sidebar from '../components/Sidebar'
import Modal from '../components/Modal'
import { apiFetch, ApiError } from '../lib/api'
import { formatDateTime, formatStatus } from '../lib/format'
import { useUserProfile } from '../context/useUserProfile'
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

const EMPTY_FORM = { clientId: '', artistId: '', startTime: '', endTime: '', notes: '' }

export default function Appointments() {
  const { profile } = useUserProfile()
  const canCreate = profile?.permissions.includes('appointments.create') ?? false
  const canManage = profile?.permissions.includes('appointments.manage') ?? false

  const [appointments, setAppointments] = useState<Appointment[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [refreshIndex, setRefreshIndex] = useState(0)
  const [updatingId, setUpdatingId] = useState<string | null>(null)

  const [clientOptions, setClientOptions] = useState<ClientOption[] | null>(null)
  const [artistOptions, setArtistOptions] = useState<ArtistOption[] | null>(null)

  const [showAddModal, setShowAddModal] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let ignore = false

    async function load() {
      setError(null)

      try {
        const data = await apiFetch<Appointment[]>('/appointments')
        if (!ignore) setAppointments(data)
      } catch (err) {
        if (ignore) return

        if (err instanceof ApiError && err.status === 403) {
          setError("You don't have permission to view appointments.")
        } else {
          setError(err instanceof Error ? err.message : 'Failed to load appointments')
        }
      }
    }

    load()

    return () => {
      ignore = true
    }
  }, [refreshIndex])

  useEffect(() => {
    if (!canCreate) return

    let ignore = false

    async function loadOptions() {
      try {
        const [clientsData, artistsData] = await Promise.all([
          apiFetch<ClientOption[]>('/clients'),
          apiFetch<ArtistOption[]>('/artists'),
        ])

        if (!ignore) {
          setClientOptions(clientsData)
          setArtistOptions(artistsData)
        }
      } catch {
        // The main list's error state already covers the important failure case;
        // if this fails the modal's selects just stay empty.
      }
    }

    loadOptions()

    return () => {
      ignore = true
    }
  }, [canCreate])

  async function handleCreateAppointment(event: FormEvent) {
    event.preventDefault()
    setFormError(null)
    setSubmitting(true)

    try {
      await apiFetch('/appointments', {
        method: 'POST',
        body: JSON.stringify({
          clientId: form.clientId,
          artistId: form.artistId,
          startTime: new Date(form.startTime).toISOString(),
          endTime: new Date(form.endTime).toISOString(),
          notes: form.notes || undefined,
        }),
      })

      setShowAddModal(false)
      setForm(EMPTY_FORM)
      setRefreshIndex((index) => index + 1)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to create appointment')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleStatusChange(appointmentId: string, newStatus: string) {
    setActionError(null)
    setUpdatingId(appointmentId)

    try {
      const updated = await apiFetch<{ status: string }>(`/appointments/${appointmentId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: newStatus }),
      })

      setAppointments((prev) =>
        prev ? prev.map((a) => (a.id === appointmentId ? { ...a, status: updated.status } : a)) : prev,
      )
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

            {error && <p className="text-sm text-red-400">{error}</p>}

            {!error && appointments === null && <p className="text-sm text-neutral-400">Loading appointments…</p>}

            {!error && appointments !== null && filteredAppointments?.length === 0 && (
              <p className="text-sm text-neutral-400">
                {statusFilter !== 'ALL' ? 'No appointments match this filter.' : 'No appointments yet.'}
              </p>
            )}

            {!error && filteredAppointments && filteredAppointments.length > 0 && (
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
                  <tbody className="divide-y divide-neutral-800">
                    {filteredAppointments.map((appointment) => (
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

            {clientOptions !== null && clientOptions.length === 0 && (
              <p className="mb-3 text-sm text-neutral-400">No clients yet — add one from the Clients page first.</p>
            )}

            {artistOptions !== null && artistOptions.length === 0 && (
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
                onChange={(event) => setForm({ ...form, clientId: event.target.value })}
                className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600"
              >
                <option value="" disabled>
                  {clientOptions === null ? 'Loading…' : 'Select a client'}
                </option>
                {clientOptions?.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.firstName} {client.lastName}
                  </option>
                ))}
              </select>
            </div>

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
                  {artistOptions === null ? 'Loading…' : 'Select an artist'}
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
              disabled={submitting}
              className="mt-5 w-full rounded-full border border-neutral-700 bg-neutral-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-600 disabled:opacity-60"
            >
              {submitting ? 'Scheduling…' : 'Create Appointment'}
            </button>
          </form>
        </Modal>
      )}
    </div>
  )
}
