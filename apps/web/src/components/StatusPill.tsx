import { formatStatus } from '../lib/format'

export type Tone = 'success' | 'info' | 'warning' | 'danger' | 'neutral'

// Single source of truth for status -> semantic tone across the whole app.
// Every status pill everywhere renders through this component so the
// mapping only has to be decided once. Keys are the raw enum values from
// apps/api/prisma/schema.prisma (InquiryStatus, AppointmentStatus,
// GiftCardStatus, LiabilityWaiverStatus) -- CONFIRMED is shared by
// InquiryStatus and AppointmentStatus and both map to the same tone, so a
// flat lookup is safe.
const STATUS_TONE: Record<string, Tone> = {
  // Inquiry pipeline
  NEW: 'info',
  ARTIST_ASSIGNED: 'info',
  AWAITING_CLIENT_RESPONSE: 'warning',
  BUDGET_NEGOTIATION: 'warning',
  DEPOSIT_PENDING: 'warning',
  SCHEDULING: 'success',
  WAITLISTED: 'warning',
  CONFIRMED: 'success',
  // Phase 7A: CLOSED_LOST is a deliberate staff action (or the missing-
  // workflow mark-lost route) and reads as danger/red; COLD_LEAD is the
  // automated sweep's quieter outcome and stays neutral/gray -- consistent
  // with the progress-ring terminal colors (#e05252 / #6b6b73) already
  // established in ConversationsPanel.tsx's own RING_TERMINAL_COLORS
  // (a separate, hardcoded map there -- unaffected by this change).
  CLOSED_LOST: 'danger',
  COLD_LEAD: 'neutral',

  // Appointments
  REQUESTED: 'info',
  COMPLETED: 'success',
  CANCELLED: 'neutral',
  NO_SHOW: 'danger',

  // Gift cards
  ACTIVE: 'success',
  REDEEMED: 'neutral',
  EXPIRED: 'warning',
  VOID: 'danger',

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
