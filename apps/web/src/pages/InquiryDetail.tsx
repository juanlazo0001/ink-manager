import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Sidebar from '../components/Sidebar'
import AuditTrail from '../components/AuditTrail'
import NotesSection from '../components/NotesSection'
import InquiryDetailsSection from '../components/InquiryDetailsSection'
import Modal from '../components/Modal'
import StatusPill from '../components/StatusPill'
import InquiryPipeline from '../components/InquiryPipeline'
import Widget from '../components/Widget'
import ReorderableWidgetList from '../components/ReorderableWidgetList'
import AppointmentForm from '../components/AppointmentForm'
import GiftCardStackPicker, { isCardAvailable, type GiftCardOption } from '../components/GiftCardStackPicker'
import { resolveRequiredDepositCents, resolveDepositTiers, type DepositTier } from '../lib/depositTiers'
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
import SessionHoursRows, {
  SessionCountField,
  HOUR_OPTIONS,
  type LockedSession,
} from '../components/SessionBreakdownEditor'
import { apiFetch, ApiError } from '../lib/api'
import { formatDateTime, formatDuration, formatPhoneInput, formatStatus, describeInquiryStatus, formatPriceEstimate } from '../lib/format'
import { describeSendResult, type ClientSendResult } from '../lib/sendResult'
import {
  AppointmentsIcon,
  ArrowLeftIcon,
  AttachmentIcon,
  CheckIcon,
  ClientsIcon,
  ClockIcon,
  CopyIcon,
  MessageIcon,
  MoreIcon,
  PencilIcon,
  ShareIcon,
  TagIcon,
} from '../components/icons'
import { useEffectiveUser } from '../context/useEffectiveUser'
import { useViewAs } from '../context/useViewAs'
import { useConversationPanel } from '../context/useConversationPanel'
import { artistsQueryKey, inquiriesQueryKey, inquiryQueryKey } from '../lib/queryKeys'
import ImageGrid, { type ImageDetail } from '../components/ImageGrid'
import DetailField from '../components/DetailField'

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
  // Sidecar upload metadata, resolved server-side -- tracked going forward
  // only, so a url uploaded before this feature shipped has uploadedAt/
  // uploadedBy both null (rendered as "no data", never backfilled).
  referenceImagesDetail: ImageDetail[]
  placementImagesDetail: ImageDetail[]
  // Package Q: a snapshot taken at submission time (question text + type
  // baked in alongside the answer, keyed by field id) -- deliberately NOT
  // re-joined against the studio's current live IntakeFormField rows, so
  // editing or removing a question later never changes what an
  // already-submitted inquiry displays. answer is string[] for the
  // MULTI_SELECT/PHOTO_UPLOAD types Package Q (revised) added.
  customFieldAnswers: Record<string, { question: string; type: string; answer: string | string[] }> | null
  // Which of the studio's (possibly several) named forms this was
  // submitted through -- null for anything predating multiple forms, or a
  // staff-logged walk-in with no form context.
  intakeFormId: string | null
  status: string
  priceEstimateLow: number | null
  priceEstimateHigh: number | null
  timeEstimateHoursMin: number | null
  timeEstimateHoursMax: number | null
  declineNote: string | null
  createdAt: string
  assignedAt: string | null
  estimateToken: string | null
  estimateUrl: string | null
  revisionUrl: string | null
  estimateSentAt: string | null
  estimateOpenedAt: string | null
  estimateRespondedAt: string | null
  clientStatedBudget: string | null
  closedReason: string | null
  lostReason: string | null
  lostAt: string | null
  // Project pipeline timeline's final, non-derived stage -- explicitly set
  // by "Mark Project Complete", cleared by "Reopen Project". Null means
  // "not yet marked complete," never inferred from session/checkout state.
  projectCompletedAt: string | null
  projectCompletedBy: { id: string; name: string | null; email: string } | null
  estimateRevisionReason: string | null
  estimateRevisionSentAt: string | null
  estimateRevisionRespondedAt: string | null
  estimateRevisionApproved: boolean | null
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
    // Project pipeline timeline: Session Complete / Waiver Verified derive
    // from these two on whichever session is the earliest not-yet-checked-
    // out one (sessions is already startTime-ascending from the backend).
    checkedOutAt: string | null
    liabilityWaiver: { status: string } | null
    // Package N: checkout/finished-tattoo photos for this one session.
    photos: {
      id: string
      url: string
      uploadedAt: string
      uploadedBy: { id: string; name: string | null; email: string } | null
    }[]
  }[]
  // Package M: one per tattoo session, oldest first (Session 1, Session 2, ...).
  depositForms: {
    id: string
    token: string
    url: string | null
    sessionNumber: number
    depositAmount: number
    feeAmount: number
    totalCharged: number
    signedAt: string | null
    signatureName: string | null
    signatureData: string | null
    paidManually: boolean
    paidAt: string | null
    // Phase 7C: "STRIPE" | "MANUAL" once paid, null before that -- more
    // precise than paidManually alone (which stays the "is this paid"
    // flag every other consumer reads, true for both payment paths).
    paidVia: 'STRIPE' | 'MANUAL' | null
    proposedStartAt: string | null
    proposedEndAt: string | null
    giftCard: { id: string; code: string; amountCents: number; status: string } | null
  }[]
  // Multi-session planning: purely additive -- empty for every project
  // that never declared more than one session at estimate time. Ordered
  // by the staff-declared sessionNumber, not creation/generation order.
  plannedSessions: {
    id: string
    sessionNumber: number
    estimatedHoursMin: number
    estimatedHoursMax: number
    depositFormId: string | null
    appointmentId: string | null
    depositForm: { id: string; signedAt: string | null; paidAt: string | null; paidManually: boolean } | null
    appointment: { id: string; startTime: string; endTime: string; status: string; checkedOutAt: string | null } | null
  }[]
  // Service lines: which service this inquiry is for -- drives whether the
  // estimate form below collects one flat price or a low/high range, and
  // whether the deposit shows a breakdown note.
  service: {
    id: string
    name: string
    pricingModel: 'RANGE' | 'FLAT'
    depositModel: 'TIER_BASED' | 'FLAT'
    flatPriceCents: number | null
    flatDepositCents: number | null
    depositBreakdownNote: string | null
    requiresCandidacyReview: boolean
  }
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
  artistServices: { serviceId: string }[]
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

function giftCardOptionLabel(card: GiftCardOption): string {
  return card.status === 'EXEMPT' ? 'Deposit Exemption' : `$${(card.amountCents / 100).toFixed(2)}`
}

// Project pipeline timeline (post-conversion) -- lives here, not in
// InquiryPipeline.tsx alongside PIPELINE_STEPS, since unlike that 5-step
// list this one has exactly one consumer (this page's own Pipeline
// widget); the Kanban Projects tab already has its own, appointment-
// status-driven columns and never needs this shape. "Scheduled" is the
// already-complete inherited handoff from the Inquiry side's own last
// step -- see deriveProjectStageIndex below, never index 0's "current"
// state once isConverted is true and at least one session exists.
const PROJECT_STEPS = [
  { label: 'Scheduled' },
  { label: 'Waiver Verified' },
  { label: 'Session Complete' },
  { label: 'Project Complete' },
] as const

// The "current" session for Waiver Verified/Session Complete purposes --
// the earliest not-yet-checked-out appointment. `sessions` is already
// startTime-ascending from the backend (inquiries.ts's INQUIRY_INCLUDE),
// so no extra sort is needed. As sessions complete and new ones get
// booked, this naturally advances to track whichever one is next up,
// without the timeline itself ever growing a step per session.
function findCurrentSession(sessions: Inquiry['sessions']) {
  return sessions.find((session) => !session.checkedOutAt)
}

// Three of the four stages are derived live; Project Complete is NOT --
// it reflects projectCompletedAt directly. If every session is checked
// out but projectCompletedAt is still null, this sits at "Session
// Complete" (index 3 = Project Complete shown as the current, actionable
// step) until staff take the explicit Mark Project Complete action --
// never auto-inferred from session state alone.
function deriveProjectStageIndex(inquiry: Inquiry): number {
  if (inquiry.projectCompletedAt) return PROJECT_STEPS.length
  if (inquiry.sessions.length === 0) return 0
  const current = findCurrentSession(inquiry.sessions)
  if (!current) return 3
  if (current.liabilityWaiver?.status === 'VERIFIED') return 2
  return 1
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
  conversationTags: number
  // Multi-session planning: 0 for any project that never declared more
  // than one session.
  plannedSessions: number
}

const DELETE_CONFIRM_TEXT = 'DELETE'

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

