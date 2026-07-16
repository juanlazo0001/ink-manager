// Mirrors apps/api/src/lib/money.ts -- every dollars-to-cents conversion on
// this side of the wire goes through here too, so rounding behavior only
// lives in one place per side.
export function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100)
}

export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}
