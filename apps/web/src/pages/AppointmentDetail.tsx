import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import Sidebar from '../components/Sidebar'
import AuditTrail from '../components/AuditTrail'
import Modal from '../components/Modal'
import StatusPill from '../components/StatusPill'
import DateAndTimeRangeFields, {
  combineDateAndTime,
  isCompleteTimeRange,
  isValidTimeRange,
  toDateString,
  type DateAndTimeRangeValue,
} from '../components/DateAndTimeRangeFields'
import { apiFetch, ApiError } from '../lib/api'
import { describeAppointmentStatus, formatDateTime, formatPhoneInput, formatStatus } from '../lib/format'
import { describeSendResult, type ClientSendResult } from '../lib/sendResult'
import { formatCents, dollarsToCents } from '../lib/money'
import { ArrowLeftIcon, CheckIcon, ClientsIcon, CopyIcon, DocumentIcon, MessageIcon, MoreIcon } from '../components/icons'
import { ArtistAvatar, artistLabel } from '../components/ArtistAvatar'
import { useEffectiveUser } from '../context/useEffectiveUser'
import { useConversationPanel } from '../context/useConversationPanel'
import { appointmentsQueryKey } from '../lib/queryKeys'
import ImageUploadSection, { type ImageUploadState } from '../components/ImageUploadSection'
import { uploadAppointmentPhoto } from '../lib/cloudinary'

interface WaiverSummary {
  id: string
  status: string
  signedAt: string | null
  verifiedAt: string | null
}

interface GiftCardSummary {
  id: string
  code: string
  amountCents: number
  status: string
  expiresAt: string | null
  exemptionReason: string | null
}

interface AppointmentPhoto {
  id: string
  url: string
  uploadedAt: string
  uploadedBy: { id: string; name: string | null; email: string }
}

interface Appointment {
  id: string
  startTime: string
  endTime: string
  status: string
  notes: string | null
  archivedAt: string | null
  finalCostCents: number | null
  closeoutNotes: string | null
  checkedOutAt: string | null
  checkedOutBy: { id: string; name: string | null; email: string } | null
  client: { id: string; firstName: string; lastName: string }
  artist: { id: string; user: { email: string; name: string | null; avatarUrl: string | null } }
  inquiry: {
    id: string
    description: string
    clientId: string
    budget: string | null
    priceEstimateLow: number | null
    priceEstimateHigh: number | null
    referenceImages: string[]
    placementImages: string[]
  }
  giftCards: GiftCardSummary[]
  liabilityWaiver: WaiverSummary | null
  photos: AppointmentPhoto[]
}

interface DeletePreview {
  waivers: number
  giftCardsToDetach: { id: string; code: string; amountCents: number; status: string }[]
  conversationTags: number
  photos: number
}

const DELETE_CONFIRM_TEXT = 'DELETE'

interface HealthQuestionSnapshot {
  question: string
  type: 'yes_no' | 'yes_no_explain'
  explainPrompt?: string
}

interface HealthAnswer {
  questionIndex: number
  answer: 'YES' | 'NO'
  explanation?: string
}

interface ClauseInitial {
  clauseIndex: number
  initials: string
}

interface WaiverDetail {
  id: string
  status: string
  token: string | null
  signingUrl: string | null
  legalName: string | null
  dateOfBirth: string | null
  emergencyContactName: string | null
  emergencyContactPhone: string | null
  healthAnswers: HealthAnswer[] | null
  idImageUrl: string | null
  clauseInitials: ClauseInitial[] | null
  signatureName: string | null
  photoReleaseAccepted: boolean
  photoReleaseSignatureName: string | null
  healthQuestionsSnapshot: HealthQuestionSnapshot[]
  clausesSnapshot: string[]
  signedAt: string | null
  verifiedAt: string | null
  verifiedBy: { id: string; name: string | null; email: string } | null
}

