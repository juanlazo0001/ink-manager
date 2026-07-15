import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import Sidebar from '../components/Sidebar'
import { apiFetch, ApiError } from '../lib/api'
import { formatDateTime, formatStatus } from '../lib/format'
import { ArrowLeftIcon, PlusIcon } from '../components/icons'
import { useUserProfile } from '../context/useUserProfile'

interface ConsentForm {
  id: string
  signedAt: string | null
  createdAt: string
}

interface Client {
  id: string
  firstName: string
  lastName: string
  email: string | null
  phone: string | null
  consentForms: ConsentForm[]
}

interface Appointment {
  id: string
  startTime: string
  endTime: string
  status: string
  artist: { id: string; user: { email: string } } | null
}

export default function ClientDetail() {
  const { id } = useParams<{ id: string }>()
  const { profile } = useUserProfile()
  const canManage = profile?.permissions.includes('clients.manage') ?? false
  const [client, setClient] = useState<Client | null>(null)
  const [appointments, setAppointments] = useState<Appointment[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [sendingForm, setSendingForm] = useState(false)
  const [sendFormError, setSendFormError] = useState<string | null>(null)
  const [latestSigningUrl, setLatestSigningUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

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
  }, [id])

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
    </div>
  )
}
