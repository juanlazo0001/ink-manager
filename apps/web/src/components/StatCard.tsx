import type { ReactNode } from 'react'
import { ArrowUpRightIcon, ChevronDownIcon } from './icons'

interface StatCardProps {
  icon: ReactNode
  label: string
  value: string
  delta?: string
  // Whether the delta is good news for this specific metric (e.g. fewer
  // pending consent forms is "positive" even though the count went down) --
  // this is independent of the chevron's up/down direction, which just
  // mirrors the delta string's +/- sign.
  positive?: boolean
}

export default function StatCard({ icon, label, value, delta, positive }: StatCardProps) {
  const trendUp = delta?.trimStart().startsWith('+')
  const toneClass =
    positive === undefined
      ? 'border-border text-fg-secondary'
      : positive
        ? 'border-success/30 bg-success/10 text-success'
        : 'border-danger/30 bg-danger/10 text-danger'

  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <div className="flex min-h-10 items-start justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-fg">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-raised text-fg-secondary">
            {icon}
          </span>
          {label}
        </div>
        <ArrowUpRightIcon className="h-4 w-4 shrink-0 text-fg-muted" />
      </div>

      <p className="mt-4 text-3xl font-bold text-fg">{value}</p>

      {delta && (
        <span className={`mt-3 inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium ${toneClass}`}>
          {delta}
          <ChevronDownIcon className={`h-3 w-3 ${trendUp ? 'rotate-180' : ''}`} />
        </span>
      )}
    </div>
  )
}
