import { useEffect, useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import Sidebar from '../components/Sidebar'
import Modal from '../components/Modal'
import InquiryKanbanBoard from '../components/kanban/InquiryKanbanBoard'
import { INQUIRY_TAB_COLUMNS, PROJECT_TAB_COLUMNS } from './Inquiries'
import type { KanbanInquiry, KanbanTransition } from '../lib/kanban'
import { apiFetch } from '../lib/api'
import { formatDateTime, formatStatus } from '../lib/format'
import { useEffectiveUser } from '../context/useEffectiveUser'
import { useMarkSectionSeen } from '../lib/useMarkSectionSeen'
import { assignedInquiriesQueryKey } from '../lib/queryKeys'

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
  createdAt: string
  client: { firstName: string; lastName: string }
  // Already returned by the API (Prisma `include` always returns every base
  // scalar field) -- only added to the TS shape here for the Kanban board
  // (Package E), which needs them and was never declared before since the
  // flat approve/decline inbox above never needed anything past NEW's
  // review-pending shape.
  status: string
  updatedAt: string
  priceEstimateLow: number | null
  priceEstimateHigh: number | null
  assignedArtist: { id: string; user: { email: string; name: string | null; avatarUrl: string | null } } | null
}

type ViewMode = 'list' | 'kanban'
type PipelineTab = 'inquiries' | 'projects'

