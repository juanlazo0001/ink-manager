import { CheckIcon } from './icons'

// Single source of truth for "what step is this inquiry on, relative to the
// whole process" -- consumed by InquiryDetail (horizontal, full width), the
// Conversations context panel (vertical, narrow drawer), and the Kanban
// board's Inquiries-tab columns (Package E -- exported so it never grows a
// second, competing grouping scheme). Several raw InquiryStatus values
// collapse into one pipeline step (e.g. both AWAITING_CLIENT_RESPONSE and
// BUDGET_NEGOTIATION are "the client has an estimate and is responding to
// it"). The final 'Scheduled' step is deliberately not used by the Kanban
// board's Inquiries tab -- that step belongs to the Projects tab's own,
// more granular SCHEDULING/WAITLISTED/CONFIRMED columns instead.
export const PIPELINE_STEPS = [
  { label: 'Inquiry received', statuses: ['NEW'] },
  { label: 'Artist assigned', statuses: ['ARTIST_ASSIGNED'] },
  { label: 'Estimate sent', statuses: ['AWAITING_CLIENT_RESPONSE', 'BUDGET_NEGOTIATION'] },
  { label: 'Deposit requested', statuses: ['DEPOSIT_PENDING'] },
  { label: 'Scheduled', statuses: ['SCHEDULING', 'WAITLISTED', 'CONFIRMED'] },
] as const

const CLOSED_STATUSES = ['CLOSED_LOST', 'COLD_LEAD']

function currentStepIndex(status: string): number {
  return PIPELINE_STEPS.findIndex((step) => (step.statuses as readonly string[]).includes(status))
}

interface InquiryPipelineProps {
  status: string
  closedReason?: string | null
  orientation?: 'horizontal' | 'vertical'
  className?: string
  // True when the caller already renders its own "Pipeline" heading above
  // this component (InquiryDetail.tsx wraps it in a <Widget title="Pipeline">)
  // -- suppresses this component's own label so there's exactly one. The
  // other two (labelless-wrapper) callers -- the Conversations context
  // panel and the Kanban board -- leave this false and keep their label.
  hideLabel?: boolean
}

export default function InquiryPipeline({
  status,
  closedReason,
  orientation = 'vertical',
  className = '',
  hideLabel = false,
}: InquiryPipelineProps) {
  const isClosed = CLOSED_STATUSES.includes(status)
  const activeIndex = currentStepIndex(status)

  if (isClosed) {
    return (
      <div className={className}>
        {!hideLabel && <p className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Pipeline</p>}
        <div className={`flex items-center gap-2 ${hideLabel ? '' : 'mt-2'}`}>
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-neutral" />
          <span className="text-sm font-semibold text-fg">
            {status === 'COLD_LEAD' ? 'Cold lead' : 'Closed -- not moving forward'}
          </span>
        </div>
        {closedReason && <p className="mt-1 text-xs text-fg-muted">{closedReason}</p>}
      </div>
    )
  }

  // Shared between the true vertical orientation and horizontal's <md
  // fallback -- factored out (rather than left inside `vertical` below) so
  // the fallback can render it without the "Pipeline" label when hideLabel
  // is set, without affecting the label on the true vertical callers.
  const stepsList = (
    <ol className="mt-3">
      {PIPELINE_STEPS.map((step, index) => {
          const done = index < activeIndex
          const current = index === activeIndex
          const isLast = index === PIPELINE_STEPS.length - 1
          return (
            <li key={step.label} className="relative flex gap-3 pb-5 last:pb-0">
              {!isLast && (
                <span
                  className={`absolute left-[9px] top-5 h-full w-0.5 ${done ? 'bg-accent' : 'bg-border'}`}
                  aria-hidden="true"
                />
              )}
              <span
                className={[
                  'z-10 flex h-5 w-5 shrink-0 items-center justify-center rounded-full',
                  done || current ? 'bg-accent text-bg' : 'border border-border bg-surface-inset',
                ].join(' ')}
              >
                {done && <CheckIcon className="h-3 w-3" />}
              </span>
              <span
                className={[
                  'text-sm leading-5',
                  current ? 'font-semibold text-fg' : done ? 'text-fg-secondary' : 'text-fg-muted',
                ].join(' ')}
              >
                {step.label}
              </span>
            </li>
          )
        })}
    </ol>
  )

  const vertical = (
    <div className={className}>
      {!hideLabel && <p className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Pipeline</p>}
      {stepsList}
    </div>
  )

  if (orientation === 'horizontal') {
    // Steps + labels need real width to lay out side by side; below md
    // there isn't room, so it drops to the same vertical list the narrow
    // chat context panel uses instead of squeezing/wrapping horizontally.
    return (
      <>
        <div className="md:hidden">{hideLabel ? stepsList : vertical}</div>
        {/* Grid, not flex-1 siblings sized off label content -- every
            column is the exact same width regardless of label length, so
            each connector (absolutely positioned at left-1/2, spanning
            w-full of its own column) lands precisely on the *next*
            column's horizontal center, i.e. exactly under the next circle,
            with zero gap on either side (it disappears behind the circle,
            which sits on top via z-10). The previous flex layout centered
            each circle inside a column sized to its own label's width and
            then added a separate mx-1.5 gap before the connector line,
            which is what produced the visible gap on both sides. */}
        <div
          className={`hidden md:grid ${className}`}
          style={{ gridTemplateColumns: `repeat(${PIPELINE_STEPS.length}, minmax(0, 1fr))` }}
        >
          {PIPELINE_STEPS.map((step, index) => {
            const done = index < activeIndex
            const current = index === activeIndex
            const isLast = index === PIPELINE_STEPS.length - 1
            return (
              <div key={step.label} className="relative flex flex-col items-center">
                {!isLast && (
                  <div
                    className={`absolute left-1/2 top-3 h-0.5 w-full ${done ? 'bg-accent' : 'bg-border'}`}
                    aria-hidden="true"
                  />
                )}
                <span
                  className={[
                    'z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                    done || current ? 'bg-accent text-bg' : 'border border-border bg-surface-inset text-fg-muted',
                  ].join(' ')}
                >
                  {done ? <CheckIcon className="h-3 w-3" /> : index + 1}
                </span>
                <span
                  className={[
                    'mt-1.5 whitespace-nowrap text-[11px] font-medium',
                    current ? 'text-fg' : done ? 'text-fg-secondary' : 'text-fg-muted',
                  ].join(' ')}
                >
                  {step.label}
                </span>
              </div>
            )
          })}
        </div>
      </>
    )
  }

  return vertical
}
