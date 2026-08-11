import { Fragment, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import { artistTransfersQueryKey } from '../lib/queryKeys'
import { useEffectiveUser } from '../context/useEffectiveUser'
import Modal from './Modal'
import StatusPill from './StatusPill'

// Transfer-to-artist epic: the origin OWNER's own view of transfers they've
// sent -- pending (with cancel-while-pending) and completed (the
// completion report, per client). Originally inline on Team.tsx, extracted
// here so it can ALSO render on Profile.tsx: Team.tsx redirects away
// entirely for a solo studio (isSoloStudio.ts, "no team to manage"), which
// is exactly the state the epic's own primary case (an artist who's
// already left) commonly leaves the origin studio in -- a shop that had
// just one owner and one artist is down to one active user the moment
// that artist's home moves elsewhere. Without this, that OWNER could
// still start a transfer (StartArtistTransfer.tsx has no solo-studio
// gate), but could never see, cancel, or review the outcome of the one
// they'd already sent.
interface PendingTransfer {
  id: string
  status: 'PENDING_ARTIST' | 'ACCEPTED' | 'DECLINED' | 'CANCELLED_BY_ORIGIN' | 'COMPLETED'
  createdAt: string
  artistId: string
  artistName: string
  destinationStudio: { id: string; name: string }
  clientCount: number
}

interface TransferOutcomeDetail {
  id: string
  clients: {
    id: string
    name: string
    outcome: 'PENDING' | 'CREATED' | 'MERGE_FLAGGED' | 'FAILED'
    errorMessage: string | null
  }[]
}

interface TransfersPanelProps {
  // Team.tsx already has its own "Transfer clients" button in its Artists
  // tab toolbar -- showing a second one here would be redundant there.
  // Profile.tsx (the solo-studio landing page) has no such toolbar, so it
  // needs this panel's own header + entry point instead.
  showHeader?: boolean
}

export default function TransfersPanel({ showHeader = false }: TransfersPanelProps) {
  const user = useEffectiveUser()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const isOwner = user?.role === 'OWNER'

  const { data: pendingTransfers } = useQuery({
    queryKey: artistTransfersQueryKey(user!.studioId),
    queryFn: () => apiFetch<PendingTransfer[]>(`/studios/${user!.studioId}/artist-transfers?status=PENDING_ARTIST`),
    enabled: isOwner,
  })

  const { data: completedTransfers } = useQuery({
    queryKey: [...artistTransfersQueryKey(user!.studioId), 'completed'],
    queryFn: () => apiFetch<PendingTransfer[]>(`/studios/${user!.studioId}/artist-transfers?status=COMPLETED`),
    enabled: isOwner,
  })

  const [expandedTransferId, setExpandedTransferId] = useState<string | null>(null)
  const { data: expandedTransferDetail, isLoading: expandedTransferLoading } = useQuery({
    queryKey: ['transfer-detail', expandedTransferId],
    queryFn: () => apiFetch<TransferOutcomeDetail>(`/studios/${user!.studioId}/artist-transfers/${expandedTransferId}`),
    enabled: isOwner && !!expandedTransferId,
  })

  const [cancellingTransfer, setCancellingTransfer] = useState<PendingTransfer | null>(null)
  const [cancelTransferError, setCancelTransferError] = useState<string | null>(null)
  const [cancelTransferSubmitting, setCancelTransferSubmitting] = useState(false)

  async function handleConfirmCancelTransfer() {
    if (!user?.studioId || !cancellingTransfer) return
    setCancelTransferSubmitting(true)
    setCancelTransferError(null)
    try {
      await apiFetch(`/studios/${user.studioId}/artist-transfers/${cancellingTransfer.id}/cancel`, { method: 'POST' })
      setCancellingTransfer(null)
      queryClient.invalidateQueries({ queryKey: artistTransfersQueryKey(user.studioId) })
    } catch (err) {
      setCancelTransferError(err instanceof Error ? err.message : 'Failed to cancel transfer')
    } finally {
      setCancelTransferSubmitting(false)
    }
  }

  if (!isOwner) return null

  return (
    <>
      {showHeader && (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface p-5">
          <div>
            <h2 className="text-sm font-semibold text-fg">Client transfers</h2>
            <p className="mt-1 text-xs text-fg-secondary">
              Move a departing artist's client contacts and in-flight project work to their new home studio.
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigate('/team/transfer')}
            className="shrink-0 rounded-full border border-border px-4 py-2 text-sm font-medium text-fg transition hover:bg-surface-raised"
          >
            Transfer clients
          </button>
        </div>
      )}

      {pendingTransfers && pendingTransfers.length > 0 && (
        <div className="mt-6 rounded-2xl border border-warning/30 bg-warning/5 p-5">
          <h2 className="text-sm font-semibold text-fg">Pending transfers</h2>
          <p className="mt-1 text-xs text-fg-secondary">
            Sent to the artist, awaiting their accept or decline. Nothing moves until they respond.
          </p>
          {cancelTransferError && <p className="mt-3 text-sm text-danger">{cancelTransferError}</p>}

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-xs text-fg-muted">
                  <th className="pb-2 font-medium">Artist</th>
                  <th className="pb-2 font-medium">Destination</th>
                  <th className="pb-2 font-medium">Clients</th>
                  <th className="pb-2 font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-warning/20">
                {pendingTransfers.map((transfer) => (
                  <tr key={transfer.id}>
                    <td className="py-2.5 text-fg">{transfer.artistName}</td>
                    <td className="py-2.5 text-fg-secondary">{transfer.destinationStudio.name}</td>
                    <td className="py-2.5 text-fg-secondary">{transfer.clientCount}</td>
                    <td className="py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => {
                          setCancellingTransfer(transfer)
                          setCancelTransferError(null)
                        }}
                        className="rounded-full border border-danger/40 px-3 py-1.5 text-xs font-medium text-danger transition hover:bg-danger/10"
                      >
                        Cancel
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {completedTransfers && completedTransfers.length > 0 && (
        <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
          <h2 className="text-sm font-semibold text-fg">Completed transfers</h2>
          <p className="mt-1 text-xs text-fg-secondary">
            The completion report for each client -- what actually moved, and what needs a second look.
          </p>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-xs text-fg-muted">
                  <th className="pb-2 font-medium">Artist</th>
                  <th className="pb-2 font-medium">Destination</th>
                  <th className="pb-2 font-medium">Clients</th>
                  <th className="pb-2 font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {completedTransfers.map((transfer) => (
                  <Fragment key={transfer.id}>
                    <tr>
                      <td className="py-2.5 text-fg">{transfer.artistName}</td>
                      <td className="py-2.5 text-fg-secondary">{transfer.destinationStudio.name}</td>
                      <td className="py-2.5 text-fg-secondary">{transfer.clientCount}</td>
                      <td className="py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => setExpandedTransferId(expandedTransferId === transfer.id ? null : transfer.id)}
                          className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-fg transition hover:bg-surface-raised"
                        >
                          {expandedTransferId === transfer.id ? 'Hide' : 'View outcome'}
                        </button>
                      </td>
                    </tr>
                    {expandedTransferId === transfer.id && (
                      <tr>
                        <td colSpan={4} className="bg-surface-inset px-3 py-3">
                          {expandedTransferLoading && <p className="text-xs text-fg-secondary">Loading…</p>}
                          {expandedTransferDetail && (
                            <ul className="space-y-1.5">
                              {expandedTransferDetail.clients.map((c) => (
                                <li key={c.id} className="flex items-center justify-between gap-2 text-sm">
                                  <span className="text-fg-secondary">
                                    {c.name}
                                    {c.outcome === 'FAILED' && c.errorMessage && (
                                      <span className="block text-xs text-danger">{c.errorMessage}</span>
                                    )}
                                  </span>
                                  <StatusPill status={c.outcome} className="shrink-0" />
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {cancellingTransfer && (
        <Modal title="Cancel transfer" onClose={() => setCancellingTransfer(null)}>
          <p className="text-sm text-fg-secondary">
            Cancel the pending transfer of <span className="font-semibold">{cancellingTransfer.clientCount}</span>{' '}
            client{cancellingTransfer.clientCount === 1 ? '' : 's'} for{' '}
            <span className="font-semibold">{cancellingTransfer.artistName}</span>? Nothing has moved yet -- this
            just withdraws the request before the artist responds.
          </p>

          {cancelTransferError && <p className="mt-3 text-sm text-danger">{cancelTransferError}</p>}

          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setCancellingTransfer(null)}
              disabled={cancelTransferSubmitting}
              className="rounded-full border border-border px-4 py-2 text-sm font-medium text-fg transition hover:bg-surface disabled:opacity-60"
            >
              Keep transfer
            </button>
            <button
              type="button"
              onClick={handleConfirmCancelTransfer}
              disabled={cancelTransferSubmitting}
              className="rounded-full bg-danger px-4 py-2 text-sm font-medium text-bg transition hover:bg-danger/90 disabled:opacity-60"
            >
              {cancelTransferSubmitting ? 'Cancelling…' : 'Cancel transfer'}
            </button>
          </div>
        </Modal>
      )}
    </>
  )
}
