import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Sidebar from '../components/Sidebar'
import { SkeletonTableRows } from '../components/Skeleton'
import StatusPill from '../components/StatusPill'
import StaffInquiryForm from '../components/StaffInquiryForm'
import Modal from '../components/Modal'
import AppointmentForm from '../components/AppointmentForm'
import InquiryKanbanBoard from '../components/kanban/InquiryKanbanBoard'
import { PIPELINE_STEPS } from '../components/InquiryPipeline'
import type { KanbanColumn, KanbanTransition } from '../lib/kanban'
import { apiFetch, ApiError } from '../lib/api'
import { formatDateTime, formatStatus } from '../lib/format'
import { PhotoIcon, PlusIcon, SearchIcon } from '../components/icons'
import { useAuth } from '../context/useAuth'
import { useUserProfile } from '../context/useUserProfile'
import { inquiriesQueryKey, artistsQueryKey } from '../lib/queryKeys'
import { useMarkSectionSeen } from '../lib/useMarkSectionSeen'
import { artistLabel } from '../components/ArtistAvatar'

interface Inquiry {
  id: string
  channel: string
  description: string
  status: string
  createdAt: string
  updatedAt: string
  priceEstimateLow: number | null
  priceEstimateHigh: number | null
  referenceImages: string[]
  client: { firstName: string; lastName: string }
  assignedArtist: { id: string; user: { email: string; name: string | null; avatarUrl: string | null } } | null
}

type PipelineTab = 'inquiries' | 'projects'
type ViewMode = 'list' | 'kanban'

// UI-1 §3: one Inquiry table, one nav item, two status-filtered tabs. The
// conversion moment is deposit PAID (the mark-paid transition in
// deposits.ts that issues the gift card and flips the inquiry to
// SCHEDULING) -- an inquiry whose client accepted the estimate but hasn't
// paid yet is still DEPOSIT_PENDING, i.e. still a lead, not a project.
// WAITLISTED is reachable only from SCHEDULING (see inquiries.ts's
// /waitlist route), so it's already-converted work waiting on a time
// slot -- a Projects status, not a lead status, even though the plan's
// prose didn't explicitly place it.
export const INQUIRIES_TAB_STATUSES = [
  'NEW',
  'ARTIST_ASSIGNED',
  'AWAITING_CLIENT_RESPONSE',
  'BUDGET_NEGOTIATION',
  'DEPOSIT_PENDING',
  'CLOSED_LOST',
  'COLD_LEAD',
] as const
export const PROJECTS_TAB_STATUSES = ['SCHEDULING', 'WAITLISTED', 'CONFIRMED'] as const

// Kanban columns (Package E). Inquiries tab reuses InquiryPipeline's own
// 5-step grouping (its first four steps -- the fifth, 'Scheduled', belongs
// to the Projects tab's own more granular columns below) rather than
// inventing a second grouping scheme. Terminal states collapse into one
// column, consistent with how INQUIRIES_TAB_STATUSES already folds them
// into this tab (Projects never shows them -- see PROJECTS_TAB_STATUSES).
export const INQUIRY_TAB_COLUMNS: KanbanColumn[] = [
  ...PIPELINE_STEPS.slice(0, 4).map((step) => ({ key: step.label, label: step.label, statuses: step.statuses })),
  { key: 'INACTIVE', label: 'Inactive', statuses: ['CLOSED_LOST', 'COLD_LEAD'] },
]

// Projects tab: one column per actual status in PROJECTS_TAB_STATUSES
// (verified straight from the enum + this page's own existing filter list,
// not assumed) -- SCHEDULING/WAITLISTED/CONFIRMED, in that order. There is
// no COMPLETED InquiryStatus; completion lives on the separate Appointment
// model and isn't part of this board.
export const PROJECT_TAB_COLUMNS: KanbanColumn[] = PROJECTS_TAB_STATUSES.map((status) => ({
  key: status,
  label: formatStatus(status),
  statuses: [status],
}))

