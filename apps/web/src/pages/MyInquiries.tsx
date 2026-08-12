import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Modal from '../components/Modal'
import InquiryKanbanBoard from '../components/kanban/InquiryKanbanBoard'
import StatusPill from '../components/StatusPill'
import { INQUIRY_TAB_COLUMNS, PROJECT_TAB_COLUMNS } from './Inquiries'
import { deriveProjectStage, PROJECT_STAGE_LABELS, type KanbanInquiry, type KanbanTransition } from '../lib/kanban'
import { apiFetch } from '../lib/api'
import { formatDateTime, formatStatus } from '../lib/format'
import { useEffectiveUser } from '../context/useEffectiveUser'
import { useMarkSectionSeen } from '../lib/useMarkSectionSeen'
import { assignedInquiriesQueryKey } from '../lib/queryKeys'
import EstimateFieldsEditor, {
  emptyEstimateDraft,
  estimateDraftToRequestFields,
  estimateDraftToSessionsPayload,
  validateEstimateDraft,
  type EstimateDraft,
} from '../components/EstimateFieldsEditor'

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
  assignedArtist:
    | {
        id: string
        hourlyRateCents: number | null
        flatRateCents: number | null
        user: { email: string; name: string | null; avatarUrl: string | null }
      }
    | null
  service: { id: string; name: string; pricingModel: 'RANGE' | 'FLAT' }
  // Also already returned by INQUIRY_INCLUDE (this route's include, same
  // as the Project detail page's own) -- declared here so
  // InquiryKanbanCard's deriveProjectStage sees real data for an artist's
  // own Projects instead of silently falling back to "no sessions yet"
  // for every one of them.
  appointment: { startTime: string } | null
  sessions: { id: string; startTime: string; checkedOutAt: string | null; liabilityWaiver: { status: string } | null }[]
  projectCompletedAt: string | null
}

type ViewMode = 'list' | 'kanban'
type PipelineTab = 'inquiries' | 'projects'

// Same "earliest not-yet-checked-out session" convention as
// deriveProjectStage (lib/kanban.ts) and InquiryDetail.tsx's own
// findCurrentSession -- sessions are already startTime-ascending from the
// backend, so this is "the next session the artist needs to show up for."
function findNextSession(sessions: Inquiry['sessions']) {
  return sessions.find((session) => !session.checkedOutAt) ?? null
}

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

