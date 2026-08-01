import { ServiceDepositModel } from "../../generated/prisma/enums";

export interface DepositTier {
  minAmountCents: number;
  maxAmountCents: number | null;
  depositAmountCents: number;
}

// Mirrors the studio's literal prior hardcoded breakpoints ($0-200 -> $50
// deposit, $201-599 -> $100, $600+ -> $200) at cent granularity so
// contiguity holds exactly. Used both as the Settings UI's pre-populated
// starting point and as computeDepositTier's fallback for any studio that
// hasn't saved its own tiers yet (StudioSettings.depositTiers still null).
export const DEFAULT_DEPOSIT_TIERS: DepositTier[] = [
  { minAmountCents: 0, maxAmountCents: 20000, depositAmountCents: 5000 },
  { minAmountCents: 20001, maxAmountCents: 59900, depositAmountCents: 10000 },
  { minAmountCents: 59901, maxAmountCents: null, depositAmountCents: 20000 },
];

// Flat fee added on top of the deposit in every tier. Was a hardcoded
// constant, unchanged by configurable tiers, since only the deposit
// breakpoints themselves were made configurable here, not the fee --
// now StudioSettings.depositFeeCents (see REPORT.md's "Defaults" tab audit
// Part 1 proposal), same as the tiers next to it. This constant is now
// only the fallback for the rare case a studio's settings row is somehow
// missing, matching the prior hardcoded value exactly.
export const DEFAULT_DEPOSIT_FEE_CENTS = 1000;

// Returns an error message if invalid, null if valid. Enforces: every tier
// well-formed, exactly one tier has maxAmountCents: null (the top,
// catch-all tier) and it's the highest one, the lowest tier starts at 0,
// and tiers are contiguous with no gaps or overlaps once sorted.
export function validateDepositTiers(value: unknown): string | null {
  if (!Array.isArray(value) || value.length === 0) {
    return "depositTiers must be a non-empty array";
  }

  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) {
      return "Each tier must be an object";
    }
    const t = entry as Record<string, unknown>;
    if (typeof t.minAmountCents !== "number" || !Number.isFinite(t.minAmountCents) || t.minAmountCents < 0) {
      return "minAmountCents must be a non-negative number";
    }
    if (t.maxAmountCents !== null && (typeof t.maxAmountCents !== "number" || !Number.isFinite(t.maxAmountCents))) {
      return "maxAmountCents must be a number or null";
    }
    if (typeof t.depositAmountCents !== "number" || !Number.isFinite(t.depositAmountCents) || t.depositAmountCents < 0) {
      return "depositAmountCents must be a non-negative number";
    }
    if (t.maxAmountCents !== null && (t.maxAmountCents as number) <= t.minAmountCents) {
      return "maxAmountCents must be greater than minAmountCents";
    }
  }

  const sorted = [...(value as DepositTier[])].sort((a, b) => a.minAmountCents - b.minAmountCents);

  const nullMaxCount = sorted.filter((t) => t.maxAmountCents === null).length;
  if (nullMaxCount !== 1) {
    return "Exactly one tier must have maxAmountCents: null (the top, catch-all tier)";
  }
  if (sorted[sorted.length - 1].maxAmountCents !== null) {
    return "The tier with maxAmountCents: null must be the highest tier";
  }
  if (sorted[0].minAmountCents !== 0) {
    return "The lowest tier must start at minAmountCents: 0";
  }
  for (let i = 0; i < sorted.length - 1; i++) {
    const current = sorted[i];
    const next = sorted[i + 1];
    if (next.minAmountCents !== (current.maxAmountCents as number) + 1) {
      return `Tiers must be contiguous with no gaps or overlaps (tier ending at ${current.maxAmountCents} is followed by a tier starting at ${next.minAmountCents})`;
    }
  }

  return null;
}

export function resolveDepositTiers(depositTiers: unknown): DepositTier[] {
  if (Array.isArray(depositTiers) && depositTiers.length > 0) {
    return depositTiers as DepositTier[];
  }
  return DEFAULT_DEPOSIT_TIERS;
}

