import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Sidebar from '../components/Sidebar'
import AuditTrail from '../components/AuditTrail'
import Modal from '../components/Modal'
import StatusPill from '../components/StatusPill'
import InquiryPipeline from '../components/InquiryPipeline'
import { apiFetch, ApiError } from '../lib/api'
import { formatDateTime, formatDuration, formatStatus } from '../lib/format'
import { ArrowLeftIcon, MessageIcon, MoreIcon, PencilIcon, PlusIcon } from '../components/icons'
import { useEffectiveUser } from '../context/useEffectiveUser'
import { useViewAs } from '../context/useViewAs'
import { useConversationPanel } from '../context/useConversationPanel'
import { artistsQueryKey, inquiriesQueryKey, inquiryQueryKey } from '../lib/queryKeys'

interface Inquiry {
  id: string
  channel: string
  description: string
  colorOrBlackGrey: string
  placement: string
  estimatedSize: string
  hasBeenTattooedBefore: boolean
  budget: string | null
  desiredTiming: string | null
  referenceImages: string[]
  placementImages: string[]
  status: string
  priceEstimateLow: number | null
  priceEstimateHigh: number | null
  timeEstimateHoursMin: number | null
  timeEstimateHoursMax: number | null
  declineNote: string | null
  createdAt: string
  assignedAt: string | null
  estimateToken: string | null
  estimateSentAt: string | null
  estimateOpenedAt: string | null
  estimateRespondedAt: string | null
  clientStatedBudget: string | null
  closedReason: string | null
  lostReason: string | null
  lostAt: string | null
  clientId: string
  client: { firstName: string; lastName: string; email: string | null; phone: string | null }
  preferredArtist: { id: string; user: { name: string | null } } | null
  assignedArtist: { id: string; user: { name: string | null } } | null
  appointment: { id: string; startTime: string; endTime: string; status: string } | null
  sessions: {
    id: string
    startTime: string
    endTime: string
    status: string
    artist: { id: string; user: { name: string | null; email: string } }
  }[]
  depositForm: {
    id: string
    token: string
    depositAmount: number
    feeAmount: number
    totalCharged: number
    signedAt: string | null
    signatureName: string | null
    paidManually: boolean
    paidAt: string | null
  } | null
}

interface ArtistOption {
  id: string
  user: { id: string; email: string; name?: string | null }
}

interface SharePreview {
  body: string
  attachments: string[]
}

interface GiftCardOption {
  id: string
  code: string
  amountCents: number
  status: string
  expiresAt: string | null
  appointmentId: string | null
}

function isCardAvailable(card: GiftCardOption): boolean {
  if (card.status !== 'ACTIVE' || card.appointmentId) return false
  return !card.expiresAt || new Date(card.expiresAt) > new Date()
}

// Phase 7A: mirrors apps/api/src/routes/inquiries.ts's NON_TERMINAL_STATUSES
// (every InquiryStatus except CLOSED_LOST/COLD_LEAD) -- the reopen picker's
// valid targets. Kept as a literal list for the same reason the backend's
// own copy is: separate compilation units, no shared import.
const REOPEN_TARGET_STATUSES = [
  'NEW',
  'ARTIST_ASSIGNED',
  'AWAITING_CLIENT_RESPONSE',
  'BUDGET_NEGOTIATION',
  'DEPOSIT_PENDING',
  'SCHEDULING',
  'WAITLISTED',
  'CONFIRMED',
] as const

interface AuditLogEntry {
  id: string
  action: string
  changes: Record<string, { from: unknown; to: unknown }> | null
  createdAt: string
  actorUser: { id: string; name: string | null; email: string } | null
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">{label}</p>
      <p className="mt-1 text-sm text-fg">{value}</p>
    </div>
  )
}

function ImageGrid({ images }: { images: string[] }) {
  if (images.length === 0) {
    return <p className="text-sm text-fg-secondary">None uploaded.</p>
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {images.map((url) => (
        <a
          key={url}
          href={url}
          target="_blank"
          rel="noreferrer"
          className="block aspect-square overflow-hidden rounded-lg border border-border"
        >
          <img src={url} alt="" className="h-full w-full object-cover transition hover:opacity-80" />
        </a>
      ))}
    </div>
  )
}