function ImageGrid({ images }: { images: string[] }) {
  if (images.length === 0) {
    return <p className="text-sm text-fg-secondary">None uploaded.</p>
  }

  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
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

const EMPTY_APPROVE_FORM = {
  priceEstimateLow: '',
  priceEstimateHigh: '',
  timeEstimateHoursMin: '',
  timeEstimateHoursMax: '',
}

export default function MyInquiries() {
  const user = useEffectiveUser()
  useMarkSectionSeen('inquiries')

  const [inquiries, setInquiries] = useState<Inquiry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshIndex, setRefreshIndex] = useState(0)

  const [approvingInquiry, setApprovingInquiry] = useState<Inquiry | null>(null)
  const [approveForm, setApproveForm] = useState(EMPTY_APPROVE_FORM)
  const [approveError, setApproveError] = useState<string | null>(null)
  const [approveSubmitting, setApproveSubmitting] = useState(false)

  const [decliningInquiry, setDecliningInquiry] = useState<Inquiry | null>(null)
  const [declineNote, setDeclineNote] = useState('')
  const [declineError, setDeclineError] = useState<string | null>(null)
  const [declineSubmitting, setDeclineSubmitting] = useState(false)

  // Kanban board (Package E) -- a second, independent data source from the
  // flat inbox above (?scope=all instead of the default ARTIST_ASSIGNED-
  // only filter), fetched via React Query so it also benefits for free from
  // the WS inquiry.updated invalidation (see assignedInquiriesQueryKey).
  // Only ever fetched once the artist actually switches to Board view.
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [kanbanTab, setKanbanTab] = useState<PipelineTab>('inquiries')

  const { data: kanbanInquiries, isLoading: kanbanLoading } = useQuery({
    queryKey: assignedInquiriesQueryKey(user?.studioId ?? ''),
    queryFn: () => apiFetch<Inquiry[]>('/inquiries/assigned-to-me?scope=all'),
    enabled: user?.role === 'ARTIST' && viewMode === 'kanban',
  })

  const kanbanTabStatuses: readonly string[] =
    kanbanTab === 'projects' ? PROJECT_TAB_COLUMNS.flatMap((c) => c.statuses) : INQUIRY_TAB_COLUMNS.flatMap((c) => c.statuses)
  const kanbanFilteredInquiries = kanbanInquiries?.filter((inquiry) => kanbanTabStatuses.includes(inquiry.status))

  // The artist's only forward action from a Kanban drag is approving an
  // ARTIST_ASSIGNED card into Estimate Sent -- everything else on their
  // board (every other column, both tabs' backward drags, the whole
  // Projects tab) has no route they're permitted to call, so it's
  // read-only: the board still shows where their assigned work stands
  // end to end, it just doesn't accept a drop there. Decline is
  // deliberately not wired to a drag either -- it isn't a forward step to
  // any column on this board (it unassigns back to NEW, which never
  // appears here since NEW inquiries have no assignedArtistId yet) -- it
  // stays exactly where it already was, the List view's Decline button.
  function resolveArtistTransition({
    inquiry,
    fromColumnKey,
    toColumnKey,
  }: {
    inquiry: KanbanInquiry
    fromColumnKey: string
    toColumnKey: string
  }): KanbanTransition {
    if (kanbanTab === 'inquiries' && fromColumnKey === 'Artist assigned' && toColumnKey === 'Estimate sent') {
      return { kind: 'open-flow', run: () => openApprove(inquiry as Inquiry) }
    }
    return {
      kind: 'reject',
      message: `You don't have an action that moves a card from ${fromColumnKey} to ${toColumnKey}.`,
    }
  }

  useEffect(() => {
    if (user?.role !== 'ARTIST') return

    let ignore = false

    async function load() {
      setError(null)

      try {
        const data = await apiFetch<Inquiry[]>('/inquiries/assigned-to-me')
        if (!ignore) setInquiries(data)
      } catch (err) {
        if (!ignore) setError(err instanceof Error ? err.message : 'Failed to load inquiries')
      }
    }

    load()

    return () => {
      ignore = true
    }
  }, [user?.role, refreshIndex])

  function openApprove(inquiry: Inquiry) {
    setApprovingInquiry(inquiry)
    setApproveForm(EMPTY_APPROVE_FORM)
    setApproveError(null)
  }

  async function handleApproveSubmit(event: FormEvent) {
    event.preventDefault()
    if (!approvingInquiry) return

    setApproveError(null)
    setApproveSubmitting(true)

    try {
      await apiFetch(`/inquiries/${approvingInquiry.id}/respond`, {
        method: 'PATCH',
        body: JSON.stringify({
          decision: 'APPROVE',
          priceEstimateLow: approveForm.priceEstimateLow ? Number(approveForm.priceEstimateLow) : undefined,
          priceEstimateHigh: approveForm.priceEstimateHigh ? Number(approveForm.priceEstimateHigh) : undefined,
          timeEstimateHoursMin: approveForm.timeEstimateHoursMin
            ? Number(approveForm.timeEstimateHoursMin)
            : undefined,
          timeEstimateHoursMax: approveForm.timeEstimateHoursMax
            ? Number(approveForm.timeEstimateHoursMax)
            : undefined,
        }),
      })

      setApprovingInquiry(null)
      setRefreshIndex((index) => index + 1)
    } catch (err) {
      setApproveError(err instanceof Error ? err.message : 'Failed to approve inquiry')
    } finally {
      setApproveSubmitting(false)
    }
  }

  function openDecline(inquiry: Inquiry) {
    setDecliningInquiry(inquiry)
    setDeclineNote('')
    setDeclineError(null)
  }

  async function handleDeclineSubmit(event: FormEvent) {
    event.preventDefault()
    if (!decliningInquiry) return

    setDeclineError(null)
    setDeclineSubmitting(true)

    try {
      await apiFetch(`/inquiries/${decliningInquiry.id}/respond`, {
        method: 'PATCH',
        body: JSON.stringify({ decision: 'DECLINE', declineNote }),
      })

      setDecliningInquiry(null)
      setRefreshIndex((index) => index + 1)
    } catch (err) {
      setDeclineError(err instanceof Error ? err.message : 'Failed to decline inquiry')
    } finally {
      setDeclineSubmitting(false)
    }
  }

  if (user && user.role !== 'ARTIST') {
    return <Navigate to="/dashboard" replace />
  }

  return (
    <div className="flex min-h-screen bg-bg text-fg">
      <Sidebar />

      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-6 py-6 sm:px-10 sm:py-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold text-fg sm:text-3xl">My Inquiries</h1>
              <p className="mt-1 text-sm text-fg-secondary">
                {viewMode === 'list' ? 'Tattoo requests assigned to you for review.' : 'Everything currently assigned to you.'}
              </p>
            </div>

            <div className="flex shrink-0 rounded-full border border-border p-0.5">
              {(['list', 'kanban'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setViewMode(mode)}
                  aria-pressed={viewMode === mode}
                  className={[
                    'rounded-full px-3 py-1.5 text-sm font-medium capitalize transition',
                    viewMode === mode ? 'bg-accent text-bg' : 'text-fg-secondary hover:text-fg',
                  ].join(' ')}
                >
                  {mode === 'list' ? 'List' : 'Board'}
                </button>
              ))}
            </div>
          </div>

          {viewMode === 'kanban' && (
            <div className="mt-4 flex gap-1 border-b border-border">
              {(
                [
                  ['inquiries', 'Inquiries'],
                  ['projects', 'Projects'],
                ] as const
              ).map(([tab, label]) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setKanbanTab(tab)}
                  className={[
                    'rounded-t-lg px-4 py-2 text-sm font-medium transition',
                    kanbanTab === tab ? 'border-b-2 border-accent text-fg' : 'text-fg-muted hover:text-fg',
                  ].join(' ')}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {viewMode === 'kanban' && (
            <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
              {kanbanLoading && <p className="text-sm text-fg-secondary">Loading…</p>}
              {!kanbanLoading && (
                <InquiryKanbanBoard
                  key={kanbanTab}
                  inquiries={kanbanFilteredInquiries ?? []}
                  columns={kanbanTab === 'projects' ? PROJECT_TAB_COLUMNS : INQUIRY_TAB_COLUMNS}
                  interactiveColumnKeys={kanbanTab === 'projects' ? [] : ['Artist assigned']}
                  resolveTransition={(params) =>
                    resolveArtistTransition({ ...params, inquiry: params.inquiry })
                  }
                  emptyMessage="Nothing assigned to you right now."
                />
              )}
            </div>
          )}

          {viewMode === 'list' && error && (
            <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
              <p className="text-sm text-danger">{error}</p>
            </div>
          )}

          {viewMode === 'list' && !error && inquiries === null && (
            <p className="mt-6 text-sm text-fg-secondary">Loading inquiries…</p>
          )}

          {viewMode === 'list' && !error && inquiries !== null && inquiries.length === 0 && (
            <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
              <p className="text-sm text-fg-secondary">Nothing assigned to you right now.</p>
            </div>
          )}

          {viewMode === 'list' && !error && inquiries && inquiries.length > 0 && (
            <div className="mt-6 space-y-5">
              {inquiries.map((inquiry) => (
                <div key={inquiry.id} className="rounded-2xl border border-border bg-surface p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-semibold text-fg">
                        {inquiry.client.firstName} {inquiry.client.lastName}
                      </h2>
                      <p className="mt-1 text-sm text-fg-secondary">
                        Submitted {formatDateTime(inquiry.createdAt)} via {formatStatus(inquiry.channel)}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => openApprove(inquiry)}
                        className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={() => openDecline(inquiry)}
                        className="rounded-full border border-border px-4 py-2 text-sm font-semibold text-fg transition hover:bg-surface"
                      >
                        Decline
                      </button>
                    </div>
                  </div>

                  <p className="mt-4 whitespace-pre-wrap text-sm text-fg">{inquiry.description}</p>

                  <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">Placement</p>
                      <p className="mt-1 text-sm text-fg">{inquiry.placement}</p>
                    </div>
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">Size</p>
                      <p className="mt-1 text-sm text-fg">{inquiry.estimatedSize}</p>
                    </div>
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">Color</p>
                      <p className="mt-1 text-sm text-fg">{inquiry.colorOrBlackGrey}</p>
                    </div>
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">Budget</p>
                      <p className="mt-1 text-sm text-fg">{inquiry.budget ?? 'Not provided'}</p>
                    </div>
                  </div>

                  <div className="mt-4">
                    <p className="mb-2 text-xs font-medium uppercase tracking-wider text-fg-muted">
                      Reference images
                    </p>
                    <ImageGrid images={inquiry.referenceImages} />
                  </div>

                  <div className="mt-4">
                    <p className="mb-2 text-xs font-medium uppercase tracking-wider text-fg-muted">
                      Placement photos
                    </p>
                    <ImageGrid images={inquiry.placementImages} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {approvingInquiry && (
        <Modal
          title={`Approve — ${approvingInquiry.client.firstName} ${approvingInquiry.client.lastName}`}
          onClose={() => setApprovingInquiry(null)}
        >
          <form onSubmit={handleApproveSubmit}>
            {approveError && (
              <div className="mb-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                {approveError}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="priceLow" className="mb-1 block text-sm font-medium text-fg-secondary">
                  Price low ($)
                </label>
                <input
                  id="priceLow"
                  type="number"
                  min="0"
                  step="1"
                  value={approveForm.priceEstimateLow}
                  onChange={(event) => setApproveForm({ ...approveForm, priceEstimateLow: event.target.value })}
                  className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>

              <div>
                <label htmlFor="priceHigh" className="mb-1 block text-sm font-medium text-fg-secondary">
                  Price high ($)
                </label>
                <input
                  id="priceHigh"
                  type="number"
                  min="0"
                  step="1"
                  value={approveForm.priceEstimateHigh}
                  onChange={(event) => setApproveForm({ ...approveForm, priceEstimateHigh: event.target.value })}
                  className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="timeHoursMin" className="mb-1 block text-sm font-medium text-fg-secondary">
                  Time min (hours)
                </label>
                <input
                  id="timeHoursMin"
                  type="number"
                  min="0"
                  step="0.5"
                  value={approveForm.timeEstimateHoursMin}
                  onChange={(event) => setApproveForm({ ...approveForm, timeEstimateHoursMin: event.target.value })}
                  className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>
              <div>
                <label htmlFor="timeHoursMax" className="mb-1 block text-sm font-medium text-fg-secondary">
                  Time max (hours)
                </label>
                <input
                  id="timeHoursMax"
                  type="number"
                  min="0"
                  step="0.5"
                  value={approveForm.timeEstimateHoursMax}
                  onChange={(event) => setApproveForm({ ...approveForm, timeEstimateHoursMax: event.target.value })}
                  className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={approveSubmitting}
              className="mt-5 w-full rounded-full bg-accent px-4 py-2 text-sm font-medium text-bg transition hover:bg-accent-hover disabled:opacity-60"
            >
              {approveSubmitting ? 'Approving…' : 'Approve'}
            </button>
          </form>
        </Modal>
      )}

      {decliningInquiry && (
        <Modal
          title={`Decline — ${decliningInquiry.client.firstName} ${decliningInquiry.client.lastName}`}
          onClose={() => setDecliningInquiry(null)}
        >
          <form onSubmit={handleDeclineSubmit}>
            {declineError && (
              <div className="mb-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                {declineError}
              </div>
            )}

            <label htmlFor="declineNote" className="mb-1 block text-sm font-medium text-fg-secondary">
              Why are you declining?
            </label>
            <textarea
              id="declineNote"
              required
              rows={4}
              value={declineNote}
              onChange={(event) => setDeclineNote(event.target.value)}
              className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <p className="mt-1 text-xs text-fg-muted">
              This goes back to staff so they can reassign it — the inquiry returns to the New pool.
            </p>

            <button
              type="submit"
              disabled={declineSubmitting}
              className="mt-5 w-full rounded-full bg-accent px-4 py-2 text-sm font-medium text-bg transition hover:bg-accent-hover disabled:opacity-60"
            >
              {declineSubmitting ? 'Declining…' : 'Decline'}
            </button>
          </form>
        </Modal>
      )}
    </div>
  )
}
