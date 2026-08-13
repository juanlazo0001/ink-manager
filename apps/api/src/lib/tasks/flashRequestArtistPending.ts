import { prisma } from "../prisma";
import { FlashReviewMode, InquiryStatus } from "../../../generated/prisma/enums";
import { truncate, type SystemTask, type TaskSource } from "./types";

// Flash requests + review mode expansion: personal to whoever the flash
// piece's own artistId belongs to, not studioId-scoped front-desk work --
// same reasoning and same "deliberately NOT in TASK_SOURCE_REGISTRY,
// called directly from routes/tasks.ts's GET / instead, merged into
// `system` unconditionally regardless of tasks.viewQueue" shape as
// artistTransferPending.ts. Only ever non-empty for an artist whose own
// flashReviewMode is ARTIST -- STUDIO belongs to flashRequestPending.ts's
// front-desk queue instead, and NONE auto-approves instantly at
// POST /flash-pieces/:id/request, so this artist never sees a
// FLASH_PENDING_APPROVAL row for their own pieces in either of those modes.
async function fetch(_studioId: string, userId: string): Promise<SystemTask[]> {
  const artist = await prisma.artist.findUnique({ where: { userId }, select: { id: true } });
  if (!artist) return [];

  const inquiries = await prisma.inquiry.findMany({
    where: {
      status: InquiryStatus.FLASH_PENDING_APPROVAL,
      flashPieceId: { not: null },
      assignedArtistId: artist.id,
      assignedArtist: { flashReviewMode: FlashReviewMode.ARTIST },
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
