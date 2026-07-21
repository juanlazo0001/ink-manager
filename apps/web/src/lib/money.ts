// Mirrors apps/api/src/lib/money.ts -- every dollars-to-cents conversion on
// this side of the wire goes through here too, so rounding behavior only
// lives in one place per side.
export function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100)
}

export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

// Display-time formatter for CurrencyInput below -- `digits` is always the
// clean whole-dollar-amount string (no `$`, no commas) that value/onChange
// carry; this only ever runs at render time to decide what the user sees.
export function formatCurrencyInput(digits: string): string {
  if (!digits) return ''
  return `$${Number(digits).toLocaleString('en-US')}`
}
