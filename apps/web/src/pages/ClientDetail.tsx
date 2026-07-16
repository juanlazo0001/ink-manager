import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import Sidebar from '../components/Sidebar'
import Modal from '../components/Modal'
import { apiFetch, ApiError } from '../lib/api'
import { formatDateTime, formatStatus } from '../lib/format'
import { ArrowLeftIcon, PlusIcon } from '../components/icons'
import { useUserProfile } from '../context/useUserProfile'
import { useAuth } from '../context/useAuth'
import { clientsQueryKey } from '../lib/queryKeys'

interface ConsentForm {
  id: string
  signedAt: string | null
  createdAt: string
}

interface InquirySummary {
  id: string
  description: string
  status: string
  channel: string
  createdAt: string
}

interface Client {
  id: string
  firstName: string
  lastName: string
  email: string | null
  phone: string | null
  consentForms: ConsentForm[]
  inquiries: InquirySummary[]
}

interface Appointment {
  id: string
  startTime: string
  endTime: string
  status: string
  artist: { id: string; user: { email: string } } | null
}

interface ClientOption {
  id: string
  firstName: string
  lastName: string
  email: string | null
  phone: string | null
}

const EMPTY_MERGE_FORM = { firstName: '', lastName: '', email: '', phone: '' }

export default function ClientDetail() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const { profile } = useUserProfile()
  const canManage = profile?.permissions.includes('clients.manage') ?? false
  const queryClient = useQueryClient()
  const [client, setClient] = useState<Client | null>(null)
  const [appointments, setAppointments] = useState<Appointment[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshIndex, setRefreshIndex] = useState(0)

  const [sendingForm, setSendingForm] = useState(false)
  const [sendFormError, setSendFormError] = useState<string | null>(null)
  const [latestSigningUrl, setLatestSigningUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const [showMergeModal, setShowMergeModal] = useState(false)
  const [otherClients, setOtherClients] = useState<ClientOption[] | null>(null)
  const [duplicateId, setDuplicateId] = useState('')
  const [mergeForm, setMergeForm] = useState(EMPTY_MERGE_FORM)
  const [merging, setMerging] = useState(false)
  const [mergeError, setMergeError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return

    let ignore = false

    async function load() {
      setClient(null)
      setAppointments(null)
      setError(null)

      try {
        const [clientData, appointmentsData] = await Promise.all([
          apiFetch<Client>(`/clients/${id}`),
          apiFetch<Appointment[]>(`/appointments?clientId=${id}`),
        ])

        if (ignore) return
        setClient(clientData)
        setAppointments(appointmentsData)
      } catch (err) {
        if (ignore) return

        if (err instanceof ApiError && err.status === 404) {
          setError('Client not found.')
        } else if (err instanceof ApiError && err.status === 403) {
          setError("You don't have permission to view this client.")
        } else {
          setError(err instanceof Error ? err.message : 'Failed to load client')
        }
      }
    }

    load()

    return () => {
      ignore = true
    }
  }, [id, refreshIndex])

  const duplicate = otherClients?.find((c) => c.id === duplicateId) ?? null

  function openMergeModal() {
    setShowMergeModal(true)
    setMergeError(null)

    if (otherClients === null) {
      apiFetch<ClientOption[]>('/clients')
        .then((data) => setOtherClients(data.filter((c) => c.id !== id)))
        .catch(() => {
          // The picker just stays empty if this fails; the modal's error
          // state covers the submit-time failure case.
        })
    }
  }

  function selectDuplicate(selectedId: string) {
    setDuplicateId(selectedId)
    const selected = otherClients?.find((c) => c.id === selectedId)

    if (client && selected) {
      setMergeForm({
        firstName: client.firstName || selected.firstName,
        lastName: client.lastName || selected.lastName,
        email: client.email || selected.email || '',
        phone: client.phone || selected.phone || '',
      })
    }
  }

  async function handleMerge() {
    if (!id || !duplicateId) return

    setMerging(true)
    setMergeError(null)

    try {
      await apiFetch(`/clients/${id}/merge`, {
        method: 'POST',
        body: JSON.stringify({
          duplicateId,
          firstName: mergeForm.firstName,
          lastName: mergeForm.lastName,
          email: mergeForm.email || undefined,
          phone: mergeForm.phone || undefined,
        }),
      })

      if (user) queryClient.invalidateQueries({ queryKey: clientsQueryKey(user.studioId) })
      setShowMergeModal(false)
      setOtherClients(null)
      setDuplicateId('')
      setMergeForm(EMPTY_MERGE_FORM)
      setRefreshIndex((index) => index + 1)
    } catch (err) {
      setMergeError(err instanceof Error ? err.message : 'Failed to merge clients')
    } finally {
      setMerging(false)
    }
  }

  async function handleSendConsentForm() {
    if (!id) return

    setSendingForm(true)
    setSendFormError(null)
    setCopied(false)

    try {
      const result = await apiFetch<ConsentForm & { signingUrl: string }>(`/clients/${id}/consent-forms`, {
        method: 'POST',
      })

      setLatestSigningUrl(result.signingUrl)
      setClient((prev) =>
        prev
          ? {
              ...prev,
              consentForms: [{ id: result.id, signedAt: result.signedAt, createdAt: result.createdAt }, ...prev.consentForms],
            }
          : prev,
      )
    } catch (err) {
      setSendFormError(err instanceof Error ? err.message : 'Failed to send consent form')
    } finally {
      setSendingForm(false)
    }
  }

  async function handleCopyLink() {
    if (!latestSigningUrl) return

    try {
      await navigator.clipboard.writeText(latestSigningUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setSendFormError('Failed to copy the link — copy it manually.')
    }
  }

  return (
    <div className="flex min-h-screen bg-neutral-900 text-white">
      <Sidebar />

      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-6 py-6 sm:px-10 sm:py-8">
          <Link to="/clients" className="inline-flex items-center gap-2 text-sm text-neutral-400 hover:text-white">
            <ArrowLeftIcon className="h-4 w-4" />
            Back to Clients
          </Link>

          {error && (
            <div className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          {!error && !client && <p className="mt-6 text-sm text-neutral-400">Loading client…</p>}

          {!error && client && (
            <>
              <div className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-neutral-800 text-lg font-semibold text-white">
                      {client.firstName[0]}
                      {client.lastName[0]}
                    </span>
                    <div>
                      <h1 className="text-xl font-bold text-white">
                        {client.firstName} {client.lastName}
                      </h1>
                      <p className="mt-1 text-sm text-neutral-400">{client.email ?? 'No email on file'}</p>
                      <p className="text-sm text-neutral-400">{client.phone ?? 'No phone on file'}</p>
                    </div>
                  </div>

                  {canManage && (
                    <button
                      type="button"
                      onClick={openMergeModal}
                      className="rounded-full border border-neutral-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-neutral-800"
                    >
                      Merge Duplicate
                    </button>
                  )}
                </div>
              </div>

              <div className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
                <h2 className="text-base font-semibold text-white">Inquiries</h2>

                {client.inquiries.length === 0 && <p className="mt-4 text-sm text-neutral-400">No inquiries yet.</p>}

                {client.inquiries.length > 0 && (
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="text-xs text-neutral-500">
                          <th className="pb-3 font-medium">Description</th>
                          <th className="pb-3 font-medium">Channel</th>
                          <th className="pb-3 font-medium">Submitted</th>
                          <th className="pb-3 font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-800">
                        {client.inquiries.map((inquiry) => (
                          <tr key={inquiry.id}>
                            <td className="py-3 text-white">
                              <Link to={`/inquiries/${inquiry.id}`} className="hover:underline">
                                {inquiry.description.length > 60
                                  ? `${inquiry.description.slice(0, 60).trimEnd()}…`
                                  : inquiry.description}
                              </Link>
                            </td>
                            <td className="py-3 text-neutral-400">{formatStatus(inquiry.channel)}</td>
                            <td className="py-3 text-neutral-400">{formatDateTime(inquiry.createdAt)}</td>
                            <td className="py-3">
                              <span className="inline-flex items-center rounded-full border border-neutral-700 px-3 py-1 text-xs font-medium text-neutral-300">
                                {formatStatus(inquiry.status)}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
                <h2 className="text-base font-semibold text-white">Appointments</h2>

                {appointments === null && <p className="mt-4 text-sm text-neutral-400">Loading appointments…</p>}

                {appointments !== null && appointments.length === 0 && (
                  <p className="mt-4 text-sm text-neutral-400">No appointments yet.</p>
                )}

                {appointments !== null && appointments.length > 0 && (
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="text-xs text-neutral-500">
                          <th className="pb-3 font-medium">Artist</th>
                          <th className="pb-3 font-medium">Date &amp; Time</th>
                          <th className="pb-3 font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-800">
                        {appointments.map((appointment) => (
                          <tr key={appointment.id}>
                            <td className="py-3 text-white">{appointment.artist?.user.email ?? '—'}</td>
                            <td className="py-3 text-neutral-400">{formatDateTime(appointment.startTime)}</td>
                            <td className="py-3">
                              <span className="inline-flex items-center rounded-full border border-neutral-700 px-3 py-1 text-xs font-medium text-neutral-300">
                                {formatStatus(appointment.status)}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-semibold text-white">Consent Forms</h2>
                  {canManage && (
                    <button
                      type="button"
                      onClick={handleSendConsentForm}
                      disabled={sendingForm}
                      className="flex items-center gap-2 rounded-full border border-neutral-700 bg-neutral-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-neutral-600 disabled:opacity-60"
                    >
                      <PlusIcon className="h-4 w-4" />
                      {sendingForm ? 'Sending…' : 'Send Consent Form'}
                    </button>
                  )}
                </div>

                {sendFormError && (
                  <div className="mt-4 rounded-lg border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-400">
                    {sendFormError}
                  </div>
                )}

                {latestSigningUrl && (
                  <div className="mt-4 rounded-lg border border-neutral-800 p-3">
                    <p className="mb-2 text-xs text-neutral-500">
                      Share this link with the client — it expires in 48 hours.
                    </p>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        readOnly
                        value={latestSigningUrl}
                        onFocus={(event) => event.target.select()}
                        className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={handleCopyLink}
                        className="shrink-0 rounded-full border border-neutral-700 bg-neutral-800 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-700"
                      >
                        {copied ? 'Copied!' : 'Copy Link'}
                      </button>
                    </div>
                  </div>
                )}

                <div className="mt-4">
                  {client.consentForms.length === 0 && (
                    <p className="text-sm text-neutral-400">No consent forms sent yet.</p>
                  )}

                  {client.consentForms.length > 0 && (
                    <ul className="divide-y divide-neutral-800">
                      {client.consentForms.map((form) => (
                        <li key={form.id} className="flex items-center justify-between py-3 text-sm">
                          <span className="text-neutral-400">Sent {formatDateTime(form.createdAt)}</span>
                          <span className="inline-flex items-center rounded-full border border-neutral-700 px-3 py-1 text-xs font-medium text-neutral-300">
                            {form.signedAt ? `Signed ${formatDateTime(form.signedAt)}` : 'Pending'}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {showMergeModal && (
        <Modal
          title="Merge Duplicate Client"
          onClose={() => {
            setShowMergeModal(false)
            setDuplicateId('')
            setMergeForm(EMPTY_MERGE_FORM)
            setMergeError(null)
          }}
        >
          <p className="text-sm text-neutral-400">
            Pick the duplicate record. All of its appointments, inquiries, and consent forms move here, then it's
            deleted.
          </p>

          <div className="mt-4">
            <label htmlFor="duplicateId" className="mb-1 block text-sm font-medium text-neutral-300">
              Duplicate client
            </label>
            <select
              id="duplicateId"
              value={duplicateId}
              onChange={(event) => selectDuplicate(event.target.value)}
              className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600"
            >
              <option value="" disabled>
                {otherClients === null ? 'Loading…' : 'Select a client'}
              </option>
              {otherClients?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.firstName} {c.lastName} {c.email ? `(${c.email})` : ''}
                </option>
              ))}
            </select>
          </div>

          {duplicate && (
            <div className="mt-4 space-y-3">
              <p className="text-xs font-medium uppercase tracking-wider text-neutral-500">
                Choose which value to keep
              </p>

              <div>
                <label className="mb-1 block text-sm font-medium text-neutral-300">First name</label>
                <select
                  value={mergeForm.firstName}
                  onChange={(event) => setMergeForm({ ...mergeForm, firstName: event.target.value })}
                  className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600"
                >
                  {[...new Set([client?.firstName, duplicate.firstName])].map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-neutral-300">Last name</label>
                <select
                  value={mergeForm.lastName}
                  onChange={(event) => setMergeForm({ ...mergeForm, lastName: event.target.value })}
                  className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600"
                >
                  {[...new Set([client?.lastName, duplicate.lastName])].map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-neutral-300">Email</label>
                <select
                  value={mergeForm.email}
                  onChange={(event) => setMergeForm({ ...mergeForm, email: event.target.value })}
                  className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600"
                >
                  {[...new Set([client?.email ?? '', duplicate.email ?? ''])].map((value) => (
                    <option key={value || 'none'} value={value}>
                      {value || 'Not provided'}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-neutral-300">Phone</label>
                <select
                  value={mergeForm.phone}
                  onChange={(event) => setMergeForm({ ...mergeForm, phone: event.target.value })}
                  className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600"
                >
                  {[...new Set([client?.phone ?? '', duplicate.phone ?? ''])].map((value) => (
                    <option key={value || 'none'} value={value}>
                      {value || 'Not provided'}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {mergeError && <p className="mt-3 text-sm text-red-400">{mergeError}</p>}

          <button
            type="button"
            onClick={handleMerge}
            disabled={!duplicateId || merging}
            className="mt-5 w-full rounded-full border border-neutral-700 bg-neutral-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-600 disabled:opacity-60"
          >
            {merging ? 'Merging…' : 'Merge and Delete Duplicate'}
          </button>
        </Modal>
      )}
    </div>
  )
}
