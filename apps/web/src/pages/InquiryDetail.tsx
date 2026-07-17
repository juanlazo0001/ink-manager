import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Sidebar from '../components/Sidebar'
import AuditTrail from '../components/AuditTrail'
import Modal from '../components/Modal'
import { apiFetch, ApiError } from '../lib/api'
import { formatDateTime, formatDuration, formatStatus } from '../lib/format'
import { ArrowLeftIcon, MessageIcon, PencilIcon } from '../components/icons'
import { useAuth } from '../context/useAuth'
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
  clientId: string
  client: { firstName: string; lastName: string; email: string | null; phone: string | null }
  preferredArtist: { id: string; user: { name: string | null } } | null
  assignedArtist: { id: string; user: { name: string | null } } | null
  appointment: { id: string; startTime: string; endTime: string; status: string } | null
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

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wider text-neutral-500">{label}</p>
      <p className="mt-1 text-sm text-white">{value}</p>
    </div>
  )
}

function ImageGrid({ images }: { images: string[] }) {
  if (images.length === 0) {
    return <p className="text-sm text-neutral-400">None uploaded.</p>
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {images.map((url) => (
        <a
          key={url}
          href={url}
          target="_blank"
          rel="noreferrer"
          className="block aspect-square overflow-hidden rounded-lg border border-neutral-800"
        >
          <img src={url} alt="" className="h-full w-full object-cover transition hover:opacity-80" />
        </a>
      ))}
    </div>
  )
}

