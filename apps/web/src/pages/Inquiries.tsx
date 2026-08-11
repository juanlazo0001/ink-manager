import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Eyebrow from '../components/Eyebrow'
import { SkeletonTableRows } from '../components/Skeleton'
import StatusPill from '../components/StatusPill'
import StaffInquiryForm from '../components/StaffInquiryForm'
import Modal from '../components/Modal'
import AppointmentForm from '../components/AppointmentForm'
import InquiryKanbanBoard from '../components/kanban/InquiryKanbanBoard'
import { PIPELINE_STEPS } from '../components/InquiryPipeline'
import {
  deriveProjectStage,
  PROJECT_STAGE_ORDER,
  PROJECT_STAGE_LABELS,
  type KanbanColumn,
  type KanbanTransition,
} from '../lib/kanban'
import MultiSelectFilter from '../components/MultiSelectFilter'
import { apiFetch, ApiError } from '../lib/api'
import { formatDateTime, formatStatus, describeInquiryStatus } from '../lib/format'
import { ChevronDownIcon, PhotoIcon, PlusIcon, SearchIcon } from '../components/icons'
import { useAuth } from '../context/useAuth'
import { useUserProfile } from '../context/useUserProfile'
import { inquiriesQueryKey, artistsQueryKey } from '../lib/queryKeys'
import { useMarkSectionSeen } from '../lib/useMarkSectionSeen'
import { useDebouncedValue } from '../lib/useDebouncedValue'
import { ArtistAvatar, artistLabel } from '../components/ArtistAvatar'
import { useThemePreset } from '../lib/useThemePreset'

interface Inquiry {
  id: string
  channel: string
  description: string
  status: string
  createdAt: string
  updatedAt: string
  priceEstimateLow: number | null
  priceEstimateHigh: number | null
  estimateSentAt: string | null
  estimateOpenedAt: string | null
  referenceImages: string[]
  client: { firstName: string; lastName: string }
  assignedArtist: { id: string; user: { email: string; name: string | null; avatarUrl: string | null } } | null
  appointment: { startTime: string } | null
  // 1:many "sessions under this project" (Appointment.inquiryId), startTime-
  // ascending from the backend. Used for deriveProjectStage and to fix the
  // Date column below, which previously checked only the older, usually-
  // null `appointment` link.
  sessions: { id: string; startTime: string; checkedOutAt: string | null; liabilityWaiver: { status: string } | null }[]
  // Project pipeline stage -- see deriveProjectStage in lib/kanban.ts.
  projectCompletedAt: string | null
  // Artist mobility: set only for a row blended in from a studio where the
  // viewer (also an artist, e.g. a solo studio's OWNER) is an active GUEST
  // -- null for every normal home-studio row. Drives the studio badge, the
  // detail-link target (the safer, reduced /my-inquiries/:id view rather
  // than the full staff /inquiries/:id one), and disables Kanban drag --
  // status changes on someone else's studio's project happen from THEIR
  // side, not by dragging a card here.
  fromGuestStudio: { id: string; name: string } | null
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
  // Service lines: a candidacy-review service (e.g. Powder Brows) lands
  // here first, before NEW -- included in this tab's own status list (not
  // the Projects tab's) since it's still a lead, not a converted project.
  'CANDIDACY_REVIEW',
  'NEW',
  'ARTIST_ASSIGNED',
  'AWAITING_CLIENT_RESPONSE',
  'BUDGET_NEGOTIATION',
  'DEPOSIT_PENDING',
  'CLOSED_LOST',
  'COLD_LEAD',
] as const
// On-Hold, Part 3: ON_HOLD is only ever reached from a converted project
// (see the API's own PROJECT_STATUSES-scoped POST /:id/hold), so it belongs
// on this tab, not Inquiries -- appended, not interleaved, so it always
// renders as its own trailing Kanban column (below) rather than looking
// like a fourth step in the SCHEDULING -> WAITLISTED -> CONFIRMED sequence.
export const PROJECTS_TAB_STATUSES = ['SCHEDULING', 'WAITLISTED', 'CONFIRMED', 'ON_HOLD'] as const