// Built-in fallback order for a user who's never customized this page's
// layout (or one shipped after their last save). "assignment-section"/
// "estimate-section"/"appointments" match the ?openFlow= deep-link scroll
// targets further down -- Widget also sets these as the real HTML id, so
// that feature keeps working unchanged. The old standalone "scheduling-
// section" was merged into "appointments" (one box, not two competing
// ways to book) -- its own openFlow=schedule target now scrolls there too.
const INQUIRY_WIDGET_ORDER = [
  'pipeline',
  'candidacy-review',
  'assignment-section',
  'estimate-section',
  'deposit',
  'session-plan',
  'appointments',
  'photos',
  'reference-images',
  'placement-photos',
  'custom-fields',
  'notes',
  'activity-history',
]

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
  // Package H: same "converted to a Project" line as the backend's own
  // PROJECT_STATUSES (inquiries.ts) and the frontend's PROJECTS_TAB_STATUSES
  // (Inquiries.tsx) -- kept as a small local literal rather than importing
  // from a sibling page, since it's a stable, rarely-changing 3-value group.
  const isConverted =
    inquiry?.status === 'SCHEDULING' || inquiry?.status === 'WAITLISTED' || inquiry?.status === 'CONFIRMED'
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
  // Also invalidates this client's own gift-card list -- attaching a card
  // to a freshly-booked appointment (or issuing a new one from a paid
  // deposit) changes which of the client's cards are still available, and
  // without this, the un-planned Scheduling flow's own gift-card picker
  // (fetched separately, keyed on clientId, not this inquiry) kept
  // showing an already-attached card as selectable until the next full
  // page reload -- staff could pick it and only find out it was already
  // spoken for once the booking attempt itself got rejected.
  function invalidateInquiry() {
    queryClient.invalidateQueries({ queryKey: inquiryQueryKey(id!) })
    queryClient.invalidateQueries({ queryKey: inquiriesQueryKey(user!.studioId) })
    queryClient.invalidateQueries({ queryKey: ['client-gift-cards', inquiry?.clientId] })
  }

  const { data: artistOptions } = useQuery({
    queryKey: artistsQueryKey(user!.studioId),
    queryFn: () => apiFetch<ArtistOption[]>('/artists'),
  })
  // Assignment (a new/first assignment, only offered while status === 'NEW')
  // excludes ended guests by default, and -- service lines -- is filtered
  // to only artists tagged (via ArtistService) as offering THIS inquiry's
  // specific service, so staff can't assign, say, a tattoo-only artist to a
  // Powder Brows inquiry. "Share with Artist" below is a send-to/notify
  // action, not an assignment, so it intentionally still lists everyone --
  // staff may reasonably want to loop in a former guest or a differently-
  // tagged artist just to ask a question.
  const assignableArtistOptions = artistOptions?.filter(
    (a) => !isEndedGuest(a) && (!inquiry?.service || a.artistServices.some((s) => s.serviceId === inquiry.service.id)),
  )
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

  const { data: depositTiers } = useQuery({
    queryKey: ['studio-deposit-tiers'],
    queryFn: () => apiFetch<{ depositTiers: DepositTier[] }>('/studio-settings'),
    select: (data) => resolveDepositTiers(data.depositTiers),
  })
  const requiredDepositCents = resolveRequiredDepositCents(
    inquiry?.service,
    inquiry?.priceEstimateLow,
    inquiry?.priceEstimateHigh,
    depositTiers,
  )

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
  // Multi-session planning: 1 (the default, meaning "no plan -- use the
  // fields above") behaves with zero change from today. Only above 1 does
  // sessionHours below replace the single top-level time-estimate fields.
  const [sessionCount, setSessionCount] = useState(1)
  const [sessionHours, setSessionHours] = useState<{ min: string; max: string }[]>([{ min: '', max: '' }])

  // Resizes sessionHours to match, preserving already-entered rows --
  // dropping the count back down never loses data for the rows still in
  // range, just hides the ones beyond it.
  function handleSessionCountChange(count: number) {
    setSessionCount(count)
    setSessionHours((current) => {
      const next = [...current]
      while (next.length < count) next.push({ min: '', max: '' })
      next.length = count
      return next
    })
  }

  const [sendingEstimate, setSendingEstimate] = useState(false)
  const [sendEstimateError, setSendEstimateError] = useState<string | null>(null)
  const [estimateSendNotice, setEstimateSendNotice] = useState<string | null>(null)

  // The only sanctioned way to change a Project's (already-converted
  // inquiry's) estimate -- distinct from editingEstimate/estimateForm
  // above, which are locked out entirely once isConverted. Requires a
  // reason (unlike Mark as Lost's optional one) and never touches
  // `status`, unlike Generate & Send Estimate.
  const [showReviseEstimateModal, setShowReviseEstimateModal] = useState(false)
  const [reviseEstimateForm, setReviseEstimateForm] = useState({
    priceEstimateLow: '',
    priceEstimateHigh: '',
    timeEstimateHoursMin: '',
    timeEstimateHoursMax: '',
  })
  const [reviseReasonInput, setReviseReasonInput] = useState('')
  const [revisingEstimate, setRevisingEstimate] = useState(false)
  const [reviseEstimateError, setReviseEstimateError] = useState<string | null>(null)
  const [revisionSendNotice, setRevisionSendNotice] = useState<string | null>(null)

  // Multi-session planning: same shape/rules as sessionCount/sessionHours
  // above, just keyed to the Revise Estimate modal's own state instead --
  // prefilled from the inquiry's existing PlannedSession rows (if any) in
  // openReviseEstimateModal below, since a revision on a project that
  // already has a session plan should show that plan, not start from 1.
  const [reviseSessionCount, setReviseSessionCount] = useState(1)
  const [reviseSessionHours, setReviseSessionHours] = useState<{ min: string; max: string }[]>([{ min: '', max: '' }])

  function handleReviseSessionCountChange(count: number) {
    setReviseSessionCount(count)
    setReviseSessionHours((current) => {
      const next = [...current]
      while (next.length < count) next.push({ min: '', max: '' })
      next.length = count
      return next
    })
  }

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
  const [scheduleGiftCardIds, setScheduleGiftCardIds] = useState<string[]>([])
  const scheduleGiftCardTotalCents = (clientGiftCards ?? [])
    .filter((c) => scheduleGiftCardIds.includes(c.id))
    .reduce((sum, c) => sum + c.amountCents, 0)
  const hasSufficientScheduleGiftCards =
    scheduleGiftCardIds.length > 0 && scheduleGiftCardTotalCents >= requiredDepositCents
  const [scheduling, setScheduling] = useState(false)
  const [scheduleError, setScheduleError] = useState<string | null>(null)
  const [bufferWarning, setBufferWarning] = useState<string | null>(null)
  // Own state, not the deposit-flow's suggestedTimeCandidates above -- that
  // one is scoped to isNewDepositSession (pre-payment) and would go stale
  // by the time the inquiry actually reaches SCHEDULING.
  const [scheduleSuggestedTimes, setScheduleSuggestedTimes] = useState<SuggestedTimeCandidate[]>([])
  const [scheduleSuggestLoading, setScheduleSuggestLoading] = useState(false)

  const [showWaitlistForm, setShowWaitlistForm] = useState(false)
  const [waitlistNote, setWaitlistNote] = useState('')
  const [waitlisting, setWaitlisting] = useState(false)
  const [waitlistError, setWaitlistError] = useState<string | null>(null)

  // Package H: the missing reverse of Add to Waitlist above -- there was
  // previously no visible way to take a WAITLISTED inquiry off the
  // waitlist at all.
  const [unwaitlisting, setUnwaitlisting] = useState(false)
  const [unwaitlistError, setUnwaitlistError] = useState<string | null>(null)

  // Phase 7A: mark-as-lost / reopen. canMessage (OWNER/FRONT_DESK) is the
  // same permission level as these two actions, so it's reused directly
  // rather than defining a second identical role check.
  const [showMoreMenu, setShowMoreMenu] = useState(false)
  const [copied, setCopied] = useState(false)
  // InquiryDetailsSection decides its own visibility asynchronously (it
  // fetches this studio's live intake fields before it knows whether
  // there's anything to show) -- reported back here via onVisibilityChange
  // so the "custom-fields" Widget wrapper can be omitted entirely when
  // empty, same "hide completely" behavior as before it was wrapped.
  // Defaults true so the widget doesn't visibly flash away for the common
  // case (something to show); a genuinely-empty inquiry disappears once
  // the callback fires.
  const [showCustomFieldsWidget, setShowCustomFieldsWidget] = useState(true)
  const [showMarkLostModal, setShowMarkLostModal] = useState(false)
  const [lostReasonInput, setLostReasonInput] = useState('')
  const [markingLost, setMarkingLost] = useState(false)
  const [markLostError, setMarkLostError] = useState<string | null>(null)
  // Candidacy-review-specific labeling for the SAME mark-lost modal above --
  // set only by the "Not a Candidate" button (see handleOpenNotACandidate),
  // never by the generic "Mark as lost" entry points elsewhere on this page.
  const [markingLostAsCandidacy, setMarkingLostAsCandidacy] = useState(false)

  const [markingGoodCandidate, setMarkingGoodCandidate] = useState(false)
  const [goodCandidateError, setGoodCandidateError] = useState<string | null>(null)

  const [showReopenModal, setShowReopenModal] = useState(false)
  const [reopenStatus, setReopenStatus] = useState('')
  const [reopening, setReopening] = useState(false)
  const [reopenError, setReopenError] = useState<string | null>(null)

  // Project pipeline timeline's explicit final stage -- no modal needed for
  // either direction (unlike reopen above, which needs a target status
  // picker): complete-project/reopen-project only ever touch
  // projectCompletedAt/projectCompletedById, a single fire-and-confirm action.
  const [completingProject, setCompletingProject] = useState(false)
  const [completeProjectError, setCompleteProjectError] = useState<string | null>(null)
  const [reopeningProject, setReopeningProject] = useState(false)
  const [reopenProjectError, setReopenProjectError] = useState<string | null>(null)

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
        openFlow === 'assign' ? 'assignment-section' : openFlow === 'send-estimate' ? 'estimate-section' : 'appointments'
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
  const [depositSendNotice, setDepositSendNotice] = useState<string | null>(null)
  // Package M: several deposit forms can exist per inquiry now, so "which
  // one is being marked paid" needs its own id rather than one shared flag.
  const [markingPaidId, setMarkingPaidId] = useState<string | null>(null)
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

  // Multi-session planning: the Session Plan widget's own "Send Deposit
  // Form" mini-form (per planned session) needs its OWN suggested-times
  // fetch, sized off THAT session's estimatedHoursMin/Max -- not the
  // un-planned flow's inquiry.timeEstimateHoursMin/Max above, which are
  // null for any project using a session plan. Kept as separate state
  // (rather than reusing suggestedTimeCandidates) since the two pickers,
  // while never both actionable at once, are independent contexts.
  const [plannedSessionSuggestedTimes, setPlannedSessionSuggestedTimes] = useState<SuggestedTimeCandidate[]>([])
  const [plannedSessionSuggestLoading, setPlannedSessionSuggestLoading] = useState(false)
  const [plannedSessionSuggestError, setPlannedSessionSuggestError] = useState<string | null>(null)
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
  // booking an additional session under a project already underway. Null
  // means closed; a value both opens the modal and pre-selects
  // AppointmentForm's own type toggle -- "Schedule Consultation" is a
  // second, dedicated entry point onto the exact same modal/form, not a
  // second implementation. Deliberately lives in this same always-rendered
  // Appointments widget (never gated by inquiry.status) rather than the
  // status-gated Scheduling widget above, matching the task's own
  // "available regardless of pipeline status" requirement for real.
  const [appointmentModalType, setAppointmentModalType] = useState<'TATTOO_SESSION' | 'CONSULTATION' | null>(null)

  // Multi-session planning: opens the exact same "New Appointment" modal
  // above, pre-selected to a specific planned session -- the Session Plan
  // widget's own "Book Appointment" action per row, below.
  const [bookingPlannedSessionId, setBookingPlannedSessionId] = useState<string | null>(null)

  // Multi-session planning: which planned session's "generate a deposit
  // form" mini-form is currently expanded in the Session Plan widget --
  // reuses the same shared tentativeTimeRange state as the un-planned
  // deposit flow above, one row open at a time.
  const [depositTargetPlannedSessionId, setDepositTargetPlannedSessionId] = useState<string | null>(null)

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
    setEditingEstimate(!inquiry.estimateSentAt && !!inquiry.assignedArtist)
    setDetailsForm({
      description: inquiry.description,
      colorOrBlackGrey: inquiry.colorOrBlackGrey,
      placement: inquiry.placement,
      estimatedSize: inquiry.estimatedSize,
      budget: inquiry.budget ?? '',
      desiredTiming: inquiry.desiredTiming ?? '',
    })
  }

  // Service lines: a FLAT-pricing service (e.g. Powder Brows) collects one
  // flat price instead of a low/high range -- the entire existing estimate
  // send/track/respond flow is reused completely unchanged underneath;
  // only this input collapses to one field, which sets BOTH
  // priceEstimateLow and priceEstimateHigh to the same value (see the two
  // onChange handlers below), so every downstream consumer of those two
  // fields (validation, the deposit-tier average, display formatting via
  // formatPriceEstimate) keeps working with zero branching of its own.
  const isFlatPricing = inquiry?.service.pricingModel === 'FLAT'

  // Multi-session planning: sessionCount 1 (the default) is today's
  // behavior with zero change -- the single top-level time-estimate
  // fields are what's required/sent. Only above 1 does the per-session
  // sessionHours breakdown replace them entirely (see the backend's own
  // identical branch in POST /:id/send-estimate).
  const isMultiSession = sessionCount > 1

  // Mirrors the backend's own validation, so staff get instant feedback
  // instead of a round trip for something obviously incomplete.
  const effectiveEstimate = {
    priceEstimateLow: estimateForm.priceEstimateLow ? Number(estimateForm.priceEstimateLow) : inquiry?.priceEstimateLow,
    priceEstimateHigh: estimateForm.priceEstimateHigh
      ? Number(estimateForm.priceEstimateHigh)
      : inquiry?.priceEstimateHigh,
    ...(isMultiSession
      ? {}
      : {
          timeEstimateHoursMin: estimateForm.timeEstimateHoursMin
            ? Number(estimateForm.timeEstimateHoursMin)
            : inquiry?.timeEstimateHoursMin,
          timeEstimateHoursMax: estimateForm.timeEstimateHoursMax
            ? Number(estimateForm.timeEstimateHoursMax)
            : inquiry?.timeEstimateHoursMax,
        }),
  }

  const estimateValidationError = (() => {
    const values = Object.values(effectiveEstimate)
    if (values.some((v) => v == null)) return 'Price and time ranges are required before sending an estimate.'
    if (values.some((v) => v! <= 0)) return 'All range values must be positive.'
    if (effectiveEstimate.priceEstimateLow! > effectiveEstimate.priceEstimateHigh!) {
      return 'Price low must be less than or equal to price high.'
    }
    if (isMultiSession) {
      for (let i = 0; i < sessionCount; i++) {
        const row = sessionHours[i]
        if (!row || !row.min || !row.max) return `Session ${i + 1} needs an hour range.`
        if (Number(row.min) <= 0 || Number(row.max) <= 0) return 'All session hour ranges must be positive.'
        if (Number(row.min) > Number(row.max)) {
          return `Session ${i + 1}'s minimum hours must be less than or equal to its maximum.`
        }
      }
    } else if (effectiveEstimate.timeEstimateHoursMin! > effectiveEstimate.timeEstimateHoursMax!) {
      return 'Minimum hours must be less than or equal to maximum hours.'
    }
    return null
  })()

  // Multi-session planning, revision side: a session already backed by a
  // paid deposit or a booked appointment can't be silently altered or
  // dropped by a revision -- real money or a real booking already depends
  // on its hour range. Everything else about the plan (unpaid/unbooked
  // sessions, or the whole plan on a project that never had one) stays
  // freely editable, same as the original pre-conversion flow.
  const reviseLockedSessions: LockedSession[] = (inquiry?.plannedSessions ?? [])
    .filter((ps) => ps.depositForm?.paidAt != null || ps.appointment != null)
    .map((ps) => ({
      sessionNumber: ps.sessionNumber,
      estimatedHoursMin: ps.estimatedHoursMin,
      estimatedHoursMax: ps.estimatedHoursMax,
      reason: ps.appointment != null ? 'appointment booked' : 'deposit paid',
    }))

  const isReviseMultiSession = reviseSessionCount > 1

  // Same shape as effectiveEstimate/estimateValidationError above, keyed to
  // the separate Revise Estimate modal's own form state instead.
  const effectiveRevisedEstimate = {
    priceEstimateLow: reviseEstimateForm.priceEstimateLow
      ? Number(reviseEstimateForm.priceEstimateLow)
      : inquiry?.priceEstimateLow,
    priceEstimateHigh: reviseEstimateForm.priceEstimateHigh
      ? Number(reviseEstimateForm.priceEstimateHigh)
      : inquiry?.priceEstimateHigh,
    ...(isReviseMultiSession
      ? {}
      : {
          timeEstimateHoursMin: reviseEstimateForm.timeEstimateHoursMin
            ? Number(reviseEstimateForm.timeEstimateHoursMin)
            : inquiry?.timeEstimateHoursMin,
          timeEstimateHoursMax: reviseEstimateForm.timeEstimateHoursMax
            ? Number(reviseEstimateForm.timeEstimateHoursMax)
            : inquiry?.timeEstimateHoursMax,
        }),
  }

  const reviseEstimateValidationError = (() => {
    if (reviseReasonInput.trim().length === 0) return 'A reason is required to revise the estimate.'
    const values = Object.values(effectiveRevisedEstimate)
    if (values.some((v) => v == null)) return 'Price and time ranges are required.'
    if (values.some((v) => v! <= 0)) return 'All range values must be positive.'
    if (effectiveRevisedEstimate.priceEstimateLow! > effectiveRevisedEstimate.priceEstimateHigh!) {
      return 'Price low must be less than or equal to price high.'
    }
    if (isReviseMultiSession) {
      for (let i = 0; i < reviseSessionCount; i++) {
        const sessionNumber = i + 1
        if (reviseLockedSessions.some((s) => s.sessionNumber === sessionNumber)) continue
        const row = reviseSessionHours[i]
        if (!row || !row.min || !row.max) return `Session ${sessionNumber} needs an hour range.`
        if (Number(row.min) <= 0 || Number(row.max) <= 0) return 'All session hour ranges must be positive.'
        if (Number(row.min) > Number(row.max)) {
          return `Session ${sessionNumber}'s minimum hours must be less than or equal to its maximum.`
        }
      }
    } else if (effectiveRevisedEstimate.timeEstimateHoursMin! > effectiveRevisedEstimate.timeEstimateHoursMax!) {
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
          timeEstimateHoursMin: isMultiSession
            ? undefined
            : estimateForm.timeEstimateHoursMin
              ? Number(estimateForm.timeEstimateHoursMin)
              : undefined,
          timeEstimateHoursMax: isMultiSession
            ? undefined
            : estimateForm.timeEstimateHoursMax
              ? Number(estimateForm.timeEstimateHoursMax)
              : undefined,
          sessions: isMultiSession
            ? sessionHours.map((row) => ({ estimatedHoursMin: Number(row.min), estimatedHoursMax: Number(row.max) }))
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

  function openReviseEstimateModal() {
    if (!inquiry) return
    setReviseEstimateForm({
      priceEstimateLow: inquiry.priceEstimateLow?.toString() ?? '',
      priceEstimateHigh: inquiry.priceEstimateHigh?.toString() ?? '',
      timeEstimateHoursMin: inquiry.timeEstimateHoursMin?.toString() ?? '',
      timeEstimateHoursMax: inquiry.timeEstimateHoursMax?.toString() ?? '',
    })
    // Prefill from the project's existing session plan, if it has one --
    // a revision on a multi-session project should show that plan ready to
    // edit, not silently reset it back down to 1.
    if (inquiry.plannedSessions.length > 0) {
      setReviseSessionCount(inquiry.plannedSessions.length)
      setReviseSessionHours(
        inquiry.plannedSessions.map((ps) => ({
          min: ps.estimatedHoursMin.toString(),
          max: ps.estimatedHoursMax.toString(),
        })),
      )
    } else {
      setReviseSessionCount(1)
      setReviseSessionHours([{ min: '', max: '' }])
    }
    setReviseReasonInput('')
    setReviseEstimateError(null)
    setShowReviseEstimateModal(true)
  }

  async function handleReviseEstimate() {
    if (!id) return

    if (reviseEstimateValidationError) {
      setReviseEstimateError(reviseEstimateValidationError)
      return
    }

    setRevisingEstimate(true)
    setReviseEstimateError(null)

    try {
      const result = await apiFetch<{
        revisionSendResult:
          | { sent: true }
          | { sent: false; reason: 'not_connected' | 'no_phone' | 'opted_out' | 'send_failed'; error?: string }
      }>(`/inquiries/${id}/revise-estimate`, {
        method: 'POST',
        body: JSON.stringify({
          priceEstimateLow: reviseEstimateForm.priceEstimateLow ? Number(reviseEstimateForm.priceEstimateLow) : undefined,
          priceEstimateHigh: reviseEstimateForm.priceEstimateHigh
            ? Number(reviseEstimateForm.priceEstimateHigh)
            : undefined,
          timeEstimateHoursMin: isReviseMultiSession
            ? undefined
            : reviseEstimateForm.timeEstimateHoursMin
              ? Number(reviseEstimateForm.timeEstimateHoursMin)
              : undefined,
          timeEstimateHoursMax: isReviseMultiSession
            ? undefined
            : reviseEstimateForm.timeEstimateHoursMax
              ? Number(reviseEstimateForm.timeEstimateHoursMax)
              : undefined,
          sessions: isReviseMultiSession
            ? reviseSessionHours
                .slice(0, reviseSessionCount)
                .map((row, index) => {
                  const sessionNumber = index + 1
                  const locked = reviseLockedSessions.find((s) => s.sessionNumber === sessionNumber)
                  return locked
                    ? { estimatedHoursMin: locked.estimatedHoursMin, estimatedHoursMax: locked.estimatedHoursMax }
                    : { estimatedHoursMin: Number(row.min), estimatedHoursMax: Number(row.max) }
                })
            : // Only explicitly collapse the plan back to an empty array when
              // one currently exists (locked sessions, if any, are preserved
              // server-side regardless) -- an ordinary project that never
              // had a plan shouldn't send a `sessions` field at all.
              (inquiry?.plannedSessions.length ?? 0) > 0
              ? []
              : undefined,
          reason: reviseReasonInput.trim(),
        }),
      })

      setRevisionSendNotice(describeEstimateSendResult(result.revisionSendResult))
      setShowReviseEstimateModal(false)
      invalidateInquiry()
    } catch (err) {
      setReviseEstimateError(err instanceof Error ? err.message : 'Failed to revise estimate')
    } finally {
      setRevisingEstimate(false)
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
    if (!id || !hasSufficientScheduleGiftCards || !isCompleteTimeRange(scheduleTimeRange)) return
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
          giftCardIds: scheduleGiftCardIds,
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

  async function handleUnwaitlist() {
    if (!id) return

    setUnwaitlisting(true)
    setUnwaitlistError(null)

    try {
      await apiFetch(`/inquiries/${id}/unwaitlist`, { method: 'POST' })
      invalidateInquiry()
    } catch (err) {
      setUnwaitlistError(err instanceof Error ? err.message : 'Failed to remove from waitlist')
    } finally {
      setUnwaitlisting(false)
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
      setMarkingLostAsCandidacy(false)
      invalidateInquiry()
    } catch (err) {
      setMarkLostError(err instanceof Error ? err.message : 'Failed to mark inquiry lost')
    } finally {
      setMarkingLost(false)
    }
  }

  // "Not a Candidate" -- opens the SAME mark-lost modal/route as every other
  // "Mark as lost" entry point on this page (see handleMarkLost above), just
  // pre-filled with this reason and a candidacy-specific title, per this
  // feature's own "no second terminal-state system" requirement.
  function handleOpenNotACandidate() {
    setLostReasonInput('Not a candidate')
    setMarkLostError(null)
    setMarkingLostAsCandidacy(true)
    setShowMarkLostModal(true)
  }

  async function handleMarkGoodCandidate() {
    if (!id) return

    setMarkingGoodCandidate(true)
    setGoodCandidateError(null)

    try {
      await apiFetch(`/inquiries/${id}/mark-good-candidate`, { method: 'POST' })
      invalidateInquiry()
    } catch (err) {
      setGoodCandidateError(err instanceof Error ? err.message : 'Failed to mark as a good candidate')
    } finally {
      setMarkingGoodCandidate(false)
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

  async function handleCompleteProject() {
    if (!id) return

    setCompletingProject(true)
    setCompleteProjectError(null)

    try {
      await apiFetch(`/inquiries/${id}/complete-project`, { method: 'POST' })
      invalidateInquiry()
    } catch (err) {
      setCompleteProjectError(err instanceof Error ? err.message : 'Failed to mark this project complete')
    } finally {
      setCompletingProject(false)
    }
  }

  async function handleReopenProject() {
    if (!id) return

    setReopeningProject(true)
    setReopenProjectError(null)

    try {
      await apiFetch(`/inquiries/${id}/reopen-project`, { method: 'POST' })
      invalidateInquiry()
    } catch (err) {
      setReopenProjectError(err instanceof Error ? err.message : 'Failed to reopen this project')
    } finally {
      setReopeningProject(false)
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

  // Package M: one project can carry several deposit forms (one per tattoo
  // session) -- oldest first from the API, so the last element is always
  // the most recently generated one. A new session is only ever eligible
  // to be created (rather than the current one resent) once that latest
  // session is missing entirely or already signed -- mirrors the backend
  // route's own isNewSession check exactly.
  const depositForms = inquiry?.depositForms ?? []
  const latestDepositForm = depositForms.length > 0 ? depositForms[depositForms.length - 1] : null
  const isNewDepositSession = !latestDepositForm || latestDepositForm.signedAt != null

  // plannedSessionId (multi-session planning): when provided, THAT
  // specific planned session decides whether this is a fresh generation
  // or a resend, mirroring the backend route's own identical branch --
  // never the global "latest deposit form across the whole inquiry"
  // check below, which stays exactly as it was for the un-planned case
  // (plannedSessionId omitted, every existing call site unchanged).
  async function handleSendDepositForm(plannedSessionId?: string) {
    if (!id) return

    const targetPlannedSession = plannedSessionId
      ? (inquiry?.plannedSessions ?? []).find((ps) => ps.id === plannedSessionId)
      : null
    const isNewSessionForTarget = plannedSessionId ? !targetPlannedSession?.depositFormId : isNewDepositSession

    // Required whenever this would create a fresh session -- resending the
    // current unsigned session (token rotation on an existing, unsigned
    // form) doesn't touch the tentative time at all, see the API route's
    // own comment.
    if (isNewSessionForTarget && !tentativeTimeValid) return

    setSendingDeposit(true)
    setSendDepositError(null)
    setDepositSendNotice(null)

    try {
      const proposedTime = isNewSessionForTarget
        ? {
            proposedStartAt: combineDateAndTime(tentativeTimeRange.date, tentativeTimeRange.startTime)!.toISOString(),
            proposedEndAt: combineDateAndTime(tentativeTimeRange.date, tentativeTimeRange.endTime)!.toISOString(),
          }
        : {}
      const result = await apiFetch<{ depositSendResult: ClientSendResult | null }>(`/inquiries/${id}/deposit-form`, {
        method: 'POST',
        body: JSON.stringify({ ...proposedTime, plannedSessionId }),
      })
      setDepositSendNotice(describeSendResult('Deposit form', result.depositSendResult))
      setDepositTargetPlannedSessionId(null)
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
  // to search with and a new session is actually eligible to be created --
  // staff shouldn't need an extra click just to see them, since picking one
  // (or entering a time by hand) is required before a fresh deposit form
  // can be generated at all.
  useEffect(() => {
    if (!isNewDepositSession) return
    if (!inquiry?.assignedArtist || inquiry.timeEstimateHoursMin == null || inquiry.timeEstimateHoursMax == null) return
    fetchSuggestedTimes()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    inquiry?.id,
    isNewDepositSession,
    inquiry?.assignedArtist?.id,
    inquiry?.timeEstimateHoursMin,
    inquiry?.timeEstimateHoursMax,
  ])

  // Multi-session planning: fires whenever staff opens the Session Plan
  // widget's "Send Deposit Form" mini-form for a specific planned session
  // -- sized off that session's OWN hour estimate, the fix for "Suggest a
  // time" having gone quiet on multi-session projects (their top-level
  // timeEstimateHoursMin/Max are null once a plan exists; see the
  // useEffect above, which only ever reads those).
  useEffect(() => {
    if (!depositTargetPlannedSessionId) return
    const targetSession = (inquiry?.plannedSessions ?? []).find((ps) => ps.id === depositTargetPlannedSessionId)
    if (!inquiry?.assignedArtist || !targetSession) {
      setPlannedSessionSuggestedTimes([])
      return
    }

    let ignore = false
    setPlannedSessionSuggestError(null)
    setPlannedSessionSuggestLoading(true)
    setPlannedSessionSuggestedTimes([])
    const durationMinutes = Math.round(((targetSession.estimatedHoursMin + targetSession.estimatedHoursMax) / 2) * 60)

    apiFetch<SuggestedTimeCandidate[]>(
      `/scheduling/suggested-times?artistId=${inquiry.assignedArtist.id}&durationMinutes=${durationMinutes}`,
    )
      .then((candidates) => {
        if (!ignore) setPlannedSessionSuggestedTimes(candidates)
      })
      .catch((err) => {
        if (!ignore) setPlannedSessionSuggestError(err instanceof Error ? err.message : 'Failed to load suggestions')
      })
      .finally(() => {
        if (!ignore) setPlannedSessionSuggestLoading(false)
      })

    return () => {
      ignore = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depositTargetPlannedSessionId, inquiry?.assignedArtist?.id])

  // Scheduling section: the same getSuggestedTimes source AppointmentForm.tsx
  // uses for a brand-new appointment -- this inquiry already has an assigned
  // artist and time estimate by the time it reaches SCHEDULING, so there's
  // no reason the widget that actually books the session shouldn't offer
  // the same suggestions.
  useEffect(() => {
    if (inquiry?.status !== 'SCHEDULING' || inquiry.appointment) return
    if (!inquiry.assignedArtist || inquiry.timeEstimateHoursMin == null || inquiry.timeEstimateHoursMax == null) {
      setScheduleSuggestedTimes([])
      return
    }

    let ignore = false
    setScheduleSuggestLoading(true)
    const durationMinutes = Math.round(((inquiry.timeEstimateHoursMin + inquiry.timeEstimateHoursMax) / 2) * 60)

    apiFetch<SuggestedTimeCandidate[]>(
      `/scheduling/suggested-times?artistId=${inquiry.assignedArtist.id}&durationMinutes=${durationMinutes}`,
    )
      .then((candidates) => {
        if (!ignore) setScheduleSuggestedTimes(candidates)
      })
      .catch(() => {
        if (!ignore) setScheduleSuggestedTimes([])
      })
      .finally(() => {
        if (!ignore) setScheduleSuggestLoading(false)
      })

    return () => {
      ignore = true
    }
  }, [
    inquiry?.id,
    inquiry?.status,
    inquiry?.appointment,
    inquiry?.assignedArtist?.id,
    inquiry?.timeEstimateHoursMin,
    inquiry?.timeEstimateHoursMax,
  ])

  function handleOpenSuggestTime() {
    // Seed the shared fields from whatever's already set on the current
    // unsigned session (editing an existing tentative time), or blank
    // (never had one, previously cleared, or this is a brand new session)
    // -- either way the modal always offers both the suggested list and
    // manual entry.
    setTentativeTimeRange(
      latestDepositForm?.proposedStartAt && latestDepositForm?.proposedEndAt && !isNewDepositSession
        ? isoToTimeRangeParts(latestDepositForm.proposedStartAt, latestDepositForm.proposedEndAt)
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

  async function handleMarkPaid(depositFormId: string) {
    setMarkingPaidId(depositFormId)
    setMarkPaidError(null)

    try {
      await apiFetch(`/deposit-forms/${depositFormId}/mark-paid`, { method: 'PATCH' })
      invalidateInquiry()
    } catch (err) {
      setMarkPaidError(err instanceof Error ? err.message : 'Failed to mark deposit as paid')
    } finally {
      setMarkingPaidId(null)
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

  // Both already the API's own shortLinks.shortenUrl output -- the same
  // short code the client's text-receipt SMS and shareable-links composer
  // already send them, not a full-length URL reconstructed from the raw
  // token client-side.
  const estimateUrl = inquiry?.estimateUrl ?? null
  const revisionUrl = inquiry?.revisionUrl ?? null
  // Only ever the current unsigned session's link -- a signed session has
  // nothing left to share.
  const depositUrl = latestDepositForm && !latestDepositForm.signedAt ? latestDepositForm.url : null

  return (
    <div className="flex min-h-screen bg-bg text-fg">
      <Sidebar />

      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-6 py-6 sm:px-10 sm:py-8">
          <Link
            to={isConverted ? '/inquiries?tab=projects' : '/inquiries'}
            className="inline-flex items-center gap-2 text-sm text-fg-secondary hover:text-fg"
          >
            <ArrowLeftIcon className="h-4 w-4" />
            Back to {isConverted ? 'Projects' : 'Inquiries'}
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
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border text-fg transition hover:bg-surface md:h-auto md:w-auto md:gap-2 md:px-4 md:py-2"
                    >
                      <ClientsIcon className="h-4 w-4" />
                      <span className="hidden text-sm font-semibold md:inline">View Client</span>
                    </button>
                    {canMessage && (
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
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border text-fg transition hover:bg-surface md:h-auto md:w-auto md:gap-2 md:px-4 md:py-2"
                      >
                        <ShareIcon className="h-4 w-4" />
                        <span className="hidden text-sm font-semibold md:inline">Share with Artist</span>
                      </button>
                    )}
                    <StatusPill status={inquiry.status} label={describeInquiryStatus(inquiry)} />
                    {(canMessage || isOwner) && (
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => setShowMoreMenu((v) => !v)}
                          aria-label="More actions"
                          aria-pressed={showMoreMenu}
                          title="More actions"
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-fg-muted transition hover:bg-surface hover:text-fg"
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

              <ReorderableWidgetList pageKey="inquiry-detail" defaultOrder={INQUIRY_WIDGET_ORDER}>
              <Widget key="pipeline" id="pipeline" title="Pipeline">
                {isConverted ? (
                  <>
                    <InquiryPipeline
                      status={inquiry.status}
                      orientation="horizontal"
                      hideLabel
                      steps={PROJECT_STEPS}
                      activeIndex={deriveProjectStageIndex(inquiry)}
                    />
                    {inquiry.sessions.length > 1 && (
                      <p className="mt-2 text-center text-xs text-fg-muted md:text-left">
                        Session {(() => {
                          const current = findCurrentSession(inquiry.sessions)
                          return current ? inquiry.sessions.indexOf(current) + 1 : inquiry.sessions.length
                        })()} of {inquiry.sessions.length}
                      </p>
                    )}

                    {inquiry.projectCompletedAt ? (
                      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface-inset px-4 py-3">
                        <div>
                          <p className="text-sm font-medium text-fg-secondary">
                            Project complete — {formatDateTime(inquiry.projectCompletedAt)}
                            {inquiry.projectCompletedBy &&
                              ` by ${inquiry.projectCompletedBy.name || inquiry.projectCompletedBy.email}`}
                          </p>
                          {reopenProjectError && <p className="mt-1 text-sm text-danger">{reopenProjectError}</p>}
                        </div>
                        {canMessage && (
                          <button
                            type="button"
                            onClick={handleReopenProject}
                            disabled={reopeningProject}
                            className="shrink-0 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-fg transition hover:bg-surface disabled:opacity-60"
                          >
                            {reopeningProject ? 'Reopening…' : 'Reopen Project'}
                          </button>
                        )}
                      </div>
                    ) : (
                      canMessage && (
                        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                          {completeProjectError && <p className="text-sm text-danger">{completeProjectError}</p>}
                          <button
                            type="button"
                            onClick={handleCompleteProject}
                            disabled={completingProject}
                            className="ml-auto shrink-0 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-fg transition hover:bg-surface disabled:opacity-60"
                          >
                            {completingProject ? 'Marking complete…' : 'Mark Project Complete'}
                          </button>
                        </div>
                      )
                    )}
                  </>
                ) : (
                  <InquiryPipeline
                    status={inquiry.status}
                    closedReason={inquiry.closedReason}
                    orientation="horizontal"
                    hideLabel
                  />
                )}
              </Widget>

              {inquiry.status === 'CANDIDACY_REVIEW' && (
                <Widget key="candidacy-review" id="candidacy-review" title="Candidacy Review">
                  <p className="mt-1 text-sm text-fg-secondary">
                    {inquiry.service.name} requires a candidacy review before pricing. Review the submitted photos
                    below, then choose one of the three options.
                  </p>

                  {canMessage && (
                    <div className="mt-4 flex flex-wrap gap-3">
                      <button
                        type="button"
                        onClick={handleMarkGoodCandidate}
                        disabled={markingGoodCandidate}
                        className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-60"
                      >
                        {markingGoodCandidate ? 'Saving…' : 'Mark Good Candidate'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setAppointmentModalType('CONSULTATION')}
                        className="rounded-full border border-border px-4 py-2 text-sm font-semibold text-fg transition hover:bg-surface"
                      >
                        Schedule Consultation
                      </button>
                      <button
                        type="button"
                        onClick={handleOpenNotACandidate}
                        className="rounded-full border border-danger/40 px-4 py-2 text-sm font-medium text-danger transition hover:bg-danger/10"
                      >
                        Not a Candidate
                      </button>
                    </div>
                  )}

                  {goodCandidateError && <p className="mt-3 text-sm text-danger">{goodCandidateError}</p>}
                </Widget>
              )}

              <Widget key="assignment-section" id="assignment-section" title="Assignment">

                {inquiry.status === 'NEW' || (!inquiry.assignedArtist && !isTerminal) ? (
                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    {/* A never-assigned inquiry can reach this state past NEW
                        (send-estimate never requires one) -- a deposit can't
                        be requested without an artist, so this stays
                        available here too, not just at NEW. Doesn't touch
                        status (see the backend's own isFirstAssignment
                        branch), unlike the original NEW -> ARTIST_ASSIGNED
                        path. */}
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
              </Widget>

              {((!isTerminal && canMessage) ||
                inquiry.estimateSentAt ||
                inquiry.closedReason ||
                inquiry.priceEstimateLow != null ||
                inquiry.priceEstimateHigh != null ||
                inquiry.timeEstimateHoursMin != null ||
                inquiry.timeEstimateHoursMax != null) && (
                <Widget
                  key="estimate-section"
                  id="estimate-section"
                  title="Estimate"
                  actions={
                    !isTerminal && !isConverted && canMessage && inquiry.assignedArtist && !editingEstimate ? (
                      <button
                        type="button"
                        onClick={() => setEditingEstimate(true)}
                        aria-label="Edit Estimate"
                        title="Edit Estimate"
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border text-fg transition hover:bg-surface md:h-auto md:w-auto md:gap-2 md:px-4 md:py-2"
                      >
                        <PencilIcon className="h-4 w-4" />
                        <span className="hidden text-sm font-semibold md:inline">Edit</span>
                      </button>
                    ) : isConverted && canMessage ? (
                      <button
                        type="button"
                        onClick={openReviseEstimateModal}
                        aria-label="Revise Estimate"
                        title="Revise Estimate"
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border text-fg transition hover:bg-surface md:h-auto md:w-auto md:gap-2 md:px-4 md:py-2"
                      >
                        <PencilIcon className="h-4 w-4" />
                        <span className="hidden text-sm font-semibold md:inline">Revise Estimate</span>
                      </button>
                    ) : null
                  }
                >
                  {isConverted && (
                    <>
                      <p className="mt-1 text-xs text-fg-muted">
                        Locked -- this inquiry has converted to a Project (deposit paid). Use "Revise Estimate" above
                        to change it; that requires a reason and re-sends the new estimate to the client for
                        approval.
                      </p>

                      {inquiry.estimateRevisionReason && (
                        <div
                          className={`mt-4 rounded-lg border p-3 ${
                            inquiry.estimateRevisionRespondedAt == null
                              ? 'border-warning/30 bg-warning/10'
                              : inquiry.estimateRevisionApproved
                                ? 'border-success/30 bg-success/10'
                                : 'border-danger/30 bg-danger/10'
                          }`}
                        >
                          <p
                            className={`text-xs font-medium uppercase tracking-wider ${
                              inquiry.estimateRevisionRespondedAt == null
                                ? 'text-warning'
                                : inquiry.estimateRevisionApproved
                                  ? 'text-success'
                                  : 'text-danger'
                            }`}
                          >
                            {inquiry.estimateRevisionRespondedAt == null
                              ? `Awaiting client approval of a revised estimate (sent ${formatDateTime(inquiry.estimateRevisionSentAt!)})`
                              : inquiry.estimateRevisionApproved
                                ? `Client approved the revised estimate on ${formatDateTime(inquiry.estimateRevisionRespondedAt)}`
                                : `Client flagged a concern about the revised estimate on ${formatDateTime(inquiry.estimateRevisionRespondedAt)} -- follow up with them`}
                          </p>
                          <p
                            className={`mt-1 text-sm ${
                              inquiry.estimateRevisionRespondedAt == null
                                ? 'text-warning'
                                : inquiry.estimateRevisionApproved
                                  ? 'text-success'
                                  : 'text-danger'
                            }`}
                          >
                            Reason: {inquiry.estimateRevisionReason}
                          </p>
                        </div>
                      )}

                      {revisionSendNotice && <p className="mt-3 text-sm text-fg-secondary">{revisionSendNotice}</p>}

                      {revisionUrl && (
                        <div className="mt-4 rounded-lg border border-border p-3">
                          <p className="mb-2 text-xs text-fg-muted">
                            Share this link with the client — it expires in 7 days.
                          </p>
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              readOnly
                              value={revisionUrl}
                              onFocus={(event) => event.target.select()}
                              className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:outline-none"
                            />
                            <button
                              type="button"
                              onClick={() => handleCopyLink(revisionUrl)}
                              aria-label={copied ? 'Copied' : 'Copy link'}
                              title={copied ? 'Copied!' : 'Copy link'}
                              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-fg-secondary transition hover:bg-surface-raised hover:text-fg"
                            >
                              {copied ? <CheckIcon className="h-4 w-4 text-success" /> : <CopyIcon className="h-4 w-4" />}
                            </button>
                          </div>
                        </div>
                      )}
                    </>
                  )}

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

                  {!isTerminal && !isConverted && canMessage && !inquiry.assignedArtist && (
                    <p className="mt-4 text-sm text-fg-muted">Assign an artist before entering an estimate.</p>
                  )}

                  {!isTerminal && !isConverted && canMessage && editingEstimate && (
                    <>
                      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {isFlatPricing ? (
                          <div className="sm:col-span-2">
                            <label className="mb-1 block text-xs font-medium text-fg-secondary">Price</label>
                            <CurrencyInput
                              value={estimateForm.priceEstimateLow}
                              onChange={(digits) =>
                                setEstimateForm({ ...estimateForm, priceEstimateLow: digits, priceEstimateHigh: digits })
                              }
                              className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                            />
                          </div>
                        ) : (
                          <>
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
                          </>
                        )}
                        <SessionCountField sessionCount={sessionCount} onSessionCountChange={handleSessionCountChange} />
                        {!isMultiSession && (
                          <>
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
                          </>
                        )}
                      </div>

                      <SessionHoursRows
                        sessionCount={sessionCount}
                        sessionHours={sessionHours}
                        onSessionHoursChange={setSessionHours}
                      />

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
                      {isFlatPricing ? (
                        <DetailField
                          label="Price estimate"
                          value={formatPriceEstimate(inquiry.priceEstimateLow, inquiry.priceEstimateHigh) ?? 'Not provided'}
                        />
                      ) : (
                        <>
                          <DetailField
                            label="Price estimate low"
                            value={inquiry.priceEstimateLow != null ? `$${inquiry.priceEstimateLow}` : 'Not provided'}
                          />
                          <DetailField
                            label="Price estimate high"
                            value={inquiry.priceEstimateHigh != null ? `$${inquiry.priceEstimateHigh}` : 'Not provided'}
                          />
                        </>
                      )}
                      {inquiry.plannedSessions.length === 0 && (
                        <DetailField
                          label="Time estimate"
                          value={
                            inquiry.timeEstimateHoursMin != null && inquiry.timeEstimateHoursMax != null
                              ? `${inquiry.timeEstimateHoursMin}–${inquiry.timeEstimateHoursMax} hours`
                              : 'Not provided'
                          }
                        />
                      )}
                    </div>
                  )}

                  {/* Multi-session planning: the top-level time-estimate
                      fields are always null once a plan exists (see
                      PlannedSession's own schema comment) -- showing "Not
                      provided" here would be misleading when a real,
                      staff-declared breakdown exists. */}
                  {!editingEstimate && inquiry.plannedSessions.length > 0 && (
                    <div className="mt-4">
                      <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">Time estimate</p>
                      <p className="mt-1 text-sm text-fg">
                        {inquiry.plannedSessions
                          .map((ps) => `Session ${ps.sessionNumber}: ${ps.estimatedHoursMin}-${ps.estimatedHoursMax} hrs`)
                          .join(', ')}
                      </p>
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
                </Widget>
              )}

              {/* Multi-session planning: once a plan exists, this widget's
                  own interactive section never renders (Session Plan is
                  the one place to generate a deposit for a specific
                  session -- see that gate further below) -- so showing
                  this box before any deposit form has actually been
                  generated would just be an empty, confusing shell. */}
              {(depositForms.length > 0 ||
                (inquiry.plannedSessions.length === 0 && (inquiry.status === 'DEPOSIT_PENDING' || isConverted))) && (
                <Widget
                  key="deposit"
                  id="deposit"
                  title="Deposit"
                  actions={
                    depositForms.length > 1 ? (
                      <span className="text-xs text-fg-muted">
                        {depositForms.length} session{depositForms.length === 1 ? '' : 's'}
                      </span>
                    ) : null
                  }
                >

                  {/* Package M: every deposit form ever generated for this
                      project, oldest first -- each session's own status,
                      signature, and (once paid) the gift card it issued. */}
                  {depositForms.length > 0 && (
                    <ul className="mt-4 flex flex-col gap-4">
                      {depositForms.map((form) => (
                        <li key={form.id} className="rounded-lg border border-border p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-sm font-semibold text-fg">Session {form.sessionNumber}</span>
                            <span className="text-xs font-medium text-fg-muted">
                              {form.paidManually ? 'Paid' : form.signedAt ? 'Signed, awaiting payment' : 'Awaiting signature'}
                            </span>
                          </div>

                          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                            <DetailField label="Deposit" value={`$${form.depositAmount}`} />
                            <DetailField label="Fee" value={`$${form.feeAmount}`} />
                            <DetailField label="Total to collect" value={`$${form.totalCharged}`} />
                          </div>

                          {form.signedAt && (
                            <>
                              <p className="mt-3 text-sm text-fg-secondary">
                                Signed by {form.signatureName} on {formatDateTime(form.signedAt)}
                              </p>
                              {form.signatureData && (
                                <img
                                  src={form.signatureData}
                                  alt="Client signature"
                                  className="mt-2 h-20 rounded-lg border border-border bg-white"
                                />
                              )}
                            </>
                          )}

                          {markPaidError && markingPaidId === form.id && (
                            <p className="mt-3 text-sm text-danger">{markPaidError}</p>
                          )}

                          {form.paidManually ? (
                            <p className="mt-3 text-sm text-success">
                              {form.paidVia === 'STRIPE' ? 'Paid via Stripe' : 'Marked paid'}{' '}
                              {form.paidAt ? formatDateTime(form.paidAt) : ''}
                              {form.giftCard && ` — issued gift card ${form.giftCard.code.slice(0, 8)}…`}
                            </p>
                          ) : (
                            form.signedAt && (
                              <button
                                type="button"
                                onClick={() => handleMarkPaid(form.id)}
                                disabled={markingPaidId === form.id}
                                className="mt-3 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-60"
                              >
                                {markingPaidId === form.id ? 'Saving…' : `Mark $${form.totalCharged} as Paid`}
                              </button>
                            )
                          )}
                        </li>
                      ))}
                    </ul>
                  )}

                  {/* Multi-session planning: once a project has a session
                      plan, the Session Plan widget below is the ONE place
                      to generate/resend/attach a deposit for a specific
                      session (with its own correctly-sized suggested
                      times) -- showing this whole "generate the next
                      session's deposit" flow here too would be a genuinely
                      confusing duplicate (and, worse, its own un-planned
                      "latest session" counter doesn't know about specific
                      planned sessions, so using it here could create an
                      orphaned, plan-unlinked deposit form). Single-session
                      projects (no plan at all) are completely unaffected --
                      this is the only place they can ever generate one. */}
                  {inquiry.plannedSessions.length === 0 &&
                    (!isNewDepositSession && latestDepositForm ? (
                    <div className="mt-4">
                      {sendDepositError && <p className="mb-3 text-sm text-danger">{sendDepositError}</p>}

                      <button
                        type="button"
                        onClick={() => handleSendDepositForm()}
                        disabled={sendingDeposit}
                        className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-60"
                      >
                        {sendingDeposit ? 'Sending…' : 'Resend Deposit Form'}
                      </button>

                      {depositSendNotice && <p className="mt-3 text-sm text-fg-secondary">{depositSendNotice}</p>}

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

                      <div className="mt-4 rounded-lg border border-border p-3">
                        <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">Tentative time</p>
                        <p className="mt-1 text-xs text-fg-muted">
                          Informational only — shown to the client on the deposit page. Not a real booking; real
                          scheduling still happens after the deposit is paid.
                        </p>

                        {latestDepositForm.proposedStartAt && latestDepositForm.proposedEndAt ? (
                          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                            <p className="text-sm text-fg">
                              {formatDateTime(latestDepositForm.proposedStartAt)} –{' '}
                              {formatDateTime(latestDepositForm.proposedEndAt)}
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
                    </div>
                  ) : inquiry.status === 'DEPOSIT_PENDING' && hasAvailableGiftCard ? (
                    // No point requesting a fresh deposit if the client
                    // already has a card that can secure the booking --
                    // attaching it moves straight to Scheduling below, same
                    // status transition mark-paid does, just without
                    // creating a new card. Pre-conversion (first session)
                    // only -- once converted, later sessions always go
                    // through a real deposit form, matching the backend's
                    // own attach-gift-card gate.
                    <div className="mt-4">
                      <p className="text-sm text-fg-secondary">
                        {clientGiftCards!.length === 1
                          ? 'This client already has an available gift card'
                          : `This client already has ${clientGiftCards!.length} available gift cards`}{' '}
                        on file — no deposit needs to be requested.
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

                      {!inquiry.assignedArtist ? (
                        <p className="mt-3 text-sm text-fg-muted">Assign an artist before requesting a deposit.</p>
                      ) : (
                        <button
                          type="button"
                          onClick={handleAttachGiftCard}
                          disabled={attachingGiftCard}
                          aria-label="Attach Gift Card"
                          title="Attach Gift Card"
                          className="mt-3 flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border text-fg transition hover:bg-surface disabled:opacity-60 md:h-auto md:w-auto md:gap-2 md:px-4 md:py-2"
                        >
                          <AttachmentIcon className="h-4 w-4" />
                          <span className="hidden text-sm font-semibold md:inline">
                            {attachingGiftCard ? 'Attaching…' : 'Attach Gift Card'}
                          </span>
                        </button>
                      )}
                    </div>
                  ) : (
                    (inquiry.status === 'DEPOSIT_PENDING' || isConverted) &&
                    (!inquiry.assignedArtist ? (
                      <div className="mt-4 rounded-lg border border-border bg-surface-inset p-3">
                        <p className="text-sm text-fg-secondary">Assign an artist before requesting a deposit.</p>
                      </div>
                    ) : (
                      <div className="mt-4">
                        <div className="rounded-lg border border-border p-3">
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

                        {sendDepositError && <p className="mt-3 text-sm text-danger">{sendDepositError}</p>}

                        <button
                          type="button"
                          onClick={() => handleSendDepositForm()}
                          disabled={sendingDeposit || !tentativeTimeValid}
                          className="mt-4 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-60"
                        >
                          {sendingDeposit
                            ? 'Sending…'
                            : isConverted
                              ? 'Send Another Deposit Form'
                              : 'Send Deposit Form'}
                        </button>

                        {depositSendNotice && <p className="mt-3 text-sm text-fg-secondary">{depositSendNotice}</p>}

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
                      </div>
                    )))
                  )}
                </Widget>
              )}

              <Widget
                key="appointments"
                id="appointments"
                title="Appointments"
                actions={
                  canMessage ? (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setAppointmentModalType('CONSULTATION')}
                        aria-label="Schedule Consultation"
                        title="Schedule Consultation"
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border text-fg transition hover:bg-surface md:h-auto md:w-auto md:gap-2 md:px-4 md:py-2"
                      >
                        <ClockIcon className="h-4 w-4" />
                        <span className="hidden text-sm font-semibold md:inline">Schedule Consultation</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setAppointmentModalType('TATTOO_SESSION')}
                        aria-label="New Appointment"
                        title="New Appointment"
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border text-fg transition hover:bg-surface md:h-auto md:w-auto md:gap-2 md:px-4 md:py-2"
                      >
                        <AppointmentsIcon className="h-4 w-4" />
                        <span className="hidden text-sm font-semibold md:inline">New Appointment</span>
                      </button>
                    </div>
                  ) : null
                }
              >

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

                {/* Merged in from the old standalone "Scheduling" section --
                    having a second box just for "book a time to confirm
                    this project" alongside the appointment list it was
                    about to join was confusing (two competing ways to
                    book). This is still the one path that also moves
                    SCHEDULING -> CONFIRMED (the Kanban board's own
                    SCHEDULING -> CONFIRMED drag deep-links straight to this
                    same section, via ?openFlow=schedule -> #appointments)
                    and the only place Waitlist lives -- kept, just no
                    longer its own separate widget. The old redundant
                    Start/End/status block for an already-booked
                    inquiry.appointment was dropped entirely -- the exact
                    same appointment already shows in the list above (and
                    its own detail page, one click away, has the full
                    start/end).

                    Also newly gated on plannedSessions.length === 0 --
                    this flow only ever books/tracks ONE ad-hoc appointment
                    via inquiry.appointment, which multi-session bookings
                    (made via Session Plan's own per-session flow) never
                    touch, so `status` never leaves SCHEDULING for a
                    multi-session project no matter how many of its
                    sessions get booked and completed. Without this gate,
                    "Add an assigned artist and a time estimate..." would
                    show forever on every multi-session project (their
                    top-level time estimate is always null once a plan
                    exists) -- Session Plan is the one place multi-session
                    booking happens, same reasoning as the Deposit widget's
                    own plannedSessions gate above. */}
                {bufferWarning && (
                  <div className="mt-4 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
                    {bufferWarning}
                  </div>
                )}

                {inquiry.status === 'SCHEDULING' && !inquiry.appointment && inquiry.plannedSessions.length === 0 && (
                  <>
                    {(!inquiry.assignedArtist ||
                      inquiry.timeEstimateHoursMin == null ||
                      inquiry.timeEstimateHoursMax == null) && (
                      <p className="mt-4 text-xs text-fg-muted">
                        Add an assigned artist and a time estimate to see suggested times.
                      </p>
                    )}

                    {scheduleSuggestLoading && (
                      <p className="mt-4 text-sm text-fg-secondary">Checking availability…</p>
                    )}

                    {!scheduleSuggestLoading && scheduleSuggestedTimes.length > 0 && (
                      <div className="mt-4 rounded-xl border border-accent/30 bg-accent/5 p-3">
                        <p className="mb-1.5 text-sm font-semibold text-fg">Suggested times</p>
                        <div className="flex flex-wrap gap-2">
                          {scheduleSuggestedTimes.map((candidate) => {
                            const parts = isoToTimeRangeParts(candidate.startTime, candidate.endTime)
                            const isSelected =
                              scheduleTimeRange.date === parts.date &&
                              scheduleTimeRange.startTime === parts.startTime &&
                              scheduleTimeRange.endTime === parts.endTime
                            return (
                              <button
                                key={candidate.startTime}
                                type="button"
                                onClick={() => setScheduleTimeRange(parts)}
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

                    {!scheduleSuggestLoading &&
                      scheduleSuggestedTimes.length === 0 &&
                      inquiry.assignedArtist &&
                      inquiry.timeEstimateHoursMin != null &&
                      inquiry.timeEstimateHoursMax != null && (
                        <p className="mt-4 text-xs text-fg-muted">
                          No open slots found in the next few weeks — pick a time manually below.
                        </p>
                      )}

                    <div className="mt-4">
                      <p className="mb-1.5 text-xs font-medium text-fg-secondary">Or pick a specific time</p>
                      <DateAndTimeRangeFields value={scheduleTimeRange} onChange={setScheduleTimeRange} />
                    </div>

                    <div className="mt-3">
                      <label className="mb-1 block text-xs font-medium text-fg-secondary">
                        Gift card(s) (deposit) to attach
                      </label>
                      {clientGiftCards && clientGiftCards.length === 0 ? (
                        <p className="text-sm text-fg-secondary">
                          No available gift card for this client yet — the deposit should have issued one.
                        </p>
                      ) : (
                        <GiftCardStackPicker
                          cards={clientGiftCards ?? []}
                          selectedIds={scheduleGiftCardIds}
                          onChange={setScheduleGiftCardIds}
                          requiredCents={requiredDepositCents}
                        />
                      )}
                    </div>

                    {scheduleError && <p className="mt-3 text-sm text-danger">{scheduleError}</p>}

                    <div className="mt-3 flex flex-wrap gap-3">
                      <button
                        type="button"
                        onClick={handleSchedule}
                        disabled={scheduling || !isCompleteTimeRange(scheduleTimeRange) || !hasSufficientScheduleGiftCards}
                        aria-label="Schedule Appointment"
                        title="Schedule Appointment"
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border text-fg transition hover:bg-surface disabled:opacity-60 md:h-auto md:w-auto md:gap-2 md:px-4 md:py-2"
                      >
                        <ClockIcon className="h-4 w-4" />
                        <span className="hidden text-sm font-semibold md:inline">
                          {scheduling ? 'Scheduling…' : 'Schedule Appointment'}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowWaitlistForm((v) => !v)}
                        aria-label="Add to Waitlist"
                        title="Add to Waitlist"
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border text-fg transition hover:bg-surface md:h-auto md:w-auto md:gap-2 md:px-4 md:py-2"
                      >
                        <TagIcon className="h-4 w-4" />
                        <span className="hidden text-sm font-semibold md:inline">Add to Waitlist</span>
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

                {inquiry.status === 'WAITLISTED' && (
                  <div className="mt-4">
                    <p className="text-sm text-fg-secondary">
                      Currently waitlisted -- not actively being scheduled.
                    </p>
                    {inquiry.declineNote && (
                      <p className="mt-2 rounded-lg border border-border bg-surface-inset p-3 text-sm text-fg-secondary">
                        {inquiry.declineNote}
                      </p>
                    )}
                    {unwaitlistError && <p className="mt-2 text-sm text-danger">{unwaitlistError}</p>}
                    <button
                      type="button"
                      onClick={handleUnwaitlist}
                      disabled={unwaitlisting}
                      className="mt-3 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-60"
                    >
                      {unwaitlisting ? 'Removing…' : 'Remove from Waitlist'}
                    </button>
                  </div>
                )}
              </Widget>

              {/* Multi-session planning: purely additive -- invisible for
                  every project that never declared more than one session
                  at estimate time. A real at-a-glance view of the whole
                  plan: each session's hour estimate, deposit status, and
                  appointment status together, with the right action
                  inline per row (generate a deposit form, or book once
                  paid) rather than one single global "next session"
                  action the way the un-planned Deposit widget above still
                  works for its own case. */}
              {inquiry.plannedSessions.length > 0 && (
                <Widget key="session-plan" id="session-plan" title="Session Plan">
                  <div className="mt-4 divide-y divide-border">
                    {inquiry.plannedSessions.map((ps) => {
                      const depositStatus = !ps.depositForm ? 'not_generated' : ps.depositForm.paidAt ? 'paid' : 'pending'
                      const appointmentStatus = !ps.appointment
                        ? 'not_booked'
                        : ps.appointment.checkedOutAt
                          ? 'completed'
                          : 'scheduled'
                      const depositBadge =
                        depositStatus === 'paid'
                          ? { label: 'Deposit paid', className: 'border-success/30 bg-success/10 text-success' }
                          : depositStatus === 'pending'
                            ? { label: 'Deposit pending', className: 'border-warning/30 bg-warning/10 text-warning' }
                            : { label: 'Deposit not yet generated', className: 'border-border bg-surface-inset text-fg-muted' }
                      const appointmentBadge =
                        appointmentStatus === 'completed'
                          ? { label: 'Completed', className: 'border-success/30 bg-success/10 text-success' }
                          : appointmentStatus === 'scheduled'
                            ? { label: 'Scheduled', className: 'border-accent/30 bg-accent/10 text-accent' }
                            : { label: 'Not yet booked', className: 'border-border bg-surface-inset text-fg-muted' }

                      return (
                        <div key={ps.id} className="py-3 first:pt-0 last:pb-0">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-sm font-medium text-fg">
                              Session {ps.sessionNumber} — estimated {ps.estimatedHoursMin}-{ps.estimatedHoursMax} hrs
                            </p>
                            <div className="flex items-center gap-2">
                              <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${depositBadge.className}`}>
                                {depositBadge.label}
                              </span>
                              <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${appointmentBadge.className}`}>
                                {appointmentBadge.label}
                              </span>
                            </div>
                          </div>

                          {ps.appointment && (
                            <Link
                              to={`/appointments/${ps.appointment.id}`}
                              className="mt-1 inline-block text-xs text-accent hover:underline"
                            >
                              {formatDateTime(ps.appointment.startTime)}
                            </Link>
                          )}

                          {depositStatus === 'not_generated' && canMessage && (
                            <div className="mt-2">
                              {!inquiry.assignedArtist ? (
                                <p className="text-xs text-fg-muted">Assign an artist before requesting a deposit.</p>
                              ) : depositTargetPlannedSessionId === ps.id ? (
                                <div className="rounded-lg border border-border p-3">
                                  {plannedSessionSuggestLoading && (
                                    <p className="text-sm text-fg-secondary">Loading suggested times…</p>
                                  )}

                                  {!plannedSessionSuggestLoading && plannedSessionSuggestedTimes.length > 0 && (
                                    <div className="mb-3">
                                      <p className="mb-1.5 text-xs font-medium text-fg-secondary">Suggested times</p>
                                      <div className="flex flex-wrap gap-2">
                                        {plannedSessionSuggestedTimes.map((candidate) => {
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

                                  <p className="mb-1.5 text-xs font-medium text-fg-secondary">Or pick a specific time</p>
                                  <DateAndTimeRangeFields value={tentativeTimeRange} onChange={setTentativeTimeRange} />
                                  {plannedSessionSuggestError && (
                                    <p className="mt-2 text-xs text-danger">{plannedSessionSuggestError}</p>
                                  )}
                                  {sendDepositError && <p className="mt-2 text-xs text-danger">{sendDepositError}</p>}
                                  <div className="mt-2 flex gap-2">
                                    <button
                                      type="button"
                                      onClick={() => handleSendDepositForm(ps.id)}
                                      disabled={sendingDeposit || !tentativeTimeValid}
                                      className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-60"
                                    >
                                      {sendingDeposit ? 'Sending…' : 'Send Deposit Form'}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setDepositTargetPlannedSessionId(null)}
                                      className="rounded-full border border-border px-4 py-2 text-sm font-semibold text-fg transition hover:bg-surface"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSendDepositError(null)
                                    setTentativeTimeRange({ date: '', startTime: '', endTime: '' })
                                    setDepositTargetPlannedSessionId(ps.id)
                                  }}
                                  className="rounded-full border border-border px-4 py-2 text-sm font-semibold text-fg transition hover:bg-surface"
                                >
                                  Send Deposit Form
                                </button>
                              )}
                            </div>
                          )}

                          {/* Resend just rotates this session's own linked
                              form's token -- no tentative time needed
                              (isNewSessionForTarget is false once
                              depositFormId is already set), so this is a
                              single action, not the full mini-form above. */}
                          {depositStatus === 'pending' && canMessage && (
                            <div className="mt-2">
                              <button
                                type="button"
                                onClick={() => handleSendDepositForm(ps.id)}
                                disabled={sendingDeposit}
                                className="rounded-full border border-border px-4 py-2 text-sm font-semibold text-fg transition hover:bg-surface disabled:opacity-60"
                              >
                                {sendingDeposit ? 'Resending…' : 'Resend Deposit Form'}
                              </button>
                              {sendDepositError && <p className="mt-2 text-xs text-danger">{sendDepositError}</p>}
                              {depositSendNotice && <p className="mt-2 text-xs text-fg-secondary">{depositSendNotice}</p>}
                              {depositUrl && (
                                <div className="mt-2 flex items-center gap-2">
                                  <input
                                    type="text"
                                    readOnly
                                    value={depositUrl}
                                    onFocus={(event) => event.target.select()}
                                    className="w-full rounded-lg border border-border bg-surface-inset px-3 py-1.5 text-xs text-fg focus:outline-none"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => handleCopyLink(depositUrl)}
                                    aria-label={copied ? 'Copied' : 'Copy link'}
                                    title={copied ? 'Copied!' : 'Copy link'}
                                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-fg-secondary transition hover:bg-surface-raised hover:text-fg"
                                  >
                                    {copied ? <CheckIcon className="h-4 w-4 text-success" /> : <CopyIcon className="h-4 w-4" />}
                                  </button>
                                </div>
                              )}
                            </div>
                          )}

                          {/* This session's own deposit doesn't have to be
                              the thing covering it -- gift cards (a rolled-
                              forward one from another session, say) and
                              deposit exemptions stack across the whole
                              client, not per session (Phase 3). The booking
                              modal's own GiftCardStackPicker still enforces
                              that enough is actually selected before
                              Create Appointment is enabled -- this is just
                              about whether the button is worth showing. */}
                          {(depositStatus === 'paid' || hasAvailableGiftCard) &&
                            appointmentStatus === 'not_booked' &&
                            canMessage && (
                              <button
                                type="button"
                                onClick={() => setBookingPlannedSessionId(ps.id)}
                                className="mt-2 rounded-full border border-border px-4 py-2 text-sm font-semibold text-fg transition hover:bg-surface"
                              >
                                Book Appointment
                              </button>
                            )}
                        </div>
                      )
                    })}
                  </div>
                </Widget>
              )}

              {/* Package N: grouped by session, not one flat gallery --
                  each session that actually has photos gets its own
                  "Session N — [date]" group. Sessions with none yet are
                  omitted entirely (same convention as Reference
                  images/Placement photos below, which also only render
                  when non-empty), rather than showing an empty group for
                  every session on every project. */}
              {inquiry.sessions.some((session) => session.photos.length > 0) && (
                <Widget key="photos" id="photos" title="Photos">

                  <div className="mt-4 space-y-5">
                    {inquiry.sessions
                      .map((session, index) => ({ session, sessionNumber: index + 1 }))
                      .filter(({ session }) => session.photos.length > 0)
                      .map(({ session, sessionNumber }) => (
                        <div key={session.id}>
                          <Link
                            to={`/appointments/${session.id}`}
                            className="text-xs font-medium uppercase tracking-wider text-fg-muted hover:text-fg-secondary"
                          >
                            Session {sessionNumber} — {formatDateTime(session.startTime)}
                          </Link>
                          <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-6">
                            {session.photos.map((photo) => (
                              <a
                                key={photo.id}
                                href={photo.url}
                                target="_blank"
                                rel="noreferrer"
                                className="group relative block aspect-square overflow-hidden rounded-lg border border-border"
                              >
                                <img src={photo.url} alt="" className="h-full w-full object-cover transition group-hover:opacity-80" />
                                <div className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/80 to-transparent px-1.5 pb-1 pt-4 text-[10px] leading-tight text-fg opacity-0 transition group-hover:opacity-100">
                                  {formatDateTime(photo.uploadedAt)}
                                  {photo.uploadedBy && ` · ${photo.uploadedBy.name ?? photo.uploadedBy.email}`}
                                </div>
                              </a>
                            ))}
                          </div>
                        </div>
                      ))}
                  </div>
                </Widget>
              )}

              <Widget
                key="reference-images"
                id="reference-images"
                title="Reference images"
                actions={
                  !editingReferenceImages ? (
                    <button
                      type="button"
                      onClick={() => setEditingReferenceImages(true)}
                      aria-label="Edit Reference Images"
                      title="Edit Reference Images"
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border text-fg transition hover:bg-surface md:h-auto md:w-auto md:gap-2 md:px-4 md:py-2"
                    >
                      <PencilIcon className="h-4 w-4" />
                      <span className="hidden text-sm font-semibold md:inline">Edit</span>
                    </button>
                  ) : null
                }
              >

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
                    <ImageGrid images={inquiry.referenceImages} details={inquiry.referenceImagesDetail} />
                  </div>
                )}
              </Widget>

              <Widget
                key="placement-photos"
                id="placement-photos"
                title="Placement photos"
                actions={
                  !editingPlacementImages ? (
                    <button
                      type="button"
                      onClick={() => setEditingPlacementImages(true)}
                      aria-label="Edit Placement Photos"
                      title="Edit Placement Photos"
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border text-fg transition hover:bg-surface md:h-auto md:w-auto md:gap-2 md:px-4 md:py-2"
                    >
                      <PencilIcon className="h-4 w-4" />
                      <span className="hidden text-sm font-semibold md:inline">Edit</span>
                    </button>
                  ) : null
                }
              >

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
                    <ImageGrid images={inquiry.placementImages} details={inquiry.placementImagesDetail} />
                  </div>
                )}
              </Widget>

              {(showCustomFieldsWidget || editingDetails) && (
                <Widget
                  key="custom-fields"
                  id="custom-fields"
                  title="Inquiry Details"
                  actions={
                    !editingDetails ? (
                      <button
                        type="button"
                        onClick={() => setEditingDetails(true)}
                        aria-label="Edit Inquiry Details"
                        title="Edit Inquiry Details"
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border text-fg transition hover:bg-surface md:h-auto md:w-auto md:gap-2 md:px-4 md:py-2"
                      >
                        <PencilIcon className="h-4 w-4" />
                        <span className="hidden text-sm font-semibold md:inline">Edit</span>
                      </button>
                    ) : null
                  }
                >
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
                    <InquiryDetailsSection inquiry={inquiry} bare onVisibilityChange={setShowCustomFieldsWidget} />
                  )}
                </Widget>
              )}

              {canMessage && (
                <Widget key="notes" id="notes" title="Notes">
                  <NotesSection
                    notesPath={`/inquiries/${inquiry.id}/notes`}
                    queryKeyId={inquiry.id}
                    canManage={canMessage}
                    readOnly={!!viewAsTarget}
                    bare
                  />
                </Widget>
              )}

              <Widget key="activity-history" id="activity-history" title="Activity History">
                <AuditTrail bare entityType="Inquiry" entityId={inquiry.id} />
              </Widget>
              </ReorderableWidgetList>

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
                <Modal
                  title={markingLostAsCandidacy ? 'Not a Candidate' : 'Mark as lost'}
                  onClose={() => {
                    setShowMarkLostModal(false)
                    setMarkingLostAsCandidacy(false)
                  }}
                >
                  <div className="space-y-4">
                    <p className="text-sm text-fg-secondary">
                      {markingLostAsCandidacy
                        ? 'This marks the inquiry as lost -- same as any other "Mark as lost" -- with candidacy as the reason. You can reopen it later if the client comes back.'
                        : 'This marks the inquiry as lost. You can reopen it later if the client comes back.'}
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
                        {markingLost ? 'Marking lost…' : markingLostAsCandidacy ? 'Not a Candidate' : 'Mark as lost'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowMarkLostModal(false)
                          setMarkingLostAsCandidacy(false)
                        }}
                        disabled={markingLost}
                        className="rounded-full border border-border px-4 py-2 text-sm font-medium text-fg transition hover:bg-surface disabled:opacity-60"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </Modal>
              )}

              {showReviseEstimateModal && (
                <Modal title="Revise Estimate" onClose={() => setShowReviseEstimateModal(false)}>
                  <div className="space-y-4">
                    <p className="text-sm text-fg-secondary">
                      This is already a Project -- revising the estimate re-sends it to the client with your reason,
                      and requires their approval.
                    </p>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {isFlatPricing ? (
                        <div className="sm:col-span-2">
                          <label className="mb-1 block text-xs font-medium text-fg-secondary">Price</label>
                          <CurrencyInput
                            value={reviseEstimateForm.priceEstimateLow}
                            onChange={(digits) =>
                              setReviseEstimateForm({ ...reviseEstimateForm, priceEstimateLow: digits, priceEstimateHigh: digits })
                            }
                            className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                          />
                        </div>
                      ) : (
                        <>
                          <div>
                            <label className="mb-1 block text-xs font-medium text-fg-secondary">Price low</label>
                            <CurrencyInput
                              value={reviseEstimateForm.priceEstimateLow}
                              onChange={(digits) => setReviseEstimateForm({ ...reviseEstimateForm, priceEstimateLow: digits })}
                              className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-xs font-medium text-fg-secondary">Price high</label>
                            <CurrencyInput
                              value={reviseEstimateForm.priceEstimateHigh}
                              onChange={(digits) => setReviseEstimateForm({ ...reviseEstimateForm, priceEstimateHigh: digits })}
                              className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                            />
                          </div>
                        </>
                      )}
                      <SessionCountField
                        sessionCount={reviseSessionCount}
                        onSessionCountChange={handleReviseSessionCountChange}
                        lockedSessions={reviseLockedSessions}
                      />
                      {!isReviseMultiSession && (
                        <>
                          <div>
                            <label className="mb-1 block text-xs font-medium text-fg-secondary">Time min (hours)</label>
                            <select
                              value={reviseEstimateForm.timeEstimateHoursMin}
                              onChange={(e) =>
                                setReviseEstimateForm({ ...reviseEstimateForm, timeEstimateHoursMin: e.target.value })
                              }
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
                              value={reviseEstimateForm.timeEstimateHoursMax}
                              onChange={(e) =>
                                setReviseEstimateForm({ ...reviseEstimateForm, timeEstimateHoursMax: e.target.value })
                              }
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
                        </>
                      )}
                    </div>

                    <SessionHoursRows
                      sessionCount={reviseSessionCount}
                      sessionHours={reviseSessionHours}
                      onSessionHoursChange={setReviseSessionHours}
                      lockedSessions={reviseLockedSessions}
                    />

                    <div>
                      <label className="mb-1 block text-xs font-medium text-fg-secondary">
                        Reason for the change (shown to the client)
                      </label>
                      <textarea
                        rows={3}
                        value={reviseReasonInput}
                        onChange={(e) => setReviseReasonInput(e.target.value)}
                        placeholder="e.g. Design ended up larger than originally scoped"
                        className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                      />
                    </div>

                    {reviseEstimateError && <p className="text-sm text-danger">{reviseEstimateError}</p>}

                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={handleReviseEstimate}
                        disabled={revisingEstimate}
                        className="flex-1 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {revisingEstimate ? 'Sending…' : 'Revise & Send for Approval'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowReviseEstimateModal(false)}
                        disabled={revisingEstimate}
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
                          {deletePreview.plannedSessions > 0 && (
                            <li>
                              {deletePreview.plannedSessions} planned session{deletePreview.plannedSessions === 1 ? '' : 's'}
                            </li>
                          )}
                        </ul>
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

              {(appointmentModalType || bookingPlannedSessionId) && (
                <Modal
                  title={appointmentModalType === 'CONSULTATION' ? 'Schedule Consultation' : 'New Appointment'}
                  onClose={() => {
                    setAppointmentModalType(null)
                    setBookingPlannedSessionId(null)
                  }}
                >
                  <p className="mb-4 text-xs text-fg-muted">
                    {appointmentModalType === 'CONSULTATION'
                      ? `Scheduling a consultation for ${inquiry.client.firstName} ${inquiry.client.lastName} under this project -- no deposit needed, and this can happen at any point regardless of where the project is in its pipeline.`
                      : `Booking another appointment for ${inquiry.client.firstName} ${inquiry.client.lastName} under this project.`}
                  </p>
                  <AppointmentForm
                    fixedClientId={inquiry.clientId}
                    fixedInquiryId={inquiry.id}
                    initialAppointmentType={appointmentModalType ?? 'TATTOO_SESSION'}
                    initialPlannedSessionId={bookingPlannedSessionId ?? undefined}
                    onCreated={() => {
                      setAppointmentModalType(null)
                      setBookingPlannedSessionId(null)
                      invalidateInquiry()
                    }}
                    onCancel={() => {
                      setAppointmentModalType(null)
                      setBookingPlannedSessionId(null)
                    }}
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
