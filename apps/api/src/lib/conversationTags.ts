import { prisma } from "./prisma";

export const TAGGABLE_ENTITY_TYPES = ["Inquiry", "Appointment", "GiftCard", "DepositForm", "LiabilityWaiver"] as const;
export type TaggableEntityType = (typeof TAGGABLE_ENTITY_TYPES)[number];

// Confirms the entity exists, belongs to this studio, AND belongs to this
// conversation's client -- the whole point of tagging is "this thread is
// about this specific record," so a thread can never be tagged with
// someone else's inquiry/appointment/etc.
export async function validateTaggableEntity(
  entityType: string,
  entityId: string,
  studioId: string,
  clientId: string,
): Promise<{ error: string } | { ok: true }> {
  switch (entityType) {
    case "Inquiry": {
      const inquiry = await prisma.inquiry.findUnique({ where: { id: entityId } });
      if (!inquiry || inquiry.studioId !== studioId || inquiry.clientId !== clientId) {
        return { error: "Inquiry must belong to this conversation's client" };
      }
      return { ok: true };
    }
    case "Appointment": {
      const appointment = await prisma.appointment.findUnique({ where: { id: entityId } });
      if (!appointment || appointment.studioId !== studioId || appointment.clientId !== clientId) {
        return { error: "Appointment must belong to this conversation's client" };
      }
      return { ok: true };
    }
    case "GiftCard": {
      const giftCard = await prisma.giftCard.findUnique({ where: { id: entityId } });
      if (!giftCard || giftCard.studioId !== studioId || giftCard.clientId !== clientId) {
        return { error: "Gift card must belong to this conversation's client" };
      }
      return { ok: true };
    }
    case "DepositForm": {
      // No direct studioId/clientId -- scoped via its Inquiry.
      const depositForm = await prisma.depositForm.findUnique({
        where: { id: entityId },
        include: { inquiry: { select: { studioId: true, clientId: true } } },
      });
      if (!depositForm || depositForm.inquiry.studioId !== studioId || depositForm.inquiry.clientId !== clientId) {
        return { error: "Deposit form must belong to this conversation's client" };
      }
      return { ok: true };
    }
    case "LiabilityWaiver": {
      const waiver = await prisma.liabilityWaiver.findUnique({ where: { id: entityId } });
      if (!waiver || waiver.studioId !== studioId || waiver.clientId !== clientId) {
        return { error: "Waiver must belong to this conversation's client" };
      }
      return { ok: true };
    }
    default:
      return { error: `entityType must be one of: ${TAGGABLE_ENTITY_TYPES.join(", ")}` };
  }
}

// Short display label + deep link for a tag chip. Best-effort: if the
// underlying record has since been deleted (shouldn't happen -- nothing
// deletes these), falls back to a generic label rather than erroring.
export async function resolveTagLabel(entityType: string, entityId: string): Promise<{ label: string; deepLink: string }> {
  switch (entityType) {
    case "Inquiry": {
      const inquiry = await prisma.inquiry.findUnique({ where: { id: entityId }, select: { description: true } });
      const desc = inquiry?.description ?? "Inquiry";
      return { label: desc.length > 30 ? `${desc.slice(0, 30).trimEnd()}…` : desc, deepLink: `/inquiries/${entityId}` };
    }
    case "Appointment": {
      const appointment = await prisma.appointment.findUnique({ where: { id: entityId }, select: { startTime: true } });
      const label = appointment ? new Date(appointment.startTime).toLocaleDateString() : "Appointment";
      return { label: `Appointment ${label}`, deepLink: `/appointments/${entityId}` };
    }
    case "GiftCard": {
      const giftCard = await prisma.giftCard.findUnique({ where: { id: entityId }, select: { amountCents: true } });
      const label = giftCard ? `$${(giftCard.amountCents / 100).toFixed(2)} gift card` : "Gift card";
      return { label, deepLink: `/gift-cards/${entityId}` };
    }
    case "DepositForm": {
      const depositForm = await prisma.depositForm.findUnique({ where: { id: entityId }, select: { inquiryId: true, totalCharged: true } });
      const label = depositForm ? `$${depositForm.totalCharged} deposit` : "Deposit form";
      return { label, deepLink: depositForm ? `/inquiries/${depositForm.inquiryId}` : "#" };
    }
    case "LiabilityWaiver": {
      const waiver = await prisma.liabilityWaiver.findUnique({ where: { id: entityId }, select: { appointmentId: true, status: true } });
      const label = waiver ? `Waiver (${waiver.status})` : "Waiver";
      return { label, deepLink: waiver ? `/appointments/${waiver.appointmentId}` : "#" };
    }
    default:
      return { label: entityType, deepLink: "#" };
  }
}
