export interface DepositTier {
  minAmountCents: number
  maxAmountCents: number | null
  depositAmountCents: number
}

// Mirrors apps/api/src/lib/depositTiers.ts's own DEFAULT_DEPOSIT_TIERS
// exactly -- same fallback for a studio that hasn't saved its own tiers yet.
export const DEFAULT_DEPOSIT_TIERS: DepositTier[] = [
  { minAmountCents: 0, maxAmountCents: 20000, depositAmountCents: 5000 },
  { minAmountCents: 20001, maxAmountCents: 59900, depositAmountCents: 10000 },
  { minAmountCents: 59901, maxAmountCents: null, depositAmountCents: 20000 },
]

export function resolveDepositTiers(depositTiers: DepositTier[] | null | undefined): DepositTier[] {
  if (Array.isArray(depositTiers) && depositTiers.length > 0) return depositTiers
  return DEFAULT_DEPOSIT_TIERS
}

// Mirrors apps/api/src/lib/depositTiers.ts's computeRequiredDepositCents
// exactly (which itself is a thin wrapper on computeDepositTier -- both
// live server-side; the server is always the authority on what's actually
// required, this is purely a live preview so staff sees a running total
// against the right number while checking cards, same "mirror the exact
// server math client-side for a live preview" pattern AppointmentDetail's
// checkout amount-due preview already uses). Returns the deposit-only
// amount, NOT the fee-inflated totalCharged a client pays through a
// deposit form's card-payment flow -- a gift card's face value is never
// issued at that inflated number.
export function computeRequiredDepositCents(
  priceEstimateLow: number | null | undefined,
  priceEstimateHigh: number | null | undefined,
  tiers: DepositTier[] = DEFAULT_DEPOSIT_TIERS,
): number {
  if (priceEstimateLow == null || priceEstimateHigh == null) return 0
  const averageCents = Math.round(((priceEstimateLow + priceEstimateHigh) / 2) * 100)
  const matched =
    tiers.find((t) => averageCents >= t.minAmountCents && (t.maxAmountCents === null || averageCents <= t.maxAmountCents)) ??
    tiers[tiers.length - 1]
  return matched.depositAmountCents
}
