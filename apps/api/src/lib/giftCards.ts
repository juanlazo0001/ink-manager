import crypto from "node:crypto";
import { prisma } from "./prisma";
import { GiftCardStatus } from "../../generated/prisma/enums";
import type { GiftCard } from "../../generated/prisma/client";

// URL-safe, and this is what the future QR encodes -- collisions are
// vanishingly unlikely at this length, but a unique constraint backstops it.
export async function generateUniqueGiftCardCode(): Promise<string> {
  let code = crypto.randomBytes(16).toString("base64url");

  while (await prisma.giftCard.findUnique({ where: { code } })) {
    code = crypto.randomBytes(16).toString("base64url");
  }

  return code;
}

// null studio default means no expiration.
export function computeGiftCardExpiration(defaultExpirationDays: number | null): Date | null {
  if (defaultExpirationDays == null) return null;
  return new Date(Date.now() + defaultExpirationDays * 24 * 60 * 60 * 1000);
}

// Shared by both appointment-creation routes (standalone + /schedule): a
// gift card must belong to the same client/studio, be ACTIVE and unexpired
// (syncing the lazy-expiration transition if needed), and not already be
// attached elsewhere.
export async function validateGiftCardForAttachment(
  giftCardId: string,
  studioId: string,
  clientId: string,
): Promise<{ error: string } | { card: GiftCard }> {
  const card = await prisma.giftCard.findUnique({ where: { id: giftCardId } });

  if (!card || card.studioId !== studioId || card.clientId !== clientId) {
    return { error: "giftCardId must belong to this client in your studio" };
  }

  const synced = await syncExpiredStatus(card);

  if (synced.status !== GiftCardStatus.ACTIVE) {
    return { error: `This gift card is not available (status: ${synced.status})` };
  }

  if (synced.appointmentId) {
    return { error: "This gift card is already attached to another appointment" };
  }

  return { card: synced };
}

// No scheduler exists yet (a later phase adds a background sweep). Until
// then, expiration is handled lazily: anywhere a card is read or validated,
// a still-ACTIVE card whose expiresAt has passed is treated as EXPIRED.
export function isExpired(card: Pick<GiftCard, "status" | "expiresAt">): boolean {
  return card.status === GiftCardStatus.ACTIVE && card.expiresAt != null && card.expiresAt < new Date();
}

// Lazily persists the EXPIRED transition on read, rather than just computing
// it in memory -- keeps the DB's own status column truthful for every other
// consumer (list views, audit diffs) without needing a background sweep.
export async function syncExpiredStatus(card: GiftCard): Promise<GiftCard> {
  if (!isExpired(card)) return card;

  return prisma.giftCard.update({
    where: { id: card.id },
    data: { status: GiftCardStatus.EXPIRED },
  });
}
