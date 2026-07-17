import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import Sidebar from '../components/Sidebar'
import Modal from '../components/Modal'
import AuditTrail from '../components/AuditTrail'
import { apiFetch, ApiError } from '../lib/api'
import { formatDateTime, formatStatus } from '../lib/format'
import { ArrowLeftIcon, MessageIcon, PencilIcon, PlusIcon } from '../components/icons'
import { useUserProfile } from '../context/useUserProfile'
import { useEffectiveUser } from '../context/useEffectiveUser'
import { useConversationPanel } from '../context/useConversationPanel'
import { clientsQueryKey } from '../lib/queryKeys'

interface ConsentForm {
  id: string
  signedAt: string | null
  createdAt: string
}

interface DepositFormSummary {
  id: string
  depositAmount: number
  feeAmount: number
  totalCharged: number
  signedAt: string | null
  paidManually: boolean
  paidAt: string | null
}

interface InquirySummary {
  id: string
  description: string
  status: string
  channel: string
  createdAt: string
  depositForm: DepositFormSummary | null
}

interface GiftCard {
  id: string
  code: string
  amountCents: number
  status: string
  expiresAt: string | null
  appointmentId: string | null
  createdAt: string
}

interface WaiverSummary {
  id: string
  status: string
  signedAt: string | null
  verifiedAt: string | null
  appointmentId: string
  createdAt: string
}

interface Client {
  id: string
  firstName: string
  lastName: string
  email: string | null
  phone: string | null
  mergedIntoId: string | null
  mergedInto: { id: string; firstName: string; lastName: string } | null
  consentForms: ConsentForm[]
  inquiries: InquirySummary[]
  giftCards: GiftCard[]
  liabilityWaivers: WaiverSummary[]
}

interface Appointment {
  id: string
  startTime: string
  endTime: string
  status: string
  finalCostCents: number | null
  closeoutNotes: string | null
  artist: { id: string; user: { email: string } } | null
}

interface DuplicateCandidate {
  id: string
  firstName: string
  lastName: string
  email: string | null
  phone: string | null
}

interface MergePreview {
  inquiries: number
  appointments: number
  consentForms: number
  giftCards: number
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

const EMPTY_EDIT_FORM = { firstName: '', lastName: '', email: '', phone: '' }

const EMPTY_GIFT_CARD_FORM = { amountDollars: '', expiresAt: '' }

export default function ClientDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const user = useEffectiveUser()
  const { profile } = useUserProfile()
  const canManage = profile?.permissions.includes('clients.manage') ?? false
  const canIssueGiftCards = user?.role === 'OWNER' || user?.role === 'FRONT_DESK'
  const canMessage = user?.role === 'OWNER' || user?.role === 'FRONT_DESK'
  const { openPanel } = useConversationPanel()
  const [startingConversation, setStartingConversation] = useState(false)

  async function handleMessage() {
    if (!id) return
    setStartingConversation(true)
    try {
      const conversation = await apiFetch<{ id: string }>('/conversations', {
        method: 'POST',
        body: JSON.stringify({ clientId: id }),
      })
      openPanel(conversation.id)
    } catch {
      // Non-critical -- the floating button still works if this fails.
    } finally {
      setStartingConversation(false)
    }
  }
  const queryClient = useQueryClient()
  const [client, setClient] = useState<Client | null>(null)
  const [appointments, setAppointments] = useState<Appointment[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshIndex, setRefreshIndex] = useState(0)

  const [showIssueGiftCard, setShowIssueGiftCard] = useState(false)
  const [giftCardForm, setGiftCardForm] = useState(EMPTY_GIFT_CARD_FORM)
  const [issuingGiftCard, setIssuingGiftCard] = useState(false)
  const [giftCardError, setGiftCardError] = useState<string | null>(null)

  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState(EMPTY_EDIT_FORM)
  const [editError, setEditError] = useState<string | null>(null)
  const [editSubmitting, setEditSubmitting] = useState(false)

