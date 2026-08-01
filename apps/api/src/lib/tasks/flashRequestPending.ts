import { prisma } from "../prisma";
import { InquiryStatus } from "../../../generated/prisma/enums";
import { truncate, type SystemTask, type TaskSource } from "./types";

// Flash gallery: every Inquiry a customer submitted through the public
// gallery's lightweight form, awaiting front desk's review of the
// placement photo/description and customer info (POST /flash-pieces/:id/
// request always creates one at FLASH_PENDING_APPROVAL, never anything
// else). Deep-links straight to the inquiry detail page -- no dedicated
// approve/decline UI surface exists yet beyond that page itself.
async function fetch(studioId: string, _userId: string): Promise<SystemTask[]> {
  const inquiries = await prisma.inquiry.findMany({
    where: { studioId, status: InquiryStatus.FLASH_PENDING_APPROVAL },
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