// Kanban columns (Package E). Inquiries tab reuses InquiryPipeline's own
// 5-step grouping (its first four steps -- the fifth, 'Scheduled', belongs
// to the Projects tab's own more granular columns below) rather than
// inventing a second grouping scheme. Terminal states collapse into one
// column, consistent with how INQUIRIES_TAB_STATUSES already folds them
// into this tab (Projects never shows them -- see PROJECTS_TAB_STATUSES).
// Service lines: a dedicated column for CANDIDACY_REVIEW, kept OUT of
// PIPELINE_STEPS itself (that array is shared with the vertical/horizontal
// stepper on InquiryDetail.tsx -- prepending a step there would shift every
// other status's step index, making a Tattoo inquiry that's never touched
// candidacy review show a false "done" checkmark for it). Excluded from
// interactiveColumnKeys below -- the three candidacy actions are explicit
// buttons on InquiryDetail.tsx, not a card drag.
const CANDIDACY_REVIEW_COLUMN: KanbanColumn = {
  key: 'CANDIDACY_REVIEW',
  label: 'Candidacy Review',
  statuses: ['CANDIDACY_REVIEW'],
}

export const INQUIRY_TAB_COLUMNS: KanbanColumn[] = [
  CANDIDACY_REVIEW_COLUMN,
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

// On-Hold: the Projects tab's list-view "Group by status" + its Status
// filter dropdown both key off the DERIVED 5-stage pipeline
// (deriveProjectStage), not the raw status -- ON_HOLD has no derived stage
// (deriveProjectStage returns null for it, correctly, since a pause isn't a
// pipeline position), so both need their own explicit 'ON_HOLD' group
// alongside the 5 real stages rather than silently dropping paused projects
// whenever a stage filter is active. The actual Kanban board (columns prop
// above) already gets this for free from PROJECTS_TAB_STATUSES.
function projectGroupKey(inquiry: { status: string }): string {
  return inquiry.status === 'ON_HOLD' ? 'ON_HOLD' : (deriveProjectStage(inquiry) ?? '')
}

interface ArtistOption {
  id: string
  user: { email: string; name: string | null; avatarUrl: string | null }
}

// Values match the backend's own SORT_OPTIONS (inquiries.ts) exactly --
// sent straight through as the `sort` query param, no client-side
// translation. Package H: sorting moved server-side along with the
// filters below, so this list only drives the dropdown's labels.
type SortOption = 'createdAt_desc' | 'createdAt_asc' | 'updatedAt_desc' | 'clientName_asc' | 'clientName_desc'

const SORT_LABELS: Record<SortOption, string> = {
  createdAt_desc: 'Newest first',
  createdAt_asc: 'Oldest first',
  updatedAt_desc: 'Recently updated',
  clientName_asc: 'Client name (A–Z)',
  clientName_desc: 'Client name (Z–A)',
}

// List-view column visibility, toggled from the "Columns" menu and
// persisted so the choice survives a reload. Shared between both tabs
// (same table, same toggles) rather than a separate preference per tab,
// since hiding e.g. Description is just as useful looking at either one.
// Client and Status default to visible (every existing user keeps today's
// layout until they explicitly hide one) but, unlike the other four, are
// NOT the row's only remaining identity if hidden -- the photo/avatar
// column is the one thing that's never optional, since a row with every
// column off would otherwise render as a completely blank clickable strip.
type ColumnKey = 'clientName' | 'channel' | 'description' | 'date' | 'artist' | 'status'
const COLUMN_DEFS: { key: ColumnKey; label: string }[] = [
  { key: 'clientName', label: 'Client' },
  { key: 'channel', label: 'Channel' },
  { key: 'description', label: 'Description' },
  { key: 'date', label: 'Date' },
  { key: 'artist', label: 'Assigned Artist' },
  { key: 'status', label: 'Status' },
]
const DEFAULT_COLUMN_VISIBILITY: Record<ColumnKey, boolean> = {
  clientName: true,
  channel: true,
  description: true,
  date: true,
  artist: true,
  status: true,
}
const COLUMN_VISIBILITY_STORAGE_KEY = 'ink-manager:inquiries-columns'

function loadColumnVisibility(): Record<ColumnKey, boolean> {
  try {
    const raw = localStorage.getItem(COLUMN_VISIBILITY_STORAGE_KEY)
    if (!raw) return DEFAULT_COLUMN_VISIBILITY
    return { ...DEFAULT_COLUMN_VISIBILITY, ...JSON.parse(raw) }
  } catch {
    return DEFAULT_COLUMN_VISIBILITY
  }
}

// Filter/sort/grouping selections, previously reset on every navigation
// away and back (or a reload) -- persisted the same way column visibility
// already is right above (plain localStorage, not per-user -- this file's
// own established precedent, followed here for consistency rather than
// inventing a separate per-user-keyed convention for a sibling preference
// on the same page). One JSON blob under one key rather than one key per
// field, since they're all read/written together.
interface FilterState {
  inquiryStatusFilter: string[]
  // Projects tab only -- ProjectStage values (see lib/kanban.ts), not raw
  // InquiryStatus values. Entirely client-side filtering, same reasoning
  // Group by Status already documents below.
  projectStatusFilter: string[]
  artistFilter: string[]
  groupByStatus: boolean
  sortOption: SortOption
}
const DEFAULT_FILTER_STATE: FilterState = {
  inquiryStatusFilter: [],
  projectStatusFilter: [],
  artistFilter: [],
  groupByStatus: false,
  sortOption: 'createdAt_desc',
}
const FILTER_STATE_STORAGE_KEY = 'ink-manager:inquiries-filters'

function loadFilterState(): FilterState {
  try {
    const raw = localStorage.getItem(FILTER_STATE_STORAGE_KEY)
    if (!raw) return DEFAULT_FILTER_STATE
    return { ...DEFAULT_FILTER_STATE, ...JSON.parse(raw) }
  } catch {
    return DEFAULT_FILTER_STATE
  }
}

export default function Inquiries() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const { profile } = useUserProfile()
  // Solo artist architecture, Phase 3: see Calendar.tsx's own comment --
  // the solo bypass never appears in profile.permissions, so it has to be
  // OR'd in here directly.
  const canCreateAppointment = (profile?.permissions.includes('appointments.create') ?? false) || (profile?.isSoloStudioArtist ?? false)
  // Same permission ClientDetail.tsx's own canCreateInquiry already checks
  // -- POST /inquiries is requirePermission("inquiries.create"), not a
  // hardcoded role gate.
  const canCreateInquiry = profile?.permissions.includes('inquiries.create') ?? false
  const { shape } = useThemePreset()
  const isEditorial = shape === 'editorial'
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
  // Multi-select (Package H): each tab keeps its own status selection so
  // switching tabs doesn't lose it; empty means "every status this tab
  // shows" (sent to the server as the tab's full status list -- see
  // effectiveStatusFilter below -- rather than as "no filter at all",
  // which would leak the other tab's statuses into the results).
  const [inquiryStatusFilter, setInquiryStatusFilter] = useState<string[]>(() => loadFilterState().inquiryStatusFilter)
  const [projectStatusFilter, setProjectStatusFilter] = useState<string[]>(() => loadFilterState().projectStatusFilter)
  const [groupByStatus, setGroupByStatus] = useState(() => loadFilterState().groupByStatus)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search, 300)
  // 'unassigned' is a synthetic value alongside real artist ids -- the
  // backend's ?artistId= param treats it specially (assignedArtistId: null).
  const [artistFilter, setArtistFilter] = useState<string[]>(() => loadFilterState().artistFilter)
  const [sortOption, setSortOption] = useState<SortOption>(() => loadFilterState().sortOption)
  // Not URL-persisted deliberately: setTab below replaces searchParams
  // wholesale on every tab switch, which would otherwise wipe a view=kanban
  // param on every click -- local state survives the tab switch instead.
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [columnVisibility, setColumnVisibility] = useState<Record<ColumnKey, boolean>>(loadColumnVisibility)
  const [showColumnMenu, setShowColumnMenu] = useState(false)
  const columnMenuRef = useRef<HTMLDivElement>(null)
  useMarkSectionSeen('inquiries')

  // Persists on every change rather than intercepting each individual
  // setter (there are a dozen call sites across both tabs) -- one effect
  // watching all six values stays correct regardless of which UI control
  // changed one of them.
  useEffect(() => {
    const state: FilterState = {
      inquiryStatusFilter,
      projectStatusFilter,
      artistFilter,
      groupByStatus,
      sortOption,
    }
    localStorage.setItem(FILTER_STATE_STORAGE_KEY, JSON.stringify(state))
  }, [inquiryStatusFilter, projectStatusFilter, artistFilter, groupByStatus, sortOption])

  useEffect(() => {
    if (!showColumnMenu) return
    function handleClickOutside(event: MouseEvent) {
      if (columnMenuRef.current && !columnMenuRef.current.contains(event.target as Node)) {
        setShowColumnMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showColumnMenu])

  function toggleColumn(key: ColumnKey) {
    setColumnVisibility((prev) => {
      const next = { ...prev, [key]: !prev[key] }
      localStorage.setItem(COLUMN_VISIBILITY_STORAGE_KEY, JSON.stringify(next))
      return next
    })
  }

  function setTab(tab: PipelineTab) {
    setSearchParams(tab === 'inquiries' ? {} : { tab })
  }

  function handleInquiryCreated(inquiryId: string) {
    setShowNewInquiry(false)
    queryClient.invalidateQueries({ queryKey: inquiriesQueryKey(user!.studioId) })
    navigate(`/inquiries/${inquiryId}`)
  }

  // Artist mobility: a blended guest-studio row (see the Inquiry interface's
  // own fromGuestStudio comment) links to the safer, reduced artist-facing
  // detail view instead of the full staff one -- this viewer has no
  // legitimate access to another studio's full financials/notes just
  // because they're a guest artist there. Shared by the List view's row
  // click and the Kanban board's onOpenCard (which only ever hands back an
  // id, not the row itself).
  function openInquiry(id: string) {
    const inquiry = filteredInquiries?.find((i) => i.id === id)
    navigate(inquiry?.fromGuestStudio ? `/my-inquiries/${id}` : `/inquiries/${id}`)
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
    // A blended guest-studio card (see fromGuestStudio) has no PATCH route
    // this viewer can call at all -- every one below is home-studio-scoped
    // on the backend, and status changes for someone else's project happen
    // from their side, not by dragging a card here.
    if (inquiry.fromGuestStudio) {
      return {
        kind: 'reject',
        message: `This project belongs to ${inquiry.fromGuestStudio.name} -- status changes happen from that studio's side.`,
      }
    }
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
    if (inquiry.fromGuestStudio) {
      return {
        kind: 'reject',
        message: `This project belongs to ${inquiry.fromGuestStudio.name} -- status changes happen from that studio's side.`,
      }
    }
    // On-Hold: same open-flow-to-a-modal pattern as CLOSED_LOST's own
    // mark-lost/reopen drag above -- hold takes an optional reason a card
    // drag can't prompt for, so the drop opens InquiryDetail.tsx's hold
    // section instead of firing the request directly. Release (dragging
    // OUT of On Hold) is data-free on the backend, but still opens the
    // same section rather than firing blind -- restoring statusBeforeHold
    // straight from a drop, with no confirmation, risks a client-visible
    // change (a re-opened Confirmed appointment) the staff member dragging
    // didn't mean to trigger.
    if (toColumnKey === 'ON_HOLD') {
      return { kind: 'open-flow', run: () => navigate(`/inquiries/${inquiry.id}?openFlow=hold`) }
    }
    if (fromColumnKey === 'ON_HOLD') {
      return { kind: 'open-flow', run: () => navigate(`/inquiries/${inquiry.id}?openFlow=release`) }
    }
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
    // Package H: /unwaitlist is the new reverse of /waitlist above -- also
    // data-free (no body at all), so this is safe to drag directly too.
    if (fromColumnKey === 'WAITLISTED' && toColumnKey === 'SCHEDULING') {
      return {
        kind: 'direct',
        run: async () => {
          await apiFetch(`/inquiries/${inquiry.id}/unwaitlist`, { method: 'POST' })
          queryClient.invalidateQueries({ queryKey: inquiriesQueryKey(user!.studioId) })
        },
      }
    }
    // WAITLISTED -> CONFIRMED (skipping SCHEDULING) and CONFIRMED's own
    // forward have no route -- both stay dead ends by design.
    return {
      kind: 'reject',
      message: `There's no action that moves a card from ${formatStatus(fromColumnKey)} to ${formatStatus(toColumnKey)}.`,
    }
  }

  const tabStatuses: readonly string[] = activeTab === 'projects' ? PROJECTS_TAB_STATUSES : INQUIRIES_TAB_STATUSES
  const activeStatusFilter = activeTab === 'projects' ? projectStatusFilter : inquiryStatusFilter
  // Empty selection means "everything this tab shows" -- sent explicitly as
  // the tab's full status list rather than omitted, so the server still
  // scopes to this tab (never the other tab's statuses) with nothing
  // checked. See inquiries.ts's GET / for the server-side counterpart.
  // Projects tab's own Status filter selects derived pipeline stages, not
  // real InquiryStatus values (see the filteredInquiries client-side
  // filter below), so the server fetch for that tab always requests every
  // real status it shows -- there's no real-status selection left to
  // narrow it by.
  const effectiveStatusFilter =
    activeTab === 'projects' ? tabStatuses : activeStatusFilter.length > 0 ? activeStatusFilter : tabStatuses

  // Package H: sort + status/artist filters + search all moved server-side
  // (GET /inquiries now takes status[]/artistId[]/q/sort query params) --
  // the query key includes every input that changes the request, so a
  // filter change always refetches instead of silently reusing a stale
  // cache entry for a different filter combination.
  const {
    data: inquiries,
    isLoading,
    error,
  } = useQuery({
    queryKey: [
      ...inquiriesQueryKey(user!.studioId),
      [...effectiveStatusFilter].sort(),
      [...artistFilter].sort(),
      debouncedSearch.trim(),
      sortOption,
    ],
    queryFn: () => {
      const params = new URLSearchParams()
      effectiveStatusFilter.forEach((status) => params.append('status', status))
      artistFilter.forEach((artistId) => params.append('artistId', artistId))
      if (debouncedSearch.trim()) params.set('q', debouncedSearch.trim())
      params.set('sort', sortOption)
      return apiFetch<Inquiry[]>(`/inquiries?${params.toString()}`)
    },
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

  // Client-side post-filter -- a derived pipeline stage isn't a real status
  // column a server-side ?status= filter can express, same reasoning Group
  // by Status already uses for this same tab.
  const filteredInquiries =
    activeTab === 'projects' && activeStatusFilter.length > 0
      ? inquiries?.filter((inquiry) => activeStatusFilter.includes(projectGroupKey(inquiry)))
      : inquiries

  // Groups follow the same pipeline order as the tab's own status list, so
  // "New" always appears above "Assigned" above "Closed", etc. -- not
  // alphabetical, and not insertion order from the API response.
  //
  // Projects tab groups by the derived 5-stage project pipeline
  // (deriveProjectStage) instead of the raw InquiryStatus -- the status
  // pill shown on every row in this tab already reflects that derived
  // stage (SCHEDULING/WAITLISTED/CONFIRMED collapse into it, see
  // deriveProjectStage's own comment), so grouping by the raw status
  // instead previously produced group headers ("Scheduling", "Confirmed")
  // that didn't match the pill shown on any row inside them -- the exact
  // "group by status isn't working" report this fixes.
  const groupedInquiries = groupByStatus
    ? activeTab === 'projects'
      ? [
          ...PROJECT_STAGE_ORDER.map((stage) => ({
            key: stage as string,
            label: PROJECT_STAGE_LABELS[stage],
            items: (filteredInquiries ?? []).filter((inquiry) => deriveProjectStage(inquiry) === stage),
          })),
          {
            key: 'ON_HOLD',
            label: 'On Hold',
            items: (filteredInquiries ?? []).filter((inquiry) => inquiry.status === 'ON_HOLD'),
          },
        ].filter((group) => group.items.length > 0)
      : tabStatuses
          .map((status) => ({
            key: status,
            label: formatStatus(status),
            items: (filteredInquiries ?? []).filter((inquiry) => inquiry.status === status),
          }))
          .filter((group) => group.items.length > 0)
    : null

  function renderRow(inquiry: Inquiry) {
    return (
      <tr key={inquiry.id} onClick={() => openInquiry(inquiry.id)} className="cursor-pointer hover:bg-surface-raised/60">
        <td className="py-3 pl-3">
          {inquiry.referenceImages[0] ? (
            <img src={inquiry.referenceImages[0]} alt="" className="h-10 w-10 rounded-lg object-cover" />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-border text-fg-muted">
              <PhotoIcon className="h-5 w-5" />
            </div>
          )}
        </td>
        {columnVisibility.clientName && (
          <td className={`py-3 text-fg ${lastVisibleColumnKey === 'clientName' ? 'pr-3' : ''}`}>
            {/* Below sm, if Status is also visible, this is the only other
                cell giving the row width -- a long full name would shove
                into (or under) the status pill with no room to wrap. Bounded
                max-widths + truncate at every breakpoint (never max-w-none)
                guarantee the name can never overlap Status, however long it
                is; below sm it also drops to first-name-only so the common
                case reads clean instead of ellipsis-clipped mid-word. */}
            <span className="block max-w-[96px] truncate sm:hidden">{inquiry.client.firstName}</span>
            <span className="hidden max-w-[140px] truncate sm:block md:max-w-[200px] lg:max-w-[280px]">
              {inquiry.client.firstName} {inquiry.client.lastName}
            </span>
            {inquiry.fromGuestStudio && (
              // Same accent-tinted pill Team.tsx's own "Guest artist" badge
              // uses (there: the artist is a guest at THIS studio; here:
              // this row is a guest AT another studio) -- reusing that
              // established color/shape rather than inventing a second one.
              <span className="mt-1 inline-block max-w-[140px] truncate rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent md:max-w-[200px] lg:max-w-[280px]">
                {inquiry.fromGuestStudio.name}
              </span>
            )}
          </td>
        )}
        {columnVisibility.channel && (
          <td className={`hidden py-3 text-fg-secondary md:table-cell ${lastVisibleColumnKey === 'channel' ? 'pr-3' : ''}`}>
            {formatStatus(inquiry.channel)}
          </td>
        )}
        {columnVisibility.description && (
          // Unlike Channel/Date/Artist, this one isn't hidden below md --
          // toggling it on means the user wants to see it, including on a
          // phone. CSS truncate (width-aware ellipsis, not a fixed
          // character count) + a responsive max-width keeps it from
          // overflowing the already-tight mobile row regardless of actual
          // font metrics, growing at each breakpoint as more columns free
          // up room.
          <td
            className={`max-w-[70px] truncate py-3 text-fg-secondary sm:max-w-[160px] md:max-w-[220px] lg:max-w-xs ${lastVisibleColumnKey === 'description' ? 'pr-3' : ''}`}
          >
            {inquiry.description}
          </td>
        )}
        {columnVisibility.date && (
          <td className={`hidden py-3 text-fg-secondary sm:table-cell ${lastVisibleColumnKey === 'date' ? 'pr-3' : ''}`}>
            {activeTab === 'projects'
              ? // Checks the older `appointment` link first, then falls back
                // to the newer `sessions` array (earliest session, already
                // startTime-ascending) -- `appointment` alone is usually
                // null for any project scheduled through the current
                // multi-session flow, which previously made this column
                // always read "Not yet scheduled" even for an already-
                // scheduled project. Real latent bug, fixed here since it's
                // the same underlying signal this session's own Needs
                // Scheduling indicator relies on.
                (inquiry.appointment ?? inquiry.sessions[0])
                ? formatDateTime((inquiry.appointment ?? inquiry.sessions[0]).startTime)
                : 'Not yet scheduled'
              : formatDateTime(inquiry.createdAt)}
          </td>
        )}
        {columnVisibility.artist && (
          <td className={`hidden py-3 text-fg-secondary lg:table-cell ${lastVisibleColumnKey === 'artist' ? 'pr-3' : ''}`}>
            {inquiry.assignedArtist ? (
              <span className="flex min-w-0 items-center gap-1.5">
                <ArtistAvatar artist={inquiry.assignedArtist} className="h-5 w-5" />
                <span className="truncate">{artistLabel(inquiry.assignedArtist)}</span>
              </span>
            ) : (
              <span className="text-fg-muted">Unassigned</span>
            )}
          </td>
        )}
        {columnVisibility.status && (
          <td className={`py-3 ${lastVisibleColumnKey === 'status' ? 'pr-3' : ''}`}>
            <div className="flex flex-wrap items-center gap-1.5">
              {(() => {
                const stage = deriveProjectStage(inquiry)
                return stage ? (
                  <StatusPill status={stage} label={PROJECT_STAGE_LABELS[stage]} />
                ) : (
                  <StatusPill status={inquiry.status} label={describeInquiryStatus(inquiry)} />
                )
              })()}
            </div>
          </td>
        )}
      </tr>
    )
  }

  // Photo/avatar column has no header label and is never optional -- the
  // one thing every row always shows regardless of Columns menu state.
  const visibleColumnCount = 1 + COLUMN_DEFS.filter((c) => columnVisibility[c.key]).length
  // The header row's right rounded corner needs to land on whichever <th>
  // actually renders last now that Status (previously always the last
  // column) can be hidden -- falls back to the photo <th> itself in the
  // degenerate case where every optional column is off.
  const lastVisibleColumnKey = [...COLUMN_DEFS].reverse().find((c) => columnVisibility[c.key])?.key ?? null

  return (
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
              {isEditorial && <Eyebrow>{activeTab === 'projects' ? 'Confirmed Work' : 'The Pipeline'}</Eyebrow>}
              <h1
                className={
                  isEditorial
                    ? 'mt-1 font-display text-[clamp(28px,3.4vw,38px)] font-normal tracking-[-0.015em] text-fg'
                    : 'text-2xl font-bold text-fg sm:text-3xl'
                }
              >
                Inquiries &amp; Projects
              </h1>
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
                className={
                  isEditorial
                    ? 'editorial-btn-primary flex items-center gap-2 rounded-full bg-accent px-4 py-2.5 text-bg transition hover:bg-accent-hover'
                    : 'flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover'
                }
              >
                <PlusIcon className="h-4 w-4" />
                New Appointment
              </button>
            )}

            {activeTab === 'inquiries' && canCreateInquiry && (
              <button
                type="button"
                onClick={() => setShowNewInquiry(true)}
                className={
                  isEditorial
                    ? 'editorial-btn-primary flex items-center gap-2 rounded-full bg-accent px-4 py-2.5 text-bg transition hover:bg-accent-hover'
                    : 'flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-hover'
                }
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
            <MultiSelectFilter
              placeholder="All statuses"
              options={
                activeTab === 'projects'
                  ? [
                      ...PROJECT_STAGE_ORDER.map((stage) => ({ value: stage as string, label: PROJECT_STAGE_LABELS[stage] })),
                      { value: 'ON_HOLD', label: 'On Hold' },
                    ]
                  : tabStatuses.map((status) => ({ value: status, label: formatStatus(status) }))
              }
              selected={activeTab === 'projects' ? projectStatusFilter : inquiryStatusFilter}
              onChange={activeTab === 'projects' ? setProjectStatusFilter : setInquiryStatusFilter}
              className="w-full sm:w-48"
            />

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

            {/* UI simplification pass: meaningless with exactly one artist
                in the studio -- every real option below "Unassigned" would
                always be that one same artist. */}
            {!profile?.isSoloStudio && (
              <MultiSelectFilter
                placeholder="All artists"
                options={[
                  { value: 'unassigned', label: 'Unassigned' },
                  ...(artistOptions?.map((artist) => ({ value: artist.id, label: artistLabel(artist) })) ?? []),
                ]}
                selected={artistFilter}
                onChange={setArtistFilter}
                className="w-44 shrink-0"
              />
            )}

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

            {/* Column visibility only applies to the table, not Kanban cards.
                Every column here, including Client and Status, is optional
                and persisted across reloads (localStorage) -- only the
                photo/avatar column (no header label) is never toggleable. */}
            {viewMode === 'list' && (
              <div ref={columnMenuRef} className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => setShowColumnMenu((v) => !v)}
                  aria-haspopup="listbox"
                  aria-expanded={showColumnMenu}
                  className="flex items-center gap-2 rounded-full border border-border px-3 py-2 text-sm font-medium text-fg-secondary transition hover:bg-surface hover:text-fg"
                >
                  Columns
                  <ChevronDownIcon className="h-4 w-4 shrink-0 text-fg-muted" />
                </button>
                {showColumnMenu && (
                  <div className="absolute right-0 z-10 mt-1 w-52 rounded-lg border border-border bg-surface-inset py-1 shadow-lg">
                    {COLUMN_DEFS.map((column) => (
                      <label
                        key={column.key}
                        className="flex cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm text-fg hover:bg-surface"
                      >
                        <input
                          type="checkbox"
                          checked={columnVisibility[column.key]}
                          onChange={() => toggleColumn(column.key)}
                          className="h-4 w-4 shrink-0 rounded border-border accent-accent"
                        />
                        <span className="min-w-0 flex-1 truncate">
                          {column.key === 'date' ? (activeTab === 'projects' ? 'Scheduled Date' : 'Submitted') : column.label}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="mt-6 card-surface rounded-2xl border border-border bg-surface p-5">
            {errorMessage && <p className="text-sm text-danger">{errorMessage}</p>}

            {!errorMessage && !isLoading && filteredInquiries?.length === 0 && (
              <div className="flex flex-col items-center gap-2 py-10 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-inset text-fg-muted">
                  <PhotoIcon className="h-6 w-6" />
                </div>
                <p className="text-sm text-fg-secondary">
                  {(() => {
                    const hasExtraFilter =
                      artistFilter.length > 0 || debouncedSearch.trim().length > 0 || activeStatusFilter.length > 0
                    if (activeTab === 'projects') {
                      if (hasExtraFilter) return 'No projects match these filters.'
                      return 'No projects yet -- projects appear here once a deposit is paid.'
                    }
                    if (hasExtraFilter) return 'No inquiries match these filters.'
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
                interactiveColumnKeys={(activeTab === 'projects' ? PROJECT_TAB_COLUMNS : INQUIRY_TAB_COLUMNS)
                  .map((column) => column.key)
                  .filter((key) => key !== 'CANDIDACY_REVIEW')}
                resolveTransition={(params) =>
                  activeTab === 'projects'
                    ? resolveProjectsTabTransition({ ...params, inquiry: params.inquiry as Inquiry })
                    : resolveInquiriesTabTransition({ ...params, inquiry: params.inquiry as Inquiry })
                }
                onOpenCard={openInquiry}
              />
            )}

            {!errorMessage && viewMode === 'list' && (isLoading || (filteredInquiries && filteredInquiries.length > 0)) && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="bg-surface-inset text-xs text-fg-muted">
                      <th className={`py-2 pl-3 font-medium ${lastVisibleColumnKey === null ? 'rounded-l-lg rounded-r-lg' : 'rounded-l-lg'}`}></th>
                      {columnVisibility.clientName && (
                        <th className={`py-2 font-medium ${lastVisibleColumnKey === 'clientName' ? 'rounded-r-lg pr-3' : ''}`}>
                          Client
                        </th>
                      )}
                      {columnVisibility.channel && (
                        <th
                          className={`hidden py-2 font-medium md:table-cell ${lastVisibleColumnKey === 'channel' ? 'rounded-r-lg pr-3' : ''}`}
                        >
                          Channel
                        </th>
                      )}
                      {columnVisibility.description && (
                        <th className={`py-2 font-medium ${lastVisibleColumnKey === 'description' ? 'rounded-r-lg pr-3' : ''}`}>
                          Description
                        </th>
                      )}
                      {columnVisibility.date && (
                        <th
                          className={`hidden py-2 font-medium sm:table-cell ${lastVisibleColumnKey === 'date' ? 'rounded-r-lg pr-3' : ''}`}
                        >
                          {activeTab === 'projects' ? 'Scheduled Date' : 'Submitted'}
                        </th>
                      )}
                      {columnVisibility.artist && (
                        <th
                          className={`hidden py-2 font-medium lg:table-cell ${lastVisibleColumnKey === 'artist' ? 'rounded-r-lg pr-3' : ''}`}
                        >
                          Assigned Artist
                        </th>
                      )}
                      {columnVisibility.status && (
                        <th className={`py-2 font-medium ${lastVisibleColumnKey === 'status' ? 'rounded-r-lg pr-3' : ''}`}>Status</th>
                      )}
                    </tr>
                  </thead>
                  {isLoading ? (
                    <SkeletonTableRows
                      rows={6}
                      columns={visibleColumnCount}
                      columnClassNames={[
                        '',
                        ...(columnVisibility.clientName ? [''] : []),
                        ...(columnVisibility.channel ? ['hidden md:table-cell'] : []),
                        ...(columnVisibility.description ? ['max-w-[70px] sm:max-w-[160px] md:max-w-[220px] lg:max-w-xs'] : []),
                        ...(columnVisibility.date ? ['hidden sm:table-cell'] : []),
                        ...(columnVisibility.artist ? ['hidden lg:table-cell'] : []),
                        ...(columnVisibility.status ? [''] : []),
                      ]}
                    />
                  ) : groupedInquiries ? (
                    groupedInquiries.flatMap((group, index) => [
                      // Spacer between groups, its own tbody so divide-y
                      // (scoped to each group's own tbody below) never draws
                      // a border line through it -- just breathing room.
                      ...(index > 0
                        ? [
                            <tbody key={`${group.key}-spacer`} aria-hidden="true">
                              <tr>
                                <td colSpan={visibleColumnCount} className="h-4 p-0"></td>
                              </tr>
                            </tbody>,
                          ]
                        : []),
                      <tbody key={group.key} className="divide-y divide-border">
                        <tr>
                          <td
                            colSpan={visibleColumnCount}
                            className="rounded-lg bg-surface-inset px-3 py-2 text-xs font-semibold uppercase tracking-wider text-fg-muted"
                          >
                            {group.label} ({group.items.length})
                          </td>
                        </tr>
                        {group.items.map(renderRow)}
                      </tbody>,
                    ])
                  ) : (
                    <tbody className="divide-y divide-border">{filteredInquiries!.map(renderRow)}</tbody>
                  )}
                </table>
              </div>
            )}
          </div>
    </div>
  )
}