export default function MyInquiries() {
  const user = useEffectiveUser()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  useMarkSectionSeen('inquiries')

  const [approvingInquiry, setApprovingInquiry] = useState<Inquiry | null>(null)
  const [approveDraft, setApproveDraft] = useState<EstimateDraft>(emptyEstimateDraft(false))
  const [approveError, setApproveError] = useState<string | null>(null)
  const [approveSubmitting, setApproveSubmitting] = useState(false)

  const [decliningInquiry, setDecliningInquiry] = useState<Inquiry | null>(null)
  const [declineNote, setDeclineNote] = useState('')
  const [declineError, setDeclineError] = useState<string | null>(null)
  const [declineSubmitting, setDeclineSubmitting] = useState(false)

  // Shared data source for BOTH List and Board (?scope=all, not the
  // narrower default ARTIST_ASSIGNED-only filter) -- List used to fetch its
  // own separate, narrower inbox and never learned about Projects at all,
  // which is exactly why Board was the only place they showed up. One
  // React Query source for both view modes now, same "List/Board are a
  // rendering-mode toggle only" shape Inquiries.tsx's staff view already
  // uses -- also gets the WS inquiry.updated invalidation for free (see
  // assignedInquiriesQueryKey) in both modes.
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [kanbanTab, setKanbanTab] = useState<PipelineTab>('inquiries')

  const {
    data: kanbanInquiries,
    isLoading: kanbanLoading,
    isError: kanbanIsError,
  } = useQuery({
    queryKey: assignedInquiriesQueryKey(user?.studioId ?? ''),
    queryFn: () => apiFetch<Inquiry[]>('/inquiries/assigned-to-me?scope=all'),
    enabled: user?.role === 'ARTIST',
  })

  const kanbanTabStatuses: readonly string[] =
    kanbanTab === 'projects' ? PROJECT_TAB_COLUMNS.flatMap((c) => c.statuses) : INQUIRY_TAB_COLUMNS.flatMap((c) => c.statuses)
  const kanbanFilteredInquiries = kanbanInquiries?.filter((inquiry) => kanbanTabStatuses.includes(inquiry.status))

  // Projects tab: soonest upcoming session first -- that's what the artist
  // actually needs to prep for next. Projects with no scheduled session yet
  // sort to the end but stay visible (nothing to prioritize by, not a
  // reason to hide them). Inquiries tab is untouched -- already
  // most-recently-updated first from the backend.
  const sortedFilteredInquiries =
    kanbanTab === 'projects'
      ? kanbanFilteredInquiries
          ?.slice()
          .sort((a, b) => {
            const aTime = findNextSession(a.sessions)?.startTime
            const bTime = findNextSession(b.sessions)?.startTime
            if (!aTime && !bTime) return 0
            if (!aTime) return 1
            if (!bTime) return -1
            return new Date(aTime).getTime() - new Date(bTime).getTime()
          })
      : kanbanFilteredInquiries

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

  function openApprove(inquiry: Inquiry) {
    setApprovingInquiry(inquiry)
    setApproveDraft(emptyEstimateDraft(inquiry.service.pricingModel === 'FLAT'))
    setApproveError(null)
  }

  // A fresh ARTIST_ASSIGNED inquiry never has a session plan yet (that only
  // exists once an estimate has actually been sent), so hadExistingPlan is
  // always false and there's never a lockedSessions list here.
  const approveValidationError = approvingInquiry
    ? validateEstimateDraft(approveDraft, {
        priceEstimateLow: approvingInquiry.priceEstimateLow,
        priceEstimateHigh: approvingInquiry.priceEstimateHigh,
        timeEstimateHoursMin: null,
        timeEstimateHoursMax: null,
      })
    : null

  async function handleApproveSubmit(event: FormEvent) {
    event.preventDefault()
    if (!approvingInquiry) return

    if (approveValidationError) {
      setApproveError(approveValidationError)
      return
    }

    setApproveError(null)
    setApproveSubmitting(true)

    try {
      await apiFetch(`/inquiries/${approvingInquiry.id}/respond`, {
        method: 'PATCH',
        body: JSON.stringify({
          decision: 'APPROVE',
          ...estimateDraftToRequestFields(approveDraft),
          sessions: estimateDraftToSessionsPayload(approveDraft, false),
        }),
      })

      setApprovingInquiry(null)
      queryClient.invalidateQueries({ queryKey: assignedInquiriesQueryKey(user?.studioId ?? '') })
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
      queryClient.invalidateQueries({ queryKey: assignedInquiriesQueryKey(user?.studioId ?? '') })
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
    <>
        <div className="mx-auto max-w-5xl px-6 py-6 sm:px-10 sm:py-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold text-fg sm:text-3xl">My Inquiries</h1>
              <p className="mt-1 text-sm text-fg-secondary">
                {kanbanTab === 'projects'
                  ? 'Confirmed work: deposit paid through completed.'
                  : 'Tattoo requests assigned to you, from new through a paid deposit.'}
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

          {/* Inquiries/Projects is independent of List vs. Board -- same
              shared data, just two renderings of it (see the query comment
              above), same as the staff Inquiries.tsx page. */}
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

          {viewMode === 'kanban' && (
            <div className="mt-6 rounded-2xl card-surface border border-border bg-surface p-5">
              {kanbanLoading && <p className="text-sm text-fg-secondary">Loading…</p>}
              {!kanbanLoading && (
                <InquiryKanbanBoard
                  key={kanbanTab}
                  inquiries={sortedFilteredInquiries ?? []}
                  columns={kanbanTab === 'projects' ? PROJECT_TAB_COLUMNS : INQUIRY_TAB_COLUMNS}
                  interactiveColumnKeys={kanbanTab === 'projects' ? [] : ['Artist assigned']}
                  resolveTransition={(params) =>
                    resolveArtistTransition({ ...params, inquiry: params.inquiry })
                  }
                  onOpenCard={(id) => {
                    // Flash requests in Inquiries: a card still at
                    // FLASH_PENDING_APPROVAL/FLASH_PAYMENT_PENDING hasn't
                    // converted to a project yet -- MyProjectDetail.tsx
                    // assumes post-conversion fields, and its own backend
                    // route is matrix-gated (inquiries.view), unlike this
                    // request's own dedicated, identity-only page.
                    const inquiry = kanbanInquiries?.find((i) => i.id === id)
                    if (inquiry?.channel === 'FLASH_GALLERY' && inquiry.status.startsWith('FLASH_')) {
                      navigate(`/my-flash-requests/${id}`)
                    } else {
                      navigate(`/my-inquiries/${id}`)
                    }
                  }}
                  emptyMessage="Nothing assigned to you right now."
                />
              )}
            </div>
          )}

          {viewMode === 'list' && kanbanIsError && (
            <div className="mt-6 rounded-2xl card-surface border border-border bg-surface p-5">
              <p className="text-sm text-danger">Failed to load inquiries.</p>
            </div>
          )}

          {viewMode === 'list' && !kanbanIsError && kanbanLoading && (
            <p className="mt-6 text-sm text-fg-secondary">Loading…</p>
          )}

          {viewMode === 'list' && !kanbanIsError && !kanbanLoading && sortedFilteredInquiries && sortedFilteredInquiries.length === 0 && (
            <div className="mt-6 rounded-2xl card-surface border border-border bg-surface p-5">
              <p className="text-sm text-fg-secondary">Nothing assigned to you right now.</p>
            </div>
          )}

          {viewMode === 'list' && !kanbanIsError && !kanbanLoading && sortedFilteredInquiries && sortedFilteredInquiries.length > 0 && (
            <div className="mt-6 space-y-5">
              {sortedFilteredInquiries.map((inquiry) => {
                // Same "a Project shows its pipeline stage, not the raw
                // status" rule as InquiryKanbanCard's own pill -- keeps the
                // List row and this same item's Board card in agreement.
                const projectStage = deriveProjectStage(inquiry)
                // Projects tab: the artist cares about when they next need
                // to show up, not when the client originally submitted the
                // request -- staff's own Inquiries.tsx makes the same swap
                // for its Projects tab date column.
                const nextSession = kanbanTab === 'projects' ? findNextSession(inquiry.sessions) : null
                return (
                <div key={inquiry.id} className="rounded-2xl card-surface border border-border bg-surface p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-semibold text-fg">
                        {inquiry.client.firstName} {inquiry.client.lastName}
                      </h2>
                      <p className="mt-1 text-sm text-fg-secondary">
                        {kanbanTab === 'projects'
                          ? nextSession
                            ? `Scheduled ${formatDateTime(nextSession.startTime)}`
                            : '—'
                          : `Submitted ${formatDateTime(inquiry.createdAt)} via ${formatStatus(inquiry.channel)}`}
                      </p>
                      <StatusPill
                        className="mt-2"
                        status={projectStage ?? inquiry.status}
                        label={projectStage ? PROJECT_STAGE_LABELS[projectStage] : undefined}
                      />
                    </div>
                    <div className="flex gap-2">
                      {inquiry.status === 'ARTIST_ASSIGNED' && (
                        <>
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
                        </>
                      )}
                      <Link
                        to={`/my-inquiries/${inquiry.id}`}
                        className="rounded-full border border-border px-4 py-2 text-sm font-semibold text-fg transition hover:bg-surface"
                      >
                        View details
                      </Link>
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
                )
              })}
            </div>
          )}
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

            <EstimateFieldsEditor
              value={approveDraft}
              onChange={setApproveDraft}
              assignedArtist={approvingInquiry.assignedArtist}
            />

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
    </>
  )
}
