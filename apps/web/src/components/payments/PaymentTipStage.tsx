import { useState } from 'react'
import { ApiError } from '../../lib/api'
import { dollarsToCents, formatCents } from '../../lib/money'

const PRESET_PERCENTS = [15, 18, 20]

type Selection = { kind: 'preset'; percent: number } | { kind: 'custom' } | { kind: 'none' }

// Session checkout only. Tip is computed on `subtotalCents` (the session's
// full price, finalCostCents) -- NOT `baseTotalCents` (what's actually
// being charged today after gift-card redemption) -- but the live running
// total shown here is baseTotalCents + the selected tip, since that's what
// the client is about to pay right now.
export default function PaymentTipStage({
  subtotalCents,
  baseTotalCents,
  onContinue,
  onBack,
}: {
  subtotalCents: number
  baseTotalCents: number
  onContinue: (tipCents: number) => Promise<void>
  onBack: () => void
}) {
  const [selection, setSelection] = useState<Selection | null>(null)
  const [customDollars, setCustomDollars] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const tipCents =
    selection === null
      ? null
      : selection.kind === 'none'
        ? 0
        : selection.kind === 'preset'
          ? Math.round((subtotalCents * selection.percent) / 100)
          : customDollars.trim() && Number.isFinite(Number(customDollars))
            ? dollarsToCents(Number(customDollars))
            : null

  const totalCents = baseTotalCents + (tipCents ?? 0)

  async function handleContinue() {
    if (tipCents === null) return
    setSubmitting(true)
    setError(null)
    try {
      await onContinue(tipCents)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
      setSubmitting(false)
    }
  }

  return (
    <div>
      <h2 className="login-jura text-center text-lg font-semibold text-fg">Add a tip?</h2>
      <p className="mt-1 text-center text-sm text-fg-secondary">
        100% goes to your artist -- computed on the {formatCents(subtotalCents)} session price.
      </p>

      <div className="mt-5 grid grid-cols-2 gap-2">
        {PRESET_PERCENTS.map((percent) => {
          const active = selection?.kind === 'preset' && selection.percent === percent
          return (
            <button
              key={percent}
              type="button"
              onClick={() => setSelection({ kind: 'preset', percent })}
              className={`rounded-lg border px-3 py-3 text-sm font-medium transition ${
                active ? 'border-accent bg-accent/10 text-fg' : 'border-border text-fg-secondary hover:bg-surface-inset'
              }`}
            >
              {percent}%
              <span className="block text-xs text-fg-muted">
                {formatCents(Math.round((subtotalCents * percent) / 100))}
              </span>
            </button>
          )
        })}

        <button
          type="button"
          onClick={() => setSelection({ kind: 'custom' })}
          className={`rounded-lg border px-3 py-3 text-sm font-medium transition ${
            selection?.kind === 'custom' ? 'border-accent bg-accent/10 text-fg' : 'border-border text-fg-secondary hover:bg-surface-inset'
          }`}
        >
          Custom
        </button>

        <button
          type="button"
          onClick={() => setSelection({ kind: 'none' })}
          className={`rounded-lg border px-3 py-3 text-sm font-medium transition ${
            selection?.kind === 'none' ? 'border-accent bg-accent/10 text-fg' : 'border-border text-fg-secondary hover:bg-surface-inset'
          }`}
        >
          No tip
        </button>
      </div>

      {selection?.kind === 'custom' && (
        <div className="mt-3">
          <label className="mb-1 block text-sm font-medium text-fg-secondary">Custom tip ($)</label>
          <input
            type="number"
            min="0"
            step="0.01"
            autoFocus
            value={customDollars}
            onChange={(e) => setCustomDollars(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
      )}

      <div className="mt-5 rounded-lg border border-border p-3 text-sm">
        <p className="flex items-center justify-between text-fg-secondary">
          <span>Total today</span>
          <span className="font-semibold text-fg">{formatCents(totalCents)}</span>
        </p>
      </div>

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}

      <div className="mt-5 flex gap-3">
        <button
          type="button"
          onClick={onBack}
          disabled={submitting}
          className="rounded-full border border-border px-4 py-3 text-sm font-medium text-fg transition hover:bg-surface-inset disabled:opacity-60"
        >
          Back
        </button>
        <button
          type="button"
          onClick={handleContinue}
          disabled={tipCents === null || submitting}
          className="login-button login-jura flex-1 px-4 py-3 text-sm font-bold uppercase disabled:opacity-60"
        >
          {submitting ? 'Loading…' : 'Continue'}
        </button>
      </div>
    </div>
  )
}
