import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import Sidebar from '../components/Sidebar'
import { SkeletonTableRows } from '../components/Skeleton'
import StatusPill from '../components/StatusPill'
import { apiFetch, ApiError } from '../lib/api'
import { formatDateTime, formatStatus } from '../lib/format'
import { PhotoIcon, PlusIcon } from '../components/icons'
import { useAuth } from '../context/useAuth'
import { useUserProfile } from '../context/useUserProfile'
import { inquiriesQueryKey } from '../lib/queryKeys'
import { useMarkSectionSeen } from '../lib/useMarkSectionSeen'

interface Inquiry {
  id: string
  channel: string
  description: string
  status: string
  createdAt: string
  referenceImages: string[]
  client: { firstName: string; lastName: string }
}

type PipelineTab = 'inquiries' | 'projects'

// UI-1 §3: one Inquiry table, one nav item, two status-filtered tabs. The
// conversion moment is deposit PAID (the mark-paid transition in
// deposits.ts that issues the gift card and flips the inquiry to
// SCHEDULING) -- an inquiry whose client accepted the estimate but hasn't
// paid yet is still DEPOSIT_PENDING, i.e. still a lead, not a project.
// WAITLISTED is reachable only from SCHEDULING (see inquiries.ts's
// /waitlist route), so it's already-converted work waiting on a time
// slot -- a Projects status, not a lead status, even though the plan's
// prose didn't explicitly place it.
const INQUIRIES_TAB_STATUSES = [
  'NEW',
  'ARTIST_ASSIGNED',
  'AWAITING_CLIENT_RESPONSE',
  'BUDGET_NEGOTIATION',
  'DEPOSIT_PENDING',
  'CLOSED_LOST',
  'COLD_LEAD',
] as const
const PROJECTS_TAB_STATUSES = ['SCHEDULING', 'WAITLISTED', 'CONFIRMED'] as const

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
  const { user } = useAuth()
  const { profile } = useUserProfile()
  const canCreateAppointment = profile?.permissions.includes('appointments.create') ?? false
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab: PipelineTab = searchParams.get('tab') === 'projects' ? 'projects' : 'inquiries'
  const [bucketFilter, setBucketFilter] = useState<StatusBucket>('All')
  const [projectStatusFilter, setProjectStatusFilter] = useState<ProjectStatusFilter>('All')
  useMarkSectionSeen('inquiries')

  function setTab(tab: PipelineTab) {
    setSearchParams(tab === 'inquiries' ? {} : { tab })
  }

  const {
    data: inquiries,
    isLoading,
    error,
  } = useQuery({
    queryKey: inquiriesQueryKey(user!.studioId),
    queryFn: () => apiFetch<Inquiry[]>('/inquiries'),
  })

  const errorMessage = error
    ? error instanceof ApiError && error.status === 403
      ? "You don't have permission to view inquiries."
      : error.message
    : null

  const tabStatuses: readonly string[] = activeTab === 'projects' ? PROJECTS_TAB_STATUSES : INQUIRIES_TAB_STATUSES
  const tabFilteredInquiries = inquiries?.filter((inquiry) => tabStatuses.includes(inquiry.status))

  const filteredInquiries =
    activeTab === 'projects'
      ? tabFilteredInquiries?.filter(
          (inquiry) => projectStatusFilter === 'All' || inquiry.status === projectStatusFilter,
        )
      : tabFilteredInquiries?.filter(
          (inquiry) => bucketFilter === 'All' || bucketFor(inquiry.status) === bucketFilter,
        )

  return (
    <div className="flex min-h-screen bg-bg text-fg">
      <Sidebar />

      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl px-6 py-6 sm:px-10 sm:py-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-fg sm:text-3xl">Inquiries &amp; Projects</h1>
              <p className="mt-1 text-sm text-fg-secondary">
                {activeTab === 'projects'
                  ? 'Confirmed work: deposit paid through completed.'
                  : 'Tattoo requests submitted through your intake form, up through a paid deposit.'}
              </p>
            </div>

            {canCreateAppointment && (
              <button
                type="button"
                onClick={() => navigate('/calendar?new=1')}
                className="flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover"
              >
                <PlusIcon className="h-4 w-4" />
                New Appointment
              </button>
            )}
          </div>

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

          <div className="mt-6 flex items-center gap-2 sm:max-w-xs">
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

          <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
            {errorMessage && <p className="text-sm text-danger">{errorMessage}</p>}

            {!errorMessage && !isLoading && filteredInquiries?.length === 0 && (
              <div className="flex flex-col items-center gap-2 py-10 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-inset text-fg-muted">
                  <PhotoIcon className="h-6 w-6" />
                </div>
                <p className="text-sm text-fg-secondary">
                  {activeTab === 'projects'
                    ? projectStatusFilter !== 'All'
                      ? 'No projects match this filter.'
                      : 'No projects yet -- projects appear here once a deposit is paid.'
                    : bucketFilter !== 'All'
                      ? 'No inquiries match this filter.'
                      : 'No inquiries yet.'}
                </p>
              </div>
            )}

            {!errorMessage && (isLoading || (filteredInquiries && filteredInquiries.length > 0)) && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="bg-surface-inset text-xs text-fg-muted">
                      <th className="rounded-l-lg py-2 pl-3 font-medium"></th>
                      <th className="py-2 font-medium">Client</th>
                      <th className="hidden py-2 font-medium md:table-cell">Channel</th>
                      <th className="hidden py-2 font-medium md:table-cell">Description</th>
                      <th className="py-2 font-medium">Submitted</th>
                      <th className="rounded-r-lg py-2 pr-3 font-medium">Status</th>
                    </tr>
                  </thead>
                  {isLoading ? (
                    <SkeletonTableRows rows={6} columns={6} />
                  ) : (
                    <tbody className="divide-y divide-border">
                      {filteredInquiries!.map((inquiry) => (
                        <tr
                          key={inquiry.id}
                          onClick={() => navigate(`/inquiries/${inquiry.id}`)}
                          className="cursor-pointer hover:bg-surface-raised/60"
                        >
                          <td className="py-3 pl-3">
                            {inquiry.referenceImages[0] ? (
                              <img
                                src={inquiry.referenceImages[0]}
                                alt=""
                                className="h-10 w-10 rounded-lg object-cover"
                              />
                            ) : (
                              <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-border text-fg-muted">
                                <PhotoIcon className="h-5 w-5" />
                              </div>
                            )}
                          </td>
                          <td className="py-3 text-fg">
                            {inquiry.client.firstName} {inquiry.client.lastName}
                          </td>
                          <td className="hidden py-3 text-fg-secondary md:table-cell">
                            {formatStatus(inquiry.channel)}
                          </td>
                          <td className="hidden py-3 text-fg-secondary md:table-cell">
                            {truncate(inquiry.description, 60)}
                          </td>
                          <td className="py-3 text-fg-secondary">{formatDateTime(inquiry.createdAt)}</td>
                          <td className="py-3 pr-3">
                            <StatusPill status={inquiry.status} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
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
