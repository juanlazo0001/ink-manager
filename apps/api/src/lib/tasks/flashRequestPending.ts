import { prisma } from "../prisma";
import { FlashReviewMode, InquiryStatus } from "../../../generated/prisma/enums";
import { truncate, type SystemTask, type TaskSource } from "./types";

// Flash gallery + review mode expansion: front desk's own queue for a
// FLASH_PENDING_APPROVAL inquiry. Scoped to pieces whose artist has
// flashReviewMode STUDIO -- this used to be permanently unreachable dead
// code (the old boolean's OFF state meant instant auto-approve, never
// front-desk review; see the removed field's own migration comment
// history), now genuinely live now that STUDIO exists as its own mode.
// Every ARTIST-mode request belongs to flashRequestArtistPending.ts
// instead (the artist's own queue, not front desk's -- see that file's
// comment for why); NONE never reaches FLASH_PENDING_APPROVAL at all.
async function fetch(studioId: string, _userId: string): Promise<SystemTask[]> {
  const inquiries = await prisma.inquiry.findMany({
    where: {
      studioId,
      status: InquiryStatus.FLASH_PENDING_APPROVAL,
      flashPiece: { artist: { flashReviewMode: FlashReviewMode.STUDIO } },
    },
    select: { id: true, description: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  return inquiries.map((inquiry) => ({
    type: "FLASH_REQUEST_PENDING",
    title: `New flash booking: ${truncate(inquiry.description)}`,
    entityType: "Inquiry",
    entityId: inquiry.id,
    dismissalKey: inquiry.id,
    deepLink: `/inquiries/${inquiry.id}`,
    actionableAt: inquiry.createdAt,
  }));
}

export const flashRequestPendingSource: TaskSource = {
  type: "FLASH_REQUEST_PENDING",
  label: "Flash booking — review placement & customer",
  fetch,
};
