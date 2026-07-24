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
// gift card must belong to the same client/studio, be ACTIVE (or EXEMPT --
// a Package F deposit exemption, which satisfies this rule without
// representing real money) and unexpired (syncing the lazy-expiration
// transition if needed), and not already be attached elsewhere.
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

  if (synced.status !== GiftCardStatus.ACTIVE && synced.status !== GiftCardStatus.EXEMPT) {
    return { error: `This gift card is not available (status: ${synced.status})` };
  }

  if (synced.appointmentId) {
    return { error: "This gift card is already attached to another appointment" };
  }

  return { card: synced };
}

// Stackable gift cards: validates a whole proposed stack at once, reusing
// the exact same per-card checks validateGiftCardForAttachment already
// enforces (ownership, ACTIVE/EXEMPT status, unexpired, not already
// attached elsewhere) -- then additionally requires the SUM of the stack to
// meet or exceed requiredCents. A single sufficiently-large card is just
// the length-1 case of this, so this supersedes (and single-card callers
// can go through it too) rather than duplicating the old single-card path.
export async function validateGiftCardsForAttachment(
  giftCardIds: string[],
  studioId: string,
  clientId: string,
  requiredCents: number,
): Promise<{ error: string } | { cards: GiftCard[] }> {
  if (!Array.isArray(giftCardIds) || giftCardIds.length === 0) {
    return { error: "At least one gift card is required" };
  }

  if (new Set(giftCardIds).size !== giftCardIds.length) {
    return { error: "The same gift card was selected more than once" };
  }

  const cards: GiftCard[] = [];
  for (const giftCardId of giftCardIds) {
    const result = await validateGiftCardForAttachment(giftCardId, studioId, clientId);
    if ("error" in result) return { error: result.error };
    cards.push(result.card);
  }

  const totalCents = cards.reduce((sum, c) => sum + c.amountCents, 0);
  if (totalCents < requiredCents) {
    const shortfallCents = requiredCents - totalCents;
    return {
      error:
        `The attached gift card(s) total $${(totalCents / 100).toFixed(2)}, which is ` +
        `$${(shortfallCents / 100).toFixed(2)} short of the required $${(requiredCents / 100).toFixed(2)} deposit.`,
    };
  }

  return { cards };
}

// No scheduler exists yet (a later phase adds a background sweep). Until
// then, expiration is handled lazily: anywhere a card is read or validated,
// a still-ACTIVE (or still-EXEMPT, e.g. a time-limited comp) card whose
// expiresAt has passed is treated as EXPIRED.
export function isExpired(card: Pick<GiftCard, "status" | "expiresAt">): boolean {
  return (
    (card.status === GiftCardStatus.ACTIVE || card.status === GiftCardStatus.EXEMPT) &&
    card.expiresAt != null &&
    card.expiresAt < new Date()
  );
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
