import { formatCents } from '../lib/money'

export interface GiftCardOption {
  id: string
  code: string
  amountCents: number
  status: string
  expiresAt: string | null
  appointmentId: string | null
}

export function isCardAvailable(card: GiftCardOption): boolean {
  if ((card.status !== 'ACTIVE' && card.status !== 'EXEMPT') || card.appointmentId) return false
  return !card.expiresAt || new Date(card.expiresAt) > new Date()
}

function cardLabel(card: GiftCardOption): string {
  return card.status === 'EXEMPT' ? 'Deposit Exemption' : formatCents(card.amountCents)
}

// Stackable gift cards: multiple cards can attach to one appointment,
// together needing only to meet or exceed the required deposit -- not one
// dropdown picking exactly one card. Shared by AppointmentForm.tsx (the
// standalone/calendar-click-to-create flow) and InquiryDetail.tsx's own
// /schedule flow, which previously each had their own single-<select>
// gift-card picker.
export default function GiftCardStackPicker({
  cards,
  selectedIds,
  onChange,
  requiredCents,
}: {
  cards: GiftCardOption[]
  selectedIds: string[]
  onChange: (ids: string[]) => void
  requiredCents: number
}) {
  const totalCents = cards.filter((c) => selectedIds.includes(c.id)).reduce((sum, c) => sum + c.amountCents, 0)
  const sufficient = totalCents >= requiredCents

  function toggle(id: string, checked: boolean) {
    onChange(checked ? [...selectedIds, id] : selectedIds.filter((v) => v !== id))
  }

  if (cards.length === 0) {
    return <p className="text-sm text-fg-secondary">This client has no available gift card.</p>
  }

  return (
    <div>
      <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
        {cards.map((card) => (
          <label
            key={card.id}
            className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-sm text-fg-secondary hover:bg-surface-inset"
          >
            <span className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={selectedIds.includes(card.id)}
                onChange={(e) => toggle(card.id, e.target.checked)}
                className="accent-accent"
              />
              {cardLabel(card)} — {card.code.slice(0, 8)}…
            </span>
            {card.expiresAt && (
              <span className="shrink-0 text-xs text-fg-muted">
                expires {new Date(card.expiresAt).toLocaleDateString()}
              </span>
            )}
          </label>
        ))}
      </div>

      <div
        className={`mt-2 rounded-lg border px-3 py-2 text-sm ${
          sufficient ? 'border-success/30 bg-success/10 text-success' : 'border-warning/30 bg-warning/10 text-warning'
        }`}
      >
        <span className="font-semibold">{formatCents(totalCents)}</span> selected of{' '}
        <span className="font-semibold">{formatCents(requiredCents)}</span> required
        {!sufficient && requiredCents > 0 && ` — ${formatCents(requiredCents - totalCents)} short`}
      </div>
    </div>
  )
}
