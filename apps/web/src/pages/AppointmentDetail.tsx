import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import Sidebar from '../components/Sidebar'
import AuditTrail from '../components/AuditTrail'
import { apiFetch, ApiError } from '../lib/api'
import { formatDateTime, formatStatus } from '../lib/format'
import { formatCents, dollarsToCents } from '../lib/money'
import { ArrowLeftIcon, MessageIcon } from '../components/icons'
import { useAuth } from '../context/useAuth'
import { useConversationPanel } from '../context/useConversationPanel'
import { appointmentsQueryKey } from '../lib/queryKeys'

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
}

interface Appointment {
  id: string
  startTime: string
  endTime: string
  status: string
  notes: string | null
  finalCostCents: number | null
  closeoutNotes: string | null
  checkedOutAt: string | null
  checkedOutBy: { id: string; name: string | null; email: string } | null
  client: { id: string; firstName: string; lastName: string }
  artist: { id: string; user: { email: string; name: string | null } }
  inquiry: { id: string; description: string; clientId: string }
  giftCard: GiftCardSummary | null
  liabilityWaiver: WaiverSummary | null
}

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

const EMPTY_CHECKOUT_FORM = { finalCostDollars: '', depositDecision: 'REDEEM' as 'REDEEM' | 'ROLL', closeoutNotes: '' }