  const [sendingForm, setSendingForm] = useState(false)
  const [sendFormError, setSendFormError] = useState<string | null>(null)
  const [latestSigningUrl, setLatestSigningUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const [duplicates, setDuplicates] = useState<DuplicateCandidate[] | null>(null)
  const [mergeTarget, setMergeTarget] = useState<DuplicateCandidate | null>(null)
  const [mergePreview, setMergePreview] = useState<MergePreview | null>(null)
  const [mergePreviewLoading, setMergePreviewLoading] = useState(false)
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
        const [clientData, appointmentsData, duplicatesData] = await Promise.all([
          apiFetch<Client>(`/clients/${id}`),
          apiFetch<Appointment[]>(`/appointments?clientId=${id}`),
          apiFetch<DuplicateCandidate[]>(`/clients/${id}/potential-duplicates`).catch(() => []),
        ])

        if (ignore) return
        setClient(clientData)
        setAppointments(appointmentsData)
        setDuplicates(duplicatesData)
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

  function startEditing() {
    if (!client) return
    setEditForm({
      firstName: client.firstName,
      lastName: client.lastName,
      email: client.email ?? '',
      phone: client.phone ?? '',
    })
    setEditError(null)
    setEditing(true)
  }

  async function handleEditSubmit(event: FormEvent) {
    event.preventDefault()
    if (!id) return

    setEditSubmitting(true)
    setEditError(null)

    try {
      const updated = await apiFetch<Client>(`/clients/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          firstName: editForm.firstName,
          lastName: editForm.lastName,
          email: editForm.email || null,
          phone: editForm.phone || null,
        }),
      })

      setClient((prev) => (prev ? { ...prev, ...updated } : prev))
      if (user) queryClient.invalidateQueries({ queryKey: clientsQueryKey(user.studioId) })
      setEditing(false)
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Failed to update client')
    } finally {
      setEditSubmitting(false)
    }
  }

  async function handleIssueGiftCard(event: FormEvent) {
    event.preventDefault()
    if (!id) return

    setIssuingGiftCard(true)
    setGiftCardError(null)

    try {
      const amountCents = Math.round(Number(giftCardForm.amountDollars) * 100)

      await apiFetch('/gift-cards', {
        method: 'POST',
        body: JSON.stringify({
          clientId: id,
          amountCents,
          ...(user?.role === 'OWNER' && giftCardForm.expiresAt
            ? { expiresAt: new Date(giftCardForm.expiresAt).toISOString() }
            : {}),
        }),
      })

      setShowIssueGiftCard(false)
      setGiftCardForm(EMPTY_GIFT_CARD_FORM)
      setRefreshIndex((index) => index + 1)
    } catch (err) {
      setGiftCardError(err instanceof Error ? err.message : 'Failed to issue gift card')
    } finally {
      setIssuingGiftCard(false)
    }
  }

  async function openMergeConfirm(candidate: DuplicateCandidate) {
    setMergeTarget(candidate)
    setMergeError(null)
    setMergePreview(null)
    setMergePreviewLoading(true)

    try {
      const [candidateDetail, candidateAppointments] = await Promise.all([
        apiFetch<Client>(`/clients/${candidate.id}`),
        apiFetch<Appointment[]>(`/appointments?clientId=${candidate.id}`),
      ])

      setMergePreview({
        inquiries: candidateDetail.inquiries.length,
        consentForms: candidateDetail.consentForms.length,
        giftCards: candidateDetail.giftCards.length,
        appointments: candidateAppointments.length,
      })
    } catch (err) {
      setMergeError(err instanceof Error ? err.message : 'Failed to load what would move')
    } finally {
      setMergePreviewLoading(false)
    }
  }

  async function handleConfirmMerge() {
    if (!id || !mergeTarget) return

    setMerging(true)
    setMergeError(null)

    try {
      await apiFetch(`/clients/${id}/merge`, {
        method: 'POST',
        body: JSON.stringify({ sourceClientId: mergeTarget.id }),
      })

      if (user) queryClient.invalidateQueries({ queryKey: clientsQueryKey(user.studioId) })
      setMergeTarget(null)
      setMergePreview(null)
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

  const depositForms = client?.inquiries.filter((inquiry) => inquiry.depositForm !== null) ?? []

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
              {client.mergedIntoId && client.mergedInto && (
                <div className="mt-6 rounded-2xl border border-amber-900/50 bg-amber-950/30 p-4 text-sm text-amber-200">
                  This client was merged into{' '}
                  <Link to={`/clients/${client.mergedInto.id}`} className="font-semibold underline">
                    {client.mergedInto.firstName} {client.mergedInto.lastName}
                  </Link>
                  . It's kept for history but is no longer an active record.
                </div>
              )}

              <div className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
                {editing ? (
                  <form onSubmit={handleEditSubmit}>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-sm font-medium text-neutral-300">First name</label>
                        <input
                          type="text"
                          required
                          value={editForm.firstName}
                          onChange={(e) => setEditForm({ ...editForm, firstName: e.target.value })}
                          className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-sm font-medium text-neutral-300">Last name</label>
                        <input
                          type="text"
                          required
                          value={editForm.lastName}
                          onChange={(e) => setEditForm({ ...editForm, lastName: e.target.value })}
                          className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-sm font-medium text-neutral-300">Email</label>
                        <input
                          type="email"
                          value={editForm.email}
                          onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                          className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-sm font-medium text-neutral-300">Phone</label>
                        <input
                          type="tel"
                          value={editForm.phone}
                          onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                          className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600"
                        />
                      </div>
                    </div>

                    {editError && <p className="mt-3 text-sm text-red-400">{editError}</p>}

                    <div className="mt-4 flex gap-3">
                      <button
                        type="submit"
                        disabled={editSubmitting}
                        className="rounded-full border border-neutral-700 bg-neutral-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-neutral-600 disabled:opacity-60"
                      >
                        {editSubmitting ? 'Saving…' : 'Save'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditing(false)}
                        className="rounded-full border border-neutral-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-neutral-800"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
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

                    <div className="flex shrink-0 gap-2">
                      {canMessage && !client.mergedIntoId && (
                        <button
                          type="button"
                          onClick={handleMessage}
                          disabled={startingConversation}
                          className="flex items-center gap-2 rounded-full border border-neutral-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-neutral-800 disabled:opacity-60"
                        >
                          <MessageIcon className="h-4 w-4" />
                          Message
                        </button>
                      )}
                      {canManage && !client.mergedIntoId && (
                        <button
                          type="button"
                          onClick={startEditing}
                          className="flex items-center gap-2 rounded-full border border-neutral-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-neutral-800"
                        >
                          <PencilIcon className="h-4 w-4" />
                          Edit
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {canManage && !client.mergedIntoId && duplicates && duplicates.length > 0 && (
                <div className="mt-6 rounded-2xl border border-amber-900/50 bg-amber-950/30 p-4">
                  <p className="text-sm font-medium text-amber-200">
                    {duplicates.length} potential duplicate{duplicates.length > 1 ? 's' : ''} found
                  </p>
                  <ul className="mt-3 space-y-2">
                    {duplicates.map((candidate) => (
                      <li
                        key={candidate.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-900/40 bg-neutral-900/40 px-3 py-2 text-sm"
                      >
                        <span className="text-amber-100">
                          {candidate.firstName} {candidate.lastName}
                          {candidate.email ? ` — ${candidate.email}` : ''}
                          {candidate.phone ? ` — ${candidate.phone}` : ''}
                        </span>
                        <button
                          type="button"
                          onClick={() => openMergeConfirm(candidate)}
                          className="rounded-full border border-amber-700 px-3 py-1 text-xs font-semibold text-amber-100 transition hover:bg-amber-900/40"
                        >
                          Merge into this client
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

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
                          <th className="pb-3 font-medium">Final Cost</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-800">
                        {appointments.map((appointment) => (
                          <tr
                            key={appointment.id}
                            onClick={() => navigate(`/appointments/${appointment.id}`)}
                            className="cursor-pointer hover:bg-neutral-800/40"
                          >
                            <td className="py-3 text-white">{appointment.artist?.user.email ?? '—'}</td>
                            <td className="py-3 text-neutral-400">{formatDateTime(appointment.startTime)}</td>
                            <td className="py-3">
                              <span className="inline-flex items-center rounded-full border border-neutral-700 px-3 py-1 text-xs font-medium text-neutral-300">
                                {formatStatus(appointment.status)}
                              </span>
                            </td>
                            <td className="py-3 text-neutral-400">
                              {appointment.finalCostCents != null ? formatCents(appointment.finalCostCents) : '—'}
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
                  <h2 className="text-base font-semibold text-white">Gift Cards</h2>
                  {canIssueGiftCards && (
                    <button
                      type="button"
                      onClick={() => setShowIssueGiftCard(true)}
                      className="flex items-center gap-2 rounded-full border border-neutral-700 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-neutral-800"
                    >
                      <PlusIcon className="h-3.5 w-3.5" />
                      Issue Gift Card
                    </button>
                  )}
                </div>

                {client.giftCards.length === 0 && <p className="mt-4 text-sm text-neutral-400">No gift cards yet.</p>}

                {client.giftCards.length > 0 && (
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="text-xs text-neutral-500">
                          <th className="pb-3 font-medium">Code</th>
                          <th className="pb-3 font-medium">Amount</th>
                          <th className="pb-3 font-medium">Status</th>
                          <th className="pb-3 font-medium">Expires</th>
                          <th className="pb-3 font-medium">Attached</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-800">
                        {client.giftCards.map((card) => (
                          <tr
                            key={card.id}
                            onClick={() => navigate(`/gift-cards/${card.id}`)}
                            className="cursor-pointer hover:bg-neutral-800/40"
                          >
                            <td className="py-3 font-mono text-xs text-white">{card.code}</td>
                            <td className="py-3 text-neutral-400">{formatCents(card.amountCents)}</td>
                            <td className="py-3">
                              <span className="inline-flex items-center rounded-full border border-neutral-700 px-3 py-1 text-xs font-medium text-neutral-300">
                                {formatStatus(card.status)}
                              </span>
                            </td>
                            <td className="py-3 text-neutral-400">
                              {card.expiresAt ? formatDateTime(card.expiresAt) : 'No expiration'}
                            </td>
                            <td className="py-3 text-neutral-400">{card.appointmentId ? 'Yes' : 'Unattached'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
                <h2 className="text-base font-semibold text-white">Deposit Forms</h2>

                {depositForms.length === 0 && <p className="mt-4 text-sm text-neutral-400">No deposit forms yet.</p>}

                {depositForms.length > 0 && (
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="text-xs text-neutral-500">
                          <th className="pb-3 font-medium">Deposit</th>
                          <th className="pb-3 font-medium">Total</th>
                          <th className="pb-3 font-medium">Signed</th>
                          <th className="pb-3 font-medium">Paid</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-800">
                        {depositForms.map((inquiry) => (
                          <tr key={inquiry.id}>
                            <td className="py-3 text-white">${inquiry.depositForm!.depositAmount}</td>
                            <td className="py-3 text-neutral-400">${inquiry.depositForm!.totalCharged}</td>
                            <td className="py-3 text-neutral-400">
                              {inquiry.depositForm!.signedAt ? formatDateTime(inquiry.depositForm!.signedAt) : 'Pending'}
                            </td>
                            <td className="py-3 text-neutral-400">
                              {inquiry.depositForm!.paidManually
                                ? inquiry.depositForm!.paidAt
                                  ? formatDateTime(inquiry.depositForm!.paidAt)
                                  : 'Yes'
                                : 'Not yet'}
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
                  {canManage && !client.mergedIntoId && (
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

              <div className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
                <h2 className="text-base font-semibold text-white">Waivers</h2>

                {client.liabilityWaivers.length === 0 && (
                  <p className="mt-4 text-sm text-neutral-400">No waivers yet.</p>
                )}

                {client.liabilityWaivers.length > 0 && (
                  <ul className="mt-4 divide-y divide-neutral-800">
                    {client.liabilityWaivers.map((waiver) => (
                      <li
                        key={waiver.id}
                        onClick={() => navigate(`/appointments/${waiver.appointmentId}`)}
                        className="flex cursor-pointer items-center justify-between py-3 text-sm hover:bg-neutral-800/40"
                      >
                        <span className="text-neutral-400">
                          {waiver.signedAt ? `Signed ${formatDateTime(waiver.signedAt)}` : `Created ${formatDateTime(waiver.createdAt)}`}
                        </span>
                        <span className="inline-flex items-center rounded-full border border-neutral-700 px-3 py-1 text-xs font-medium text-neutral-300">
                          {formatStatus(waiver.status)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <AuditTrail entityType="Client" entityId={client.id} />
            </>
          )}
        </div>
      </div>

      {showIssueGiftCard && (
        <Modal
          title="Issue Gift Card"
          onClose={() => {
            setShowIssueGiftCard(false)
            setGiftCardForm(EMPTY_GIFT_CARD_FORM)
            setGiftCardError(null)
          }}
        >
          <form onSubmit={handleIssueGiftCard}>
            <div>
              <label className="mb-1 block text-sm font-medium text-neutral-300">Amount ($)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                required
                value={giftCardForm.amountDollars}
                onChange={(e) => setGiftCardForm({ ...giftCardForm, amountDollars: e.target.value })}
                className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600"
              />
            </div>

            {user?.role === 'OWNER' && (
              <div className="mt-3">
                <label className="mb-1 block text-sm font-medium text-neutral-300">
                  Custom expiration (optional, overrides studio default)
                </label>
                <input
                  type="date"
                  value={giftCardForm.expiresAt}
                  onChange={(e) => setGiftCardForm({ ...giftCardForm, expiresAt: e.target.value })}
                  className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600"
                />
              </div>
            )}

            {giftCardError && <p className="mt-3 text-sm text-red-400">{giftCardError}</p>}

            <button
              type="submit"
              disabled={issuingGiftCard}
              className="mt-5 w-full rounded-full border border-neutral-700 bg-neutral-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-600 disabled:opacity-60"
            >
              {issuingGiftCard ? 'Issuing…' : 'Issue Gift Card'}
            </button>
          </form>
        </Modal>
      )}

      {mergeTarget && (
        <Modal
          title="Confirm Merge"
          onClose={() => {
            setMergeTarget(null)
            setMergePreview(null)
            setMergeError(null)
          }}
        >
          <p className="text-sm text-neutral-300">
            Merge <span className="font-semibold">{mergeTarget.firstName} {mergeTarget.lastName}</span> into{' '}
            <span className="font-semibold">{client?.firstName} {client?.lastName}</span>?
          </p>

          <p className="mt-2 text-xs text-neutral-500">
            {mergeTarget.firstName} will be kept for history but marked merged, and won't appear in client lists
            anymore. This is not easily reversible.
          </p>

          {mergePreviewLoading && <p className="mt-4 text-sm text-neutral-400">Checking what will move…</p>}

          {mergePreview && (
            <div className="mt-4 rounded-lg border border-neutral-800 p-3 text-sm">
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-neutral-500">Will move to this client</p>
              <ul className="space-y-1 text-neutral-300">
                <li>{mergePreview.inquiries} inquir{mergePreview.inquiries === 1 ? 'y' : 'ies'}</li>
                <li>{mergePreview.appointments} appointment{mergePreview.appointments === 1 ? '' : 's'}</li>
                <li>{mergePreview.consentForms} consent form{mergePreview.consentForms === 1 ? '' : 's'}</li>
                <li>{mergePreview.giftCards} gift card{mergePreview.giftCards === 1 ? '' : 's'}</li>
              </ul>
            </div>
          )}

          {mergeError && <p className="mt-3 text-sm text-red-400">{mergeError}</p>}

          <button
            type="button"
            onClick={handleConfirmMerge}
            disabled={merging || mergePreviewLoading}
            className="mt-5 w-full rounded-full border border-neutral-700 bg-neutral-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-600 disabled:opacity-60"
          >
            {merging ? 'Merging…' : 'Confirm Merge'}
          </button>
        </Modal>
      )}
    </div>
  )
}
