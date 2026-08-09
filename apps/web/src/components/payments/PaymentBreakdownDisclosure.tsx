import { useState } from 'react'
import { formatCents } from '../../lib/money'
import type { PaymentBreakdownItem } from './PaymentFlowStages'

// Progressive disclosure instead of an always-visible itemization -- a
// collapsed "See total breakdown" row that expands to the line items.
// Renders nothing when there's nothing to break down (flash prepayment's
// single price), rather than an empty/pointless disclosure row.
export default function PaymentBreakdownDisclosure({ items }: { items: PaymentBreakdownItem[] }) {
  const [open, setOpen] = useState(false)

  if (items.length === 0) return null

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between text-xs font-medium uppercase tracking-wider text-fg-muted transition hover:text-fg-secondary"
      >
        <span>See total breakdown</span>
        <span aria-hidden="true">{open ? '−' : '+'}</span>
      </button>

      {open && (
        <div className="mt-2 space-y-1.5 rounded-lg border border-border p-3 text-sm">
          {items.map((item) => (
            <div key={item.label} className="flex items-center justify-between">
              <span className="text-fg-secondary">{item.label}</span>
              <span className="text-fg">{formatCents(item.valueCents)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