const EMPTY_CHECKOUT_FORM = { finalCostDollars: '', closeoutNotes: '' }
type CardDecision = 'REDEEM' | 'ROLL'
const APPOINTMENT_STATUSES = ['REQUESTED', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'] as const

export default function AppointmentDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const user = useEffectiveUser()
  const queryClient = useQueryClient()
  const { openPanel } = useConversationPanel()
  const canManage = user?.role === 'OWNER' || user?.role === 'FRONT_DESK'
  const [startingConversation, setStartingConversation] = useState(false)

  const [appointment, setAppointment] = useState<Appointment | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshIndex, setRefreshIndex] = useState(0)

  const [waiverDetail, setWaiverDetail] = useState<WaiverDetail | null>(null)

  const [creatingWaiver, setCreatingWaiver] = useState(false)
  const [waiverError, setWaiverError] = useState<string | null>(null)
  const [waiverSendNotice, setWaiverSendNotice] = useState<string | null>(null)
  const [latestSigningUrl, setLatestSigningUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const [verifying, setVerifying] = useState(false)
  const [verifyError, setVerifyError] = useState<string | null>(null)

  const [checkoutForm, setCheckoutForm] = useState(EMPTY_CHECKOUT_FORM)
  // Stackable gift cards: a separate REDEEM-or-ROLL choice per attached
  // card, not one choice for the whole stack -- keyed by giftCardId,
  // defaulting every non-EXEMPT card to REDEEM (same default the old
  // single-card radio started on) once the appointment loads.
  const [cardDecisions, setCardDecisions] = useState<Record<string, CardDecision>>({})
  const [checkingOut, setCheckingOut] = useState(false)
  const [checkoutError, setCheckoutError] = useState<string | null>(null)
  const [checkoutResult, setCheckoutResult] = useState<{
    amountDueCents: number
    overageCents: number
    newGiftCard: { id: string; code: string; amountCents: number } | null
  } | null>(null)
  // Package N: staged during checkout (optional -- staff can skip and add
  // later), plus a second, always-available upload for "forgot at
  // checkout" or just adding more later. Two independent pickers so
  // checkout's own uploading/urls state doesn't get tangled up with the
  // "add more" one below once the appointment's already complete.
  const [checkoutPhotos, setCheckoutPhotos] = useState<ImageUploadState>({ urls: [], uploading: false })
  const [addPhotosKey, setAddPhotosKey] = useState(0)
  const [addPhotosState, setAddPhotosState] = useState<ImageUploadState>({ urls: [], uploading: false })
  const [savingPhotos, setSavingPhotos] = useState(false)
  const [photosError, setPhotosError] = useState<string | null>(null)
  const [deletingPhotoId, setDeletingPhotoId] = useState<string | null>(null)

  const [updatingStatus, setUpdatingStatus] = useState(false)
  const [statusError, setStatusError] = useState<string | null>(null)

  const [showMoreMenu, setShowMoreMenu] = useState(false)

  const [showRescheduleModal, setShowRescheduleModal] = useState(false)
  const [rescheduleRange, setRescheduleRange] = useState<DateAndTimeRangeValue>({
    date: '',
    startTime: '',
    endTime: '',
  })
  const [rescheduling, setRescheduling] = useState(false)
  const [rescheduleError, setRescheduleError] = useState<string | null>(null)
  const [rescheduleBufferWarning, setRescheduleBufferWarning] = useState<string | null>(null)

  const [archiving, setArchiving] = useState(false)
  const [archiveError, setArchiveError] = useState<string | null>(null)

  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [deletePreview, setDeletePreview] = useState<DeletePreview | null>(null)
  const [deletePreviewLoading, setDeletePreviewLoading] = useState(false)
  const [deletePreviewError, setDeletePreviewError] = useState<string | null>(null)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    let ignore = false

    apiFetch<Appointment>(`/appointments/${id}`)
      .then((data) => {
        if (ignore) return
        setAppointment(data)
      })
      .catch((err) => {
        if (ignore) return
        if (err instanceof ApiError && err.status === 404) {
          setError('Appointment not found.')
        } else if (err instanceof ApiError && err.status === 403) {
          setError("You don't have permission to view this appointment.")
        } else {
          setError(err instanceof Error ? err.message : 'Failed to load appointment')
        }
      })

    return () => {
      ignore = true
    }
  }, [id, refreshIndex])

  // Seed once per appointment (not on every render) -- an in-progress
  // staff edit to a card's decision shouldn't get clobbered by an
  // unrelated refresh, same "seed per id" pattern used elsewhere on this
  // page (rescheduleRange, etc.).
  const [seededDecisionsForId, setSeededDecisionsForId] = useState<string | null>(null)
  if (appointment && appointment.id !== seededDecisionsForId) {
    setSeededDecisionsForId(appointment.id)
    setCardDecisions(
      Object.fromEntries(appointment.giftCards.filter((c) => c.status !== 'EXEMPT').map((c) => [c.id, 'REDEEM'])),
    )
  }

  // Full waiver detail (health answers, ID image, clause initials) is
  // OWNER/FRONT_DESK only server-side too -- skip the request entirely for
  // an ARTIST rather than let it 403 noisily.
  useEffect(() => {
    if (!appointment?.liabilityWaiver || !canManage) {
      setWaiverDetail(null)
      return
    }

    let ignore = false

    apiFetch<WaiverDetail>(`/waivers/${appointment.liabilityWaiver.id}`)
      .then((data) => {
        if (!ignore) setWaiverDetail(data)
      })
      .catch(() => {
        // Non-critical for this section to fail quietly; the summary badge still shows.
      })

    return () => {
      ignore = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appointment?.liabilityWaiver?.id, canManage, refreshIndex])

  async function handleCreateWaiver() {
    if (!id) return

    setCreatingWaiver(true)
    setWaiverError(null)
    setWaiverSendNotice(null)

    try {
      const result = await apiFetch<{ signingUrl: string; waiverSendResult: ClientSendResult | null }>(
        `/appointments/${id}/waiver`,
        { method: 'POST' },
      )
      setLatestSigningUrl(result.signingUrl)
      setWaiverSendNotice(describeSendResult('Waiver', result.waiverSendResult))
      setRefreshIndex((i) => i + 1)
    } catch (err) {
      setWaiverError(err instanceof Error ? err.message : 'Failed to create waiver')
    } finally {
      setCreatingWaiver(false)
    }
  }

  async function handleMessage() {
    if (!appointment) return
    setStartingConversation(true)
    try {
      const conversation = await apiFetch<{ id: string }>('/conversations', {
        method: 'POST',
        body: JSON.stringify({ clientId: appointment.client.id }),
      })
      openPanel(conversation.id)
    } catch {
      // Non-critical -- messaging is also reachable from the client profile.
    } finally {
      setStartingConversation(false)
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

  async function handleVerify() {
    if (!appointment?.liabilityWaiver) return

    setVerifying(true)
    setVerifyError(null)

    try {
      await apiFetch(`/waivers/${appointment.liabilityWaiver.id}/verify`, { method: 'POST' })
      setRefreshIndex((i) => i + 1)
    } catch (err) {
      setVerifyError(err instanceof Error ? err.message : 'Failed to verify waiver')
    } finally {
      setVerifying(false)
    }
  }

  const finalCostCents = Number(checkoutForm.finalCostDollars) ? dollarsToCents(Number(checkoutForm.finalCostDollars)) : 0
  const exemptCards = (appointment?.giftCards ?? []).filter((c) => c.status === 'EXEMPT')
  const decidableCards = (appointment?.giftCards ?? []).filter((c) => c.status !== 'EXEMPT')
  const redeemedTotalPreviewCents = decidableCards
    .filter((c) => (cardDecisions[c.id] ?? 'REDEEM') === 'REDEEM')
    .reduce((sum, c) => sum + c.amountCents, 0)
  const amountDuePreview = Math.max(0, finalCostCents - redeemedTotalPreviewCents)
  const overagePreview = Math.max(0, redeemedTotalPreviewCents - finalCostCents)

  function setCardDecision(cardId: string, decision: CardDecision) {
    setCardDecisions((current) => ({ ...current, [cardId]: decision }))
  }

  async function handleCheckout(event: FormEvent) {
    event.preventDefault()
    if (!id) return

    setCheckingOut(true)
    setCheckoutError(null)

    try {
      const result = await apiFetch<{ amountDueCents: number; overageCents: number; newGiftCard: { id: string; code: string; amountCents: number } | null }>(
        `/appointments/${id}/checkout`,
        {
          method: 'POST',
          body: JSON.stringify({
            finalCostCents,
            decisions: decidableCards.map((c) => ({ giftCardId: c.id, action: cardDecisions[c.id] ?? 'REDEEM' })),
            closeoutNotes: checkoutForm.closeoutNotes || undefined,
          }),
        },
      )
      setCheckoutResult(result)

      // Optional -- staff may have skipped the photo picker entirely, or
      // still be mid-upload (already disabled below in that case). Checkout
      // itself is already done at this point regardless of whether this
      // second call succeeds, matching the auto-send-on-generate pattern
      // elsewhere in this app: the primary action isn't rolled back if a
      // secondary, best-effort step fails.
      if (checkoutPhotos.urls.length > 0) {
        try {
          await apiFetch(`/appointments/${id}/photos`, {
            method: 'POST',
            body: JSON.stringify({ urls: checkoutPhotos.urls }),
          })
        } catch {
          setPhotosError('Checkout succeeded, but the attached photos failed to save -- add them from below instead.')
        }
      }

      if (user) queryClient.invalidateQueries({ queryKey: appointmentsQueryKey(user.studioId) })
      setRefreshIndex((i) => i + 1)
    } catch (err) {
      setCheckoutError(err instanceof Error ? err.message : 'Failed to check out this appointment')
    } finally {
      setCheckingOut(false)
    }
  }

  async function handleAddPhotos() {
    if (!id || addPhotosState.urls.length === 0) return

    setSavingPhotos(true)
    setPhotosError(null)

    try {
      await apiFetch(`/appointments/${id}/photos`, {
        method: 'POST',
        body: JSON.stringify({ urls: addPhotosState.urls }),
      })
      setAddPhotosState({ urls: [], uploading: false })
      setAddPhotosKey((k) => k + 1) // remounts ImageUploadSection to clear its picked-files grid
      setRefreshIndex((i) => i + 1)
    } catch (err) {
      setPhotosError(err instanceof Error ? err.message : 'Failed to save photos')
    } finally {
      setSavingPhotos(false)
    }
  }

  async function handleDeletePhoto(photoId: string) {
    if (!id) return
    setDeletingPhotoId(photoId)
    setPhotosError(null)

    try {
      await apiFetch(`/appointments/${id}/photos/${photoId}`, { method: 'DELETE' })
      setRefreshIndex((i) => i + 1)
    } catch (err) {
      setPhotosError(err instanceof Error ? err.message : 'Failed to delete photo')
    } finally {
      setDeletingPhotoId(null)
    }
  }

  async function handleStatusChange(newStatus: string) {
    if (!id) return
    setUpdatingStatus(true)
    setStatusError(null)

    try {
      await apiFetch(`/appointments/${id}`, { method: 'PATCH', body: JSON.stringify({ status: newStatus }) })
      if (user) queryClient.invalidateQueries({ queryKey: appointmentsQueryKey(user.studioId) })
      setRefreshIndex((i) => i + 1)
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : 'Failed to update status')
    } finally {
      setUpdatingStatus(false)
    }
  }

  function openRescheduleModal() {
    if (!appointment) return
    const start = new Date(appointment.startTime)
    const end = new Date(appointment.endTime)
    setRescheduleRange({
      date: toDateString(start),
      startTime: start.toTimeString().slice(0, 5),
      endTime: end.toTimeString().slice(0, 5),
    })
    setRescheduleError(null)
    setRescheduleBufferWarning(null)
    setShowRescheduleModal(true)
  }

  async function handleReschedule(event: FormEvent) {
    event.preventDefault()
    if (!id) return

    if (!isCompleteTimeRange(rescheduleRange)) {
      setRescheduleError('Select a date, start time, and end time.')
      return
    }
    if (!isValidTimeRange(rescheduleRange)) {
      setRescheduleError('End time must be after start time.')
      return
    }

    const start = combineDateAndTime(rescheduleRange.date, rescheduleRange.startTime)!
    const end = combineDateAndTime(rescheduleRange.date, rescheduleRange.endTime)!

    setRescheduling(true)
    setRescheduleError(null)

    try {
      const updated = await apiFetch<{ bufferWarning: string | null }>(`/appointments/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ startTime: start.toISOString(), endTime: end.toISOString() }),
      })
      if (user) queryClient.invalidateQueries({ queryKey: appointmentsQueryKey(user.studioId) })
      setRefreshIndex((i) => i + 1)
      if (updated.bufferWarning) {
        setRescheduleBufferWarning(updated.bufferWarning)
      } else {
        setShowRescheduleModal(false)
      }
    } catch (err) {
      setRescheduleError(err instanceof Error ? err.message : 'Failed to reschedule this appointment')
    } finally {
      setRescheduling(false)
    }
  }

  async function handleArchive() {
    if (!id) return
    setArchiving(true)
    setArchiveError(null)
    try {
      await apiFetch(`/appointments/${id}/archive`, { method: 'POST' })
      if (user) queryClient.invalidateQueries({ queryKey: appointmentsQueryKey(user.studioId) })
      setRefreshIndex((i) => i + 1)
    } catch (err) {
      setArchiveError(err instanceof Error ? err.message : 'Failed to archive appointment')
    } finally {
      setArchiving(false)
    }
  }

  async function handleUnarchive() {
    if (!id) return
    setArchiving(true)
    setArchiveError(null)
    try {
      await apiFetch(`/appointments/${id}/unarchive`, { method: 'POST' })
      if (user) queryClient.invalidateQueries({ queryKey: appointmentsQueryKey(user.studioId) })
      setRefreshIndex((i) => i + 1)
    } catch (err) {
      setArchiveError(err instanceof Error ? err.message : 'Failed to unarchive appointment')
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
      const preview = await apiFetch<DeletePreview>(`/appointments/${id}/delete-preview`)
      setDeletePreview(preview)
    } catch (err) {
      setDeletePreviewError(err instanceof Error ? err.message : 'Failed to load what will be deleted')
    } finally {
      setDeletePreviewLoading(false)
    }
  }

  async function handleConfirmDelete() {
    if (!id || !appointment) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await apiFetch(`/appointments/${id}`, {
        method: 'DELETE',
        body: JSON.stringify({ confirm: deleteConfirmText }),
      })
      if (user) queryClient.invalidateQueries({ queryKey: appointmentsQueryKey(user.studioId) })
      navigate(`/inquiries/${appointment.inquiry.id}`)
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete appointment')
    } finally {
      setDeleting(false)
    }
  }

  // Post-checkout, appointment.giftCards only ever contains cards that
  // STAYED attached -- ROLL/EXEMPT cards were detached at checkout time
  // (appointmentId -> null), so whatever's left in this relation on a
  // later fetch IS exactly the redeemed set. Simpler than trying to
  // reconstruct "what was decided" from a value this page doesn't
  // separately persist.
  const checkoutRedeemedCards = appointment?.checkedOutAt ? (appointment.giftCards ?? []) : []
  const checkoutRedeemedTotalCents = checkoutRedeemedCards.reduce((sum, c) => sum + c.amountCents, 0)

  const checkoutAmountDue =
    appointment?.finalCostCents != null ? Math.max(0, appointment.finalCostCents - checkoutRedeemedTotalCents) : null

  const checkoutOverage =
    appointment?.finalCostCents != null ? Math.max(0, checkoutRedeemedTotalCents - appointment.finalCostCents) : 0

  return (
    <div className="flex min-h-screen bg-bg text-fg">
      <Sidebar />

      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 py-6 sm:px-10 sm:py-8">
          <Link
            to={appointment ? `/inquiries/${appointment.inquiry.id}` : '/calendar'}
            className="inline-flex items-center gap-2 text-sm text-fg-secondary hover:text-fg"
          >
            <ArrowLeftIcon className="h-4 w-4" />
            Back to {appointment ? 'Project' : 'Calendar'}
          </Link>

          {error && (
            <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
              <p className="text-sm text-danger">{error}</p>
            </div>
          )}

          {!error && !appointment && <p className="mt-6 text-sm text-fg-secondary">Loading appointment…</p>}

          {!error && appointment && (
            <>
              <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h1 className="text-xl font-bold text-fg">
                      {appointment.client.firstName} {appointment.client.lastName}
                    </h1>
                    <p className="mt-1 text-sm text-fg-secondary">
                      {formatDateTime(appointment.startTime)} – {formatDateTime(appointment.endTime)}
                    </p>
                    <p className="mt-1 flex items-center gap-1.5 text-sm text-fg-secondary">
                      Artist:
                      <ArtistAvatar artist={appointment.artist} className="h-5 w-5" />
                      {artistLabel(appointment.artist)}
                    </p>
                    <p className="mt-1 text-sm text-fg-secondary">Project: {appointment.inquiry.description}</p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => navigate(`/clients/${appointment.client.id}`)}
                      aria-label="View Client"
                      title="View Client"
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border text-fg transition hover:bg-surface md:h-auto md:w-auto md:gap-2 md:px-3 md:py-1.5"
                    >
                      <ClientsIcon className="h-4 w-4 md:h-3.5 md:w-3.5" />
                      <span className="hidden text-xs font-medium md:inline">View Client</span>
                    </button>
                    {canManage && (
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
                    {canManage ? (
                      <>
                        <select
                          value={appointment.status}
                          disabled={updatingStatus}
                          onChange={(event) => handleStatusChange(event.target.value)}
                          className="rounded-full border border-border bg-surface-inset px-3 py-1.5 text-xs font-medium text-fg-secondary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
                        >
                          {APPOINTMENT_STATUSES.map((status) => (
                            <option key={status} value={status}>
                              {formatStatus(status)}
                            </option>
                          ))}
                        </select>
                        {/* The dropdown above edits the raw status; this
                            pill is the derived one (waiver/checkout
                            urgency) -- only shown when it actually differs,
                            so a normal REQUESTED/CONFIRMED appointment
                            doesn't get a redundant second badge. */}
                        {describeAppointmentStatus(appointment) !== appointment.status && (
                          <StatusPill status={describeAppointmentStatus(appointment)} />
                        )}
                      </>
                    ) : (
                      <StatusPill status={describeAppointmentStatus(appointment)} />
                    )}
                    {canManage && (
                      <div className="relative flex self-stretch">
                        <button
                          type="button"
                          onClick={() => setShowMoreMenu((v) => !v)}
                          aria-label="More actions"
                          aria-pressed={showMoreMenu}
                          title="More actions"
                          className="flex aspect-square h-full shrink-0 items-center justify-center rounded-full text-fg-muted transition hover:bg-surface hover:text-fg"
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
                                  openRescheduleModal()
                                }}
                                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-fg-secondary hover:bg-surface"
                              >
                                Reschedule
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setShowMoreMenu(false)
                                  if (appointment.archivedAt) {
                                    handleUnarchive()
                                  } else {
                                    handleArchive()
                                  }
                                }}
                                disabled={archiving}
                                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-fg-secondary hover:bg-surface disabled:opacity-60"
                              >
                                {appointment.archivedAt ? 'Unarchive' : 'Archive'}
                              </button>
                              {user?.role === 'OWNER' && (
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

                {statusError && <p className="mt-2 text-sm text-danger">{statusError}</p>}
                {archiveError && <p className="mt-2 text-sm text-danger">{archiveError}</p>}

                {appointment.archivedAt && (
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
                    <span>
                      Archived {formatDateTime(appointment.archivedAt)}. Hidden from the calendar, but fully intact.
                    </span>
                    {canManage && (
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

                {appointment.notes && (
                  <p className="mt-4 border-t border-border pt-4 text-sm text-fg-secondary">{appointment.notes}</p>
                )}

                {appointment.giftCards.length > 0 && (
                  <div className="mt-4 border-t border-border pt-4 text-sm">
                    <span className="text-fg-muted">
                      Gift card{appointment.giftCards.length === 1 ? '' : `s (${appointment.giftCards.length})`}:{' '}
                    </span>
                    <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-1">
                      {appointment.giftCards.map((card, i) => (
                        <span key={card.id}>
                          <Link to={`/gift-cards/${card.id}`} className="text-fg hover:underline">
                            {card.status === 'EXEMPT'
                              ? `Deposit Exemption${card.exemptionReason ? ` (${card.exemptionReason})` : ''}`
                              : `${formatCents(card.amountCents)} (${formatStatus(card.status)})`}
                          </Link>
                          {i < appointment.giftCards.length - 1 ? ',' : ''}
                        </span>
                      ))}
                    </span>
                  </div>
                )}
              </div>

              {/* Package I: parent project context surfaced inline, no navigation away needed */}
              <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
                <h2 className="text-base font-semibold text-fg">Project details</h2>
                <div className="mt-3">
                  <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">Budget</p>
                  <p className="mt-1 text-sm text-fg">
                    {appointment.inquiry.budget ??
                      (appointment.inquiry.priceEstimateLow != null && appointment.inquiry.priceEstimateHigh != null
                        ? `$${appointment.inquiry.priceEstimateLow.toLocaleString('en-US')} – $${appointment.inquiry.priceEstimateHigh.toLocaleString('en-US')}`
                        : 'Not provided')}
                  </p>
                </div>

                {appointment.inquiry.referenceImages.length > 0 && (
                  <div className="mt-4">
                    <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">Reference images</p>
                    <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-6">
                      {appointment.inquiry.referenceImages.map((url) => (
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
                  </div>
                )}

                {appointment.inquiry.placementImages.length > 0 && (
                  <div className="mt-4">
                    <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">Placement photos</p>
                    <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-6">
                      {appointment.inquiry.placementImages.map((url) => (
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
                  </div>
                )}
              </div>

              {/* Waiver section */}
              <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
                <h2 className="text-base font-semibold text-fg">Liability Waiver</h2>

                {!appointment.liabilityWaiver && canManage && (
                  <div className="mt-4">
                    <p className="text-sm text-fg-secondary">No waiver created for this appointment yet.</p>
                    <button
                      type="button"
                      onClick={handleCreateWaiver}
                      disabled={creatingWaiver}
                      aria-label="Create Waiver"
                      title="Create Waiver"
                      className="mt-3 flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border text-fg transition hover:bg-surface disabled:opacity-60 md:h-auto md:w-auto md:gap-2 md:px-4 md:py-2"
                    >
                      <DocumentIcon className="h-4 w-4" />
                      <span className="hidden text-sm font-semibold md:inline">
                        {creatingWaiver ? 'Creating…' : 'Create Waiver'}
                      </span>
                    </button>
                    {waiverError && <p className="mt-2 text-sm text-danger">{waiverError}</p>}
                    {waiverSendNotice && <p className="mt-2 text-sm text-fg-secondary">{waiverSendNotice}</p>}
                  </div>
                )}

                {!appointment.liabilityWaiver && !canManage && (
                  <p className="mt-4 text-sm text-fg-secondary">No waiver yet.</p>
                )}

                {latestSigningUrl && (
                  <div className="mt-4 rounded-lg border border-border p-3">
                    <p className="mb-2 text-xs text-fg-muted">Share this link with the client to sign in-shop.</p>
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
                        onClick={() => handleCopyLink(latestSigningUrl)}
                        aria-label={copied ? 'Copied' : 'Copy link'}
                        title={copied ? 'Copied!' : 'Copy link'}
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-fg-secondary transition hover:bg-surface-raised hover:text-fg"
                      >
                        {copied ? <CheckIcon className="h-4 w-4 text-success" /> : <CopyIcon className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                )}

                {appointment.liabilityWaiver && (
                  <div className="mt-4">
                    <div className="flex flex-wrap items-center gap-3">
                      <StatusPill status={appointment.liabilityWaiver.status} />
                      {appointment.liabilityWaiver.signedAt && (
                        <span className="text-xs text-fg-muted">
                          Signed {formatDateTime(appointment.liabilityWaiver.signedAt)}
                        </span>
                      )}
                      {appointment.liabilityWaiver.verifiedAt && (
                        <span className="text-xs text-fg-muted">
                          Verified {formatDateTime(appointment.liabilityWaiver.verifiedAt)}
                        </span>
                      )}
                    </div>

                    {appointment.liabilityWaiver.status === 'PENDING' && canManage && waiverDetail?.signingUrl && (
                      <div className="mt-3 rounded-lg border border-border p-3">
                        <p className="mb-2 text-xs text-fg-muted">Waiting for the client to sign.</p>
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            readOnly
                            value={waiverDetail.signingUrl}
                            onFocus={(event) => event.target.select()}
                            className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => handleCopyLink(waiverDetail.signingUrl!)}
                            aria-label={copied ? 'Copied' : 'Copy link'}
                            title={copied ? 'Copied!' : 'Copy link'}
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-fg-secondary transition hover:bg-surface-raised hover:text-fg"
                          >
                            {copied ? <CheckIcon className="h-4 w-4 text-success" /> : <CopyIcon className="h-4 w-4" />}
                          </button>
                        </div>
                      </div>
                    )}

                    {canManage && waiverDetail && waiverDetail.status !== 'PENDING' && (
                      <div className="mt-4 space-y-4 border-t border-border pt-4 text-sm">
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <div>
                            <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">Legal name</p>
                            <p className="mt-1 text-fg">{waiverDetail.legalName}</p>
                          </div>
                          <div>
                            <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">
                              Date of birth
                            </p>
                            <p className="mt-1 text-fg">
                              {waiverDetail.dateOfBirth ? new Date(waiverDetail.dateOfBirth).toLocaleDateString() : '—'}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">
                              Emergency contact
                            </p>
                            <p className="mt-1 text-fg">
                              {waiverDetail.emergencyContactName} —{' '}
                              {waiverDetail.emergencyContactPhone
                                ? formatPhoneInput(waiverDetail.emergencyContactPhone)
                                : ''}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">Signature</p>
                            <p className="mt-1 text-fg">{waiverDetail.signatureName}</p>
                          </div>
                        </div>

                        {waiverDetail.idImageUrl && (
                          <div>
                            <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">
                              ID photo
                            </p>
                            <img
                              src={waiverDetail.idImageUrl}
                              alt="Government ID"
                              className="mt-2 max-h-64 rounded-lg border border-border"
                            />
                          </div>
                        )}

                        <div>
                          <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">
                            Health screening
                          </p>
                          <ul className="mt-2 space-y-2">
                            {waiverDetail.healthQuestionsSnapshot.map((q, i) => {
                              const answer = waiverDetail.healthAnswers?.find((a) => a.questionIndex === i)
                              return (
                                <li key={i} className="rounded-lg border border-border p-2">
                                  <p className="text-fg-secondary">{q.question}</p>
                                  <p className="mt-1 text-fg">
                                    {answer?.answer ?? '—'}
                                    {answer?.explanation ? ` — ${answer.explanation}` : ''}
                                  </p>
                                </li>
                              )
                            })}
                          </ul>
                        </div>

                        <div>
                          <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">
                            Initialed clauses
                          </p>
                          <ul className="mt-2 space-y-2">
                            {waiverDetail.clausesSnapshot.map((clause, i) => {
                              const initial = waiverDetail.clauseInitials?.find((c) => c.clauseIndex === i)
                              return (
                                <li key={i} className="rounded-lg border border-border p-2">
                                  <p className="text-fg-secondary">{clause}</p>
                                  <p className="mt-1 text-fg">Initialed: {initial?.initials ?? '—'}</p>
                                </li>
                              )
                            })}
                          </ul>
                        </div>

                        <div>
                          <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">
                            Photo/video release
                          </p>
                          <p className="mt-1 text-fg">
                            {waiverDetail.photoReleaseAccepted
                              ? `Accepted — signed by ${waiverDetail.photoReleaseSignatureName}`
                              : 'Declined'}
                          </p>
                        </div>

                        {waiverDetail.verifiedBy && (
                          <p className="text-xs text-fg-muted">
                            Verified by {waiverDetail.verifiedBy.name ?? waiverDetail.verifiedBy.email}
                          </p>
                        )}

                        {waiverDetail.status === 'SIGNED' && canManage && (
                          <div>
                            <button
                              type="button"
                              onClick={handleVerify}
                              disabled={verifying}
                              className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-60"
                            >
                              {verifying ? 'Verifying…' : 'Verify against ID'}
                            </button>
                            {verifyError && <p className="mt-2 text-sm text-danger">{verifyError}</p>}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {canManage && appointment.liabilityWaiver && (
                  <AuditTrail entityType="LiabilityWaiver" entityId={appointment.liabilityWaiver.id} />
                )}
              </div>

              {/* Checkout section */}
              {canManage && (
                <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
                  <h2 className="text-base font-semibold text-fg">Checkout</h2>

                  {!appointment.checkedOutAt && appointment.giftCards.length === 0 && (
                    <p className="mt-4 text-sm text-fg-secondary">
                      This appointment has no attached gift card — checkout is unavailable until that's resolved.
                    </p>
                  )}

                  {!appointment.checkedOutAt && appointment.giftCards.length > 0 && (
                    <form onSubmit={handleCheckout} className="mt-4 space-y-4">
                      <div>
                        <label className="mb-1 block text-sm font-medium text-fg-secondary">Final cost ($)</label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          required
                          value={checkoutForm.finalCostDollars}
                          onChange={(e) => setCheckoutForm({ ...checkoutForm, finalCostDollars: e.target.value })}
                          className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                        />
                      </div>

                      {exemptCards.length > 0 && (
                        <p className="rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg-secondary">
                          {exemptCards.length === 1 ? 'A deposit exemption' : `${exemptCards.length} deposit exemptions`}{' '}
                          on this appointment — no charge applied, handled automatically.
                        </p>
                      )}

                      {decidableCards.length > 0 && (
                        <div>
                          <span className="mb-2 block text-sm font-medium text-fg-secondary">
                            Deposit cards — redeem or roll each individually
                          </span>
                          <div className="space-y-2">
                            {decidableCards.map((card) => (
                              <div
                                key={card.id}
                                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-2.5"
                              >
                                <span className="text-sm text-fg">
                                  {formatCents(card.amountCents)}{' '}
                                  <span className="text-xs text-fg-muted">{card.code.slice(0, 8)}…</span>
                                </span>
                                <div className="flex gap-4">
                                  <label className="flex items-center gap-1.5 text-sm text-fg-secondary">
                                    <input
                                      type="radio"
                                      name={`decision-${card.id}`}
                                      checked={(cardDecisions[card.id] ?? 'REDEEM') === 'REDEEM'}
                                      onChange={() => setCardDecision(card.id, 'REDEEM')}
                                      className="accent-accent"
                                    />
                                    Redeem
                                  </label>
                                  <label className="flex items-center gap-1.5 text-sm text-fg-secondary">
                                    <input
                                      type="radio"
                                      name={`decision-${card.id}`}
                                      checked={cardDecisions[card.id] === 'ROLL'}
                                      onChange={() => setCardDecision(card.id, 'ROLL')}
                                      className="accent-accent"
                                    />
                                    Roll forward
                                  </label>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="rounded-lg border border-border p-3 text-sm">
                        <p className="text-fg-secondary">
                          Amount due today: <span className="font-semibold text-fg">{formatCents(amountDuePreview)}</span>
                        </p>
                        {overagePreview > 0 && (
                          <p className="mt-1 text-warning">
                            Redeemed total exceeds final cost by {formatCents(overagePreview)} — a new gift card will
                            be issued to this client for the difference.
                          </p>
                        )}
                      </div>

                      <div>
                        <label className="mb-1 block text-sm font-medium text-fg-secondary">Closeout notes</label>
                        <textarea
                          rows={3}
                          value={checkoutForm.closeoutNotes}
                          onChange={(e) => setCheckoutForm({ ...checkoutForm, closeoutNotes: e.target.value })}
                          className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                        />
                      </div>

                      <ImageUploadSection
                        label="Finished tattoo photos (optional)"
                        hint="Attach now, or skip and add them later from this same page."
                        onChange={setCheckoutPhotos}
                        uploadFn={uploadAppointmentPhoto}
                      />

                      {checkoutError && <p className="text-sm text-danger">{checkoutError}</p>}

                      <button
                        type="submit"
                        disabled={checkingOut || checkoutPhotos.uploading || !checkoutForm.finalCostDollars}
                        className="w-full rounded-full bg-accent px-4 py-2 text-sm font-medium text-bg transition hover:bg-accent-hover disabled:opacity-60"
                      >
                        {checkingOut ? 'Checking out…' : 'Confirm Checkout'}
                      </button>
                    </form>
                  )}

                  {appointment.checkedOutAt && (
                    <div className="mt-4 space-y-3 text-sm">
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">Final cost</p>
                          <p className="mt-1 text-fg">{formatCents(appointment.finalCostCents ?? 0)}</p>
                        </div>
                        <div>
                          <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">Deposit</p>
                          <p className="mt-1 text-fg">
                            {checkoutRedeemedCards.length > 0
                              ? `${checkoutRedeemedCards.length} card${checkoutRedeemedCards.length === 1 ? '' : 's'} redeemed (${formatCents(checkoutRedeemedTotalCents)})`
                              : 'Rolled forward'}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">
                            Amount due
                          </p>
                          <p className="mt-1 text-fg">{formatCents(checkoutAmountDue ?? 0)}</p>
                        </div>
                        <div>
                          <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">
                            Checked out
                          </p>
                          <p className="mt-1 text-fg">
                            {formatDateTime(appointment.checkedOutAt)} by{' '}
                            {appointment.checkedOutBy?.name ?? appointment.checkedOutBy?.email ?? '—'}
                          </p>
                        </div>
                      </div>

                      {checkoutOverage > 0 &&
                        (checkoutResult?.newGiftCard ? (
                          <p className="rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-success">
                            Redeemed total exceeded final cost by {formatCents(checkoutOverage)} — a new{' '}
                            <Link to={`/gift-cards/${checkoutResult.newGiftCard.id}`} className="underline">
                              {formatCents(checkoutResult.newGiftCard.amountCents)} gift card
                            </Link>{' '}
                            was issued to this client for the difference.
                          </p>
                        ) : (
                          <p className="text-warning">
                            Redeemed total exceeded final cost by {formatCents(checkoutOverage)} — a new gift card was
                            issued to this client for the difference (see their profile).
                          </p>
                        ))}

                      {appointment.closeoutNotes && (
                        <div>
                          <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">
                            Closeout notes
                          </p>
                          <p className="mt-1 whitespace-pre-wrap text-fg-secondary">{appointment.closeoutNotes}</p>
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={() =>
                          navigate(
                            `/calendar?prefillClientId=${appointment.client.id}&prefillInquiryId=${appointment.inquiry.id}`,
                          )
                        }
                        className="rounded-full border border-border px-4 py-2 text-sm font-medium text-fg transition hover:bg-surface"
                      >
                        Book follow-up
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Package N: separate from the checkout form's own optional
                  picker above -- this is the "forgot at checkout" path,
                  always available regardless of checkout state, and also
                  just the normal way to add more photos later. */}
              <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
                <h2 className="text-base font-semibold text-fg">Photos</h2>

                {appointment.photos.length === 0 && (
                  <p className="mt-4 text-sm text-fg-secondary">No photos yet.</p>
                )}

                {appointment.photos.length > 0 && (
                  <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-4">
                    {appointment.photos.map((photo) => (
                      <div key={photo.id} className="group relative aspect-square overflow-hidden rounded-lg border border-border">
                        <a href={photo.url} target="_blank" rel="noreferrer" className="block h-full w-full">
                          <img src={photo.url} alt="" className="h-full w-full object-cover transition group-hover:opacity-80" />
                        </a>
                        {canManage && (
                          <button
                            type="button"
                            onClick={() => handleDeletePhoto(photo.id)}
                            disabled={deletingPhotoId === photo.id}
                            aria-label="Delete photo"
                            title="Delete photo"
                            className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-xs text-fg opacity-0 transition hover:bg-danger/80 group-hover:opacity-100 disabled:opacity-100"
                          >
                            {deletingPhotoId === photo.id ? '…' : '×'}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {canManage && (
                  <div className="mt-4 border-t border-border pt-4">
                    <ImageUploadSection
                      key={addPhotosKey}
                      label="Add photos"
                      hint="Attach more finished-tattoo photos to this session at any time."
                      onChange={setAddPhotosState}
                      uploadFn={uploadAppointmentPhoto}
                    />
                    {photosError && <p className="mt-2 text-sm text-danger">{photosError}</p>}
                    <button
                      type="button"
                      onClick={handleAddPhotos}
                      disabled={savingPhotos || addPhotosState.uploading || addPhotosState.urls.length === 0}
                      className="mt-3 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {savingPhotos ? 'Saving…' : 'Save Photos'}
                    </button>
                  </div>
                )}
              </div>

              <AuditTrail entityType="Appointment" entityId={appointment.id} />

              {showRescheduleModal && (
                <Modal
                  title="Reschedule Appointment"
                  onClose={() => {
                    setShowRescheduleModal(false)
                    setRescheduleError(null)
                    setRescheduleBufferWarning(null)
                  }}
                >
                  <form onSubmit={handleReschedule} className="space-y-4">
                    <DateAndTimeRangeFields
                      value={rescheduleRange}
                      onChange={setRescheduleRange}
                      disabled={rescheduling}
                    />

                    {rescheduleBufferWarning && (
                      <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
                        {rescheduleBufferWarning}
                      </div>
                    )}

                    {rescheduleError && <p className="text-sm text-danger">{rescheduleError}</p>}

                    <button
                      type="submit"
                      disabled={rescheduling}
                      className="w-full rounded-full bg-accent px-4 py-2 text-sm font-medium text-bg transition hover:bg-accent-hover disabled:opacity-60"
                    >
                      {rescheduling ? 'Rescheduling…' : 'Confirm New Time'}
                    </button>
                  </form>
                </Modal>
              )}

              {showDeleteModal && (
                <Modal
                  title="Delete Appointment Permanently"
                  onClose={() => {
                    setShowDeleteModal(false)
                    setDeletePreview(null)
                    setDeletePreviewError(null)
                    setDeleteError(null)
                  }}
                >
                  <div className="space-y-4">
                    <p className="text-sm text-fg-secondary">
                      Permanently delete this appointment for{' '}
                      <span className="font-semibold">
                        {appointment.client.firstName} {appointment.client.lastName}
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
                          <li>{deletePreview.waivers} signed waiver{deletePreview.waivers === 1 ? '' : 's'}</li>
                          {deletePreview.photos > 0 && (
                            <li>{deletePreview.photos} photo{deletePreview.photos === 1 ? '' : 's'}</li>
                          )}
                        </ul>
                        {deletePreview.giftCardsToDetach.length > 0 && (
                          <p className="mt-2 font-semibold text-danger">
                            {deletePreview.giftCardsToDetach.length === 1
                              ? `The attached gift card (${formatCents(deletePreview.giftCardsToDetach[0].amountCents)})`
                              : `The ${deletePreview.giftCardsToDetach.length} attached gift cards (${formatCents(deletePreview.giftCardsToDetach.reduce((sum, c) => sum + c.amountCents, 0))} total)`}{' '}
                            will be detached and kept active — not destroyed. It's the client's money, independent of
                            this session.
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
            </>
          )}
        </div>
      </div>
    </div>
  )
}
