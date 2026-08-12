import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { apiFetch, ApiError } from '../lib/api'
import { formatDateTime, formatPhoneInput } from '../lib/format'
import { ArrowLeftIcon } from '../components/icons'
import { useEffectiveUser } from '../context/useEffectiveUser'
import { useUserProfile } from '../context/useUserProfile'
import QrCode from '../components/QrCode'
import AuditTrail from '../components/AuditTrail'
import StatusPill from '../components/StatusPill'
import Modal from '../components/Modal'
import SendChannelButton, { type SendChannel } from '../components/SendChannelButton'

interface HolderSearchCandidate {
  id: string
  firstName: string
  lastName: string
  email: string | null
  phone: string | null
}

interface AttachableAppointment {
  id: string
  startTime: string
  status: string
}

interface GiftCard {
  id: string
  code: string
  amountCents: number
  status: string
  expiresAt: string | null
  createdAt: string
  client: {
    id: string
    firstName: string
    lastName: string
    phone: string | null
    email: string | null
    phones: { id: string }[]
    emails: { id: string }[]
  }
  appointment: {
    id: string
    startTime: string
    endTime: string
    giftCards: { id: string; code: string; amountCents: number; status: string }[]
  } | null
  // Null once the staff member who issued it has been deleted from the
  // studio -- the card's own value/status survives regardless.
  issuedBy: { id: string; name: string | null; email: string } | null
  // Null for cards this session's cash-payment feature can't honestly
  // backfill (bulk client import, multi-card checkout overage) -- see
  // GiftCardPaymentMethod's own schema comment. Every NEW card has one.
  paymentMethod: 'STRIPE' | 'CASH' | 'EXEMPT' | null
  exemptionReason: string | null
  publicUrl: string
  derivedFromGiftCard: { id: string; code: string; amountCents: number } | null
}

