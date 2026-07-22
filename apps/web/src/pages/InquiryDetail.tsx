import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Sidebar from '../components/Sidebar'
import AuditTrail from '../components/AuditTrail'
import Modal from '../components/Modal'
import StatusPill from '../components/StatusPill'
import InquiryPipeline from '../components/InquiryPipeline'
import AppointmentForm from '../components/AppointmentForm'
import CurrencyInput from '../components/CurrencyInput'
import ImageUploadSection, { type ImageUploadState } from '../components/ImageUploadSection'
import { ArtistAvatar, artistLabel, type ArtistLike } from '../components/ArtistAvatar'
import ArtistSelect from '../components/ArtistSelect'
import DateAndTimeRangeFields, {
  combineDateAndTime,
  isCompleteTimeRange,
  isValidTimeRange,
  type DateAndTimeRangeValue,
} from '../components/DateAndTimeRangeFields'
import { apiFetch, ApiError } from '../lib/api'
import { formatDateTime, formatDuration, formatPhoneInput, formatStatus } from '../lib/format'
import {
  ArrowLeftIcon,
  CheckIcon,
  ClientsIcon,
  CopyIcon,
  MessageIcon,
  MoreIcon,
  PencilIcon,
  PlusIcon,
  ShareIcon,
} from '../components/icons'
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
  notes: string | null
  archivedAt: string | null
  clientId: string
  client: { firstName: string; lastName: string; email: string | null; phone: string | null }
  preferredArtist: { id: string; user: { name: string | null; email: string; avatarUrl: string | null } } | null
  assignedArtist: { id: string; user: { name: string | null; email: string; avatarUrl: string | null } } | null
  appointment: { id: string; startTime: string; endTime: string; status: string } | null
  sessions: {
    id: string
    startTime: string
    endTime: string
    status: string
    artist: { id: string; user: { name: string | null; email: string; avatarUrl: string | null } }
  }[]
  depositForm: {
    id: string
    token: string
    depositAmount: number
    feeAmount: number
    totalCharged: number
    signedAt: string | null
    signatureName: string | null
    signatureData: string | null
    paidManually: boolean
    paidAt: string | null
    proposedStartAt: string | null
    proposedEndAt: string | null
  } | null
}

interface SuggestedTimeCandidate {
  startTime: string
  endTime: string
  hasBufferConflict: boolean
}

interface ArtistOption {
  id: string
  user: { id: string; email: string; name: string | null; avatarUrl: string | null }
  isGuest: boolean
  guestEndDate: string | null
}

// New assignments never default-offer a guest artist whose window has
// ended -- they still exist and past assignments/appointments are
// untouched, they just don't show up here to be picked going forward.
function isEndedGuest(artist: ArtistOption): boolean {
  return artist.isGuest && !!artist.guestEndDate && new Date(artist.guestEndDate) < new Date()
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
  if ((card.status !== 'ACTIVE' && card.status !== 'EXEMPT') || card.appointmentId) return false
  return !card.expiresAt || new Date(card.expiresAt) > new Date()
}

function giftCardOptionLabel(card: GiftCardOption): string {
  return card.status === 'EXEMPT' ? 'Deposit Exemption' : `$${(card.amountCents / 100).toFixed(2)}`
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

interface DeletePreview {
  appointments: number
  waivers: number
  depositForms: number
  giftCardsToDetach: { id: string; code: string; amountCents: number; status: string }[]
  consentFormsToDetach: number
  conversationTags: number
}

const DELETE_CONFIRM_TEXT = 'DELETE'

// Whole-hour options for the estimate form's time-min/max dropdowns (1-16
// covers everything from a small piece to a full-day session).
const HOUR_OPTIONS = Array.from({ length: 16 }, (_, i) => i + 1)

// Mirrors clientSms.ts's SendClientSmsResult -- send-estimate auto-sends
// through that same real path now, so the same skip reasons apply. The
// estimate itself is always generated regardless of this outcome (see the
// route's own comment), so a skip/failure here is informational, not an
// error the user needs to retry past -- the link is still on-screen to
// share manually either way.
function describeEstimateSendResult(
  result:
    | { sent: true }
    | { sent: false; reason: 'not_connected' | 'no_phone' | 'opted_out' | 'send_failed'; error?: string },
): string {
  if (result.sent) return 'Estimate sent to the client via text — check Conversations.'
  switch (result.reason) {
    case 'not_connected':
      return 'Estimate generated, but SMS isn\'t connected for this studio — share the link below manually.'
    case 'no_phone':
      return 'Estimate generated, but this client has no phone on file — share the link below manually.'
    case 'opted_out':
      return 'Estimate generated, but this client has opted out of texts — share the link below manually.'
    default:
      return 'Estimate generated, but the text failed to send — share the link below manually.'
  }
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">{label}</p>
      <p className="mt-1 text-sm text-fg">{value}</p>
    </div>
  )
}

