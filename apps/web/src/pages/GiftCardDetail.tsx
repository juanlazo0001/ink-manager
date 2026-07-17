import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { apiFetch, ApiError } from '../lib/api'
import { formatDateTime } from '../lib/format'
import { ArrowLeftIcon } from '../components/icons'
import { useEffectiveUser } from '../context/useEffectiveUser'
import Sidebar from '../components/Sidebar'
import QrCode from '../components/QrCode'
import AuditTrail from '../components/AuditTrail'
import StatusPill from '../components/StatusPill'

interface GiftCard {
  id: string
  code: string
  amountCents: number
  status: string
  expiresAt: string | null
  createdAt: string
  client: { id: string; firstName: string; lastName: string }
  appointment: { id: string; startTime: string; endTime: string } | null
  issuedBy: { id: string; name: string | null; email: string }
}

export default function GiftCardDetail() {
  const { id } = useParams<{ id: string }>()
  const user = useEffectiveUser()
  const canManage = user?.role === 'OWNER' || user?.role === 'FRONT_DESK'
  const canVoidOrEditExpiry = user?.role === 'OWNER'

  const [card, setCard] = useState<GiftCard | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshIndex, setRefreshIndex] = useState(0)

  const [copied, setCopied] = useState(false)
  const [voiding, setVoiding] = useState(false)
  const [voidError, setVoidError] = useState<string | null>(null)

  const [editingExpiry, setEditingExpiry] = useState(false)
  const [expiryForm, setExpiryForm] = useState('')
  const [savingExpiry, setSavingExpiry] = useState(false)
  const [expiryError, setExpiryError] = useState<string | null>(null)

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

  const publicUrl = card ? `${window.location.origin}/gift-card/${card.code}` : null

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
    <div className="flex min-h-screen bg-bg text-fg">
      <Sidebar />

      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 py-6 sm:px-10 sm:py-8">
          <Link to="/clients" className="inline-flex items-center gap-2 text-sm text-fg-secondary hover:text-fg">
            <ArrowLeftIcon className="h-4 w-4" />
            Back to Clients
          </Link>

          {error && (
            <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
              <p className="text-sm text-danger">{error}</p>
            </div>
          )}

          {!error && !card && <p className="mt-6 text-sm text-fg-secondary">Loading gift card…</p>}

          {!error && card && (
            <>
              <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
                <div className="flex flex-wrap items-start justify-between gap-6">
                  <div>
                    <h1 className="text-xl font-bold text-fg">${(card.amountCents / 100).toFixed(2)} Gift Card</h1>
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
                          {card.appointment ? formatDateTime(card.appointment.startTime) : 'Unattached'}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">Issued by</p>
                        <p className="mt-1 text-sm text-fg">{card.issuedBy.name ?? card.issuedBy.email}</p>
                      </div>
                    </div>
                  </div>

                  <QrCode value={publicUrl!} size={140} />
                </div>

                <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-border pt-4">
                  <button
                    type="button"
                    onClick={handleCopyLink}
                    className="rounded-full border border-border px-4 py-2 text-sm font-medium text-fg transition hover:bg-surface"
                  >
                    {copied ? 'Copied!' : 'Copy link'}
                  </button>

                  {canVoidOrEditExpiry && card.status !== 'VOID' && (
                    <button
                      type="button"
                      onClick={() => setEditingExpiry((v) => !v)}
                      className="rounded-full border border-border px-4 py-2 text-sm font-medium text-fg transition hover:bg-surface"
                    >
                      Edit expiration
                    </button>
                  )}

                  {canVoidOrEditExpiry && card.status !== 'VOID' && (
                    <button
                      type="button"
                      onClick={handleVoid}
                      disabled={voiding}
                      className="rounded-full border border-danger/40 px-4 py-2 text-sm font-medium text-danger transition hover:bg-danger/10 disabled:opacity-60"
                    >
                      {voiding ? 'Voiding…' : 'Void card'}
                    </button>
                  )}
                </div>

                {voidError && <p className="mt-3 text-sm text-danger">{voidError}</p>}

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

              {canManage && <AuditTrail entityType="GiftCard" entityId={card.id} />}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