export default function GiftCardDetail() {
  const { id } = useParams<{ id: string }>()
  const user = useEffectiveUser()
  const { profile } = useUserProfile()
  const canTextReceipt = profile?.permissions.includes('giftCards.issue') ?? false
  const canViewAudit = profile?.permissions.includes('audit.view') ?? false
  const canVoid = profile?.permissions.includes('giftCards.void') ?? false
  // Same tier as canTextReceipt above -- PATCH /:id/holder's own gate.
  // Named separately for readability at each call site.
  const canReassignHolder = canTextReceipt
  // Attach to Session: matrix-gated like Transfer to Client above -- same
  // giftCards.issue tier PATCH /:id/attachment already enforces server-side.
  const canAttachToSession = canTextReceipt
  // PATCH /:id (expiration) is deliberately left hardcoded OWNER-only on
  // the API -- no configurable permission key covers "edit a card's
  // expiration" without either overreaching giftCards.issue's default
  // scope or inventing a new key, so this one genuinely stays a role check.
  const canEditExpiry = user?.role === 'OWNER'

  const [card, setCard] = useState<GiftCard | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshIndex, setRefreshIndex] = useState(0)

  const [copied, setCopied] = useState(false)
  const [voiding, setVoiding] = useState(false)
  const [voidError, setVoidError] = useState<string | null>(null)

  const [redeeming, setRedeeming] = useState(false)
  const [redeemError, setRedeemError] = useState<string | null>(null)

  const [sendingReceipt, setSendingReceipt] = useState(false)
  const [receiptSent, setReceiptSent] = useState(false)
  const [receiptError, setReceiptError] = useState<string | null>(null)

  const [editingExpiry, setEditingExpiry] = useState(false)
  const [expiryForm, setExpiryForm] = useState('')
  const [savingExpiry, setSavingExpiry] = useState(false)
  const [expiryError, setExpiryError] = useState<string | null>(null)

  const [showReassignHolder, setShowReassignHolder] = useState(false)
  const [holderSearchQuery, setHolderSearchQuery] = useState('')
  const [holderSearchResults, setHolderSearchResults] = useState<HolderSearchCandidate[]>([])
  const [holderSearchLoading, setHolderSearchLoading] = useState(false)
  const [reassigning, setReassigning] = useState(false)
  const [reassignError, setReassignError] = useState<string | null>(null)

  const [showAttachSession, setShowAttachSession] = useState(false)
  const [sessionOptions, setSessionOptions] = useState<AttachableAppointment[] | null>(null)
  const [attaching, setAttaching] = useState(false)
  const [attachError, setAttachError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return

    let ignore = false

    apiFetch<GiftCard>(`/gift-cards/${id}`)
      .then((data) => {
        if (ignore) return
        setCard(data)
        setExpiryForm(data.expiresAt ? data.expiresAt.slice(0, 10) : '')
      })
      .catch((err) => {
        if (ignore) return
        if (err instanceof ApiError && err.status === 404) {
          setError('Gift card not found.')
        } else {
          setError(err instanceof Error ? err.message : 'Failed to load gift card')
        }
      })

    return () => {
      ignore = true
    }
  }, [id, refreshIndex])

  // Same debounced-search pattern as ClientDetail.tsx's own manual-merge
  // picker, reusing that exact endpoint -- it's already a general "find
  // any client in this studio" search, not merge-specific despite the
  // route name (see that route's own comment). excludeId keeps the
  // current holder out of their own reassignment results.
  useEffect(() => {
    if (!showReassignHolder || !card) return
    if (holderSearchQuery.trim().length < 2) {
      setHolderSearchResults([])
      setHolderSearchLoading(false)
      return
    }

    let ignore = false
    setHolderSearchLoading(true)
    const timeout = setTimeout(async () => {
      try {
        const results = await apiFetch<HolderSearchCandidate[]>(
          `/clients/merge-search?q=${encodeURIComponent(holderSearchQuery.trim())}&excludeId=${card.client.id}`,
        )
        if (!ignore) setHolderSearchResults(results)
      } catch {
        if (!ignore) setHolderSearchResults([])
      } finally {
        if (!ignore) setHolderSearchLoading(false)
      }
    }, 300)

    return () => {
      ignore = true
      clearTimeout(timeout)
    }
  }, [holderSearchQuery, showReassignHolder, card])

  // Attach to Session: this card's client's own upcoming, still-open
  // appointments -- REQUESTED/CONFIRMED and not yet started, same
  // "upcoming" definition the transfer-to-artist epic's own execution
  // engine used for cancelling future appointments. PATCH /:id/attachment
  // itself doesn't restrict by status or time (any of this client's
  // appointments qualifies server-side), but offering a completed or
  // cancelled one here would be a confusing choice, not a real one.
  useEffect(() => {
    if (!showAttachSession || !card) return
    let ignore = false
    setSessionOptions(null)
    apiFetch<AttachableAppointment[]>(`/appointments?clientId=${card.client.id}`)
      .then((results) => {
        if (ignore) return
        const now = Date.now()
        setSessionOptions(
          results.filter(
            (a) => (a.status === 'REQUESTED' || a.status === 'CONFIRMED') && new Date(a.startTime).getTime() >= now,
          ),
        )
      })
      .catch(() => {
        if (!ignore) setSessionOptions([])
      })
    return () => {
      ignore = true
    }
  }, [showAttachSession, card])

  // The API's own shortLinks.shortenUrl -- same short code the client's
  // text-receipt SMS and the shareable-links composer already send them,
  // not a full-length URL reconstructed from the raw code client-side.
  const publicUrl = card?.publicUrl ?? null

  async function handleCopyLink() {
    if (!publicUrl) return
    try {
      await navigator.clipboard.writeText(publicUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard access can fail (permissions); the link is visible to copy manually.
    }
  }

  async function handleVoid() {
    if (!id) return

    setVoiding(true)
    setVoidError(null)

    try {
      await apiFetch(`/gift-cards/${id}/void`, { method: 'POST' })
      setRefreshIndex((index) => index + 1)
    } catch (err) {
      setVoidError(err instanceof Error ? err.message : 'Failed to void gift card')
    } finally {
      setVoiding(false)
    }
  }

  async function handleRedeem() {
    if (!id) return

    setRedeeming(true)
    setRedeemError(null)

    try {
      await apiFetch(`/gift-cards/${id}/redeem`, { method: 'POST' })
      setRefreshIndex((index) => index + 1)
    } catch (err) {
      setRedeemError(err instanceof Error ? err.message : 'Failed to redeem gift card')
    } finally {
      setRedeeming(false)
    }
  }

  async function handleSendReceipt(channel: SendChannel = 'SMS') {
    if (!id) return

    setSendingReceipt(true)
    setReceiptError(null)
    setReceiptSent(false)

    try {
      await apiFetch(`/gift-cards/${id}/text-receipt`, { method: 'POST', body: JSON.stringify({ channel }) })
      setReceiptSent(true)
      setTimeout(() => setReceiptSent(false), 4000)
    } catch (err) {
      setReceiptError(err instanceof Error ? err.message : 'Failed to send receipt')
    } finally {
      setSendingReceipt(false)
    }
  }

  async function handleReassignHolder(candidate: HolderSearchCandidate) {
    if (!id) return

    setReassigning(true)
    setReassignError(null)

    try {
      await apiFetch(`/gift-cards/${id}/holder`, {
        method: 'PATCH',
        body: JSON.stringify({ clientId: candidate.id }),
      })
      setShowReassignHolder(false)
      setHolderSearchQuery('')
      setHolderSearchResults([])
      setRefreshIndex((index) => index + 1)
    } catch (err) {
      setReassignError(err instanceof Error ? err.message : 'Failed to reassign this card')
    } finally {
      setReassigning(false)
    }
  }

  // Reuses the existing PATCH /:id/attachment route -- the same one that
  // powers checkout's own stackable-card redemption once the appointment
  // happens. This just sets which appointment the card is aimed at; no new
  // balance/redemption math lives here.
  async function handleAttachSession(appointmentId: string) {
    if (!id) return

    setAttaching(true)
    setAttachError(null)

    try {
      await apiFetch(`/gift-cards/${id}/attachment`, {
        method: 'PATCH',
        body: JSON.stringify({ appointmentId }),
      })
      setShowAttachSession(false)
      setRefreshIndex((index) => index + 1)
    } catch (err) {
      setAttachError(err instanceof Error ? err.message : 'Failed to attach this card to that session')
    } finally {
      setAttaching(false)
    }
  }

  async function handleSaveExpiry() {
    if (!id) return

    setSavingExpiry(true)
    setExpiryError(null)

    try {
      await apiFetch(`/gift-cards/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ expiresAt: expiryForm ? new Date(expiryForm).toISOString() : null }),
      })
      setEditingExpiry(false)
      setRefreshIndex((index) => index + 1)
    } catch (err) {
      setExpiryError(err instanceof Error ? err.message : 'Failed to update expiration')
    } finally {
      setSavingExpiry(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-6 sm:px-10 sm:py-8">
          <Link
            to={card ? `/clients/${card.client.id}` : '/clients'}
            className="inline-flex items-center gap-2 text-sm text-fg-secondary hover:text-fg"
          >
            <ArrowLeftIcon className="h-4 w-4" />
            Back to {card ? `${card.client.firstName} ${card.client.lastName}` : 'Clients'}
          </Link>

          {error && (
            <div className="mt-6 rounded-2xl card-surface border border-border bg-surface p-5">
              <p className="text-sm text-danger">{error}</p>
            </div>
          )}

          {!error && !card && <p className="mt-6 text-sm text-fg-secondary">Loading gift card…</p>}

          {!error && card && (
            <>
              <div className="mt-6 rounded-2xl card-surface border border-border bg-surface p-5">
                <div className="flex flex-wrap items-start justify-between gap-6">
                  <div>
                    <h1 className="text-xl font-bold text-fg">
                      {card.status === 'EXEMPT' ? 'Deposit Exemption' : `$${(card.amountCents / 100).toFixed(2)} Gift Card`}
                    </h1>
                    {card.exemptionReason && (
                      <p className="mt-1 text-sm text-fg-secondary">{card.exemptionReason}</p>
                    )}
                    <p className="mt-1 text-sm text-fg-secondary">
                      <Link to={`/clients/${card.client.id}`} className="hover:underline">
                        {card.client.firstName} {card.client.lastName}
                      </Link>
                    </p>
                    <p className="mt-3 font-mono text-xs text-fg-muted">{card.code}</p>

                    <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
                      <div>
                        <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">Status</p>
                        <div className="mt-1">
                          <StatusPill status={card.status} />
                        </div>
                      </div>
                      <div>
                        <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">Expires</p>
                        <p className="mt-1 text-sm text-fg">
                          {card.expiresAt ? formatDateTime(card.expiresAt) : 'Never'}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">Attached</p>
                        <p className="mt-1 text-sm text-fg">
                          {card.appointment ? (
                            <>
                              <Link to={`/appointments/${card.appointment.id}`} className="hover:underline">
                                {formatDateTime(card.appointment.startTime)}
                              </Link>
                              {card.appointment.giftCards.length > 1 &&
                                `, alongside ${card.appointment.giftCards.length - 1} other card${card.appointment.giftCards.length - 1 === 1 ? '' : 's'}`}
                            </>
                          ) : (
                            'Unattached'
                          )}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">Issued by</p>
                        <p className="mt-1 text-sm text-fg">
                          {card.issuedBy ? (card.issuedBy.name ?? card.issuedBy.email) : 'Deleted user'}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">Payment method</p>
                        <p className="mt-1 text-sm text-fg">
                          {card.paymentMethod === 'STRIPE'
                            ? 'Stripe'
                            : card.paymentMethod === 'CASH'
                              ? 'Cash'
                              : card.paymentMethod === 'EXEMPT'
                                ? 'Exempt (no payment)'
                                : 'Unknown'}
                        </p>
                      </div>
                      {card.derivedFromGiftCard && (
                        <div>
                          <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">Origin</p>
                          <p className="mt-1 text-sm text-fg">
                            Issued from redeeming{' '}
                            <Link to={`/gift-cards/${card.derivedFromGiftCard.id}`} className="hover:underline">
                              gift card {card.derivedFromGiftCard.code.slice(0, 8)}…
                            </Link>
                          </p>
                        </div>
                      )}
                    </div>
                  </div>

                  {card.status !== 'EXEMPT' && <QrCode value={publicUrl!} size={140} />}
                </div>

                <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-border pt-4">
                  {card.status !== 'EXEMPT' && (
                    <button
                      type="button"
                      onClick={handleCopyLink}
                      className="rounded-full border border-border px-4 py-2 text-sm font-medium text-fg transition hover:bg-surface"
                    >
                      {copied ? 'Copied!' : 'Copy link'}
                    </button>
                  )}

                  {canTextReceipt && card.status === 'ACTIVE' && (
                    <span className="flex items-center gap-2">
                      <SendChannelButton
                        label="Send Receipt"
                        hasPhone={card.client.phones.length > 0}
                        hasEmail={card.client.emails.length > 0}
                        sending={sendingReceipt}
                        onSend={(channel) => handleSendReceipt(channel)}
                      />
                      {receiptSent && <span className="text-sm text-success">Sent!</span>}
                    </span>
                  )}

                  {canEditExpiry && card.status !== 'VOID' && (
                    <button
                      type="button"
                      onClick={() => setEditingExpiry((v) => !v)}
                      className="rounded-full border border-border px-4 py-2 text-sm font-medium text-fg transition hover:bg-surface"
                    >
                      Edit expiration
                    </button>
                  )}

                  {canVoid && card.status === 'ACTIVE' && (
                    <button
                      type="button"
                      onClick={handleRedeem}
                      disabled={redeeming}
                      className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-60"
                    >
                      {redeeming ? 'Redeeming…' : 'Redeem card'}
                    </button>
                  )}

                  {canVoid && card.status !== 'VOID' && (
                    <button
                      type="button"
                      onClick={handleVoid}
                      disabled={voiding}
                      className="rounded-full border border-danger/40 px-4 py-2 text-sm font-medium text-danger transition hover:bg-danger/10 disabled:opacity-60"
                    >
                      {voiding ? 'Voiding…' : 'Void card'}
                    </button>
                  )}

                  {canReassignHolder && card.status !== 'VOID' && (
                    <button
                      type="button"
                      onClick={() => setShowReassignHolder(true)}
                      className="rounded-full border border-border px-4 py-2 text-sm font-medium text-fg transition hover:bg-surface"
                    >
                      Transfer to Client
                    </button>
                  )}

                  {canAttachToSession && (card.status === 'ACTIVE' || card.status === 'EXEMPT') && (
                    <button
                      type="button"
                      onClick={() => setShowAttachSession(true)}
                      className="rounded-full border border-border px-4 py-2 text-sm font-medium text-fg transition hover:bg-surface"
                    >
                      Attach to Session
                    </button>
                  )}
                </div>

                {redeemError && <p className="mt-3 text-sm text-danger">{redeemError}</p>}
                {voidError && <p className="mt-3 text-sm text-danger">{voidError}</p>}
                {receiptError && <p className="mt-3 text-sm text-danger">{receiptError}</p>}

                {editingExpiry && (
                  <div className="mt-4 rounded-lg border border-border p-3">
                    <label className="mb-1 block text-xs font-medium text-fg-secondary">
                      Expiration date (blank = never)
                    </label>
                    <input
                      type="date"
                      value={expiryForm}
                      onChange={(e) => setExpiryForm(e.target.value)}
                      className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                    {expiryError && <p className="mt-2 text-sm text-danger">{expiryError}</p>}
                    <button
                      type="button"
                      onClick={handleSaveExpiry}
                      disabled={savingExpiry}
                      className="mt-3 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-60"
                    >
                      {savingExpiry ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                )}
              </div>

              {showReassignHolder && (
                <Modal
                  title="Transfer to Client"
                  onClose={() => {
                    setShowReassignHolder(false)
                    setHolderSearchQuery('')
                    setHolderSearchResults([])
                    setReassignError(null)
                  }}
                >
                  <p className="text-sm text-fg-secondary">
                    Currently held by{' '}
                    <span className="font-medium text-fg">
                      {card.client.firstName} {card.client.lastName}
                    </span>
                    . Search for who this card should belong to instead.
                  </p>
                  <input
                    type="text"
                    autoFocus
                    placeholder="Search by name, email, or phone…"
                    value={holderSearchQuery}
                    onChange={(e) => setHolderSearchQuery(e.target.value)}
                    disabled={reassigning}
                    className="mt-3 w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-60"
                  />

                  {reassignError && <p className="mt-2 text-sm text-danger">{reassignError}</p>}
                  {holderSearchLoading && <p className="mt-3 text-sm text-fg-secondary">Searching…</p>}
                  {!holderSearchLoading && holderSearchQuery.trim().length >= 2 && holderSearchResults.length === 0 && (
                    <p className="mt-3 text-sm text-fg-secondary">No clients found.</p>
                  )}

                  <ul className="mt-3 max-h-72 space-y-2 overflow-y-auto">
                    {holderSearchResults.map((candidate) => (
                      <li key={candidate.id}>
                        <button
                          type="button"
                          disabled={reassigning}
                          onClick={() => handleReassignHolder(candidate)}
                          className="flex w-full items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-left text-sm text-fg transition hover:bg-surface disabled:opacity-60"
                        >
                          <span>
                            {candidate.firstName} {candidate.lastName}
                            {candidate.email ? ` — ${candidate.email}` : ''}
                            {candidate.phone ? ` — ${formatPhoneInput(candidate.phone)}` : ''}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </Modal>
              )}

              {showAttachSession && (
                <Modal
                  title="Attach to Session"
                  onClose={() => {
                    setShowAttachSession(false)
                    setAttachError(null)
                  }}
                >
                  <p className="text-sm text-fg-secondary">
                    Pick one of{' '}
                    <span className="font-medium text-fg">
                      {card.client.firstName} {card.client.lastName}
                    </span>
                    's upcoming sessions to apply this card toward. It's applied at checkout, alongside any other
                    cards already attached.
                  </p>

                  {attachError && <p className="mt-2 text-sm text-danger">{attachError}</p>}
                  {sessionOptions === null && <p className="mt-3 text-sm text-fg-secondary">Loading sessions…</p>}
                  {sessionOptions !== null && sessionOptions.length === 0 && (
                    <p className="mt-3 text-sm text-fg-secondary">No upcoming sessions for this client.</p>
                  )}

                  <ul className="mt-3 max-h-72 space-y-2 overflow-y-auto">
                    {sessionOptions?.map((appointment) => (
                      <li key={appointment.id}>
                        <button
                          type="button"
                          disabled={attaching}
                          onClick={() => handleAttachSession(appointment.id)}
                          className="flex w-full items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-left text-sm text-fg transition hover:bg-surface disabled:opacity-60"
                        >
                          <span>{formatDateTime(appointment.startTime)}</span>
                          {card.appointment?.id === appointment.id && (
                            <span className="text-xs text-fg-muted">Currently attached</span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                </Modal>
              )}

              {canViewAudit && <AuditTrail entityType="GiftCard" entityId={card.id} />}
            </>
          )}
        </div>
  )
}
