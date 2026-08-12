import { prisma } from "../prisma";
import { InquiryStatus } from "../../../generated/prisma/enums";
import { truncate, type SystemTask, type TaskSource } from "./types";

// Flash gallery + artist review toggle: front desk's own queue for a
// FLASH_PENDING_APPROVAL inquiry. Scoped to pieces whose artist has
// reviewsFlashRequestsBeforeBooking OFF -- by construction that status is
// never actually reached for such a piece (POST /flash-pieces/:id/request
// auto-approves it instantly instead), so this filter documents the
// invariant rather than changing today's runtime result. Left in rather
// than deleted: still the correct fallback if that invariant is ever
// violated, and every ON-toggle request now belongs to
// flashRequestArtistPending.ts instead (the artist's own queue, not
// front desk's -- see that file's comment for why).
async function fetch(studioId: string, _userId: string): Promise<SystemTask[]> {
  const inquiries = await prisma.inquiry.findMany({
    where: {
      studioId,
      status: InquiryStatus.FLASH_PENDING_APPROVAL,
      flashPiece: { artist: { reviewsFlashRequestsBeforeBooking: false } },
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
