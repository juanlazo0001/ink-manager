import { prisma } from "../prisma";
import { GiftCardStatus } from "../../../generated/prisma/enums";
import { logAudit } from "../audit";
import { registerJob } from "./registry";

export const GIFT_CARD_EXPIRATION_SWEEP = "giftCardExpirationSweep";

// Idempotency: the query is WHERE status = ACTIVE AND expiresAt < now. Once
// a card is flipped to EXPIRED it no longer matches, so running this twice
// for the same slot (or re-running after a missed day) only ever touches
// cards that are still genuinely ACTIVE-and-past-expiry at the moment it
// runs -- there's no way to double-apply the transition to an already-
// EXPIRED card. The existing lazy-on-read path (syncExpiredStatus in
// lib/giftCards.ts) stays in place as belt-and-suspenders; this sweep just
// makes the column truthful without waiting for a read to trigger it.
async function run(): Promise<Record<string, unknown>> {
  const now = new Date();

  const toExpire = await prisma.giftCard.findMany({
    where: { status: GiftCardStatus.ACTIVE, expiresAt: { lt: now } },
    select: { id: true, studioId: true, code: true, expiresAt: true },
  });

  if (toExpire.length === 0) {
    return { cardsExpired: 0 };
  }

  await prisma.giftCard.updateMany({
    where: { id: { in: toExpire.map((c) => c.id) } },
    data: { status: GiftCardStatus.EXPIRED },
  });

  for (const card of toExpire) {
    // actorUserId: null -- system action, not attributable to a staff member.
    await logAudit({
      studioId: card.studioId,
      actorUserId: null,
      entityType: "GiftCard",
      entityId: card.id,
      action: "status_change",
      changes: {
        status: { from: "ACTIVE", to: "EXPIRED" },
        job: GIFT_CARD_EXPIRATION_SWEEP,
        expiresAt: card.expiresAt,
      },
    });
  }

  return { cardsExpired: toExpire.length };
}

registerJob({
  name: GIFT_CARD_EXPIRATION_SWEEP,
  description: "Marks ACTIVE gift cards past their expiresAt as EXPIRED.",
  // 02:00 UTC daily.
  schedule: "0 2 * * *",
  run,
});