export default function AppointmentDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()
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
  const [latestSigningUrl, setLatestSigningUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const [verifying, setVerifying] = useState(false)
  const [verifyError, setVerifyError] = useState<string | null>(null)

  const [checkoutForm, setCheckoutForm] = useState(EMPTY_CHECKOUT_FORM)
  const [checkingOut, setCheckingOut] = useState(false)
  const [checkoutError, setCheckoutError] = useState<string | null>(null)

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

    try {
      const result = await apiFetch<{ signingUrl: string }>(`/appointments/${id}/waiver`, { method: 'POST' })
      setLatestSigningUrl(result.signingUrl)
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
  const cardAmountCents = appointment?.giftCard?.amountCents ?? 0
  const amountDuePreview =
    checkoutForm.depositDecision === 'REDEEM' ? Math.max(0, finalCostCents - cardAmountCents) : finalCostCents
  const remainderPreview =
    checkoutForm.depositDecision === 'REDEEM' ? Math.max(0, cardAmountCents - finalCostCents) : 0

  async function handleCheckout(event: FormEvent) {
    event.preventDefault()
    if (!id) return

    setCheckingOut(true)
    setCheckoutError(null)

    try {
      await apiFetch(`/appointments/${id}/checkout`, {
        method: 'POST',
        body: JSON.stringify({
          finalCostCents,
          depositDecision: checkoutForm.depositDecision,
          closeoutNotes: checkoutForm.closeoutNotes || undefined,
        }),
      })

      if (user) queryClient.invalidateQueries({ queryKey: appointmentsQueryKey(user.studioId) })
      setRefreshIndex((i) => i + 1)
    } catch (err) {
      setCheckoutError(err instanceof Error ? err.message : 'Failed to check out this appointment')
    } finally {
      setCheckingOut(false)
    }
  }

  const checkoutDecision: 'REDEEM' | 'ROLL' | null = appointment?.checkedOutAt
    ? appointment.giftCard && appointment.giftCard.status === 'REDEEMED'
      ? 'REDEEM'
      : 'ROLL'
    : null

  const checkoutAmountDue =
    appointment?.finalCostCents != null
      ? checkoutDecision === 'REDEEM'
        ? Math.max(0, appointment.finalCostCents - (appointment.giftCard?.amountCents ?? 0))
        : appointment.finalCostCents
      : null

  const checkoutRemainder =
    appointment?.finalCostCents != null && checkoutDecision === 'REDEEM'
      ? Math.max(0, (appointment.giftCard?.amountCents ?? 0) - appointment.finalCostCents)
      : 0

  return (
    <div className="flex min-h-screen bg-neutral-900 text-white">
      <Sidebar />

      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 py-6 sm:px-10 sm:py-8">
          <Link to="/appointments" className="inline-flex items-center gap-2 text-sm text-neutral-400 hover:text-white">
            <ArrowLeftIcon className="h-4 w-4" />
            Back to Appointments
          </Link>

          {error && (
            <div className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          {!error && !appointment && <p className="mt-6 text-sm text-neutral-400">Loading appointment…</p>}

          {!error && appointment && (
            <>
              <div className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h1 className="text-xl font-bold text-white">
                      <Link to={`/clients/${appointment.client.id}`} className="hover:underline">
                        {appointment.client.firstName} {appointment.client.lastName}
                      </Link>
                    </h1>
                    <p className="mt-1 text-sm text-neutral-400">
                      {formatDateTime(appointment.startTime)} – {formatDateTime(appointment.endTime)}
                    </p>
                    <p className="mt-1 text-sm text-neutral-400">
                      Artist: {appointment.artist.user.name ?? appointment.artist.user.email}
                    </p>
                    <p className="mt-1 text-sm text-neutral-400">Project: {appointment.inquiry.description}</p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {canManage && (
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
                    <span className="inline-flex items-center rounded-full border border-neutral-700 px-3 py-1 text-xs font-medium text-neutral-300">
                      {formatStatus(appointment.status)}
                    </span>
                  </div>
                </div>

                {appointment.notes && (
                  <p className="mt-4 border-t border-neutral-800 pt-4 text-sm text-neutral-300">{appointment.notes}</p>
                )}

                {appointment.giftCard && (
                  <div className="mt-4 border-t border-neutral-800 pt-4 text-sm">
                    <span className="text-neutral-500">Gift card: </span>
                    <Link to={`/gift-cards/${appointment.giftCard.id}`} className="text-white hover:underline">
                      {formatCents(appointment.giftCard.amountCents)} ({formatStatus(appointment.giftCard.status)})
                    </Link>
                  </div>
                )}
              </div>

              {/* Waiver section */}
              <div className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
                <h2 className="text-base font-semibold text-white">Liability Waiver</h2>

                {!appointment.liabilityWaiver && canManage && (
                  <div className="mt-4">
                    <p className="text-sm text-neutral-400">No waiver created for this appointment yet.</p>
                    <button
                      type="button"
                      onClick={handleCreateWaiver}
                      disabled={creatingWaiver}
                      className="mt-3 rounded-full border border-neutral-700 bg-neutral-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-600 disabled:opacity-60"
                    >
                      {creatingWaiver ? 'Creating…' : 'Create Waiver'}
                    </button>
                    {waiverError && <p className="mt-2 text-sm text-red-400">{waiverError}</p>}
                  </div>
                )}

                {!appointment.liabilityWaiver && !canManage && (
                  <p className="mt-4 text-sm text-neutral-400">No waiver yet.</p>
                )}

                {latestSigningUrl && (
                  <div className="mt-4 rounded-lg border border-neutral-800 p-3">
                    <p className="mb-2 text-xs text-neutral-500">Share this link with the client to sign in-shop.</p>
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
                        onClick={() => handleCopyLink(latestSigningUrl)}
                        className="shrink-0 rounded-full border border-neutral-700 bg-neutral-800 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-700"
                      >
                        {copied ? 'Copied!' : 'Copy Link'}
                      </button>
                    </div>
                  </div>
                )}

                {appointment.liabilityWaiver && (
                  <div className="mt-4">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="inline-flex items-center rounded-full border border-neutral-700 px-3 py-1 text-xs font-medium text-neutral-300">
                        {formatStatus(appointment.liabilityWaiver.status)}
                      </span>
                      {appointment.liabilityWaiver.signedAt && (
                        <span className="text-xs text-neutral-500">
                          Signed {formatDateTime(appointment.liabilityWaiver.signedAt)}
                        </span>
                      )}
                      {appointment.liabilityWaiver.verifiedAt && (
                        <span className="text-xs text-neutral-500">
                          Verified {formatDateTime(appointment.liabilityWaiver.verifiedAt)}
                        </span>
                      )}
                    </div>

                    {appointment.liabilityWaiver.status === 'PENDING' && canManage && waiverDetail?.token && (
                      <div className="mt-3 rounded-lg border border-neutral-800 p-3">
                        <p className="mb-2 text-xs text-neutral-500">Waiting for the client to sign.</p>
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            readOnly
                            value={`${window.location.origin}/waiver/${waiverDetail.token}`}
                            onFocus={(event) => event.target.select()}
                            className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => handleCopyLink(`${window.location.origin}/waiver/${waiverDetail.token}`)}
                            className="shrink-0 rounded-full border border-neutral-700 bg-neutral-800 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-700"
                          >
                            {copied ? 'Copied!' : 'Copy Link'}
                          </button>
                        </div>
                      </div>
                    )}

                    {canManage && waiverDetail && waiverDetail.status !== 'PENDING' && (
                      <div className="mt-4 space-y-4 border-t border-neutral-800 pt-4 text-sm">
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <div>
                            <p className="text-xs font-medium uppercase tracking-wider text-neutral-500">Legal name</p>
                            <p className="mt-1 text-white">{waiverDetail.legalName}</p>
                          </div>
                          <div>
                            <p className="text-xs font-medium uppercase tracking-wider text-neutral-500">
                              Date of birth
                            </p>
                            <p className="mt-1 text-white">
                              {waiverDetail.dateOfBirth ? new Date(waiverDetail.dateOfBirth).toLocaleDateString() : '—'}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs font-medium uppercase tracking-wider text-neutral-500">
                              Emergency contact
                            </p>
                            <p className="mt-1 text-white">
                              {waiverDetail.emergencyContactName} — {waiverDetail.emergencyContactPhone}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs font-medium uppercase tracking-wider text-neutral-500">Signature</p>
                            <p className="mt-1 text-white">{waiverDetail.signatureName}</p>
                          </div>
                        </div>

                        {waiverDetail.idImageUrl && (
                          <div>
                            <p className="text-xs font-medium uppercase tracking-wider text-neutral-500">
                              ID photo
                            </p>
                            <img
                              src={waiverDetail.idImageUrl}
                              alt="Government ID"
                              className="mt-2 max-h-64 rounded-lg border border-neutral-800"
                            />
                          </div>
                        )}

                        <div>
                          <p className="text-xs font-medium uppercase tracking-wider text-neutral-500">
                            Health screening
                          </p>
                          <ul className="mt-2 space-y-2">
                            {waiverDetail.healthQuestionsSnapshot.map((q, i) => {
                              const answer = waiverDetail.healthAnswers?.find((a) => a.questionIndex === i)
                              return (
                                <li key={i} className="rounded-lg border border-neutral-800 p-2">
                                  <p className="text-neutral-300">{q.question}</p>
                                  <p className="mt-1 text-white">
                                    {answer?.answer ?? '—'}
                                    {answer?.explanation ? ` — ${answer.explanation}` : ''}
                                  </p>
                                </li>
                              )
                            })}
                          </ul>
                        </div>

                        <div>
                          <p className="text-xs font-medium uppercase tracking-wider text-neutral-500">
                            Initialed clauses
                          </p>
                          <ul className="mt-2 space-y-2">
                            {waiverDetail.clausesSnapshot.map((clause, i) => {
                              const initial = waiverDetail.clauseInitials?.find((c) => c.clauseIndex === i)
                              return (
                                <li key={i} className="rounded-lg border border-neutral-800 p-2">
                                  <p className="text-neutral-300">{clause}</p>
                                  <p className="mt-1 text-white">Initialed: {initial?.initials ?? '—'}</p>
                                </li>
                              )
                            })}
                          </ul>
                        </div>

                        <div>
                          <p className="text-xs font-medium uppercase tracking-wider text-neutral-500">
                            Photo/video release
                          </p>
                          <p className="mt-1 text-white">
                            {waiverDetail.photoReleaseAccepted
                              ? `Accepted — signed by ${waiverDetail.photoReleaseSignatureName}`
                              : 'Declined'}
                          </p>
                        </div>

                        {waiverDetail.verifiedBy && (
                          <p className="text-xs text-neutral-500">
                            Verified by {waiverDetail.verifiedBy.name ?? waiverDetail.verifiedBy.email}
                          </p>
                        )}

                        {waiverDetail.status === 'SIGNED' && canManage && (
                          <div>
                            <button
                              type="button"
                              onClick={handleVerify}
                              disabled={verifying}
                              className="rounded-full border border-neutral-700 bg-neutral-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-neutral-600 disabled:opacity-60"
                            >
                              {verifying ? 'Verifying…' : 'Verify against ID'}
                            </button>
                            {verifyError && <p className="mt-2 text-sm text-red-400">{verifyError}</p>}
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
                <div className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
                  <h2 className="text-base font-semibold text-white">Checkout</h2>

                  {!appointment.checkedOutAt && !appointment.giftCard && (
                    <p className="mt-4 text-sm text-neutral-400">
                      This appointment has no attached gift card — checkout is unavailable until that's resolved.
                    </p>
                  )}

                  {!appointment.checkedOutAt && appointment.giftCard && (
                    <form onSubmit={handleCheckout} className="mt-4 space-y-4">
                      <div>
                        <label className="mb-1 block text-sm font-medium text-neutral-300">Final cost ($)</label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          required
                          value={checkoutForm.finalCostDollars}
                          onChange={(e) => setCheckoutForm({ ...checkoutForm, finalCostDollars: e.target.value })}
                          className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600"
                        />
                      </div>

                      <div>
                        <span className="mb-2 block text-sm font-medium text-neutral-300">
                          Deposit ({formatCents(appointment.giftCard.amountCents)})
                        </span>
                        <div className="flex gap-4">
                          <label className="flex items-center gap-2 text-sm text-neutral-300">
                            <input
                              type="radio"
                              name="depositDecision"
                              checked={checkoutForm.depositDecision === 'REDEEM'}
                              onChange={() => setCheckoutForm({ ...checkoutForm, depositDecision: 'REDEEM' })}
                              className="accent-neutral-400"
                            />
                            Redeem toward today's cost
                          </label>
                          <label className="flex items-center gap-2 text-sm text-neutral-300">
                            <input
                              type="radio"
                              name="depositDecision"
                              checked={checkoutForm.depositDecision === 'ROLL'}
                              onChange={() => setCheckoutForm({ ...checkoutForm, depositDecision: 'ROLL' })}
                              className="accent-neutral-400"
                            />
                            Roll to a future appointment
                          </label>
                        </div>
                      </div>

                      <div className="rounded-lg border border-neutral-800 p-3 text-sm">
                        <p className="text-neutral-400">
                          Amount due today: <span className="font-semibold text-white">{formatCents(amountDuePreview)}</span>
                        </p>
                        {remainderPreview > 0 && (
                          <p className="mt-1 text-amber-300">
                            Deposit exceeds final cost by {formatCents(remainderPreview)} — handle the remainder
                            manually (no refund processing yet).
                          </p>
                        )}
                      </div>

                      <div>
                        <label className="mb-1 block text-sm font-medium text-neutral-300">Closeout notes</label>
                        <textarea
                          rows={3}
                          value={checkoutForm.closeoutNotes}
                          onChange={(e) => setCheckoutForm({ ...checkoutForm, closeoutNotes: e.target.value })}
                          className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-white focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600"
                        />
                      </div>

                      {checkoutError && <p className="text-sm text-red-400">{checkoutError}</p>}

                      <button
                        type="submit"
                        disabled={checkingOut || !checkoutForm.finalCostDollars}
                        className="w-full rounded-full border border-neutral-700 bg-neutral-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-600 disabled:opacity-60"
                      >
                        {checkingOut ? 'Checking out…' : 'Confirm Checkout'}
                      </button>
                    </form>
                  )}

                  {appointment.checkedOutAt && (
                    <div className="mt-4 space-y-3 text-sm">
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <p className="text-xs font-medium uppercase tracking-wider text-neutral-500">Final cost</p>
                          <p className="mt-1 text-white">{formatCents(appointment.finalCostCents ?? 0)}</p>
                        </div>
                        <div>
                          <p className="text-xs font-medium uppercase tracking-wider text-neutral-500">Deposit</p>
                          <p className="mt-1 text-white">{checkoutDecision === 'REDEEM' ? 'Redeemed' : 'Rolled forward'}</p>
                        </div>
                        <div>
                          <p className="text-xs font-medium uppercase tracking-wider text-neutral-500">
                            Amount due
                          </p>
                          <p className="mt-1 text-white">{formatCents(checkoutAmountDue ?? 0)}</p>
                        </div>
                        <div>
                          <p className="text-xs font-medium uppercase tracking-wider text-neutral-500">
                            Checked out
                          </p>
                          <p className="mt-1 text-white">
                            {formatDateTime(appointment.checkedOutAt)} by{' '}
                            {appointment.checkedOutBy?.name ?? appointment.checkedOutBy?.email ?? '—'}
                          </p>
                        </div>
                      </div>

                      {checkoutRemainder > 0 && (
                        <p className="text-amber-300">
                          Deposit exceeded final cost by {formatCents(checkoutRemainder)} — handled manually.
                        </p>
                      )}

                      {appointment.closeoutNotes && (
                        <div>
                          <p className="text-xs font-medium uppercase tracking-wider text-neutral-500">
                            Closeout notes
                          </p>
                          <p className="mt-1 whitespace-pre-wrap text-neutral-300">{appointment.closeoutNotes}</p>
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={() =>
                          navigate(
                            `/appointments?prefillClientId=${appointment.client.id}&prefillInquiryId=${appointment.inquiry.id}`,
                          )
                        }
                        className="rounded-full border border-neutral-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-800"
                      >
                        Book follow-up
                      </button>
                    </div>
                  )}
                </div>
              )}

              <AuditTrail entityType="Appointment" entityId={appointment.id} />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
