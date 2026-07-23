import { formatStatus } from '../lib/format'

export type Tone = 'success' | 'info' | 'warning' | 'danger' | 'neutral' | 'progress' | 'highlight'

// Single source of truth for status -> semantic tone across the whole app.
// Every status pill everywhere renders through this component so the
// mapping only has to be decided once. Keys are the raw enum values from
// apps/api/prisma/schema.prisma (InquiryStatus, AppointmentStatus,
// GiftCardStatus, LiabilityWaiverStatus) -- CONFIRMED is shared by
// InquiryStatus and AppointmentStatus and both map to the same tone, so a
// flat lookup is safe.
//
// Inquiry pipeline: one tone per pipeline STAGE (see InquiryPipeline.tsx's
// own PIPELINE_STEPS grouping), not one tone reused across different
// stages -- previously ARTIST_ASSIGNED/NEW shared info, DEPOSIT_PENDING
// shared warning with the estimate-sent statuses, and WAITLISTED alone
// broke from SCHEDULING/CONFIRMED's green despite being the same
// "Scheduled" step, all of which made the list/Kanban views read as an
// undifferentiated wash of yellow and green. Every stage below now gets
// its own distinct color; statuses that are genuinely the same stage
// (AWAITING_CLIENT_RESPONSE + BUDGET_NEGOTIATION; SCHEDULING + WAITLISTED +
// CONFIRMED) correctly still share one.
const STATUS_TONE: Record<string, Tone> = {
  // Inquiry pipeline
  NEW: 'info',
  ARTIST_ASSIGNED: 'progress',
  AWAITING_CLIENT_RESPONSE: 'warning',
  BUDGET_NEGOTIATION: 'warning',
  DEPOSIT_PENDING: 'highlight',
  SCHEDULING: 'success',
  WAITLISTED: 'success',
  CONFIRMED: 'success',
  // Phase 7A: CLOSED_LOST is a deliberate staff action (or the missing-
  // workflow mark-lost route) and reads as danger/red; COLD_LEAD is the
  // automated sweep's quieter outcome and stays neutral/gray -- consistent
  // with the progress-ring terminal colors (#e05252 / #6b6b73) already
  // established in ConversationsPanel.tsx's own RING_TERMINAL_COLORS
  // (a separate, hardcoded map there -- unaffected by this change).
  CLOSED_LOST: 'danger',
  COLD_LEAD: 'neutral',

  // Appointments -- COMPLETED gets its own tone (previously the same green
  // as CONFIRMED, so an appointment that already happened looked identical
  // to one just booked).
  REQUESTED: 'info',
  COMPLETED: 'progress',
  CANCELLED: 'neutral',
  NO_SHOW: 'danger',

  // Gift cards
  ACTIVE: 'success',
  REDEEMED: 'neutral',
  EXPIRED: 'warning',
  VOID: 'danger',
  EXEMPT: 'info',

  // Liability waivers
  PENDING: 'warning',
  SIGNED: 'info',
  VERIFIED: 'success',

  // Phase 7A: scheduled job runs (Settings -> System)
  RUNNING: 'info',
  SUCCEEDED: 'success',
  FAILED: 'danger',
}

// Tone -> className must stay as literal strings (not built from a
// template with the tone name) so Tailwind's scanner can find them.
const TONE_CLASSES: Record<Tone, string> = {
  success: 'bg-success/15 text-success',
  info: 'bg-info/15 text-info',
  warning: 'bg-warning/15 text-warning',
  danger: 'bg-danger/15 text-danger',
  neutral: 'bg-neutral/15 text-neutral',
  progress: 'bg-progress/15 text-progress',
  highlight: 'bg-highlight/15 text-highlight',
}

// Exported so other components (e.g. the Conversations list's avatar rings)
// can key off the same status -> tone mapping without duplicating it.
export function getStatusTone(status: string): Tone {
  return STATUS_TONE[status] ?? 'neutral'
}

interface StatusPillProps {
  status: string
  label?: string
  className?: string
}

export default function StatusPill({ status, label, className = '' }: StatusPillProps) {
  const tone = STATUS_TONE[status] ?? 'neutral'
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${TONE_CLASSES[tone]} ${className}`}
    >
      {label ?? formatStatus(status)}
    </span>
  )
}