// Same label styling as DetailField, but the value row is an avatar+name
// (or the plain emptyLabel text when there's no artist to show one for).
function ArtistDetailField({ label, artist, emptyLabel }: { label: string; artist: ArtistLike | null; emptyLabel: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">{label}</p>
      {artist ? (
        <div className="mt-1 flex items-center gap-2">
          <ArtistAvatar artist={artist} className="h-6 w-6" />
          <p className="text-sm text-fg">{artistLabel(artist)}</p>
        </div>
      ) : (
        <p className="mt-1 text-sm text-fg">{emptyLabel}</p>
      )}
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
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const user = useEffectiveUser()
  const { target: viewAsTarget } = useViewAs()
  const queryClient = useQueryClient()
  const { openPanel } = useConversationPanel()
  const canMessage = user?.role === 'OWNER' || user?.role === 'FRONT_DESK'
  const isOwner = user?.role === 'OWNER'
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

  // Editable copy of the generated preview -- seeded once per fetch (not on
  // every render) so staff's in-progress edits never get clobbered by a
  // background refetch, same "seed once" pattern as estimateForm/detailsForm
  // above. Reset alongside the other share-modal state when it's reopened.
  const [shareBody, setShareBody] = useState('')
  const [shareBodySeeded, setShareBodySeeded] = useState(false)

  const { data: sharePreview } = useQuery({
    queryKey: ['inquiry-share-preview', id],
    queryFn: () => apiFetch<SharePreview>(`/inquiries/${id}/share-to-artist/preview`),
    enabled: !!id && showShareModal,
  })

  if (sharePreview && !shareBodySeeded) {
    setShareBodySeeded(true)
    setShareBody(sharePreview.body)
  }

  async function handleShareToArtist() {
    if (!id || !shareArtistUserId) return

    setSharing(true)
    setShareError(null)

    try {
      await apiFetch(`/inquiries/${id}/share-to-artist`, {
        method: 'POST',
        body: JSON.stringify({ artistUserId: shareArtistUserId, body: shareBody }),
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
  // Assignment (a new/first assignment, only offered while status === 'NEW')
  // excludes ended guests by default. "Share with Artist" below is a send-
  // to/notify action, not an assignment, so it intentionally still lists
  // everyone -- staff may reasonably want to loop in a former guest.
  const assignableArtistOptions = artistOptions?.filter((a) => !isEndedGuest(a))
  // ArtistSelect matches on `id`; the share modal's value is the artist's
  // USER id (see the artistUserId POST payload below), not the Artist
  // record id every other picker on this page keys by -- re-keyed here
  // rather than changing ArtistSelect's contract for this one call site.
  const shareArtistChoices = artistOptions?.map((artist) => ({ ...artist, id: artist.user.id }))

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
  const hasAvailableGiftCard = !!clientGiftCards && clientGiftCards.length > 0

  const [selectedArtistId, setSelectedArtistId] = useState('')
  const [assigning, setAssigning] = useState(false)
  const [assignError, setAssignError] = useState<string | null>(null)

  // Starts false and is seeded per-inquiry below (true only when no estimate
  // has ever been sent yet -- otherwise these fields would always be
  // editable inputs even while just viewing an inquiry that already has an
  // estimate out).
  const [editingEstimate, setEditingEstimate] = useState(false)
  const [estimateForm, setEstimateForm] = useState({
    priceEstimateLow: '',
    priceEstimateHigh: '',
    timeEstimateHoursMin: '',
    timeEstimateHoursMax: '',
  })
  const [sendingEstimate, setSendingEstimate] = useState(false)
  const [sendEstimateError, setSendEstimateError] = useState<string | null>(null)
  const [estimateSendNotice, setEstimateSendNotice] = useState<string | null>(null)

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

  // Internal-only staff notes -- separate save flow from detailsForm above
  // since it's an independent field with no relation to the client-facing
  // tattoo details, and shouldn't get bundled into (or blocked by) that
  // save/validation cycle.
  const [editingNotes, setEditingNotes] = useState(false)
  const [notesForm, setNotesForm] = useState('')
  const [savingNotes, setSavingNotes] = useState(false)
  const [notesError, setNotesError] = useState<string | null>(null)

  const [editingReferenceImages, setEditingReferenceImages] = useState(false)
  const [referenceImagesState, setReferenceImagesState] = useState<ImageUploadState>({ urls: [], uploading: false })
  const [savingReferenceImages, setSavingReferenceImages] = useState(false)
  const [referenceImagesError, setReferenceImagesError] = useState<string | null>(null)

  const [editingPlacementImages, setEditingPlacementImages] = useState(false)
  const [placementImagesState, setPlacementImagesState] = useState<ImageUploadState>({ urls: [], uploading: false })
  const [savingPlacementImages, setSavingPlacementImages] = useState(false)
  const [placementImagesError, setPlacementImagesError] = useState<string | null>(null)

  const [scheduleTimeRange, setScheduleTimeRange] = useState<DateAndTimeRangeValue>({
    date: '',
    startTime: '',
    endTime: '',
  })
  const [scheduleGiftCardId, setScheduleGiftCardId] = useState('')
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
  const [copied, setCopied] = useState(false)
  const [showMarkLostModal, setShowMarkLostModal] = useState(false)
  const [lostReasonInput, setLostReasonInput] = useState('')
  const [markingLost, setMarkingLost] = useState(false)
  const [markLostError, setMarkLostError] = useState<string | null>(null)

  const [showReopenModal, setShowReopenModal] = useState(false)
  const [reopenStatus, setReopenStatus] = useState('')
  const [reopening, setReopening] = useState(false)
  const [reopenError, setReopenError] = useState<string | null>(null)

  // The Kanban board (Inquiries.tsx / MyInquiries.tsx) navigates here with
  // ?openFlow=... for any drag that needs more input than "this happened" --
  // this is the single place that turns that into the exact same
  // modal/section every other entry point into these flows already uses, so
  // nothing about assign/send-estimate/schedule/mark-lost/reopen's own
  // validation or audit logging is duplicated or bypassed. Runs once
  // `inquiry` is loaded (so status-gated sections have already rendered),
  // then strips the param so a refresh doesn't reopen it.
  useEffect(() => {
    const openFlow = searchParams.get('openFlow')
    if (!openFlow || !inquiry) return

    if (openFlow === 'mark-lost') {
      setShowMarkLostModal(true)
    } else if (openFlow === 'reopen') {
      setShowReopenModal(true)
    } else if (openFlow === 'assign' || openFlow === 'send-estimate' || openFlow === 'schedule') {
      const sectionId =
        openFlow === 'assign' ? 'assignment-section' : openFlow === 'send-estimate' ? 'estimate-section' : 'scheduling-section'
      document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }

    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete('openFlow')
      return next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inquiry, searchParams])

  const [archiving, setArchiving] = useState(false)
  const [archiveError, setArchiveError] = useState<string | null>(null)

  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [deletePreview, setDeletePreview] = useState<DeletePreview | null>(null)
  const [deletePreviewLoading, setDeletePreviewLoading] = useState(false)
  const [deletePreviewError, setDeletePreviewError] = useState<string | null>(null)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const [sendingDeposit, setSendingDeposit] = useState(false)
  const [sendDepositError, setSendDepositError] = useState<string | null>(null)
  const [markingPaid, setMarkingPaid] = useState(false)
  const [markPaidError, setMarkPaidError] = useState<string | null>(null)

  // Package D: tentative/informational deposit-form time, via the shared
  // getSuggestedTimes service (apps/api/src/lib/schedulingAssistant.ts).
  // Required before a deposit form can be generated at all (see
  // handleSendDepositForm/tentativeTimeValid below) -- tentativeTimeRange is
  // the one field both the pre-send picker and the post-send "Change" modal
  // bind to, since the two are never shown at the same time.
  const [showSuggestTime, setShowSuggestTime] = useState(false)
  const [suggestedTimeCandidates, setSuggestedTimeCandidates] = useState<SuggestedTimeCandidate[]>([])
  const [suggestingTimeLoading, setSuggestingTimeLoading] = useState(false)
  const [suggestTimeError, setSuggestTimeError] = useState<string | null>(null)
  const [savingProposedTime, setSavingProposedTime] = useState(false)
  const [tentativeTimeRange, setTentativeTimeRange] = useState<DateAndTimeRangeValue>({
    date: '',
    startTime: '',
    endTime: '',
  })

  const [attachGiftCardId, setAttachGiftCardId] = useState('')
  const [attachingGiftCard, setAttachingGiftCard] = useState(false)
  const [attachGiftCardError, setAttachGiftCardError] = useState<string | null>(null)

  // UI-1 §3: appointments/sessions nested inside their project. Distinct
  // from scheduleForm above (which drives the special first-scheduling-slot
  // flow via /inquiries/:id/schedule) -- this is the generic
  // POST /appointments route (via the shared AppointmentForm component,
  // Phase UI-4), pre-scoped to this project's client + inquiry, for
  // booking an additional session under a project already underway.
  const [showAppointmentModal, setShowAppointmentModal] = useState(false)

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
    setEditingEstimate(!inquiry.estimateSentAt)
    setDetailsForm({
      description: inquiry.description,
      colorOrBlackGrey: inquiry.colorOrBlackGrey,
      placement: inquiry.placement,
      estimatedSize: inquiry.estimatedSize,
      budget: inquiry.budget ?? '',
      desiredTiming: inquiry.desiredTiming ?? '',
    })
    setNotesForm(inquiry.notes ?? '')
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
    setEstimateSendNotice(null)

    try {
      const result = await apiFetch<{
        estimateSendResult:
          | { sent: true }
          | { sent: false; reason: 'not_connected' | 'no_phone' | 'opted_out' | 'send_failed'; error?: string }
      }>(`/inquiries/${id}/send-estimate`, {
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

      setEstimateSendNotice(describeEstimateSendResult(result.estimateSendResult))
      setEditingEstimate(false)
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

  async function handleSaveNotes() {
    if (!id) return

    setSavingNotes(true)
    setNotesError(null)

    try {
      await apiFetch(`/inquiries/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ notes: notesForm.trim() || null }),
      })

      setEditingNotes(false)
      invalidateInquiry()
    } catch (err) {
      setNotesError(err instanceof Error ? err.message : 'Failed to save notes')
    } finally {
      setSavingNotes(false)
    }
  }

  async function handleSaveReferenceImages() {
    if (!id) return

    setSavingReferenceImages(true)
    setReferenceImagesError(null)

    try {
      await apiFetch(`/inquiries/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ referenceImages: referenceImagesState.urls }),
      })

      setEditingReferenceImages(false)
      invalidateInquiry()
    } catch (err) {
      setReferenceImagesError(err instanceof Error ? err.message : 'Failed to save changes')
    } finally {
      setSavingReferenceImages(false)
    }
  }

  async function handleSavePlacementImages() {
    if (!id) return

    setSavingPlacementImages(true)
    setPlacementImagesError(null)

    try {
      await apiFetch(`/inquiries/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ placementImages: placementImagesState.urls }),
      })

      setEditingPlacementImages(false)
      invalidateInquiry()
    } catch (err) {
      setPlacementImagesError(err instanceof Error ? err.message : 'Failed to save changes')
    } finally {
      setSavingPlacementImages(false)
    }
  }

  async function handleSchedule() {
    if (!id || !scheduleGiftCardId || !isCompleteTimeRange(scheduleTimeRange)) return
    if (!isValidTimeRange(scheduleTimeRange)) {
      setScheduleError('End time must be after start time.')
      return
    }

    const start = combineDateAndTime(scheduleTimeRange.date, scheduleTimeRange.startTime)!
    const end = combineDateAndTime(scheduleTimeRange.date, scheduleTimeRange.endTime)!

    setScheduling(true)
    setScheduleError(null)
    setBufferWarning(null)

    try {
      const result = await apiFetch<{ bufferWarning: string | null }>(`/inquiries/${id}/schedule`, {
        method: 'POST',
        body: JSON.stringify({
          startTime: start.toISOString(),
          endTime: end.toISOString(),
          giftCardId: scheduleGiftCardId,
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

  async function handleArchive() {
    if (!id) return
    setArchiving(true)
    setArchiveError(null)
    try {
      await apiFetch(`/inquiries/${id}/archive`, { method: 'POST' })
      invalidateInquiry()
    } catch (err) {
      setArchiveError(err instanceof Error ? err.message : 'Failed to archive inquiry')
    } finally {
      setArchiving(false)
    }
  }

  async function handleUnarchive() {
    if (!id) return
    setArchiving(true)
    setArchiveError(null)
    try {
      await apiFetch(`/inquiries/${id}/unarchive`, { method: 'POST' })
      invalidateInquiry()
    } catch (err) {
      setArchiveError(err instanceof Error ? err.message : 'Failed to unarchive inquiry')
    } finally {
      setArchiving(false)
    }
  }

  async function openDeleteModal() {
    if (!id) return
    setShowDeleteModal(true)
    setDeleteConfirmText('')
    setDeleteError(null)
    setDeletePreview(null)
    setDeletePreviewError(null)
    setDeletePreviewLoading(true)
    try {
      const preview = await apiFetch<DeletePreview>(`/inquiries/${id}/delete-preview`)
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
      await apiFetch(`/inquiries/${id}`, {
        method: 'DELETE',
        body: JSON.stringify({ confirm: deleteConfirmText }),
      })
      queryClient.invalidateQueries({ queryKey: inquiriesQueryKey(user!.studioId) })
      navigate('/inquiries', { state: { flash: 'Inquiry was permanently deleted.' } })
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete inquiry')
    } finally {
      setDeleting(false)
    }
  }

  // ISO instant -> the {date, startTime, endTime} shape DateAndTimeRangeFields
  // edits -- mirrors AppointmentForm.tsx's own helper of the same name for
  // the same getSuggestedTimes response shape.
  function isoToTimeRangeParts(startIso: string, endIso: string): DateAndTimeRangeValue {
    const start = new Date(startIso)
    const end = new Date(endIso)
    const pad = (n: number) => String(n).padStart(2, '0')
    return {
      date: `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`,
      startTime: `${pad(start.getHours())}:${pad(start.getMinutes())}`,
      endTime: `${pad(end.getHours())}:${pad(end.getMinutes())}`,
    }
  }

  const tentativeTimeValid = isCompleteTimeRange(tentativeTimeRange) && isValidTimeRange(tentativeTimeRange)

  async function handleSendDepositForm() {
    if (!id) return
    // Required only the first time -- resending (token rotation on an
    // existing, unsigned form) doesn't touch the tentative time at all, see
    // the API route's own comment.
    const isFirstSend = !inquiry?.depositForm
    if (isFirstSend && !tentativeTimeValid) return

    setSendingDeposit(true)
    setSendDepositError(null)

    try {
      const body = isFirstSend
        ? JSON.stringify({
            proposedStartAt: combineDateAndTime(tentativeTimeRange.date, tentativeTimeRange.startTime)!.toISOString(),
            proposedEndAt: combineDateAndTime(tentativeTimeRange.date, tentativeTimeRange.endTime)!.toISOString(),
          })
        : undefined
      await apiFetch(`/inquiries/${id}/deposit-form`, { method: 'POST', body })
      invalidateInquiry()
    } catch (err) {
      setSendDepositError(err instanceof Error ? err.message : 'Failed to send deposit form')
    } finally {
      setSendingDeposit(false)
    }
  }

  // Shared by the always-visible pre-send picker below and the post-send
  // "Change" modal -- both read from the same suggestedTimeCandidates state.
  async function fetchSuggestedTimes() {
    if (!inquiry?.assignedArtist || inquiry.timeEstimateHoursMin == null || inquiry.timeEstimateHoursMax == null) return

    setSuggestTimeError(null)
    setSuggestingTimeLoading(true)
    setSuggestedTimeCandidates([])

    try {
      const durationMinutes = Math.round(((inquiry.timeEstimateHoursMin + inquiry.timeEstimateHoursMax) / 2) * 60)
      const candidates = await apiFetch<SuggestedTimeCandidate[]>(
        `/scheduling/suggested-times?artistId=${inquiry.assignedArtist.id}&durationMinutes=${durationMinutes}`,
      )
      setSuggestedTimeCandidates(candidates)
    } catch (err) {
      setSuggestTimeError(err instanceof Error ? err.message : 'Failed to load suggestions')
    } finally {
      setSuggestingTimeLoading(false)
    }
  }

  // Pre-send: suggestions load as soon as there's an artist + time estimate
  // to search with and no deposit form exists yet -- staff shouldn't need an
  // extra click just to see them, since picking one (or entering a time by
  // hand) is now required before a deposit form can be generated at all.
  useEffect(() => {
    if (inquiry?.depositForm) return
    if (!inquiry?.assignedArtist || inquiry.timeEstimateHoursMin == null || inquiry.timeEstimateHoursMax == null) return
    fetchSuggestedTimes()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    inquiry?.id,
    Boolean(inquiry?.depositForm),
    inquiry?.assignedArtist?.id,
    inquiry?.timeEstimateHoursMin,
    inquiry?.timeEstimateHoursMax,
  ])

  function handleOpenSuggestTime() {
    // Seed the shared fields from whatever's already set (editing an
    // existing tentative time), or blank (never had one, or previously
    // Cleared) -- either way the modal always offers both the suggested
    // list and manual entry.
    setTentativeTimeRange(
      inquiry?.depositForm?.proposedStartAt && inquiry?.depositForm?.proposedEndAt
        ? isoToTimeRangeParts(inquiry.depositForm.proposedStartAt, inquiry.depositForm.proposedEndAt)
        : { date: '', startTime: '', endTime: '' },
    )
    setShowSuggestTime(true)
    fetchSuggestedTimes()
  }

  async function handleSaveProposedTime() {
    if (!id || !tentativeTimeValid) return

    setSavingProposedTime(true)
    setSuggestTimeError(null)

    try {
      await apiFetch(`/inquiries/${id}/deposit-form/proposed-time`, {
        method: 'PATCH',
        body: JSON.stringify({
          proposedStartAt: combineDateAndTime(tentativeTimeRange.date, tentativeTimeRange.startTime)!.toISOString(),
          proposedEndAt: combineDateAndTime(tentativeTimeRange.date, tentativeTimeRange.endTime)!.toISOString(),
        }),
      })
      setShowSuggestTime(false)
      invalidateInquiry()
    } catch (err) {
      setSuggestTimeError(err instanceof Error ? err.message : 'Failed to save proposed time')
    } finally {
      setSavingProposedTime(false)
    }
  }

  async function handleClearProposedTime() {
    if (!id) return

    setSavingProposedTime(true)
    setSuggestTimeError(null)

    try {
      await apiFetch(`/inquiries/${id}/deposit-form/proposed-time`, {
        method: 'PATCH',
        body: JSON.stringify({ proposedStartAt: null, proposedEndAt: null }),
      })
      invalidateInquiry()
    } catch (err) {
      setSuggestTimeError(err instanceof Error ? err.message : 'Failed to clear proposed time')
    } finally {
      setSavingProposedTime(false)
    }
  }

  async function handleAttachGiftCard() {
    if (!id) return
    const giftCardId = attachGiftCardId || clientGiftCards?.[0]?.id
    if (!giftCardId) return

    setAttachingGiftCard(true)
    setAttachGiftCardError(null)

    try {
      await apiFetch(`/inquiries/${id}/attach-gift-card`, {
        method: 'POST',
        body: JSON.stringify({ giftCardId }),
      })
      invalidateInquiry()
    } catch (err) {
      setAttachGiftCardError(err instanceof Error ? err.message : 'Failed to attach gift card')
    } finally {
      setAttachingGiftCard(false)
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

  async function handleCopyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard access can fail (permissions); the link is visible to copy manually.
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
                    {/* Icon-only 44px circles below md (768px, Phase UI-3's
                        breakpoint), icon+label pills at md+ -- aria-label
                        and title are present at both sizes so an
                        unfamiliar icon is always identifiable even on
                        desktop where the label is also visible. */}
                    <button
                      type="button"
                      onClick={() => navigate(`/clients/${inquiry.clientId}`)}
                      aria-label="View Client"
                      title="View Client"
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border text-fg transition hover:bg-surface md:h-auto md:w-auto md:gap-2 md:px-3 md:py-1.5"
                    >
                      <ClientsIcon className="h-4 w-4 md:h-3.5 md:w-3.5" />
                      <span className="hidden text-xs font-medium md:inline">View Client</span>
                    </button>
                    {canMessage && (
                      <button
                        type="button"
                        onClick={handleMessage}
                        disabled={startingConversation}
                        aria-label="Message"
                        title="Message"
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border text-fg transition hover:bg-surface disabled:opacity-60 md:h-auto md:w-auto md:gap-2 md:px-3 md:py-1.5"
                      >
                        <MessageIcon className="h-4 w-4 md:h-3.5 md:w-3.5" />
                        <span className="hidden text-xs font-medium md:inline">Message</span>
                      </button>
                    )}
                    {canMessage && (
                      <button
                        type="button"
                        onClick={() => {
                          // Default to whoever's already assigned -- that's
                          // almost always who staff mean to share with;
                          // nothing to default to if no one's assigned yet.
                          const assignedUserId = artistOptions?.find(
                            (a) => a.id === inquiry.assignedArtist?.id,
                          )?.user.id
                          setShareArtistUserId(assignedUserId ?? '')
                          setShareError(null)
                          setShareSent(false)
                          setShareBodySeeded(false)
                          setShowShareModal(true)
                        }}
                        aria-label="Share with Artist"
                        title="Share with Artist"
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border text-fg transition hover:bg-surface md:h-auto md:w-auto md:gap-2 md:px-3 md:py-1.5"
                      >
                        <ShareIcon className="h-4 w-4 md:h-3.5 md:w-3.5" />
                        <span className="hidden text-xs font-medium md:inline">Share with Artist</span>
                      </button>
                    )}
                    <StatusPill status={inquiry.status} />
                    {(canMessage || isOwner) && (
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => setShowMoreMenu((v) => !v)}
                          aria-label="More actions"
                          aria-pressed={showMoreMenu}
                          title="More actions"
                          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-fg-muted transition hover:bg-surface hover:text-fg md:h-9 md:w-9"
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
                              {canMessage && !isTerminal && (
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
                              )}
                              {canMessage && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setShowMoreMenu(false)
                                    if (inquiry.archivedAt) {
                                      handleUnarchive()
                                    } else {
                                      handleArchive()
                                    }
                                  }}
                                  disabled={archiving}
                                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-fg-secondary hover:bg-surface disabled:opacity-60"
                                >
                                  {inquiry.archivedAt ? 'Unarchive' : 'Archive'}
                                </button>
                              )}
                              {isOwner && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setShowMoreMenu(false)
                                    openDeleteModal()
                                  }}
                                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-danger hover:bg-danger/10"
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

                {inquiry.archivedAt && (
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
                    <span>Archived {formatDateTime(inquiry.archivedAt)}. Hidden from the inbox, but fully intact.</span>
                    {canMessage && (
                      <button
                        type="button"
                        onClick={handleUnarchive}
                        disabled={archiving}
                        className="shrink-0 rounded-full border border-warning/40 px-3 py-1.5 text-xs font-medium text-warning transition hover:bg-warning/10 disabled:opacity-60"
                      >
                        {archiving ? 'Unarchiving…' : 'Unarchive'}
                      </button>
                    )}
                  </div>
                )}
                {archiveError && <p className="mt-2 text-sm text-danger">{archiveError}</p>}

                <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <DetailField label="Email" value={inquiry.client.email ?? 'Not provided'} />
                  <DetailField
                    label="Phone"
                    value={inquiry.client.phone ? formatPhoneInput(inquiry.client.phone) : 'Not provided'}
                  />
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

              <div id="assignment-section" className="mt-6 rounded-2xl border border-border bg-surface p-5">
                <h2 className="text-base font-semibold text-fg">Assignment</h2>

                {inquiry.status === 'NEW' ? (
                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <ArtistSelect
                      id="assignArtistId"
                      className="w-64 max-w-full"
                      artists={assignableArtistOptions}
                      value={selectedArtistId || null}
                      onChange={(artistId) => setSelectedArtistId(artistId ?? '')}
                    />
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
                    <ArtistDetailField label="Assigned artist" artist={inquiry.assignedArtist} emptyLabel="Not yet assigned" />
                    <DetailField
                      label="Assigned at"
                      value={inquiry.assignedAt ? formatDateTime(inquiry.assignedAt) : 'Not yet assigned'}
                    />
                  </div>
                )}

                {assignError && <p className="mt-3 text-sm text-danger">{assignError}</p>}

                {inquiry.declineNote && (
                  <div className="mt-5 rounded-lg border border-warning/30 bg-warning/10 p-3">
                    <p className="text-xs font-medium uppercase tracking-wider text-warning">
                      {inquiry.status === 'WAITLISTED' ? 'Note' : 'Last decline note'}
                    </p>
                    <p className="mt-1 text-sm text-warning">{inquiry.declineNote}</p>
                  </div>
                )}
              </div>

              {((!isTerminal && canMessage) ||
                inquiry.estimateSentAt ||
                inquiry.closedReason ||
                inquiry.priceEstimateLow != null ||
                inquiry.priceEstimateHigh != null ||
                inquiry.timeEstimateHoursMin != null ||
                inquiry.timeEstimateHoursMax != null) && (
                <div id="estimate-section" className="mt-6 rounded-2xl border border-border bg-surface p-5">
                  <div className="flex items-center justify-between">
                    <h2 className="text-base font-semibold text-fg">Estimate</h2>
                    {!isTerminal && canMessage && !editingEstimate && (
                      <button
                        type="button"
                        onClick={() => setEditingEstimate(true)}
                        className="flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-fg transition hover:bg-surface"
                      >
                        <PencilIcon className="h-3.5 w-3.5" />
                        Edit
                      </button>
                    )}
                  </div>

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

                  {!isTerminal && canMessage && editingEstimate && (
                    <>
                      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <label className="mb-1 block text-xs font-medium text-fg-secondary">Price low</label>
                          <CurrencyInput
                            value={estimateForm.priceEstimateLow}
                            onChange={(digits) => setEstimateForm({ ...estimateForm, priceEstimateLow: digits })}
                            className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-medium text-fg-secondary">Price high</label>
                          <CurrencyInput
                            value={estimateForm.priceEstimateHigh}
                            onChange={(digits) => setEstimateForm({ ...estimateForm, priceEstimateHigh: digits })}
                            className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-medium text-fg-secondary">Time min (hours)</label>
                          <select
                            value={estimateForm.timeEstimateHoursMin}
                            onChange={(e) => setEstimateForm({ ...estimateForm, timeEstimateHoursMin: e.target.value })}
                            className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                          >
                            <option value="">Select…</option>
                            {HOUR_OPTIONS.map((hours) => (
                              <option key={hours} value={hours}>
                                {hours} {hours === 1 ? 'hour' : 'hours'}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-medium text-fg-secondary">Time max (hours)</label>
                          <select
                            value={estimateForm.timeEstimateHoursMax}
                            onChange={(e) => setEstimateForm({ ...estimateForm, timeEstimateHoursMax: e.target.value })}
                            className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                          >
                            <option value="">Select…</option>
                            {HOUR_OPTIONS.map((hours) => (
                              <option key={hours} value={hours}>
                                {hours} {hours === 1 ? 'hour' : 'hours'}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      {sendEstimateError && <p className="mt-3 text-sm text-danger">{sendEstimateError}</p>}

                      <div className="mt-3 flex flex-wrap gap-3">
                        <button
                          type="button"
                          onClick={handleSendEstimate}
                          disabled={sendingEstimate}
                          className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-60"
                        >
                          {sendingEstimate
                            ? 'Sending…'
                            : inquiry.estimateSentAt
                              ? 'Generate & Resend Estimate'
                              : 'Generate & Send Estimate'}
                        </button>
                        {inquiry.estimateSentAt && (
                          <button
                            type="button"
                            onClick={() => setEditingEstimate(false)}
                            className="rounded-full border border-border px-4 py-2 text-sm font-semibold text-fg transition hover:bg-surface"
                          >
                            Cancel
                          </button>
                        )}
                      </div>

                      {estimateSendNotice && <p className="mt-3 text-sm text-fg-secondary">{estimateSendNotice}</p>}
                    </>
                  )}

                  {!editingEstimate &&
                    (inquiry.priceEstimateLow != null ||
                      inquiry.priceEstimateHigh != null ||
                      inquiry.timeEstimateHoursMin != null ||
                      inquiry.timeEstimateHoursMax != null) && (
                    <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
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

                  {estimateUrl && (
                    <div className="mt-4 rounded-lg border border-border p-3">
                      <p className="mb-2 text-xs text-fg-muted">
                        Share this link with the client — it expires in 7 days.
                      </p>
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          readOnly
                          value={estimateUrl}
                          onFocus={(event) => event.target.select()}
                          className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => handleCopyLink(estimateUrl)}
                          aria-label={copied ? 'Copied' : 'Copy link'}
                          title={copied ? 'Copied!' : 'Copy link'}
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-fg-secondary transition hover:bg-surface-raised hover:text-fg"
                        >
                          {copied ? <CheckIcon className="h-4 w-4 text-success" /> : <CopyIcon className="h-4 w-4" />}
                        </button>
                      </div>
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

                      {inquiry.depositForm.signatureData && (
                        <img
                          src={inquiry.depositForm.signatureData}
                          alt="Client signature"
                          className="mt-2 h-20 rounded-lg border border-border bg-white"
                        />
                      )}

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
                  ) : hasAvailableGiftCard ? (
                    // No point requesting a fresh deposit if the client
                    // already has a card that can secure the booking --
                    // attaching it moves straight to Scheduling below,
                    // same status transition mark-paid does, just without
                    // creating a new card. Still offered even if an unsigned
                    // DepositForm already exists (staff routinely send one
                    // before checking for an existing card) -- attaching
                    // discards that unsigned form server-side.
                    <div className="mt-4">
                      <p className="text-sm text-fg-secondary">
                        {clientGiftCards!.length === 1
                          ? 'This client already has an available gift card'
                          : `This client already has ${clientGiftCards!.length} available gift cards`}{' '}
                        on file — no deposit needs to be requested.
                        {inquiry.depositForm && ' Attaching it will cancel the deposit form link above.'}
                      </p>

                      {clientGiftCards!.length > 1 && (
                        <select
                          value={attachGiftCardId || clientGiftCards![0].id}
                          onChange={(e) => setAttachGiftCardId(e.target.value)}
                          className="mt-3 w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                        >
                          {clientGiftCards!.map((card) => (
                            <option key={card.id} value={card.id}>
                              {giftCardOptionLabel(card)} — {card.code.slice(0, 8)}…
                            </option>
                          ))}
                        </select>
                      )}

                      {attachGiftCardError && <p className="mt-3 text-sm text-danger">{attachGiftCardError}</p>}

                      <button
                        type="button"
                        onClick={handleAttachGiftCard}
                        disabled={attachingGiftCard}
                        className="mt-3 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-60"
                      >
                        {attachingGiftCard ? 'Attaching…' : 'Attach Gift Card'}
                      </button>
                    </div>
                  ) : (
                    <>
                      {!inquiry.depositForm && (
                        <div className="mt-4 rounded-lg border border-border p-3">
                          <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">
                            Tentative appointment time (required)
                          </p>
                          <p className="mt-1 text-xs text-fg-muted">
                            Informational only — shown to the client on the deposit page before they've paid. Not a
                            real booking; real scheduling still happens after the deposit is paid.
                          </p>

                          {suggestingTimeLoading && (
                            <p className="mt-3 text-sm text-fg-secondary">Loading suggested times…</p>
                          )}

                          {!suggestingTimeLoading && suggestedTimeCandidates.length > 0 && (
                            <div className="mt-3">
                              <p className="mb-1.5 text-xs font-medium text-fg-secondary">Suggested times</p>
                              <div className="flex flex-wrap gap-2">
                                {suggestedTimeCandidates.map((candidate) => {
                                  const parts = isoToTimeRangeParts(candidate.startTime, candidate.endTime)
                                  const isSelected =
                                    tentativeTimeRange.date === parts.date &&
                                    tentativeTimeRange.startTime === parts.startTime &&
                                    tentativeTimeRange.endTime === parts.endTime
                                  return (
                                    <button
                                      key={candidate.startTime}
                                      type="button"
                                      onClick={() => setTentativeTimeRange(parts)}
                                      className={[
                                        'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition',
                                        isSelected
                                          ? 'border-accent bg-accent/15 text-accent'
                                          : 'border-border text-fg-secondary hover:bg-surface',
                                      ].join(' ')}
                                    >
                                      {formatDateTime(candidate.startTime)} – {formatDateTime(candidate.endTime)}
                                      {candidate.hasBufferConflict && (
                                        <span className="rounded-full bg-warning/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-warning">
                                          Close
                                        </span>
                                      )}
                                    </button>
                                  )
                                })}
                              </div>
                            </div>
                          )}

                          <div className="mt-3">
                            <p className="mb-1.5 text-xs font-medium text-fg-secondary">Or pick a specific time</p>
                            <DateAndTimeRangeFields value={tentativeTimeRange} onChange={setTentativeTimeRange} />
                          </div>

                          {suggestTimeError && <p className="mt-2 text-sm text-danger">{suggestTimeError}</p>}
                        </div>
                      )}

                      {sendDepositError && <p className="mt-3 text-sm text-danger">{sendDepositError}</p>}

                      <button
                        type="button"
                        onClick={handleSendDepositForm}
                        disabled={sendingDeposit || (!inquiry.depositForm && !tentativeTimeValid)}
                        className="mt-4 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-60"
                      >
                        {sendingDeposit ? 'Sending…' : inquiry.depositForm ? 'Resend Deposit Form' : 'Send Deposit Form'}
                      </button>

                      {depositUrl && (
                        <div className="mt-4 rounded-lg border border-border p-3">
                          <p className="mb-2 text-xs text-fg-muted">
                            Share this link with the client — it expires in 48 hours.
                          </p>
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              readOnly
                              value={depositUrl}
                              onFocus={(event) => event.target.select()}
                              className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:outline-none"
                            />
                            <button
                              type="button"
                              onClick={() => handleCopyLink(depositUrl)}
                              aria-label={copied ? 'Copied' : 'Copy link'}
                              title={copied ? 'Copied!' : 'Copy link'}
                              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-fg-secondary transition hover:bg-surface-raised hover:text-fg"
                            >
                              {copied ? <CheckIcon className="h-4 w-4 text-success" /> : <CopyIcon className="h-4 w-4" />}
                            </button>
                          </div>
                        </div>
                      )}

                      {inquiry.depositForm && (
                        <div className="mt-4 rounded-lg border border-border p-3">
                          <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">Tentative time</p>
                          <p className="mt-1 text-xs text-fg-muted">
                            Informational only — shown to the client on the deposit page. Not a real booking; real
                            scheduling still happens after the deposit is paid.
                          </p>

                          {inquiry.depositForm.proposedStartAt && inquiry.depositForm.proposedEndAt ? (
                            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                              <p className="text-sm text-fg">
                                {formatDateTime(inquiry.depositForm.proposedStartAt)} –{' '}
                                {formatDateTime(inquiry.depositForm.proposedEndAt)}
                              </p>
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  onClick={handleOpenSuggestTime}
                                  className="rounded-full border border-border px-3 py-1 text-xs font-medium text-fg transition hover:bg-surface"
                                >
                                  Change
                                </button>
                                <button
                                  type="button"
                                  onClick={handleClearProposedTime}
                                  disabled={savingProposedTime}
                                  className="rounded-full border border-border px-3 py-1 text-xs font-medium text-fg-secondary transition hover:bg-surface disabled:opacity-60"
                                >
                                  Clear
                                </button>
                              </div>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={handleOpenSuggestTime}
                              className="mt-2 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-fg transition hover:bg-surface"
                            >
                              Set a tentative time
                            </button>
                          )}

                          {suggestTimeError && !showSuggestTime && (
                            <p className="mt-2 text-sm text-danger">{suggestTimeError}</p>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {(inquiry.status === 'SCHEDULING' || inquiry.status === 'WAITLISTED' || inquiry.appointment) && (
                <div id="scheduling-section" className="mt-6 rounded-2xl border border-border bg-surface p-5">
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
                      <div className="mt-4">
                        <DateAndTimeRangeFields value={scheduleTimeRange} onChange={setScheduleTimeRange} />
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
                            value={scheduleGiftCardId}
                            onChange={(e) => setScheduleGiftCardId(e.target.value)}
                            className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                          >
                            <option value="" disabled>
                              {clientGiftCards === undefined ? 'Loading…' : 'Select a gift card'}
                            </option>
                            {clientGiftCards?.map((card) => (
                              <option key={card.id} value={card.id}>
                                {giftCardOptionLabel(card)} — {card.code.slice(0, 8)}…
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
                          disabled={scheduling || !isCompleteTimeRange(scheduleTimeRange) || !scheduleGiftCardId}
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
                          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-fg-muted">
                            <ArtistAvatar artist={session.artist} className="h-4 w-4" />
                            with {artistLabel(session.artist)}
                          </p>
                        </div>
                        <StatusPill status={session.status} />
                      </Link>
                    ))}
                  </div>
                )}
              </div>

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
                      <ArtistDetailField label="Preferred artist" artist={inquiry.preferredArtist} emptyLabel="No preference" />
                    </div>
                  </>
                )}
              </div>

              <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-semibold text-fg">Notes</h2>
                  {canMessage && !editingNotes && (
                    <button
                      type="button"
                      onClick={() => setEditingNotes(true)}
                      className="flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-fg transition hover:bg-surface"
                    >
                      <PencilIcon className="h-3.5 w-3.5" />
                      Edit
                    </button>
                  )}
                </div>
                <p className="mt-1 text-xs text-fg-muted">Internal only -- never shown to the client or shared with an artist.</p>

                {canMessage && editingNotes ? (
                  <div className="mt-4">
                    <textarea
                      rows={5}
                      value={notesForm}
                      onChange={(e) => setNotesForm(e.target.value)}
                      placeholder="Add a note for the team…"
                      className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                    {notesError && <p className="mt-2 text-sm text-danger">{notesError}</p>}
                    <div className="mt-3 flex flex-wrap gap-3">
                      <button
                        type="button"
                        onClick={handleSaveNotes}
                        disabled={savingNotes || !!viewAsTarget}
                        className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-60"
                      >
                        {savingNotes ? 'Saving…' : 'Save'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setNotesForm(inquiry.notes ?? '')
                          setEditingNotes(false)
                        }}
                        className="rounded-full border border-border px-4 py-2 text-sm font-semibold text-fg transition hover:bg-surface"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="mt-4 whitespace-pre-wrap text-sm text-fg">
                    {inquiry.notes || <span className="text-fg-muted">No notes yet.</span>}
                  </p>
                )}
              </div>

              <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-semibold text-fg">Reference images</h2>
                  {!editingReferenceImages && (
                    <button
                      type="button"
                      onClick={() => setEditingReferenceImages(true)}
                      className="flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-fg transition hover:bg-surface"
                    >
                      <PencilIcon className="h-3.5 w-3.5" />
                      Edit
                    </button>
                  )}
                </div>

                {editingReferenceImages ? (
                  <div className="mt-4 space-y-4">
                    <ImageUploadSection
                      label="Reference images"
                      hint="Add, remove, or replace the images this client shared."
                      initialUrls={inquiry.referenceImages}
                      onChange={setReferenceImagesState}
                    />

                    {referenceImagesError && <p className="text-sm text-danger">{referenceImagesError}</p>}

                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={handleSaveReferenceImages}
                        disabled={savingReferenceImages || referenceImagesState.uploading}
                        className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-60"
                      >
                        {savingReferenceImages ? 'Saving…' : 'Save'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingReferenceImages(false)}
                        className="rounded-full border border-border px-4 py-2 text-sm font-semibold text-fg transition hover:bg-surface"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4">
                    <ImageGrid images={inquiry.referenceImages} />
                  </div>
                )}
              </div>

              <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-semibold text-fg">Placement photos</h2>
                  {!editingPlacementImages && (
                    <button
                      type="button"
                      onClick={() => setEditingPlacementImages(true)}
                      className="flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-fg transition hover:bg-surface"
                    >
                      <PencilIcon className="h-3.5 w-3.5" />
                      Edit
                    </button>
                  )}
                </div>

                {editingPlacementImages ? (
                  <div className="mt-4 space-y-4">
                    <ImageUploadSection
                      label="Placement photos"
                      hint="Add, remove, or replace photos of where the tattoo will go."
                      initialUrls={inquiry.placementImages}
                      onChange={setPlacementImagesState}
                    />

                    {placementImagesError && <p className="text-sm text-danger">{placementImagesError}</p>}

                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={handleSavePlacementImages}
                        disabled={savingPlacementImages || placementImagesState.uploading}
                        className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-60"
                      >
                        {savingPlacementImages ? 'Saving…' : 'Save'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingPlacementImages(false)}
                        className="rounded-full border border-border px-4 py-2 text-sm font-semibold text-fg transition hover:bg-surface"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4">
                    <ImageGrid images={inquiry.placementImages} />
                  </div>
                )}
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

                      <div>
                        <label className="mb-1 block text-xs font-medium text-fg-secondary">Message to artist</label>
                        {sharePreview ? (
                          <textarea
                            rows={7}
                            value={shareBody}
                            onChange={(e) => setShareBody(e.target.value)}
                            className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                          />
                        ) : (
                          <p className="rounded-lg border border-border p-3 text-sm text-fg-muted">
                            Loading preview…
                          </p>
                        )}
                      </div>

                      {sharePreview && sharePreview.attachments.length > 0 && (
                        <div>
                          <p className="mb-1 text-xs font-medium text-fg-secondary">Photos</p>
                          <div className="grid grid-cols-4 gap-2">
                            {sharePreview.attachments.map((url) => (
                              <img key={url} src={url} alt="" className="aspect-square rounded-lg object-cover" />
                            ))}
                          </div>
                        </div>
                      )}

                      <div>
                        <label className="mb-1 block text-xs font-medium text-fg-secondary">Send to</label>
                        <ArtistSelect
                          id="shareArtistId"
                          artists={shareArtistChoices}
                          value={shareArtistUserId || null}
                          onChange={(userId) => setShareArtistUserId(userId ?? '')}
                        />
                      </div>

                      {shareError && <p className="text-sm text-danger">{shareError}</p>}

                      <button
                        type="button"
                        onClick={handleShareToArtist}
                        disabled={!shareArtistUserId || !shareBody.trim() || sharing}
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

              {showSuggestTime && (
                <Modal title="Tentative Appointment Time" onClose={() => setShowSuggestTime(false)}>
                  <p className="text-xs text-fg-muted">
                    Informational only — shown to the client on the deposit page. No appointment is created.
                  </p>

                  {suggestingTimeLoading && <p className="mt-3 text-sm text-fg-secondary">Loading suggested times…</p>}

                  {!suggestingTimeLoading && suggestedTimeCandidates.length > 0 && (
                    <div className="mt-3">
                      <p className="mb-1.5 text-xs font-medium text-fg-secondary">Suggested times</p>
                      <div className="flex flex-wrap gap-2">
                        {suggestedTimeCandidates.map((candidate) => {
                          const parts = isoToTimeRangeParts(candidate.startTime, candidate.endTime)
                          const isSelected =
                            tentativeTimeRange.date === parts.date &&
                            tentativeTimeRange.startTime === parts.startTime &&
                            tentativeTimeRange.endTime === parts.endTime
                          return (
                            <button
                              key={candidate.startTime}
                              type="button"
                              onClick={() => setTentativeTimeRange(parts)}
                              className={[
                                'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition',
                                isSelected
                                  ? 'border-accent bg-accent/15 text-accent'
                                  : 'border-border text-fg-secondary hover:bg-surface',
                              ].join(' ')}
                            >
                              {formatDateTime(candidate.startTime)} – {formatDateTime(candidate.endTime)}
                              {candidate.hasBufferConflict && (
                                <span className="rounded-full bg-warning/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-warning">
                                  Close
                                </span>
                              )}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  <div className="mt-4">
                    <p className="mb-1.5 text-xs font-medium text-fg-secondary">Or pick a specific time</p>
                    <DateAndTimeRangeFields value={tentativeTimeRange} onChange={setTentativeTimeRange} />
                  </div>

                  {suggestTimeError && <p className="mt-3 text-sm text-danger">{suggestTimeError}</p>}

                  <button
                    type="button"
                    onClick={handleSaveProposedTime}
                    disabled={savingProposedTime || !tentativeTimeValid}
                    className="mt-4 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-60"
                  >
                    {savingProposedTime ? 'Saving…' : 'Save Tentative Time'}
                  </button>
                </Modal>
              )}

              {showDeleteModal && (
                <Modal
                  title="Delete Inquiry Permanently"
                  onClose={() => {
                    setShowDeleteModal(false)
                    setDeletePreview(null)
                    setDeletePreviewError(null)
                    setDeleteError(null)
                  }}
                >
                  <div className="space-y-4">
                    <p className="text-sm text-fg-secondary">
                      Permanently delete this inquiry for{' '}
                      <span className="font-semibold">
                        {inquiry.client.firstName} {inquiry.client.lastName}
                      </span>
                      ? This cannot be undone.
                    </p>

                    {deletePreviewLoading && (
                      <p className="text-sm text-fg-secondary">Checking what will be destroyed…</p>
                    )}
                    {deletePreviewError && <p className="text-sm text-danger">{deletePreviewError}</p>}

                    {deletePreview && (
                      <div className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm">
                        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-danger">
                          This will permanently destroy
                        </p>
                        <ul className="space-y-1 text-fg-secondary">
                          <li>{deletePreview.appointments} appointment{deletePreview.appointments === 1 ? '' : 's'}</li>
                          <li>{deletePreview.waivers} signed waiver{deletePreview.waivers === 1 ? '' : 's'}</li>
                          <li>{deletePreview.depositForms} deposit form{deletePreview.depositForms === 1 ? '' : 's'}</li>
                        </ul>
                        {deletePreview.consentFormsToDetach > 0 && (
                          <p className="mt-2 text-fg-secondary">
                            {deletePreview.consentFormsToDetach} consent form
                            {deletePreview.consentFormsToDetach === 1 ? '' : 's'} will be unlinked from the deleted
                            appointment(s), not destroyed.
                          </p>
                        )}
                        {deletePreview.giftCardsToDetach.length > 0 && (
                          <p className="mt-2 font-semibold text-danger">
                            {deletePreview.giftCardsToDetach.length} gift card
                            {deletePreview.giftCardsToDetach.length === 1 ? '' : 's'} (
                            {formatCents(
                              deletePreview.giftCardsToDetach.reduce((sum, c) => sum + c.amountCents, 0),
                            )}
                            ) will be detached and kept active — not destroyed. It's the client's money,
                            independent of this project.
                          </p>
                        )}
                      </div>
                    )}

                    {deletePreview && (
                      <div>
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

                    {deleteError && <p className="text-sm text-danger">{deleteError}</p>}

                    {deletePreview && (
                      <button
                        type="button"
                        onClick={handleConfirmDelete}
                        disabled={deleting || deleteConfirmText !== DELETE_CONFIRM_TEXT}
                        className="w-full rounded-full bg-danger px-4 py-2 text-sm font-medium text-bg transition hover:bg-danger/90 disabled:opacity-50"
                      >
                        {deleting ? 'Deleting…' : 'Delete Permanently'}
                      </button>
                    )}
                  </div>
                </Modal>
              )}

              {showAppointmentModal && (
                <Modal title="New Appointment" onClose={() => setShowAppointmentModal(false)}>
                  <p className="mb-4 text-xs text-fg-muted">
                    Booking another appointment for {inquiry.client.firstName} {inquiry.client.lastName} under this
                    project.
                  </p>
                  <AppointmentForm
                    fixedClientId={inquiry.clientId}
                    fixedInquiryId={inquiry.id}
                    onCreated={() => {
                      setShowAppointmentModal(false)
                      invalidateInquiry()
                    }}
                    onCancel={() => setShowAppointmentModal(false)}
                  />
                </Modal>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
