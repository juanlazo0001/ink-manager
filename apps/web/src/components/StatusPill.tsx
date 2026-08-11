import { formatStatus } from '../lib/format'
import { useThemePreset } from '../lib/useThemePreset'

export type Tone = 'success' | 'info' | 'warning' | 'danger' | 'neutral' | 'progress' | 'highlight' | 'hold'

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
  // Service lines: candidacy review happens before an inquiry ever reaches
  // NEW -- warning (not info like NEW) since it's an action-needed stage,
  // consistent with DEPOSIT_PENDING/AWAITING_CLIENT_RESPONSE's own tone.
  CANDIDACY_REVIEW: 'warning',
  NEW: 'info',
  ARTIST_ASSIGNED: 'progress',
  AWAITING_CLIENT_RESPONSE: 'warning',
  BUDGET_NEGOTIATION: 'warning',
  DEPOSIT_PENDING: 'highlight',
  SCHEDULING: 'success',
  WAITLISTED: 'success',
  CONFIRMED: 'success',
  // Synthetic keys (never real InquiryStatus values) -- the post-conversion
  // Project pipeline's own 5 stages (see deriveProjectStage in
  // lib/kanban.ts), shown as a Project's ONLY status pill everywhere one
  // renders (Inquiries/Projects list+Kanban, Project detail header) --
  // replacing the raw SCHEDULING/WAITLISTED/CONFIRMED pill, which couldn't
  // tell those stages apart (all three showed identically as "Scheduling"
  // regardless of whether the project was actually still waiting to be
  // booked, fully wrapped up, or anywhere in between). Same "one tone per
  // stage" rule as the Inquiry pipeline above -- five distinct colors, not
  // a reused wash.
  NEEDS_SCHEDULING: 'warning',
  SCHEDULED: 'success',
  WAIVER_VERIFIED: 'info',
  SESSION_COMPLETE: 'progress',
  PROJECT_COMPLETE: 'highlight',
  // Phase 7A: CLOSED_LOST is a deliberate staff action (or the missing-
  // workflow mark-lost route) and reads as danger/red; COLD_LEAD is the
  // automated sweep's quieter outcome and stays neutral/gray -- consistent
  // with the progress-ring terminal colors (#e05252 / #6b6b73) already
  // established in ConversationsPanel.tsx's own RING_TERMINAL_COLORS
  // (a separate, hardcoded map there -- unaffected by this change).
  CLOSED_LOST: 'danger',
  COLD_LEAD: 'neutral',
  // On-Hold: a genuinely new kind of state (paused, not any pipeline
  // stage) -- every other tone here is already claimed by a status that
  // can appear in the same Inquiries/Projects list or Kanban board, and
  // red is reserved for punctuation (CLOSED_LOST), never reused for a
  // pause. Its own 'hold' tone (index.css) keeps it distinct from all of
  // them at once instead of reusing e.g. neutral and reading like COLD_LEAD.
  ON_HOLD: 'hold',

  // Appointments -- COMPLETED gets its own tone (previously the same green
  // as CONFIRMED, so an appointment that already happened looked identical
  // to one just booked).
  REQUESTED: 'info',
  COMPLETED: 'progress',
  CANCELLED: 'neutral',
  NO_SHOW: 'danger',
  // Synthetic keys from describeAppointmentStatus (lib/format.ts) -- never
  // real AppointmentStatus values, only ever passed as the `status` prop
  // to substitute a REQUESTED/CONFIRMED pill's tone+label when there's an
  // unsigned waiver or an unchecked-out session. CHECKOUT_OVERDUE (>24h
  // past the appointment's own end time with no checkout) is the one case
  // that escalates to danger/red -- everything else here is still just
  // "needs an action soon", same warning yellow as other _PENDING statuses.
  WAIVER_PENDING: 'warning',
  CHECKOUT_PENDING: 'warning',
  CHECKOUT_OVERDUE: 'danger',

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
// template with the tone name) so Tailwind's scanner can find them. Two
// full sets (not one set + theme-variable overrides) since the 'editorial'
// shape's pill is a structurally different treatment -- bordered/tinted
// instead of solid-filled, plus a dot the 'default' shape never renders --
// not just a different color on the same shape.
const TONE_CLASSES_DEFAULT: Record<Tone, string> = {
  success: 'bg-success/15 text-success',
  info: 'bg-info/15 text-info',
  warning: 'bg-warning/15 text-warning',
  danger: 'bg-danger/15 text-danger',
  neutral: 'bg-neutral/15 text-neutral',
  progress: 'bg-progress/15 text-progress',
  highlight: 'bg-highlight/15 text-highlight',
  hold: 'bg-hold/15 text-hold',
}
const TONE_CLASSES_EDITORIAL: Record<Tone, string> = {
  success: 'border-success/50 bg-success/10 text-success',
  info: 'border-info/50 bg-info/10 text-info',
  warning: 'border-warning/50 bg-warning/10 text-warning',
  danger: 'border-danger/50 bg-danger/10 text-danger',
  neutral: 'border-border-soft bg-white/[0.02] text-neutral',
  progress: 'border-progress/50 bg-progress/10 text-progress',
  highlight: 'border-highlight/50 bg-highlight/10 text-highlight',
  hold: 'border-hold/50 bg-hold/10 text-hold',
}
const TONE_DOT_CLASSES: Record<Tone, string> = {
  success: 'bg-success',
  info: 'bg-info',
  warning: 'bg-warning',
  danger: 'bg-danger-strong',
  neutral: 'bg-neutral',
  progress: 'bg-progress',
  highlight: 'bg-highlight',
  hold: 'bg-hold',
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

// Dual themes: 'default' shape keeps its original plain filled pill;
// 'editorial' shape (ui/restyle-v3, integrated as the "Editorial Gold"
// preset) gets the Jura-tracked bordered pill with a tone-colored dot,
// matching that reference mockup's .badge. Every status pill in the app
// renders through this one component, so branching here is what keeps
// both shapes correct everywhere at once (Inquiries, Projects, Clients,
// Team, Kanban cards, the Conversations badge) without touching any of
// those call sites.
export default function StatusPill({ status, label, className = '' }: StatusPillProps) {
  const tone = STATUS_TONE[status] ?? 'neutral'
  const { shape } = useThemePreset()

  if (shape === 'editorial') {
    return (
      <span
        // Mobile-first: smaller padding/font-size/tracking than desktop,
        // and text allowed to wrap (no whitespace-nowrap) below the `sm`
        // breakpoint -- the longest real labels (describeInquiryStatus's
        // "Opened, awaiting response" / "Sent, not opened yet", rendered
        // uppercase) don't comfortably fit on one line at narrow phone
        // widths even at the reduced size, and wrapping onto a second
        // line reads far better than shrinking the font past legibility.
        // `sm:` restores the original desktop sizing (px-3 py-1.5
        // text-[10px] tracking-[0.16em]) and re-forces one line, since
        // desktop rows have the horizontal room for it.
        className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 font-jura text-[9px] font-bold tracking-[0.08em] uppercase transition-colors duration-base sm:gap-2 sm:whitespace-nowrap sm:px-3 sm:py-1.5 sm:text-[10px] sm:tracking-[0.16em] ${TONE_CLASSES_EDITORIAL[tone]} ${className}`}
      >
        <span
          className={`mt-px h-1 w-1 shrink-0 rounded-full transition-colors duration-base sm:mt-0 sm:h-1.5 sm:w-1.5 ${TONE_DOT_CLASSES[tone]}`}
          aria-hidden="true"
        />
        <span className="leading-tight">{label ?? formatStatus(status)}</span>
      </span>
    )
  }

  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium transition-colors duration-base ${TONE_CLASSES_DEFAULT[tone]} ${className}`}
    >
      {label ?? formatStatus(status)}
    </span>
  )
}
