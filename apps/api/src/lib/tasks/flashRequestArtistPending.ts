import { prisma } from "../prisma";
import { InquiryStatus } from "../../../generated/prisma/enums";
import { truncate, type SystemTask, type TaskSource } from "./types";

// Flash requests + artist review toggle: personal to whoever the flash
// piece's own artistId belongs to, not studioId-scoped front-desk work --
// same reasoning and same "deliberately NOT in TASK_SOURCE_REGISTRY,
// called directly from routes/tasks.ts's GET / instead, merged into
// `system` unconditionally regardless of tasks.viewQueue" shape as
// artistTransferPending.ts. Only ever non-empty for an artist whose own
// reviewsFlashRequestsBeforeBooking is on -- when it's off, POST
// /flash-pieces/:id/request auto-approves instantly and this artist never
// sees a FLASH_PENDING_APPROVAL row for their own pieces at all.
async function fetch(_studioId: string, userId: string): Promise<SystemTask[]> {
  const artist = await prisma.artist.findUnique({ where: { userId }, select: { id: true } });
  if (!artist) return [];

  const inquiries = await prisma.inquiry.findMany({
    where: {
      status: InquiryStatus.FLASH_PENDING_APPROVAL,
      flashPieceId: { not: null },
      assignedArtistId: artist.id,
    },
    select: { id: true, description: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  return inquiries.map((inquiry) => ({
    type: "FLASH_REQUEST_ARTIST_PENDING",
    title: `New flash booking: ${truncate(inquiry.description)}`,
    entityType: "Inquiry",
    entityId: inquiry.id,
    dismissalKey: inquiry.id,
    deepLink: `/my-flash-requests/${inquiry.id}`,
    actionableAt: inquiry.createdAt,
  }));
}

export const flashRequestArtistPendingSource: TaskSource = {
  type: "FLASH_REQUEST_ARTIST_PENDING",
  label: "Flash bookings awaiting your review",
  fetch,
};
