import { CheckIcon } from './icons'

// Single source of truth for "what step is this inquiry on, relative to the
// whole process" -- consumed by both InquiryDetail (horizontal, full width)
// and the Conversations context panel (vertical, narrow drawer). Several
// raw InquiryStatus values collapse into one pipeline step (e.g. both
// AWAITING_CLIENT_RESPONSE and BUDGET_NEGOTIATION are "the client has an
// estimate and is responding to it").
const PIPELINE_STEPS = [
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
}

export default function InquiryPipeline({
  status,
  closedReason,
  orientation = 'vertical',
  className = '',
}: InquiryPipelineProps) {
  const isClosed = CLOSED_STATUSES.includes(status)
  const activeIndex = currentStepIndex(status)

  if (isClosed) {
    return (
      <div className={className}>
        <p className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Pipeline</p>
        <div className="mt-2 flex items-center gap-2">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-neutral" />
          <span className="text-sm font-semibold text-fg">
            {status === 'COLD_LEAD' ? 'Cold lead' : 'Closed -- not moving forward'}
          </span>
        </div>
        {closedReason && <p className="mt-1 text-xs text-fg-muted">{closedReason}</p>}
      </div>
    )
  }

  if (orientation === 'horizontal') {
    return (
      <div className={`flex items-start ${className}`}>
        {PIPELINE_STEPS.map((step, index) => {
          const done = index < activeIndex
          const current = index === activeIndex
          return (
            <div key={step.label} className="flex flex-1 items-center last:flex-none">
              <div className="flex flex-col items-center gap-1.5">
                <span
                  className={[
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                    done || current ? 'bg-accent text-bg' : 'border border-border bg-surface-inset text-fg-muted',
                  ].join(' ')}
                >
                  {done ? <CheckIcon className="h-3 w-3" /> : index + 1}
                </span>
                <span
                  className={[
                    'whitespace-nowrap text-[11px] font-medium',
                    current ? 'text-fg' : done ? 'text-fg-secondary' : 'text-fg-muted',
                  ].join(' ')}
                >
                  {step.label}
                </span>
              </div>
              {index < PIPELINE_STEPS.length - 1 && (
                <div className={`mx-1.5 h-0.5 flex-1 rounded-full ${done ? 'bg-accent' : 'bg-border'}`} />
              )}
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className={className}>
      <p className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Pipeline</p>
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
    </div>
  )
}