interface ArtistOption {
  id: string
  user: { email: string; name: string | null; avatarUrl: string | null }
}

type SortOption = 'newest' | 'oldest' | 'updated' | 'name-asc' | 'name-desc'

const SORT_LABELS: Record<SortOption, string> = {
  newest: 'Newest first',
  oldest: 'Oldest first',
  updated: 'Recently updated',
  'name-asc': 'Client name (A–Z)',
  'name-desc': 'Client name (Z–A)',
}

function clientName(inquiry: { client: { firstName: string; lastName: string } }): string {
  return `${inquiry.client.firstName} ${inquiry.client.lastName}`
}

function sortInquiries<T extends { createdAt: string; updatedAt: string; client: { firstName: string; lastName: string } }>(
  list: T[],
  sort: SortOption,
): T[] {
  const sorted = [...list]
  switch (sort) {
    case 'newest':
      return sorted.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    case 'oldest':
      return sorted.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    case 'updated':
      return sorted.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    case 'name-asc':
      return sorted.sort((a, b) => clientName(a).localeCompare(clientName(b)))
    case 'name-desc':
      return sorted.sort((a, b) => clientName(b).localeCompare(clientName(a)))
  }
}

type StatusBucket = 'All' | 'New' | 'Assigned' | 'Closed'

const STATUS_BUCKETS: StatusBucket[] = ['All', 'New', 'Assigned', 'Closed']

function bucketFor(status: string): Exclude<StatusBucket, 'All'> {
  if (status === 'NEW') return 'New'
  if (status === 'CLOSED_LOST' || status === 'COLD_LEAD') return 'Closed'
  return 'Assigned'
}

type ProjectStatusFilter = 'All' | (typeof PROJECTS_TAB_STATUSES)[number]

function truncate(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text
}

