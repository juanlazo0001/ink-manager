import { useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, ApiError } from '../lib/api'
import { tasksQueryKey } from '../lib/queryKeys'
import { useAuth } from '../context/useAuth'
import { useUserProfile } from '../context/useUserProfile'

interface TransferDetail {
  id: string
  status: 'PENDING_ARTIST' | 'ACCEPTED' | 'DECLINED' | 'CANCELLED_BY_ORIGIN' | 'COMPLETED'
  createdAt: string
  originStudio: { id: string; name: string }
  destinationStudio: { id: string; name: string }
  clients: { id: string; name: string; openProject: { description: string } | null }[]
}

export default function MyTransferDetail() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const { profile } = useUserProfile()
  const isArtist = Boolean(profile?.artist)
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const { data: transfer, isLoading, error } = useQuery({
    queryKey: ['my-transfer', id],
    queryFn: () => apiFetch<TransferDetail>(`/artist-transfers/${id}`),
    enabled: !!id && isArtist,
  })

  const [responding, setResponding] = useState(false)
  const [responseError, setResponseError] = useState<string | null>(null)

  async function respond(action: 'accept' | 'decline') {
    if (!id) return
    setResponding(true)
    setResponseError(null)
    try {
      await apiFetch(`/artist-transfers/${id}/${action}`, { method: 'POST' })
      if (user) queryClient.invalidateQueries({ queryKey: tasksQueryKey(user.userId) })
      navigate('/tasks')
    } catch (err) {
      setResponseError(err instanceof ApiError ? err.message : `Failed to ${action} this transfer`)
    } finally {
      setResponding(false)
    }
  }

  if (user && !isArtist) {
    return <Navigate to="/dashboard" replace />
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-6 sm:px-10 sm:py-8">
      <Link to="/tasks" className="text-sm text-fg-secondary hover:text-fg">
        ← Back to Tasks
      </Link>

      <h1 className="mt-2 text-2xl font-bold text-fg sm:text-3xl">Client Transfer Request</h1>

      {isLoading && <p className="mt-6 text-sm text-fg-secondary">Loading…</p>}
      {error && (
        <div className="mt-6 rounded-2xl card-surface border border-border bg-surface p-5">
          <p className="text-sm text-danger">
            {error instanceof ApiError && error.status === 404 ? 'Transfer not found.' : error.message}
          </p>
        </div>
      )}

      {transfer && (
        <div className="mt-6 space-y-4">
          <div className="rounded-2xl card-surface border border-border bg-surface p-5">
            <p className="text-sm text-fg">
              <strong>{transfer.originStudio.name}</strong> wants <strong>{transfer.clients.length}</strong> client
              {transfer.clients.length === 1 ? '' : 's'} to follow you to{' '}
              <strong>{transfer.destinationStudio.name}</strong>.
            </p>
            <p className="mt-1 text-xs text-fg-muted">
              This is theirs alone to decide -- your response, nobody else's. Signed documents, financial records,
              and internal notes stay behind at {transfer.originStudio.name} either way.
            </p>
          </div>

          <div className="rounded-lg border border-border bg-surface-inset p-4 text-sm">
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-fg-muted">Clients</p>
            <ul className="space-y-1 text-fg-secondary">
              {transfer.clients.map((c) => (
                <li key={c.id}>
                  {c.name}
                  {c.openProject ? ` — ${c.openProject.description}` : ' — no open project'}
                </li>
              ))}
            </ul>
          </div>

          {transfer.status !== 'PENDING_ARTIST' && (
            <div className="rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg-secondary">
              You already responded to this request: <strong>{transfer.status}</strong>.
            </div>
          )}

          {responseError && (
            <div className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
              {responseError}
            </div>
          )}

          {transfer.status === 'PENDING_ARTIST' && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => respond('accept')}
                disabled={responding}
                className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover disabled:opacity-60"
              >
                {responding ? 'Saving…' : 'Accept'}
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
