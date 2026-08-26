import { GiftCardStatus } from '@ink-manager/shared-types';

import type { ChipTone } from '@/components/StatusChip';

/**
 * A gift card's status colour — apps/web's `STATUS_TONE`, gift-card block.
 *
 * WHY THIS EXISTS, and it is a real defect rather than tidying. Both the
 * client detail card and the gift card screen carried their own
 * three-branch function:
 *
 *   ACTIVE -> success; VOID or EXPIRED -> danger; everything else -> neutral
 *
 * which got three of the six values wrong against web:
 *
 *   EXPIRED   danger  -> should be WARNING  (an expired card is stale, not void)
 *   PENDING   neutral -> should be WARNING  (a Stripe link issued, not yet paid)
 *   EXEMPT    neutral -> should be INFO     (a deposit exemption, not a dead card)
 *
 * PENDING and EXEMPT fell through to grey because the function had no
 * branch for them at all — which is exactly what the owner saw.
 *
 * THE ROOT CAUSE was upstream of the colours: `GiftCardStatus` was not in
 * `packages/shared-types`, so there was no enum for either copy to be
 * exhaustive against and nothing to fail when a value was missed. It is
 * generated from `schema.prisma` now, and this map is a TOTAL
 * `Record<GiftCardStatus, ChipTone>` — a seventh status becomes a compile
 * error here rather than another silently grey chip.
 *
 * That is the same failure mode `packages/shared-types/README.md` records
 * for `InquiryStatus`, which shipped to mobile with 11 of its 15 values.
 */
export const GIFT_CARD_TONES: Record<GiftCardStatus, ChipTone> = {
  [GiftCardStatus.PENDING]: 'warning',
  [GiftCardStatus.ACTIVE]: 'success',
  [GiftCardStatus.REDEEMED]: 'neutral',
  [GiftCardStatus.EXPIRED]: 'warning',
  [GiftCardStatus.VOID]: 'danger',
  [GiftCardStatus.EXEMPT]: 'info',
};

/**
 * The tone for a status string off the wire.
 *
 * Typed as `string` on purpose: `GiftCard.status` is hand-typed from the
 * live response because shared-types still has no gift-card interface, so
 * this cannot assume the value is in the enum. An unrecognised status
 * reads as neutral rather than throwing.
 */
export function giftCardTone(status: string): ChipTone {
  return GIFT_CARD_TONES[status.toUpperCase() as GiftCardStatus] ?? 'neutral';
}
