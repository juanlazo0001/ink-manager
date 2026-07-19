import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Sidebar from '../components/Sidebar'
import Modal from '../components/Modal'
import AppointmentForm from '../components/AppointmentForm'
import { SkeletonTableRows } from '../components/Skeleton'
import StatusPill from '../components/StatusPill'
import { apiFetch, ApiError } from '../lib/api'
import { formatDateTime, formatStatus } from '../lib/format'
import { useUserProfile } from '../context/useUserProfile'
import { useAuth } from '../context/useAuth'
import { appointmentsQueryKey } from '../lib/queryKeys'
import { useMarkSectionSeen } from '../lib/useMarkSectionSeen'
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

export default function Calendar() {
  const { user } = useAuth()
  const { profile } = useUserProfile()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const canCreate = profile?.permissions.includes('appointments.create') ?? false
  const canManage = profile?.permissions.includes('appointments.manage') ?? false
  useMarkSectionSeen('appointments')

  const [actionError, setActionError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [updatingId, setUpdatingId] = useState<string | null>(null)

  const [showAddModal, setShowAddModal] = useState(false)
  const [prefillClientId, setPrefillClientId] = useState<string | undefined>(undefined)
  const [prefillInquiryId, setPrefillInquiryId] = useState<string | undefined>(undefined)

  // "Book follow-up" from a just-checked-out appointment deep-links here
  // with the same client + project pre-filled, since Phase 3 will demand a
  // gift card (the rolled one, or a new deposit) either way. The plain
  // "New Appointment" entry point on Inquiries & Projects uses the same
  // deep-link mechanism, just without a client/project prefilled.
  useEffect(() => {
    const deepLinkClientId = searchParams.get('prefillClientId')
    const deepLinkInquiryId = searchParams.get('prefillInquiryId')
    const openNew = searchParams.get('new')

    if (deepLinkClientId) {
      setPrefillClientId(deepLinkClientId)
      setPrefillInquiryId(deepLinkInquiryId ?? undefined)
      setShowAddModal(true)
      setSearchParams({}, { replace: true })
    } else if (openNew) {
      setShowAddModal(true)
      setSearchParams({}, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  function closeAddModal() {
    setShowAddModal(false)
    setPrefillClientId(undefined)
    setPrefillInquiryId(undefined)
  }

  function handleAppointmentCreated() {
    queryClient.invalidateQueries({ queryKey: appointmentsKey })
    closeAddModal()
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
    <div className="flex min-h-screen bg-bg text-fg">
      <Sidebar />

      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl px-6 py-6 sm:px-10 sm:py-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-fg sm:text-3xl">Calendar</h1>
              <p className="mt-1 text-sm text-fg-secondary">
                {canManage || canCreate ? 'Every booking across your studio.' : 'Your upcoming and past appointments.'}
              </p>
            </div>

            {canCreate && (
              <button
                type="button"
                onClick={() => setShowAddModal(true)}
                className="flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover"
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
              className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            >
              <option value="ALL">All statuses</option>
              {APPOINTMENT_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {formatStatus(status)}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
            {actionError && (
              <div className="mb-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                {actionError}
              </div>
            )}

            {errorMessage && <p className="text-sm text-danger">{errorMessage}</p>}

            {!errorMessage && !isLoading && filteredAppointments?.length === 0 && (
              <p className="text-sm text-fg-secondary">
                {statusFilter !== 'ALL' ? 'No appointments match this filter.' : 'No appointments yet.'}
              </p>
            )}

            {!errorMessage && (isLoading || (filteredAppointments && filteredAppointments.length > 0)) && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="bg-surface-inset text-xs text-fg-muted">
                      <th className="pb-3 font-medium">Client Name</th>
                      <th className="hidden pb-3 font-medium sm:table-cell">Artist</th>
                      <th className="pb-3 font-medium">Start Time</th>
                      <th className="hidden pb-3 font-medium md:table-cell">End Time</th>
                      <th className="pb-3 font-medium">Status</th>
                    </tr>
                  </thead>
                  {isLoading ? (
                    <SkeletonTableRows
                      rows={6}
                      columns={5}
                      columnClassNames={['', 'hidden sm:table-cell', '', 'hidden md:table-cell', '']}
                    />
                  ) : (
                  <tbody className="divide-y divide-border">
                    {filteredAppointments!.map((appointment) => (
                      <tr
                        key={appointment.id}
                        onClick={() => navigate(`/appointments/${appointment.id}`)}
                        className="cursor-pointer hover:bg-surface/40"
                      >
                        <td className="py-3 text-fg">
                          {appointment.client
                            ? `${appointment.client.firstName} ${appointment.client.lastName}`
                            : '—'}
                        </td>
                        <td className="hidden py-3 text-fg-secondary sm:table-cell">
                          {appointment.artist?.user.email ?? '—'}
                        </td>
                        <td className="py-3 text-fg-secondary">{formatDateTime(appointment.startTime)}</td>
                        <td className="hidden py-3 text-fg-secondary md:table-cell">
                          {formatDateTime(appointment.endTime)}
                        </td>
                        <td className="py-3" onClick={(event) => event.stopPropagation()}>
                          {canManage ? (
                            <select
                              value={appointment.status}
                              disabled={updatingId === appointment.id}
                              onChange={(event) => handleStatusChange(appointment.id, event.target.value)}
                              className="rounded-full border border-border bg-bg px-3 py-1 text-xs font-medium text-fg-secondary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
                            >
                              {APPOINTMENT_STATUSES.map((status) => (
                                <option key={status} value={status}>
                                  {formatStatus(status)}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <StatusPill status={appointment.status} />
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
        <Modal title="New Appointment" onClose={closeAddModal}>
          <AppointmentForm
            fixedClientId={prefillClientId}
            fixedInquiryId={prefillInquiryId}
            onCreated={handleAppointmentCreated}
            onCancel={closeAddModal}
          />
        </Modal>
      )}
    </div>
  )
}
