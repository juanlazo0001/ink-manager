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

// Flat fee added on top of the deposit in every tier -- unchanged by
// configurable tiers, since only the deposit breakpoints themselves are
// made configurable here, not the fee.
export const DEPOSIT_FEE_CENTS = 1000;

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
): { depositAmount: number; totalCharged: number } {
  const averageCents = Math.round(averageEstimate * 100);
  const matched =
    tiers.find(
      (t) => averageCents >= t.minAmountCents && (t.maxAmountCents === null || averageCents <= t.maxAmountCents),
    ) ?? tiers[tiers.length - 1];

  const depositAmount = matched.depositAmountCents / 100;
  const feeAmount = DEPOSIT_FEE_CENTS / 100;
  return { depositAmount, totalCharged: depositAmount + feeAmount };
}
