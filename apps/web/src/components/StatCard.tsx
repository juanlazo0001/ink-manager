import type { ReactNode } from 'react'
import { ArrowUpRightIcon, ChevronDownIcon } from './icons'

interface StatCardProps {
  icon: ReactNode
  label: string
  value: string
  delta?: string
}

export default function StatCard({ icon, label, value, delta }: StatCardProps) {
  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
      <div className="flex min-h-10 items-start justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-white">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-neutral-800 text-neutral-300">
            {icon}
          </span>
          {label}
        </div>
        <ArrowUpRightIcon className="h-4 w-4 shrink-0 text-neutral-500" />
      </div>

      <p className="mt-4 text-3xl font-bold text-white">{value}</p>

      {delta && (
        <span className="mt-3 inline-flex items-center gap-1 rounded-full border border-neutral-800 px-2.5 py-1 text-xs font-medium text-neutral-400">
          {delta}
          <ChevronDownIcon className="h-3 w-3" />
        </span>
      )}
    </div>
  )
}