export default function InquiryDetail() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
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
  // the thread. There's no dedicated reverse-lookup endpoint -- CLIENT
  // threads are one-per-client, so get-or-create + filtering its tags
  // client-side is cheap and reuses existing routes.
  const { data: taggedConversation } = useQuery({
    queryKey: ['inquiry-conversation-tags', inquiry?.clientId, inquiry?.id],
    queryFn: async () => {
      const conversation = await apiFetch<{ id: string }>('/conversations', {
        method: 'POST',
        body: JSON.stringify({ clientId: inquiry!.clientId }),
      })
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

  const [sendingDeposit, setSendingDeposit] = useState(false)
  const [sendDepositError, setSendDepositError] = useState<string | null>(null)
  const [markingPaid, setMarkingPaid] = useState(false)
  const [markPaidError, setMarkPaidError] = useState<string | null>(null)

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
    <div className="flex min-h-screen bg-neutral-900 text-white">
      <Sidebar />

      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-6 py-6 sm:px-10 sm:py-8">
          <Link to="/inquiries" className="inline-flex items-center gap-2 text-sm text-neutral-400 hover:text-white">
            <ArrowLeftIcon className="h-4 w-4" />
            Back to Inquiries
          </Link>

          {error && (
            <div className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          {!error && !inquiry && <p className="mt-6 text-sm text-neutral-400">Loading inquiry…</p>}

          {!error && inquiry && (
            <>
              <div className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h1 className="text-xl font-bold text-white">
                      {inquiry.client.firstName} {inquiry.client.lastName}
                    </h1>
                    <p className="mt-1 text-sm text-neutral-400">
                      Submitted {formatDateTime(inquiry.createdAt)} via {formatStatus(inquiry.channel)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {canMessage && (
                      <button
                        type="button"
                        onClick={handleMessage}
                        disabled={startingConversation}
                        className="flex items-center gap-2 rounded-full border border-neutral-700 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-neutral-800 disabled:opacity-60"
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
                        className="flex items-center gap-2 rounded-full border border-neutral-700 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-neutral-800"
                      >
                        Share with artist
                      </button>
                    )}
                    <span className="inline-flex items-center rounded-full border border-neutral-700 px-3 py-1 text-xs font-medium text-neutral-300">
                      {formatStatus(inquiry.status)}
                    </span>
                  </div>
                </div>

                <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <DetailField label="Email" value={inquiry.client.email ?? 'Not provided'} />
                  <DetailField label="Phone" value={inquiry.client.phone ?? 'Not provided'} />
                </div>

                {taggedConversation && (
                  <button
                    type="button"
                    onClick={() => openPanel(taggedConversation)}
                    className="mt-4 flex items-center gap-1 text-xs font-medium text-neutral-400 hover:text-white"
                  >
                    <MessageIcon className="h-3.5 w-3.5" />
                    Tagged on this client's conversation — open thread
                  </button>
                )}
              </div>

              <div className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
                <h2 className="text-base font-semibold text-white">Assignment</h2>

                {inquiry.status === 'NEW' ? (
                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <select
                      value={selectedArtistId}
                      onChange={(event) => setSelectedArtistId(event.target.value)}
                      className="rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600"
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
                      className="rounded-full border border-neutral-700 bg-neutral-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-neutral-600 disabled:opacity-60"
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

                {assignError && <p className="mt-3 text-sm text-red-400">{assignError}</p>}

                {(inquiry.priceEstimateLow != null ||
                  inquiry.priceEstimateHigh != null ||
                  inquiry.timeEstimateHoursMin != null ||
                  inquiry.timeEstimateHoursMax != null) && (
                  <div className="mt-5 grid grid-cols-1 gap-4 border-t border-neutral-800 pt-4 sm:grid-cols-3">
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
                  <div className="mt-5 rounded-lg border border-amber-900/50 bg-amber-950/30 p-3">
                    <p className="text-xs font-medium uppercase tracking-wider text-amber-500">
                      {inquiry.status === 'WAITLISTED' ? 'Note' : 'Last decline note'}
                    </p>
                    <p className="mt-1 text-sm text-amber-200">{inquiry.declineNote}</p>
                  </div>
                )}
              </div>

              {(inquiry.status === 'AWAITING_CLIENT_RESPONSE' ||
                inquiry.status === 'BUDGET_NEGOTIATION' ||
                inquiry.estimateSentAt ||
                inquiry.closedReason) && (
                <div className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
                  <h2 className="text-base font-semibold text-white">Client Response</h2>

                  {inquiry.clientStatedBudget && (
                    <div className="mt-4 rounded-lg border border-amber-900/50 bg-amber-950/30 p-3">
                      <p className="text-xs font-medium uppercase tracking-wider text-amber-500">
                        Client's stated budget
                      </p>
                      <p className="mt-1 text-sm text-amber-200">{inquiry.clientStatedBudget}</p>
                    </div>
                  )}

                  {inquiry.closedReason && (
                    <div className="mt-4 rounded-lg border border-red-900 bg-red-950/40 p-3">
                      <p className="text-xs font-medium uppercase tracking-wider text-red-400">Closed</p>
                      <p className="mt-1 text-sm text-red-300">{inquiry.closedReason}</p>
                    </div>
                  )}

                  {(inquiry.status === 'AWAITING_CLIENT_RESPONSE' || inquiry.status === 'BUDGET_NEGOTIATION') && (
                    <>
                      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <label className="mb-1 block text-xs font-medium text-neutral-400">Price low ($)</label>
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={estimateForm.priceEstimateLow}
                            onChange={(e) => setEstimateForm({ ...estimateForm, priceEstimateLow: e.target.value })}
                            className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-medium text-neutral-400">Price high ($)</label>
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={estimateForm.priceEstimateHigh}
                            onChange={(e) => setEstimateForm({ ...estimateForm, priceEstimateHigh: e.target.value })}
                            className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-medium text-neutral-400">Time min (hours)</label>
                          <input
                            type="number"
                            min="0"
                            step="0.5"
                            value={estimateForm.timeEstimateHoursMin}
                            onChange={(e) => setEstimateForm({ ...estimateForm, timeEstimateHoursMin: e.target.value })}
                            className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-medium text-neutral-400">Time max (hours)</label>
                          <input
                            type="number"
                            min="0"
                            step="0.5"
                            value={estimateForm.timeEstimateHoursMax}
                            onChange={(e) => setEstimateForm({ ...estimateForm, timeEstimateHoursMax: e.target.value })}
                            className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600"
                          />
                        </div>
                      </div>

                      {sendEstimateError && <p className="mt-3 text-sm text-red-400">{sendEstimateError}</p>}

                      <button
                        type="button"
                        onClick={handleSendEstimate}
                        disabled={sendingEstimate}
                        className="mt-3 rounded-full border border-neutral-700 bg-neutral-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-neutral-600 disabled:opacity-60"
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
                    <div className="mt-4 rounded-lg border border-neutral-800 p-3">
                      <p className="mb-2 text-xs text-neutral-500">
                        Share this link with the client — it expires in 7 days.
                      </p>
                      <input
                        type="text"
                        readOnly
                        value={estimateUrl}
                        onFocus={(event) => event.target.select()}
                        className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white focus:outline-none"
                      />
                    </div>
                  )}

                  {inquiry.estimateSentAt && (
                    <div className="mt-5 space-y-2 border-t border-neutral-800 pt-4 text-sm">
                      <p className="text-xs font-medium uppercase tracking-wider text-neutral-500">
                        Estimate timeline
                      </p>

                      <p className="text-neutral-300">Sent {formatDateTime(inquiry.estimateSentAt)}</p>

                      {inquiry.estimateOpenedAt ? (
                        <p className="text-neutral-300">
                          Opened {formatDateTime(inquiry.estimateOpenedAt)} (
                          {formatDuration(inquiry.estimateSentAt, inquiry.estimateOpenedAt)} after sending)
                        </p>
                      ) : (
                        <p className="text-neutral-500">Not yet opened</p>
                      )}

                      {inquiry.estimateRespondedAt ? (
                        <p className="text-neutral-300">
                          Responded {formatDateTime(inquiry.estimateRespondedAt)} (
                          {formatDuration(
                            inquiry.estimateOpenedAt ?? inquiry.estimateSentAt,
                            inquiry.estimateRespondedAt,
                          )}{' '}
                          after {inquiry.estimateOpenedAt ? 'opening' : 'sending'})
                        </p>
                      ) : (
                        <p className="text-neutral-500">Awaiting response</p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {(inquiry.status === 'SCHEDULING' || inquiry.status === 'WAITLISTED' || inquiry.appointment) && (
                <div className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
                  <h2 className="text-base font-semibold text-white">Scheduling</h2>

                  {bufferWarning && (
                    <div className="mt-4 rounded-lg border border-amber-900/50 bg-amber-950/30 p-3 text-sm text-amber-200">
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
                          <label className="mb-1 block text-xs font-medium text-neutral-400">Start</label>
                          <input
                            type="datetime-local"
                            value={scheduleForm.startTime}
                            onChange={(e) => setScheduleForm({ ...scheduleForm, startTime: e.target.value })}
                            className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-medium text-neutral-400">End</label>
                          <input
                            type="datetime-local"
                            value={scheduleForm.endTime}
                            onChange={(e) => setScheduleForm({ ...scheduleForm, endTime: e.target.value })}
                            className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600"
                          />
                        </div>
                      </div>

                      <div className="mt-3">
                        <label className="mb-1 block text-xs font-medium text-neutral-400">
                          Gift card (deposit) to attach
                        </label>
                        {clientGiftCards && clientGiftCards.length === 0 ? (
                          <p className="text-sm text-neutral-400">
                            No available gift card for this client yet — the deposit should have issued one.
                          </p>
                        ) : (
                          <select
                            value={scheduleForm.giftCardId}
                            onChange={(e) => setScheduleForm({ ...scheduleForm, giftCardId: e.target.value })}
                            className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600"
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

                      {scheduleError && <p className="mt-3 text-sm text-red-400">{scheduleError}</p>}

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
                          className="rounded-full border border-neutral-700 bg-neutral-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-neutral-600 disabled:opacity-60"
                        >
                          {scheduling ? 'Scheduling…' : 'Schedule Appointment'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowWaitlistForm((v) => !v)}
                          className="rounded-full border border-neutral-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-neutral-800"
                        >
                          Add to Waitlist
                        </button>
                      </div>

                      {showWaitlistForm && (
                        <div className="mt-4 rounded-lg border border-neutral-800 p-3">
                          <label className="mb-1 block text-xs font-medium text-neutral-400">
                            Waitlist note (optional)
                          </label>
                          <textarea
                            rows={2}
                            value={waitlistNote}
                            onChange={(e) => setWaitlistNote(e.target.value)}
                            className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600"
                          />
                          {waitlistError && <p className="mt-2 text-sm text-red-400">{waitlistError}</p>}
                          <button
                            type="button"
                            onClick={handleWaitlist}
                            disabled={waitlisting}
                            className="mt-2 rounded-full border border-neutral-700 bg-neutral-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-neutral-600 disabled:opacity-60"
                          >
                            {waitlisting ? 'Saving…' : 'Confirm Waitlist'}
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {(inquiry.status === 'DEPOSIT_PENDING' || inquiry.depositForm) && (
                <div className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
                  <h2 className="text-base font-semibold text-white">Deposit</h2>

                  {inquiry.depositForm && (
                    <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
                      <DetailField label="Deposit" value={`$${inquiry.depositForm.depositAmount}`} />
                      <DetailField label="Fee" value={`$${inquiry.depositForm.feeAmount}`} />
                      <DetailField label="Total to collect" value={`$${inquiry.depositForm.totalCharged}`} />
                    </div>
                  )}

                  {inquiry.depositForm?.signedAt ? (
                    <>
                      <p className="mt-4 text-sm text-neutral-300">
                        Signed by {inquiry.depositForm.signatureName} on {formatDateTime(inquiry.depositForm.signedAt)}
                      </p>

                      {markPaidError && <p className="mt-3 text-sm text-red-400">{markPaidError}</p>}

                      {inquiry.depositForm.paidManually ? (
                        <p className="mt-3 text-sm text-green-400">
                          Marked paid {inquiry.depositForm.paidAt ? formatDateTime(inquiry.depositForm.paidAt) : ''}
                        </p>
                      ) : (
                        <button
                          type="button"
                          onClick={handleMarkPaid}
                          disabled={markingPaid}
                          className="mt-3 rounded-full border border-neutral-700 bg-neutral-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-neutral-600 disabled:opacity-60"
                        >
                          {markingPaid ? 'Saving…' : `Mark $${inquiry.depositForm.totalCharged} as Paid`}
                        </button>
                      )}
                    </>
                  ) : (
                    <>
                      {sendDepositError && <p className="mt-3 text-sm text-red-400">{sendDepositError}</p>}

                      <button
                        type="button"
                        onClick={handleSendDepositForm}
                        disabled={sendingDeposit}
                        className="mt-4 rounded-full border border-neutral-700 bg-neutral-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-neutral-600 disabled:opacity-60"
                      >
                        {sendingDeposit ? 'Sending…' : inquiry.depositForm ? 'Resend Deposit Form' : 'Send Deposit Form'}
                      </button>

                      {depositUrl && (
                        <div className="mt-4 rounded-lg border border-neutral-800 p-3">
                          <p className="mb-2 text-xs text-neutral-500">
                            Share this link with the client — it expires in 48 hours.
                          </p>
                          <input
                            type="text"
                            readOnly
                            value={depositUrl}
                            onFocus={(event) => event.target.select()}
                            className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white focus:outline-none"
                          />
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              <div className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-semibold text-white">Tattoo details</h2>
                  {!editingDetails && (
                    <button
                      type="button"
                      onClick={() => setEditingDetails(true)}
                      className="flex items-center gap-2 rounded-full border border-neutral-700 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-neutral-800"
                    >
                      <PencilIcon className="h-3.5 w-3.5" />
                      Edit
                    </button>
                  )}
                </div>

                {editingDetails ? (
                  <div className="mt-4 space-y-4">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-neutral-400">Description</label>
                      <textarea
                        rows={4}
                        value={detailsForm.description}
                        onChange={(e) => setDetailsForm({ ...detailsForm, description: e.target.value })}
                        className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600"
                      />
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-xs font-medium text-neutral-400">Color or Black & Grey</label>
                        <input
                          type="text"
                          value={detailsForm.colorOrBlackGrey}
                          onChange={(e) => setDetailsForm({ ...detailsForm, colorOrBlackGrey: e.target.value })}
                          className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-neutral-400">Placement</label>
                        <input
                          type="text"
                          value={detailsForm.placement}
                          onChange={(e) => setDetailsForm({ ...detailsForm, placement: e.target.value })}
                          className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-neutral-400">Estimated size</label>
                        <input
                          type="text"
                          value={detailsForm.estimatedSize}
                          onChange={(e) => setDetailsForm({ ...detailsForm, estimatedSize: e.target.value })}
                          className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-neutral-400">Budget</label>
                        <input
                          type="text"
                          value={detailsForm.budget}
                          onChange={(e) => setDetailsForm({ ...detailsForm, budget: e.target.value })}
                          className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-neutral-400">Desired timing</label>
                        <input
                          type="text"
                          value={detailsForm.desiredTiming}
                          onChange={(e) => setDetailsForm({ ...detailsForm, desiredTiming: e.target.value })}
                          className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600"
                        />
                      </div>
                    </div>

                    {detailsError && <p className="text-sm text-red-400">{detailsError}</p>}

                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={handleSaveDetails}
                        disabled={savingDetails}
                        className="rounded-full border border-neutral-700 bg-neutral-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-neutral-600 disabled:opacity-60"
                      >
                        {savingDetails ? 'Saving…' : 'Save'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingDetails(false)}
                        className="rounded-full border border-neutral-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-neutral-800"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="mt-4">
                      <p className="text-xs font-medium uppercase tracking-wider text-neutral-500">Description</p>
                      <p className="mt-1 whitespace-pre-wrap text-sm text-white">{inquiry.description}</p>
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

              <div className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
                <h2 className="text-base font-semibold text-white">Reference images</h2>
                <div className="mt-4">
                  <ImageGrid images={inquiry.referenceImages} />
                </div>
              </div>

              <div className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
                <h2 className="text-base font-semibold text-white">Placement photos</h2>
                <div className="mt-4">
                  <ImageGrid images={inquiry.placementImages} />
                </div>
              </div>

              <AuditTrail entityType="Inquiry" entityId={inquiry.id} />

              {showShareModal && (
                <Modal title="Share with artist" onClose={() => setShowShareModal(false)}>
                  {shareSent ? (
                    <div className="space-y-4">
                      <p className="text-sm text-green-400">Sent to the artist's Team thread.</p>
                      <button
                        type="button"
                        onClick={() => setShowShareModal(false)}
                        className="rounded-full border border-neutral-700 bg-neutral-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-neutral-600"
                      >
                        Done
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <p className="text-xs text-neutral-500">
                        Only the tattoo details below are sent — never the client's name, contact info, or health
                        information.
                      </p>

                      <div className="rounded-lg border border-neutral-800 p-3 text-sm">
                        {sharePreview ? (
                          <>
                            <p className="whitespace-pre-wrap text-neutral-200">{sharePreview.body}</p>
                            {sharePreview.attachments.length > 0 && (
                              <div className="mt-2 grid grid-cols-4 gap-2">
                                {sharePreview.attachments.map((url) => (
                                  <img key={url} src={url} alt="" className="aspect-square rounded-lg object-cover" />
                                ))}
                              </div>
                            )}
                          </>
                        ) : (
                          <p className="text-neutral-500">Loading preview…</p>
                        )}
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-medium text-neutral-400">Send to</label>
                        <select
                          value={shareArtistUserId}
                          onChange={(e) => setShareArtistUserId(e.target.value)}
                          className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600"
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

                      {shareError && <p className="text-sm text-red-400">{shareError}</p>}

                      <button
                        type="button"
                        onClick={handleShareToArtist}
                        disabled={!shareArtistUserId || sharing}
                        className="w-full rounded-full border border-neutral-700 bg-neutral-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-neutral-600 disabled:opacity-60"
                      >
                        {sharing ? 'Sending…' : 'Send'}
                      </button>
                    </div>
                  )}
                </Modal>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
