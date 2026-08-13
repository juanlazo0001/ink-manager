import crypto from "node:crypto";
import { prisma } from "./prisma";
import { InquiryStatus } from "../../generated/prisma/enums";
import { diffObjects, logAudit } from "./audit";
import { getOrCreateClientConversation } from "./conversations";
import { sendClientSms } from "./clientSms";
import { shortenUrl } from "./shortLinks";
import { PUBLIC_APP_URL } from "./publicUrl";
import { emitInvalidation } from "./realtime/registry";

// Flash requests + artist review toggle: the shared "approve" mechanics --
// mint the payment token, transition the status, audit, and best-effort
// text the payment link -- pulled out of routes/inquiries.ts's own
// POST /:id/flash/approve so both that route (a human approving) and
// routes/flashPieces.ts's POST /:id/request (an artist with their review
// toggle OFF, approving instantly and automatically) share one
// implementation instead of two copies of the token/SMS logic drifting
// apart. actorUserId is null for the auto-approve path -- no human clicked
// anything, same "null is honest, not a bug" judgment call the transfer-
// to-artist epic made for its own system-generated cancellation note.
// Flash gallery, Part 3: longer than the deposit link's 48h -- a flash
// booking's reservation (PENDING_APPROVAL, for a one-of-one piece) is
// already staked out by the time this token goes out, so there's less
// urgency pressure than an unsigned deposit form, and a bigger-ticket full
// payment is more likely to need a client a few days to actually pay.
export const FLASH_PAYMENT_TOKEN_TTL_HOURS = 72;

export async function approveFlashRequest(
  inquiryId: string,
  actorUserId: string | null,
  options: { autoSend?: boolean } = {},
) {
  const autoSend = options.autoSend ?? true;

  const inquiry = await prisma.inquiry.findUniqueOrThrow({
    where: { id: inquiryId },
    include: { client: true, flashPiece: true },
  });

  const flashPaymentToken = crypto.randomBytes(32).toString("hex");
  const flashPaymentTokenExpiresAt = new Date(Date.now() + FLASH_PAYMENT_TOKEN_TTL_HOURS * 60 * 60 * 1000);

  await prisma.inquiry.update({
    where: { id: inquiryId },
    data: { status: InquiryStatus.FLASH_PAYMENT_PENDING, flashPaymentToken, flashPaymentTokenExpiresAt },
  });

  await logAudit({
    studioId: inquiry.studioId,
    actorUserId,
    entityType: "Inquiry",
    entityId: inquiryId,
    action: actorUserId ? "flash_request_approved" : "flash_request_auto_approved",
    changes: diffObjects(inquiry, { status: InquiryStatus.FLASH_PAYMENT_PENDING }, ["status"]),
  });

  emitInvalidation({ type: "inquiry.updated", studioId: inquiry.studioId, inquiryId });

  // Best-effort, same convention as the deposit-form/checkout-link sends
  // elsewhere -- the token/link is already saved regardless of whether the
  // text goes out, so staff still has paymentUrl to share manually if this
  // skips or fails.
  const paymentUrl = await shortenUrl(`${PUBLIC_APP_URL}/flash-payment/${flashPaymentToken}`);
  let flashPaymentSendResult: Awaited<ReturnType<typeof sendClientSms>> | null = null;
  if (autoSend) {
    const conversation = await getOrCreateClientConversation(inquiry.studioId, inquiry.clientId, actorUserId);
    flashPaymentSendResult = await sendClientSms({
      studioId: inquiry.studioId,
      clientId: inquiry.clientId,
      conversationId: conversation.conversation.id,
      body: `Hi ${inquiry.client.firstName}, your flash request "${inquiry.flashPiece?.title ?? "your design"}" is approved! Complete payment here to lock in your booking: ${paymentUrl} (expires in ${FLASH_PAYMENT_TOKEN_TTL_HOURS / 24} days)`,
      actorUserId,
    });
  }

  return { paymentUrl, flashPaymentSendResult };
}
