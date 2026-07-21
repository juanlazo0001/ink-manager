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