export function computeDepositTier(
  averageEstimate: number,
  tiers: DepositTier[] = DEFAULT_DEPOSIT_TIERS,
  feeCents: number = DEFAULT_DEPOSIT_FEE_CENTS,
): { depositAmount: number; totalCharged: number } {
  const averageCents = Math.round(averageEstimate * 100);
  const matched =
    tiers.find(
      (t) => averageCents >= t.minAmountCents && (t.maxAmountCents === null || averageCents <= t.maxAmountCents),
    ) ?? tiers[tiers.length - 1];

  const depositAmount = matched.depositAmountCents / 100;
  const feeAmount = feeCents / 100;
  return { depositAmount, totalCharged: depositAmount + feeAmount };
}

// Gift-card stacking: the amount a stack of attached cards must meet or
// exceed. This is computeDepositTier's own depositAmount -- NOT
// totalCharged, which additionally bakes in the flat processing fee a
// client pays through a deposit form's card-payment flow (the studio's
// configured depositFeeCents on top). A gift card's face value is never
// issued at that inflated amount (see routes/deposits.ts's own `amountCents: dollarsToCents(
// depositForm.depositAmount)`), so sufficiency has to be checked against
// the same, non-fee-inflated number a card can actually be worth.
// null/missing price-estimate bounds (an inquiry that hasn't been quoted
// yet) resolve to a $0 requirement rather than blocking attachment on data
// that isn't there -- any card, including a $0 EXEMPT one, trivially
// satisfies that.
export function computeRequiredDepositCents(
  priceEstimateLow: number | null,
  priceEstimateHigh: number | null,
  tiers: DepositTier[] = DEFAULT_DEPOSIT_TIERS,
): number {
  if (priceEstimateLow == null || priceEstimateHigh == null) return 0;
  const average = (priceEstimateLow + priceEstimateHigh) / 2;
  const { depositAmount } = computeDepositTier(average, tiers);
  return Math.round(depositAmount * 100);
}

// Service lines: the one place every deposit-amount call site branches on
// depositModel, so a FLAT service (flatDepositCents is the ENTIRE amount
// charged -- e.g. Powder Brows' $60, already described via
// Service.depositBreakdownNote -- not a tier-lookup deposit with the usual
// processing fee stacked on top of it) is handled identically everywhere
// gift-card sufficiency is checked. TIER_BASED (Tattoo, and every other
// service predating this feature) is completely unaffected -- same
// computeRequiredDepositCents call as before.
export function resolveRequiredDepositCents(
  service: { depositModel: ServiceDepositModel; flatDepositCents: number | null },
  priceEstimateLow: number | null,
  priceEstimateHigh: number | null,
  tiers: DepositTier[] = DEFAULT_DEPOSIT_TIERS,
): number {
  if (service.depositModel === ServiceDepositModel.FLAT) {
    return service.flatDepositCents ?? 0;
  }
  return computeRequiredDepositCents(priceEstimateLow, priceEstimateHigh, tiers);
}

// Same FLAT/TIER_BASED branch as resolveRequiredDepositCents above, but for
// the deposit-form creation route, which needs the depositAmount/
// totalCharged split (feeAmount = totalCharged - depositAmount) rather than
// just a single sufficiency-check total. FLAT sets feeAmount to 0 -- the
// flat amount already represents everything charged, per
// depositBreakdownNote, not an additional fee layered on top of it.
export function resolveDepositAmounts(
  service: { depositModel: ServiceDepositModel; flatDepositCents: number | null },
  average: number,
  tiers: DepositTier[] = DEFAULT_DEPOSIT_TIERS,
  feeCents: number = DEFAULT_DEPOSIT_FEE_CENTS,
): { depositAmount: number; totalCharged: number } {
  if (service.depositModel === ServiceDepositModel.FLAT) {
    const amount = (service.flatDepositCents ?? 0) / 100;
    return { depositAmount: amount, totalCharged: amount };
  }
  return computeDepositTier(average, tiers, feeCents);
}
