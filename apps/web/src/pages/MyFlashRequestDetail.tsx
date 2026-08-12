import { useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, ApiError } from '../lib/api'
import { tasksQueryKey } from '../lib/queryKeys'
import { useAuth } from '../context/useAuth'
import { useUserProfile } from '../context/useUserProfile'
import { formatDateTime } from '../lib/format'

interface FlashRequestDetail {
  id: string
  status: 'FLASH_PENDING_APPROVAL' | 'FLASH_PAYMENT_PENDING' | 'CLOSED_LOST' | string
  placement: string
  placementImages: string[]
  createdAt: string
  client: { firstName: string; lastName: string }
  flashPiece: {
    title: string
    imageUrl: string
    priceCents: number
    estimatedDurationMinutes: number
    isOneOfOne: boolean
  } | null
}

// Same profile-loading race MyTransferDetail.tsx's own comment documents --
// gating on `user` alone (before useUserProfile()'s fetch has resolved)
// intermittently redirects a fresh/direct page load away before `profile`
// is populated. Requiring `profile` itself closes it.
export default function MyFlashRequestDetail() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const { profile } = useUserProfile()
  const isArtist = Boolean(profile?.artist)
  const queryClient = useQueryClient()

  const { data: request, isLoading, error } = useQuery({
    queryKey: ['my-flash-request', id],
    queryFn: () => apiFetch<FlashRequestDetail>(`/inquiries/my-flash-requests/${id}`),
    enabled: !!id && isArtist,
  })

  const [responding, setResponding] = useState(false)
  const [responseError, setResponseError] = useState<string | null>(null)

  async function respond(action: 'approve' | 'decline') {
    if (!id) return
    setResponding(true)
    setResponseError(null)
    try {
      await apiFetch(`/inquiries/${id}/flash/${action}`, { method: 'POST' })
      if (user) queryClient.invalidateQueries({ queryKey: tasksQueryKey(user.userId) })
      queryClient.invalidateQueries({ queryKey: ['my-flash-request', id] })
    } catch (err) {
      setResponseError(err instanceof ApiError ? err.message : `Failed to ${action} this request`)
    } finally {
      setResponding(false)
    }
  }

  if (user && profile && !isArtist) {
    return <Navigate to="/dashboard" replace />
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-6 sm:px-10 sm:py-8">
      <Link to="/tasks" className="text-sm text-fg-secondary hover:text-fg">
        ← Back to Tasks
      </Link>

      <h1 className="mt-2 text-2xl font-bold text-fg sm:text-3xl">Flash Booking Request</h1>

      {isLoading && <p className="mt-6 text-sm text-fg-secondary">Loading…</p>}
      {error && (
        <div className="mt-6 rounded-2xl card-surface border border-border bg-surface p-5">
          <p className="text-sm text-danger">
            {error instanceof ApiError && error.status === 404 ? 'Flash request not found.' : error.message}
          </p>
        </div>
      )}

      {request && (
        <div className="mt-6 space-y-4">
          <div className="rounded-2xl card-surface border border-border bg-surface p-5">
            <p className="text-sm text-fg">
              <strong>
                {request.client.firstName} {request.client.lastName}
              </strong>{' '}
              wants to book{' '}
              <strong>{request.flashPiece?.title ?? 'this flash piece'}</strong>.
            </p>
            <p className="mt-1 text-xs text-fg-muted">
              This is yours alone to decide -- your response, nobody else's. Requested{' '}
              {formatDateTime(request.createdAt)}.
            </p>

            {request.flashPiece && (
              <div className="mt-4 flex items-start gap-4">
                <img
                  src={request.flashPiece.imageUrl}
                  alt={request.flashPiece.title}
                  className="h-24 w-24 shrink-0 rounded-lg border border-border object-cover"
                />
                <div className="text-sm text-fg-secondary">
                  <p className="text-fg">${(request.flashPiece.priceCents / 100).toFixed(2)}</p>
                  <p>~{Math.round((request.flashPiece.estimatedDurationMinutes / 60) * 10) / 10} hours</p>
                  {request.flashPiece.isOneOfOne && <p className="text-xs text-fg-muted">One-of-one piece</p>}
                </div>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-border bg-surface-inset p-4 text-sm">
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-fg-muted">Placement</p>
            <p className="text-fg-secondary">{request.placement}</p>
            {request.placementImages.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {request.placementImages.map((url) => (
                  <img key={url} src={url} alt="Placement" className="h-20 w-20 rounded-lg border border-border object-cover" />
                ))}
              </div>
            )}
          </div>

          {request.status === 'FLASH_PAYMENT_PENDING' && (
            <div className="rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
              Approved -- waiting on the client's payment to lock in the booking.
            </div>
          )}
          {request.status === 'CLOSED_LOST' && (
            <div className="rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg-secondary">
              You already responded to this request: <strong>Declined</strong>.
            </div>
          )}

          {responseError && (
            <div className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
              {responseError}
            </div>
          )}

          {request.status === 'FLASH_PENDING_APPROVAL' && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => respond('approve')}
                disabled={responding}
                className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-60"
              >
                {responding ? 'Saving…' : 'Approve'}
              </button>
              <button
                type="button"
                onClick={() => respond('decline')}
                disabled={responding}
                className="rounded-full border border-border px-4 py-2 text-sm font-semibold text-fg transition hover:bg-surface disabled:opacity-60"
              >
                {responding ? 'Saving…' : 'Decline'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
