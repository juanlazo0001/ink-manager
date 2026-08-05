// Shared types for the Inquiries & Projects Kanban board (Package E) --
// consumed by both Inquiries.tsx (OWNER/FRONT_DESK, full studio board) and
// MyInquiries.tsx (ARTIST, filtered to their own assigned inquiries). Kept
// separate from the board component itself so both pages can build their
// own role-appropriate transition rules without importing React.

export interface KanbanInquiry {
  id: string
  status: string
  description: string
  updatedAt: string
  priceEstimateLow: number | null
  priceEstimateHigh: number | null
  client: { firstName: string; lastName: string }
  assignedArtist: { id: string; user: { email: string; name: string | null; avatarUrl: string | null } } | null
  // Optional so a consumer that genuinely doesn't fetch these (there isn't
  // one today -- both Inquiries.tsx's GET /inquiries and MyInquiries.tsx's
  // GET /inquiries/assigned-to-me already include them) degrades to
  // "derive nothing" (undefined, not incorrectly false/empty) rather than
  // every KanbanInquiry consumer being forced to declare fields it might
  // not need.
  appointment?: unknown
  sessions?: ProjectStageSession[]
  projectCompletedAt?: string | null
  // Artist mobility: set only on a card blended in from a studio where the
  // viewer is an active GUEST artist (Inquiries.tsx's own GET / response).
  // Optional/undefined for MyInquiries.tsx's board, which never populates
  // it -- same "consumer that doesn't fetch it just sees nothing" shape as
  // every other optional field here.
  fromGuestStudio?: { id: string; name: string } | null
}

// A Project (deposit-paid Inquiry) with zero linked Appointments yet --
// derived entirely from data the list/detail endpoints already return, no
// schema change. Checks both the older 1:1 `appointment` link and the
// newer 1:many `sessions` link, same OR the backend's own
// GET /reports/dashboard already uses for its "scheduled" count (a few
// dev-seed fixtures only ever populated one of the two). This is the one
// canonical definition -- Inquiries.tsx's list rows, its Kanban cards
// (below), and its own PROJECTS_TAB_STATUSES export all key off the same
// three statuses; kept as its own literal here (not imported from
// Inquiries.tsx) purely so this shared component-level helper doesn't
// import from a page. If PROJECTS_TAB_STATUSES in Inquiries.tsx ever
// changes, update this list to match.
const PROJECT_STATUSES: readonly string[] = ['SCHEDULING', 'WAITLISTED', 'CONFIRMED']
export function projectNeedsScheduling(inquiry: {
  status: string
  appointment?: unknown
  sessions?: { id: string }[]
}): boolean {
  return PROJECT_STATUSES.includes(inquiry.status) && !inquiry.appointment && (inquiry.sessions?.length ?? 0) === 0
}

// The post-conversion Project journey -- one canonical 5-stage list, so the
// status pill shown on a Project (list row, Kanban card, detail header) and
// InquiryDetail.tsx's own Pipeline widget can never drift out of sync with
// each other. Order matters: PROJECT_STAGE_ORDER's index IS the Pipeline
// widget's step index (see InquiryDetail.tsx's deriveProjectStageIndex).
export type ProjectStage = 'NEEDS_SCHEDULING' | 'SCHEDULED' | 'WAIVER_VERIFIED' | 'SESSION_COMPLETE' | 'PROJECT_COMPLETE'

export const PROJECT_STAGE_ORDER: readonly ProjectStage[] = [
  'NEEDS_SCHEDULING',
  'SCHEDULED',
  'WAIVER_VERIFIED',
  'SESSION_COMPLETE',
  'PROJECT_COMPLETE',
]

export const PROJECT_STAGE_LABELS: Record<ProjectStage, string> = {
  NEEDS_SCHEDULING: 'Needs Scheduling',
  SCHEDULED: 'Scheduled',
  WAIVER_VERIFIED: 'Waiver Verified',
  SESSION_COMPLETE: 'Session Complete',
  PROJECT_COMPLETE: 'Project Complete',
}

export interface ProjectStageSession {
  id: string
  checkedOutAt?: string | null
  liabilityWaiver?: { status: string } | null
}

// Returns which of the 5 stages a Project currently sits at -- the LAST
// completed milestone, not "the stepper's current goal" (those read
// differently: showing "Waiver Verified" while the waiver isn't actually
// verified yet would be a false statement on a pill, even though it's the
// right thing for a stepper to bold as "what we're working toward next").
// null for anything that isn't a converted Project at all (a real
// InquiryStatus pill should be shown instead) -- callers already know this
// from PROJECT_STATUSES-gated context (the Projects tab, a Project detail
// page), so this never needs to duplicate that check itself... except it
// does, defensively, since a stale/mixed list is exactly the kind of bug
// this whole feature exists to prevent.
export function deriveProjectStage(inquiry: {
  status: string
  projectCompletedAt?: string | null
  appointment?: unknown
  sessions?: ProjectStageSession[]
}): ProjectStage | null {
  if (!PROJECT_STATUSES.includes(inquiry.status)) return null
  if (inquiry.projectCompletedAt) return 'PROJECT_COMPLETE'

  const sessions = inquiry.sessions ?? []
  // Same OR as projectNeedsScheduling/the Dashboard's own count query
  // (GET /reports/dashboard) -- checks both the older 1:1 `appointment`
  // link and the newer 1:many `sessions` link, so this agrees with every
  // other "needs scheduling" definition in the app instead of being a
  // narrower one that only happens to match while no project's data hits
  // the gap between them.
  if (sessions.length === 0 && !inquiry.appointment) return 'NEEDS_SCHEDULING'

  // Sessions are already startTime-ascending from the backend -- the
  // earliest not-yet-checked-out one is "the session currently being
  // worked toward," same convention InquiryDetail.tsx's own
  // findCurrentSession uses.
  const current = sessions.find((session) => !session.checkedOutAt)
  if (!current) return 'SESSION_COMPLETE'
  if (current.liabilityWaiver?.status === 'VERIFIED') return 'WAIVER_VERIFIED'
  return 'SCHEDULED'
}

export interface KanbanColumn {
  key: string
  label: string
  statuses: readonly string[]
}

// A drag from one column to another resolves to exactly one of these:
// - 'direct': the transition needs no input beyond "this happened" --
//   `run` calls the real route immediately.
// - 'open-flow': the transition needs input the card doesn't have (an
//   artist, estimate numbers, a time slot, a reason) -- `run` opens the
//   exact existing modal/section for it instead of touching the status.
// - 'reject': no legitimate existing action performs this transition
//   (backward, or sideways with nothing wired up for it) -- shown as an
//   inline error, the card never leaves its column.
export type KanbanTransition =
  | { kind: 'direct'; run: () => Promise<void> }
  | { kind: 'open-flow'; run: () => void }
  | { kind: 'reject'; message: string }

export function columnKeyForStatus(columns: KanbanColumn[], status: string): string | undefined {
  return columns.find((column) => (column.statuses as readonly string[]).includes(status))?.key
}
