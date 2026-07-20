import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import Sidebar from '../components/Sidebar'
import Modal from '../components/Modal'
import AuditTrail from '../components/AuditTrail'
import StatusPill from '../components/StatusPill'
import PhoneInput from '../components/PhoneInput'
import { apiFetch, ApiError } from '../lib/api'
import { formatDateTime, formatPhoneInput, formatStatus, isValidPhoneDigits } from '../lib/format'
import { ArrowLeftIcon, CopyIcon, MessageIcon, MoreIcon, PencilIcon, PlusIcon } from '../components/icons'
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

interface ClientPhoneAlias {
  id: string
  phone: string
  label: string | null
  isPrimary: boolean
}

interface ClientEmailAlias {
  id: string
  email: string
  label: string | null
  isPrimary: boolean
}

interface Client {
  id: string
  firstName: string
  lastName: string
  email: string | null
  phone: string | null
  mergedIntoId: string | null
  mergedInto: { id: string; firstName: string; lastName: string } | null
  archivedAt: string | null
  consentForms: ConsentForm[]
  inquiries: InquirySummary[]
  giftCards: GiftCard[]
  liabilityWaivers: WaiverSummary[]
  phones: ClientPhoneAlias[]
  emails: ClientEmailAlias[]
}

interface Appointment {
  id: string
  startTime: string
  endTime: string
  status: string
  finalCostCents: number | null
  closeoutNotes: string | null
  // Matches GET /appointments's response shape (Phase UI-5) -- a display
  // name, not a nested user/email chain.
  artist: { id: string; name: string } | null
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

interface DeletePreview {
  inquiries: number
  appointments: number
  waivers: number
  consentForms: number
  giftCards: { id: string; code: string; amountCents: number; status: string }[]
  activeGiftCardCents: number
  depositForms: number
  conversations: number
  messages: number
  blockedByMerge: boolean
}

const DELETE_CONFIRM_TEXT = 'DELETE'

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
  const isOwner = user?.role === 'OWNER'
  const canIssueGiftCards = user?.role === 'OWNER' || user?.role === 'FRONT_DESK'
  const canMessage = user?.role === 'OWNER' || user?.role === 'FRONT_DESK'
  const canGeneratePrefillLink = user?.role === 'OWNER' || user?.role === 'FRONT_DESK'
  const { openPanel } = useConversationPanel()
  const [startingConversation, setStartingConversation] = useState(false)
  const [copyingPrefillLink, setCopyingPrefillLink] = useState(false)
  const [prefillLinkError, setPrefillLinkError] = useState<string | null>(null)
  const [showCopyMenu, setShowCopyMenu] = useState(false)
  const [copyToast, setCopyToast] = useState<string | null>(null)