export default function InquiryDetail() {
  const { id } = useParams<{ id: string }>()
  const user = useEffectiveUser()
  const { target: viewAsTarget } = useViewAs()
  const queryClient = useQueryClient()
  const { openPanel } = useConversationPanel()
  const canMessage = user?.role === 'OWNER' || user?.role === 'FRONT_DESK'
  const [startingConversation, setStartingConversation] = useState(false)

  async function handleMessage() {
    if (!inquiry) return
    setStartingConversation(true)
    try {
      const conversation = await apiFetch<{ id: string }>('/conversations', {
        method: 'POST',
        body: JSON.stringify({ clientId: inquiry.clientId }),
      })
      openPanel(conversation.id)
    } catch {
      // Non-critical -- the floating button still works if this fails.
    } finally {
      setStartingConversation(false)
    }
  }

  const [showShareModal, setShowShareModal] = useState(false)
  const [shareArtistUserId, setShareArtistUserId] = useState('')
  const [sharing, setSharing] = useState(false)
  const [shareError, setShareError] = useState<string | null>(null)
  const [shareSent, setShareSent] = useState(false)

  const { data: sharePreview } = useQuery({
    queryKey: ['inquiry-share-preview', id],
    queryFn: () => apiFetch<SharePreview>(`/inquiries/${id}/share-to-artist/preview`),
    enabled: !!id && showShareModal,
  })

  async function handleShareToArtist() {
    if (!id || !shareArtistUserId) return

    setSharing(true)
    setShareError(null)

    try {
      await apiFetch(`/inquiries/${id}/share-to-artist`, {
        method: 'POST',
        body: JSON.stringify({ artistUserId: shareArtistUserId }),
      })
      setShareSent(true)
    } catch (err) {
      setShareError(err instanceof Error ? err.message : 'Failed to share with artist')
    } finally {
      setSharing(false)
    }
  }

  const {
    data: inquiry,
    error: queryError,
  } = useQuery({
    queryKey: inquiryQueryKey(id!),
    queryFn: () => apiFetch<Inquiry>(`/inquiries/${id}`),
    enabled: !!id,
  })

  // Phase 7A: lostReason/lostAt on the inquiry itself cover CLOSED_LOST's
  // "reason" and "when" -- but "by whom" (and COLD_LEAD's own "when", which
  // has no dedicated column since that path is fully automated) only lives
  // in the audit trail, so the terminal-state banner below pulls the most
  // recent matching status_change entry from the same endpoint AuditTrail
  // already uses.
  const isTerminal = inquiry?.status === 'CLOSED_LOST' || inquiry?.status === 'COLD_LEAD'
  const { data: inquiryAuditLogs } = useQuery({
    queryKey: ['inquiry-audit', id],
    queryFn: () => apiFetch<AuditLogEntry[]>(`/audit?entityType=Inquiry&entityId=${id}`),
    enabled: !!id && isTerminal,
  })
  const terminalAuditEntry = inquiryAuditLogs?.find(
    (log) => log.action === 'status_change' && log.changes?.status?.to === inquiry?.status,
  )

  const error = queryError
    ? queryError instanceof ApiError && queryError.status === 404
      ? 'Inquiry not found.'
      : queryError instanceof ApiError && queryError.status === 403
        ? "You don't have permission to view this inquiry."
        : queryError.message
    : null

  // Any mutation below that changes this inquiry's status/fields needs to
  // invalidate both this detail query and the Inquiries list it feeds.
  function invalidateInquiry() {
    queryClient.invalidateQueries({ queryKey: inquiryQueryKey(id!) })
    queryClient.invalidateQueries({ queryKey: inquiriesQueryKey(user!.studioId) })
  }

  const { data: artistOptions } = useQuery({
    queryKey: artistsQueryKey(user!.studioId),
    queryFn: () => apiFetch<ArtistOption[]>('/artists'),
  })

  // Reverse link for 6B tagging: if this inquiry has been tagged onto the
  // client's conversation, surface that here so staff can jump straight to
  // the thread. Resolve-only GET, never a get-or-create POST -- this query
  // fires on every page view, not an explicit user action, so it must
  // never silently create a Conversation row for a client nobody's
  // messaged yet. No conversation yet (404) just means nothing to link.
  const { data: taggedConversation } = useQuery({
    queryKey: ['inquiry-conversation-tags', inquiry?.clientId, inquiry?.id],
    queryFn: async () => {
      let conversation: { id: string }
      try {
        conversation = await apiFetch<{ id: string }>(`/conversations/resolve?clientId=${inquiry!.clientId}`)
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null
        throw err
      }
      const thread = await apiFetch<{ conversation: { tags: { entityType: string; entityId: string }[] } }>(
        `/conversations/${conversation.id}/messages`,
      )
      const tagged = thread.conversation.tags.some((t) => t.entityType === 'Inquiry' && t.entityId === inquiry!.id)
      return tagged ? conversation.id : null
    },
    enabled: canMessage && !!inquiry?.clientId,
  })

  // Scheduling now requires attaching a gift card (Phase 3) -- this is the
  // client's own available cards, typically the one just issued from their
  // deposit.
  const { data: clientGiftCards } = useQuery({
    queryKey: ['client-gift-cards', inquiry?.clientId],
    queryFn: () => apiFetch<{ giftCards: GiftCardOption[] }>(`/clients/${inquiry!.clientId}`),
    enabled: !!inquiry?.clientId,
    select: (data) => data.giftCards.filter(isCardAvailable),
  })

  const [selectedArtistId, setSelectedArtistId] = useState('')
  const [assigning, setAssigning] = useState(false)
  const [assignError, setAssignError] = useState<string | null>(null)

  const [estimateForm, setEstimateForm] = useState({
    priceEstimateLow: '',
    priceEstimateHigh: '',
    timeEstimateHoursMin: '',
    timeEstimateHoursMax: '',
  })
  const [sendingEstimate, setSendingEstimate] = useState(false)
  const [sendEstimateError, setSendEstimateError] = useState<string | null>(null)

  const [editingDetails, setEditingDetails] = useState(false)
  const [detailsForm, setDetailsForm] = useState({
    description: '',
    colorOrBlackGrey: '',
    placement: '',
    estimatedSize: '',
    budget: '',
    desiredTiming: '',
  })
  const [savingDetails, setSavingDetails] = useState(false)
  const [detailsError, setDetailsError] = useState<string | null>(null)

  const [scheduleForm, setScheduleForm] = useState({ startTime: '', endTime: '', giftCardId: '' })
  const [scheduling, setScheduling] = useState(false)
  const [scheduleError, setScheduleError] = useState<string | null>(null)
  const [bufferWarning, setBufferWarning] = useState<string | null>(null)

  const [showWaitlistForm, setShowWaitlistForm] = useState(false)
  const [waitlistNote, setWaitlistNote] = useState('')
  const [waitlisting, setWaitlisting] = useState(false)
  const [waitlistError, setWaitlistError] = useState<string | null>(null)

  // Phase 7A: mark-as-lost / reopen. canMessage (OWNER/FRONT_DESK) is the
  // same permission level as these two actions, so it's reused directly
  // rather than defining a second identical role check.
  const [showMoreMenu, setShowMoreMenu] = useState(false)
  const [showMarkLostModal, setShowMarkLostModal] = useState(false)
  const [lostReasonInput, setLostReasonInput] = useState('')
  const [markingLost, setMarkingLost] = useState(false)
  const [markLostError, setMarkLostError] = useState<string | null>(null)

  const [showReopenModal, setShowReopenModal] = useState(false)
  const [reopenStatus, setReopenStatus] = useState('')
  const [reopening, setReopening] = useState(false)
  const [reopenError, setReopenError] = useState<string | null>(null)

  const [sendingDeposit, setSendingDeposit] = useState(false)
  const [sendDepositError, setSendDepositError] = useState<string | null>(null)
  const [markingPaid, setMarkingPaid] = useState(false)
  const [markPaidError, setMarkPaidError] = useState<string | null>(null)

  // UI-1 §3: appointments/sessions nested inside their project. Distinct
  // from scheduleForm above (which drives the special first-scheduling-slot
  // flow via /inquiries/:id/schedule) -- this is the generic
  // POST /appointments route, pre-scoped to this project's client +
  // inquiry, for booking an additional session under a project already
  // underway.
  const [showAppointmentModal, setShowAppointmentModal] = useState(false)
  const [appointmentForm, setAppointmentForm] = useState({
    artistId: '',
    giftCardId: '',
    startTime: '',
    endTime: '',
    notes: '',
  })
  const [creatingAppointment, setCreatingAppointment] = useState(false)
  const [appointmentError, setAppointmentError] = useState<string | null>(null)

  // Seeds the editable estimate fields from the inquiry once per inquiry id
  // (not on every refetch), so an in-progress edit doesn't get clobbered by
  // an unrelated refresh. Adjusted during render rather than an effect, per
  // React's guidance for resetting state when a prop changes.
  const [seededEstimateForId, setSeededEstimateForId] = useState<string | null>(null)
  if (inquiry && inquiry.id !== seededEstimateForId) {
    setSeededEstimateForId(inquiry.id)
    setEstimateForm({
      priceEstimateLow: inquiry.priceEstimateLow?.toString() ?? '',
      priceEstimateHigh: inquiry.priceEstimateHigh?.toString() ?? '',
      timeEstimateHoursMin: inquiry.timeEstimateHoursMin?.toString() ?? '',
      timeEstimateHoursMax: inquiry.timeEstimateHoursMax?.toString() ?? '',
    })
    setDetailsForm({
      description: inquiry.description,
      colorOrBlackGrey: inquiry.colorOrBlackGrey,
      placement: inquiry.placement,
      estimatedSize: inquiry.estimatedSize,
      budget: inquiry.budget ?? '',
      desiredTiming: inquiry.desiredTiming ?? '',
    })
  }

  // Mirrors the backend's own validation, so staff get instant feedback
  // instead of a round trip for something obviously incomplete.
  const effectiveEstimate = {
    priceEstimateLow: estimateForm.priceEstimateLow ? Number(estimateForm.priceEstimateLow) : inquiry?.priceEstimateLow,
    priceEstimateHigh: estimateForm.priceEstimateHigh
      ? Number(estimateForm.priceEstimateHigh)
      : inquiry?.priceEstimateHigh,
    timeEstimateHoursMin: estimateForm.timeEstimateHoursMin
      ? Number(estimateForm.timeEstimateHoursMin)
      : inquiry?.timeEstimateHoursMin,
    timeEstimateHoursMax: estimateForm.timeEstimateHoursMax
      ? Number(estimateForm.timeEstimateHoursMax)
      : inquiry?.timeEstimateHoursMax,
  }

  const estimateValidationError = (() => {
    const values = Object.values(effectiveEstimate)
    if (values.some((v) => v == null)) return 'Price and time ranges are required before sending an estimate.'
    if (values.some((v) => v! <= 0)) return 'All range values must be positive.'
    if (effectiveEstimate.priceEstimateLow! > effectiveEstimate.priceEstimateHigh!) {
      return 'Price low must be less than or equal to price high.'
    }
    if (effectiveEstimate.timeEstimateHoursMin! > effectiveEstimate.timeEstimateHoursMax!) {
      return 'Minimum hours must be less than or equal to maximum hours.'
    }
    return null
  })()

  async function handleAssign() {
    if (!id || !selectedArtistId) return

    setAssigning(true)
    setAssignError(null)

    try {
      await apiFetch(`/inquiries/${id}/assign`, {
        method: 'PATCH',
        body: JSON.stringify({ artistId: selectedArtistId }),
      })

      invalidateInquiry()
    } catch (err) {
      setAssignError(err instanceof Error ? err.message : 'Failed to assign artist')
    } finally {
      setAssigning(false)
    }
  }

  async function handleSendEstimate() {
    if (!id) return

    if (estimateValidationError) {
      setSendEstimateError(estimateValidationError)
      return
    }

    setSendingEstimate(true)
    setSendEstimateError(null)

    try {
      await apiFetch(`/inquiries/${id}/send-estimate`, {
        method: 'POST',
        body: JSON.stringify({
          priceEstimateLow: estimateForm.priceEstimateLow ? Number(estimateForm.priceEstimateLow) : undefined,
          priceEstimateHigh: estimateForm.priceEstimateHigh ? Number(estimateForm.priceEstimateHigh) : undefined,
          timeEstimateHoursMin: estimateForm.timeEstimateHoursMin
            ? Number(estimateForm.timeEstimateHoursMin)
            : undefined,
          timeEstimateHoursMax: estimateForm.timeEstimateHoursMax
            ? Number(estimateForm.timeEstimateHoursMax)
            : undefined,
        }),
      })

      invalidateInquiry()
    } catch (err) {
      setSendEstimateError(err instanceof Error ? err.message : 'Failed to send estimate')
    } finally {
      setSendingEstimate(false)
    }
  }

  async function handleSaveDetails() {
    if (!id) return

    setSavingDetails(true)
    setDetailsError(null)

    try {
      await apiFetch(`/inquiries/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          description: detailsForm.description,
          colorOrBlackGrey: detailsForm.colorOrBlackGrey,
          placement: detailsForm.placement,
          estimatedSize: detailsForm.estimatedSize,
          budget: detailsForm.budget || null,
          desiredTiming: detailsForm.desiredTiming || null,
        }),
      })

      setEditingDetails(false)
      invalidateInquiry()
    } catch (err) {
      setDetailsError(err instanceof Error ? err.message : 'Failed to save changes')
    } finally {
      setSavingDetails(false)
    }
  }

  async function handleSchedule() {
    if (!id || !scheduleForm.startTime || !scheduleForm.endTime || !scheduleForm.giftCardId) return

    setScheduling(true)
    setScheduleError(null)
    setBufferWarning(null)

    try {
      const result = await apiFetch<{ bufferWarning: string | null }>(`/inquiries/${id}/schedule`, {
        method: 'POST',
        body: JSON.stringify({
          startTime: new Date(scheduleForm.startTime).toISOString(),
          endTime: new Date(scheduleForm.endTime).toISOString(),
          giftCardId: scheduleForm.giftCardId,
        }),
      })

      setBufferWarning(result.bufferWarning)
      invalidateInquiry()
    } catch (err) {
      setScheduleError(err instanceof Error ? err.message : 'Failed to schedule appointment')
    } finally {
      setScheduling(false)
    }
  }

  async function handleCreateAppointment() {
    if (!inquiry || !appointmentForm.artistId || !appointmentForm.giftCardId) return
    if (!appointmentForm.startTime || !appointmentForm.endTime) return

    setCreatingAppointment(true)
    setAppointmentError(null)

    try {
      await apiFetch('/appointments', {
        method: 'POST',
        body: JSON.stringify({
          clientId: inquiry.clientId,
          inquiryId: inquiry.id,
          artistId: appointmentForm.artistId,
          giftCardId: appointmentForm.giftCardId,
          startTime: new Date(appointmentForm.startTime).toISOString(),
          endTime: new Date(appointmentForm.endTime).toISOString(),
          notes: appointmentForm.notes || undefined,
        }),
      })

      setShowAppointmentModal(false)
      setAppointmentForm({ artistId: '', giftCardId: '', startTime: '', endTime: '', notes: '' })
      invalidateInquiry()
    } catch (err) {
      setAppointmentError(err instanceof Error ? err.message : 'Failed to create appointment')
    } finally {
      setCreatingAppointment(false)
    }
  }

  async function handleWaitlist() {
    if (!id) return

    setWaitlisting(true)
    setWaitlistError(null)

    try {
      await apiFetch(`/inquiries/${id}/waitlist`, {
        method: 'POST',
        body: JSON.stringify({ note: waitlistNote || undefined }),
      })

      setShowWaitlistForm(false)
      invalidateInquiry()
    } catch (err) {
      setWaitlistError(err instanceof Error ? err.message : 'Failed to waitlist inquiry')
    } finally {
      setWaitlisting(false)
    }
  }

  async function handleMarkLost() {
    if (!id) return

    setMarkingLost(true)
    setMarkLostError(null)

    try {
      await apiFetch(`/inquiries/${id}/mark-lost`, {
        method: 'POST',
        body: JSON.stringify({ reason: lostReasonInput.trim() || undefined }),
      })

      setShowMarkLostModal(false)
      setLostReasonInput('')
      invalidateInquiry()
    } catch (err) {
      setMarkLostError(err instanceof Error ? err.message : 'Failed to mark inquiry lost')
    } finally {
      setMarkingLost(false)
    }
  }

  async function handleReopen() {
    if (!id || !reopenStatus) return

    setReopening(true)
    setReopenError(null)

    try {
      await apiFetch(`/inquiries/${id}/reopen`, {
        method: 'POST',
        body: JSON.stringify({ status: reopenStatus }),
      })

      setShowReopenModal(false)
      invalidateInquiry()
    } catch (err) {
      setReopenError(err instanceof Error ? err.message : 'Failed to reopen inquiry')
    } finally {
      setReopening(false)
    }
  }

  async function handleSendDepositForm() {
    if (!id) return

    setSendingDeposit(true)
    setSendDepositError(null)

    try {
      await apiFetch(`/inquiries/${id}/deposit-form`, { method: 'POST' })
      invalidateInquiry()
    } catch (err) {
      setSendDepositError(err instanceof Error ? err.message : 'Failed to send deposit form')
    } finally {
      setSendingDeposit(false)
    }
  }

  async function handleMarkPaid() {
    if (!inquiry?.depositForm) return

    setMarkingPaid(true)
    setMarkPaidError(null)

    try {
      await apiFetch(`/deposit-forms/${inquiry.depositForm.id}/mark-paid`, { method: 'PATCH' })
      invalidateInquiry()
    } catch (err) {
      setMarkPaidError(err instanceof Error ? err.message : 'Failed to mark deposit as paid')
    } finally {
      setMarkingPaid(false)
    }
  }

  const estimateUrl = inquiry?.estimateToken ? `${window.location.origin}/estimate/${inquiry.estimateToken}` : null
  const depositUrl =
    inquiry?.depositForm && !inquiry.depositForm.signedAt
      ? `${window.location.origin}/deposit/${inquiry.depositForm.token}`
      : null

  return (
    <div className="flex min-h-screen bg-bg text-fg">
      <Sidebar />

      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-6 py-6 sm:px-10 sm:py-8">
          <Link
            to={
              inquiry && ['SCHEDULING', 'WAITLISTED', 'CONFIRMED'].includes(inquiry.status)
                ? '/inquiries?tab=projects'
                : '/inquiries'
            }
            className="inline-flex items-center gap-2 text-sm text-fg-secondary hover:text-fg"
          >
            <ArrowLeftIcon className="h-4 w-4" />
            Back to {inquiry && ['SCHEDULING', 'WAITLISTED', 'CONFIRMED'].includes(inquiry.status) ? 'Projects' : 'Inquiries'}
          </Link>

          {error && (
            <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
              <p className="text-sm text-danger">{error}</p>
            </div>
          )}

          {!error && !inquiry && <p className="mt-6 text-sm text-fg-secondary">Loading inquiry…</p>}

          {!error && inquiry && (
            <>
              <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h1 className="text-xl font-bold text-fg">
                      {inquiry.client.firstName} {inquiry.client.lastName}
                    </h1>
                    <p className="mt-1 text-sm text-fg-secondary">
                      Submitted {formatDateTime(inquiry.createdAt)} via {formatStatus(inquiry.channel)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {canMessage && (
                      <button
                        type="button"
                        onClick={handleMessage}
                        disabled={startingConversation}
                        className="flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-fg transition hover:bg-surface disabled:opacity-60"
                      >
                        <MessageIcon className="h-3.5 w-3.5" />
                        Message
                      </button>
                    )}
                    {canMessage && (
                      <button
                        type="button"
                        onClick={() => {
                          setShareArtistUserId('')
                          setShareError(null)
                          setShareSent(false)
                          setShowShareModal(true)
                        }}
                        className="flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-fg transition hover:bg-surface"
                      >
                        Share with artist
                      </button>
                    )}
                    <StatusPill status={inquiry.status} />
                    {canMessage && !isTerminal && (
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => setShowMoreMenu((v) => !v)}
                          aria-label="More actions"
                          aria-pressed={showMoreMenu}
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-fg-muted transition hover:bg-surface hover:text-fg"
                        >
                          <MoreIcon className="h-4 w-4" />
                        </button>
                        {showMoreMenu && (
                          <>
                            <div
                              className="fixed inset-0 z-10"
                              onClick={() => setShowMoreMenu(false)}
                              aria-hidden="true"
                            />
                            <div className="absolute right-0 top-9 z-20 w-48 rounded-xl border border-border bg-surface-raised p-1 shadow-xl">
                              <button
                                type="button"
                                onClick={() => {
                                  setShowMoreMenu(false)
                                  setLostReasonInput('')
                                  setMarkLostError(null)
                                  setShowMarkLostModal(true)
                                }}
                                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-danger hover:bg-danger/10"
                              >
                                Mark as lost
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {isTerminal && (
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface-inset px-4 py-3">
                    <div>
                      <p className="text-sm font-medium text-fg-secondary">
                        {inquiry.status === 'CLOSED_LOST' ? 'Marked lost' : 'Cold lead'}
                        {(inquiry.lostAt || terminalAuditEntry) &&
                          ` — ${formatDateTime(inquiry.lostAt ?? terminalAuditEntry!.createdAt)}`}
                        {terminalAuditEntry &&
                          ` by ${terminalAuditEntry.actorUser?.name || terminalAuditEntry.actorUser?.email || 'System'}`}
                      </p>
                      {inquiry.status === 'CLOSED_LOST' && inquiry.lostReason && (
                        <p className="mt-1 text-sm text-fg-muted">{inquiry.lostReason}</p>
                      )}
                      {inquiry.status === 'COLD_LEAD' && (
                        <p className="mt-1 text-sm text-fg-muted">No activity for a while -- automatically marked cold.</p>
                      )}
                    </div>
                    {canMessage && (
                      <button
                        type="button"
                        onClick={() => {
                          setReopenStatus('')
                          setReopenError(null)
                          setShowReopenModal(true)
                        }}
                        className="shrink-0 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-fg transition hover:bg-surface"
                      >
                        Reopen
                      </button>
                    )}
                  </div>
                )}

                <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <DetailField label="Email" value={inquiry.client.email ?? 'Not provided'} />
                  <DetailField label="Phone" value={inquiry.client.phone ?? 'Not provided'} />
                </div>

                {taggedConversation && (
                  <button
                    type="button"
                    onClick={() => openPanel(taggedConversation)}
                    className="mt-4 flex items-center gap-1 text-xs font-medium text-fg-secondary hover:text-fg"
                  >
                    <MessageIcon className="h-3.5 w-3.5" />
                    Tagged on this client's conversation — open thread
                  </button>
                )}
              </div>

              <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
                <InquiryPipeline status={inquiry.status} closedReason={inquiry.closedReason} orientation="horizontal" />
              </div>

              <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
                <h2 className="text-base font-semibold text-fg">Assignment</h2>

                {inquiry.status === 'NEW' ? (
                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <select
                      value={selectedArtistId}
                      onChange={(event) => setSelectedArtistId(event.target.value)}
                      className="rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    >
                      <option value="" disabled>
                        {artistOptions === undefined ? 'Loading artists…' : 'Select an artist'}
                      </option>
                      {artistOptions?.map((artist) => (
                        <option key={artist.id} value={artist.id}>
                          {artist.user.email}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={handleAssign}
                      disabled={!selectedArtistId || assigning}
                      className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-60"
                    >
                      {assigning ? 'Assigning…' : 'Assign Artist'}
                    </button>
                  </div>
                ) : (
                  <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <DetailField label="Assigned artist" value={inquiry.assignedArtist?.user.name ?? 'Not yet assigned'} />
                    <DetailField
                      label="Assigned at"
                      value={inquiry.assignedAt ? formatDateTime(inquiry.assignedAt) : 'Not yet assigned'}
                    />
                  </div>
                )}

                {assignError && <p className="mt-3 text-sm text-danger">{assignError}</p>}

                {(inquiry.priceEstimateLow != null ||
                  inquiry.priceEstimateHigh != null ||
                  inquiry.timeEstimateHoursMin != null ||
                  inquiry.timeEstimateHoursMax != null) && (
                  <div className="mt-5 grid grid-cols-1 gap-4 border-t border-border pt-4 sm:grid-cols-3">
                    <DetailField
                      label="Price estimate low"
                      value={inquiry.priceEstimateLow != null ? `$${inquiry.priceEstimateLow}` : 'Not provided'}
                    />
                    <DetailField
                      label="Price estimate high"
                      value={inquiry.priceEstimateHigh != null ? `$${inquiry.priceEstimateHigh}` : 'Not provided'}
                    />
                    <DetailField
                      label="Time estimate"
                      value={
                        inquiry.timeEstimateHoursMin != null && inquiry.timeEstimateHoursMax != null
                          ? `${inquiry.timeEstimateHoursMin}–${inquiry.timeEstimateHoursMax} hours`
                          : 'Not provided'
                      }
                    />
                  </div>
                )}

                {inquiry.declineNote && (
                  <div className="mt-5 rounded-lg border border-warning/30 bg-warning/10 p-3">
                    <p className="text-xs font-medium uppercase tracking-wider text-warning">
                      {inquiry.status === 'WAITLISTED' ? 'Note' : 'Last decline note'}
                    </p>
                    <p className="mt-1 text-sm text-warning">{inquiry.declineNote}</p>
                  </div>
                )}
              </div>

              {(inquiry.status === 'AWAITING_CLIENT_RESPONSE' ||
                inquiry.status === 'BUDGET_NEGOTIATION' ||
                inquiry.estimateSentAt ||
                inquiry.closedReason) && (
                <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
                  <h2 className="text-base font-semibold text-fg">Client Response</h2>

                  {inquiry.clientStatedBudget && (
                    <div className="mt-4 rounded-lg border border-warning/30 bg-warning/10 p-3">
                      <p className="text-xs font-medium uppercase tracking-wider text-warning">
                        Client's stated budget
                      </p>
                      <p className="mt-1 text-sm text-warning">{inquiry.clientStatedBudget}</p>
                    </div>
                  )}

                  {inquiry.closedReason && (
                    <div className="mt-4 rounded-lg border border-danger/30 bg-danger/10 p-3">
                      <p className="text-xs font-medium uppercase tracking-wider text-danger">Closed</p>
                      <p className="mt-1 text-sm text-danger">{inquiry.closedReason}</p>
                    </div>
                  )}

                  {(inquiry.status === 'AWAITING_CLIENT_RESPONSE' || inquiry.status === 'BUDGET_NEGOTIATION') && (
                    <>
                      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <label className="mb-1 block text-xs font-medium text-fg-secondary">Price low ($)</label>
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={estimateForm.priceEstimateLow}
                            onChange={(e) => setEstimateForm({ ...estimateForm, priceEstimateLow: e.target.value })}
                            className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-medium text-fg-secondary">Price high ($)</label>
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={estimateForm.priceEstimateHigh}
                            onChange={(e) => setEstimateForm({ ...estimateForm, priceEstimateHigh: e.target.value })}
                            className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-medium text-fg-secondary">Time min (hours)</label>
                          <input
                            type="number"
                            min="0"
                            step="0.5"
                            value={estimateForm.timeEstimateHoursMin}
                            onChange={(e) => setEstimateForm({ ...estimateForm, timeEstimateHoursMin: e.target.value })}
                            className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-medium text-fg-secondary">Time max (hours)</label>
                          <input
                            type="number"
                            min="0"
                            step="0.5"
                            value={estimateForm.timeEstimateHoursMax}
                            onChange={(e) => setEstimateForm({ ...estimateForm, timeEstimateHoursMax: e.target.value })}
                            className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                          />
                        </div>
                      </div>

                      {sendEstimateError && <p className="mt-3 text-sm text-danger">{sendEstimateError}</p>}

                      <button
                        type="button"
                        onClick={handleSendEstimate}
                        disabled={sendingEstimate}
                        className="mt-3 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-60"
                      >
                        {sendingEstimate
                          ? 'Sending…'
                          : inquiry.estimateSentAt
                            ? 'Generate & Resend Estimate'
                            : 'Generate & Send Estimate'}
                      </button>
                    </>
                  )}

                  {estimateUrl && (
                    <div className="mt-4 rounded-lg border border-border p-3">
                      <p className="mb-2 text-xs text-fg-muted">
                        Share this link with the client — it expires in 7 days.
                      </p>
                      <input
                        type="text"
                        readOnly
                        value={estimateUrl}
                        onFocus={(event) => event.target.select()}
                        className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:outline-none"
                      />
                    </div>
                  )}

                  {inquiry.estimateSentAt && (
                    <div className="mt-5 space-y-2 border-t border-border pt-4 text-sm">
                      <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">
                        Estimate timeline
                      </p>

                      <p className="text-fg-secondary">Sent {formatDateTime(inquiry.estimateSentAt)}</p>

                      {inquiry.estimateOpenedAt ? (
                        <p className="text-fg-secondary">
                          Opened {formatDateTime(inquiry.estimateOpenedAt)} (
                          {formatDuration(inquiry.estimateSentAt, inquiry.estimateOpenedAt)} after sending)
                        </p>
                      ) : (
                        <p className="text-fg-muted">Not yet opened</p>
                      )}

                      {inquiry.estimateRespondedAt ? (
                        <p className="text-fg-secondary">
                          Responded {formatDateTime(inquiry.estimateRespondedAt)} (
                          {formatDuration(
                            inquiry.estimateOpenedAt ?? inquiry.estimateSentAt,
                            inquiry.estimateRespondedAt,
                          )}{' '}
                          after {inquiry.estimateOpenedAt ? 'opening' : 'sending'})
                        </p>
                      ) : (
                        <p className="text-fg-muted">Awaiting response</p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {(inquiry.status === 'SCHEDULING' || inquiry.status === 'WAITLISTED' || inquiry.appointment) && (
                <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
                  <h2 className="text-base font-semibold text-fg">Scheduling</h2>

                  {bufferWarning && (
                    <div className="mt-4 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
                      {bufferWarning}
                    </div>
                  )}

                  {inquiry.appointment && (
                    <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
                      <DetailField label="Start" value={formatDateTime(inquiry.appointment.startTime)} />
                      <DetailField label="End" value={formatDateTime(inquiry.appointment.endTime)} />
                      <DetailField label="Appointment status" value={formatStatus(inquiry.appointment.status)} />
                    </div>
                  )}

                  {inquiry.status === 'SCHEDULING' && !inquiry.appointment && (
                    <>
                      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <label className="mb-1 block text-xs font-medium text-fg-secondary">Start</label>
                          <input
                            type="datetime-local"
                            value={scheduleForm.startTime}
                            onChange={(e) => setScheduleForm({ ...scheduleForm, startTime: e.target.value })}
                            className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-medium text-fg-secondary">End</label>
                          <input
                            type="datetime-local"
                            value={scheduleForm.endTime}
                            onChange={(e) => setScheduleForm({ ...scheduleForm, endTime: e.target.value })}
                            className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                          />
                        </div>
                      </div>

                      <div className="mt-3">
                        <label className="mb-1 block text-xs font-medium text-fg-secondary">
                          Gift card (deposit) to attach
                        </label>
                        {clientGiftCards && clientGiftCards.length === 0 ? (
                          <p className="text-sm text-fg-secondary">
                            No available gift card for this client yet — the deposit should have issued one.
                          </p>
                        ) : (
                          <select
                            value={scheduleForm.giftCardId}
                            onChange={(e) => setScheduleForm({ ...scheduleForm, giftCardId: e.target.value })}
                            className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                          >
                            <option value="" disabled>
                              {clientGiftCards === undefined ? 'Loading…' : 'Select a gift card'}
                            </option>
                            {clientGiftCards?.map((card) => (
                              <option key={card.id} value={card.id}>
                                ${(card.amountCents / 100).toFixed(2)} — {card.code.slice(0, 8)}…
                              </option>
                            ))}
                          </select>
                        )}
                      </div>

                      {scheduleError && <p className="mt-3 text-sm text-danger">{scheduleError}</p>}

                      <div className="mt-3 flex flex-wrap gap-3">
                        <button
                          type="button"
                          onClick={handleSchedule}
                          disabled={
                            scheduling ||
                            !scheduleForm.startTime ||
                            !scheduleForm.endTime ||
                            !scheduleForm.giftCardId
                          }
                          className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-60"
                        >
                          {scheduling ? 'Scheduling…' : 'Schedule Appointment'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowWaitlistForm((v) => !v)}
                          className="rounded-full border border-border px-4 py-2 text-sm font-semibold text-fg transition hover:bg-surface"
                        >
                          Add to Waitlist
                        </button>
                      </div>

                      {showWaitlistForm && (
                        <div className="mt-4 rounded-lg border border-border p-3">
                          <label className="mb-1 block text-xs font-medium text-fg-secondary">
                            Waitlist note (optional)
                          </label>
                          <textarea
                            rows={2}
                            value={waitlistNote}
                            onChange={(e) => setWaitlistNote(e.target.value)}
                            className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                          />
                          {waitlistError && <p className="mt-2 text-sm text-danger">{waitlistError}</p>}
                          <button
                            type="button"
                            onClick={handleWaitlist}
                            disabled={waitlisting}
                            className="mt-2 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-60"
                          >
                            {waitlisting ? 'Saving…' : 'Confirm Waitlist'}
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-semibold text-fg">Appointments</h2>
                  {canMessage && (
                    <button
                      type="button"
                      onClick={() => setShowAppointmentModal(true)}
                      className="flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-fg transition hover:bg-surface"
                    >
                      <PlusIcon className="h-3.5 w-3.5" />
                      New Appointment
                    </button>
                  )}
                </div>

                {inquiry.sessions.length === 0 && (
                  <p className="mt-4 text-sm text-fg-secondary">No appointments booked for this project yet.</p>
                )}

                {inquiry.sessions.length > 0 && (
                  <div className="mt-4 divide-y divide-border">
                    {inquiry.sessions.map((session) => (
                      <Link
                        key={session.id}
                        to={`/appointments/${session.id}`}
                        className="flex flex-wrap items-center justify-between gap-2 py-3 first:pt-0 last:pb-0 hover:bg-surface/40"
                      >
                        <div>
                          <p className="text-sm text-fg">{formatDateTime(session.startTime)}</p>
                          <p className="mt-0.5 text-xs text-fg-muted">
                            with {session.artist.user.name ?? session.artist.user.email}
                          </p>
                        </div>
                        <StatusPill status={session.status} />
                      </Link>
                    ))}
                  </div>
                )}
              </div>

              {(inquiry.status === 'DEPOSIT_PENDING' || inquiry.depositForm) && (
                <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
                  <h2 className="text-base font-semibold text-fg">Deposit</h2>

                  {inquiry.depositForm && (
                    <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
                      <DetailField label="Deposit" value={`$${inquiry.depositForm.depositAmount}`} />
                      <DetailField label="Fee" value={`$${inquiry.depositForm.feeAmount}`} />
                      <DetailField label="Total to collect" value={`$${inquiry.depositForm.totalCharged}`} />
                    </div>
                  )}

                  {inquiry.depositForm?.signedAt ? (
                    <>
                      <p className="mt-4 text-sm text-fg-secondary">
                        Signed by {inquiry.depositForm.signatureName} on {formatDateTime(inquiry.depositForm.signedAt)}
                      </p>

                      {markPaidError && <p className="mt-3 text-sm text-danger">{markPaidError}</p>}

                      {inquiry.depositForm.paidManually ? (
                        <p className="mt-3 text-sm text-success">
                          Marked paid {inquiry.depositForm.paidAt ? formatDateTime(inquiry.depositForm.paidAt) : ''}
                        </p>
                      ) : (
                        <button
                          type="button"
                          onClick={handleMarkPaid}
                          disabled={markingPaid}
                          className="mt-3 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-60"
                        >
                          {markingPaid ? 'Saving…' : `Mark $${inquiry.depositForm.totalCharged} as Paid`}
                        </button>
                      )}
                    </>
                  ) : (
                    <>
                      {sendDepositError && <p className="mt-3 text-sm text-danger">{sendDepositError}</p>}

                      <button
                        type="button"
                        onClick={handleSendDepositForm}
                        disabled={sendingDeposit}
                        className="mt-4 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-60"
                      >
                        {sendingDeposit ? 'Sending…' : inquiry.depositForm ? 'Resend Deposit Form' : 'Send Deposit Form'}
                      </button>

                      {depositUrl && (
                        <div className="mt-4 rounded-lg border border-border p-3">
                          <p className="mb-2 text-xs text-fg-muted">
                            Share this link with the client — it expires in 48 hours.
                          </p>
                          <input
                            type="text"
                            readOnly
                            value={depositUrl}
                            onFocus={(event) => event.target.select()}
                            className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:outline-none"
                          />
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-semibold text-fg">Tattoo details</h2>
                  {!editingDetails && (
                    <button
                      type="button"
                      onClick={() => setEditingDetails(true)}
                      className="flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-fg transition hover:bg-surface"
                    >
                      <PencilIcon className="h-3.5 w-3.5" />
                      Edit
                    </button>
                  )}
                </div>

                {editingDetails ? (
                  <div className="mt-4 space-y-4">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-fg-secondary">Description</label>
                      <textarea
                        rows={4}
                        value={detailsForm.description}
                        onChange={(e) => setDetailsForm({ ...detailsForm, description: e.target.value })}
                        className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                      />
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-xs font-medium text-fg-secondary">Color or Black & Grey</label>
                        <input
                          type="text"
                          value={detailsForm.colorOrBlackGrey}
                          onChange={(e) => setDetailsForm({ ...detailsForm, colorOrBlackGrey: e.target.value })}
                          className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-fg-secondary">Placement</label>
                        <input
                          type="text"
                          value={detailsForm.placement}
                          onChange={(e) => setDetailsForm({ ...detailsForm, placement: e.target.value })}
                          className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-fg-secondary">Estimated size</label>
                        <input
                          type="text"
                          value={detailsForm.estimatedSize}
                          onChange={(e) => setDetailsForm({ ...detailsForm, estimatedSize: e.target.value })}
                          className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-fg-secondary">Budget</label>
                        <input
                          type="text"
                          value={detailsForm.budget}
                          onChange={(e) => setDetailsForm({ ...detailsForm, budget: e.target.value })}
                          className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-fg-secondary">Desired timing</label>
                        <input
                          type="text"
                          value={detailsForm.desiredTiming}
                          onChange={(e) => setDetailsForm({ ...detailsForm, desiredTiming: e.target.value })}
                          className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                        />
                      </div>
                    </div>

                    {detailsError && <p className="text-sm text-danger">{detailsError}</p>}

                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={handleSaveDetails}
                        disabled={savingDetails || !!viewAsTarget}
                        className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-60"
                      >
                        {savingDetails ? 'Saving…' : 'Save'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingDetails(false)}
                        className="rounded-full border border-border px-4 py-2 text-sm font-semibold text-fg transition hover:bg-surface"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="mt-4">
                      <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">Description</p>
                      <p className="mt-1 whitespace-pre-wrap text-sm text-fg">{inquiry.description}</p>
                    </div>

                    <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <DetailField label="Color or Black & Grey" value={inquiry.colorOrBlackGrey} />
                      <DetailField label="Placement" value={inquiry.placement} />
                      <DetailField label="Estimated size" value={inquiry.estimatedSize} />
                      <DetailField label="Tattooed before" value={inquiry.hasBeenTattooedBefore ? 'Yes' : 'No'} />
                      <DetailField label="Budget" value={inquiry.budget ?? 'Not provided'} />
                      <DetailField label="Desired timing" value={inquiry.desiredTiming ?? 'Not provided'} />
                      <DetailField
                        label="Preferred artist"
                        value={inquiry.preferredArtist?.user.name ?? 'No preference'}
                      />
                    </div>
                  </>
                )}
              </div>

              <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
                <h2 className="text-base font-semibold text-fg">Reference images</h2>
                <div className="mt-4">
                  <ImageGrid images={inquiry.referenceImages} />
                </div>
              </div>

              <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
                <h2 className="text-base font-semibold text-fg">Placement photos</h2>
                <div className="mt-4">
                  <ImageGrid images={inquiry.placementImages} />
                </div>
              </div>

              <AuditTrail entityType="Inquiry" entityId={inquiry.id} />

              {showShareModal && (
                <Modal title="Share with artist" onClose={() => setShowShareModal(false)}>
                  {shareSent ? (
                    <div className="space-y-4">
                      <p className="text-sm text-success">Sent to the artist's Team thread.</p>
                      <button
                        type="button"
                        onClick={() => setShowShareModal(false)}
                        className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover"
                      >
                        Done
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <p className="text-xs text-fg-muted">
                        Only the tattoo details below are sent — never the client's name, contact info, or health
                        information.
                      </p>

                      <div className="rounded-lg border border-border p-3 text-sm">
                        {sharePreview ? (
                          <>
                            <p className="whitespace-pre-wrap text-fg">{sharePreview.body}</p>
                            {sharePreview.attachments.length > 0 && (
                              <div className="mt-2 grid grid-cols-4 gap-2">
                                {sharePreview.attachments.map((url) => (
                                  <img key={url} src={url} alt="" className="aspect-square rounded-lg object-cover" />
                                ))}
                              </div>
                            )}
                          </>
                        ) : (
                          <p className="text-fg-muted">Loading preview…</p>
                        )}
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-medium text-fg-secondary">Send to</label>
                        <select
                          value={shareArtistUserId}
                          onChange={(e) => setShareArtistUserId(e.target.value)}
                          className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                        >
                          <option value="" disabled>
                            {artistOptions === undefined ? 'Loading artists…' : 'Select an artist'}
                          </option>
                          {artistOptions?.map((artist) => (
                            <option key={artist.id} value={artist.user.id}>
                              {artist.user.name ?? artist.user.email}
                            </option>
                          ))}
                        </select>
                      </div>

                      {shareError && <p className="text-sm text-danger">{shareError}</p>}

                      <button
                        type="button"
                        onClick={handleShareToArtist}
                        disabled={!shareArtistUserId || sharing}
                        className="w-full rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-60"
                      >
                        {sharing ? 'Sending…' : 'Send'}
                      </button>
                    </div>
                  )}
                </Modal>
              )}

              {showMarkLostModal && (
                <Modal title="Mark as lost" onClose={() => setShowMarkLostModal(false)}>
                  <div className="space-y-4">
                    <p className="text-sm text-fg-secondary">
                      This marks the inquiry as lost. You can reopen it later if the client comes back.
                    </p>

                    <div>
                      <label className="mb-1 block text-xs font-medium text-fg-secondary">Reason (optional)</label>
                      <textarea
                        rows={3}
                        value={lostReasonInput}
                        onChange={(e) => setLostReasonInput(e.target.value)}
                        className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                      />
                    </div>

                    {markLostError && <p className="text-sm text-danger">{markLostError}</p>}

                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={handleMarkLost}
                        disabled={markingLost}
                        className="flex-1 rounded-full border border-danger/40 px-4 py-2 text-sm font-medium text-danger transition hover:bg-danger/10 disabled:opacity-60"
                      >
                        {markingLost ? 'Marking lost…' : 'Mark as lost'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowMarkLostModal(false)}
                        disabled={markingLost}
                        className="rounded-full border border-border px-4 py-2 text-sm font-medium text-fg transition hover:bg-surface disabled:opacity-60"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </Modal>
              )}

              {showReopenModal && (
                <Modal title="Reopen inquiry" onClose={() => setShowReopenModal(false)}>
                  <div className="space-y-4">
                    <p className="text-sm text-fg-secondary">Choose where this inquiry should resume.</p>

                    <div>
                      <label className="mb-1 block text-xs font-medium text-fg-secondary">Status</label>
                      <select
                        value={reopenStatus}
                        onChange={(e) => setReopenStatus(e.target.value)}
                        className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                      >
                        <option value="" disabled>
                          Select a status
                        </option>
                        {REOPEN_TARGET_STATUSES.map((status) => (
                          <option key={status} value={status}>
                            {formatStatus(status)}
                          </option>
                        ))}
                      </select>
                    </div>

                    {reopenError && <p className="text-sm text-danger">{reopenError}</p>}

                    <button
                      type="button"
                      onClick={handleReopen}
                      disabled={!reopenStatus || reopening}
                      className="w-full rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-60"
                    >
                      {reopening ? 'Reopening…' : 'Reopen'}
                    </button>
                  </div>
                </Modal>
              )}

              {showAppointmentModal && (
                <Modal title="New Appointment" onClose={() => setShowAppointmentModal(false)}>
                  <div className="space-y-4">
                    <p className="text-xs text-fg-muted">
                      Booking another appointment for {inquiry.client.firstName} {inquiry.client.lastName} under this
                      project.
                    </p>

                    <div>
                      <label className="mb-1 block text-sm font-medium text-fg-secondary">Artist</label>
                      <select
                        value={appointmentForm.artistId}
                        onChange={(e) => setAppointmentForm({ ...appointmentForm, artistId: e.target.value })}
                        className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                      >
                        <option value="" disabled>
                          {artistOptions === undefined ? 'Loading artists…' : 'Select an artist'}
                        </option>
                        {artistOptions?.map((artist) => (
                          <option key={artist.id} value={artist.id}>
                            {artist.user.email}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-sm font-medium text-fg-secondary">Start</label>
                        <input
                          type="datetime-local"
                          value={appointmentForm.startTime}
                          onChange={(e) => setAppointmentForm({ ...appointmentForm, startTime: e.target.value })}
                          className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-sm font-medium text-fg-secondary">End</label>
                        <input
                          type="datetime-local"
                          value={appointmentForm.endTime}
                          onChange={(e) => setAppointmentForm({ ...appointmentForm, endTime: e.target.value })}
                          className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="mb-1 block text-sm font-medium text-fg-secondary">
                        Gift card (deposit) to attach
                      </label>
                      {clientGiftCards && clientGiftCards.length === 0 ? (
                        <p className="text-sm text-fg-secondary">
                          No available gift card for this client yet — collect a deposit or issue one first.
                        </p>
                      ) : (
                        <select
                          value={appointmentForm.giftCardId}
                          onChange={(e) => setAppointmentForm({ ...appointmentForm, giftCardId: e.target.value })}
                          className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                        >
                          <option value="" disabled>
                            {clientGiftCards === undefined ? 'Loading…' : 'Select a gift card'}
                          </option>
                          {clientGiftCards?.map((card) => (
                            <option key={card.id} value={card.id}>
                              ${(card.amountCents / 100).toFixed(2)} — {card.code.slice(0, 8)}…
                            </option>
                          ))}
                        </select>
                      )}
                    </div>

                    <div>
                      <label className="mb-1 block text-sm font-medium text-fg-secondary">Notes (optional)</label>
                      <textarea
                        rows={2}
                        value={appointmentForm.notes}
                        onChange={(e) => setAppointmentForm({ ...appointmentForm, notes: e.target.value })}
                        className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                      />
                    </div>

                    {appointmentError && <p className="text-sm text-danger">{appointmentError}</p>}

                    <button
                      type="button"
                      onClick={handleCreateAppointment}
                      disabled={
                        creatingAppointment ||
                        !appointmentForm.artistId ||
                        !appointmentForm.giftCardId ||
                        !appointmentForm.startTime ||
                        !appointmentForm.endTime
                      }
                      className="w-full rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-60"
                    >
                      {creatingAppointment ? 'Creating…' : 'Create Appointment'}
                    </button>
                  </div>
                </Modal>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
