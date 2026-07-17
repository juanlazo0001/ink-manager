import { prisma } from "../prisma";
import { InquiryStatus } from "../../../generated/prisma/enums";
import { truncate, type SystemTask, type TaskSource } from "./types";

// Constant for now; a per-studio settings knob can replace this later
// without changing this source's shape.
const STALE_HOURS = 24;

async function fetch(studioId: string, _userId: string): Promise<SystemTask[]> {
  const cutoff = new Date(Date.now() - STALE_HOURS * 60 * 60 * 1000);

  const inquiries = await prisma.inquiry.findMany({
    where: { studioId, status: InquiryStatus.NEW, assignedArtistId: null, createdAt: { lt: cutoff } },
    select: { id: true, description: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  return inquiries.map((inquiry) => ({
    type: "INQUIRY_UNANSWERED",
    title: `Unanswered inquiry: ${truncate(inquiry.description)}`,
    entityType: "Inquiry",
    entityId: inquiry.id,
    dismissalKey: inquiry.id,
    deepLink: `/inquiries/${inquiry.id}`,
    actionableAt: inquiry.createdAt,
  }));
}

export const inquiryUnansweredSource: TaskSource = { type: "INQUIRY_UNANSWERED", label: "Unanswered inquiries", fetch };
