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
  // Optional -- only Inquiries.tsx's own fetch (GET /inquiries) currently
  // requests these; MyInquiries.tsx's ARTIST-scoped board
  // (/inquiries/assigned-to-me) doesn't, so its cards simply never show
  // the Needs Scheduling badge (undefined, not incorrectly false) rather
  // than requiring every KanbanInquiry consumer to fetch fields it
  // doesn't otherwise need.
  appointment?: unknown
  sessions?: { id: string }[]
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