  useEffect(() => {
    if (!showCopyMenu) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setShowCopyMenu(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [showCopyMenu])

  function showCopyToast(message: string) {
    setCopyToast(message)
    setTimeout(() => setCopyToast(null), 2000)
  }

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

  // Plain-text block for pasting into a text message, email, or wherever
  // else staff need it -- primary contact first (already how client.phones/
  // client.emails come back from the API), each secondary one after with
  // its label if it has one.
  function buildCustomerDetailsText(target: Client): string {
    const lines = [`${target.firstName} ${target.lastName}`]
    for (const p of target.phones) {
      lines.push(`${formatPhoneInput(p.phone)}${p.label ? ` (${p.label})` : ''}`)
    }
    for (const e of target.emails) {
      lines.push(`${e.email}${e.label ? ` (${e.label})` : ''}`)
    }
    return lines.join('\n')
  }

  async function handleCopyCustomerDetails() {
    if (!client) return
    setShowCopyMenu(false)
    try {
      await navigator.clipboard.writeText(buildCustomerDetailsText(client))
      showCopyToast('Customer details copied')
    } catch {
      showCopyToast('Failed to copy — copy manually')
    }
  }

  // Same PrefillDraft token mechanism as the conversation composer's
  // "Prefilled intake link" menu item -- a standalone entry point for
  // generating one without an active conversation. Whatever contact fields
  // are populated on this client record go in; missing ones (no email on
  // file, etc.) are simply omitted, still producing a usable, mostly-empty
  // link rather than erroring.
  async function handleCopyPrefillLink() {
    if (!id || !client) return

    setShowCopyMenu(false)
    setCopyingPrefillLink(true)
    setPrefillLinkError(null)
    try {
      const draft = await apiFetch<{ prefillUrl: string }>('/prefill-drafts', {
        method: 'POST',
        body: JSON.stringify({
          payload: {
            firstName: client.firstName,
            lastName: client.lastName,
            email: client.email || undefined,
            phone: client.phone || undefined,
          },
        }),
      })
      await navigator.clipboard.writeText(draft.prefillUrl)
      showCopyToast('Prefilled link copied')
    } catch (err) {
      setPrefillLinkError(err instanceof Error ? err.message : 'Failed to generate link')
    } finally {
      setCopyingPrefillLink(false)
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

  const [showMoreMenu, setShowMoreMenu] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [archiveError, setArchiveError] = useState<string | null>(null)

  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [deletePreview, setDeletePreview] = useState<DeletePreview | null>(null)
  const [deletePreviewLoading, setDeletePreviewLoading] = useState(false)
  const [deletePreviewError, setDeletePreviewError] = useState<string | null>(null)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const [showAddPhone, setShowAddPhone] = useState(false)
  const [newPhone, setNewPhone] = useState('')
  const [newPhoneLabel, setNewPhoneLabel] = useState('')
  const [addingPhone, setAddingPhone] = useState(false)
  const [addPhoneError, setAddPhoneError] = useState<string | null>(null)

  const [showAddEmail, setShowAddEmail] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [newEmailLabel, setNewEmailLabel] = useState('')
  const [addingEmail, setAddingEmail] = useState(false)
  const [addEmailError, setAddEmailError] = useState<string | null>(null)

  const [contactActionError, setContactActionError] = useState<string | null>(null)
  const [contactActionPendingId, setContactActionPendingId] = useState<string | null>(null)

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

    if (!isValidPhoneDigits(editForm.phone)) {
      setEditError('Enter a complete 10-digit phone number.')
      return
    }

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

  async function handleArchive() {
    if (!id) return
    setArchiving(true)
    setArchiveError(null)
    try {
      const updated = await apiFetch<Client>(`/clients/${id}/archive`, { method: 'POST' })
      setClient((prev) => (prev ? { ...prev, ...updated } : prev))
      if (user) queryClient.invalidateQueries({ queryKey: clientsQueryKey(user.studioId) })
      setShowMoreMenu(false)
    } catch (err) {
      setArchiveError(err instanceof Error ? err.message : 'Failed to archive client')
    } finally {
      setArchiving(false)
    }
  }

  async function handleUnarchive() {
    if (!id) return
    setArchiving(true)
    setArchiveError(null)
    try {
      const updated = await apiFetch<Client>(`/clients/${id}/unarchive`, { method: 'POST' })
      setClient((prev) => (prev ? { ...prev, ...updated } : prev))
      if (user) queryClient.invalidateQueries({ queryKey: clientsQueryKey(user.studioId) })
      setShowMoreMenu(false)
    } catch (err) {
      setArchiveError(err instanceof Error ? err.message : 'Failed to unarchive client')
    } finally {
      setArchiving(false)
    }
  }

  async function openDeleteModal() {
    if (!id) return
    setShowMoreMenu(false)
    setShowDeleteModal(true)
    setDeleteConfirmText('')
    setDeleteError(null)
    setDeletePreview(null)
    setDeletePreviewLoading(true)
    try {
      const preview = await apiFetch<DeletePreview>(`/clients/${id}/delete-preview`)
      setDeletePreview(preview)
    } catch (err) {
      setDeletePreviewError(err instanceof Error ? err.message : 'Failed to load what will be deleted')
    } finally {
      setDeletePreviewLoading(false)
    }
  }

  async function handleConfirmDelete() {
    if (!id) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await apiFetch(`/clients/${id}`, {
        method: 'DELETE',
        body: JSON.stringify({ confirm: deleteConfirmText }),
      })
      if (user) queryClient.invalidateQueries({ queryKey: clientsQueryKey(user.studioId) })
      navigate('/clients', {
        state: { flash: `${client?.firstName} ${client?.lastName} was permanently deleted.` },
      })
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete client')
    } finally {
      setDeleting(false)
    }
  }

  async function handleAddPhone(event: FormEvent) {
    event.preventDefault()
    if (!id) return

    if (!isValidPhoneDigits(newPhone)) {
      setAddPhoneError('Enter a complete 10-digit phone number.')
      return
    }

    setAddingPhone(true)
    setAddPhoneError(null)
    try {
      await apiFetch(`/clients/${id}/phones`, {
        method: 'POST',
        body: JSON.stringify({ phone: newPhone, label: newPhoneLabel.trim() || undefined }),
      })
      setShowAddPhone(false)
      setNewPhone('')
      setNewPhoneLabel('')
      setRefreshIndex((index) => index + 1)
    } catch (err) {
      setAddPhoneError(err instanceof Error ? err.message : 'Failed to add phone')
    } finally {
      setAddingPhone(false)
    }
  }

  async function handleRemovePhone(phoneId: string) {
    if (!id) return
    setContactActionError(null)
    setContactActionPendingId(phoneId)
    try {
      await apiFetch(`/clients/${id}/phones/${phoneId}`, { method: 'DELETE' })
      setRefreshIndex((index) => index + 1)
    } catch (err) {
      setContactActionError(err instanceof Error ? err.message : 'Failed to remove phone')
    } finally {
      setContactActionPendingId(null)
    }
  }

  async function handleMakePrimaryPhone(phoneId: string) {
    if (!id) return
    setContactActionError(null)
    setContactActionPendingId(phoneId)
    try {
      await apiFetch(`/clients/${id}/phones/${phoneId}/make-primary`, { method: 'POST' })
      setRefreshIndex((index) => index + 1)
    } catch (err) {
      setContactActionError(err instanceof Error ? err.message : 'Failed to update primary phone')
    } finally {
      setContactActionPendingId(null)
    }
  }

  async function handleAddEmail(event: FormEvent) {
    event.preventDefault()
    if (!id) return

    if (!newEmail.trim()) {
      setAddEmailError('Enter an email address.')
      return
    }

    setAddingEmail(true)
    setAddEmailError(null)
    try {
      await apiFetch(`/clients/${id}/emails`, {
        method: 'POST',
        body: JSON.stringify({ email: newEmail, label: newEmailLabel.trim() || undefined }),
      })
      setShowAddEmail(false)
      setNewEmail('')
      setNewEmailLabel('')
      setRefreshIndex((index) => index + 1)
    } catch (err) {
      setAddEmailError(err instanceof Error ? err.message : 'Failed to add email')
    } finally {
      setAddingEmail(false)
    }
  }

  async function handleRemoveEmail(emailId: string) {
    if (!id) return
    setContactActionError(null)
    setContactActionPendingId(emailId)
    try {
      await apiFetch(`/clients/${id}/emails/${emailId}`, { method: 'DELETE' })
      setRefreshIndex((index) => index + 1)
    } catch (err) {
      setContactActionError(err instanceof Error ? err.message : 'Failed to remove email')
    } finally {
      setContactActionPendingId(null)
    }
  }

  async function handleMakePrimaryEmail(emailId: string) {
    if (!id) return
    setContactActionError(null)
    setContactActionPendingId(emailId)
    try {
      await apiFetch(`/clients/${id}/emails/${emailId}/make-primary`, { method: 'POST' })
      setRefreshIndex((index) => index + 1)
    } catch (err) {
      setContactActionError(err instanceof Error ? err.message : 'Failed to update primary email')
    } finally {
      setContactActionPendingId(null)
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
    <div className="flex min-h-screen bg-bg text-fg">
      <Sidebar />

      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-6 py-6 sm:px-10 sm:py-8">
          <Link to="/clients" className="inline-flex items-center gap-2 text-sm text-fg-secondary hover:text-fg">
            <ArrowLeftIcon className="h-4 w-4" />
            Back to Clients
          </Link>

          {error && (
            <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
              <p className="text-sm text-danger">{error}</p>
            </div>
          )}

          {!error && !client && <p className="mt-6 text-sm text-fg-secondary">Loading client…</p>}

          {!error && client && (
            <>
              {client.mergedIntoId && client.mergedInto && (
                <div className="mt-6 rounded-2xl border border-warning/30 bg-warning/10 p-4 text-sm text-warning">
                  This client was merged into{' '}
                  <Link to={`/clients/${client.mergedInto.id}`} className="font-semibold underline">
                    {client.mergedInto.firstName} {client.mergedInto.lastName}
                  </Link>
                  . It's kept for history but is no longer an active record.
                </div>
              )}

              {client.archivedAt && (
                <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-warning/30 bg-warning/10 p-4 text-sm text-warning">
                  <span>Archived {formatDateTime(client.archivedAt)}. Hidden from the client list, but fully intact.</span>
                  {canManage && (
                    <button
                      type="button"
                      onClick={handleUnarchive}
                      disabled={archiving}
                      className="rounded-full border border-warning/40 px-3 py-1 text-xs font-semibold text-warning transition hover:bg-warning/10 disabled:opacity-60"
                    >
                      {archiving ? 'Unarchiving…' : 'Unarchive'}
                    </button>
                  )}
                </div>
              )}
              {archiveError && <p className="mt-2 text-sm text-danger">{archiveError}</p>}

              <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
                {editing ? (
                  <form onSubmit={handleEditSubmit}>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-sm font-medium text-fg-secondary">First name</label>
                        <input
                          type="text"
                          required
                          value={editForm.firstName}
                          onChange={(e) => setEditForm({ ...editForm, firstName: e.target.value })}
                          className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-sm font-medium text-fg-secondary">Last name</label>
                        <input
                          type="text"
                          required
                          value={editForm.lastName}
                          onChange={(e) => setEditForm({ ...editForm, lastName: e.target.value })}
                          className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-sm font-medium text-fg-secondary">Email</label>
                        <input
                          type="email"
                          value={editForm.email}
                          onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                          className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-sm font-medium text-fg-secondary">Phone</label>
                        <PhoneInput
                          value={editForm.phone}
                          onChange={(digits) => setEditForm({ ...editForm, phone: digits })}
                          className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                        />
                      </div>
                    </div>

                    {editError && <p className="mt-3 text-sm text-danger">{editError}</p>}

                    <div className="mt-4 flex gap-3">
                      <button
                        type="submit"
                        disabled={editSubmitting}
                        className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-60"
                      >
                        {editSubmitting ? 'Saving…' : 'Save'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditing(false)}
                        className="rounded-full border border-border px-4 py-2 text-sm font-semibold text-fg transition hover:bg-surface"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                      <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-surface text-lg font-semibold text-fg">
                        {client.firstName[0]}
                        {client.lastName[0]}
                      </span>
                      <div>
                        <h1 className="text-xl font-bold text-fg">
                          {client.firstName} {client.lastName}
                        </h1>
                        <p className="mt-1 text-sm text-fg-secondary">{client.email ?? 'No email on file'}</p>
                        <p className="text-sm text-fg-secondary">
                          {client.phone ? formatPhoneInput(client.phone) : 'No phone on file'}
                        </p>
                      </div>
                    </div>

                    <div className="flex shrink-0 gap-2">
                      {canMessage && !client.mergedIntoId && (
                        <button
                          type="button"
                          onClick={handleMessage}
                          disabled={startingConversation}
                          aria-label="Message"
                          title="Message"
                          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border text-fg transition hover:bg-surface disabled:opacity-60 md:h-auto md:w-auto md:gap-2 md:px-4 md:py-2"
                        >
                          <MessageIcon className="h-4 w-4" />
                          <span className="hidden text-sm font-semibold md:inline">Message</span>
                        </button>
                      )}
                      {canGeneratePrefillLink && !client.mergedIntoId && (
                        <div className="relative">
                          <button
                            type="button"
                            onClick={() => setShowCopyMenu((v) => !v)}
                            aria-label="Copy options"
                            title="Copy options"
                            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border text-fg transition hover:bg-surface md:h-9 md:w-9"
                          >
                            <CopyIcon className="h-4 w-4" />
                          </button>
                          {showCopyMenu && (
                            <>
                              <div
                                className="fixed inset-0 z-10"
                                onClick={() => setShowCopyMenu(false)}
                                aria-hidden="true"
                              />
                              <div className="absolute right-0 top-12 z-20 w-56 origin-top-right animate-scale-fade-in rounded-xl border border-border bg-surface-raised p-1 shadow-xl md:top-10">
                                <button
                                  type="button"
                                  onClick={handleCopyCustomerDetails}
                                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-fg-secondary hover:bg-surface"
                                >
                                  Copy customer details
                                </button>
                                <button
                                  type="button"
                                  onClick={handleCopyPrefillLink}
                                  disabled={copyingPrefillLink}
                                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-fg-secondary hover:bg-surface disabled:opacity-60"
                                >
                                  {copyingPrefillLink ? 'Generating…' : 'Copy prefilled link'}
                                </button>
                              </div>
                            </>
                          )}
                          {copyToast && (
                            <div
                              role="status"
                              className="absolute right-0 top-12 z-30 whitespace-nowrap rounded-lg border border-border bg-surface-raised px-3 py-1.5 text-xs font-medium text-fg shadow-xl md:top-10"
                            >
                              {copyToast}
                            </div>
                          )}
                        </div>
                      )}
                      {canManage && !client.mergedIntoId && (
                        <button
                          type="button"
                          onClick={startEditing}
                          className="flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-semibold text-fg transition hover:bg-surface"
                        >
                          <PencilIcon className="h-4 w-4" />
                          Edit
                        </button>
                      )}
                      {(canManage || isOwner) && (
                        <div className="relative">
                          <button
                            type="button"
                            onClick={() => setShowMoreMenu((v) => !v)}
                            aria-label="More actions"
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border text-fg-muted transition hover:bg-surface hover:text-fg"
                          >
                            <MoreIcon className="h-4 w-4" />
                          </button>
                          {showMoreMenu && (
                            <>
                              <div className="fixed inset-0 z-10" onClick={() => setShowMoreMenu(false)} aria-hidden="true" />
                              <div className="absolute right-0 top-10 z-20 w-56 origin-top-right animate-scale-fade-in rounded-xl border border-border bg-surface-raised p-1 shadow-xl">
                                {canManage && (
                                  <button
                                    type="button"
                                    onClick={client.archivedAt ? handleUnarchive : handleArchive}
                                    disabled={archiving}
                                    className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-fg-secondary hover:bg-surface disabled:opacity-60"
                                  >
                                    {client.archivedAt ? 'Unarchive' : 'Archive'}
                                  </button>
                                )}
                                {isOwner && (
                                  <button
                                    type="button"
                                    onClick={openDeleteModal}
                                    className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-danger hover:bg-danger/10"
                                  >
                                    Delete Permanently
                                  </button>
                                )}
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
                {prefillLinkError && <p className="mt-2 text-sm text-danger">{prefillLinkError}</p>}
              </div>

              <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
                <h2 className="text-base font-semibold text-fg">Contact Info</h2>

                <div className="mt-4 grid grid-cols-1 gap-6 sm:grid-cols-2">
                  <div>
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-medium uppercase tracking-wider text-fg-muted">Phones</h3>
                      {canManage && !client.mergedIntoId && !showAddPhone && (
                        <button
                          type="button"
                          onClick={() => {
                            setShowAddPhone(true)
                            setAddPhoneError(null)
                            setNewPhone('')
                            setNewPhoneLabel('')
                          }}
                          className="text-xs font-medium text-accent hover:underline"
                        >
                          + Add phone
                        </button>
                      )}
                    </div>

                    {client.phones.length === 0 && (
                      <p className="mt-2 text-sm text-fg-secondary">No phone on file.</p>
                    )}

                    <ul className="mt-2 space-y-2">
                      {client.phones.map((p) => (
                        <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                          <span className="text-fg">
                            {formatPhoneInput(p.phone)}
                            {p.label && <span className="ml-1.5 text-xs text-fg-muted">({p.label})</span>}
                            {p.isPrimary && (
                              <span className="ml-2 rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-semibold text-accent">
                                Primary
                              </span>
                            )}
                          </span>
                          {canManage && !client.mergedIntoId && (
                            <span className="flex shrink-0 gap-3">
                              {!p.isPrimary && (
                                <button
                                  type="button"
                                  onClick={() => handleMakePrimaryPhone(p.id)}
                                  disabled={contactActionPendingId === p.id}
                                  className="text-xs font-medium text-fg-secondary transition hover:text-fg disabled:opacity-60"
                                >
                                  Make primary
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => handleRemovePhone(p.id)}
                                disabled={contactActionPendingId === p.id}
                                className="text-xs font-medium text-danger transition hover:underline disabled:opacity-60"
                              >
                                Remove
                              </button>
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>

                    {showAddPhone && (
                      <form onSubmit={handleAddPhone} className="mt-3 space-y-2 rounded-lg border border-border p-3">
                        <PhoneInput
                          value={newPhone}
                          onChange={setNewPhone}
                          className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                        />
                        <input
                          type="text"
                          placeholder="Label (optional, e.g. Mobile)"
                          value={newPhoneLabel}
                          onChange={(e) => setNewPhoneLabel(e.target.value)}
                          className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                        />
                        {addPhoneError && <p className="text-xs text-danger">{addPhoneError}</p>}
                        <div className="flex gap-2">
                          <button
                            type="submit"
                            disabled={addingPhone}
                            className="rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-60"
                          >
                            {addingPhone ? 'Adding…' : 'Add'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setShowAddPhone(false)}
                            className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-fg transition hover:bg-surface"
                          >
                            Cancel
                          </button>
                        </div>
                      </form>
                    )}
                  </div>

                  <div>
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-medium uppercase tracking-wider text-fg-muted">Emails</h3>
                      {canManage && !client.mergedIntoId && !showAddEmail && (
                        <button
                          type="button"
                          onClick={() => {
                            setShowAddEmail(true)
                            setAddEmailError(null)
                            setNewEmail('')
                            setNewEmailLabel('')
                          }}
                          className="text-xs font-medium text-accent hover:underline"
                        >
                          + Add email
                        </button>
                      )}
                    </div>

                    {client.emails.length === 0 && (
                      <p className="mt-2 text-sm text-fg-secondary">No email on file.</p>
                    )}

                    <ul className="mt-2 space-y-2">
                      {client.emails.map((e) => (
                        <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                          <span className="text-fg">
                            {e.email}
                            {e.label && <span className="ml-1.5 text-xs text-fg-muted">({e.label})</span>}
                            {e.isPrimary && (
                              <span className="ml-2 rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-semibold text-accent">
                                Primary
                              </span>
                            )}
                          </span>
                          {canManage && !client.mergedIntoId && (
                            <span className="flex shrink-0 gap-3">
                              {!e.isPrimary && (
                                <button
                                  type="button"
                                  onClick={() => handleMakePrimaryEmail(e.id)}
                                  disabled={contactActionPendingId === e.id}
                                  className="text-xs font-medium text-fg-secondary transition hover:text-fg disabled:opacity-60"
                                >
                                  Make primary
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => handleRemoveEmail(e.id)}
                                disabled={contactActionPendingId === e.id}
                                className="text-xs font-medium text-danger transition hover:underline disabled:opacity-60"
                              >
                                Remove
                              </button>
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>

                    {showAddEmail && (
                      <form onSubmit={handleAddEmail} className="mt-3 space-y-2 rounded-lg border border-border p-3">
                        <input
                          type="email"
                          placeholder="email@example.com"
                          value={newEmail}
                          onChange={(e) => setNewEmail(e.target.value)}
                          className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                        />
                        <input
                          type="text"
                          placeholder="Label (optional, e.g. Work)"
                          value={newEmailLabel}
                          onChange={(e) => setNewEmailLabel(e.target.value)}
                          className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                        />
                        {addEmailError && <p className="text-xs text-danger">{addEmailError}</p>}
                        <div className="flex gap-2">
                          <button
                            type="submit"
                            disabled={addingEmail}
                            className="rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-60"
                          >
                            {addingEmail ? 'Adding…' : 'Add'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setShowAddEmail(false)}
                            className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-fg transition hover:bg-surface"
                          >
                            Cancel
                          </button>
                        </div>
                      </form>
                    )}
                  </div>
                </div>

                {contactActionError && <p className="mt-3 text-sm text-danger">{contactActionError}</p>}
              </div>

              {canManage && !client.mergedIntoId && duplicates && duplicates.length > 0 && (
                <div className="mt-6 rounded-2xl border border-warning/30 bg-warning/10 p-4">
                  <p className="text-sm font-medium text-warning">
                    {duplicates.length} potential duplicate{duplicates.length > 1 ? 's' : ''} found
                  </p>
                  <ul className="mt-3 space-y-2">
                    {duplicates.map((candidate) => (
                      <li
                        key={candidate.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm"
                      >
                        <span className="text-warning">
                          {candidate.firstName} {candidate.lastName}
                          {candidate.email ? ` — ${candidate.email}` : ''}
                          {candidate.phone ? ` — ${formatPhoneInput(candidate.phone)}` : ''}
                        </span>
                        <button
                          type="button"
                          onClick={() => openMergeConfirm(candidate)}
                          className="rounded-full border border-warning/40 px-3 py-1 text-xs font-semibold text-warning transition hover:bg-warning/10"
                        >
                          Merge into this client
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
                <h2 className="text-base font-semibold text-fg">Inquiries</h2>

                {client.inquiries.length === 0 && <p className="mt-4 text-sm text-fg-secondary">No inquiries yet.</p>}

                {client.inquiries.length > 0 && (
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="bg-surface-inset text-xs text-fg-muted">
                          <th className="pb-3 font-medium">Description</th>
                          <th className="hidden pb-3 font-medium md:table-cell">Channel</th>
                          <th className="hidden pb-3 font-medium sm:table-cell">Submitted</th>
                          <th className="pb-3 font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {client.inquiries.map((inquiry) => (
                          <tr key={inquiry.id}>
                            <td className="py-3 text-fg">
                              <Link to={`/inquiries/${inquiry.id}`} className="hover:underline">
                                {inquiry.description.length > 60
                                  ? `${inquiry.description.slice(0, 60).trimEnd()}…`
                                  : inquiry.description}
                              </Link>
                            </td>
                            <td className="hidden py-3 text-fg-secondary md:table-cell">
                              {formatStatus(inquiry.channel)}
                            </td>
                            <td className="hidden py-3 text-fg-secondary sm:table-cell">
                              {formatDateTime(inquiry.createdAt)}
                            </td>
                            <td className="py-3">
                              <StatusPill status={inquiry.status} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
                <h2 className="text-base font-semibold text-fg">Appointments</h2>

                {appointments === null && <p className="mt-4 text-sm text-fg-secondary">Loading appointments…</p>}

                {appointments !== null && appointments.length === 0 && (
                  <p className="mt-4 text-sm text-fg-secondary">No appointments yet.</p>
                )}

                {appointments !== null && appointments.length > 0 && (
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="bg-surface-inset text-xs text-fg-muted">
                          <th className="hidden pb-3 font-medium sm:table-cell">Artist</th>
                          <th className="pb-3 font-medium">Date &amp; Time</th>
                          <th className="pb-3 font-medium">Status</th>
                          <th className="hidden pb-3 font-medium md:table-cell">Final Cost</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {appointments.map((appointment) => (
                          <tr
                            key={appointment.id}
                            onClick={() => navigate(`/appointments/${appointment.id}`)}
                            className="cursor-pointer hover:bg-surface/40"
                          >
                            <td className="hidden py-3 text-fg sm:table-cell">
                              {appointment.artist?.name ?? '—'}
                            </td>
                            <td className="py-3 text-fg-secondary">{formatDateTime(appointment.startTime)}</td>
                            <td className="py-3">
                              <StatusPill status={appointment.status} />
                            </td>
                            <td className="hidden py-3 text-fg-secondary md:table-cell">
                              {appointment.finalCostCents != null ? formatCents(appointment.finalCostCents) : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-semibold text-fg">Gift Cards</h2>
                  {canIssueGiftCards && (
                    <button
                      type="button"
                      onClick={() => setShowIssueGiftCard(true)}
                      className="flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-fg transition hover:bg-surface"
                    >
                      <PlusIcon className="h-3.5 w-3.5" />
                      Issue Gift Card
                    </button>
                  )}
                </div>

                {client.giftCards.length === 0 && <p className="mt-4 text-sm text-fg-secondary">No gift cards yet.</p>}

                {client.giftCards.length > 0 && (
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="bg-surface-inset text-xs text-fg-muted">
                          <th className="pb-3 font-medium">Code</th>
                          <th className="pb-3 font-medium">Amount</th>
                          <th className="pb-3 font-medium">Status</th>
                          <th className="hidden pb-3 font-medium sm:table-cell">Expires</th>
                          <th className="hidden pb-3 font-medium md:table-cell">Attached</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {client.giftCards.map((card) => (
                          <tr
                            key={card.id}
                            onClick={() => navigate(`/gift-cards/${card.id}`)}
                            className="cursor-pointer hover:bg-surface/40"
                          >
                            <td className="py-3 font-mono text-xs text-fg">{card.code}</td>
                            <td className="py-3 text-fg-secondary">{formatCents(card.amountCents)}</td>
                            <td className="py-3">
                              <StatusPill status={card.status} />
                            </td>
                            <td className="hidden py-3 text-fg-secondary sm:table-cell">
                              {card.expiresAt ? formatDateTime(card.expiresAt) : 'No expiration'}
                            </td>
                            <td className="hidden py-3 text-fg-secondary md:table-cell">
                              {card.appointmentId ? 'Yes' : 'Unattached'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
                <h2 className="text-base font-semibold text-fg">Deposit Forms</h2>

                {depositForms.length === 0 && <p className="mt-4 text-sm text-fg-secondary">No deposit forms yet.</p>}

                {depositForms.length > 0 && (
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="bg-surface-inset text-xs text-fg-muted">
                          <th className="pb-3 font-medium">Deposit</th>
                          <th className="hidden pb-3 font-medium sm:table-cell">Total</th>
                          <th className="hidden pb-3 font-medium md:table-cell">Signed</th>
                          <th className="pb-3 font-medium">Paid</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {depositForms.map((inquiry) => (
                          <tr key={inquiry.id}>
                            <td className="py-3 text-fg">${inquiry.depositForm!.depositAmount}</td>
                            <td className="hidden py-3 text-fg-secondary sm:table-cell">
                              ${inquiry.depositForm!.totalCharged}
                            </td>
                            <td className="hidden py-3 text-fg-secondary md:table-cell">
                              {inquiry.depositForm!.signedAt ? formatDateTime(inquiry.depositForm!.signedAt) : 'Pending'}
                            </td>
                            <td className="py-3 text-fg-secondary">
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

              <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-semibold text-fg">Consent Forms</h2>
                  {canManage && !client.mergedIntoId && (
                    <button
                      type="button"
                      onClick={handleSendConsentForm}
                      disabled={sendingForm}
                      className="flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-60"
                    >
                      <PlusIcon className="h-4 w-4" />
                      {sendingForm ? 'Sending…' : 'Send Consent Form'}
                    </button>
                  )}
                </div>

                {sendFormError && (
                  <div className="mt-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                    {sendFormError}
                  </div>
                )}

                {latestSigningUrl && (
                  <div className="mt-4 rounded-lg border border-border p-3">
                    <p className="mb-2 text-xs text-fg-muted">
                      Share this link with the client — it expires in 48 hours.
                    </p>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        readOnly
                        value={latestSigningUrl}
                        onFocus={(event) => event.target.select()}
                        className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={handleCopyLink}
                        className="shrink-0 rounded-full border border-border bg-surface px-4 py-2 text-sm font-medium text-fg transition hover:bg-surface-raised"
                      >
                        {copied ? 'Copied!' : 'Copy Link'}
                      </button>
                    </div>
                  </div>
                )}

                <div className="mt-4">
                  {client.consentForms.length === 0 && (
                    <p className="text-sm text-fg-secondary">No consent forms sent yet.</p>
                  )}

                  {client.consentForms.length > 0 && (
                    <ul className="divide-y divide-border">
                      {client.consentForms.map((form) => (
                        <li key={form.id} className="flex items-center justify-between py-3 text-sm">
                          <span className="text-fg-secondary">Sent {formatDateTime(form.createdAt)}</span>
                          <StatusPill
                            status={form.signedAt ? 'SIGNED' : 'PENDING'}
                            label={form.signedAt ? `Signed ${formatDateTime(form.signedAt)}` : 'Pending'}
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
                <h2 className="text-base font-semibold text-fg">Waivers</h2>

                {client.liabilityWaivers.length === 0 && (
                  <p className="mt-4 text-sm text-fg-secondary">No waivers yet.</p>
                )}

                {client.liabilityWaivers.length > 0 && (
                  <ul className="mt-4 divide-y divide-border">
                    {client.liabilityWaivers.map((waiver) => (
                      <li
                        key={waiver.id}
                        onClick={() => navigate(`/appointments/${waiver.appointmentId}`)}
                        className="flex cursor-pointer items-center justify-between py-3 text-sm hover:bg-surface/40"
                      >
                        <span className="text-fg-secondary">
                          {waiver.signedAt ? `Signed ${formatDateTime(waiver.signedAt)}` : `Created ${formatDateTime(waiver.createdAt)}`}
                        </span>
                        <StatusPill status={waiver.status} />
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
              <label className="mb-1 block text-sm font-medium text-fg-secondary">Amount ($)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                required
                value={giftCardForm.amountDollars}
                onChange={(e) => setGiftCardForm({ ...giftCardForm, amountDollars: e.target.value })}
                className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>

            {user?.role === 'OWNER' && (
              <div className="mt-3">
                <label className="mb-1 block text-sm font-medium text-fg-secondary">
                  Custom expiration (optional, overrides studio default)
                </label>
                <input
                  type="date"
                  value={giftCardForm.expiresAt}
                  onChange={(e) => setGiftCardForm({ ...giftCardForm, expiresAt: e.target.value })}
                  className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>
            )}

            {giftCardError && <p className="mt-3 text-sm text-danger">{giftCardError}</p>}

            <button
              type="submit"
              disabled={issuingGiftCard}
              className="mt-5 w-full rounded-full bg-accent px-4 py-2 text-sm font-medium text-bg transition hover:bg-accent-hover disabled:opacity-60"
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
          <p className="text-sm text-fg-secondary">
            Merge <span className="font-semibold">{mergeTarget.firstName} {mergeTarget.lastName}</span> into{' '}
            <span className="font-semibold">{client?.firstName} {client?.lastName}</span>?
          </p>

          <p className="mt-2 text-xs text-fg-muted">
            {mergeTarget.firstName} will be kept for history but marked merged, and won't appear in client lists
            anymore. This is not easily reversible.
          </p>

          {mergePreviewLoading && <p className="mt-4 text-sm text-fg-secondary">Checking what will move…</p>}

          {mergePreview && (
            <div className="mt-4 rounded-lg border border-border p-3 text-sm">
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-fg-muted">Will move to this client</p>
              <ul className="space-y-1 text-fg-secondary">
                <li>{mergePreview.inquiries} inquir{mergePreview.inquiries === 1 ? 'y' : 'ies'}</li>
                <li>{mergePreview.appointments} appointment{mergePreview.appointments === 1 ? '' : 's'}</li>
                <li>{mergePreview.consentForms} consent form{mergePreview.consentForms === 1 ? '' : 's'}</li>
                <li>{mergePreview.giftCards} gift card{mergePreview.giftCards === 1 ? '' : 's'}</li>
              </ul>
            </div>
          )}

          {mergeError && <p className="mt-3 text-sm text-danger">{mergeError}</p>}

          <button
            type="button"
            onClick={handleConfirmMerge}
            disabled={merging || mergePreviewLoading}
            className="mt-5 w-full rounded-full bg-accent px-4 py-2 text-sm font-medium text-bg transition hover:bg-accent-hover disabled:opacity-60"
          >
            {merging ? 'Merging…' : 'Confirm Merge'}
          </button>
        </Modal>
      )}

      {showDeleteModal && (
        <Modal
          title="Delete Client Permanently"
          onClose={() => {
            setShowDeleteModal(false)
            setDeletePreview(null)
            setDeletePreviewError(null)
            setDeleteError(null)
          }}
        >
          <p className="text-sm text-fg-secondary">
            Permanently delete <span className="font-semibold">{client?.firstName} {client?.lastName}</span>? This
            cannot be undone.
          </p>

          {deletePreviewLoading && <p className="mt-4 text-sm text-fg-secondary">Checking what will be destroyed…</p>}
          {deletePreviewError && <p className="mt-3 text-sm text-danger">{deletePreviewError}</p>}

          {deletePreview && deletePreview.blockedByMerge && (
            <div className="mt-4 rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
              One or more other client records were merged into this one. Those would be left dangling, so this
              client cannot be permanently deleted.
            </div>
          )}

          {deletePreview && !deletePreview.blockedByMerge && (
            <div className="mt-4 rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm">
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-danger">
                This will permanently destroy
              </p>
              <ul className="space-y-1 text-fg-secondary">
                <li>{deletePreview.inquiries} inquir{deletePreview.inquiries === 1 ? 'y' : 'ies'}</li>
                <li>{deletePreview.appointments} appointment{deletePreview.appointments === 1 ? '' : 's'}</li>
                <li>{deletePreview.waivers} signed waiver{deletePreview.waivers === 1 ? '' : 's'}</li>
                <li>{deletePreview.consentForms} consent form{deletePreview.consentForms === 1 ? '' : 's'}</li>
                <li>{deletePreview.depositForms} deposit form{deletePreview.depositForms === 1 ? '' : 's'}</li>
                <li>{deletePreview.messages} message{deletePreview.messages === 1 ? '' : 's'}</li>
                {deletePreview.giftCards.length > 0 && (
                  <li className="font-semibold text-danger">
                    {deletePreview.giftCards.length} gift card{deletePreview.giftCards.length === 1 ? '' : 's'}
                    {deletePreview.activeGiftCardCents > 0 && (
                      <> — {formatCents(deletePreview.activeGiftCardCents)} in active gift card value</>
                    )}
                  </li>
                )}
              </ul>
            </div>
          )}

          {deletePreview && !deletePreview.blockedByMerge && (
            <div className="mt-4">
              <label className="mb-1 block text-sm font-medium text-fg-secondary">
                Type <span className="font-mono font-semibold text-fg">DELETE</span> to confirm
              </label>
              <input
                type="text"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-danger focus:outline-none focus:ring-1 focus:ring-danger"
              />
            </div>
          )}

          {deleteError && <p className="mt-3 text-sm text-danger">{deleteError}</p>}

          {deletePreview && !deletePreview.blockedByMerge && (
            <button
              type="button"
              onClick={handleConfirmDelete}
              disabled={deleting || deleteConfirmText !== DELETE_CONFIRM_TEXT}
              className="mt-5 w-full rounded-full bg-danger px-4 py-2 text-sm font-medium text-bg transition hover:bg-danger/90 disabled:opacity-50"
            >
              {deleting ? 'Deleting…' : 'Delete Permanently'}
            </button>
          )}
        </Modal>
      )}
    </div>
  )
}