export default function Inquiries() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const { profile } = useUserProfile()
  const canCreateAppointment = profile?.permissions.includes('appointments.create') ?? false
  // Matches the backend's requireRole(OWNER, FRONT_DESK) gate on the staff
  // inquiries routes -- there's no dedicated permission key for inquiries.
  const canCreateInquiry = user?.role === 'OWNER' || user?.role === 'FRONT_DESK'
  const [searchParams, setSearchParams] = useSearchParams()
  const [showNewInquiry, setShowNewInquiry] = useState(false)
  const [showNewAppointment, setShowNewAppointment] = useState(false)
  const queryClient = useQueryClient()

  // Set by InquiryDetail's permanent-delete flow on redirect -- read once,
  // then cleared from history so a refresh doesn't keep showing it.
  const [flash, setFlash] = useState<string | null>(null)
  useEffect(() => {
    const state = location.state as { flash?: string } | null
    if (state?.flash) {
      setFlash(state.flash)
      window.history.replaceState({}, '')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const activeTab: PipelineTab = searchParams.get('tab') === 'projects' ? 'projects' : 'inquiries'
  const [bucketFilter, setBucketFilter] = useState<StatusBucket>('All')
  const [projectStatusFilter, setProjectStatusFilter] = useState<ProjectStatusFilter>('All')
  const [groupByStatus, setGroupByStatus] = useState(false)
  const [search, setSearch] = useState('')
  const [artistFilter, setArtistFilter] = useState<'All' | 'Unassigned' | string>('All')
  const [sortOption, setSortOption] = useState<SortOption>('newest')
  // Not URL-persisted deliberately: setTab below replaces searchParams
  // wholesale on every tab switch, which would otherwise wipe a view=kanban
  // param on every click -- local state survives the tab switch instead.
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  useMarkSectionSeen('inquiries')

  function setTab(tab: PipelineTab) {
    setSearchParams(tab === 'inquiries' ? {} : { tab })
  }

  function handleInquiryCreated(inquiryId: string) {
    setShowNewInquiry(false)
    queryClient.invalidateQueries({ queryKey: inquiriesQueryKey(user!.studioId) })
    navigate(`/inquiries/${inquiryId}`)
  }

  // Kanban drag resolution (Package E). Every case here either calls the
  // exact same route the rest of the app already uses for that transition,
  // or opens the exact same modal/section InquiryDetail.tsx already has for
  // it (via ?openFlow=..., see the effect there) -- there is no new
  // status-PATCH path. Whatever isn't explicitly handled below is rejected:
  // no route exists to do it, so silently allowing the drag would let a
  // card sit in a column its real status doesn't match.
  function resolveInquiriesTabTransition({
    inquiry,
    fromColumnKey,
    toColumnKey,
  }: {
    inquiry: Inquiry
    fromColumnKey: string
    toColumnKey: string
  }): KanbanTransition {
    if (toColumnKey === 'INACTIVE') {
      return { kind: 'open-flow', run: () => navigate(`/inquiries/${inquiry.id}?openFlow=mark-lost`) }
    }
    if (fromColumnKey === 'INACTIVE') {
      return { kind: 'open-flow', run: () => navigate(`/inquiries/${inquiry.id}?openFlow=reopen`) }
    }
    if (fromColumnKey === 'Inquiry received' && toColumnKey === 'Artist assigned') {
      return { kind: 'open-flow', run: () => navigate(`/inquiries/${inquiry.id}?openFlow=assign`) }
    }
    if (fromColumnKey === 'Artist assigned' && toColumnKey === 'Estimate sent') {
      return { kind: 'open-flow', run: () => navigate(`/inquiries/${inquiry.id}?openFlow=send-estimate`) }
    }
    if (fromColumnKey === 'Estimate sent' && toColumnKey === 'Deposit requested') {
      return {
        kind: 'reject',
        message: "Deposit Requested happens automatically once the client accepts the estimate -- it can't be moved manually.",
      }
    }
    return { kind: 'reject', message: `There's no action that moves a card from ${fromColumnKey} to ${toColumnKey}.` }
  }

  function resolveProjectsTabTransition({
    inquiry,
    fromColumnKey,
    toColumnKey,
  }: {
    inquiry: Inquiry
    fromColumnKey: string
    toColumnKey: string
  }): KanbanTransition {
    if (fromColumnKey === 'SCHEDULING' && toColumnKey === 'CONFIRMED') {
      return { kind: 'open-flow', run: () => navigate(`/inquiries/${inquiry.id}?openFlow=schedule`) }
    }
    // /waitlist takes only an optional note -- genuinely data-free as a
    // drag, unlike every other Projects-tab transition.
    if (fromColumnKey === 'SCHEDULING' && toColumnKey === 'WAITLISTED') {
      return {
        kind: 'direct',
        run: async () => {
          await apiFetch(`/inquiries/${inquiry.id}/waitlist`, { method: 'POST', body: JSON.stringify({}) })
          queryClient.invalidateQueries({ queryKey: inquiriesQueryKey(user!.studioId) })
        },
      }
    }
    // WAITLISTED has no route back into SCHEDULING/CONFIRMED, and CONFIRMED
    // has no forward route at all -- both are dead ends by design today.
    return {
      kind: 'reject',
      message: `There's no action that moves a card from ${formatStatus(fromColumnKey)} to ${formatStatus(toColumnKey)}.`,
    }
  }

  const {
    data: inquiries,
    isLoading,
    error,
  } = useQuery({
    queryKey: inquiriesQueryKey(user!.studioId),
    queryFn: () => apiFetch<Inquiry[]>('/inquiries'),
  })

  const { data: artistOptions } = useQuery({
    queryKey: artistsQueryKey(user!.studioId),
    queryFn: () => apiFetch<ArtistOption[]>('/artists'),
  })

  const errorMessage = error
    ? error instanceof ApiError && error.status === 403
      ? "You don't have permission to view inquiries."
      : error.message
    : null

  const tabStatuses: readonly string[] = activeTab === 'projects' ? PROJECTS_TAB_STATUSES : INQUIRIES_TAB_STATUSES
  const tabFilteredInquiries = inquiries?.filter((inquiry) => tabStatuses.includes(inquiry.status))

  const statusFilteredInquiries =
    activeTab === 'projects'
      ? tabFilteredInquiries?.filter(
          (inquiry) => projectStatusFilter === 'All' || inquiry.status === projectStatusFilter,
        )
      : tabFilteredInquiries?.filter(
          (inquiry) => bucketFilter === 'All' || bucketFor(inquiry.status) === bucketFilter,
        )

  const artistFilteredInquiries = statusFilteredInquiries?.filter((inquiry) => {
    if (artistFilter === 'All') return true
    if (artistFilter === 'Unassigned') return !inquiry.assignedArtist
    return inquiry.assignedArtist?.id === artistFilter
  })

  const searchTerm = search.trim().toLowerCase()
  const searchFilteredInquiries = searchTerm
    ? artistFilteredInquiries?.filter(
        (inquiry) =>
          clientName(inquiry).toLowerCase().includes(searchTerm) ||
          inquiry.description.toLowerCase().includes(searchTerm),
      )
    : artistFilteredInquiries

  const filteredInquiries = searchFilteredInquiries ? sortInquiries(searchFilteredInquiries, sortOption) : undefined

  // Groups follow the same pipeline order as the tab's own status list, so
  // "New" always appears above "Assigned" above "Closed", etc. -- not
  // alphabetical, and not insertion order from the API response.
  const groupedInquiries = groupByStatus
    ? tabStatuses
        .map((status) => ({
          status,
          items: (filteredInquiries ?? []).filter((inquiry) => inquiry.status === status),
        }))
        .filter((group) => group.items.length > 0)
    : null

  function renderRow(inquiry: Inquiry) {
    return (
      <tr
        key={inquiry.id}
        onClick={() => navigate(`/inquiries/${inquiry.id}`)}
        className="cursor-pointer hover:bg-surface-raised/60"
      >
        <td className="py-3 pl-3">
          {inquiry.referenceImages[0] ? (
            <img src={inquiry.referenceImages[0]} alt="" className="h-10 w-10 rounded-lg object-cover" />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-border text-fg-muted">
              <PhotoIcon className="h-5 w-5" />
            </div>
          )}
        </td>
        <td className="py-3 text-fg">
          {/* Below sm, only this cell and Status are visible with nothing
              else to give the row width -- a long full name would shove
              into (or under) the status pill with no room to wrap. Bounded
              max-widths + truncate at every breakpoint (never max-w-none)
              guarantee the name can never overlap Status, however long it
              is; below sm it also drops to first-name-only so the common
              case reads clean instead of ellipsis-clipped mid-word. */}
          <span className="block max-w-[96px] truncate sm:hidden">{inquiry.client.firstName}</span>
          <span className="hidden max-w-[140px] truncate sm:block md:max-w-[200px] lg:max-w-[280px]">
            {inquiry.client.firstName} {inquiry.client.lastName}
          </span>
        </td>
        <td className="hidden py-3 text-fg-secondary md:table-cell">{formatStatus(inquiry.channel)}</td>
        <td className="hidden py-3 text-fg-secondary md:table-cell">{truncate(inquiry.description, 60)}</td>
        <td className="hidden py-3 text-fg-secondary sm:table-cell">{formatDateTime(inquiry.createdAt)}</td>
        <td className="py-3 pr-3">
          <StatusPill status={inquiry.status} />
        </td>
      </tr>
    )
  }

  return (
    <div className="flex min-h-screen bg-bg text-fg">
      <Sidebar />

      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl px-6 py-6 sm:px-10 sm:py-8">
          {flash && (
            <div className="mb-6 flex items-center justify-between gap-3 rounded-2xl border border-success/30 bg-success/10 p-4 text-sm text-success">
              <span>{flash}</span>
              <button type="button" onClick={() => setFlash(null)} className="text-xs font-medium underline">
                Dismiss
              </button>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-fg sm:text-3xl">Inquiries &amp; Projects</h1>
              <p className="mt-1 text-sm text-fg-secondary">
                {activeTab === 'projects'
                  ? 'Confirmed work: deposit paid through completed.'
                  : 'Tattoo requests submitted through your intake form, up through a paid deposit.'}
              </p>
            </div>

            {activeTab === 'projects' && canCreateAppointment && (
              <button
                type="button"
                onClick={() => setShowNewAppointment(true)}
                className="flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover"
              >
                <PlusIcon className="h-4 w-4" />
                New Appointment
              </button>
            )}

            {activeTab === 'inquiries' && canCreateInquiry && (
              <button
                type="button"
                onClick={() => setShowNewInquiry(true)}
                className="flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover"
              >
                <PlusIcon className="h-4 w-4" />
                New Inquiry
              </button>
            )}
          </div>

          {showNewInquiry && (
            <StaffInquiryForm onClose={() => setShowNewInquiry(false)} onCreated={handleInquiryCreated} />
          )}

          {showNewAppointment && (
            <Modal title="New Appointment" onClose={() => setShowNewAppointment(false)}>
              <AppointmentForm
                onCreated={() => {
                  setShowNewAppointment(false)
                  setFlash('Appointment created.')
                  queryClient.invalidateQueries({ queryKey: inquiriesQueryKey(user!.studioId) })
                }}
                onCancel={() => setShowNewAppointment(false)}
              />
            </Modal>
          )}

          <div className="mt-6 flex gap-1 border-b border-border">
            {(
              [
                ['inquiries', 'Inquiries'],
                ['projects', 'Projects'],
              ] as const
            ).map(([tab, label]) => (
              <button
                key={tab}
                type="button"
                onClick={() => setTab(tab)}
                className={[
                  'rounded-t-lg px-4 py-2 text-sm font-medium transition',
                  activeTab === tab ? 'border-b-2 border-accent text-fg' : 'text-fg-muted hover:text-fg',
                ].join(' ')}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <div className="w-full sm:max-w-xs">
              {activeTab === 'projects' ? (
                <select
                  value={projectStatusFilter}
                  onChange={(event) => setProjectStatusFilter(event.target.value as ProjectStatusFilter)}
                  className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                >
                  <option value="All">All statuses</option>
                  {PROJECTS_TAB_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {formatStatus(status)}
                    </option>
                  ))}
                </select>
              ) : (
                <select
                  value={bucketFilter}
                  onChange={(event) => setBucketFilter(event.target.value as StatusBucket)}
                  className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                >
                  {STATUS_BUCKETS.map((bucket) => (
                    <option key={bucket} value={bucket}>
                      {bucket === 'All' ? 'All statuses' : bucket}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg sm:w-56">
              <SearchIcon className="h-4 w-4 shrink-0 text-fg-muted" />
              <input
                type="text"
                placeholder="Search name or description"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="w-full min-w-0 bg-transparent placeholder:text-fg-muted focus:outline-none"
              />
            </div>

            <select
              value={artistFilter}
              onChange={(event) => setArtistFilter(event.target.value)}
              className="shrink-0 rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            >
              <option value="All">All artists</option>
              <option value="Unassigned">Unassigned</option>
              {artistOptions?.map((artist) => (
                <option key={artist.id} value={artist.id}>
                  {artistLabel(artist)}
                </option>
              ))}
            </select>

            <select
              value={sortOption}
              onChange={(event) => setSortOption(event.target.value as SortOption)}
              className="shrink-0 rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            >
              {(Object.keys(SORT_LABELS) as SortOption[]).map((option) => (
                <option key={option} value={option}>
                  {SORT_LABELS[option]}
                </option>
              ))}
            </select>

            {viewMode === 'list' && (
              <button
                type="button"
                onClick={() => setGroupByStatus((v) => !v)}
                aria-pressed={groupByStatus}
                className={[
                  'shrink-0 rounded-full border px-3 py-2 text-sm font-medium transition',
                  groupByStatus
                    ? 'border-accent/40 bg-accent/15 text-accent'
                    : 'border-border text-fg-secondary hover:bg-surface hover:text-fg',
                ].join(' ')}
              >
                Group by status
              </button>
            )}

            {/* List/Kanban is a rendering-mode toggle only -- it shares the
                same fetched `inquiries`, the same tab, and the same filters
                above, so switching modes never changes what's included. */}
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
                  {mode}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
            {errorMessage && <p className="text-sm text-danger">{errorMessage}</p>}

            {!errorMessage && !isLoading && filteredInquiries?.length === 0 && (
              <div className="flex flex-col items-center gap-2 py-10 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-inset text-fg-muted">
                  <PhotoIcon className="h-6 w-6" />
                </div>
                <p className="text-sm text-fg-secondary">
                  {(() => {
                    const hasExtraFilter = artistFilter !== 'All' || searchTerm.length > 0
                    if (activeTab === 'projects') {
                      if (projectStatusFilter !== 'All' || hasExtraFilter) return 'No projects match these filters.'
                      return 'No projects yet -- projects appear here once a deposit is paid.'
                    }
                    if (bucketFilter !== 'All' || hasExtraFilter) return 'No inquiries match these filters.'
                    return 'No inquiries yet.'
                  })()}
                </p>
              </div>
            )}

            {!errorMessage && !isLoading && viewMode === 'kanban' && filteredInquiries && filteredInquiries.length > 0 && (
              <InquiryKanbanBoard
                key={activeTab}
                inquiries={filteredInquiries}
                columns={activeTab === 'projects' ? PROJECT_TAB_COLUMNS : INQUIRY_TAB_COLUMNS}
                interactiveColumnKeys={(activeTab === 'projects' ? PROJECT_TAB_COLUMNS : INQUIRY_TAB_COLUMNS).map(
                  (column) => column.key,
                )}
                resolveTransition={(params) =>
                  activeTab === 'projects'
                    ? resolveProjectsTabTransition({ ...params, inquiry: params.inquiry as Inquiry })
                    : resolveInquiriesTabTransition({ ...params, inquiry: params.inquiry as Inquiry })
                }
                onOpenCard={(id) => navigate(`/inquiries/${id}`)}
              />
            )}

            {!errorMessage && viewMode === 'list' && (isLoading || (filteredInquiries && filteredInquiries.length > 0)) && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="bg-surface-inset text-xs text-fg-muted">
                      <th className="rounded-l-lg py-2 pl-3 font-medium"></th>
                      <th className="py-2 font-medium">Client</th>
                      <th className="hidden py-2 font-medium md:table-cell">Channel</th>
                      <th className="hidden py-2 font-medium md:table-cell">Description</th>
                      <th className="hidden py-2 font-medium sm:table-cell">Submitted</th>
                      <th className="rounded-r-lg py-2 pr-3 font-medium">Status</th>
                    </tr>
                  </thead>
                  {isLoading ? (
                    <SkeletonTableRows
                      rows={6}
                      columns={6}
                      columnClassNames={['', '', 'hidden md:table-cell', 'hidden md:table-cell', 'hidden sm:table-cell', '']}
                    />
                  ) : groupedInquiries ? (
                    groupedInquiries.map((group) => (
                      <tbody key={group.status} className="divide-y divide-border">
                        <tr>
                          <td
                            colSpan={6}
                            className="bg-surface-inset px-3 py-2 text-xs font-semibold uppercase tracking-wider text-fg-muted"
                          >
                            {formatStatus(group.status)} ({group.items.length})
                          </td>
                        </tr>
                        {group.items.map(renderRow)}
                      </tbody>
                    ))
                  ) : (
                    <tbody className="divide-y divide-border">{filteredInquiries!.map(renderRow)}</tbody>
                  )}
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
